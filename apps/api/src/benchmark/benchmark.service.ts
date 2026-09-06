import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy } from "@nestjs/common";
import { createRunQueue, dispatchPendingRuns } from "@geo/queue";
import { aggregateMetrics, METRIC_VERSION, type AnalysisOutput, type MetricsOutput, type Sentiment } from "@geo/core";
import { enginePresentation, readRealProviderEnv } from "@geo/llm";
import type { Prisma } from "@geo/database";
import { PrismaService } from "../prisma.service";
import { TenantService } from "../common/tenant.service";
import { CreateBenchmarkSuiteDto } from "./dto/create-benchmark-suite.dto";
import { StartBenchmarkRunDto } from "./dto/start-benchmark-run.dto";

/**
 * M6A Benchmark 编排服务。
 *
 * 关键约束：
 *   - Benchmark 是“编排层”，不重写 Monitor pipeline：每次 Run 只创建一条
 *     MonitorTask（runs = 启用的 BenchmarkQuery 镜像 × 所选 Engine），
 *     Evidence / Analysis 仍由既有 Worker 写入 —— Evidence 是唯一事实源。
 *   - 语义快照：Run 创建瞬间把启用查询的完整语义复制进 BenchmarkRunQuery
 *     （queryText/category/intent/locale/weight/sortOrder/sanity + 源 id）；
 *     历史报告只读快照 → 未来编辑 Suite/Query 不改变历史 Run 的语义与指标，
 *     要换语义必须新建 suite 版本（v2）。
 *   - demo 只允许 mock provider；real 只允许 deepseek provider 且受
 *     REAL_PROVIDER_MAX_RUNS_PER_TASK 上限保护（plannedRuns > cap 直接拒绝）。
 *   - 指标聚合复用 geolens-v1 aggregateMetrics，不发明第二套指标；报告按
 *     overall / category / query 三级聚合。
 */

const RUN_ANALYSIS_VERSION = "m4-rule-v1";
type JsonValue = Prisma.InputJsonValue;

interface MetricsMention {
  entityType: string; entityId: string; canonicalName: string; displayName: string;
  position: number; context: string; sentiment: string; startOffset: number; endOffset: number;
}
interface MetricsCitation { url: string; domain: string; title: string | null; position: number }
interface MetricsAnalysis {
  analysisVersion: string; brandMentioned: boolean; mentionPosition: number | null;
  recommended: boolean; sentiment: string; mentions: MetricsMention[]; citations: MetricsCitation[];
}
interface MetricsPoolRun {
  status: string;
  engineProvider: string;
  benchmarkQueryId: string | null;
  category: string | null;
  intent: string | null;
  queryText: string | null;
  sortOrder: number | null;
  sanity: boolean;
  analysis: MetricsAnalysis | null;
}

function toAnalysisOutput(analysis: MetricsAnalysis | null): AnalysisOutput | null {
  if (!analysis) return null;
  return {
    analysisVersion: analysis.analysisVersion,
    brandMentioned: analysis.brandMentioned,
    mentionPosition: analysis.mentionPosition,
    recommended: analysis.recommended,
    sentiment: analysis.sentiment as Sentiment,
    mentions: analysis.mentions.map(mention => ({
      entityType: mention.entityType as "brand" | "competitor",
      entityId: mention.entityId, canonicalName: mention.canonicalName, displayName: mention.displayName,
      position: mention.position, context: mention.context, sentiment: mention.sentiment as Sentiment,
      startOffset: mention.startOffset, endOffset: mention.endOffset,
    })),
    citations: analysis.citations,
  };
}

@Injectable()
export class BenchmarkService implements OnModuleDestroy {
  private queue?: ReturnType<typeof createRunQueue>;
  private dispatching?: Promise<void>;

