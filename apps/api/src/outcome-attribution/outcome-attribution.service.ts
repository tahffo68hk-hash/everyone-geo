import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { TenantService } from "../common/tenant.service";
import { resolvePublicationAnchor } from "../common/published-asset-time";
import {
  AttributionStatus,
  CitationMatchStatus,
  ConfoundersSnapshot,
  GenerateAttributionDto,
  ObservedChangeType,
  QueryTargetingStatus,
  RunAttributionSummary,
  SignalsSnapshot,
  TemporalOrderingStatus,
} from "./dto/outcome-attribution.dto";

export const DEFAULT_ATTRIBUTION_VERSION = "m10d-attribution-v1";
import { DEFAULT_OUTCOME_VERSION } from "../outcome-comparison/outcome-comparison.service";

/**
 * 规范化 URL：小写协议与域名、移除常见跟踪参数、去除多余结尾斜杠
 */
export function normalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    let norm = `${u.protocol.toLowerCase()}//${u.hostname.toLowerCase()}`;
    if (u.port && u.port !== "80" && u.port !== "443") {
      norm += `:${u.port}`;
    }
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    norm += pathname;

    const filteredParams = new URLSearchParams();
    u.searchParams.forEach((val, key) => {
      const k = key.toLowerCase();
      if (
        !k.startsWith("utm_") &&
        !["spm", "from", "ref", "source", "fbclid", "gclid"].includes(k)
      ) {
        filteredParams.set(key, val);
      }
    });
    const qs = filteredParams.toString();
    if (qs) {
      norm += `?${qs}`;
    }
    return norm;
  } catch {
    return rawUrl.trim().toLowerCase().replace(/\/+$/, "");
  }
}

/**
 * 严格判定 After 证据中的引用是否匹配本次落地资产
 */
export function matchCitationToAsset(
  assetUrl: string | null | undefined,
  citationUrls: string[],
): { status: CitationMatchStatus; matchedUrl?: string; domainMatched?: string } {
  if (!assetUrl) return { status: "UNKNOWN" };
  if (!citationUrls || citationUrls.length === 0) return { status: "NO_ASSET_CITATION" };

  const normAsset = normalizeUrl(assetUrl);
  let assetDomain = "";
  try {
    assetDomain = new URL(normAsset).hostname.toLowerCase();
  } catch {}

  let domainMatchFound = false;
  let matchedDomainUrl = "";

  for (const cUrl of citationUrls) {
    const normCit = normalizeUrl(cUrl);
    if (normCit === normAsset) {
      return { status: "DIRECT_ASSET_CITATION", matchedUrl: cUrl };
    }
    try {
      const cDomain = new URL(normCit).hostname.toLowerCase();
      if (assetDomain && (cDomain === assetDomain || cDomain.endsWith(`.${assetDomain}`))) {
        domainMatchFound = true;
        matchedDomainUrl = cUrl;
      }
    } catch {}
  }

  if (domainMatchFound) {
    return { status: "SAME_DOMAIN_OTHER_PAGE", matchedUrl: matchedDomainUrl, domainMatched: assetDomain };
  }

  return { status: "NO_ASSET_CITATION" };
}

