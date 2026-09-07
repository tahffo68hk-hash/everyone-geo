import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@geo/database";
import {
  PILOT_REVIEW_VERSION, aggregateMeasurementFacts, factsFromRetrievalModes,
  synthesizePilotReview, type PilotReviewResult,
} from "@geo/core";
import { PrismaService } from "../prisma.service";

type JsonValue = Prisma.InputJsonValue;
const logger = new Logger("PilotReviewsService");

/**
 * M8C/M8D — Real Pilot Review。
 * 语义：
 *   1) Review 是“一次性观察结果快照”（reviewVersion 并存，旧 review immutable）。
 *   2) execution validity：执行后必须存在 AFTER snapshot；若 before/after 的
 *      contentHash 相同 ⇒ CHANGE_NOT_OBSERVED（不假装已执行）。
 *   3) measurement validity：只依据 Evidence retrievalMode/sourceType；api_plain /
 *      mock ⇒ 该 Pilot 不能作为真实网页优化验证。
 *   4) attribution confidence 只有 LOW / MEDIUM（无 control/repeat 不做 HIGH）。
 *   5) Demo/Real isolation：metricSource=demo 的实验只能产出“演示 Review”，
 *      绝不伪装真实 Pilot。
 */
@Injectable()
export class PilotReviewsService {
  private readonly logger = new Logger("PilotReviewsService");

  constructor(private readonly db: PrismaService) {}

