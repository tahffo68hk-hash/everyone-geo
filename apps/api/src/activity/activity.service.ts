import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma } from "@geo/database";
import { PrismaService } from "../prisma.service";

/**
 * R2 · Activity Center（统一任务中心）
 *
 * 产品语义（对应 Gap C12 / C14）：
 *   - 聚合【现有实体】而非复制：MonitorTask（无 BenchmarkRun 的纯监测任务）、
 *     BenchmarkRun（automated benchmark）、手动 Web UI 测量（provider=manual 的
 *     BenchmarkRun）、OptimizationExperiment、ExperimentRetest。
 *   - 禁止为聚合新建第二套核心任务表（Task/ActivityTask/UnifiedRun）。
 *   - 实现方式：分表 bounded query + 内存 merge/sort，避免每行 N+1 查询。
 *   - Tenant / Project 隔离：所有查询一律按 organization.members 过滤；projectId
 *     可选做 Project 级收敛。
 *   - 状态表达复用现有语义（TaskStatus / RunStatus / Experiment status 机），
 *     不定义第二套近义状态。手动测量在仍有 AWAITING_MANUAL_INPUT 子 Run 时提升为
 *     AWAITING_MANUAL_INPUT 一级状态。
 *   - 结果导航跳转各任务类型真实存在的详情页，不创建统一任务详情页。
 */

const RUN_STATUSES = new Set([
  "PENDING", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "PARTIAL",
  "AWAITING_MANUAL_INPUT", "SKIPPED",
]);

const EXPERIMENT_STATUSES = new Set([
  "PLANNED", "EXECUTION_RECORDED", "RETEST_READY", "RETEST_RUNNING",
  "READY_FOR_EVALUATION", "EVALUATED", "CANCELLED",
]);

const RETEST_STATUSES = new Set([
  "QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED",
]);