@Injectable()
export class OutcomeAttributionService {
  private readonly logger = new Logger(OutcomeAttributionService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  /**
   * 评估查询针对性 (Query Targeting)
   */
  private evaluateQueryTargeting(
    queryId: string,
    queryText: string,
    publishedAsset: any,
  ): { status: QueryTargetingStatus; matchedQueryId?: string; matchedQueryText?: string } {
    const planItem = publishedAsset.planItem;
    if (planItem && Array.isArray(planItem.targetQueries) && planItem.targetQueries.length > 0) {
      const targets = planItem.targetQueries as string[];
      if (targets.includes(queryId) || targets.includes(queryText)) {
        return { status: "EXPLICIT_TARGET", matchedQueryId: queryId, matchedQueryText: queryText };
      }
    }

    const strategy = publishedAsset.campaign?.strategy;
    if (strategy && Array.isArray(strategy.priorityQuestions) && strategy.priorityQuestions.length > 0) {
      const questions = strategy.priorityQuestions as string[];
      if (questions.includes(queryText)) {
        return { status: "STRATEGY_TARGET", matchedQueryText: queryText };
      }
    }

    return { status: "NOT_TARGETED" };
  }

  /**
   * 评估时间序 (Temporal Ordering)
   */
  private evaluateTemporalOrdering(
    beforeSnapshot: any,
    publishedAsset: any,
    afterSnapshot: any,
  ): { status: TemporalOrderingStatus; baselineAt: string | null; publishedAt: string | null; retestAt: string | null } {
    const baselineAt = beforeSnapshot?.capturedAt || null;
    const anchor = publishedAsset ? resolvePublicationAnchor(publishedAsset) : null;
    const publishedAt = anchor ? anchor.toISOString() : null;
    const retestAt = afterSnapshot?.capturedAt || null;

    if (!publishedAt) {
      return { status: "UNKNOWN", baselineAt, publishedAt, retestAt };
    }

    let valid = true;
    if (baselineAt) {
      valid = valid && new Date(baselineAt).getTime() < new Date(publishedAt).getTime();
    }
    if (retestAt) {
      valid = valid && new Date(publishedAt).getTime() <= new Date(retestAt).getTime();
    }

    return {
      status: valid ? "VALID_ORDER" : "INVALID_ORDER",
      baselineAt,
      publishedAt,
      retestAt,
    };
  }

  /**
   * 检测监测窗口内是否有其他针对同 Query 的并发落地资产发布 (Multiple Interventions)
   */
  private async detectMultipleInterventions(
    projectId: string,
    currentAssetId: string,
    queryId: string,
    queryText: string,
    baselineAt: string | null,
    retestAt: string | null,
  ): Promise<{ detected: boolean; confoundingAssetIds: string[] }> {
    if (!baselineAt || !retestAt) {
      return { detected: false, confoundingAssetIds: [] };
    }

    const bTime = new Date(baselineAt);
    const rTime = new Date(retestAt);

    const otherAssets = await this.db.client.publishedAsset.findMany({
      where: {
        projectId,
        id: { not: currentAssetId },
        verificationStatus: { in: ["PLATFORM_CONFIRMED", "MANUAL_VERIFIED"] },
        publishedAt: {
          gte: bTime,
          lte: rTime,
        },
      },
      include: {
        planItem: true,
      },
    });

    const confoundingAssetIds: string[] = [];

    for (const other of otherAssets) {
      const planItem = other.planItem;
      let matched = false;
      if (planItem && Array.isArray(planItem.targetQueries)) {
        const targets = planItem.targetQueries as string[];
        if (targets.includes(queryId) || targets.includes(queryText)) {
          matched = true;
        }
      }
      if (matched) {
        confoundingAssetIds.push(other.id);
      }
    }

    return {
      detected: confoundingAssetIds.length > 0,
      confoundingAssetIds,
    };
  }

  /**
   * 判定观测变化的性质与方向 (Positive / Negative / Mixed / Neutral / No Change)
   */
  private determineObservedChange(
    comparisonStatus: string,
    delta: any,
  ): { hasChange: boolean; type: ObservedChangeType; details: any } {
    if (comparisonStatus !== "COMPARABLE" && comparisonStatus !== "COMPARABLE_WITH_WARNING") {
      return { hasChange: false, type: "NO_CHANGE", details: {} };
    }
    if (!delta || Object.keys(delta).length === 0) {
      return { hasChange: false, type: "NO_CHANGE", details: {} };
    }

    let positiveScore = 0;
    let negativeScore = 0;
    let neutralScore = 0;

    // 1. Brand mention
    if (delta.brandMention?.changed) {
      if (delta.brandMention.change === "ABSENT_TO_PRESENT") positiveScore += 2;
      else if (delta.brandMention.change === "PRESENT_TO_ABSENT") negativeScore += 2;
      else positiveScore += 1;
    }

    // 2. Citation
    if (delta.citation?.changed) {
      if (delta.citation.countDelta > 0 || delta.citation.change === "ABSENT_TO_PRESENT") positiveScore += 1;
      else if (delta.citation.countDelta < 0 || delta.citation.change === "PRESENT_TO_ABSENT") negativeScore += 1;
      else neutralScore += 1;
    }

    // 3. Recommendation
    if (delta.recommendation?.changed) {
      if (delta.recommendation.change === "NOT_RECOMMENDED_TO_RECOMMENDED") positiveScore += 2;
      else if (delta.recommendation.change === "RECOMMENDED_TO_NOT_RECOMMENDED") negativeScore += 2;
      else neutralScore += 1;
    }

    // 4. Position
    if (delta.position?.changed) {
      if (delta.position.direction === "IMPROVED") positiveScore += 1;
      else if (delta.position.direction === "DECLINED") negativeScore += 1;
      else neutralScore += 1;
    }

    // 5. Sentiment
    if (delta.sentiment?.changed) {
      if (delta.sentiment.after === "positive") positiveScore += 1;
      else if (delta.sentiment.after === "negative") negativeScore += 1;
      else neutralScore += 1;
    }

    // 6. Competitor presence
    if (delta.competitorPresence?.changed) {
      neutralScore += 1;
    }

    const totalChange = positiveScore + negativeScore + neutralScore;
    if (totalChange === 0) {
      return { hasChange: false, type: "NO_CHANGE", details: {} };
    }

    let type: ObservedChangeType;
    if (positiveScore > 0 && negativeScore === 0) {
      type = "POSITIVE";
    } else if (negativeScore > 0 && positiveScore === 0) {
      type = "NEGATIVE";
    } else if (positiveScore > 0 && negativeScore > 0) {
      type = "MIXED";
    } else {
      type = "NEUTRAL";
    }

    return {
      hasChange: true,
      type,
      details: { positiveScore, negativeScore, neutralScore },
    };
  }

  /**
   * 确定性规则判定 M10D 归因状态与解释说明（绝不调用外部 LLM）
   */
  private evaluateAttributionVerdict(
    outcome: any,
    signals: SignalsSnapshot,
    confounders: ConfoundersSnapshot,
  ): { status: AttributionStatus; reasons: string[]; explanation: string } {
    const reasons: string[] = [];

    // 1. 基线/重测不可比或缺失
    if (outcome.comparisonStatus === "MISSING_BASELINE") {
      reasons.push("MISSING_BASELINE");
      return {
        status: "INSUFFICIENT_EVIDENCE",
        reasons,
        explanation: "由于缺少发布前的有效基线凭证，无法对比发布前后的表现差异，判定为“证据不足”。",
      };
    }

    if (outcome.comparisonStatus === "MISSING_RETEST_EVIDENCE") {
      reasons.push("MISSING_RETEST_EVIDENCE");
      return {
        status: "INSUFFICIENT_EVIDENCE",
        reasons,
        explanation: "重测任务未生成有效凭证或执行未成功，无法进行归因评估，判定为“证据不足”。",
      };
    }

    if (outcome.comparisonStatus === "INCOMPATIBLE") {
      reasons.push("INCOMPATIBLE_BASELINE");
      return {
        status: "INSUFFICIENT_EVIDENCE",
        reasons,
        explanation: "基线与重测环境配置不匹配（如检索模式或 Provider 不兼容），已阻断对比与归因，判定为“证据不足”。",
      };
    }

    // 2. 落地资产未核验优先判定为证据不足
    if (!signals.assetVerification.verified) {
      reasons.push("UNVERIFIED_ASSET");
      return {
        status: "INSUFFICIENT_EVIDENCE",
        reasons,
        explanation: "本次发布的落地资产尚未完成平台或人工核验，无法确认公开可用性，判定为“证据不足”。",
      };
    }

    // 3. 未观察到任何有效指标变化
    if (!signals.observedChange.hasChange) {
      reasons.push("NO_OBSERVED_CHANGE");
      return {
        status: "NO_OBSERVED_CHANGE",
        reasons,
        explanation: "在本次重测中，该查询在品牌提及、引用、推荐和排名等维度均未观察到显著变化，判定为“无观测变化”。",
      };
    }

    // 4. 存在并发混淆落地资产
    if (confounders.multipleInterventions.detected) {
      reasons.push("MULTIPLE_INTERVENTIONS");
      return {
        status: "CONFOUNDED",
        reasons,
        explanation: `在基线到重测的监测时间窗口内，当前项目存在 ${confounders.multipleInterventions.confoundingAssetIds.length} 篇其他落地资产针对同一查询并发发布，无法独立归因于当前资产，判定为“存在混淆因素”。`,
      };
    }

    // 5. 时间顺序非法
    if (signals.temporalOrdering.status === "INVALID_ORDER") {
      reasons.push("INVALID_TEMPORAL_ORDER");
      return {
        status: "INSUFFICIENT_EVIDENCE",
        reasons,
        explanation: "基线凭证、发布时间与重测凭证之间的时间顺序不合法（基线晚于发布或重测早于发布），判定为“证据不足”。",
      };
    }

    // 6. 核心分水岭：是否有直接资产引用 (Direct Asset Citation)
    if (signals.citationMatch.status === "DIRECT_ASSET_CITATION") {
      reasons.push("DIRECT_ASSET_CITATION");

      if (signals.baselineCompatibility === "EXACT_MATCH") {
        reasons.push("EXACT_BASELINE");
      }
      if (signals.assetVerification.verified) {
        reasons.push("VERIFIED_PUBLICATION");
      }
      if (signals.queryTargeting.status === "EXPLICIT_TARGET") {
        reasons.push("QUERY_EXPLICITLY_TARGETED");
      } else if (signals.queryTargeting.status === "STRATEGY_TARGET") {
        reasons.push("QUERY_STRATEGY_TARGETED");
      }

      // 检查是否有配置混淆
      if (confounders.modelChanged || confounders.retrievalModeChanged || confounders.providerChanged) {
        if (confounders.modelChanged) reasons.push("MODEL_CHANGED");
        if (confounders.retrievalModeChanged) reasons.push("RETRIEVAL_MODE_CHANGED");
        return {
          status: "CONFOUNDED",
          reasons,
          explanation: "虽然回答直接引用了已发布的落地资产，但基线与重测之间的模型或检索环境发生了变更，受配置漂移干扰，判定为“存在混淆因素”。",
        };
      }

      if (signals.queryTargeting.status === "NOT_TARGETED") {
        reasons.push("QUERY_NOT_TARGETED");
        return {
          status: "INSUFFICIENT_EVIDENCE",
          reasons,
          explanation: "回答引用了该资产，但该查询并未被列入发布计划或战略的目标问题中，关联意图不明确，判定为“证据不足”。",
        };
      }

      // 全量强信号成立
      return {
        status: "LIKELY_RELATED",
        reasons,
        explanation: "发布后该查询观察到了指标表现变化，且 AI 回答直接引用了本次核验发布的落地资产；基线配置严格匹配，时间窗口内无其他并发发布资产，综合判定为“可能相关”（不代表严格因果证明）。",
      };
    }

    // 7. 未直接引用落地资产 (No Direct Asset Citation)
    // 即使出现提及率上升或同域名其他页面引用，也不得仅凭 gain 提升为 Likely Related
    reasons.push("NO_DIRECT_ASSET_CITATION");
    if (signals.citationMatch.status === "SAME_DOMAIN_OTHER_PAGE") {
      reasons.push("SAME_DOMAIN_OTHER_PAGE");
    }

    if (signals.baselineCompatibility === "EXACT_MATCH") reasons.push("EXACT_BASELINE");
    if (signals.queryTargeting.status !== "NOT_TARGETED") reasons.push("QUERY_TARGETED");
    if (confounders.modelChanged) reasons.push("MODEL_CHANGED");
    if (confounders.retrievalModeChanged) reasons.push("RETRIEVAL_MODE_CHANGED");

    if (confounders.modelChanged || confounders.retrievalModeChanged) {
      return {
        status: "CONFOUNDED",
        reasons,
        explanation: "虽观察到了表现变化，但回答未直接引用当前发布的落地资产，且基线与重测配置存在差异，判定为“存在混淆因素”。",
      };
    }

    return {
      status: "INSUFFICIENT_EVIDENCE",
      reasons,
      explanation: "虽然观测到了指标变化，但 AI 回答中未直接引用当前发布的落地资产链接，缺乏直接关联证据，判定为“证据不足”。",
    };
  }

  /**
   * 为单个 OutcomeComparison 生成或获取归因分析 (POST /outcomes/:id/attribution)
   * 严格先授权再产生任何数据库副作用
   */
  async generateOutcomeAttribution(
    userId: string,
    outcomeComparisonId: string,
    dto?: GenerateAttributionDto,
  ) {
    const outcome = await this.db.client.outcomeComparison.findUnique({
      where: { id: outcomeComparisonId },
      include: {
        publishedAsset: {
          include: {
            planItem: true,
            campaign: { include: { strategy: true } },
          },
        },
        retestRun: true,
        retestItem: true,
      },
    });

    if (!outcome) {
      throw new NotFoundException("对比结果不存在");
    }

    // 严格 Service-level 权限拦截（发生于任何计算与写库之前）
    await this.tenant.assertUserInProject(userId, outcome.projectId);

    const version = dto?.attributionVersion?.trim() || DEFAULT_ATTRIBUTION_VERSION;

    // 幂等复用检查
    const existing = await this.db.client.outcomeAttribution.findUnique({
      where: {
        outcomeComparisonId_attributionVersion: {
          outcomeComparisonId,
          attributionVersion: version,
        },
      },
    });
    if (existing) {
      return existing;
    }

    // 提取信号与混淆因素
    const publishedAsset = outcome.publishedAsset;
    const beforeSnapshot = (outcome.beforeSnapshot as any) || {};
    const afterSnapshot = (outcome.afterSnapshot as any) || {};
    const deltaSnapshot = (outcome.deltaSnapshot as any) || {};

    const citationUrls: string[] = afterSnapshot.citationUrls || [];
    const citationMatch = matchCitationToAsset(publishedAsset.canonicalUrl, citationUrls);

    const queryTargeting = this.evaluateQueryTargeting(outcome.queryId, outcome.queryText, publishedAsset);
    const temporalOrdering = this.evaluateTemporalOrdering(beforeSnapshot, publishedAsset, afterSnapshot);

    const assetVerified =
      publishedAsset.verificationStatus === "PLATFORM_CONFIRMED" ||
      publishedAsset.verificationStatus === "MANUAL_VERIFIED";

    const multipleInterventions = await this.detectMultipleInterventions(
      outcome.projectId,
      publishedAsset.id,
      outcome.queryId,
      outcome.queryText,
      temporalOrdering.baselineAt,
      temporalOrdering.retestAt,
    );

    const modelChanged =
      Boolean(beforeSnapshot.model && afterSnapshot.model && beforeSnapshot.model !== afterSnapshot.model) ||
      Boolean(beforeSnapshot.requestedModel && afterSnapshot.requestedModel && beforeSnapshot.requestedModel !== afterSnapshot.requestedModel);
    const retrievalModeChanged =
      Boolean(beforeSnapshot.retrievalMode && afterSnapshot.retrievalMode && beforeSnapshot.retrievalMode !== afterSnapshot.retrievalMode);
    const providerChanged =
      Boolean(beforeSnapshot.provider && afterSnapshot.provider && beforeSnapshot.provider !== afterSnapshot.provider);
    const sourceTypeChanged =
      Boolean(beforeSnapshot.sourceType && afterSnapshot.sourceType && beforeSnapshot.sourceType !== afterSnapshot.sourceType);
    const unverifiedAsset = !assetVerified;
    const baselineWarning = outcome.baselineCompatibility === "COMPARABLE_WITH_WARNING";

    const confounderList: string[] = [];
    if (multipleInterventions.detected) confounderList.push("MULTIPLE_INTERVENTIONS");
    if (modelChanged) confounderList.push("MODEL_CHANGED");
    if (retrievalModeChanged) confounderList.push("RETRIEVAL_MODE_CHANGED");
    if (providerChanged) confounderList.push("PROVIDER_CHANGED");
    if (sourceTypeChanged) confounderList.push("SOURCE_TYPE_CHANGED");
    if (unverifiedAsset) confounderList.push("UNVERIFIED_ASSET");
    if (baselineWarning) confounderList.push("BASELINE_WARNING");

    const confoundersSnapshot: ConfoundersSnapshot = {
      hasConfounders: confounderList.length > 0,
      multipleInterventions,
      modelChanged,
      retrievalModeChanged,
      providerChanged,
      sourceTypeChanged,
      unverifiedAsset,
      baselineWarning,
      list: confounderList,
    };

    const observedChange = this.determineObservedChange(outcome.comparisonStatus, deltaSnapshot);

    const signalsSnapshot: SignalsSnapshot = {
      baselineCompatibility: outcome.baselineCompatibility,
      temporalOrdering,
      assetVerification: {
        status: publishedAsset.verificationStatus,
        verified: assetVerified,
      },
      queryTargeting,
      citationMatch,
      observedChange,
    };

    const { status, reasons, explanation } = this.evaluateAttributionVerdict(
      outcome,
      signalsSnapshot,
      confoundersSnapshot,
    );

    const record = await this.db.client.outcomeAttribution.create({
      data: {
        organizationId: outcome.organizationId,
        projectId: outcome.projectId,
        publishedAssetId: outcome.publishedAssetId,
        retestRunId: outcome.retestRunId,
        retestItemId: outcome.retestItemId,
        outcomeComparisonId: outcome.id,
        queryId: outcome.queryId,
        queryText: outcome.queryText,
        attributionVersion: version,
        status,
        observedChangeType: observedChange.type,
        signalsSnapshot: signalsSnapshot as any,
        confoundersSnapshot: confoundersSnapshot as any,
        reasons: reasons as any,
        explanation,
        metadata: {},
        createdById: userId,
      },
    });

    return record;
  }

  /**
   * 获取某 OutcomeComparison 的归因分析结果 (GET /outcomes/:id/attribution)
   */
  async getOutcomeAttribution(userId: string, outcomeComparisonId: string) {
    const outcome = await this.db.client.outcomeComparison.findUnique({
      where: { id: outcomeComparisonId },
    });
    if (!outcome) {
      throw new NotFoundException("对比结果不存在");
    }

    await this.tenant.assertUserInProject(userId, outcome.projectId);

    let attribution = await this.db.client.outcomeAttribution.findFirst({
      where: { outcomeComparisonId },
      orderBy: { createdAt: "desc" },
    });

    if (!attribution) {
      attribution = await this.generateOutcomeAttribution(userId, outcomeComparisonId);
    }

    return attribution;
  }

  /**
   * 获取某 PublishedAsset 维度的所有 Attribution 历史 (GET /published-assets/:id/attributions)
   */
  async listAssetAttributions(userId: string, publishedAssetId: string) {
    const asset = await this.db.client.publishedAsset.findUnique({
      where: { id: publishedAssetId },
    });
    if (!asset) {
      throw new NotFoundException("发布资产不存在");
    }

    await this.tenant.assertUserInProject(userId, asset.projectId);

    const attributions = await this.db.client.outcomeAttribution.findMany({
      where: { publishedAssetId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    return {
      publishedAssetId: asset.id,
      totalAttributions: attributions.length,
      items: attributions,
    };
  }

  /**
   * 获取某 RetestRun 维度的所有 Attribution 与汇总摘要 (GET /retests/:id/attributions)
   */
  async getRetestRunAttributions(userId: string, retestRunId: string) {
    const retestRun = await this.db.client.retestRun.findUnique({
      where: { id: retestRunId },
      include: {
        publishedAsset: true,
        outcomes: true,
      },
    });
    if (!retestRun) {
      throw new NotFoundException("重测任务不存在");
    }

    await this.tenant.assertUserInProject(userId, retestRun.projectId);

    let attributions = await this.db.client.outcomeAttribution.findMany({
      where: { retestRunId },
      orderBy: { createdAt: "asc" },
    });

    // 若尚未生成，为所有已有 outcome 自动触发
    if (attributions.length === 0 && retestRun.outcomes.length > 0) {
      for (const outcome of retestRun.outcomes) {
        await this.generateOutcomeAttribution(userId, outcome.id);
      }
      attributions = await this.db.client.outcomeAttribution.findMany({
        where: { retestRunId },
        orderBy: { createdAt: "asc" },
      });
    }

    let likelyRelatedCount = 0;
    let insufficientEvidenceCount = 0;
    let confoundedCount = 0;
    let noObservedChangeCount = 0;
    let positiveObservedChangeCount = 0;
    let negativeObservedChangeCount = 0;
    let directAssetCitationCount = 0;

    for (const attr of attributions) {
      if (attr.status === "LIKELY_RELATED") likelyRelatedCount++;
      else if (attr.status === "INSUFFICIENT_EVIDENCE") insufficientEvidenceCount++;
      else if (attr.status === "CONFOUNDED") confoundedCount++;
      else if (attr.status === "NO_OBSERVED_CHANGE") noObservedChangeCount++;

      if (attr.observedChangeType === "POSITIVE") positiveObservedChangeCount++;
      else if (attr.observedChangeType === "NEGATIVE") negativeObservedChangeCount++;

      const signals = attr.signalsSnapshot as any;
      if (signals?.citationMatch?.status === "DIRECT_ASSET_CITATION") {
        directAssetCitationCount++;
      }
    }

    const summary: RunAttributionSummary = {
      retestRunId: retestRun.id,
      publishedAssetId: retestRun.publishedAssetId,
      attributionVersion: attributions[0]?.attributionVersion || DEFAULT_ATTRIBUTION_VERSION,
      totalOutcomes: attributions.length,
      likelyRelatedCount,
      insufficientEvidenceCount,
      confoundedCount,
      noObservedChangeCount,
      positiveObservedChangeCount,
      negativeObservedChangeCount,
      directAssetCitationCount,
    };

    return {
      retestRunId: retestRun.id,
      publishedAssetId: retestRun.publishedAssetId,
      summary,
      items: attributions,
    };
  }

  /**
   * M10E Workspace Level 1: 查询项目所有已发布资产及其复测与归因摘要 (GET /projects/:id/verification-assets)
   */
  async listVerificationAssets(userId: string, projectId: string) {
    await this.tenant.assertUserInProject(userId, projectId);

    const assets = await this.db.client.publishedAsset.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      include: {
        draft: { select: { id: true, title: true, topic: true } },
        publication: { select: { id: true, channel: true, status: true } },
        campaign: { select: { id: true, name: true } },
        retestRuns: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            outcomes: true,
            outcomeAttributions: true,
          },
        },
      },
    });

    const items = assets.map((asset) => {
      const latestRetest = asset.retestRuns[0] || null;
      let comparableQueryCount = 0;
      let changedQueryCount = 0;
      let likelyRelatedCount = 0;
      let insufficientEvidenceCount = 0;
      let confoundedCount = 0;
      let noObservedChangeCount = 0;

      if (latestRetest) {
        for (const outcome of latestRetest.outcomes) {
          if (
            outcome.comparisonStatus === "COMPARABLE" ||
            outcome.comparisonStatus === "COMPARABLE_WITH_WARNING"
          ) {
            comparableQueryCount++;
          }
        }
        for (const attr of latestRetest.outcomeAttributions) {
          if (
            attr.observedChangeType === "POSITIVE" ||
            attr.observedChangeType === "NEGATIVE" ||
            attr.status === "LIKELY_RELATED"
          ) {
            changedQueryCount++;
          }
          if (attr.status === "LIKELY_RELATED") likelyRelatedCount++;
          else if (attr.status === "INSUFFICIENT_EVIDENCE") insufficientEvidenceCount++;
          else if (attr.status === "CONFOUNDED") confoundedCount++;
          else if (attr.status === "NO_OBSERVED_CHANGE") noObservedChangeCount++;
        }
      }

      return {
        id: asset.id,
        platform: asset.platform,
        title: asset.title,
        externalAssetId: asset.externalAssetId,
        canonicalUrl: asset.canonicalUrl,
        publishedAt: asset.publishedAt,
        verificationStatus: asset.verificationStatus,
        verificationNote: asset.verificationNote,
        createdAt: asset.createdAt,
        draft: asset.draft,
        publication: asset.publication,
        campaign: asset.campaign,
        latestRetest: latestRetest
          ? {
              id: latestRetest.id,
              sequence: latestRetest.sequence,
              status: latestRetest.status,
              provider: latestRetest.provider,
              model: latestRetest.model,
              requestedAt: latestRetest.requestedAt,
              completedAt: latestRetest.completedAt,
              totalItems: latestRetest.totalItems,
              completedItems: latestRetest.completedItems,
            }
          : null,
        comparableQueryCount,
        changedQueryCount,
        attributionDistribution: {
          likelyRelated: likelyRelatedCount,
          insufficientEvidence: insufficientEvidenceCount,
          confounded: confoundedCount,
          noObservedChange: noObservedChangeCount,
          total: latestRetest ? latestRetest.outcomeAttributions.length : 0,
        },
      };
    });

    return {
      projectId,
      total: items.length,
      items,
    };
  }

