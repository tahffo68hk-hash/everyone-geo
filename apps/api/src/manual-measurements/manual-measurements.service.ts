import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ANALYSIS_VERSION, analyzeResponse, type Entity, type StructuredCitation } from "@geo/core";
import { PrismaService } from "../prisma.service";
import { TenantService } from "../common/tenant.service";
import type { CreateManualBenchmarkDto, SubmitManualEvidenceDto } from "./dto/manual-measurements.dto";

/**
 * M8C-R0 Manual Verified Measurement。
 *
 * 产品语义：
 *   1) 人工 Web UI 测量复用完整 BenchmarkRun → MonitorTask → Run → Evidence →
 *      Analysis → Metrics → Report 链路（不建第二套 ManualEvidence 平行体系）。
 *   2) 安全隔离：manual run 初始 status=AWAITING_MANUAL_INPUT（新 enum），worker
 *      dispatchPendingRuns/reconcileRuns 只捞 PENDING/QUEUED/RUNNING → 永不入队、
 *      永不调用 provider。engine=manual-web-ui（provider='manual'，worker registry
 *      无法解析 → 即使误入队也 UNSUPPORTED_PROVIDER 双保险）。
 *   3) Evidence immutable 契约继续成立：用户提交后同普通 Evidence，禁止 UPDATE；
 *      录错 → 新建 replacement Run/Evidence。
 *   4) 判定：retrievalConfirmed=false → retrievalMode=unknown（绝不 manual_verified）；
 *      =true 且提供 verificationSignals → manual_verified。
 *   5) 用户只提交原始观测事实；Mention/Recommendation/Position/Sentiment/Citation
 *      由 analyzeResponse（与 automated Evidence 同一 analyzer）本地确定性生成。
 */
