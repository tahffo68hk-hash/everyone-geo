import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@geo/database";
import { PrismaService } from "../prisma.service";
import { TenantService } from "../common/tenant.service";
import { BenchmarkService } from "../benchmark/benchmark.service";
import { CreateReportDto } from "./dto/create-report.dto";
import { CompareReportsDto } from "./dto/compare-reports.dto";

/**
 * M6C Benchmark Report（不可变快照）+ Historical Comparison Foundation。
 *
 * 关键语义：
 *   1) Report = snapshot：生成瞬间冻结 suiteName/suiteVersion、provider、engine、
 *      requestedModel/responseModel、metricSource、analysisVersion、Competitor Set
 *      (id/name/version) 与 metricsSnapshot —— 之后任何行被编辑（BenchmarkQuery、
 *      Competitor Set v2、新 Analysis version）都不会改变历史报告。
 *   2) 同一 BenchmarkRun 允许生成多份 Report（m4-rule-v1 与 m6b-competitors-v1
 *      各一份），绝不覆盖旧报告。
 *   3) requestedModel/responseModel 取自该 Run 各 Evidence（M6C 新语义字段）；
 *      历史 Evidence 无字段 → null（UI 显示「历史记录未保存/未知」），不猜测。
 *   4) Demo/Real 隔离：metricSource 来自 geolens-v1 聚合（mixed ⇒ 只基于真实子集）。
 *   5) 指标不重造：metricsSnapshot 冻结现有 geolens-v1 overall/byCategory/byQuery
 *      聚合结果 + M6B 竞对明细（如适用）。
 */

const LEGACY_RUN_VERSION = "m4-rule-v1";
const COMPETITOR_VERSION = "m6b-competitors-v1";
const TERMINAL_TASK = new Set(["SUCCEEDED", "FAILED", "PARTIAL", "CANCELLED"]);
type JsonValue = Prisma.InputJsonValue;

interface RunSnapshot {
  benchmarkRunId: string;
  projectId: string;
  runType: string;
  suiteName: string;
  suiteVersion: string;
  provider: string;
  engineKey: string;
  engineName: string;
  taskStatus: string;
  plannedRuns: number;
  completedRuns: number;
  failedRuns: number;
}

