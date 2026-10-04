// ============================================================================
// GEO Measurement Science V2 Foundation
// Pure functions dealing with LLM measurement noise, repeated observations,
// model drift detection, retrieval mode drift, and statistical honesty.
// ============================================================================

export interface ObservationSnapshot {
  queryId: string;
  queryText: string;
  engineKey: string;
  provider: string;
  requestedModel: string;
  responseModel: string | null;
  retrievalMode: string;
  sourceType: string;
  brandMentioned: boolean;
  mentionPosition: number | null;
  recommended: boolean;
  hasCitation: boolean;
  sentiment?: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  observedAt?: string;
}

export interface ReplicateAggregate {
  queryId: string;
  engineKey: string;
  replicateCount: number;
  mentionCount: number;
  mentionProbability: number; // 0.0 - 1.0
  recommendationCount: number;
  recommendationProbability: number; // 0.0 - 1.0
  meanPosition: number | null;
  citationCount: number;
  citationProbability: number; // 0.0 - 1.0
  crossReplicateConsistency: 'HIGH' | 'MEDIUM' | 'LOW';
}

export type ComparabilityVerdict =
  | 'EXACT_MATCH'
  | 'COMPARABLE_WITH_WARNING'
  | 'INCOMPATIBLE'
  | 'MISSING_BASELINE';

export interface ComparabilityAssessment {
  verdict: ComparabilityVerdict;
  modelDrift: boolean;
  retrievalModeDrift: boolean;
  warnings: string[];
  reasons: string[];
}

export type ConfidenceGrade = 'HIGH' | 'MEDIUM' | 'LOW' | 'INCONCLUSIVE';

export interface HonestOutcomeComparison {
  baselineCount: number;
  retestCount: number;
  totalSampleSize: number;
  baselineMentionRate: number;
  retestMentionRate: number;
  absoluteMentionDeltaPp: number; // percentage points (e.g. +20.0)
  baselineRecommendationRate: number;
  retestRecommendationRate: number;
  absoluteRecommendationDeltaPp: number;
  comparability: ComparabilityAssessment;
  confidenceLevel: ConfidenceGrade;
  statisticalHonestyNotice: string;
  allowsAttributionClaim: boolean;
}

/**
 * 聚合同一 Query × Engine 的多次重复观测 (Replicates)，
 * 计算提及率、首推率、平均位置和样本间一致性。
 */
export function aggregateReplicates(observations: ObservationSnapshot[]): ReplicateAggregate[] {
  const groups = new Map<string, ObservationSnapshot[]>();

  for (const obs of observations) {
    const key = `${obs.queryId}:::${obs.engineKey}`;
    const list = groups.get(key) || [];
    list.push(obs);
    groups.set(key, list);
  }

  const results: ReplicateAggregate[] = [];

  for (const [key, list] of groups.entries()) {
    const [queryId, engineKey] = key.split(':::');
    const n = list.length;
    if (n === 0) continue;

    const mentionCount = list.filter((o) => o.brandMentioned).length;
    const recommendationCount = list.filter((o) => o.recommended).length;
    const citationCount = list.filter((o) => o.hasCitation).length;

    const mentionedWithPos = list.filter((o) => o.brandMentioned && o.mentionPosition != null);
    const meanPosition =
      mentionedWithPos.length > 0
        ? Number(
            (
              mentionedWithPos.reduce((sum, o) => sum + (o.mentionPosition || 0), 0) /
              mentionedWithPos.length
            ).toFixed(1),
          )
        : null;

    const mentionProb = Number((mentionCount / n).toFixed(4));
    const recProb = Number((recommendationCount / n).toFixed(4));
    const citProb = Number((citationCount / n).toFixed(4));

    // Consistency: if all replicates agree (all mention or all absent) -> HIGH
    // if variance is moderate -> MEDIUM; if 50/50 split -> LOW
    let consistency: 'HIGH' | 'MEDIUM' | 'LOW';
    if (mentionCount === 0 || mentionCount === n) {
      consistency = 'HIGH';
    } else if (mentionCount === 1 || mentionCount === n - 1) {
      consistency = 'MEDIUM';
    } else {
      consistency = 'LOW';
    }

    results.push({
      queryId,
      engineKey,
      replicateCount: n,
      mentionCount,
      mentionProbability: mentionProb,
      recommendationCount,
      recommendationProbability: recProb,
      meanPosition,
      citationCount,
      citationProbability: citProb,
      crossReplicateConsistency: consistency,
    });
  }

  return results;
}

