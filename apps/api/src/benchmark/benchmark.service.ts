import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy } from "@nestjs/common";
import { createRunQueue, dispatchPendingRuns } from "@geo/queue";
import {
  aggregateMetrics, METRIC_VERSION, computeMetricScope, isMetricEligible,
  detectTargetContamination,
  type AnalysisOutput, type MetricScopeResult, type MetricsOutput, type Sentiment,
} from "@geo/core";
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
  queryType: string | null;
  contamination: { status?: string } | null;
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
    // queries 允许缺省/空：新建空 Query Set（后续经 suite 详情页追加问题）也是合法流程。
    const queries = dto.queries ?? [];
    // M8E：createSuite 也执行 Target Contamination Guard —— primary Brand 即监测对象；
    // DISCOVERY query 含目标 ⇒ 400（会虚高自然可见度）。无 target 时跳过（无法判断）。
    const primaryBrand = (await this.db.client.brand.findMany({
      where: { projectId: project.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 1,
    }))[0] ?? null;
    const targetIdentity = primaryBrand
      ? { canonicalName: primaryBrand.name, aliases: primaryBrand.aliases }
      : null;
    for (const [index, query] of queries.entries()) {
      const queryType = query.queryType ?? (query.sanity === true ? "BRANDED_SANITY" : null);
      if (queryType === "DISCOVERY" && targetIdentity) {
        const c = detectTargetContamination(query.queryText, targetIdentity);
        if (c.status === "TARGET_MENTIONED") {
          throw new BadRequestException(`Query「${query.queryText.slice(0, 60)}…」含监测对象「${primaryBrand.name}」——自然发现问题不能包含品牌名（会虚高可见度）。请改为 BRANDED_SANITY（品牌认知测试）或移除品牌名。`);
        }
      }
    }
    // 排序：显式 sortOrder 或按数组顺序；重复 sortOrder / queryText 直接拒绝。
    const byOrder = new Map<number, number>();
    const seenText = new Set<string>();
    for (const [index, query] of queries.entries()) {
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
          queries: { create: queries.map((query, index) => {
            // M8E：queryType 显式语义（DISCOVERY / BRANDED_SANITY / CUSTOM）。
            // legacy 兼容：不传 queryType 时按 sanity 推导（sanity=true ⇒ BRANDED_SANITY；
            // 否则保持 null=legacy，由 metrics 端按 sanity 口径解释，避免历史语义漂移）。
            const queryType = query.queryType
              ?? (query.sanity === true ? "BRANDED_SANITY" : null);
            const sanity = query.sanity ?? (queryType === "BRANDED_SANITY");
            const source = query.source ?? "MANUAL";
            return {
              queryText: query.queryText, category: query.category, intent: query.intent,
              locale: query.locale ?? "zh-CN", weight: query.weight ?? 1,
              enabled: query.enabled ?? true, sanity,
              sortOrder: query.sortOrder ?? index,
              queryType, source,
              // 同步镜像一条项目 Query（PAUSED + IMPORTED），供既有 Run 管线引用。
              projectQuery: { create: {
                projectId: project.id, querySetId: querySet.id, text: query.queryText,
                type: "CUSTOM", source: "IMPORTED", status: "PAUSED", language: query.locale ?? "zh-CN", region: "cn",
              } },
            };
          }) },
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
    // M6D：第二 Provider（qwen）与 deepseek 同走 Real Run；配置未就绪直接拒绝（不产生调用）。
    const REAL_PROVIDERS = new Set(["deepseek", "qwen"]);
    if (real) {
      if (!REAL_PROVIDERS.has(engine.provider)) {
        throw new BadRequestException("Real Run 只能使用 DeepSeek / Qwen（通义千问）Provider 引擎");
      }
      const presentation = enginePresentation(engine.provider, engine.config, process.env);
      if (!presentation.configured) {
        const providerLabel = engine.provider === "qwen" ? "Qwen（通义千问）" : "DeepSeek";
        throw new BadRequestException(
          `${providerLabel} Provider 未配置或未启用（需 ENABLE_REAL_PROVIDERS=true 且配置对应 API Key）。`,
        );
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
    // M8E：冻结本次 Run 的 target 实体快照（canonicalName/aliases/entityType/
    // productCategory/website）——来自项目 primary Brand。Evidence.entitySnapshot
    // 另有同源冻结；此处供 Run/Report/Matrix 级追溯。
    const primaryBrand = (await this.db.client.brand.findMany({
      where: { projectId: suiteProject.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 1,
      select: { name: true, aliases: true, entityType: true, productCategory: true, website: true },
    }))[0] ?? null;
    const targetSnapshot = primaryBrand ? {
      canonicalName: primaryBrand.name,
      aliases: primaryBrand.aliases,
      entityType: primaryBrand.entityType,
      productCategory: primaryBrand.productCategory,
      website: primaryBrand.website,
    } : null;

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
          targetSnapshot: targetSnapshot ? JSON.parse(JSON.stringify(targetSnapshot)) as JsonValue : undefined,
          // 语义快照：复制每个启用 query 的完整语义（queryText/category/intent/
          // locale/weight/sortOrder/sanity + M8E queryType/contamination）。
          // 历史报告只读快照 → 未来编辑 Suite/Query 不影响已创建 Run 的语义与指标。
          runQueries: { create: enabledQueries.map(query => ({
            benchmarkQueryId: query.id, projectQueryId: query.projectQueryId!,
            queryText: query.queryText, category: query.category, intent: query.intent,
            locale: query.locale, weight: query.weight,
            sortOrder: query.sortOrder, sanity: query.sanity,
            queryType: query.queryType ?? null,
            contamination: query.contamination ? JSON.parse(JSON.stringify(query.contamination)) as JsonValue : undefined,
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
        queryType: bench?.queryType ?? null,
      };
    });
    taskRuns.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const done = ["SUCCEEDED", "FAILED", "PARTIAL", "CANCELLED"].includes(task.status);
    return {
      id: run.id, runType: run.runType, provider: run.provider,
      suite: { id: run.suite.id, name: run.suiteName, version: run.suiteVersion },
      engine: run.engine,
      targetSnapshot: (run.targetSnapshot ?? null) as Record<string, unknown> | null,
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
        queryType: bench?.queryType ?? null,
        contamination: (bench?.contamination ?? null) as { status?: string } | null,
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
    // M8C-R0：manual-web-ui provider='manual' 代表人工采集（不等于自动真实调用）；
    // 归边以 BenchmarkRun.runType 为准（demo manual → demo 侧；real manual → real 侧）。
    const realRows = rows.filter(row =>
      row.engineProvider !== "mock"
      && !(row.engineProvider === "manual" && run.runType === "DEMO"));
    const metricSource = realRows.length === 0 ? "demo"
      : realRows.length === rows.length ? "real" : "mixed";
    const pool = realRows.length > 0 ? realRows : rows;

    // M8E metrics scope：主指标只消费 DISCOVERY（+ 非品牌 CUSTOM），
    // BRANDED_SANITY / 含目标的未确认 CUSTOM / legacy sanity 一律不入 denominator。
    const eligiblePool = pool.filter(row => isMetricEligible(row));
    const scope: MetricScopeResult = computeMetricScope(
      snapRows.map(q => ({ queryType: q.queryType ?? null, sanity: q.sanity, contamination: q.contamination as { status?: string } | null })),
    );

    const aggregate = (subset: MetricsPoolRun[]): MetricsOutput => aggregateMetrics({
      analysisVersion,
      runs: subset.map(row => ({ status: row.status, analysis: toAnalysisOutput(row.analysis) })),
    });

    const overall = aggregate(eligiblePool);
    const mentionedInPool = eligiblePool.filter(row => {
      const a = row.analysis;
      return row.status === "SUCCEEDED" && a?.analysisVersion === analysisVersion && a.brandMentioned;
    }).length;

    const categories = new Map<string, { eligible: number; mentioned: number }>();
    const byQuery = eligiblePool
      .filter(row => row.benchmarkQueryId)
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
          queryType: row.queryType,
          sanity: row.sanity,
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
      const subset = eligiblePool.filter(row => row.category === category);
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
      targetSnapshot: (run.targetSnapshot ?? null) as Record<string, unknown> | null,
      // M6B 前竞对集为开发占位，SoV 不作对外结论。
      competitorScope: {
        status: "pending-m6b",
        note: "competitor set pending M6B — 当前竞对为开发占位，Share of Voice 仅限内部参考",
      },
      // M8E：denominator 可审计 —— 核心 GEO 指标基于多少 eligible queries、排除多少 sanity。
      // 顶层 metricQueryScope/eligibleQueryCount = 快照口径（enabled 非 sanity 的 query 数）；
      // overall.queryEligibleCount 保持历史语义 = analyzedRuns（成功且已分析，含 demo/real 子集），
      // 两者并存：scope 字段用于审计 denominator 构成，overall 字段用于历史兼容。
      metricQueryScope: scope.metricQueryScope,
      metricScopeQueryCount: scope.eligibleQueryCount,
      excludedQueryCount: scope.excludedQueryCount,
      excludedSanityCount: scope.excludedSanityCount,
      excludedContaminatedCount: scope.excludedContaminatedCount,
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
    projectId: string; id: string; name: string; version: string; description: string | null;
    status: string; createdAt: Date; updatedAt: Date;
    queries: Array<{
      id: string; queryText: string; category: string; intent: string; sortOrder: number;
      enabled: boolean; sanity: boolean; queryType: string | null; source: string | null;
      contamination: Prisma.JsonValue | null; locale: string;
    }>;
  }) {
    const categoryCounts = new Map<string, number>();
    for (const query of suite.queries) {
      if (!query.enabled || query.sanity) continue;
      categoryCounts.set(query.category, (categoryCounts.get(query.category) ?? 0) + 1);
    }
    const effectiveType = (q: { queryType: string | null; sanity: boolean }) => q.queryType ?? (q.sanity ? "BRANDED_SANITY" : null);
    const enabled = suite.queries.filter(query => query.enabled && !query.sanity).length;
    return {
      projectId: suite.projectId, id: suite.id, name: suite.name, version: suite.version,
      description: suite.description, status: suite.status,
      queryCount: enabled,
      discoveryCount: suite.queries.filter(query => query.enabled && effectiveType(query) === "DISCOVERY").length,
      sanityQueryCount: suite.queries.filter(query => query.sanity || effectiveType(query) === "BRANDED_SANITY").length,
      customCount: suite.queries.filter(query => query.enabled && effectiveType(query) === "CUSTOM").length,
      categoryCounts: Object.fromEntries(categoryCounts),
      createdAt: suite.createdAt, updatedAt: suite.updatedAt,
      queries: suite.queries.map(query => ({
        id: query.id, queryText: query.queryText, category: query.category,
        intent: query.intent, sortOrder: query.sortOrder, enabled: query.enabled, sanity: query.sanity,
        queryType: effectiveType(query), source: query.source,
        contamination: query.contamination, locale: query.locale,
      })),
    };
  }

  // ---------------------------------------------------------------
  // Frozen Snapshot Re-run（M7D：受控复测，杜绝 Re-test Query Drift）
  // ---------------------------------------------------------------
  /**
   * 从历史 BenchmarkRun 的 BenchmarkRunQuery 快照再跑一轮（same queryText/category/
   * intent/locale/weight/sanity/sortOrder）。绝不静默读取后来编辑过的当前
   * BenchmarkQuery —— 每轮复测为 snapshot 语义新建镜像 Query 行（PAUSED/IMPORTED），
   * 然后仍走既有 MonitorTask → Run → Queue → Worker → Evidence → Analysis 管线。
   * @param sourceRunId 基线 BenchmarkRun（其 runQueries 即 frozen query set）
   */
  async startRunFromSnapshot(userId: string, sourceRunId: string, dto: { engineId: string; runType: 'demo' | 'real' }) {
    const source = await this.db.client.benchmarkRun.findFirst({
      where: { id: sourceRunId, organization: { members: { some: { userId } } } },
      select: { id: true, projectId: true, suiteId: true, suiteName: true, suiteVersion: true, organizationId: true },
    });
    if (!source) throw new NotFoundException("基线 Benchmark Run 不存在或无权访问");

    const snapRows = await this.db.client.benchmarkRunQuery.findMany({
      where: { benchmarkRunId: source.id },
      orderBy: { sortOrder: 'asc' },
    });
    if (snapRows.length === 0) {
      throw new BadRequestException("基线没有可复用的冻结测试问题快照，无法保证与基线口径一致（拒绝复测）");
    }

    const engine = await this.db.client.engine.findFirst({ where: { id: dto.engineId, enabled: true } });
    if (!engine) throw new BadRequestException("Engine 不存在或已停用");

    const real = dto.runType === 'real';
    const REAL_PROVIDERS = new Set(['deepseek', 'qwen']);
    if (real) {
      if (!REAL_PROVIDERS.has(engine.provider)) {
        throw new BadRequestException("Real Run 只能使用 DeepSeek / Qwen（通义千问）Provider 引擎");
      }
      const presentation = enginePresentation(engine.provider, engine.config, process.env);
      if (!presentation.configured) {
        const providerLabel = engine.provider === 'qwen' ? 'Qwen（通义千问）' : 'DeepSeek';
        throw new BadRequestException(`${providerLabel} Provider 未配置或未启用（需 ENABLE_REAL_PROVIDERS=true 且配置对应 API Key）。`);
      }
    } else if (engine.provider !== 'mock') {
      throw new BadRequestException("Demo Run 只能使用 Mock 引擎（模拟数据，不产生真实调用）");
    }

    const plannedRuns = snapRows.length; // frozen queries × 1 provider
    if (real) {
      const cap = readRealProviderEnv(process.env).realProviderMaxRunsPerTask;
      if (plannedRuns > cap) {
        throw new BadRequestException(
          `Frozen Re-test Real Run 计划 ${plannedRuns} 次真实调用（${snapRows.length} queries × 1 provider），` +
          `超过 REAL_PROVIDER_MAX_RUNS_PER_TASK=${cap} 上限。请提高上限并显式确认后重试。`,
        );
      }
    }

    const created = await this.db.client.$transaction(async tx => {
      // 为每个 snapshot 语义新建镜像 Query（保证文本 = 冻结快照，不受当前 Query 编辑影响）
      const mirrorQueries: Array<{ id: string }> = [];
      for (const row of snapRows) {
        mirrorQueries.push(await tx.query.create({
          data: {
            projectId: source.projectId, text: row.queryText,
            type: 'CUSTOM', source: 'IMPORTED', status: 'PAUSED', language: row.locale ?? 'zh-CN', region: 'cn',
          },
        }));
      }
      const monitorTask = await tx.monitorTask.create({
        data: {
          organizationId: source.organizationId, projectId: source.projectId,
          totalRuns: plannedRuns,
          runs: { create: snapRows.map((row, index) => ({ queryId: mirrorQueries[index].id, engineId: engine.id })) },
        },
      });

      // M8E：frozen retest 冻结 target 快照（复测对象须与基线一致 —— 取当前 primary Brand）
      const primaryBrand = (await this.db.client.brand.findMany({
        where: { projectId: source.projectId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 1,
        select: { name: true, aliases: true, entityType: true, productCategory: true, website: true },
      }))[0] ?? null;
      const targetSnapshot = primaryBrand ? {
        canonicalName: primaryBrand.name,
        aliases: primaryBrand.aliases,
        entityType: primaryBrand.entityType,
        productCategory: primaryBrand.productCategory,
        website: primaryBrand.website,
      } : null;

      const benchmarkRun = await tx.benchmarkRun.create({
        data: {
          organizationId: source.organizationId, projectId: source.projectId,
          suiteId: source.suiteId, suiteName: source.suiteName, suiteVersion: source.suiteVersion,
          runType: real ? 'REAL' : 'DEMO', provider: engine.provider, engineId: engine.id,
          monitorTaskId: monitorTask.id, plannedRuns,
          status: 'PENDING',
          metadata: { engineKey: engine.key, frozenFromRunId: source.id, frozenRetest: true } as JsonValue,
          targetSnapshot: targetSnapshot ? JSON.parse(JSON.stringify(targetSnapshot)) as JsonValue : undefined,
          runQueries: { create: snapRows.map((row, index) => ({
            benchmarkQueryId: row.benchmarkQueryId,
            // projectQueryId 指向本复测新建的镜像 Query（getRun/metrics 经其对齐快照语义）
            projectQueryId: mirrorQueries[index].id,
            queryText: row.queryText, category: row.category, intent: row.intent,
            locale: row.locale, weight: row.weight, sortOrder: row.sortOrder, sanity: row.sanity,
            queryType: row.queryType ?? null,
            contamination: row.contamination ? JSON.parse(JSON.stringify(row.contamination)) as JsonValue : undefined,
          })) },
        },
      });
      return benchmarkRun;
    });

    console.log(JSON.stringify({
      event: 'frozen_retest_run_created', runId: created.id, sourceRunId: source.id,
      runType: dto.runType, provider: engine.provider, plannedRuns,
    }));
    this.kickDispatch();
    return this.getRun(userId, created.id);
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
