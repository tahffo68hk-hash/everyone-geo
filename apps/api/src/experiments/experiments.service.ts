import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@geo/database";
import {
  EVALUATION_VERSION, EXPERIMENT_VERSION, evaluateExperiment, fingerprintQuerySet,
  type ExperimentEvaluationInput, type ExperimentQueryFact, type ExperimentReportFacts,
  type QueryFingerprintRow,
} from "@geo/core";
import { PrismaService } from "../prisma.service";
import { BenchmarkService } from "../benchmark/benchmark.service";
import { ReportsService } from "../reports/reports.service";
import { CreateExecutionDto } from "./dto/create-execution.dto";
import { UpdateExperimentStatusDto } from "./dto/update-experiment-status.dto";

/**
 * M7D Optimization Experiment & Re-test API。
 * 语义：
 *   1) Experiment 绑定 ContentOpportunity + Baseline Report；Before/Execution/
 *      Retest/Evaluation 四层分开，绝不覆盖。Retest 支持多次（#1/#2/#3…）。
 *   2) Frozen Re-test：复测经 BenchmarkService.startRunFromSnapshot 复用基线
 *      BenchmarkRunQuery 快照（同 queryText/category/intent/locale/weight/sanity/
 *      sortOrder），绝不静默读取后来编辑过的当前 BenchmarkQuery。
 *   3) Evaluation 生成即 immutable snapshot（evaluationVersion 幂等）；
 *      Demo/Real 隔离 + Real Provider Guard + 时序 guard + coverage guard。
 *   4) Execution 只做用户确认的变更记录；绝不自动修改/验证外部页面。
 */
type JsonValue = Prisma.InputJsonValue;
const logger = new Logger("ExperimentsService");

@Injectable()
export class ExperimentsService {
  constructor(
    private readonly db: PrismaService,
    private readonly benchmark: BenchmarkService,
    private readonly reports: ReportsService,
  ) {}