/**
 * 严格判定 Baseline 与 Retest 两个观测窗口之间的可比性：
 * 纳入 requestedModel、responseModel（漂移检测）、retrievalMode（检索模式漂移）。
 */
export function assessComparability(
  baseline: ObservationSnapshot[],
  retest: ObservationSnapshot[],
): ComparabilityAssessment {
  if (baseline.length === 0) {
    return {
      verdict: 'MISSING_BASELINE',
      modelDrift: false,
      retrievalModeDrift: false,
      warnings: ['缺少 Baseline 测量基线'],
      reasons: ['无法在没有 Baseline 的情况下进行复测对比。'],
    };
  }

  if (retest.length === 0) {
    return {
      verdict: 'INCOMPATIBLE',
      modelDrift: false,
      retrievalModeDrift: false,
      warnings: ['缺少 Retest 复测数据'],
      reasons: ['复测数据为空。'],
    };
  }

  const warnings: string[] = [];
  const reasons: string[] = [];
  let modelDrift = false;
  let retrievalModeDrift = false;

  // 1. Model Drift Detection
  const baselineResponseModels = new Set(baseline.map((o) => o.responseModel || o.requestedModel));
  const retestResponseModels = new Set(retest.map((o) => o.responseModel || o.requestedModel));

  for (const rm of retestResponseModels) {
    if (!baselineResponseModels.has(rm)) {
      modelDrift = true;
      warnings.push(`检测到模型版本漂移：Baseline 使用 [${[...baselineResponseModels].join(', ')}]，Retest 使用 [${rm}]。输出变化可能受模型底层更新影响。`);
    }
  }

  // 2. Retrieval Mode Drift Detection
  const baselineRetrievalModes = new Set(baseline.map((o) => (o.retrievalMode || '').toLowerCase()));
  const retestRetrievalModes = new Set(retest.map((o) => (o.retrievalMode || '').toLowerCase()));

  // If one is api_plain and the other is api_web_search/official_web_ui -> incompatible!
  const hasPlainBaseline = baselineRetrievalModes.has('api_plain');
  const hasWebRetest = retestRetrievalModes.has('api_web_search') || retestRetrievalModes.has('official_web_ui') || retestRetrievalModes.has('browser_agent');

  if (hasPlainBaseline && hasWebRetest) {
    retrievalModeDrift = true;
    return {
      verdict: 'INCOMPATIBLE',
      modelDrift,
      retrievalModeDrift: true,
      warnings: [...warnings, '检索环境严重失配：基线为纯模型 API (api_plain)，而复测为联网检索 (web_search)。二者不具备因果可比性。'],
      reasons: ['基线与复测的环境模式本质不同，禁止混为一谈。'],
    };
  }

  for (const mode of retestRetrievalModes) {
    if (!baselineRetrievalModes.has(mode)) {
      retrievalModeDrift = true;
      warnings.push(`检索模式变化：Baseline 为 [${[...baselineRetrievalModes].join(', ')}]，Retest 为 [${mode}]。`);
    }
  }

  // Final Verdict
  if (modelDrift || retrievalModeDrift) {
    return {
      verdict: 'COMPARABLE_WITH_WARNING',
      modelDrift,
      retrievalModeDrift,
      warnings,
      reasons: ['存在测量环境或模型版本漂移，对比结果需谨慎解读。'],
    };
  }

  return {
    verdict: 'EXACT_MATCH',
    modelDrift: false,
    retrievalModeDrift: false,
    warnings: [],
    reasons: ['基线与复测在 Provider、模型版本及检索模式上严格匹配。'],
  };
}