interface EvidenceSnapshotAnalysis {
  competitorSetId: string | null;
  competitorSetVersion: string | null;
  mentions: Array<{ entityId: string }>;
}
interface EvidenceSnapshotRow {
  runId: string;
  runStatus: string;
  evidence: {
    requestedModel: string | null;
    responseModel: string | null;
    analysis: EvidenceSnapshotAnalysis | null;
  } | null;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly db: PrismaService,
    private readonly tenant: TenantService,
    private readonly benchmark: BenchmarkService,
  ) {}

  // ---------------------------------------------------------------
  // 生成（快照，不覆盖）
  // ---------------------------------------------------------------

  async createReport(userId: string, benchmarkRunId: string, dto: CreateReportDto): Promise<any> {
    const run = await this.runSnapshot(userId, benchmarkRunId);

    // 资格守卫：必须已完成（终态）；PARTIAL/FAILED 允许但 snapshot.partial=true，
    // 报告显著标注「部分完成」并保留成功/失败样本分母。
    if (!TERMINAL_TASK.has(run.taskStatus)) {
      throw new BadRequestException(`Benchmark Run ${benchmarkRunId} 尚未完成（当前 ${run.taskStatus}），不能生成正式报告`);
    }

    const taskId = await this.taskIdFor(run.benchmarkRunId);
    const available = await this.availableAnalysisVersions(taskId);
    const analysisVersion = dto.analysisVersion ?? this.preferredVersion(available);
    if (!available.includes(analysisVersion)) {
      throw new BadRequestException(
        `该 Run 没有 analysisVersion=${analysisVersion} 的分析（可用：${available.join(" / ") || "无"}）。` +
        "报告必须明确绑定 analysisVersion，绝不默认漂移。",
      );
    }

    const evidenceRows = await this.evidenceRows(taskId, analysisVersion);
    const analyzedCount = evidenceRows.filter(row => row.evidence?.analysis !== null).length;

    // 全失败（0 成功）也允许出报告（保留失败分母），但若有成功样本就必须有分析行。
    const succeededRuns = evidenceRows.filter(row => row.runStatus === "SUCCEEDED").length;
    if (succeededRuns > 0 && analyzedCount === 0) {
      throw new BadRequestException(`analysisVersion=${analysisVersion} 尚无分析行，无法生成该版本报告`);
    }

    // Model identity：新 Evidence 的 requestedModel/responseModel 快照（历史为空则 null）。
    const identity = this.pickIdentity(evidenceRows);

    // 竞对明细（仅当所选分析版本带 Competitor Set）。
    const competitor = await this.buildCompetitor(run.projectId, evidenceRows, analysisVersion, dto.competitorSetId);

    // 指标快照：复用 geolens-v1（基准服务）——不重造指标，只冻结结果。
    const metrics = await this.benchmark.getMetrics(userId, benchmarkRunId, analysisVersion);
    const metricsSnapshot: JsonValue = JSON.parse(JSON.stringify({
      metricVersion: metrics.metricVersion,
      analysisVersion,
      metricSource: metrics.metricSource,
      overall: metrics.overall,
      byCategory: metrics.byCategory,
      byQuery: metrics.byQuery,
      competitor: competitor ? competitor.breakdown : null,
      note: "Report = 生成瞬间冻结的快照：测试集/分析版本/竞品集合/指标均不可因后续编辑而漂移。",
    })) as JsonValue;

    const generatedAt = new Date();
    const created = await this.db.client.benchmarkReport.create({
      data: {
        projectId: run.projectId,
        benchmarkRunId: run.benchmarkRunId,
        runType: run.runType as never,
        suiteName: run.suiteName,
        suiteVersion: run.suiteVersion,
        provider: run.provider,
        engineKey: run.engineKey,
        engineName: run.engineName,
        requestedModel: identity.requestedModel,
        responseModel: identity.responseModel,
        metricSource: metrics.metricSource,
        analysisVersion,
        competitorSetId: competitor?.set.id ?? null,
        competitorSetName: competitor?.set.name ?? null,
        competitorSetVersion: competitor?.set.version ?? null,
        completedRuns: run.completedRuns,
        succeededRuns,
        failedRuns: run.failedRuns,
        analyzedRuns: analyzedCount,
        partial: run.taskStatus !== "SUCCEEDED",
        metricsSnapshot,
        metadata: {
          identityModelCounts: identity.counts,
          analysisModelCounts: evidenceRows.length,
          generatedBy: "m6c-report-v1",
        } as JsonValue,
        generatedAt,
      },
    });
    return this.presentReport(created);
  }

  // ---------------------------------------------------------------
  // 查询
  // ---------------------------------------------------------------

  async listReports(userId: string, projectId: string): Promise<any> {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    const rows = await this.db.client.benchmarkReport.findMany({
      where: { projectId: project.id },
      orderBy: [{ generatedAt: "desc" }, { createdAt: "desc" }],
    });
    return rows.map(row => this.presentReport(row, { list: true }));
  }

  async getReport(userId: string, id: string): Promise<any> {
    const row = await this.reportForUser(userId, id);
    return this.presentReport(row);
  }

  /** Report → BenchmarkRun → Query → Run → Evidence 的可追溯行（不改 Evidence）。 */
  async reportEvidence(userId: string, id: string): Promise<any> {
    const report = await this.reportForUser(userId, id);
    const run = await this.db.client.benchmarkRun.findFirst({
      where: { id: report.benchmarkRunId },
      include: {
        runQueries: { orderBy: { sortOrder: "asc" } },
        monitorTask: { include: { runs: { include: {
          query: { select: { text: true } },
          evidence: { select: { id: true, analyses: { select: { analysisVersion: true } } } },
        } } } },
      },
    });
    if (!run) throw new NotFoundException("关联的 Benchmark Run 不存在");
    const byProjectQuery = new Map(run.runQueries.map(row => [row.projectQueryId, row]));
    const rows = run.monitorTask.runs.map(runRow => {
      const bench = byProjectQuery.get(runRow.queryId);
      return {
        runId: runRow.id,
        evidenceId: runRow.evidence?.id ?? null,
        queryText: bench?.queryText ?? runRow.query.text ?? null,
        category: bench?.category ?? null,
        intent: bench?.intent ?? null,
        sortOrder: bench?.sortOrder ?? null,
        sanity: bench?.sanity ?? false,
        status: runRow.status,
        analysisStatus: runRow.analysisStatus,
        hasSnapshotAnalysis: (runRow.evidence?.analyses ?? []).some(analysis => analysis.analysisVersion === report.analysisVersion),
      };
    });
    rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return { report: this.presentReport(report), rows };
  }

  // ---------------------------------------------------------------
  // Compare（Historical Comparison Foundation）
  // ---------------------------------------------------------------

  async compare(userId: string, dto: CompareReportsDto): Promise<any> {
    const a = await this.reportForUser(userId, dto.reportAId);
    const b = await this.reportForUser(userId, dto.reportBId);
    if (a.id === b.id) throw new BadRequestException("请选择两份不同的报告进行比较");

    const snapA = a.metricsSnapshot as Snapshot;
    const snapB = b.metricsSnapshot as Snapshot;

    const dims = this.compatibilityDimensions(a, b);
    // M6D 跨 Provider 语义：provider 不同但其余 hard 维度一致 → PARTIALLY_COMPARABLE
    // （跨模型比较正是 GEO 核心价值；绝不直接 NOT，也不冒充 COMPARABLE）。
    const hardMismatch = dims.some(dim => dim.severity === "hard" && !dim.compatible);
    const providerDiff = a.provider !== b.provider;
    const softMismatch = dims.some(dim => dim.severity === "soft" && !dim.compatible);
    const verdict: "COMPARABLE" | "PARTIALLY_COMPARABLE" | "NOT_COMPARABLE" =
      hardMismatch ? "NOT_COMPARABLE"
        : providerDiff ? "PARTIALLY_COMPARABLE"
          : softMismatch ? "PARTIALLY_COMPARABLE"
            : "COMPARABLE";

    // 成功样本差异（denominator 完整性）提示
    const warnings: string[] = [];
    if (a.succeededRuns !== b.succeededRuns) {
      warnings.push(
        `成功样本：报告 A ${a.succeededRuns}/${a.completedRuns + a.failedRuns} · 报告 B ${b.succeededRuns}/${b.completedRuns + b.failedRuns}；样本完整性不同，比较需谨慎。`,
      );
    }
    if (verdict === "PARTIALLY_COMPARABLE" && providerDiff) {
      warnings.unshift(
        "模型服务不同：测试问题、分析规则与竞品口径一致，但引擎不同，因此结果用于比较不同 AI 引擎的品牌表现；模型差异不应解读为单一口径的回归。",
      );
    } else if (verdict !== "COMPARABLE") {
      warnings.unshift("比较口径不同，结果仅供参考 —— 请先核对上表中的差异维度，不要无警告解读 Δ。");
    }

    // 数值对比（overall + byCategory），null 视为无数据（delta=null）。
    const overallKeys = ["visibilityRate", "recommendationRate", "averageMentionPosition", "shareOfVoice", "citationCount", "citationDomainCount"] as const;
    const deltaOverall = overallKeys.map(key => ({
      metric: key,
      a: numberOrNull(snapA.overall[key]),
      b: numberOrNull(snapB.overall[key]),
      delta: deltaOf(snapA.overall[key], snapB.overall[key]),
    }));

    const catMap = new Map<string, { a: MetricsLike | null; b: MetricsLike | null }>();
    for (const row of snapA.byCategory) catMap.set(row.category, { a: row.metrics, b: null });
    for (const row of snapB.byCategory) {
      const entry = catMap.get(row.category) ?? { a: null, b: row.metrics };
      entry.b = row.metrics;
      catMap.set(row.category, entry);
    }
    const byCategory = [...catMap.entries()]
      .map(([category, both]) => ({
        category,
        a: both.a ? metricsSummary(both.a) : null,
        b: both.b ? metricsSummary(both.b) : null,
        delta: both.a && both.b ? {
          visibilityRate: deltaOf(both.a.visibilityRate, both.b.visibilityRate),
          recommendationRate: deltaOf(both.a.recommendationRate, both.b.recommendationRate),
        } : null,
      }))
      .sort((x, y) => x.category.localeCompare(y.category));

    return {
      compatibility: { verdict, dimensions: dims.map(dim => ({ key: dim.key, a: dim.a, b: dim.b, compatible: dim.compatible })) },
      reports: {
        a: this.reportIdentity(a),
        b: this.reportIdentity(b),
      },
      deltaOverall,
      byCategory,
      warnings,
    };
  }

  // ---------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------

  private async runSnapshot(userId: string, benchmarkRunId: string): Promise<RunSnapshot> {
    const run = await this.db.client.benchmarkRun.findFirst({
      where: { id: benchmarkRunId, organization: { members: { some: { userId } } } },
      include: {
        engine: { select: { key: true, name: true, provider: true } },
        monitorTask: { select: { status: true, totalRuns: true, completedRuns: true, failedRuns: true } },
      },
    });
    if (!run) throw new NotFoundException("Benchmark Run 不存在或无权访问");
    return {
      benchmarkRunId: run.id,
      projectId: run.projectId,
      runType: run.runType,
      suiteName: run.suiteName,
      suiteVersion: run.suiteVersion,
      provider: run.provider,
      engineKey: run.engine.key,
      engineName: run.engine.name,
      taskStatus: run.monitorTask.status,
      plannedRuns: run.monitorTask.totalRuns,
      completedRuns: run.monitorTask.completedRuns,
      failedRuns: run.monitorTask.failedRuns,
    };
  }

  private async taskIdFor(benchmarkRunId: string): Promise<string> {
    const run = await this.db.client.benchmarkRun.findUnique({ where: { id: benchmarkRunId }, select: { monitorTaskId: true } });
    if (!run) throw new NotFoundException("Benchmark Run 不存在");
    return run.monitorTaskId;
  }

  private async availableAnalysisVersions(monitorTaskId: string): Promise<string[]> {
    const rows = await this.db.client.analysis.findMany({
      where: { evidence: { run: { monitorTaskId } } },
      select: { analysisVersion: true },
      distinct: ["analysisVersion"],
    });
    return rows.map(row => row.analysisVersion);
  }

  private preferredVersion(available: string[]): string {
    if (available.includes(COMPETITOR_VERSION)) return COMPETITOR_VERSION;
    if (available.includes(LEGACY_RUN_VERSION)) return LEGACY_RUN_VERSION;
    return available[0] ?? LEGACY_RUN_VERSION;
  }

  private async evidenceRows(monitorTaskId: string, analysisVersion: string): Promise<EvidenceSnapshotRow[]> {
    const runs = await this.db.client.run.findMany({
      where: { monitorTaskId },
      include: {
        evidence: {
          include: {
            analyses: {
              where: { analysisVersion },
              include: { mentions: { where: { entityType: "competitor" }, select: { entityId: true } } },
            },
          },
        },
      },
    });
    return runs.map(runRow => ({
      runId: runRow.id,
      runStatus: runRow.status,
      evidence: runRow.evidence
        ? { requestedModel: runRow.evidence.requestedModel, responseModel: runRow.evidence.responseModel, analysis: runRow.evidence.analyses[0] ?? null }
        : null,
    }));
  }

  private pickIdentity(rows: EvidenceSnapshotRow[]) {
    const requested = new Map<string, number>();
    const responded = new Map<string, number>();
    for (const row of rows) {
      const evidence = row.evidence;
      if (!evidence) continue;
      if (evidence.requestedModel) requested.set(evidence.requestedModel, (requested.get(evidence.requestedModel) ?? 0) + 1);
      if (evidence.responseModel) responded.set(evidence.responseModel, (responded.get(evidence.responseModel) ?? 0) + 1);
    }
    const top = (map: Map<string, number>): string | null => {
      let best: string | null = null;
      let bestCount = 0;
      for (const [value, count] of map) {
        if (count > bestCount || (count === bestCount && best !== null && value < best)) { best = value; bestCount = count; }
      }
      return best;
    };
    return {
      requestedModel: top(requested),
      responseModel: top(responded),
      counts: { requested: [...requested.entries()], response: [...responded.entries()] },
    };
  }

  /** M6B 竞对明细：仅当所选分析版本的分析行带 Competitor Set 时输出。 */
  private async buildCompetitor(
    projectId: string,
    rows: EvidenceSnapshotRow[],
    analysisVersion: string,
    requestedSetId: string | undefined,
  ) {
    if (analysisVersion !== COMPETITOR_VERSION) return null;
    const setIds = [...new Set(rows
      .map(row => row.evidence?.analysis?.competitorSetId)
      .filter((id): id is string => Boolean(id)))];
    if (setIds.length === 0) return null;
    let setId = setIds[0];
    if (requestedSetId) {
      if (!setIds.includes(requestedSetId)) {
        throw new BadRequestException(`指定的 competitorSetId=${requestedSetId} 与该 Run 分析记录不一致（${setIds.join(",") || "无"}）`);
      }
      setId = requestedSetId;
    } else if (setIds.length > 1) {
      throw new BadRequestException(`该 Run 的分析跨多个 Competitor Set（${setIds.join(", ")}），请显式指定 competitorSetId`);
    }
    const set = await this.db.client.competitorSet.findUnique({
      where: { id: setId },
      include: { entries: { orderBy: { sortOrder: "asc" } } },
    });
    if (!set) throw new BadRequestException("快照引用的 Competitor Set 不存在（已删除？历史报告应改用既有快照）");

    const mentionByEntity = new Map<string, { mentions: number; evidence: Set<string> }>();
    let mentionTotal = 0;
    for (const row of rows) {
      const analysis = row.evidence?.analysis;
      if (!analysis || row.runStatus !== "SUCCEEDED") continue;
      for (const mention of analysis.mentions) {
        const entry = mentionByEntity.get(mention.entityId) ?? { mentions: 0, evidence: new Set<string>() };
        entry.mentions += 1;
        entry.evidence.add(row.runId);
        mentionByEntity.set(mention.entityId, entry);
        mentionTotal += 1;
      }
    }

    const competitors = set.entries.map(entry => {
      const found = mentionByEntity.get(entry.candidateId);
      return {
        candidateId: entry.candidateId,
        canonicalName: entry.canonicalName,
        competitorType: entry.competitorType,
        mentionCount: found?.mentions ?? 0,
        evidenceCount: found?.evidence.size ?? 0,
        shareOfVoice: mentionTotal ? (found?.mentions ?? 0) / mentionTotal : null,
      };
    });

    return {
      set: { id: set.id, name: set.name, version: set.version, status: set.status },
      breakdown: {
        status: "ready" as const,
        competitorSet: { id: set.id, name: set.name, version: set.version },
        competitors,
        note: "样本量较小，仅作为竞品发现与比较信号 —— 不代表稳定行业结论",
      },
    };
  }

  private compatibilityDimensions(a: ReportRow, b: ReportRow) {
    const dims: Array<{ key: string; a: string | null; b: string | null; compatible: boolean; severity: "soft" | "hard" | "cross" }> = [
      { key: "suiteVersion", a: a.suiteVersion, b: b.suiteVersion, compatible: a.suiteVersion === b.suiteVersion, severity: "hard" },
      { key: "metricSource", a: a.metricSource, b: b.metricSource, compatible: a.metricSource === b.metricSource, severity: "hard" },
      { key: "provider", a: a.provider, b: b.provider, compatible: a.provider === b.provider, severity: "cross" },
      { key: "analysisVersion", a: a.analysisVersion, b: b.analysisVersion, compatible: a.analysisVersion === b.analysisVersion, severity: "hard" },
      { key: "requestedModel", a: a.requestedModel ?? null, b: b.requestedModel ?? null, compatible: (a.requestedModel ?? null) === (b.requestedModel ?? null), severity: "soft" },
      { key: "responseModel", a: a.responseModel ?? null, b: b.responseModel ?? null, compatible: (a.responseModel ?? null) === (b.responseModel ?? null), severity: "soft" },
      {
        key: "competitorSetVersion",
        a: a.competitorSetVersion ?? null,
        b: b.competitorSetVersion ?? null,
        compatible: (a.competitorSetVersion ?? null) === (b.competitorSetVersion ?? null),
        severity: "hard",
      },
    ];
    // 模型身份「未知 vs 值」降为 soft（不直接判 NOT）。
    return dims.map(dim => dim.key === "provider"
      ? dim
      : dim.key.startsWith("requested") || dim.key.startsWith("response")
        ? { ...dim, compatible: dim.compatible || dim.a === null || dim.b === null, severity: "soft" as const }
        : dim);
  }

  private async reportForUser(userId: string, id: string): Promise<ReportRow> {
    const row = await this.db.client.benchmarkReport.findFirst({
      where: { id, project: { organization: { members: { some: { userId } } } } },
    });
    if (!row) throw new NotFoundException("报告不存在或无权访问");
    return row;
  }

  private presentReport(row: ReportRow, options: { list?: boolean } = {}) {
    const snapshot = (row.metricsSnapshot ?? {}) as Snapshot;
    const base = {
      id: row.id,
      benchmarkRunId: row.benchmarkRunId,
      runType: row.runType,
      suiteName: row.suiteName,
      suiteVersion: row.suiteVersion,
      provider: row.provider,
      engineKey: row.engineKey,
      engineName: row.engineName,
      requestedModel: row.requestedModel,
      responseModel: row.responseModel,
      metricSource: row.metricSource,
      analysisVersion: row.analysisVersion,
      competitorSet: row.competitorSetId
        ? { id: row.competitorSetId, name: row.competitorSetName, version: row.competitorSetVersion }
        : null,
      completion: {
        completedRuns: row.completedRuns,
        succeededRuns: row.succeededRuns,
        failedRuns: row.failedRuns,
        analyzedRuns: row.analyzedRuns,
        partial: row.partial,
      },
      generatedAt: row.generatedAt,
      createdAt: row.createdAt,
    };
    if (options.list) {
      const overall = snapshot.overall;
      return {
        ...base,
        summary: {
          visibilityRate: overall?.visibilityRate ?? null,
          recommendationRate: overall?.recommendationRate ?? null,
        },
      };
    }
    return { ...base, metricsSnapshot: snapshot, metadata: row.metadata };
  }

  private reportIdentity(row: ReportRow) {
    return {
      id: row.id,
      suite: `${row.suiteName} v${row.suiteVersion}`,
      provider: row.provider,
      engineName: row.engineName,
      requestedModel: row.requestedModel,
      responseModel: row.responseModel,
      metricSource: row.metricSource,
      analysisVersion: row.analysisVersion,
      competitorSet: row.competitorSetId ? `${row.competitorSetName} v${row.competitorSetVersion}` : null,
      completion: { succeededRuns: row.succeededRuns, completedRuns: row.completedRuns, failedRuns: row.failedRuns, partial: row.partial },
      generatedAt: row.generatedAt,
    };
  }
}

