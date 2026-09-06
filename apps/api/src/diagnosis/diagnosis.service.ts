import {
  BadRequestException, Injectable, Logger, NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@geo/database";
import {
  DIAGNOSIS_VERSION, runDiagnosis, supportedFindingTypes,
  type DiagnosisCandidate, type DiagnosisComparisonFacts, type DiagnosisInput,
  type DiagnosisQueryFact, type DiagnosisReportFacts,
} from "@geo/core";
import { PrismaService } from "../prisma.service";
import { TenantService } from "../common/tenant.service";
import { ReportsService } from "../reports/reports.service";
import { CreateDiagnosisDto } from "./dto/create-diagnosis.dto";

/**
 * M7A GEO Diagnosis API。
 *
 * 语义：
 *   1) Diagnosis 绑定 BenchmarkReport（快照）—— 用 report.analysisVersion 读取该
 *      Run 的既有 Analysis；规则引擎纯函数（geo-core diagnosis.ts，确定性）。
 *   2) 幂等：同一 (reportId, diagnosisVersion, secondaryReportId[null 等价])
 *      视为同一输入，重复 POST 返回既有 DiagnosisRun（不无限堆快照）。
 *   3) Provider Gap：secondaryReportId 必须可比（NOT_COMPARABLE → 400）；
 *      引擎仅在该输入下输出 PROVIDER_GAP。
 *   4) FindingEvidence 只归档 evidenceId/runId/queryText 快照，绝不复制
 *      rawResponse —— Evidence 仍是唯一事实源且不可变。
 */
type JsonValue = Prisma.InputJsonValue;
const logger = new Logger("DiagnosisService");

interface ReportLike {
  id: string; projectId: string; benchmarkRunId: string;
  suiteName: string; suiteVersion: string; provider: string;
  engineKey: string; engineName: string;
  requestedModel: string | null; responseModel: string | null;
  metricSource: string; analysisVersion: string;
  competitorSetId: string | null; competitorSetName: string | null; competitorSetVersion: string | null;
  completedRuns: number; succeededRuns: number; failedRuns: number; analyzedRuns: number;
  partial: boolean; metricsSnapshot: unknown; generatedAt: Date;
}

@Injectable()
export class DiagnosisService {
  constructor(
    private readonly db: PrismaService,
    private readonly tenant: TenantService,
    private readonly reports: ReportsService,
  ) {}

  // ---------------------------------------------------------------
  // 生成
  // ---------------------------------------------------------------
  async createDiagnosis(userId: string, reportId: string, dto: CreateDiagnosisDto) {
    const report = await this.reportForUser(userId, reportId);
    const secondaryId = dto.secondaryReportId ?? null;

    // 幂等：同输入直接返回既有 DiagnosisRun。
    const existing = await this.db.client.diagnosisRun.findFirst({
      where: {
        reportId: report.id, diagnosisVersion: DIAGNOSIS_VERSION,
        ...(secondaryId ? { secondaryReportId: secondaryId } : { secondaryReportId: null }),
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      logger.log(JSON.stringify({ event: "diagnosis_idempotent_hit", diagnosisRunId: existing.id, reportId: report.id, diagnosisVersion: DIAGNOSIS_VERSION, secondaryReportId: secondaryId }));
      return this.presentRun(existing, { reused: true });
    }

    // Provider Gap 对比（可空）：NOT_COMPARABLE 直接拒绝。
    let comparison: DiagnosisComparisonFacts | null = null;
    let comparisonVerdict: string | null = null;
    if (secondaryId) {
      const secondary = await this.reportForUser(userId, secondaryId);
      const compare = await this.reports.compare(userId, { reportAId: report.id, reportBId: secondary.id });
      if (compare.compatibility.verdict === "NOT_COMPARABLE") {
        throw new BadRequestException(
          `secondaryReport 与报告不可比（${this.describeHardMismatch(compare.compatibility.dimensions)}）—— 跨套件/跨口径无法做 Provider 对比诊断`,
        );
      }
      comparisonVerdict = compare.compatibility.verdict;
      comparison = this.toComparisonFacts(secondary);
    }

    const input = await this.buildEngineInput(report, comparison);

    const started = Date.now();
    const { candidates, summary } = runDiagnosis(input);
    const supported = supportedFindingTypes(input);

    const generatedAt = new Date();
    const created = await this.db.client.$transaction(async tx => {
      const run = await tx.diagnosisRun.create({
        data: {
          projectId: report.projectId,
          reportId: report.id,
          diagnosisVersion: DIAGNOSIS_VERSION,
          secondaryReportId: secondaryId,
          status: "READY",
          summarySnapshot: JSON.parse(JSON.stringify(summary)) as JsonValue,
          metadata: {
            supportedFindingTypes: supported,
            comparisonVerdict,
            engineDurationMs: Date.now() - started,
            generatedBy: "m7a-diagnosis-v1",
            note: "阈值属 GeoLens internal heuristic（geolens-diagnosis-v1），非行业标准、非 LLM 因果推断。",
          } as JsonValue,
          generatedAt,
        },
      });
      for (const c of candidates) {
        await tx.diagnosisFinding.create({
          data: {
            diagnosisRunId: run.id,
            findingType: c.findingType,
            severity: c.severity as never,
            category: c.category,
            title: c.title,
            summary: c.summary,
            explanation: c.explanation,
            metricName: c.metricName,
            currentValue: c.currentValue,
            referenceValue: c.referenceValue,
            queryCount: c.queryCount,
            evidenceCount: c.evidenceCount,
            provider: c.provider,
            requestedModel: c.requestedModel,
            responseModel: c.responseModel,
            competitorName: c.competitorName,
            priorityScore: c.priorityScore,
            metadata: {} as JsonValue,
            evidenceLinks: {
              create: c.evidenceLinks.map(link => ({
                evidenceId: link.evidenceId, runId: link.runId,
                queryTextSnapshot: link.queryText, reason: link.reason,
              })),
            },
          },
        });
      }
      return run;
    });

    logger.log(JSON.stringify({
      event: "diagnosis_created", diagnosisRunId: created.id, reportId: report.id,
      diagnosisVersion: DIAGNOSIS_VERSION, findingCount: candidates.length,
      severity: summary.severityCounts, durationMs: Date.now() - started,
    }));
    return this.presentRun(created);
  }

  // ---------------------------------------------------------------
  // 查询
  // ---------------------------------------------------------------
  async listByReport(userId: string, reportId: string) {
    const report = await this.reportForUser(userId, reportId);
    const rows = await this.db.client.diagnosisRun.findMany({
      where: { reportId: report.id },
      orderBy: [{ generatedAt: "desc" }, { createdAt: "desc" }],
      include: { _count: { select: { findings: true } } },
    });
    return rows.map(row => this.presentRun(row, { withFindingCount: true }));
  }

  async get(userId: string, id: string) {
    const run = await this.runForUser(userId, id);
    return this.presentRun(run);
  }

  async findings(userId: string, id: string) {
    const run = await this.runForUser(userId, id);
    const rows = await this.db.client.diagnosisFinding.findMany({
      where: { diagnosisRunId: run.id },
      include: { evidenceLinks: { orderBy: { createdAt: "asc" } } },
    });
    // Postgres enum 顺序不可依赖 → JS 确定性排序：severity 权重 → priority → created
    const severityWeight: Record<string, number> = { HIGH: 100, MEDIUM: 60, LOW: 30, INFO: 10 };
    rows.sort((a, b) =>
      (severityWeight[b.severity] ?? 0) - (severityWeight[a.severity] ?? 0)
      || b.priorityScore - a.priorityScore
      || a.createdAt.getTime() - b.createdAt.getTime());
    return { diagnosisRun: this.presentRun(run), findings: rows.map(this.presentFinding) };
  }

  async getFinding(userId: string, findingId: string) {
    const finding = await this.findingForUser(userId, findingId);
    return this.presentFinding(finding);
  }

  async findingEvidence(userId: string, findingId: string) {
    const finding = await this.findingForUser(userId, findingId);
    const links = await this.db.client.diagnosisFindingEvidence.findMany({
      where: { findingId: finding.id },
      orderBy: { createdAt: "asc" },
    });
    return {
      finding: this.presentFinding(finding),
      evidence: links.map(link => ({
        id: link.id, evidenceId: link.evidenceId, runId: link.runId,
        queryTextSnapshot: link.queryTextSnapshot, reason: link.reason,
      })),
    };
  }

  // ---------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------
  private async reportForUser(userId: string, reportId: string): Promise<ReportLike> {
    const row = await this.db.client.benchmarkReport.findFirst({
      where: { id: reportId, project: { organization: { members: { some: { userId } } } } },
    });
    if (!row) throw new NotFoundException("报告不存在或无权访问");
    return row as unknown as ReportLike;
  }

  private async runForUser(userId: string, id: string) {
    const run = await this.db.client.diagnosisRun.findFirst({
      where: { id, project: { organization: { members: { some: { userId } } } } },
    });
    if (!run) throw new NotFoundException("诊断不存在或无权访问");
    return run;
  }

  private async findingForUser(userId: string, findingId: string) {
    const finding = await this.db.client.diagnosisFinding.findFirst({
      where: { id: findingId, diagnosisRun: { project: { organization: { members: { some: { userId } } } } } },
      include: { evidenceLinks: { orderBy: { createdAt: "asc" } } },
    });
    if (!finding) throw new NotFoundException("诊断项不存在或无权访问");
    return finding;
  }

  private describeHardMismatch(dimensions: Array<{ key: string; a: string | null; b: string | null; compatible: boolean }>): string {
    const bad = dimensions.filter(d => !d.compatible);
    return bad.map(d => `${d.key}: ${d.a ?? "null"} ≠ ${d.b ?? "null"}`).join("；") || "口径不一致";
  }

  private toComparisonFacts(report: ReportLike): DiagnosisComparisonFacts {
    const snapshot = (report.metricsSnapshot ?? {}) as Record<string, any>;
    const overall = snapshot.overall ?? {};
    return {
      reportId: report.id,
      provider: report.provider,
      engineName: report.engineName,
      requestedModel: report.requestedModel,
      responseModel: report.responseModel,
      suiteVersion: report.suiteVersion,
      metricSource: report.metricSource,
      analysisVersion: report.analysisVersion,
      competitorSetVersion: report.competitorSetVersion,
      succeededRuns: report.succeededRuns,
      partial: report.partial,
      overall: this.metricSummary(overall),
      byCategory: ((snapshot.byCategory ?? []) as Array<Record<string, any>>).map(row => ({
        category: String(row.category),
        metrics: this.metricSummary(row.metrics ?? {}),
      })),
    };
  }

  private metricSummary(o: Record<string, any>): DiagnosisReportFacts["overall"] {
    const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
    return {
      visibilityRate: num(o.visibilityRate),
      recommendationRate: num(o.recommendationRate),
      averageMentionPosition: num(o.averageMentionPosition),
      shareOfVoice: num(o.shareOfVoice),
      citationCount: num(o.citationCount) ?? 0,
      citationDomainCount: num(o.citationDomainCount) ?? 0,
      sentimentDistribution: typeof o.sentimentDistribution === "object" && o.sentimentDistribution !== null
        ? o.sentimentDistribution as Record<string, number>
        : {},
    };
  }

  /** 组装引擎输入：Report 快照事实 + run/evidence/analysis 逐 query 事实。 */
  private async buildEngineInput(report: ReportLike, comparison: DiagnosisComparisonFacts | null): Promise<DiagnosisInput> {
    const snapshot = (report.metricsSnapshot ?? {}) as Record<string, any>;
    const overall = this.metricSummary(snapshot.overall ?? {});
    const byCategory = ((snapshot.byCategory ?? []) as Array<Record<string, any>>).map(row => ({
      category: String(row.category),
      queryEligibleCount: Number(row.queryEligibleCount ?? 0),
      queryMentionedCount: Number(row.queryMentionedCount ?? 0),
      metrics: this.metricSummary(row.metrics ?? {}),
    }));
    const competitorSnap = snapshot.competitor;
    const competitorBreakdown = competitorSnap && competitorSnap.status === "ready"
      ? ((competitorSnap.competitors ?? []) as Array<Record<string, any>>).map(c => ({
          candidateId: String(c.candidateId),
          canonicalName: String(c.canonicalName),
          competitorType: String(c.competitorType),
          mentionCount: Number(c.mentionCount ?? 0),
          evidenceCount: Number(c.evidenceCount ?? 0),
          shareOfVoice: typeof c.shareOfVoice === "number" && Number.isFinite(c.shareOfVoice) ? c.shareOfVoice : null,
        }))
      : null;

    // 已审核竞品集合（激活 Competitor Set 的 entries —— canonicalName + id 集）。
    let approvedEntries: Array<{ id: string; canonicalName: string }> = [];
    if (report.competitorSetId) {
      const set = await this.db.client.competitorSet.findUnique({
        where: { id: report.competitorSetId },
        include: { entries: true },
      });
      approvedEntries = (set?.entries ?? []).map(entry => ({ id: entry.candidateId, canonicalName: entry.canonicalName }));
    }
    const approvedIds = new Set(approvedEntries.map(e => e.id));

    // Run → Evidence → Analysis(version) + BenchmarkRunQuery 快照对齐。
    const runRow = await this.db.client.benchmarkRun.findFirst({
      where: { id: report.benchmarkRunId },
      include: {
        runQueries: true,
        monitorTask: { include: { runs: { include: {
          query: { select: { text: true } },
          evidence: {
            include: { analyses: { where: { analysisVersion: report.analysisVersion }, include: { mentions: true, citations: { select: { domain: true } } } } },
          },
        } } } },
      },
    });
    if (!runRow) throw new NotFoundException("关联的 Benchmark Run 不存在");
    const byProjectQuery = new Map(runRow.runQueries.map(q => [q.projectQueryId, q]));

    // comparison 侧缺席问题集（供 QUERY_GAP 跨模型条件）。
    const absentInComparison = comparison ? await this.absentTexts(comparison.reportId) : new Set<string>();

    const queries: DiagnosisQueryFact[] = runRow.monitorTask.runs.map(runItem => {
      const bench = byProjectQuery.get(runItem.queryId);
      const analysis = runItem.evidence?.analyses[0] ?? null;
      const competitorPositive = analysis
        ? analysis.mentions.some(m => m.entityType === "competitor" && approvedIds.has(m.entityId) && m.sentiment === "positive")
        : false;
      const hasAnalysis = Boolean(analysis);
      return {
        runId: runItem.id,
        evidenceId: runItem.evidence?.id ?? null,
        queryText: bench?.queryText ?? runItem.query.text,
        category: bench?.category ?? null,
        intent: bench?.intent ?? null,
        sortOrder: bench?.sortOrder ?? null,
        sanity: bench?.sanity ?? false,
        status: runItem.status,
        analysisVersion: analysis?.analysisVersion ?? null,
        brandMentioned: analysis ? analysis.brandMentioned : null,
        mentionPosition: analysis ? analysis.mentionPosition : null,
        recommended: analysis ? analysis.recommended : null,
        sentiment: analysis ? analysis.sentiment : null,
        citationCount: analysis ? analysis.citations.length : null,
        competitorPositive,
        absentInComparison: absentInComparison.has(bench?.queryText ?? runItem.query.text),
      };
    });

    const reportFacts: DiagnosisReportFacts = {
      reportId: report.id,
      projectId: report.projectId,
      suiteName: report.suiteName,
      suiteVersion: report.suiteVersion,
      provider: report.provider,
      engineKey: report.engineKey,
      engineName: report.engineName,
      requestedModel: report.requestedModel,
      responseModel: report.responseModel,
      metricSource: report.metricSource,
      analysisVersion: report.analysisVersion,
      competitorSetId: report.competitorSetId,
      competitorSetName: report.competitorSetName,
      competitorSetVersion: report.competitorSetVersion,
      completedRuns: report.completedRuns,
      succeededRuns: report.succeededRuns,
      failedRuns: report.failedRuns,
      analyzedRuns: report.analyzedRuns,
      partial: report.partial,
      overall,
      byCategory,
      competitor: competitorBreakdown,
      approvedCompetitors: approvedEntries.map(e => e.canonicalName),
    };

    return {
      diagnosisVersion: DIAGNOSIS_VERSION,
      report: reportFacts,
      comparison,
      queries,
    };
  }

  /** 另一份报告中间题品牌缺席的 queryText 集（按 Analysis 同版本判定）。 */
  private async absentTexts(reportId: string): Promise<Set<string>> {
    const report = await this.db.client.benchmarkReport.findUnique({
      where: { id: reportId },
      select: { benchmarkRunId: true, analysisVersion: true },
    });
    if (!report) return new Set();
    const runRow = await this.db.client.benchmarkRun.findFirst({
      where: { id: report.benchmarkRunId },
      include: {
        runQueries: true,
        monitorTask: { include: { runs: { include: {
          query: { select: { text: true } },
          evidence: { include: { analyses: { where: { analysisVersion: report.analysisVersion }, select: { brandMentioned: true } } } },
        } } } },
      },
    });
    const absent = new Set<string>();
    if (!runRow) return absent;
    const byProjectQuery = new Map(runRow.runQueries.map(q => [q.projectQueryId, q]));
    for (const runItem of runRow.monitorTask.runs) {
      const bench = byProjectQuery.get(runItem.queryId);
      const analysis = runItem.evidence?.analyses[0];
      if (runItem.status === "SUCCEEDED" && analysis && analysis.brandMentioned === false) {
        absent.add(bench?.queryText ?? runItem.query.text);
      }
    }
    return absent;
  }

  // ---------------------------------------------------------------
  // Present
  // ---------------------------------------------------------------
  private presentRun(run: any, options: { withFindingCount?: boolean; reused?: boolean } = {}) {
    return {
      id: run.id,
      reportId: run.reportId,
      projectId: run.projectId,
      diagnosisVersion: run.diagnosisVersion,
      secondaryReportId: run.secondaryReportId,
      status: run.status,
      summary: run.summarySnapshot,
      generatedAt: run.generatedAt,
      createdAt: run.createdAt,
      metadata: run.metadata,
      ...(options.withFindingCount ? { findingCount: run._count?.findings ?? run.findingCount ?? null } : {}),
      ...(options.reused ? { reused: true } : {}),
    };
  }

  private presentFinding(finding: any) {
    return {
      id: finding.id,
      diagnosisRunId: finding.diagnosisRunId,
      findingType: finding.findingType,
      severity: finding.severity,
      category: finding.category,
      title: finding.title,
      summary: finding.summary,
      explanation: finding.explanation,
      metricName: finding.metricName,
      currentValue: finding.currentValue,
      referenceValue: finding.referenceValue,
      queryCount: finding.queryCount,
      evidenceCount: finding.evidenceCount,
      provider: finding.provider,
      requestedModel: finding.requestedModel,
      responseModel: finding.responseModel,
      competitorName: finding.competitorName,
      priorityScore: finding.priorityScore,
      createdAt: finding.createdAt,
      evidence: (finding.evidenceLinks ?? []).map((link: any) => ({
        id: link.id, evidenceId: link.evidenceId, runId: link.runId,
        queryText: link.queryTextSnapshot, reason: link.reason,
      })),
    };
  }
}