  /**
   * M10E Workspace Level 2 & Level 3: 获取某落地资产完整 Workspace 投影 (GET /published-assets/:id/outcome-workspace)
   * 严格单版本隔离：不将不同算法版本（ComparisonVersion / AttributionVersion）混合展示或重复汇总
   */
  async getAssetOutcomeWorkspace(
    userId: string,
    assetId: string,
    retestRunId?: string,
    comparisonVersion?: string,
    attributionVersion?: string,
  ) {
    const asset = await this.db.client.publishedAsset.findUnique({
      where: { id: assetId },
      include: {
        draft: { select: { id: true, title: true, topic: true } },
        publication: { select: { id: true, channel: true, status: true } },
        campaign: { select: { id: true, name: true, objective: true } },
        planItem: { select: { id: true, title: true, targetQueries: true, geoTarget: true, objective: true } },
        retestRuns: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!asset) {
      throw new NotFoundException("发布资产不存在");
    }

    const typedAsset = asset as any;
    await this.tenant.assertUserInProject(userId, typedAsset.projectId);

    const targetRun = retestRunId
      ? typedAsset.retestRuns.find((r: any) => r.id === retestRunId) || null
      : typedAsset.retestRuns[0] || null;

    if (!targetRun) {
      return {
        asset: {
          id: typedAsset.id,
          platform: typedAsset.platform,
          title: typedAsset.title,
          canonicalUrl: typedAsset.canonicalUrl,
          externalAssetId: typedAsset.externalAssetId,
          publishedAt: typedAsset.publishedAt,
          verificationStatus: typedAsset.verificationStatus,
          verificationNote: typedAsset.verificationNote,
          draft: typedAsset.draft,
          publication: typedAsset.publication,
          campaign: typedAsset.campaign,
          planItem: typedAsset.planItem,
        },
        retestRuns: [],
        activeRetestRun: null,
      };
    }

    const retestItems = await this.db.client.retestItem.findMany({
      where: { retestRunId: targetRun.id },
      orderBy: { createdAt: "asc" },
    });

    // 1. 查找此 Run 下所有可选的 comparisonVersion
    const distinctComparisonVersions = await this.db.client.outcomeComparison.findMany({
      where: { retestRunId: targetRun.id },
      distinct: ["comparisonVersion"],
      select: { comparisonVersion: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    const availableComparisonVersions = distinctComparisonVersions.map((v) => v.comparisonVersion);
    const activeComparisonVersion =
      comparisonVersion?.trim() || availableComparisonVersions[0] || DEFAULT_OUTCOME_VERSION;

    // 2. 严格按活跃版本筛选对比结果，绝不跨版本混叠
    const outcomes = await this.db.client.outcomeComparison.findMany({
      where: {
        retestRunId: targetRun.id,
        comparisonVersion: activeComparisonVersion,
      },
      orderBy: { createdAt: "asc" },
    });

    // 3. 查找这些 outcome 关联的所有可选 attributionVersion
    const outcomeIds = outcomes.map((o) => o.id);
    const distinctAttributionVersions = await this.db.client.outcomeAttribution.findMany({
      where: { outcomeComparisonId: { in: outcomeIds } },
      distinct: ["attributionVersion"],
      select: { attributionVersion: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    const availableAttributionVersions = distinctAttributionVersions.map((v) => v.attributionVersion);
    const activeAttributionVersion =
      attributionVersion?.trim() || availableAttributionVersions[0] || DEFAULT_ATTRIBUTION_VERSION;

    // 4. 严格按活跃版本筛选归因结果
    const attributions = await this.db.client.outcomeAttribution.findMany({
      where: {
        outcomeComparisonId: { in: outcomeIds },
        attributionVersion: activeAttributionVersion,
      },
      orderBy: { createdAt: "asc" },
    });

    // 收集所有关联的证据 ID 以便获取原始 Evidence
    const evidenceIds = new Set<string>();
    for (const item of retestItems) {
      if (item.baselineEvidenceId) evidenceIds.add(item.baselineEvidenceId);
      if (item.evidenceId) evidenceIds.add(item.evidenceId);
    }
    for (const o of outcomes) {
      if (o.baselineEvidenceId) evidenceIds.add(o.baselineEvidenceId);
      if (o.retestEvidenceId) evidenceIds.add(o.retestEvidenceId);
    }

    const evidences = await this.db.client.evidence.findMany({
      where: { id: { in: Array.from(evidenceIds) } },
      select: {
        id: true,
        runId: true,
        queryText: true,
        provider: true,
        engineKey: true,
        engineName: true,
        requestedModel: true,
        responseModel: true,
        model: true,
        retrievalMode: true,
        sourceType: true,
        rawPrompt: true,
        rawResponse: true,
        createdAt: true,
      },
    });

    const evidenceMap: Record<string, any> = {};
    for (const ev of evidences) {
      evidenceMap[ev.id] = ev;
    }

    const queryRows = retestItems.map((item) => {
      const outcome = outcomes.find((o) => o.retestItemId === item.id) || null;
      // 严格通过 outcomeComparisonId 关联当前版本的归因记录
      const attribution = outcome
        ? attributions.find((a) => a.outcomeComparisonId === outcome.id) || null
        : null;
      const beforeEvidence = item.baselineEvidenceId ? evidenceMap[item.baselineEvidenceId] || null : null;
      const afterEvidence = item.evidenceId ? evidenceMap[item.evidenceId] || null : null;

      return {
        id: item.id,
        retestItemId: item.id,
        queryId: item.queryId,
        queryText: item.queryText,
        queryType: item.queryType,
        sanity: item.sanity,
        status: item.status,
        baselineStatus: item.baselineStatus,
        baselineWarning: item.baselineWarning,
        outcome,
        attribution,
        beforeEvidence,
        afterEvidence,
      };
    });

    // 计算当前单版本的指标汇总
    let comparableItems = 0;
    let warningItems = 0;
    let incompatibleItems = 0;
    let missingBaselineItems = 0;
    let missingRetestItems = 0;

    let mentionAbsentToPresent = 0;
    let mentionPresentToAbsent = 0;
    let citationCountDeltaTotal = 0;
    let recommendationPositiveChanges = 0;
    let positionImproved = 0;
    let positionWorsened = 0;

    for (const o of outcomes) {
      if (o.comparisonStatus === "COMPARABLE") comparableItems++;
      else if (o.comparisonStatus === "COMPARABLE_WITH_WARNING") warningItems++;
      else if (o.comparisonStatus === "INCOMPATIBLE") incompatibleItems++;
      else if (o.comparisonStatus === "MISSING_BASELINE") missingBaselineItems++;
      else if (o.comparisonStatus === "MISSING_RETEST_EVIDENCE") missingRetestItems++;

      const delta = o.deltaSnapshot as any;
      if (delta) {
        if (delta.brandMention?.change === "ABSENT_TO_PRESENT") mentionAbsentToPresent++;
        if (delta.brandMention?.change === "PRESENT_TO_ABSENT") mentionPresentToAbsent++;
        if (typeof delta.citation?.countDelta === "number") citationCountDeltaTotal += delta.citation.countDelta;
        if (
          delta.recommendation?.change === "ABSENT_TO_PRESENT" ||
          delta.recommendation?.change === "NOT_RECOMMENDED_TO_RECOMMENDED"
        ) {
          recommendationPositiveChanges++;
        }
        if (delta.position?.direction === "IMPROVED") positionImproved++;
        if (delta.position?.direction === "WORSENED" || delta.position?.direction === "DECLINED") {
          positionWorsened++;
        }
      }
    }

    let likelyRelatedCount = 0;
    let insufficientEvidenceCount = 0;
    let confoundedCount = 0;
    let noObservedChangeCount = 0;
    let positiveObservedChangeCount = 0;
    let negativeObservedChangeCount = 0;
    let mixedObservedChangeCount = 0;
    let neutralObservedChangeCount = 0;
    let directAssetCitationCount = 0;

    for (const a of attributions) {
      if (a.status === "LIKELY_RELATED") likelyRelatedCount++;
      else if (a.status === "INSUFFICIENT_EVIDENCE") insufficientEvidenceCount++;
      else if (a.status === "CONFOUNDED") confoundedCount++;
      else if (a.status === "NO_OBSERVED_CHANGE") noObservedChangeCount++;

      if (a.observedChangeType === "POSITIVE") positiveObservedChangeCount++;
      else if (a.observedChangeType === "NEGATIVE") negativeObservedChangeCount++;
      else if (a.observedChangeType === "MIXED") mixedObservedChangeCount++;
      else if (a.observedChangeType === "NEUTRAL") neutralObservedChangeCount++;

      const signals = a.signalsSnapshot as any;
      if (signals?.citationMatch?.status === "DIRECT_ASSET_CITATION") {
        directAssetCitationCount++;
      }
    }

    return {
      asset: {
        id: typedAsset.id,
        platform: typedAsset.platform,
        title: typedAsset.title,
        canonicalUrl: typedAsset.canonicalUrl,
        externalAssetId: typedAsset.externalAssetId,
        publishedAt: typedAsset.publishedAt,
        verificationStatus: typedAsset.verificationStatus,
        verificationNote: typedAsset.verificationNote,
        draft: typedAsset.draft,
        publication: typedAsset.publication,
        campaign: typedAsset.campaign,
        planItem: typedAsset.planItem,
      },
      retestRuns: typedAsset.retestRuns.map((r: any) => ({
        id: r.id,
        sequence: r.sequence,
        status: r.status,
        provider: r.provider,
        engineKey: r.engineKey,
        engineName: r.engineName,
        model: r.model,
        retrievalMode: r.retrievalMode,
        sourceType: r.sourceType,
        requestedAt: r.requestedAt,
        completedAt: r.completedAt,
        totalItems: r.totalItems,
        completedItems: r.completedItems,
      })),
      activeRetestRun: {
        id: targetRun.id,
        sequence: targetRun.sequence,
        status: targetRun.status,
        provider: targetRun.provider,
        engineKey: targetRun.engineKey,
        engineName: targetRun.engineName,
        model: targetRun.model,
        retrievalMode: targetRun.retrievalMode,
        sourceType: targetRun.sourceType,
        requestedAt: targetRun.requestedAt,
        completedAt: targetRun.completedAt,
        totalItems: targetRun.totalItems,
        completedItems: targetRun.completedItems,
        activeComparisonVersion,
        activeAttributionVersion,
        availableComparisonVersions,
        availableAttributionVersions,
        comparabilitySummary: {
          totalItems: outcomes.length,
          comparableItems,
          warningItems,
          incompatibleItems,
          missingBaselineItems,
          missingRetestItems,
        },
        observedChangesSummary: {
          mentionAbsentToPresent,
          mentionPresentToAbsent,
          citationCountDeltaTotal,
          recommendationPositiveChanges,
          positionImproved,
          positionWorsened,
        },
        attributionSummary: {
          totalOutcomes: attributions.length,
          likelyRelatedCount,
          insufficientEvidenceCount,
          confoundedCount,
          noObservedChangeCount,
          positiveObservedChangeCount,
          negativeObservedChangeCount,
          mixedObservedChangeCount,
          neutralObservedChangeCount,
          directAssetCitationCount,
        },
        queryRows,
      },
    };
  }
}