@Injectable()
export class ManualMeasurementsService {
  constructor(
    private readonly db: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  private async manualEngine() {
    const key = "manual-web-ui";
    return this.db.client.engine.upsert({
      where: { key },
      update: {},
      create: {
        key,
        name: "人工 Web UI",
        provider: "manual", // 故意不进 worker registry：永不自动执行
        config: { manual: true } as object,
        enabled: true,
      },
    });
  }

  /** 冻结 Entity 快照（brands[0] + enabled aliases + competitors）——与分析 automated 同源。 */
  private async snapshotEntities(projectId: string): Promise<Entity[]> {
    const [brands, competitors] = await Promise.all([
      this.db.client.brand.findMany({
        where: { projectId },
        include: { aliasesDetailed: { where: { enabled: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      this.db.client.competitor.findMany({ where: { projectId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    ]);
    return [
      ...brands.slice(0, 1).map(row => ({
        id: row.id,
        canonicalName: row.name,
        aliases: [...new Set([...row.aliases, ...row.aliasesDetailed.map(a => a.alias)])],
        entityType: "brand" as const,
      })),
      ...competitors.map(row => ({ id: row.id, canonicalName: row.name, aliases: row.aliases, entityType: "competitor" as const })),
    ];
  }

  // ---------------------------------------------------------------
  // 1) 创建 Manual Benchmark Run（复用 BenchmarkRun/Run，不进 queue）
  // ---------------------------------------------------------------

  async createManualBenchmark(userId: string, suiteId: string, dto: CreateManualBenchmarkDto) {
    const suite = await this.db.client.benchmarkSuite.findUnique({
      where: { id: suiteId },
      include: {
        project: { select: { id: true, organizationId: true } },
        queries: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!suite) throw new NotFoundException("Query Set 不存在");
    await this.tenant.assertUserInOrganization(userId, suite.project.organizationId);
    const project = suite.project;

    const selected = dto.queryIds && dto.queryIds.length > 0
      ? suite.queries.filter(q => dto.queryIds!.includes(q.id))
      : suite.queries;
    const enabledQueries = selected.filter(q => q.enabled && q.projectQueryId);
    if (enabledQueries.length === 0) {
      throw new BadRequestException("没有可执行的人工检测查询（需 enabled 且存在 projectQueryId 镜像）");
    }
    if (enabledQueries.length !== selected.length) {
      throw new BadRequestException("所选查询包含已停用或无镜像的条目；请重新选择");
    }

    const engine = await this.manualEngine();
    const real = dto.runType === "real";
    const primaryBrand = (await this.db.client.brand.findMany({
      where: { projectId: project.id },
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

    const plannedRuns = enabledQueries.length;
    const created = await this.db.client.$transaction(async tx => {
      const monitorTask = await tx.monitorTask.create({
        data: {
          organizationId: project.organizationId,
          projectId: project.id,
          totalRuns: plannedRuns,
          status: "PENDING",
          runs: {
            create: enabledQueries.map(query => ({
              queryId: query.projectQueryId!,
              engineId: engine.id,
              status: "AWAITING_MANUAL_INPUT" as const, // 绝不进入 worker queue
            })),
          },
        },
      });
      const benchmarkRun = await tx.benchmarkRun.create({
        data: {
          organizationId: project.organizationId,
          projectId: project.id,
          suiteId: suite.id,
          suiteName: suite.name,
          suiteVersion: suite.version,
          runType: real ? "REAL" : "DEMO",
          provider: engine.provider,
          engineId: engine.id,
          monitorTaskId: monitorTask.id,
          status: "PENDING",
          plannedRuns,
          completedRuns: 0,
          failedRuns: 0,
          targetSnapshot: targetSnapshot ? JSON.parse(JSON.stringify(targetSnapshot)) as object : undefined,
          metadata: JSON.parse(JSON.stringify({
            executionMode: "MANUAL_WEB_UI",
            measurementProduct: dto.measurementProduct,
            displayedModel: dto.displayedModel ?? null,
            engineKey: engine.key,
            generatedBy: "m8c0-manual-measurement-v1",
            ...(dto.runType === "demo" ? { demo: true } : {}),
          })) as object,
          runQueries: {
            create: enabledQueries.map(query => ({
              benchmarkQueryId: query.id,
              projectQueryId: query.projectQueryId!,
              queryText: query.queryText,
              category: query.category,
              intent: query.intent,
              locale: query.locale,
              weight: query.weight,
              sortOrder: query.sortOrder,
              sanity: query.sanity,
              queryType: query.queryType ?? null,
              contamination: query.contamination ? JSON.parse(JSON.stringify(query.contamination)) as object : undefined,
            })),
          },
        },
      });
      return { benchmarkRun, monitorTask };
    });

    // 绝不 kickDispatch：Manual Run 永不进入 BullMQ / Provider。
    return this.workspaceFor(userId, created.benchmarkRun.id);
  }

  // ---------------------------------------------------------------
  // 2) Manual Workspace（进度 + 每条 run 的录入状态）
  // ---------------------------------------------------------------

  async workspaceFor(userId: string, benchmarkRunId: string) {
    const run = await this.db.client.benchmarkRun.findFirst({
      where: { id: benchmarkRunId, organization: { members: { some: { userId } } } },
      include: {
        suite: { select: { id: true, name: true, version: true } },
        engine: { select: { id: true, key: true, name: true, provider: true } },
        monitorTask: { include: { runs: { include: {
          query: { select: { id: true, text: true } },
          evidence: { select: {
            id: true, rawResponse: true, retrievalMode: true, sourceType: true, metadata: true,
            requestedModel: true, responseModel: true, createdAt: true,
            analyses: { orderBy: { createdAt: "desc" }, take: 1, include: { mentions: true, citations: true } },
          } },
        } } } },
      },
    });
    if (!run) throw new NotFoundException("Manual Benchmark Run 不存在或无权访问");
    const meta = (run.metadata ?? {}) as Record<string, unknown>;
    const snapRows = await this.db.client.benchmarkRunQuery.findMany({
      where: { benchmarkRunId: run.id },
      orderBy: { sortOrder: "asc" },
    });
    const byProjectQuery = new Map(snapRows.map(q => [q.projectQueryId, q]));
    const runs = run.monitorTask.runs.map(runRow => {
      const bench = byProjectQuery.get(runRow.queryId);
      const evidence = runRow.evidence;
      const analysis = evidence?.analyses[0] ?? null;
      return {
        id: runRow.id,
        status: runRow.status,
        queryText: bench?.queryText ?? runRow.query.text,
        queryType: bench?.queryType ?? null,
        category: bench?.category ?? null,
        intent: bench?.intent ?? null,
        sortOrder: bench?.sortOrder ?? null,
        sanity: bench?.sanity ?? false,
        errorMessage: runRow.errorMessage ?? null,
        evidence: evidence ? {
          id: evidence.id,
          rawResponse: evidence.rawResponse,
          retrievalMode: evidence.retrievalMode,
          sourceType: evidence.sourceType,
          requestedModel: evidence.requestedModel,
          responseModel: evidence.responseModel,
          submittedAt: evidence.createdAt,
          metadata: evidence.metadata as Record<string, unknown>,
          analysis: analysis ? {
            analysisVersion: analysis.analysisVersion,
            brandMentioned: analysis.brandMentioned,
            mentionPosition: analysis.mentionPosition,
            recommended: analysis.recommended,
            sentiment: analysis.sentiment,
            mentions: analysis.mentions,
            citations: analysis.citations,
          } : null,
        } : null,
      };
    });
    runs.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const submitted = runs.filter(r => r.status === "SUCCEEDED").length;
    const skipped = runs.filter(r => r.status === "SKIPPED").length;
    const progress = {
      total: runs.length,
      submitted,
      skipped,
      remaining: runs.length - submitted - skipped,
      complete: submitted + skipped === runs.length,
    };
    return {
      id: run.id,
      executionMode: meta.executionMode ?? "AUTOMATED_PROVIDER",
      measurementProduct: meta.measurementProduct ?? null,
      runType: run.runType,
      status: run.monitorTask.status,
      suite: { id: run.suite.id, name: run.suiteName, version: run.suiteVersion },
      engine: { key: run.engine.key, name: run.engine.name, provider: run.engine.provider },
      targetSnapshot: (run.targetSnapshot ?? null) as Record<string, unknown> | null,
      plannedRuns: run.plannedRuns,
      isManual: meta.executionMode === "MANUAL_WEB_UI",
      isDemo: meta.demo === true,
      progress,
      runs,
      createdAt: run.createdAt,
    };
  }

  // ---------------------------------------------------------------
  // 3) Submit Manual Evidence（用户只提供原始观测事实）
  // ---------------------------------------------------------------

  async submitEvidence(userId: string, runId: string, dto: SubmitManualEvidenceDto) {
    const runRow = await this.db.client.run.findFirst({
      where: { id: runId, monitorTask: { organization: { members: { some: { userId } } } } },
      include: {
        engine: true,
        query: { select: { id: true, text: true, projectId: true } },
        monitorTask: { select: { benchmarkRun: { include: { suite: { select: { name: true, version: true } } } } } },
        evidence: { select: { id: true } },
      },
    });
    if (!runRow) throw new NotFoundException("Run 不存在或无权访问");
    if (runRow.evidence) throw new ConflictException("该 Run 已有人工 Evidence（不可覆盖；如需纠错请新建 replacement Run）");
    if (runRow.status !== "AWAITING_MANUAL_INPUT") {
      throw new BadRequestException(`当前状态 ${runRow.status} 不可提交人工 Evidence（需 AWAITING_MANUAL_INPUT）`);
    }
    if (runRow.engine.provider !== "manual") {
      throw new BadRequestException("该 Run 不是人工 Web UI 测量（automated Run 禁止人工覆盖 Evidence）");
    }
    const benchmarkRun = runRow.monitorTask.benchmarkRun;
    if (!benchmarkRun) throw new BadRequestException("该 Run 不属于 Benchmark Run");
    const benchmarkMeta = (benchmarkRun.metadata ?? {}) as Record<string, unknown>;
    if (benchmarkMeta.executionMode !== "MANUAL_WEB_UI") {
      throw new BadRequestException("该 Benchmark Run 不是人工测量（anti-tampering：不可给 automated Run 人工覆盖）");
    }

    const retrievalConfirmed = dto.retrievalConfirmed === true;
    const retrievalMode = retrievalConfirmed ? "manual_verified" as const : "unknown" as const;
    const observedAt = dto.observedAt ? new Date(dto.observedAt) : new Date();
    if (Number.isNaN(observedAt.getTime())) throw new BadRequestException("observedAt 不是合法时间");
    const rawResponse = dto.rawResponse.trim();
    if (!rawResponse) throw new BadRequestException("rawResponse 不能为空（需完整粘贴原回答）");

    const entities = await this.snapshotEntities(runRow.query.projectId);
    const structuredCitations: StructuredCitation[] = (dto.citations ?? [])
      .filter(url => typeof url === "string" && /^https?:\/\//i.test(url.trim()))
      .map(url => ({ url: url.trim() }));

    // 本地确定性分析：与分析 automated 完全同一 analyzer / version。
    const analysisResult = analyzeResponse({
      rawResponse,
      entities,
      structuredCitations,
    });

    // M8C：measurementProduct 若 user 未显式传，沿用 benchmark run 的设定（同一测量产品）。
    const measurementProduct = dto.measurementProduct ?? (benchmarkMeta.measurementProduct as string) ?? "custom-web";
    const verifiedAt = new Date();

    const txResult = await this.db.client.$transaction(async tx => {
      const evidence = await tx.evidence.create({
        data: {
          runId: runRow.id,
          queryText: runRow.query.text,
          rawPrompt: runRow.query.text, // 人工无额外 system prompt：中性语义
          rawResponse,
          provider: "manual",
          engineKey: runRow.engine.key,
          engineName: runRow.engine.name,
          requestedModel: null,
          responseModel: dto.displayedModel ?? null,
          model: dto.displayedModel ?? "manual-web-ui",
          modelVersion: null,
          retrievalMode,
          sourceType: "manual",
          metadata: JSON.parse(JSON.stringify({
            generatedBy: "m8c0-manual-measurement-v1",
            measurementProduct,
            displayedModel: dto.displayedModel ?? null,
            verifiedByUserId: userId,
            verifiedAt: verifiedAt.toISOString(),
            verificationSignals: dto.verificationSignals ?? null,
            verificationNotes: dto.verificationNotes ?? null,
            retrievalConfirmed,
            observedAt: observedAt.toISOString(),
            structuredCitations,
            demo: benchmarkMeta.demo === true,
          })) as object,
          entitySnapshot: JSON.parse(JSON.stringify(entities)) as object,
        },
      });

      // Analysis 行（分析规则由 analyzeResponse 确定性生成，用户无法改写）。
      await tx.analysis.create({
        data: {
          evidenceId: evidence.id,
          analysisVersion: analysisResult.analysisVersion,
          brandMentioned: analysisResult.brandMentioned,
          mentionPosition: analysisResult.mentionPosition,
          recommended: analysisResult.recommended,
          sentiment: analysisResult.sentiment,
          mentions: { create: analysisResult.mentions.map(m => ({
            entityType: m.entityType, entityId: m.entityId, canonicalName: m.canonicalName,
            displayName: m.displayName, position: m.position, context: m.context,
            sentiment: m.sentiment, startOffset: m.startOffset, endOffset: m.endOffset,
          })) },
          citations: { create: analysisResult.citations.map(c => ({
            url: c.url, domain: c.domain, title: c.title, position: c.position,
          })) },
        },
      });

      // Run 收敛为 SUCCEEDED（终态；不产生任何 provider/queue 副作用）。
      await tx.run.update({ where: { id: runRow.id }, data: {
        status: "SUCCEEDED",
        completedAt: new Date(),
        analysisStatus: "SUCCEEDED",
        analysisErrorCode: null,
        analysisAttempts: { increment: 1 },
        result: JSON.parse(JSON.stringify({ manualMeasurement: true, observedAt: observedAt.toISOString() })) as object,
      } });

      await this.refreshTask(tx, runRow.monitorTaskId);
      return evidence;
    });

    return this.workspaceFor(userId, benchmarkRun.id);
  }

  // ---------------------------------------------------------------
  // 4) Skip（人工跳过；SKIPPED ≠ 品牌未出现）
  // ---------------------------------------------------------------

  async skipRun(userId: string, runId: string, reason?: string) {
    const runRow = await this.db.client.run.findFirst({
      where: { id: runId, monitorTask: { organization: { members: { some: { userId } } } } },
      select: {
        id: true, monitorTaskId: true, status: true,
        engine: { select: { provider: true } },
        monitorTask: { select: { benchmarkRun: { select: { id: true } } } },
      },
    });
    if (!runRow) throw new NotFoundException("Run 不存在或无权访问");
    if (runRow.status !== "AWAITING_MANUAL_INPUT") {
      throw new BadRequestException(`当前状态 ${runRow.status} 不可跳过（需 AWAITING_MANUAL_INPUT）`);
    }
    if (runRow.engine.provider !== "manual") {
      throw new BadRequestException("该 Run 不是人工 Web UI 测量");
    }
    await this.db.client.$transaction(async tx => {
      await tx.run.update({ where: { id: runRow.id }, data: {
        status: "SKIPPED",
        completedAt: new Date(),
        errorCode: "MANUAL_SKIPPED",
        errorMessage: reason?.slice(0, 500) ?? "用户跳过该问题",
      } });
      await this.refreshTask(tx, runRow.monitorTaskId);
    });
    return this.workspaceFor(userId, runRow.monitorTask.benchmarkRun!.id);
  }

  /** 聚合 Run 状态刷新 MonitorTask（复用 queue state 语义；worker 不会触碰 manual task）。 */
  private async refreshTask(tx: any, monitorTaskId: string) {
    const rows = await tx.run.findMany({ where: { monitorTaskId }, select: { status: true } }) as Array<{ status: string }>;
    const totalRuns = rows.length;
    const completedRuns = rows.filter((r: { status: string }) => r.status === "SUCCEEDED").length;
    const failedRuns = rows.filter((r: { status: string }) => r.status === "FAILED").length;
    const skipped = rows.filter((r: { status: string }) => r.status === "SKIPPED").length;
    const awaiting = rows.filter((r: { status: string }) => r.status === "AWAITING_MANUAL_INPUT").length;
    const done = completedRuns + failedRuns + skipped;
    let status: string;
    if (totalRuns > 0 && done === totalRuns) {
      status = completedRuns === totalRuns ? "SUCCEEDED" : "PARTIAL";
    } else if (done > 0 || awaiting > 0) status = "RUNNING";
    else status = "PENDING";
    const finished = ["SUCCEEDED", "FAILED", "CANCELLED", "PARTIAL"].includes(status);
    await tx.monitorTask.update({ where: { id: monitorTaskId }, data: {
      status,
      completedRuns,
      failedRuns,
      ...(finished ? { completedAt: new Date() } : { completedAt: null }),
    } });
  }
}