/* ------------------------------------------------------------------ */
/* 类型辅助                                                             */
/* ------------------------------------------------------------------ */

interface SnapshotOverall {
  visibilityRate: number | null; recommendationRate: number | null;
  averageMentionPosition: number | null; shareOfVoice: number | null;
  citationCount: number; citationDomainCount: number;
}
interface Snapshot {
  metricVersion: string;
  metricSource: string;
  analysisVersion: string;
  overall: SnapshotOverall;
  byCategory: Array<{ category: string; queryEligibleCount: number; queryMentionedCount: number; metrics: MetricsLike }>;
  byQuery: Array<Record<string, unknown>>;
  competitor: unknown;
}
interface MetricsLike {
  visibilityRate: number | null; recommendationRate: number | null;
  averageMentionPosition: number | null; shareOfVoice: number | null;
  citationCount: number; citationDomainCount: number;
  analyzedRuns?: number; queryEligibleCount?: number; queryMentionedCount?: number;
}

type ReportRow = {
  id: string; projectId: string; benchmarkRunId: string; runType: string;
  suiteName: string; suiteVersion: string; provider: string; engineKey: string; engineName: string;
  requestedModel: string | null; responseModel: string | null;
  metricSource: string; analysisVersion: string;
  competitorSetId: string | null; competitorSetName: string | null; competitorSetVersion: string | null;
  completedRuns: number; succeededRuns: number; failedRuns: number; analyzedRuns: number;
  partial: boolean; metricsSnapshot: unknown; metadata: unknown;
  generatedAt: Date; createdAt: Date;
};

const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const deltaOf = (aValue: unknown, bValue: unknown): number | null => {
  const a = numberOrNull(aValue);
  const b = numberOrNull(bValue);
  if (a === null || b === null) return null;
  return b - a;
};

function metricsSummary(metrics: MetricsLike) {
  return {
    visibilityRate: numberOrNull(metrics.visibilityRate),
    recommendationRate: numberOrNull(metrics.recommendationRate),
    averageMentionPosition: numberOrNull(metrics.averageMentionPosition),
    shareOfVoice: numberOrNull(metrics.shareOfVoice),
    citationCount: numberOrNull(metrics.citationCount),
    citationDomainCount: numberOrNull(metrics.citationDomainCount),
  };
}