/**
 * 科学、诚实地计算 Before vs After 对比，禁止伪造精确置信度。
 */
export function calculateHonestComparison(
  baseline: ObservationSnapshot[],
  retest: ObservationSnapshot[],
): HonestOutcomeComparison {
  const comparability = assessComparability(baseline, retest);

  const bN = baseline.length;
  const rN = retest.length;
  const totalN = bN + rN;

  const bMention = bN > 0 ? baseline.filter((o) => o.brandMentioned).length : 0;
  const rMention = rN > 0 ? retest.filter((o) => o.brandMentioned).length : 0;

  const bMentionRate = bN > 0 ? Number((bMention / bN).toFixed(4)) : 0;
  const rMentionRate = rN > 0 ? Number((rMention / rN).toFixed(4)) : 0;
  const mentionDeltaPp = Number(((rMentionRate - bMentionRate) * 100).toFixed(1));

  const bRec = bN > 0 ? baseline.filter((o) => o.recommended).length : 0;
  const rRec = rN > 0 ? retest.filter((o) => o.recommended).length : 0;
  const bRecRate = bN > 0 ? Number((bRec / bN).toFixed(4)) : 0;
  const rRecRate = rN > 0 ? Number((rRec / rN).toFixed(4)) : 0;
  const recDeltaPp = Number(((rRecRate - bRecRate) * 100).toFixed(1));

  // Statistical Honesty & Confidence Grading
  let confidenceLevel: ConfidenceGrade;
  let notice: string;
  let allowsAttributionClaim: boolean;

  if (comparability.verdict === 'INCOMPATIBLE' || comparability.verdict === 'MISSING_BASELINE') {
    confidenceLevel = 'INCONCLUSIVE';
    notice = '测量环境不兼容或缺少基线，无法得出任何归因结论。';
    allowsAttributionClaim = false;
  } else if (bN < 3 || rN < 3) {
    confidenceLevel = 'LOW';
    notice = `观测到能见度变化 (Δ ${mentionDeltaPp > 0 ? `+${mentionDeltaPp}` : mentionDeltaPp}pp)，但样本量较小 (Baseline n=${bN}, Retest n=${rN})，受 LLM 随机性影响较大，不足以稳定归因。`;
    allowsAttributionClaim = false;
  } else if (comparability.modelDrift || comparability.retrievalModeDrift) {
    confidenceLevel = 'MEDIUM';
    notice = `样本量适中 (n=${totalN})，但存在模型或环境漂移，变化可能部分来自外部算法更新。`;
    allowsAttributionClaim = false; // conservative
  } else if (bN >= 5 && rN >= 5 && Math.abs(mentionDeltaPp) >= 15) {
    confidenceLevel = 'HIGH';
    notice = `样本量充足 (Baseline n=${bN}, Retest n=${rN})，且前后环境严格一致。观测到显著一致的改善趋势。`;
    allowsAttributionClaim = true;
  } else {
    confidenceLevel = 'MEDIUM';
    notice = `环境一致 (Baseline n=${bN}, Retest n=${rN})，观测到小幅变化。持续监测有助于验证稳定性。`;
    allowsAttributionClaim = true;
  }

  return {
    baselineCount: bN,
    retestCount: rN,
    totalSampleSize: totalN,
    baselineMentionRate: bMentionRate,
    retestMentionRate: rMentionRate,
    absoluteMentionDeltaPp: mentionDeltaPp,
    baselineRecommendationRate: bRecRate,
    retestRecommendationRate: rRecRate,
    absoluteRecommendationDeltaPp: recDeltaPp,
    comparability,
    confidenceLevel,
    statisticalHonestyNotice: notice,
    allowsAttributionClaim,
  };
}