  // ---------------------------------------------------------------
  // Create experiment（幂等：同 opportunity+version+baseline）
  // ---------------------------------------------------------------
  async createFromOpportunity(userId: string, contentOpportunityId: string) {
    const opp = await this.db.client.contentOpportunity.findFirst({
      where: { id: contentOpportunityId, opportunityRun: { project: { organization: { members: { some: { userId } } } } } },
      include: { opportunityRun: { include: { recommendationRun: true } } },
    });
    if (!opp) throw new NotFoundException("内容机会不存在或无权访问");
    if (!opp.opportunityRun.recommendationRun) throw new BadRequestException("来源优化建议 Run 缺失，无法定位 Baseline");

    const diagnosisRun = await this.db.client.diagnosisRun.findUnique({
      where: { id: opp.opportunityRun.recommendationRun.diagnosisRunId },
    });
    if (!diagnosisRun) throw new BadRequestException("来源诊断缺失，无法定位 Baseline");
    const report = await this.db.client.benchmarkReport.findUnique({
      where: { id: diagnosisRun.reportId },
      include: { benchmarkRun: { include: { engine: true } } },
    });
    if (!report) throw new BadRequestException("Baseline Report 不存在");

    // 幂等
    const existing = await this.db.client.optimizationExperiment.findFirst({
      where: { contentOpportunityId: opp.id, experimentVersion: EXPERIMENT_VERSION, baselineReportId: report.id },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return this.presentExperiment(existing, { withCounts: true, reused: true });

    // Frozen query set
    const snapRows = await this.db.client.benchmarkRunQuery.findMany({
      where: { benchmarkRunId: report.benchmarkRunId },
      orderBy: { sortOrder: "asc" },
    });
    if (snapRows.length === 0) throw new BadRequestException("Baseline 无冻结测试问题快照，无法保证复测口径一致（拒绝创建实验）");
    const fingerprint = fingerprintQuerySet(snapRows.map(row => ({
      queryText: row.queryText, category: row.category, intent: row.intent, locale: row.locale,
      weight: row.weight, sanity: row.sanity, sortOrder: row.sortOrder,
    })));

    const signals = (opp.expectedSignals ?? []).length > 0 ? opp.expectedSignals : ["VISIBILITY", "RECOMMENDATION"];
    const hypothesis =
      `如果补充针对「${opp.titleDirection}」的真实、结构化产品信息（覆盖 ${snapRows.length} 个与基线同口径的测试问题），` +
      `则后续相同 Benchmark 中的 ${signals.join(" / ")} 信号可能改善。` +
      `该假设为待验证方向（“可能”改善，非“一定”提升），结论须以受控复测观察为准，不能解读为严格因果证明。`;

    const engine = report.benchmarkRun?.engine ?? null;
    const created = await this.db.client.optimizationExperiment.create({
      data: {
        projectId: opp.opportunityRun.projectId,
        contentOpportunityId: opp.id,
        experimentVersion: EXPERIMENT_VERSION,
        title: `${opp.titleDirection}（优化实验）`,
        hypothesis,
        status: "PLANNED",
        baselineReportId: report.id,
        querySetFingerprint: fingerprint,
        metricSource: report.metricSource,
        provider: engine?.provider ?? report.provider,
        engineId: engine?.id ?? null,
        engineKey: report.engineKey,
        engineName: report.engineName,
        requestedModel: report.requestedModel,
        responseModel: report.responseModel,
        analysisVersion: report.analysisVersion,
        competitorSetVersion: report.competitorSetVersion,
        suiteName: report.suiteName,
        suiteVersion: report.suiteVersion,
        plannedQueryCount: snapRows.length,
        metadata: {
          contentOpportunityTitleDirection: opp.titleDirection,
          contentOpportunityType: opp.opportunityType,
          expectedSignals: signals,
          generatedBy: "m7d-experiment-v1",
          note: "Observed Outcome ≠ proven causal effect；真正结论需用户正式验收并考虑多次 Re-test。",
        } as JsonValue,
      },
    });

    logger.log(JSON.stringify({ event: "experiment_created", experimentId: created.id, contentOpportunityId: opp.id, baselineReportId: report.id, experimentVersion: EXPERIMENT_VERSION, plannedQueryCount: snapRows.length }));
    return this.presentExperiment(created, { withCounts: true });
  }

  // ---------------------------------------------------------------
  // Execution record（用户确认；时序 guard）
  // ---------------------------------------------------------------
  async recordExecution(userId: string, experimentId: string, dto: CreateExecutionDto) {
    const exp = await this.experimentForUser(userId, experimentId);
    if (["EVALUATED", "CANCELLED"].includes(exp.status)) {
      throw new BadRequestException(`当前实验状态 ${exp.status} 不允许再记录执行。`);
    }
    const report = await this.db.client.benchmarkReport.findUnique({ where: { id: exp.baselineReportId } });
    if (!report) throw new BadRequestException("Baseline Report 缺失");
    const executedAt = new Date(dto.executedAt);
    if (executedAt.getTime() < report.generatedAt.getTime()) {
      throw new BadRequestException("执行时间不能早于 Baseline 报告生成时间（必须 After ≥ 执行 ≥ Before）。");
    }
    const created = await this.db.client.experimentExecution.create({
      data: {
        experimentId: exp.id,
        executionType: dto.executionType,
        changeSummary: dto.changeSummary,
        assetType: dto.assetType ?? null,
        assetReference: dto.assetReference ?? null,
        executedAt,
        status: "RECORDED",
        metadata: { note: "执行记录由用户确认；GeoLens 不自动修改或验证外部页面。" } as JsonValue,
      },
    });
    await this.db.client.optimizationExperiment.update({
      where: { id: exp.id },
      data: { status: "EXECUTION_RECORDED", executionRecordedAt: executedAt },
    });
    logger.log(JSON.stringify({ event: "experiment_execution_recorded", experimentId: exp.id, executionId: created.id, executionType: dto.executionType, executedAt: executedAt.toISOString() }));
    return this.presentExecution(created);
  }

  // ---------------------------------------------------------------
  // Retest plan（只读预览）
  // ---------------------------------------------------------------
  async retestPlan(userId: string, experimentId: string) {
    const exp = await this.experimentForUser(userId, experimentId);
    const engine = exp.engineId ? await this.db.client.engine.findUnique({ where: { id: exp.engineId } }) : null;
    return {
      experimentId: exp.id,
      status: exp.status,
      queryCount: exp.plannedQueryCount,
      expectedCallCount: exp.plannedQueryCount,
      provider: engine?.provider ?? exp.provider,
      engineKey: engine?.key ?? exp.engineKey,
      requestedModel: exp.requestedModel,
      metricSource: exp.metricSource,
      suite: exp.suiteName ? `${exp.suiteName} v${exp.suiteVersion ?? ""}` : null,
      analysisVersion: exp.analysisVersion,
      competitorSetVersion: exp.competitorSetVersion,
      querySetFingerprint: exp.querySetFingerprint,
      baselineReportId: exp.baselineReportId,
    };
  }

  // ---------------------------------------------------------------
  // Frozen retest（startRunFromSnapshot → 既有 pipeline）
  // ---------------------------------------------------------------
  async createRetest(userId: string, experimentId: string) {
    const exp = await this.experimentForUser(userId, experimentId);
    if (exp.status === "CANCELLED") throw new BadRequestException("实验已取消，不能开始复测。");
    if (!exp.executionRecordedAt) {
      throw new BadRequestException("请先记录已完成的优化动作，再开始复测。");
    }
    const report = await this.db.client.benchmarkReport.findUnique({ where: { id: exp.baselineReportId } });
    if (!report) throw new BadRequestException("Baseline Report 缺失");
    const baselineRunId = report.benchmarkRunId;

    const engine = exp.engineId ? await this.db.client.engine.findUnique({ where: { id: exp.engineId } }) : null;
    if (!engine || !engine.enabled) throw new BadRequestException("复测引擎不存在或已停用");

    const runType = exp.metricSource === "real" ? "real" as const : "demo" as const;
    if (runType === "real" && engine.provider !== "deepseek" && engine.provider !== "qwen") {
      throw new BadRequestException("Real 复测只能使用 DeepSeek / Qwen Provider 引擎（沿用 M6 cost guard）。");
    }
    if (runType === "demo" && engine.provider !== "mock") {
      throw new BadRequestException("演示复测只能使用 Mock 引擎（模拟数据，0 真实调用）。");
    }

    // 复测前重算指纹必须与基线一致（快照漂移防线）
    const snapRows = await this.db.client.benchmarkRunQuery.findMany({
      where: { benchmarkRunId: baselineRunId },
      orderBy: { sortOrder: "asc" },
    });
    const fingerprint = fingerprintQuerySet(snapRows.map(toFingerprintRow));
    if (fingerprint !== exp.querySetFingerprint) {
      throw new BadRequestException("基线测试集指纹不一致，无法保证与基线测试问题一致（拒绝复测）。");
    }

    const sequence = (await this.db.client.experimentRetest.count({ where: { experimentId: exp.id } })) + 1;
    const run = await this.benchmark.startRunFromSnapshot(userId, baselineRunId, { engineId: engine.id, runType });
    const retest = await this.db.client.experimentRetest.create({
      data: {
        experimentId: exp.id,
        sequence,
        benchmarkRunId: run.id,
        status: "RUNNING",
        runType: run.runType,
        provider: engine.provider,
        engineId: engine.id,
        engineKey: engine.key,
        requestedModel: exp.requestedModel,
        plannedQueryCount: exp.plannedQueryCount,
        expectedCallCount: exp.plannedQueryCount,
        querySetFingerprint: fingerprint,
        startedAt: new Date(),
        metadata: { frozenFromRunId: baselineRunId } as JsonValue,
      },
    });
    await this.db.client.optimizationExperiment.update({ where: { id: exp.id }, data: { status: "RETEST_RUNNING" } });
    logger.log(JSON.stringify({ event: "experiment_retest_started", experimentId: exp.id, retestId: retest.id, sequence, benchmarkRunId: run.id, provider: engine.provider, plannedRuns: exp.plannedQueryCount }));
    return this.presentRetest(retest);
  }

  // ---------------------------------------------------------------
  // Evaluation（immutable；幂等同 retest+version）
  // ---------------------------------------------------------------
  async evaluateRetest(userId: string, retestId: string) {
    const retest = await this.retestForUser(userId, retestId);
    const exp = await this.experimentForUser(userId, retest.experimentId);

    const existing = await this.db.client.experimentEvaluation.findFirst({
      where: { retestId: retest.id, evaluationVersion: EVALUATION_VERSION },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return this.presentEvaluation(existing, { withCounts: true, reused: true });

    // 以复测 run 的实时状态判定终态（复测完成后 retest.status 同步为 SUCCEEDED/PARTIAL）
    let liveStatus = retest.status;
    if (retest.benchmarkRunId) {
      const live = await this.db.client.benchmarkRun.findUnique({
        where: { id: retest.benchmarkRunId },
        include: { monitorTask: { select: { status: true } } },
      });
      liveStatus = live?.monitorTask.status ?? retest.status;
      if (["SUCCEEDED", "PARTIAL", "FAILED", "CANCELLED"].includes(liveStatus)) {
        await this.db.client.experimentRetest.update({
          where: { id: retest.id },
          data: { status: liveStatus === "SUCCEEDED" ? "SUCCEEDED" : liveStatus === "PARTIAL" ? "PARTIAL" : "FAILED" },
        });
      }
    }
    if (["PENDING", "QUEUED", "RUNNING"].includes(liveStatus)) {
      throw new BadRequestException("复测仍在运行，请等待完成后评估。");
    }
    if (["FAILED", "CANCELLED"].includes(liveStatus)) {
      throw new BadRequestException(`复测 ${liveStatus}，无法评估。`);
    }

    // After report（首次评估自动生成；analysisVersion 必须与基线一致）
    let afterReportId = retest.reportId ?? null;
    if (!afterReportId && retest.benchmarkRunId) {
      try {
        const created = await this.reports.createReport(userId, retest.benchmarkRunId, { analysisVersion: exp.analysisVersion });
        afterReportId = created.id;
        await this.db.client.experimentRetest.update({ where: { id: retest.id }, data: { reportId: afterReportId, status: created.completion?.partial ? "PARTIAL" : "SUCCEEDED", completedAt: new Date() } });
      } catch {
        throw new BadRequestException(`复测 Evidence 缺少分析版本 ${exp.analysisVersion}（无法同口径评估；如需新规则请生成 Evaluation v2 前的复测版本一致分析）。`);
      }
    }
    if (!afterReportId) throw new BadRequestException("复测报告缺失，无法评估。");

    const beforeReport = await this.db.client.benchmarkReport.findUnique({ where: { id: exp.baselineReportId } });
    const afterReport = await this.db.client.benchmarkReport.findUnique({ where: { id: afterReportId } });
    if (!beforeReport || !afterReport) throw new BadRequestException("Before/After 报告缺失。");

    const before = await this.reportFacts(userId, beforeReport, exp.analysisVersion);
    const after = await this.reportFacts(userId, afterReport, exp.analysisVersion);
    const opportunity = await this.db.client.contentOpportunity.findUnique({ where: { id: exp.contentOpportunityId } });

    const input: ExperimentEvaluationInput = {
      evaluationVersion: EVALUATION_VERSION,
      experiment: {
        id: exp.id,
        expectedSignals: (opportunity?.expectedSignals ?? ["VISIBILITY", "RECOMMENDATION"]),
        executedAt: exp.executionRecordedAt ? exp.executionRecordedAt.toISOString() : null,
      },
      before,
      after,
      beforeQueries: await this.runQueryFacts(userId, beforeReport.benchmarkRunId, exp.analysisVersion),
      afterQueries: await this.runQueryFacts(userId, afterReport.benchmarkRunId, exp.analysisVersion),
    };

    const started = Date.now();
    const out = evaluateExperiment(input);
    const metricSource = before.metricSource === after.metricSource ? after.metricSource : "NOT_COMPARABLE";

    const created = await this.db.client.$transaction(async tx => {
      const evaluation = await tx.experimentEvaluation.create({
        data: {
          experimentId: exp.id,
          retestId: retest.id,
          evaluationVersion: EVALUATION_VERSION,
          beforeReportId: before.reportId,
          afterReportId: after.reportId,
          outcome: out.outcome,
          compatibility: JSON.parse(JSON.stringify({
            verdict: out.compatibility.verdict,
            warnings: out.compatibility.warnings,
            inconclusiveReasons: out.compatibility.inconclusiveReasons,
          })) as JsonValue,
          summarySnapshot: JSON.parse(JSON.stringify(out.summary)) as JsonValue,
          metricSource,
          metricDeltas: {
            create: out.metricDeltas.map(d => ({
              metricName: d.metric, beforeValue: d.beforeValue, afterValue: d.afterValue,
              deltaValue: d.deltaValue, deltaUnit: d.deltaUnit, direction: d.direction,
              meaningful: d.meaningful, primarySignal: d.primarySignal,
            })),
          },
          queryDeltas: {
            create: out.queryDeltas.map(q => ({
              sortOrder: q.sortOrder, queryTextSnapshot: q.queryText, category: q.category,
              beforeEvidenceId: q.beforeEvidenceId, afterEvidenceId: q.afterEvidenceId,
              beforeMentioned: q.beforeMentioned, afterMentioned: q.afterMentioned,
              beforeRecommended: q.beforeRecommended, afterRecommended: q.afterRecommended,
              beforePosition: q.beforePosition, afterPosition: q.afterPosition,
              beforeCitationCount: q.beforeCitationCount ?? -1, afterCitationCount: q.afterCitationCount ?? -1,
              transitionType: q.transitionType, status: q.status,
            })),
          },
        },
      });
      return evaluation;
    });

    await this.db.client.optimizationExperiment.update({
      where: { id: exp.id },
      data: { status: "EVALUATED", completedAt: new Date() },
    });
    await this.db.client.experimentRetest.update({ where: { id: retest.id }, data: { completedAt: new Date() } });
    logger.log(JSON.stringify({
      event: "experiment_evaluated", experimentId: exp.id, retestId: retest.id, evaluationId: created.id,
      evaluationVersion: EVALUATION_VERSION, outcome: out.outcome, verdict: out.compatibility.verdict,
      evaluationDurationMs: Date.now() - started,
    }));
    return this.presentEvaluation(created, { withCounts: true });
  }

  // ---------------------------------------------------------------
  // 查询
  // ---------------------------------------------------------------
  async listByOpportunity(userId: string, contentOpportunityId: string) {
    const opp = await this.db.client.contentOpportunity.findFirst({
      where: { id: contentOpportunityId, opportunityRun: { project: { organization: { members: { some: { userId } } } } } },
    });
    if (!opp) throw new NotFoundException("内容机会不存在或无权访问");
    const rows = await this.db.client.optimizationExperiment.findMany({
      where: { contentOpportunityId },
      include: { _count: { select: { executions: true, retests: true, evaluations: true } } },
      orderBy: [{ createdAt: "desc" }],
    });
    return rows.map(row => this.presentExperiment(row, { withCounts: true }));
  }

  async getExperiment(userId: string, id: string) {
    const exp = await this.experimentForUser(userId, id);
    return this.presentExperiment(exp, { withCounts: true });
  }

  async getRetest(userId: string, id: string) {
    const retest = await this.retestForUser(userId, id);
    let live = null;
    if (retest.benchmarkRunId) {
      try {
        const run = await this.benchmark.getRun(userId, retest.benchmarkRunId);
        live = { status: run.status, progress: run.progress, completedRuns: run.completedRuns, failedRuns: run.failedRuns, succeededRuns: run.succeededRuns, terminal: run.terminal };
      } catch { /* run 可能被清理，忽略 */ }
    }
    return { ...this.presentRetest(retest), live };
  }

  async getEvaluation(userId: string, id: string) {
    const ev = await this.evaluationForUser(userId, id);
    const counts = await this.db.client.experimentEvaluation.findUnique({
      where: { id: ev.id },
      include: { _count: { select: { metricDeltas: true, queryDeltas: true } } },
    });
    return this.presentEvaluation(counts, { withCounts: true });
  }

  async executions(userId: string, experimentId: string) {
    const exp = await this.experimentForUser(userId, experimentId);
    const rows = await this.db.client.experimentExecution.findMany({ where: { experimentId: exp.id }, orderBy: { executedAt: "asc" } });
    return { experimentId: exp.id, executions: rows.map(r => this.presentExecution(r)) };
  }

  async retests(userId: string, experimentId: string) {
    const exp = await this.experimentForUser(userId, experimentId);
    const rows = await this.db.client.experimentRetest.findMany({ where: { experimentId: exp.id }, orderBy: { sequence: "asc" } });
    return { experimentId: exp.id, retests: rows.map(r => this.presentRetest(r)) };
  }

  async evaluations(userId: string, experimentId: string) {
    const exp = await this.experimentForUser(userId, experimentId);
    const rows = await this.db.client.experimentEvaluation.findMany({
      where: { experimentId: exp.id },
      include: { _count: { select: { metricDeltas: true, queryDeltas: true } } },
      orderBy: [{ generatedAt: "desc" }],
    });
    return { experimentId: exp.id, evaluations: rows.map(r => this.presentEvaluation(r, { withCounts: true })) };
  }

  async metricDeltas(userId: string, evaluationId: string) {
    const ev = await this.evaluationForUser(userId, evaluationId);
    const rows = await this.db.client.experimentMetricDelta.findMany({ where: { evaluationId: ev.id }, orderBy: { metricName: "asc" } });
    return { evaluationId: ev.id, metricDeltas: rows.map(r => this.presentMetricDelta(r)) };
  }

  async queryDeltas(userId: string, evaluationId: string) {
    const ev = await this.evaluationForUser(userId, evaluationId);
    const rows = await this.db.client.experimentQueryDelta.findMany({ where: { evaluationId: ev.id }, orderBy: { sortOrder: "asc" } });
    return { evaluationId: ev.id, queryDeltas: rows.map(r => this.presentQueryDelta(r)) };
  }

  /** Query Delta 的 Before/After Evidence 链接（A/B，runId 供 EvidenceDialog；不复制 rawResponse）。 */
  async queryDeltaEvidence(userId: string, queryDeltaId: string) {
    const row = await this.db.client.experimentQueryDelta.findFirst({
      where: { id: queryDeltaId, evaluation: { experiment: { project: { organization: { members: { some: { userId } } } } } } },
    });
    if (!row) throw new NotFoundException("Query Delta 不存在或无权访问");
    const fetchEv = async (evidenceId: string | null) => {
      if (!evidenceId) return null;
      const evidence = await this.db.client.evidence.findUnique({
        where: { id: evidenceId },
        select: { id: true, runId: true, queryText: true, provider: true, requestedModel: true, responseModel: true, retrievalMode: true, sourceType: true, createdAt: true },
      });
      if (!evidence) return null;
      return {
        evidenceId: evidence.id, runId: evidence.runId, queryText: evidence.queryText,
        provider: evidence.provider, requestedModel: evidence.requestedModel,
        responseModel: evidence.responseModel, retrievalMode: evidence.retrievalMode,
        sourceType: evidence.sourceType, createdAt: evidence.createdAt,
      };
    };
    const [before, after] = await Promise.all([fetchEv(row.beforeEvidenceId), fetchEv(row.afterEvidenceId)]);
    return { queryDeltaId: row.id, queryText: row.queryTextSnapshot, before, after };
  }

  async updateStatus(userId: string, experimentId: string, dto: UpdateExperimentStatusDto) {
    const exp = await this.experimentForUser(userId, experimentId);
    if (dto.status === "CANCELLED") {
      if (["EVALUATED", "CANCELLED"].includes(exp.status)) {
        throw new BadRequestException(`实验状态 ${exp.status} 不允许取消。`);
      }
      const updated = await this.db.client.optimizationExperiment.update({ where: { id: exp.id }, data: { status: "CANCELLED" } });
      logger.log(JSON.stringify({ event: "experiment_cancelled", experimentId: updated.id }));
      return this.presentExperiment(updated);
    }
    throw new BadRequestException(`不允许将实验状态直接置为 ${dto.status}（状态由生命周期动作自动推进）。`);
  }

  // ---------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------
  private async experimentForUser(userId: string, id: string) {
    const exp = await this.db.client.optimizationExperiment.findFirst({
      where: { id, project: { organization: { members: { some: { userId } } } } },
    });
    if (!exp) throw new NotFoundException("实验不存在或无权访问");
    return exp;
  }

  private async retestForUser(userId: string, id: string) {
    const retest = await this.db.client.experimentRetest.findFirst({
      where: { id, experiment: { project: { organization: { members: { some: { userId } } } } } },
    });
    if (!retest) throw new NotFoundException("复测记录不存在或无权访问");
    return retest;
  }

  private async evaluationForUser(userId: string, id: string) {
    const ev = await this.db.client.experimentEvaluation.findFirst({
      where: { id, experiment: { project: { organization: { members: { some: { userId } } } } } },
    });
    if (!ev) throw new NotFoundException("评估记录不存在或无权访问");
    return ev;
  }

  /** Report → 纯事实（metrics + queryFingerprint）；只看快照，不读当前配置。 */
  private async reportFacts(userId: string, report: any, analysisVersion: string): Promise<ExperimentReportFacts> {
    void userId;
    const snapshot = (report.metricsSnapshot ?? {}) as Record<string, any>;
    const overall = snapshot.overall ?? {};
    const snapRows = await this.db.client.benchmarkRunQuery.findMany({
      where: { benchmarkRunId: report.benchmarkRunId },
      orderBy: { sortOrder: "asc" },
    });
    const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
    return {
      reportId: report.id,
      benchmarkRunId: report.benchmarkRunId,
      suiteName: report.suiteName, suiteVersion: report.suiteVersion,
      provider: report.provider, engineKey: report.engineKey, engineName: report.engineName,
      requestedModel: report.requestedModel, responseModel: report.responseModel,
      metricSource: report.metricSource, analysisVersion: report.analysisVersion,
      competitorSetVersion: report.competitorSetVersion,
      generatedAt: report.generatedAt.toISOString(),
      completion: {
        plannedRuns: snapRows.length,
        completedRuns: report.completedRuns, succeededRuns: report.succeededRuns,
        failedRuns: report.failedRuns, analyzedRuns: report.analyzedRuns, partial: report.partial,
      },
      metrics: {
        visibilityRate: num(overall.visibilityRate), recommendationRate: num(overall.recommendationRate),
        averageMentionPosition: num(overall.averageMentionPosition), shareOfVoice: num(overall.shareOfVoice),
        citationCount: num(overall.citationCount), citationDomainCount: num(overall.citationDomainCount),
      },
      queryFingerprint: fingerprintQuerySet(snapRows.map(toFingerprintRow)),
      queryCount: snapRows.length,
    };
  }

  /** 逐 Query 事实（frozen snapshot 对齐 + 该 analysisVersion 的分析）。 */
  private async runQueryFacts(userId: string, benchmarkRunId: string, analysisVersion: string): Promise<ExperimentQueryFact[]> {
    const run = await this.db.client.benchmarkRun.findFirst({
      where: { id: benchmarkRunId, organization: { members: { some: { userId } } } },
      include: {
        runQueries: { orderBy: { sortOrder: "asc" } },
        monitorTask: { include: { runs: { include: {
          evidence: {
            include: { analyses: {
              where: { analysisVersion },
              include: { citations: { select: { id: true } } },
            } },
          },
        } } } },
      },
    });
    if (!run) throw new NotFoundException("Benchmark Run 不存在或无权访问");
    const byProjectQuery = new Map(run.runQueries.map(q => [q.projectQueryId, q]));
    const rows: ExperimentQueryFact[] = [];
    for (const runRow of run.monitorTask.runs) {
      const bench = byProjectQuery.get(runRow.queryId);
      if (!bench) continue;
      const analysis = runRow.evidence?.analyses?.[0] ?? null;
      rows.push({
        sortOrder: bench.sortOrder,
        queryText: bench.queryText,
        category: bench.category,
        intent: bench.intent,
        runStatus: runRow.status,
        hasAnalysis: Boolean(analysis),
        brandMentioned: analysis ? analysis.brandMentioned : null,
        recommended: analysis ? analysis.recommended : null,
        mentionPosition: analysis ? analysis.mentionPosition : null,
        citationCount: analysis ? analysis.citations.length : null,
        evidenceId: runRow.evidence?.id ?? null,
      });
    }
    rows.sort((a, b) => a.sortOrder - b.sortOrder);
    return rows;
  }

  // ---------------------------------------------------------------
  // Present
  // ---------------------------------------------------------------
  private presentExperiment(exp: any, options: { withCounts?: boolean; reused?: boolean } = {}) {
    return {
      id: exp.id,
      contentOpportunityId: exp.contentOpportunityId,
      projectId: exp.projectId,
      experimentVersion: exp.experimentVersion,
      title: exp.title,
      hypothesis: exp.hypothesis,
      status: exp.status,
      baselineReportId: exp.baselineReportId,
      querySetFingerprint: exp.querySetFingerprint,
      metricSource: exp.metricSource,
      provider: exp.provider,
      engineId: exp.engineId, engineKey: exp.engineKey, engineName: exp.engineName,
      requestedModel: exp.requestedModel, responseModel: exp.responseModel,
      analysisVersion: exp.analysisVersion, competitorSetVersion: exp.competitorSetVersion,
      suiteName: exp.suiteName, suiteVersion: exp.suiteVersion,
      plannedQueryCount: exp.plannedQueryCount,
      executionRecordedAt: exp.executionRecordedAt, completedAt: exp.completedAt,
      createdAt: exp.createdAt, updatedAt: exp.updatedAt,
      metadata: exp.metadata,
      ...(options.withCounts ? {
        executionCount: exp._count?.executions ?? null,
        retestCount: exp._count?.retests ?? null,
        evaluationCount: exp._count?.evaluations ?? null,
      } : {}),
      ...(options.reused ? { reused: true } : {}),
    };
  }

  private presentExecution(r: any) {
    return {
      id: r.id, experimentId: r.experimentId, executionType: r.executionType,
      changeSummary: r.changeSummary, assetType: r.assetType, assetReference: r.assetReference,
      executedAt: r.executedAt, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt,
    };
  }

  private presentRetest(r: any) {
    return {
      id: r.id, experimentId: r.experimentId, sequence: r.sequence,
      benchmarkRunId: r.benchmarkRunId, reportId: r.reportId, status: r.status,
      runType: r.runType, provider: r.provider, engineId: r.engineId, engineKey: r.engineKey,
      requestedModel: r.requestedModel,
      plannedQueryCount: r.plannedQueryCount, expectedCallCount: r.expectedCallCount,
      querySetFingerprint: r.querySetFingerprint,
      startedAt: r.startedAt, completedAt: r.completedAt, createdAt: r.createdAt,
    };
  }

  private presentEvaluation(ev: any, options: { withCounts?: boolean; reused?: boolean } = {}) {
    const compat = (ev.compatibility ?? {}) as Record<string, unknown>;
    return {
      id: ev.id, experimentId: ev.experimentId, retestId: ev.retestId,
      evaluationVersion: ev.evaluationVersion,
      beforeReportId: ev.beforeReportId, afterReportId: ev.afterReportId,
      outcome: ev.outcome,
      verdict: compat.verdict ?? null,
      warnings: Array.isArray(compat.warnings) ? compat.warnings : [],
      inconclusiveReasons: Array.isArray(compat.inconclusiveReasons) ? compat.inconclusiveReasons : [],
      summary: ev.summarySnapshot,
      metricSource: ev.metricSource,
      generatedAt: ev.generatedAt, createdAt: ev.createdAt,
      ...(options.withCounts ? {
        metricDeltaCount: ev._count?.metricDeltas ?? null,
        queryDeltaCount: ev._count?.queryDeltas ?? null,
      } : {}),
      ...(options.reused ? { reused: true } : {}),
    };
  }

  private presentMetricDelta(d: any) {
    return {
      id: d.id, evaluationId: d.evaluationId, metricName: d.metricName,
      beforeValue: d.beforeValue, afterValue: d.afterValue, deltaValue: d.deltaValue,
      deltaUnit: d.deltaUnit, direction: d.direction, meaningful: d.meaningful,
      primarySignal: d.primarySignal,
    };
  }

  private presentQueryDelta(q: any) {
    return {
      id: q.id, evaluationId: q.evaluationId, sortOrder: q.sortOrder,
      queryText: q.queryTextSnapshot, category: q.category,
      beforeEvidenceId: q.beforeEvidenceId, afterEvidenceId: q.afterEvidenceId,
      beforeMentioned: q.beforeMentioned, afterMentioned: q.afterMentioned,
      beforeRecommended: q.beforeRecommended, afterRecommended: q.afterRecommended,
      beforePosition: q.beforePosition, afterPosition: q.afterPosition,
      beforeCitationCount: q.beforeCitationCount < 0 ? null : q.beforeCitationCount,
      afterCitationCount: q.afterCitationCount < 0 ? null : q.afterCitationCount,
      transitionType: q.transitionType, status: q.status,
    };
  }
}

function toFingerprintRow(row: { queryText: string; category: string | null; intent: string | null; locale: string | null; weight: number; sanity: boolean; sortOrder: number }): QueryFingerprintRow {
  return {
    queryText: row.queryText, category: row.category, intent: row.intent,
    locale: row.locale, weight: row.weight, sanity: row.sanity, sortOrder: row.sortOrder,
  };
}
