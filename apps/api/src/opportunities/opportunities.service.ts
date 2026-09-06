import {
  BadRequestException, Injectable, Logger, NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@geo/database";
import {
  CONTENT_OPPORTUNITY_VERSION, buildContentOpportunities,
  type OpportunityEngineFact, type OpportunityEngineInput,
  type OpportunityFindingInput, type OpportunityQueryFact,
  type OpportunityRecommendationInput,
} from "@geo/core";
import { PrismaService } from "../prisma.service";
import { UpdateOpportunityStatusDto, OPPORTUNITY_STATUS_TRANSITIONS } from "./dto/update-opportunity-status.dto";

/**
 * M7C Content Opportunities API。
 * 语义：
 *   1) ContentOpportunityRun 绑定 RecommendationRun；Opportunity 关联一个或多个
 *      Recommendation（Recommendation→Finding→Evidence 全链可回查）。
 *   2) Snapshot + 幂等：同 (recommendationRunId, opportunityVersion) 重复 POST 返回既有 Run。
 *   3) Query 来自 DiagnosisFindingEvidence.queryTextSnapshot + BenchmarkRunQuery 快照对齐；
 *      引擎不实时 join 当前 Project Query（历史语义不漂移）。
 *   4) Target Engines 来自 Evidence provenance；Target Competitors 只允许已审核竞品
 *      （来源 Report Competitor Set 的 approved entries）。
 *   5) Status 仅人工流转（PROPOSED/APPROVED/DISMISSED），无 EXECUTING。
 */
type JsonValue = Prisma.InputJsonValue;
const logger = new Logger("OpportunitiesService");

@Injectable()
export class OpportunitiesService {
  constructor(private readonly db: PrismaService) {}

  // ---------------------------------------------------------------
  // 生成（幂等）
  // ---------------------------------------------------------------
  async createFromRecommendations(userId: string, recommendationRunId: string) {
    const recRun = await this.recommendationRunForUser(userId, recommendationRunId);

    const existing = await this.db.client.contentOpportunityRun.findFirst({
      where: { recommendationRunId: recRun.id, opportunityVersion: CONTENT_OPPORTUNITY_VERSION },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { opportunities: true } } },
    });
    if (existing) {
      logger.log(JSON.stringify({ event: "content_opportunity_idempotent_hit", contentOpportunityRunId: existing.id, recommendationRunId: recRun.id, opportunityVersion: CONTENT_OPPORTUNITY_VERSION }));
      return this.presentRun(existing, { withCounts: true, reused: true });
    }

    // ---- 来源上下文：DiagnosisRun → Report（快照 provenance）----
    const diagnosisRun = await this.db.client.diagnosisRun.findUnique({ where: { id: recRun.diagnosisRunId } });
    if (!diagnosisRun) throw new NotFoundException("来源诊断不存在");
    const report = await this.db.client.benchmarkReport.findUnique({ where: { id: diagnosisRun.reportId } });
    if (!report) throw new NotFoundException("来源报告不存在");

    const metricSource = (recRun.metadata as Record<string, unknown> | null)?.metricSource as string | undefined
      ?? report.metricSource;

    // 数据质量守卫（规则同 M7B）：诊断内存在 HIGH/MEDIUM DATA_QUALITY_WARNING。
    const dqCount = await this.db.client.diagnosisFinding.count({
      where: { diagnosisRunId: diagnosisRun.id, findingType: "DATA_QUALITY_WARNING", severity: { in: ["HIGH", "MEDIUM"] as never } },
    });
    const hasDataQualityIssue = dqCount > 0;

    // 已审核竞品语义：来自 Report 激活 Competitor Set 的 entries（approved canonicalName + type）。
    let approvedCompetitors: Array<{ canonicalName: string; competitorType: string | null }> = [];
    let approvedIds = new Set<string>();
    if (report.competitorSetId) {
      const set = await this.db.client.competitorSet.findUnique({
        where: { id: report.competitorSetId },
        include: { entries: true },
      });
      approvedCompetitors = (set?.entries ?? []).map(entry => ({ canonicalName: entry.canonicalName, competitorType: entry.competitorType }));
      approvedIds = new Set((set?.entries ?? []).map(entry => entry.candidateId));
    }

    // BenchmarkRunQuery 快照对齐（category/intent/locale 冻结于 benchmark 运行时刻）。
    const benchRun = await this.db.client.benchmarkRun.findFirst({
      where: { id: report.benchmarkRunId },
      include: { runQueries: true },
    });
    const byProjectQuery = new Map((benchRun?.runQueries ?? []).map(q => [q.projectQueryId, q]));

    // ---- Recommendations + 其 Finding 链路 ----
    const recs = await this.db.client.recommendation.findMany({
      where: { recommendationRunId: recRun.id },
      orderBy: [{ priorityScore: "desc" }, { createdAt: "asc" }],
    });
    if (recs.length === 0) {
      throw new NotFoundException("该优化建议没有可依据的条目（ContentOpportunity 必须 Recommendation-backed，不凭空生成）");
    }
    const recLinks = await this.db.client.recommendationFinding.findMany({
      where: { recommendationId: { in: recs.map(r => r.id) } },
    });
    const findings = await this.db.client.diagnosisFinding.findMany({
      where: { id: { in: recLinks.map(l => l.findingId) } },
      include: { evidenceLinks: { orderBy: { createdAt: "asc" } } },
    });
    const findingById = new Map(findings.map(f => [f.id, f]));
    const recIdToFindingIds = new Map<string, string[]>();
    for (const link of recLinks) {
      const list = recIdToFindingIds.get(link.recommendationId) ?? [];
      list.push(link.findingId);
      recIdToFindingIds.set(link.recommendationId, list);
    }

    // ---- Evidence provenance + Run.queryId + Analysis（brandAbsent / competitorPositive）----
    const evidenceRows = await this.db.client.evidence.findMany({ where: { id: { in: findings.flatMap(f => f.evidenceLinks.map(l => l.evidenceId)) } } });
    const evidenceById = new Map(evidenceRows.map(e => [e.id, e]));
    const runIds = [...new Set(findings.flatMap(f => f.evidenceLinks.map(l => l.runId)))];
    const runRows = await this.db.client.run.findMany({ where: { id: { in: runIds } }, select: { id: true, queryId: true } });
    const runById = new Map(runRows.map(r => [r.id, r]));
    const analysisRows = await this.db.client.analysis.findMany({
      where: { evidenceId: { in: evidenceRows.map(e => e.id) }, analysisVersion: report.analysisVersion },
      include: { mentions: { select: { entityId: true, entityType: true, sentiment: true } } },
    });
    const analysisByEvidenceId = new Map(analysisRows.map(a => [a.evidenceId, a]));

    // 每条 finding-evidence 链接 → 一条 OpportunityQueryFact（queryTextSnapshot + 对齐快照 + provenance）。
    const factByFindingEvidenceId = new Map<string, OpportunityQueryFact>();
    const evidenceReasonById = new Map<string, string>();
    for (const f of findings) {
      for (const link of f.evidenceLinks) {
        if (!evidenceReasonById.has(link.evidenceId)) evidenceReasonById.set(link.evidenceId, link.reason);
        const evidence = evidenceById.get(link.evidenceId);
        const run = runById.get(link.runId);
        const bench = run ? byProjectQuery.get(run.queryId) : undefined;
        const analysis = analysisByEvidenceId.get(link.evidenceId);
        const approvedPositive = analysis
          ? analysis.mentions.some(m => m.entityType === "competitor" && approvedIds.has(m.entityId) && m.sentiment === "positive")
          : null;
        const engine: OpportunityEngineFact = evidence
          ? {
              provider: evidence.provider,
              engineKey: evidence.engineKey,
              engineName: evidence.engineName,
              requestedModel: evidence.requestedModel,
              responseModel: evidence.responseModel,
            }
          : { provider: "unknown", engineKey: "unknown", engineName: "未知（证据缺失）", requestedModel: null, responseModel: null };
        factByFindingEvidenceId.set(link.id, {
          queryText: link.queryTextSnapshot,
          category: bench?.category ?? null,
          intent: bench?.intent ?? null,
          locale: bench?.locale ?? null,
          brandAbsent: analysis ? !analysis.brandMentioned : null,
          competitorPositive: approvedPositive,
          engine,
          evidenceId: link.evidenceId,
          runId: link.runId,
          reason: link.reason,
        });
      }
    }

    const input: OpportunityEngineInput = {
      opportunityVersion: CONTENT_OPPORTUNITY_VERSION,
      recommendationRun: { id: recRun.id, recommendationVersion: recRun.recommendationVersion, metricSource },
      recommendations: recs.map((rec): OpportunityRecommendationInput => {
        const recFindingIds = recIdToFindingIds.get(rec.id) ?? [];
        const recFindings = recFindingIds
          .map(id => findingById.get(id))
          .filter((f): f is NonNullable<typeof f> => Boolean(f));
        return {
          id: rec.id,
          recommendationType: rec.recommendationType,
          title: rec.title,
          summary: rec.summary,
          rationale: rec.rationale,
          priority: rec.priority,
          priorityScore: rec.priorityScore,
          category: rec.category,
          competitorName: rec.competitorName,
          expectedSignal: rec.expectedSignal,
          effortLevel: rec.effortLevel,
          findingIds: recFindingIds,
          findings: recFindings.map((f): OpportunityFindingInput => ({
            id: f.id,
            findingType: f.findingType,
            severity: f.severity,
            title: f.title,
            summary: f.summary,
            category: f.category,
            competitorName: f.competitorName,
            priorityScore: f.priorityScore,
          })),
          queries: recFindings.flatMap(f => f.evidenceLinks.map(link => factByFindingEvidenceId.get(link.id))).filter((q): q is OpportunityQueryFact => Boolean(q)),
        };
      }),
      approvedCompetitors,
      hasDataQualityIssue,
    };

    // ---- Engine（纯函数，deterministic）----
    const started = Date.now();
    const { opportunities, summary } = buildContentOpportunities(input);
    const generatedAt = new Date();

    const created = await this.db.client.$transaction(async tx => {
      const run = await tx.contentOpportunityRun.create({
        data: {
          projectId: recRun.projectId,
          recommendationRunId: recRun.id,
          opportunityVersion: CONTENT_OPPORTUNITY_VERSION,
          status: "READY",
          summarySnapshot: JSON.parse(JSON.stringify(summary)) as JsonValue,
          metadata: {
            metricSource,
            suiteName: report.suiteName,
            suiteVersion: report.suiteVersion,
            competitorSetName: report.competitorSetName,
            competitorSetVersion: report.competitorSetVersion,
            hasDataQualityIssue,
            engineDurationMs: Date.now() - started,
            generatedBy: "m7c-content-opportunity-v1",
            note: "ContentOpportunity 为确定性规则生成的内容任务 brief（标题方向 ≠ 最终标题；建议结构 ≠ 正文；预期信号 ≠ 效果承诺）。实际效果需在 M7D 以相同 Benchmark 复测验证。",
          } as JsonValue,
          generatedAt,
          opportunities: {
            create: opportunities.map((o, index) => ({
              opportunityType: o.opportunityType,
              titleDirection: o.titleDirection,
              summary: o.summary,
              rationale: o.rationale,
              priority: o.priority,
              priorityScore: o.priorityScore,
              category: o.category,
              assetType: o.assetType,
              contentIntent: o.contentIntent,
              effortLevel: o.effortLevel,
              expectedSignals: o.expectedSignals,
              representativeQuery: o.representativeQuery,
              targetQueryCount: o.targetQueryCount,
              targetEngineCount: o.targetEngineCount,
              targetCompetitorCount: o.targetCompetitorCount,
              evidenceCount: o.evidenceCount,
              recommendationCount: o.recommendationCount,
              status: "PROPOSED",
              dataQualityLimited: o.dataQualityLimited,
              targetEngines: JSON.parse(JSON.stringify({ items: o.engines })) as JsonValue,
              targetCompetitors: JSON.parse(JSON.stringify({ items: o.competitors })) as JsonValue,
              metadata: JSON.parse(JSON.stringify({ ...o.metadata, findingIds: o.findingIds, sortIndex: index })) as JsonValue,
              recommendations: {
                create: o.recommendationIds.map(recommendationId => ({ recommendationId })),
              },
              queries: {
                create: o.queries.map((q, sortOrder) => ({
                  queryTextSnapshot: q.queryText,
                  category: q.category,
                  intent: q.intent,
                  locale: q.locale,
                  brandAbsent: q.brandAbsent,
                  competitorPositive: q.competitorPositive,
                  sourceEvidenceCount: q.sourceEvidenceCount,
                  sortOrder,
                  metadata: JSON.parse(JSON.stringify({ engines: q.engines })) as JsonValue,
                })),
              },
              evidenceLinks: {
                create: o.queries.flatMap(q => q.evidenceIds.map(evidenceId => {
                  const evidence = evidenceById.get(evidenceId);
                  return {
                    evidenceId,
                    runId: evidence?.runId ?? q.runIds[q.evidenceIds.indexOf(evidenceId)] ?? "",
                    queryTextSnapshot: q.queryText,
                    reason: evidenceReasonById.get(evidenceId) ?? "代表性证据",
                  };
                })),
              },
              blocks: {
                create: o.blocks.map(b => ({
                  blockType: b.blockType, title: b.title, purpose: b.purpose, sortOrder: b.sortOrder,
                })),
              },
            })),
          },
        },
      });
      return run;
    });

    logger.log(JSON.stringify({
      event: "content_opportunities_created", contentOpportunityRunId: created.id,
      recommendationRunId: recRun.id, opportunityVersion: CONTENT_OPPORTUNITY_VERSION,
      opportunityCount: opportunities.length, queryLinkCount: summary.queryLinkCount,
      evidenceLinkCount: summary.evidenceLinkCount, dataQualityLimited: summary.dataQualityLimited,
      durationMs: Date.now() - started,
    }));
    return this.presentRun(created, { withCounts: true });
  }

  // ---------------------------------------------------------------
  // 查询
  // ---------------------------------------------------------------
  async listByRecommendationRun(userId: string, recommendationRunId: string) {
    await this.recommendationRunForUser(userId, recommendationRunId);
    const rows = await this.db.client.contentOpportunityRun.findMany({
      where: { recommendationRunId },
      orderBy: [{ generatedAt: "desc" }, { createdAt: "desc" }],
      include: { _count: { select: { opportunities: true } } },
    });
    return rows.map(row => this.presentRun(row, { withCounts: true }));
  }

  async getRun(userId: string, id: string) {
    const run = await this.runForUser(userId, id);
    return this.presentRun(run, { withCounts: true });
  }

  async listOpportunities(userId: string, runId: string) {
    const run = await this.runForUser(userId, runId);
    const rows = await this.db.client.contentOpportunity.findMany({
      where: { opportunityRunId: run.id },
      include: { _count: { select: { queries: true, blocks: true, recommendations: true } } },
      orderBy: [{ priorityScore: "desc" }, { createdAt: "asc" }],
    });
    return {
      contentOpportunityRun: this.presentRun(run, { withCounts: true }),
      opportunities: rows.map(row => this.presentOpportunity(row, { withCounts: true })),
    };
  }

  async getOpportunity(userId: string, id: string) {
    const opp = await this.opportunityForUser(userId, id);
    const blocks = await this.db.client.contentOpportunityBlock.findMany({
      where: { opportunityId: opp.id },
      orderBy: { sortOrder: "asc" },
    });
    const queries = await this.db.client.contentOpportunityQuery.findMany({
      where: { opportunityId: opp.id },
      orderBy: { sortOrder: "asc" },
    });
    const evidenceCount = await this.db.client.contentOpportunityEvidence.count({ where: { opportunityId: opp.id } });
    return {
      ...this.presentOpportunity(opp),
      blocks: blocks.map(b => ({ id: b.id, blockType: b.blockType, title: b.title, purpose: b.purpose, sortOrder: b.sortOrder })),
      queries: queries.map(q => this.presentQuery(q)),
      evidenceCount,
    };
  }

  async sourceRecommendations(userId: string, id: string) {
    const opp = await this.opportunityForUser(userId, id);
    const links = await this.db.client.contentOpportunityRecommendation.findMany({
      where: { opportunityId: opp.id },
      include: { recommendation: true },
      orderBy: { createdAt: "asc" },
    });
    return {
      contentOpportunityId: opp.id,
      recommendations: links.map(link => ({
        id: link.recommendation.id,
        recommendationRunId: link.recommendation.recommendationRunId,
        recommendationType: link.recommendation.recommendationType,
        title: link.recommendation.title,
        summary: link.recommendation.summary,
        rationale: link.recommendation.rationale,
        priority: link.recommendation.priority,
        priorityScore: link.recommendation.priorityScore,
        impactArea: link.recommendation.impactArea,
        targetAssetType: link.recommendation.targetAssetType,
        expectedSignal: link.recommendation.expectedSignal,
        effortLevel: link.recommendation.effortLevel,
        status: link.recommendation.status,
        category: link.recommendation.category,
        competitorName: link.recommendation.competitorName,
        findingCount: link.recommendation.findingCount,
        evidenceCount: link.recommendation.evidenceCount,
      })),
    };
  }

  async queries(userId: string, id: string) {
    const opp = await this.opportunityForUser(userId, id);
    const rows = await this.db.client.contentOpportunityQuery.findMany({
      where: { opportunityId: opp.id },
      orderBy: { sortOrder: "asc" },
    });
    return { contentOpportunityId: opp.id, queries: rows.map(q => this.presentQuery(q)) };
  }

  /** Opportunity → Evidence 指向性链接（不复制 Evidence 内容；UI 经 runId 打开 Evidence Dialog）。 */
  async evidence(userId: string, id: string) {
    const opp = await this.opportunityForUser(userId, id);
    const rows = await this.db.client.contentOpportunityEvidence.findMany({
      where: { opportunityId: opp.id },
      orderBy: { createdAt: "asc" },
    });
    return {
      contentOpportunityId: opp.id,
      evidence: rows.map(row => ({
        id: row.id, evidenceId: row.evidenceId, runId: row.runId,
        queryText: row.queryTextSnapshot, reason: row.reason,
      })),
    };
  }

  async updateStatus(userId: string, id: string, dto: UpdateOpportunityStatusDto) {
    const opp = await this.opportunityForUser(userId, id);
    const allowed = OPPORTUNITY_STATUS_TRANSITIONS[opp.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(`不允许从 ${opp.status} 变更为 ${dto.status}（仅人工流转：${allowed.join(" / ") || "无"}；执行与复测属 M7D）`);
    }
    const updated = await this.db.client.contentOpportunity.update({ where: { id: opp.id }, data: { status: dto.status as never } });
    logger.log(JSON.stringify({ event: "content_opportunity_status_updated", contentOpportunityId: updated.id, status: dto.status }));
    return this.presentOpportunity(updated);
  }

  // ---------------------------------------------------------------
  // Internals（tenant）
  // ---------------------------------------------------------------
  private async recommendationRunForUser(userId: string, id: string) {
    const run = await this.db.client.recommendationRun.findFirst({
      where: { id, project: { organization: { members: { some: { userId } } } } },
    });
    if (!run) throw new NotFoundException("优化建议 Run 不存在或无权访问");
    return run;
  }

  private async runForUser(userId: string, id: string) {
    const run = await this.db.client.contentOpportunityRun.findFirst({
      where: { id, project: { organization: { members: { some: { userId } } } } },
    });
    if (!run) throw new NotFoundException("内容机会 Run 不存在或无权访问");
    return run;
  }

  private async opportunityForUser(userId: string, id: string) {
    const opp = await this.db.client.contentOpportunity.findFirst({
      where: { id, opportunityRun: { project: { organization: { members: { some: { userId } } } } } },
    });
    if (!opp) throw new NotFoundException("内容机会不存在或无权访问");
    return opp;
  }

  // ---------------------------------------------------------------
  // Present
  // ---------------------------------------------------------------
  private presentRun(run: any, options: { withCounts?: boolean; reused?: boolean } = {}) {
    return {
      id: run.id,
      recommendationRunId: run.recommendationRunId,
      projectId: run.projectId,
      opportunityVersion: run.opportunityVersion,
      status: run.status,
      summary: run.summarySnapshot,
      generatedAt: run.generatedAt,
      createdAt: run.createdAt,
      metadata: run.metadata,
      ...(options.withCounts ? { opportunityCount: run._count?.opportunities ?? null } : {}),
      ...(options.reused ? { reused: true } : {}),
    };
  }

  private presentOpportunity(opp: any, options: { withCounts?: boolean } = {}) {
    const engines = decodeItems(opp.targetEngines);
    const competitors = decodeItems(opp.targetCompetitors);
    const metadata = (opp.metadata ?? {}) as Record<string, unknown>;
    return {
      id: opp.id,
      opportunityRunId: opp.opportunityRunId,
      opportunityType: opp.opportunityType,
      titleDirection: opp.titleDirection,
      summary: opp.summary,
      rationale: opp.rationale,
      priority: opp.priority,
      priorityScore: opp.priorityScore,
      category: opp.category,
      assetType: opp.assetType,
      contentIntent: opp.contentIntent,
      effortLevel: opp.effortLevel,
      expectedSignals: opp.expectedSignals ?? [],
      representativeQuery: opp.representativeQuery,
      targetQueryCount: opp.targetQueryCount,
      targetEngineCount: opp.targetEngineCount,
      targetCompetitorCount: opp.targetCompetitorCount,
      evidenceCount: opp.evidenceCount,
      recommendationCount: opp.recommendationCount,
      findingCount: Array.isArray(metadata.findingIds) ? (metadata.findingIds as unknown[]).length : 0,
      status: opp.status,
      dataQualityLimited: opp.dataQualityLimited,
      alternativeAssetTypes: Array.isArray(metadata.alternativeAssetTypes) ? metadata.alternativeAssetTypes : [],
      engines,
      competitors,
      createdAt: opp.createdAt,
      updatedAt: opp.updatedAt,
      ...(options.withCounts ? {
        queryCount: opp._count?.queries ?? null,
        blockCount: opp._count?.blocks ?? null,
        recommendationLinkCount: opp._count?.recommendations ?? null,
      } : {}),
    };
  }

  private presentQuery(q: any) {
    const metadata = (q.metadata ?? {}) as Record<string, unknown>;
    return {
      id: q.id,
      queryText: q.queryTextSnapshot,
      category: q.category,
      intent: q.intent,
      locale: q.locale,
      brandAbsent: q.brandAbsent,
      competitorPositive: q.competitorPositive,
      sourceEvidenceCount: q.sourceEvidenceCount,
      sortOrder: q.sortOrder,
      engines: Array.isArray(metadata.engines) ? metadata.engines : [],
    };
  }
}

function decodeItems(json: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(json)) return json as Array<Record<string, unknown>>;
  if (json && typeof json === "object") {
    const items = (json as Record<string, unknown>).items;
    if (Array.isArray(items)) return items as Array<Record<string, unknown>>;
  }
  return [];
}