const ACTIVITY_TYPES = ["MONITOR", "BENCHMARK", "MANUAL", "EXPERIMENT", "RETEST"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

// 每源聚合上限：bounded merge 足够满足分页/筛选/排序的第一版需求，
// 不做统一跨表 cursor（避免为完美 cursor 引入大规模架构）。
const SOURCE_LIMIT = 500;

export interface ActivityActionResult {
  items: ActivityDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ActivityDTO {
  id: string;
  type: ActivityType;
  projectId: string;
  projectName: string;
  suiteId: string | null;
  suiteName: string | null;
  suiteVersion: string | null;
  engineLabel: string | null;
  status: string;
  progress: { completed: number | null; total: number | null; label: string | null } | null;
  createdAt: string;
  completedAt: string | null;
  startable: boolean;
  resultUrl: string;
}

@Injectable()
export class ActivityService {
  constructor(private readonly db: PrismaService) {}

  /**
   * 聚合所有组织的最近活动。返回 bounded deterministic 分页结果。
   */
  async list(
    userId: string,
    filters: { projectId?: string; type?: string; status?: string; q?: string; page?: number; pageSize?: number },
  ): Promise<ActivityActionResult> {
    const type = filters.type as ActivityType | undefined;
    if (type && !ACTIVITY_TYPES.includes(type)) {
      throw new BadRequestException(`未知任务类型：${type}`);
    }

    const q = filters.q?.trim();
    let runStatus: string | undefined;
    let experimentStatus: string | undefined;
    if (filters.status) {
      if (RUN_STATUSES.has(filters.status)) runStatus = filters.status;
      else if (EXPERIMENT_STATUSES.has(filters.status)) experimentStatus = filters.status;
      else throw new BadRequestException(`未知状态：${filters.status}`);
    }

    const membersWhere = { organization: { members: { some: { userId } } } };
    const projectId = filters.projectId;

    // ---- 1) Benchmark source（automated benchmark + manual Web UI measurement）----
    const benchmarkItems: ActivityDTO[] = [];
    if (!type || type === "BENCHMARK" || type === "MANUAL") {
      const fromBench = await this.db.client.benchmarkRun.findMany({
        where: {
          ...membersWhere as object,
          ...(projectId ? { projectId } : {}),
          ...(type === "MANUAL" ? { provider: "manual" } : {}),
          ...(type === "BENCHMARK" ? { provider: { not: "manual" } } : {}),
          ...(this.runFilter(runStatus) as unknown as Prisma.BenchmarkRunWhereInput),
          ...(q ? {
            OR: [
              { suiteName: { contains: q, mode: "insensitive" } },
              { project: { name: { contains: q, mode: "insensitive" } } },
            ],
          } : {}),
        },
        include: {
          project: { select: { id: true, name: true } },
          engine: { select: { id: true, key: true, name: true, provider: true } },
          monitorTask: { include: { runs: { select: { status: true } } } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: SOURCE_LIMIT,
      });
      const rows = fromBench.map(r => r.monitorTask.runs.map(x => String(x.status)));
      fromBench.forEach(run => {
        const isManual = run.provider === "manual";
        const runStatuses = rows.length ? run.monitorTask.runs.map(x => String(x.status)) : [];
        const awaiting = runStatuses.includes("AWAITING_MANUAL_INPUT");
        const done = runStatuses.filter(s => s === "SUCCEEDED" || s === "SKIPPED" || s === "FAILED").length;
        // 手动测量：仍有等待人工录入的子 Run 时，提升为一级 AWAITING_MANUAL_INPUT 状态
        const effectiveStatus = isManual && awaiting && done < runStatuses.length
          ? "AWAITING_MANUAL_INPUT"
          : run.status;
        benchmarkItems.push({
          id: run.id,
          type: isManual ? "MANUAL" : "BENCHMARK",
          projectId: run.projectId,
          projectName: run.project.name,
          suiteId: run.suiteId,
          suiteName: run.suiteName,
          suiteVersion: run.suiteVersion,
          engineLabel: run.engine.name,
          status: effectiveStatus,
          progress: {
            completed: isManual ? done : run.completedRuns,
            total: isManual ? runStatuses.length : run.plannedRuns,
            label: isManual ? `${done} / ${runStatuses.length}` : `${run.completedRuns} / ${run.plannedRuns}`,
          },
          createdAt: run.createdAt.toISOString(),
          completedAt: run.completedAt?.toISOString() ?? null,
          startable: true,
          resultUrl: isManual
            ? `/app/manual-runs/${run.id}`
            : `/app/benchmark?suite=${run.suiteId}&run=${run.id}`,
        });
      });
    }

    // ---- 2) Monitor source（纯监测任务，无关联 BenchmarkRun）----
    const monitorItems: ActivityDTO[] = [];
    if (!type || type === "MONITOR") {
      const tasks = await this.db.client.monitorTask.findMany({
        where: {
          ...membersWhere as object,
          benchmarkRun: { is: null },
          ...(projectId ? { projectId } : {}),
          ...(this.monitorRunFilter(runStatus) as unknown as Prisma.MonitorTaskWhereInput),
          ...(q ? { project: { name: { contains: q, mode: "insensitive" } } } : {}),
        },
        include: {
          project: { select: { id: true, name: true } },
          runs: { take: 1, select: { engine: { select: { key: true, name: true, provider: true } } } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: SOURCE_LIMIT,
      });
      tasks.forEach(task => {
        const engine = task.runs[0]?.engine ?? null;
        monitorItems.push({
          id: task.id,
          type: "MONITOR",
          projectId: task.projectId,
          projectName: task.project.name,
          suiteId: null,
          suiteName: null,
          suiteVersion: null,
          engineLabel: engine ? engine.name : null,
          status: task.status,
          progress: {
            completed: task.completedRuns,
            total: task.totalRuns,
            label: `${task.completedRuns} / ${task.totalRuns}`,
          },
          createdAt: task.createdAt.toISOString(),
          completedAt: task.completedAt?.toISOString() ?? null,
          startable: true,
          resultUrl: `/app/monitor?task=${task.id}`,
        });
      });
    }

    // ---- 3) Experiment source ----
    const experimentItems: ActivityDTO[] = [];
    if (!type || type === "EXPERIMENT") {
      const experiments = await this.db.client.optimizationExperiment.findMany({
        where: {
          project: { organization: { members: { some: { userId } } } },
          ...(projectId ? { projectId } : {}),
          ...(experimentStatus ? { status: experimentStatus } : {}),
          ...(q ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { hypothesis: { contains: q, mode: "insensitive" } },
              { project: { name: { contains: q, mode: "insensitive" } } },
            ],
          } : {}),
        },
        include: { project: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: SOURCE_LIMIT,
      });
      experiments.forEach(exp => {
        experimentItems.push({
          id: exp.id,
          type: "EXPERIMENT",
          projectId: exp.projectId,
          projectName: exp.project.name,
          suiteId: null,
          suiteName: exp.suiteName ?? null,
          suiteVersion: exp.suiteVersion ?? null,
          engineLabel: exp.engineName ?? null,
          status: exp.status,
          // 实验没有可靠 denominator，禁止展示 0%/100% 误导进度
          progress: null,
          createdAt: exp.createdAt.toISOString(),
          completedAt: exp.completedAt?.toISOString() ?? null,
          startable: true,
          resultUrl: `/app/experiments/${exp.id}`,
        });
      });
    }

    // ---- 4) Retest source（Experiment 子资源复测）----
    const retestItems: ActivityDTO[] = [];
    if (!type || type === "RETEST") {
      const retests = await this.db.client.experimentRetest.findMany({
        where: {
          experiment: { project: { organization: { members: { some: { userId } } } } },
          ...(projectId ? { experiment: { projectId } } : {}),
          ...(runStatus ? (this.retestRunFilter(runStatus) as unknown as Prisma.ExperimentRetestWhereInput) : {}),
          ...(q ? { experiment: { title: { contains: q, mode: "insensitive" } } } : {}),
        },
        include: {
          experiment: {
            select: {
              id: true, title: true, status: true,
              project: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: SOURCE_LIMIT,
      });
      retests.forEach(rt => {
        retestItems.push({
          id: rt.id,
          type: "RETEST",
          projectId: rt.experiment.project.id,
          projectName: rt.experiment.project.name,
          suiteId: null,
          suiteName: rt.experiment.title,
          suiteVersion: `#${rt.sequence}`,
          engineLabel: rt.engineKey ?? rt.provider,
          status: rt.status,
          progress: {
            completed: null,
            total: rt.plannedQueryCount,
            label: `${rt.expectedCallCount} 次调用`,
          },
          createdAt: rt.createdAt.toISOString(),
          completedAt: rt.completedAt?.toISOString() ?? null,
          startable: true,
          resultUrl: `/app/experiments/${rt.experiment.id}`,
        });
      });
    }

    // ---- Merge + deterministic sort + page ----
    const merged = [...monitorItems, ...benchmarkItems, ...experimentItems, ...retestItems]
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
        return a.type < b.type ? -1 : a.type > b.type ? 1 : 0;
      });

    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const total = merged.length;
    const start = (page - 1) * pageSize;
    const items = merged.slice(start, start + pageSize);
    return { items, page, pageSize, total };
  }

  /** 状态 filter（Benchmark / Retest 源）：AWAITING_MANUAL_INPUT / SKIPPED 基于子 Run 状态；其余基于任务状态。 */
  private runFilter(status?: string): { status?: string; provider?: string; monitorTask?: object } {
    if (!status) return {};
    if (status === "AWAITING_MANUAL_INPUT") {
      return { provider: "manual", monitorTask: { runs: { some: { status: "AWAITING_MANUAL_INPUT" } } } };
    }
    if (status === "SKIPPED") {
      return { monitorTask: { runs: { some: { status: "SKIPPED" } } } };
    }
    return { status };
  }

  /** 状态 filter（Monitor 源）：MonitorTask 无 provider 字段，AWAITING_MANUAL_INPUT / SKIPPED 仅按子 Run 状态过滤。 */
  private monitorRunFilter(status?: string): { status?: string; runs?: object } {
    if (!status) return {};
    if (status === "AWAITING_MANUAL_INPUT" || status === "SKIPPED") {
      return { runs: { some: { status } } };
    }
    return { status };
  }

  /** 状态 filter（Retest 源）：ExperimentRetest 无 benchmarkRun 关系（仅归档用 benchmarkRunId），
   *  AWAITING_MANUAL_INPUT / SKIPPED 无法经子 Run 判断 → 保底空集；其余基于任务状态。 */
  private retestRunFilter(status?: string): { status?: string; id?: string } {
    if (!status) return {};
    if (status === "AWAITING_MANUAL_INPUT" || status === "SKIPPED") {
      return { id: "00000000-0000-0000-0000-000000000000" };
    }
    return { status };
  }

  /** 前端可用的筛选枚举（校验 + 展示共用）。 */
  static readonly ACTIVITY_TYPES = ACTIVITY_TYPES;
}