  constructor(
    private readonly db: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  // ---------------------------------------------------------------
  // Suites
  // ---------------------------------------------------------------

  async listSuites(userId: string, projectId: string) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    const suites = await this.db.client.benchmarkSuite.findMany({
      where: { projectId: project.id },
      include: { queries: { orderBy: { sortOrder: "asc" } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return suites.map(suite => this.presentSuite(suite));
  }

  async getSuite(userId: string, id: string) {
    const suite = await this.suiteForUser(userId, id);
    return this.presentSuite(suite);
  }

  async createSuite(userId: string, projectId: string, dto: CreateBenchmarkSuiteDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    const existing = await this.db.client.benchmarkSuite.findUnique({
      where: { projectId_name_version: { projectId: project.id, name: dto.name, version: dto.version } },
    });
    if (existing) {
      throw new BadRequestException(`Benchmark Suite「${dto.name} v${dto.version}」已存在；请递增 version 或改名。`);
    }
    // 排序：显式 sortOrder 或按数组顺序；重复 sortOrder / queryText 直接拒绝。
    const byOrder = new Map<number, number>();
    const seenText = new Set<string>();
    for (const [index, query] of dto.queries.entries()) {
      const order = query.sortOrder ?? index;
      if (byOrder.has(order)) throw new BadRequestException(`queries 中存在重复 sortOrder=${order}`);
      byOrder.set(order, index);
      if (seenText.has(query.queryText)) throw new BadRequestException(`queries 中存在重复 queryText：${query.queryText}`);
      seenText.add(query.queryText);
    }
    const querySetName = `Benchmark Auto: ${dto.name} v${dto.version}`;

    const suite = await this.db.client.$transaction(async tx => {
      const querySet = await tx.querySet.upsert({
        where: { projectId_name: { projectId: project.id, name: querySetName } },
        update: {},
        create: { projectId: project.id, name: querySetName, description: "Benchmark 自动镜像查询（status=PAUSED，仅供 Benchmark Run 内部使用）" },
      });
      return tx.benchmarkSuite.create({
        data: {
          projectId: project.id, name: dto.name, version: dto.version,
          description: dto.description ?? null,
          queries: { create: dto.queries.map((query, index) => ({
            queryText: query.queryText, category: query.category, intent: query.intent,
            locale: query.locale ?? "zh-CN", weight: query.weight ?? 1,
            enabled: query.enabled ?? true, sanity: query.sanity ?? false,
            sortOrder: query.sortOrder ?? index,
            // 同步镜像一条项目 Query（PAUSED + IMPORTED），供既有 Run 管线引用。
            projectQuery: { create: {
              projectId: project.id, querySetId: querySet.id, text: query.queryText,
              type: "CUSTOM", source: "IMPORTED", status: "PAUSED", language: query.locale ?? "zh-CN", region: "cn",
            } },
          })) },
        },
        include: { queries: { orderBy: { sortOrder: "asc" } } },
      });
    });
    return this.presentSuite(suite);
  }

  // ---------------------------------------------------------------
  // Runs
  // ---------------------------------------------------------------

  async startRun(userId: string, suiteId: string, dto: StartBenchmarkRunDto) {
    const suite = await this.suiteForUser(userId, suiteId);
    const enabledQueries = suite.queries.filter(query => query.enabled && query.projectQueryId);
    if (enabledQueries.length === 0) {
      throw new BadRequestException("该 Suite 没有可执行的启用查询（缺少 projectQueryId 镜像）");
    }
    const engine = await this.db.client.engine.findFirst({ where: { id: dto.engineId, enabled: true } });
    if (!engine) throw new BadRequestException("Engine 不存在或已停用");

    const real = dto.runType === "real";
    if (real) {
      if (engine.provider !== "deepseek") throw new BadRequestException("Real Run 只能使用 DeepSeek Provider 引擎");
      const presentation = enginePresentation(engine.provider, engine.config, process.env);
      if (!presentation.configured) {
        throw new BadRequestException("DeepSeek Provider 未配置或未启用（需 ENABLE_REAL_PROVIDERS=true 且配置 DEEPSEEK_API_KEY）。");
      }
    } else if (engine.provider !== "mock") {
      throw new BadRequestException("Demo Run 只能使用 Mock 引擎（模拟数据，不产生真实调用）");
    }

    const plannedRuns = enabledQueries.length; // M6A 单 Provider：queries × 1 engine
    if (real) {
      const cap = readRealProviderEnv(process.env).realProviderMaxRunsPerTask;
      if (plannedRuns > cap) {
        throw new BadRequestException(
          `Benchmark Real Run 计划 ${plannedRuns} 次真实调用（${enabledQueries.length} queries × 1 provider），` +
          `超过 REAL_PROVIDER_MAX_RUNS_PER_TASK=${cap} 上限。请提高上限并显式确认后重试；M6A 默认只跑 Mock/Demo。`,
        );
      }
    }
    const suiteProject = suite.project;
    const created = await this.db.client.$transaction(async tx => {
      const monitorTask = await tx.monitorTask.create({
        data: {
          organizationId: suiteProject.organizationId, projectId: suiteProject.id,
          totalRuns: plannedRuns,
          runs: { create: enabledQueries.map(query => ({ queryId: query.projectQueryId!, engineId: engine.id })) },
        },
      });
      const benchmarkRun = await tx.benchmarkRun.create({
        data: {
          organizationId: suiteProject.organizationId, projectId: suiteProject.id,
          suiteId: suite.id, suiteName: suite.name, suiteVersion: suite.version,
          runType: real ? "REAL" : "DEMO", provider: engine.provider, engineId: engine.id,
          monitorTaskId: monitorTask.id, plannedRuns,
          status: "PENDING",
          metadata: { engineKey: engine.key } as JsonValue,
          // 语义快照：复制每个启用 query 的完整语义（queryText/category/intent/
          // locale/weight/sortOrder/sanity）。历史报告只读快照 → 未来编辑 Suite/
          // Query 不影响已创建 Run 的语义与指标（版本化不可变性）。
          runQueries: { create: enabledQueries.map(query => ({
            benchmarkQueryId: query.id, projectQueryId: query.projectQueryId!,
            queryText: query.queryText, category: query.category, intent: query.intent,
            locale: query.locale, weight: query.weight,
            sortOrder: query.sortOrder, sanity: query.sanity,
          })) },
        },
      });
      return { benchmarkRun };
    });
    console.log(JSON.stringify({
      event: "benchmark_run_created", runId: created.benchmarkRun.id,
      suite: suite.name, suiteVersion: suite.version, runType: dto.runType,
      provider: engine.provider, plannedRuns,
    }));
    this.kickDispatch();
    return this.getRun(userId, created.benchmarkRun.id);
  }

  async getRun(userId: string, id: string) {
    const run = await this.db.client.benchmarkRun.findFirst({
      where: { id, organization: { members: { some: { userId } } } },
      include: {
        suite: { select: { id: true, name: true, version: true } },
        engine: { select: { id: true, key: true, name: true, provider: true } },
        monitorTask: { include: { runs: { include: { query: { select: { id: true, text: true } } } } } },
      },
    });
    if (!run) throw new NotFoundException("Benchmark Run 不存在或无权访问");
    // 版本化不可变性：语义只来自 Run 创建时的快照行，绝不 live-join 当前
    // BenchmarkQuery（suite/query 未来被编辑不改变历史 Run 的解释）。
    const snapRows = await this.db.client.benchmarkRunQuery.findMany({
      where: { benchmarkRunId: run.id },
      orderBy: { sortOrder: "asc" },
    });
    const byProjectQuery = new Map(snapRows.map(query => [query.projectQueryId, query]));
    const task = run.monitorTask;
    const taskRuns = task.runs.map(runRow => {
      const bench = byProjectQuery.get(runRow.queryId);
      return {
        id: runRow.id, status: runRow.status, attempt: runRow.attempt,
        errorCode: runRow.errorCode, errorMessage: runRow.errorMessage,
        analysisStatus: runRow.analysisStatus, analysisErrorCode: runRow.analysisErrorCode,
        queryId: runRow.queryId, queryText: bench?.queryText ?? runRow.query.text,
        benchmarkQueryId: bench?.benchmarkQueryId ?? null, category: bench?.category ?? null,
        intent: bench?.intent ?? null, sortOrder: bench?.sortOrder ?? null, sanity: bench?.sanity ?? false,
      };
    });
    taskRuns.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const done = ["SUCCEEDED", "FAILED", "PARTIAL", "CANCELLED"].includes(task.status);
    return {
      id: run.id, runType: run.runType, provider: run.provider,
      suite: { id: run.suite.id, name: run.suiteName, version: run.suiteVersion },
      engine: run.engine,
      status: task.status, plannedRuns: task.totalRuns,
      completedRuns: task.completedRuns, failedRuns: task.failedRuns,
      succeededRuns: taskRuns.filter(row => row.status === "SUCCEEDED").length,
      analyzedRuns: taskRuns.filter(row => row.analysisStatus === "SUCCEEDED").length,
      progress: task.totalRuns ? Math.round(100 * (task.completedRuns + task.failedRuns) / task.totalRuns) : 0,
      terminal: done, metricReady: done,
      createdAt: run.createdAt, startedAt: task.startedAt, completedAt: task.completedAt,
      runs: taskRuns,
    };
  }

  async getMetrics(userId: string, id: string, analysisVersion = RUN_ANALYSIS_VERSION) {
    const run = await this.db.client.benchmarkRun.findFirst({
      where: { id, organization: { members: { some: { userId } } } },
      include: {
        suite: { select: { id: true, name: true, version: true } },
        monitorTask: { include: { runs: { include: {
          engine: { select: { provider: true } },
          query: { select: { id: true, text: true } },
          evidence: { select: { analyses: {
            where: { analysisVersion },
            include: { mentions: true, citations: true },
          } } },
        } } } },
      },
    });
    if (!run) throw new NotFoundException("Benchmark Run 不存在或无权访问");
    // 同 getRun：指标聚合只消费 Run 创建时的快照语义，绝不读当前 BenchmarkQuery。
    const snapRows = await this.db.client.benchmarkRunQuery.findMany({
      where: { benchmarkRunId: run.id },
      orderBy: { sortOrder: "asc" },
    });
    const byProjectQuery = new Map(snapRows.map(query => [query.projectQueryId, query]));

    const rows: MetricsPoolRun[] = run.monitorTask.runs.map(runRow => {
      const bench = byProjectQuery.get(runRow.queryId);
      const analysis = runRow.evidence?.analyses[0];
      return {
        status: runRow.status, engineProvider: runRow.engine.provider,
        benchmarkQueryId: bench?.benchmarkQueryId ?? null,
        category: bench?.category ?? null, intent: bench?.intent ?? null,
        queryText: bench?.queryText ?? runRow.query.text,
        sortOrder: bench?.sortOrder ?? null,
        sanity: bench?.sanity ?? false,
        analysis: analysis ? {
          analysisVersion: analysis.analysisVersion,
          brandMentioned: analysis.brandMentioned,
          mentionPosition: analysis.mentionPosition,
          recommended: analysis.recommended,
          sentiment: analysis.sentiment,
          mentions: analysis.mentions,
          citations: analysis.citations,
        } : null,
      };
    });

    // demo/real 隔离（M5 语义）：mixed 时仅 real 子集为 Real Benchmark。
    const realRows = rows.filter(row => row.engineProvider !== "mock");
    const metricSource = realRows.length === 0 ? "demo"
      : realRows.length === rows.length ? "real" : "mixed";
    const pool = realRows.length > 0 ? realRows : rows;

    const aggregate = (subset: MetricsPoolRun[]): MetricsOutput => aggregateMetrics({
      analysisVersion,
      runs: subset.map(row => ({ status: row.status, analysis: toAnalysisOutput(row.analysis) })),
    });

    const overall = aggregate(pool);
    const mentionedInPool = pool.filter(row => {
      const a = row.analysis;
      return row.status === "SUCCEEDED" && a?.analysisVersion === analysisVersion && a.brandMentioned;
    }).length;

    const categories = new Map<string, { eligible: number; mentioned: number }>();
    const byQuery = pool
      .filter(row => {
        // sanity 以 Run 创建时的快照语义为准（不随当前 Suite 编辑漂移）
        if (!row.benchmarkQueryId || row.sanity) return false;
        return true;
      })
      .map(row => {
        const eligible = row.status === "SUCCEEDED" && row.analysis?.analysisVersion === analysisVersion;
        const rowCategory = row.category;
        if (rowCategory) {
          const entry = categories.get(rowCategory) ?? { eligible: 0, mentioned: 0 };
          if (eligible) {
            entry.eligible += 1;
            if (row.analysis!.brandMentioned) entry.mentioned += 1;
          }
          categories.set(rowCategory, entry);
        }
        const a = eligible ? row.analysis! : null;
        return {
          benchmarkQueryId: row.benchmarkQueryId, queryText: row.queryText,
          category: row.category, intent: row.intent,
          sortOrder: row.sortOrder,
          status: row.status,
          analyzed: eligible,
          brandMentioned: a?.brandMentioned ?? null,
          recommended: a?.recommended ?? null,
          mentionPosition: a?.mentionPosition ?? null,
          sentiment: a?.sentiment ?? null,
          citationCount: a?.citations.length ?? null,
        };
      });
    const byCategory: Array<{ category: string; queryEligibleCount: number; queryMentionedCount: number; metrics: MetricsOutput }> = [];
    for (const [category, counts] of categories) {
      const subset = pool.filter(row => row.category === category);
      byCategory.push({
        category,
        queryEligibleCount: counts.eligible,
        queryMentionedCount: counts.mentioned,
        metrics: aggregate(subset),
      });
    }
    byCategory.sort((a, b) => a.category.localeCompare(b.category));

    return {
      metricVersion: METRIC_VERSION,
      analysisVersion,
      metricSource,
      suite: { id: run.suite.id, name: run.suiteName, version: run.suiteVersion },
      // M6B 前竞对集为开发占位，SoV 不作对外结论。
      competitorScope: {
        status: "pending-m6b",
        note: "competitor set pending M6B — 当前竞对为开发占位，Share of Voice 仅限内部参考",
      },
      overall: { ...overall, queryEligibleCount: overall.analyzedRuns, queryMentionedCount: mentionedInPool },
      byCategory,
      byQuery,
    };
  }

  // ---------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------

  /** 校验 suite 归属（含 project 信息），加载其全部查询。 */
  private async suiteForUser(userId: string, suiteId: string) {
    const suite = await this.db.client.benchmarkSuite.findUnique({
      where: { id: suiteId },
      include: {
        project: { select: { id: true, organizationId: true } },
        queries: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!suite) throw new NotFoundException("Benchmark Suite 不存在或无权访问");
    await this.tenant.assertUserInOrganization(userId, suite.project.organizationId);
    return suite;
  }

  private presentSuite(suite: {
    id: string; name: string; version: string; description: string | null;
    status: string; createdAt: Date; updatedAt: Date;
    queries: Array<{ id: string; queryText: string; category: string; intent: string; sortOrder: number; enabled: boolean; sanity: boolean }>;
  }) {
    const categoryCounts = new Map<string, number>();
    for (const query of suite.queries) {
      if (!query.enabled || query.sanity) continue;
      categoryCounts.set(query.category, (categoryCounts.get(query.category) ?? 0) + 1);
    }
    const enabled = suite.queries.filter(query => query.enabled && !query.sanity).length;
    return {
      id: suite.id, name: suite.name, version: suite.version,
      description: suite.description, status: suite.status,
      queryCount: enabled,
      sanityQueryCount: suite.queries.filter(query => query.sanity).length,
      categoryCounts: Object.fromEntries(categoryCounts),
      createdAt: suite.createdAt, updatedAt: suite.updatedAt,
      queries: suite.queries.map(query => ({
        id: query.id, queryText: query.queryText, category: query.category,
        intent: query.intent, sortOrder: query.sortOrder, enabled: query.enabled, sanity: query.sanity,
      })),
    };
  }

  private kickDispatch() {
    if (this.dispatching) return;
    if (!this.queue) {
      this.queue = createRunQueue();
      this.queue.on("error", () => console.error(JSON.stringify({ event: "queue_error", error: "REDIS_UNAVAILABLE" })));
    }
    this.dispatching = dispatchPendingRuns(this.db.client, this.queue)
      .then(() => undefined)
      .catch(() => console.error(JSON.stringify({ event: "enqueue_deferred", error: "REDIS_UNAVAILABLE" })))
      .finally(() => { this.dispatching = undefined; });
  }

  async onModuleDestroy() {
    await this.dispatching;
    await this.queue?.close();
  }
}