  /** 生成 Pilot Review（幂等：同 experiment+reviewVersion 返回既有）。 */
  async createForExperiment(userId: string, experimentId: string) {
    const exp = await this.experimentForUser(userId, experimentId);
    const existing = await this.db.client.pilotReview.findFirst({
      where: { experimentId: exp.id, reviewVersion: PILOT_REVIEW_VERSION },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return this.presentReview(existing, { reused: true });

    // 前置：实验已评估（有 Evaluation 才可做 outcome 观察）
    const evaluation = await this.db.client.experimentEvaluation.findFirst({
      where: { experimentId: exp.id },
      orderBy: { createdAt: "desc" },
    });
    if (!evaluation) {
      throw new BadRequestException("该实验尚未评估（无 Evaluation）。请先完成 Frozen Re-test + Evaluation 再生成 Pilot Review。");
    }

    const executions = await this.db.client.experimentExecution.findMany({
      where: { experimentId: exp.id, status: "RECORDED" },
      orderBy: { executedAt: "asc" },
    });
    const execution = executions[0] ?? null;

    // 变更资产 hash 对照（AFTER snapshot 必须存在且与 BEFORE 不同才 CHANGE_VERIFIED）
    const changePair = await this.changePair(exp, execution);
    const executionValidity: "CHANGE_VERIFIED" | "CHANGE_NOT_OBSERVED" | "NOT_RECORDED" =
      !execution ? "NOT_RECORDED"
        : changePair.verified ? "CHANGE_VERIFIED"
          : "CHANGE_NOT_OBSERVED";

    // M8A：After 测量有效性（来自 After Report 的 Evidence retrieval 快照）
    let measurementVerdict = exp.measurementValidity ?? "UNKNOWN";
    let measurementMode = exp.measurementMode ?? "UNKNOWN";
    let measurementWarnings: string[] = Array.isArray(exp.measurementWarnings)
      ? (exp.measurementWarnings as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    let changedAssetCited: boolean | null = null;
    if (evaluation.afterReportId) {
      const afterReport = await this.db.client.benchmarkReport.findUnique({ where: { id: evaluation.afterReportId } });
      if (afterReport) {
        const facts = await this.measurementRowsForRun(afterReport.benchmarkRunId);
        const agg = aggregateMeasurementFacts(factsFromRetrievalModes(facts));
        measurementVerdict = agg.verdict;
        measurementMode = agg.mode;
        measurementWarnings = agg.reasons;
        changedAssetCited = await this.changedAssetCitedIn(afterReport.benchmarkRunId, execution);
      }
    }

    const synthesized: PilotReviewResult = synthesizePilotReview({
      measurementVerdict,
      measurementMode,
      measurementWarnings,
      executionValidity,
      comparisonVerdict: (evaluation.compatibility as any)?.verdict ?? null,
      evaluationOutcome: evaluation.outcome,
      changedAssetCited,
      retrievalObservedForChangedAsset: changePair.verified ? "TRUE" : "UNKNOWN",
    });

    // Demo/Real isolation：demo 实验 → 观察结果仅作演示，不允许伪装真实 Pilot
    const metricSource = exp.metricSource ?? "demo";
    const observedOutcome = metricSource === "demo" && synthesized.observedOutcome === "VALIDATED_OBSERVATION"
      ? "INCONCLUSIVE"
      : synthesized.observedOutcome;
    const demoNote = metricSource === "demo"
      ? ["演示实验（metricSource=demo）：结果仅验证闭环，不代表真实 GEO 提升。"]
      : [];

    const lessons = this.lessons(synthesized, measurementVerdict, executionValidity, exp.metricSource);

    const review = await this.db.client.pilotReview.create({
      data: {
        experimentId: exp.id,
        reviewVersion: PILOT_REVIEW_VERSION,
        measurementValidity: measurementVerdict,
        measurementMode,
        executionValidity,
        comparisonValidity: ((evaluation.compatibility as any)?.verdict as string) ?? "NOT_COMPARABLE",
        observedOutcome,
        attributionConfidence: synthesized.attributionConfidence,
        changedAssetCited,
        retrievalObservedForChangedAsset: changePair.verified ? "TRUE" : "UNKNOWN",
        evaluationId: evaluation.id,
        lessons: { items: lessons },
        summarySnapshot: {
          beforeSnapshot: changePair.before ? { id: changePair.before.id, contentHash: changePair.before.contentHash, capturedAt: changePair.before.capturedAt } : null,
          afterSnapshot: changePair.after ? { id: changePair.after.id, contentHash: changePair.after.contentHash, capturedAt: changePair.after.capturedAt } : null,
          contentHashChanged: changePair.after && changePair.before ? changePair.after.contentHash !== changePair.before.contentHash : null,
          reasons: synthesized.reasons,
          metricSource,
          ...(demoNote.length ? { demoNote } : {}),
        } as JsonValue,
      },
    });
    this.logger.log(JSON.stringify({
      event: "pilot_review_created", experimentId: exp.id, reviewId: review.id,
      reviewVersion: PILOT_REVIEW_VERSION, observedOutcome, executionValidity,
      measurementValidity: measurementVerdict, attributionConfidence: synthesized.attributionConfidence,
    }));
    return this.presentReview(review);
  }

  async listByExperiment(userId: string, experimentId: string) {
    await this.experimentForUser(userId, experimentId);
    const rows = await this.db.client.pilotReview.findMany({
      where: { experimentId },
      orderBy: { generatedAt: "desc" },
    });
    return { experimentId, reviews: rows.map(r => this.presentReview(r)) };
  }

  async getReview(userId: string, id: string) {
    const review = await this.db.client.pilotReview.findFirst({
      where: { id, experiment: { project: { organization: { members: { some: { userId } } } } } },
    });
    if (!review) throw new NotFoundException("Pilot Review 不存在或无权访问");
    return this.presentReview(review, { withSnapshot: true });
  }

  // ---------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------
  private async experimentForUser(userId: string, experimentId: string) {
    const exp = await this.db.client.optimizationExperiment.findFirst({
      where: { id: experimentId, project: { organization: { members: { some: { userId } } } } },
    });
    if (!exp) throw new NotFoundException("实验不存在或无权访问");
    return exp;
  }

  private async measurementRowsForRun(benchmarkRunId: string): Promise<Array<{ retrievalMode: string; sourceType: string }>> {
    const run = await this.db.client.benchmarkRun.findUnique({
      where: { id: benchmarkRunId },
      include: { monitorTask: { include: { runs: { include: { evidence: { select: { retrievalMode: true, sourceType: true } } } } } } },
    });
    const rows: Array<{ retrievalMode: string; sourceType: string }> = [];
    for (const r of run?.monitorTask.runs ?? []) {
      if (r.status === "SUCCEEDED" && r.evidence) {
        rows.push({ retrievalMode: r.evidence.retrievalMode, sourceType: r.evidence.sourceType });
      }
    }
    return rows;
  }

  /** Before/After 站点快照对照。After 需要与执行同一资产；hash 变化才 CHANGE_VERIFIED。 */
  private async changePair(exp: any, execution: any): Promise<{ before: any | null; after: any | null; verified: boolean }> {
    const opp = await this.db.client.contentOpportunity.findUnique({
      where: { id: exp.contentOpportunityId },
      include: { assetMappings: { include: { siteAsset: true }, take: 3 } },
    });
    const mapping = opp?.assetMappings?.find(m => m.mappingType === "UPDATE_EXISTING" && m.siteAssetId) ?? opp?.assetMappings?.[0];
    const assetId = mapping?.siteAssetId ?? null;
    if (!assetId) return { before: null, after: null, verified: false };
    const asset = await this.db.client.siteAsset.findUnique({
      where: { id: assetId },
      include: { snapshots: { orderBy: { capturedAt: "asc" } } },
    });
    if (!asset) return { before: null, after: null, verified: false };
    const before = asset.snapshots.find(s => s.snapshotType === "BEFORE_CHANGE") ?? asset.snapshots[0] ?? null;
    const after = asset.snapshots.find(s => s.snapshotType === "AFTER_CHANGE") ?? null;
    const hashChanged = Boolean(before && after && after.contentHash !== before.contentHash);
    if (hashChanged && execution) {
      const metadata = { ...((exp.metadata as any) ?? {}), changeVerified: true };
      await this.db.client.optimizationExperiment.update({
        where: { id: exp.id },
        data: { metadata: JSON.parse(JSON.stringify(metadata)) as Prisma.InputJsonValue },
      });
    }
    return { before, after, verified: hashChanged };
  }

  private async changedAssetCitedIn(benchmarkRunId: string, execution: any): Promise<boolean | null> {
    if (!execution) return null;
    void benchmarkRunId;
    return null; // v1：从 Evidence citations 精确匹配站点 URL 留待 v2；先如实 null（不猜测）
  }

  private lessons(result: PilotReviewResult, measurementVerdict: string, executionValidity: string, metricSource: string) {
    const items: Array<{ category: string; message: string }> = [];
    if (metricSource === "demo") items.push({ category: "DATA", message: "演示实验：结果仅验证闭环，不代表真实 GEO 提升。" });
    if (measurementVerdict === "INVALID_FOR_WEB_CHANGE" || measurementVerdict === "PARTIALLY_VALID") {
      items.push({ category: "MEASUREMENT", message: "当前测量路径（api_plain/演示/未确认检索）不能验证公开网页变化；真实试点需 manual_verified 或确认真实网页检索。" });
    }
    if (executionValidity === "CHANGE_NOT_OBSERVED") {
      items.push({ category: "EXECUTION", message: "AFTER 资产快照与 BEFORE 一致（hash 未变化）—— 变更未被证实。请先实际修改页面并重新捕获 AFTER 快照。" });
    }
    if (result.attributionConfidence === "LOW" && result.observedOutcome !== "INCONCLUSIVE" && result.observedOutcome !== "INVALID_MEASUREMENT") {
      items.push({ category: "ATTRIBUTION", message: "单次 Before/After 观察归因置信 LOW：不构成因果证明，应结合多次 Re-test / control 再提升置信。" });
    }
    items.push({ category: "MEASUREMENT", message: "Observed change ≠ proven causal effect；生成式模型/Provider/互联网内容可能同时变化。" });
    return items;
  }

  private presentReview(r: any, options: { withSnapshot?: boolean; reused?: boolean } = {}) {
    const lessons = (r.lessons ?? {}) as { items?: Array<{ category: string; message: string }> };
    const summary = (r.summarySnapshot ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      experimentId: r.experimentId,
      reviewVersion: r.reviewVersion,
      measurementValidity: r.measurementValidity,
      measurementMode: r.measurementMode,
      executionValidity: r.executionValidity,
      comparisonValidity: r.comparisonValidity,
      observedOutcome: r.observedOutcome,
      attributionConfidence: r.attributionConfidence,
      changedAssetCited: r.changedAssetCited,
      retrievalObservedForChangedAsset: r.retrievalObservedForChangedAsset,
      evaluationId: r.evaluationId,
      lessons: lessons.items ?? [],
      generatedAt: r.generatedAt,
      createdAt: r.createdAt,
      ...(options.withSnapshot ? { summarySnapshot: summary } : {}),
      ...(options.reused ? { reused: true } : {}),
    };
  }
}
