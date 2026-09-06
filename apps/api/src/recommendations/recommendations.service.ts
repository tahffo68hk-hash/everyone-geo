import {
  Injectable, Logger, NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@geo/database";
import {
  RECOMMENDATION_VERSION, runRecommendations,
  type RecommendationFindingFact, type RecommendationInput,
} from "@geo/core";
import { PrismaService } from "../prisma.service";
import { UpdateRecommendationStatusDto } from "./dto/update-recommendation-status.dto";
import { UpdateActionItemStatusDto } from "./dto/update-action-item-status.dto";

/**
 * M7B GEO Optimization Recommendations API。
 * 语义：
 *   1) 必须 Diagnosis-backed：每个 RecommendationRun 绑定一个 DiagnosisRun；
 *      无对应 Finding 绝不凭空生成。
 *   2) Snapshot + 幂等：同 (diagnosisRunId, recommendationVersion) 重复 POST
 *      返回既有 RecommendationRun。
 *   3) 状态为人工 review（PROPOSED/ACCEPTED/DISMISSED；ActionItem
 *      TODO/IN_PROGRESS/DONE/SKIPPED），系统不自动 ACCEPT。
 *   4) Recommendation→RecommendationFinding→DiagnosisFinding→Evidence 回链。
 */
type JsonValue = Prisma.InputJsonValue;
const logger = new Logger("RecommendationsService");
const SEVERITY_WEIGHT: Record<string, number> = { HIGH: 100, MEDIUM: 60, LOW: 30, INFO: 10 };

@Injectable()
export class RecommendationsService {
  constructor(private readonly db: PrismaService) {}

  // ---------------------------------------------------------------
  // 生成（幂等）
  // ---------------------------------------------------------------
  async createFromDiagnosis(userId: string, diagnosisRunId: string) {
    const run = await this.diagnosisForUser(userId, diagnosisRunId);

    const existing = await this.db.client.recommendationRun.findFirst({
      where: { diagnosisRunId: run.id, recommendationVersion: RECOMMENDATION_VERSION },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      return this.presentRun(existing, { withCounts: true, reused: true });
    }

    const findings = await this.db.client.diagnosisFinding.findMany({
      where: { diagnosisRunId: run.id },
    });
    if (findings.length === 0) {
      throw new NotFoundException("该诊断没有可依据的诊断项（Recommendation 必须 Diagnosis-backed，不凭空生成）");
    }

    // 数据类型（Demo/Real 隔离展示）：来自来源 Report。
    const report = await this.db.client.benchmarkReport.findUnique({ where: { id: run.reportId }, select: { metricSource: true, suiteName: true, suiteVersion: true } });
    const metricSource = report?.metricSource ?? null;

    const factById = new Map(findings.map(f => [f.id, f]));
    const input: RecommendationInput = {
      recommendationVersion: RECOMMENDATION_VERSION,
      diagnosis: {
        id: run.id,
        diagnosisVersion: run.diagnosisVersion,
        metricSource: metricSource ?? undefined,
      },
      findings: findings.map(f => ({
        id: f.id,
        findingType: f.findingType as RecommendationFindingFact["findingType"],
        severity: f.severity,
        title: f.title,
        summary: f.summary,
        category: f.category,
        competitorName: f.competitorName,
        priorityScore: f.priorityScore,
        queryCount: f.queryCount,
        evidenceCount: f.evidenceCount,
      })),
    };

    const started = Date.now();
    const { recommendations, summary } = runRecommendations(input);
    const generatedAt = new Date();
    const created = await this.db.client.$transaction(async tx => {
      const recRun = await tx.recommendationRun.create({
        data: {
          projectId: run.projectId,
          diagnosisRunId: run.id,
          recommendationVersion: RECOMMENDATION_VERSION,
          status: "READY",
          summarySnapshot: JSON.parse(JSON.stringify(summary)) as JsonValue,
          metadata: {
            metricSource,
            generatedBy: "m7b-recommendation-v1",
            engineDurationMs: Date.now() - started,
            note: "Recommendation 为确定性规则生成的优化假设，非因果证明、非效果承诺；效果须经 M7D 复测验证。",
          } as JsonValue,
          generatedAt,
        },
      });
      for (const c of recommendations) {
        await tx.recommendation.create({
          data: {
            recommendationRunId: recRun.id,
            recommendationType: c.recommendationType,
            title: c.title,
            summary: c.summary,
            rationale: c.rationale,
            priority: c.priority,
            priorityScore: c.priorityScore,
            impactArea: c.impactArea,
            targetAssetType: c.targetAssetType,
            expectedSignal: c.expectedSignal,
            effortLevel: c.effortLevel,
            status: "PROPOSED",
            findingCount: c.findingCount,
            evidenceCount: c.evidenceCount,
            category: c.category,
            competitorName: c.competitorName,
            metadata: {} as JsonValue,
            findings: {
              create: c.findingIds.filter(id => factById.has(id)).map(findingId => ({ findingId })),
            },
            actionItems: {
              create: c.actions.map(a => ({
                actionType: a.actionType, title: a.title, description: a.description,
                sortOrder: a.sortOrder, effortLevel: a.effortLevel,
                verificationMethod: a.verificationMethod, status: "TODO",
              })),
            },
          },
        });
      }
      return recRun;
    });

    logger.log(JSON.stringify({
      event: "recommendations_created", recommendationRunId: created.id,
      diagnosisRunId: run.id, recommendationVersion: RECOMMENDATION_VERSION,
      recommendationCount: recommendations.length, actionItemCount: summary.actionItemCount,
      durationMs: Date.now() - started,
    }));
    return this.presentRun(created, { withCounts: true });
  }

  // ---------------------------------------------------------------
  // 查询
  // ---------------------------------------------------------------
  async listByDiagnosis(userId: string, diagnosisRunId: string) {
    const run = await this.diagnosisForUser(userId, diagnosisRunId);
    const rows = await this.db.client.recommendationRun.findMany({
      where: { diagnosisRunId: run.id },
      orderBy: [{ generatedAt: "desc" }, { createdAt: "desc" }],
      include: { _count: { select: { recommendations: true } } },
    });
    return rows.map(row => this.presentRun(row, { withCounts: true }));
  }

  async getRun(userId: string, id: string) {
    const run = await this.runForUser(userId, id);
    return this.presentRun(run, { withCounts: true });
  }

  async listRecommendations(userId: string, runId: string) {
    const run = await this.runForUser(userId, runId);
    const rows = await this.db.client.recommendation.findMany({
      where: { recommendationRunId: run.id },
      include: { _count: { select: { actionItems: true } } },
      orderBy: [{ priorityScore: "desc" }, { createdAt: "asc" }],
    });
    return { recommendationRun: this.presentRun(run, { withCounts: true }), recommendations: rows.map(r => this.presentRecommendation(r, { withActionCount: true })) };
  }

  async getRecommendation(userId: string, id: string) {
    const rec = await this.recommendationForUser(userId, id);
    const actionItems = await this.db.client.actionItem.findMany({ where: { recommendationId: rec.id }, orderBy: { sortOrder: "asc" } });
    const links = await this.db.client.recommendationFinding.findMany({ where: { recommendationId: rec.id } });
    return {
      ...this.presentRecommendation(rec),
      actionItems: actionItems.map(this.presentActionItem),
      findingIds: links.map(l => l.findingId),
    };
  }

  /** Recommendation→DiagnosisFinding（含其 evidenceLinks）→ 供 UI 下钻。 */
  async recommendationFindings(userId: string, id: string) {
    const rec = await this.recommendationForUser(userId, id);
    const links = await this.db.client.recommendationFinding.findMany({
      where: { recommendationId: rec.id },
      include: { } as never,
    });
    const findingIds = links.map(l => l.findingId);
    const findings = await this.db.client.diagnosisFinding.findMany({
      where: { id: { in: findingIds } },
      include: { evidenceLinks: { orderBy: { createdAt: "asc" } } },
    });
    findings.sort((a, b) =>
      (SEVERITY_WEIGHT[b.severity] ?? 0) - (SEVERITY_WEIGHT[a.severity] ?? 0) || b.priorityScore - a.priorityScore);
    return {
      recommendation: this.presentRecommendation(rec),
      findings: findings.map(this.presentFindingWithEvidence),
    };
  }

  /** Recommendation → 全部关联 Evidence 链接（汇总，不复制 Evidence 内容）。 */
  async recommendationEvidence(userId: string, id: string) {
    const rec = await this.recommendationForUser(userId, id);
    const links = await this.db.client.recommendationFinding.findMany({ where: { recommendationId: rec.id } });
    const findingRows = await this.db.client.diagnosisFinding.findMany({
      where: { id: { in: links.map(l => l.findingId) } },
      include: { evidenceLinks: { orderBy: { createdAt: "asc" } } },
    });
    const evidence = findingRows.flatMap(f => f.evidenceLinks.map(e => ({
      evidenceId: e.evidenceId, runId: e.runId, queryText: e.queryTextSnapshot, reason: e.reason,
      findingId: f.id,
    })));
    return { recommendation: this.presentRecommendation(rec), evidence };
  }

  // ---------------------------------------------------------------
  // 人工状态
  // ---------------------------------------------------------------
  async updateRecommendationStatus(userId: string, id: string, dto: UpdateRecommendationStatusDto) {
    const rec = await this.recommendationForUser(userId, id);
    const updated = await this.db.client.recommendation.update({ where: { id: rec.id }, data: { status: dto.status as never } });
    logger.log(JSON.stringify({ event: "recommendation_status_updated", recommendationId: updated.id, status: dto.status }));
    return this.presentRecommendation(updated);
  }

  async updateActionItemStatus(userId: string, id: string, dto: UpdateActionItemStatusDto) {
    const item = await this.db.client.actionItem.findFirst({
      where: { id, recommendation: { recommendationRun: { project: { organization: { members: { some: { userId } } } } } } },
    });
    if (!item) throw new NotFoundException("行动项不存在或无权访问");
    const updated = await this.db.client.actionItem.update({ where: { id: item.id }, data: { status: dto.status as never } });
    logger.log(JSON.stringify({ event: "action_item_status_updated", actionItemId: updated.id, status: dto.status }));
    return this.presentActionItem(updated);
  }

  // ---------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------
  private async diagnosisForUser(userId: string, diagnosisRunId: string) {
    const run = await this.db.client.diagnosisRun.findFirst({
      where: { id: diagnosisRunId, project: { organization: { members: { some: { userId } } } } },
    });
    if (!run) throw new NotFoundException("诊断不存在或无权访问");
    return run;
  }

  private async runForUser(userId: string, id: string) {
    const run = await this.db.client.recommendationRun.findFirst({
      where: { id, project: { organization: { members: { some: { userId } } } } },
    });
    if (!run) throw new NotFoundException("优化建议 Run 不存在或无权访问");
    return run;
  }

  private async recommendationForUser(userId: string, id: string) {
    const rec = await this.db.client.recommendation.findFirst({
      where: { id, recommendationRun: { project: { organization: { members: { some: { userId } } } } } },
    });
    if (!rec) throw new NotFoundException("优化建议不存在或无权访问");
    return rec;
  }

  private presentRun(run: any, options: { withCounts?: boolean; reused?: boolean } = {}) {
    return {
      id: run.id,
      diagnosisRunId: run.diagnosisRunId,
      projectId: run.projectId,
      recommendationVersion: run.recommendationVersion,
      status: run.status,
      summary: run.summarySnapshot,
      generatedAt: run.generatedAt,
      createdAt: run.createdAt,
      metadata: run.metadata,
      ...(options.withCounts ? { recommendationCount: run._count?.recommendations ?? null } : {}),
      ...(options.reused ? { reused: true } : {}),
    };
  }

  private presentRecommendation(rec: any, options: { withActionCount?: boolean } = {}) {
    return {
      id: rec.id,
      recommendationRunId: rec.recommendationRunId,
      recommendationType: rec.recommendationType,
      title: rec.title,
      summary: rec.summary,
      rationale: rec.rationale,
      priority: rec.priority,
      priorityScore: rec.priorityScore,
      impactArea: rec.impactArea,
      targetAssetType: rec.targetAssetType,
      expectedSignal: rec.expectedSignal,
      effortLevel: rec.effortLevel,
      status: rec.status,
      findingCount: rec.findingCount,
      evidenceCount: rec.evidenceCount,
      category: rec.category,
      competitorName: rec.competitorName,
      createdAt: rec.createdAt,
      ...(options.withActionCount ? { actionItemCount: rec._count?.actionItems ?? null } : {}),
    };
  }

  private presentActionItem(item: any) {
    return {
      id: item.id,
      recommendationId: item.recommendationId,
      actionType: item.actionType,
      title: item.title,
      description: item.description,
      sortOrder: item.sortOrder,
      effortLevel: item.effortLevel,
      verificationMethod: item.verificationMethod,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private presentFindingWithEvidence(finding: any) {
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
      evidence: (finding.evidenceLinks ?? []).map((link: any) => ({
        id: link.id, evidenceId: link.evidenceId, runId: link.runId,
        queryText: link.queryTextSnapshot, reason: link.reason,
      })),
    };
  }
}
