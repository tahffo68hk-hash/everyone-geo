/**
 * M7A GEO Diagnosis Engine —— 确定性、可解释、Evidence-backed 的问题诊断。
 *
 * 设计要点：
 *   - 输入是「Report 快照派生事实」+（可选）「第二份 Report 对比」，不读库不重算指标；
 *     规则全部纯函数，相同输入 → 相同输出（deterministic）。
 *   - 阈值属 GeoLens internal heuristic（DIAGNOSIS_V1_RULES），不是行业标准、
 *     不是 LLM 因果推断；样本量影响结论可靠性 —— DATA_QUALITY_WARNING 总是先产出。
 *   - Finding 的 evidenceLinks 指向已有 Evidence（runId/evidenceId/queryText 快照），
 *     绝不复制 rawResponse —— Evidence 仍唯一事实源且不可变。
 *   - diagnosisVersion 集中常量：自然发现口径排除品牌校验 Query，升级到 v2，历史 v1 快照不改写。
 */
export const DIAGNOSIS_VERSION = 'geolens-diagnosis-v2';

export type DiagnosisSeverity = 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type FindingType =
  | 'LOW_VISIBILITY'
  | 'LOW_RECOMMENDATION'
  | 'CATEGORY_GAP'
  | 'QUERY_GAP'
  | 'PROVIDER_GAP'
  | 'COMPETITOR_DOMINANCE'
  | 'COMPETITOR_RECOMMENDED_TARGET_ABSENT'
  | 'POOR_MENTION_POSITION'
  | 'CITATION_GAP'
  | 'SENTIMENT_RISK'
  | 'DATA_QUALITY_WARNING';

// ---------------------------------------------------------------------------
// 阈值配置（集中常量 —— 严禁在规则体内散落 magic number）
// ---------------------------------------------------------------------------
export const DIAGNOSIS_V1_RULES = {
  /** 样本量（eligible analyzed runs）过小的硬阈值：<5 HIGH / <10 MEDIUM / <16 LOW */
  sampleSize: { high: 5, medium: 10, low: 16 },
  /** 成功率（succeeded / (succeeded+failed)）低于该值 → 数据质量提示 */
  successRateMin: 0.8,
  visibility: { high: 0.2, medium: 0.4, low: 0.6 }, // 0–0.2 HIGH, 0.2–0.4 MEDIUM, 0.4–0.6 LOW
  recommendationAmongMentioned: { high: 0.2, medium: 0.4, low: 0.6 },
  /** 品牌被提及的 query 数 < 该值时不输出 LOW_RECOMMENDATION（样本不足交给 DQ） */
  recommendationMinMentioned: 3,
  category: { highEligible: 2, overallFloor: 0.15, gap: 0.15 },
  mentionPosition: { high: 5, medium: 3.5, low: 2.6, minPositions: 2 },
  citation: { minAnalyzed: 5 },
  sentimentRiskRatio: { high: 0.3, medium: 0.12 },
  competitorDominance: {
    minShare: 0.15, highShare: 0.5, mediumShare: 0.25,
    targetSoVScale: 0.5, maxTargetVisibility: 0.5, topN: 3,
  },
  providerGap: {
    /** 可见率差异（Δ = b - a 的绝对值）达到该值才报 PROVIDER_GAP */
    minAbsDelta: 0.15,
    /** 双方中较高者的可见率至少达到该值（避免「都很低」时噪声） */
    highSideFloor: 0.2,
    /** 数值低的 provider 相对高的 ≤ 该比例 → HIGH（如 10% vs 40% = 0.25） */
    highRatio: 0.5,
  },
} as const;

// ---------------------------------------------------------------------------
// 输入事实类型（API 组装，engine 只读）
// ---------------------------------------------------------------------------
export interface DiagnosisMetricSummary {
  visibilityRate: number | null;
  recommendationRate: number | null;
  averageMentionPosition: number | null;
  shareOfVoice: number | null;
  citationCount: number;
  citationDomainCount: number;
  sentimentDistribution: Record<string, number>;
}

export interface DiagnosisReportFacts {
  reportId: string;
  projectId: string;
  suiteName: string;
  suiteVersion: string;
  provider: string;
  engineKey: string;
  engineName: string;
  requestedModel: string | null;
  responseModel: string | null;
  metricSource: 'demo' | 'real' | 'mixed' | string;
  analysisVersion: string;
  competitorSetId: string | null;
  competitorSetName: string | null;
  competitorSetVersion: string | null;
  completedRuns: number;
  succeededRuns: number;
  failedRuns: number;
  analyzedRuns: number;
  partial: boolean;
  overall: DiagnosisMetricSummary;
  /** byCategory（report metricsSnapshot） */
  byCategory: Array<{
    category: string;
    queryEligibleCount: number;
    queryMentionedCount: number;
    metrics: DiagnosisMetricSummary;
  }>;
  /** M6B 竞对明细快照（无竞对集时为 null） */
  competitor: Array<{
    candidateId: string;
    canonicalName: string;
    competitorType: string;
    mentionCount: number;
    evidenceCount: number;
    shareOfVoice: number | null;
  }> | null;
  /** 已审核（APPROVED/激活集内）竞品 canonicalName 集 —— 只允许用它 */
  approvedCompetitors: string[];
}

export interface DiagnosisComparisonFacts {
  reportId: string;
  provider: string;
  engineName: string;
  requestedModel: string | null;
  responseModel: string | null;
  suiteVersion: string;
  metricSource: string;
  analysisVersion: string;
  competitorSetVersion: string | null;
  succeededRuns: number;
  partial: boolean;
  overall: DiagnosisMetricSummary;
  byCategory: Array<{ category: string; metrics: DiagnosisMetricSummary }>;
}

export interface DiagnosisQueryFact {
  runId: string;
  evidenceId: string | null;
  queryText: string;
  category: string | null;
  intent: string | null;
  sortOrder: number | null;
  sanity: boolean;
  status: string; // run.status
  analysisVersion: string | null;
  brandMentioned: boolean | null;
  mentionPosition: number | null;
  recommended: boolean | null;
  sentiment: string | null;
  citationCount: number | null;
  /** 该 Evidence 中已审核竞品是否以 positive（被推荐）语义出现 */
  competitorPositive: boolean;
  /** comparison 报告中同问题是否也品牌缺席（API 层按 queryText 对齐判定） */
  absentInComparison?: boolean;
}

export interface DiagnosisEvidenceLink {
  runId: string;
  evidenceId: string;
  queryText: string;
  reason: string;
}

export interface DiagnosisInput {
  diagnosisVersion: string;
  report: DiagnosisReportFacts;
  comparison?: DiagnosisComparisonFacts | null;
  /** 每个 eligible query 的事实（API 层按 run/evidence/analysis 组装） */
  queries: DiagnosisQueryFact[];
}

export interface DiagnosisCandidate {
  findingType: FindingType;
  severity: DiagnosisSeverity;
  category: string | null;
  title: string;
  summary: string;
  explanation: string;
  metricName: string | null;
  currentValue: number | null;
  referenceValue: number | null;
  queryCount: number;
  evidenceCount: number;
  provider: string | null;
  requestedModel: string | null;
  responseModel: string | null;
  competitorName: string | null;
  priorityScore: number;
  evidenceLinks: DiagnosisEvidenceLink[];
}

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------
const SEVERITY_WEIGHT: Record<DiagnosisSeverity, number> = { HIGH: 100, MEDIUM: 60, LOW: 30, INFO: 10 };

function severityRank(severity: DiagnosisSeverity): number {
  return SEVERITY_WEIGHT[severity];
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Deterministic priority: 严重度权重(50%) + 受影响比例(25%) + 证据信号(25%)。 */
export function computePriorityScore(
  severity: DiagnosisSeverity,
  affectedQueries: number,
  eligibleQueries: number,
  evidenceCount: number,
): number {
  const severityPart = severityRank(severity) * 0.5;
  const affectedPart = (eligibleQueries > 0 ? clamp01(affectedQueries / eligibleQueries) : affectedQueries > 0 ? 0.5 : 0) * 100 * 0.25;
  const evidencePart = clamp01(evidenceCount / 12) * 100 * 0.25;
  return Math.round(Math.max(0, Math.min(100, severityPart + affectedPart + evidencePart)));
}

function severityForRate(value: number | null, high: number, medium: number): DiagnosisSeverity | null {
  if (value === null) return null;
  if (value < high) return 'HIGH';
  if (value < medium) return 'MEDIUM';
  return 'LOW';
}

// ---------------------------------------------------------------------------
// Rule: DATA_QUALITY_WARNING（总是最先评估，样本/成功率/partial/演示/口径）
// ---------------------------------------------------------------------------
export function evaluateDataQuality(input: DiagnosisInput): DiagnosisCandidate[] {
  const out: DiagnosisCandidate[] = [];
  const r = input.report;
  const eligible = r.analyzedRuns;
  const finished = r.succeededRuns + r.failedRuns;

  // 1) 样本量过小 —— 一切结论都只是初步信号。
  if (eligible > 0 && eligible < DIAGNOSIS_V1_RULES.sampleSize.low) {
    const severity: DiagnosisSeverity =
      eligible < DIAGNOSIS_V1_RULES.sampleSize.high ? 'HIGH'
        : eligible < DIAGNOSIS_V1_RULES.sampleSize.medium ? 'MEDIUM'
          : 'LOW';
    out.push({
      findingType: 'DATA_QUALITY_WARNING', severity,
      category: null,
      title: '样本量较小',
      summary: `当前报告仅包含 ${eligible} 个已分析测试问题（成功 ${r.succeededRuns} / 失败 ${r.failedRuns}）。以下诊断仅作为初步信号，不代表稳定 GEO 表现。`,
      explanation: `阈值属 GeoLens internal heuristic（geolens-diagnosis-v2：sampleSize<${DIAGNOSIS_V1_RULES.sampleSize.high} 高 / <${DIAGNOSIS_V1_RULES.sampleSize.medium} 中 / <${DIAGNOSIS_V1_RULES.sampleSize.low} 低）。样本量影响结论可靠性，请勿将小样本解读为稳定行业结论。`,
      metricName: 'analyzedRuns', currentValue: eligible, referenceValue: DIAGNOSIS_V1_RULES.sampleSize.low,
      queryCount: eligible, evidenceCount: 0, provider: null, requestedModel: null, responseModel: null,
      competitorName: null, priorityScore: computePriorityScore(severity, eligible, eligible, 0),
      evidenceLinks: [],
    });
  } else if (eligible === 0) {
    out.push({
      findingType: 'DATA_QUALITY_WARNING', severity: 'HIGH', category: null,
      title: '没有可诊断的成功样本',
      summary: `该报告没有可用于诊断的已分析成功样本（成功 ${r.succeededRuns} / 失败 ${r.failedRuns}）。请先完成 Benchmark Run 或检查分析版本。`,
      explanation: 'geolens-diagnosis-v2：成功样本为 0 时诊断无事实基础，仅输出数据质量提示。',
      metricName: 'analyzedRuns', currentValue: 0, referenceValue: 1,
      queryCount: 0, evidenceCount: 0, provider: null, requestedModel: null, responseModel: null,
      competitorName: null, priorityScore: computePriorityScore('HIGH', 0, 1, 0), evidenceLinks: [],
    });
  }

  // 2) 成功率过低（失败样本占比高 → denominator 不完整）。
  if (finished > 0 && r.succeededRuns / finished < DIAGNOSIS_V1_RULES.successRateMin) {
    const ratio = r.succeededRuns / finished;
    const severity: DiagnosisSeverity = ratio < 0.5 ? 'HIGH' : ratio < DIAGNOSIS_V1_RULES.successRateMin ? 'MEDIUM' : 'LOW';
    out.push({
      findingType: 'DATA_QUALITY_WARNING', severity, category: null,
      title: '成功样本率偏低',
      summary: `成功样本 ${r.succeededRuns}/${finished}（${(ratio * 100).toFixed(1)}%）。失败样本不进入分母，覆盖率不完整，对比与诊断需谨慎。`,
      explanation: 'geolens-diagnosis-v2：successRateMin=0.8；低于 0.5 为高、0.5–0.8 为中。失败 Provider run 不计入 successful denominator。',
      metricName: 'succeededRuns', currentValue: r.succeededRuns, referenceValue: Math.ceil(DIAGNOSIS_V1_RULES.successRateMin * finished),
      queryCount: finished, evidenceCount: 0, provider: null, requestedModel: null, responseModel: null,
      competitorName: null, priorityScore: computePriorityScore(severity, finished, Math.max(finished, 1), 0), evidenceLinks: [],
    });
  }

  // 3) PARTIAL 报告。
  if (r.partial) {
    out.push({
      findingType: 'DATA_QUALITY_WARNING', severity: 'MEDIUM', category: null,
      title: '报告为部分完成',
      summary: `该报告基于部分完成状态生成（成功 ${r.succeededRuns} / 失败 ${r.failedRuns}），不代表完整测试集结论。`,
      explanation: 'geolens-diagnosis-v2：PARTIAL 报告保留成功/失败分母，诊断只对已成功样本负责。',
      metricName: 'succeededRuns', currentValue: r.succeededRuns, referenceValue: r.completedRuns,
      queryCount: 0, evidenceCount: 0, provider: null, requestedModel: null, responseModel: null,
      competitorName: null, priorityScore: computePriorityScore('MEDIUM', 0, 1, 0), evidenceLinks: [],
    });
  }

  // 4) 演示数据（demo/mixed 一律提示，绝不伪装真实结论）。
  if (r.metricSource === 'demo' || r.metricSource === 'mixed') {
    const isDemo = r.metricSource === 'demo';
    out.push({
      findingType: 'DATA_QUALITY_WARNING', severity: isDemo ? 'INFO' : 'MEDIUM', category: null,
      title: isDemo ? '演示数据诊断' : '混合数据（仅真实子集计入）',
      summary: isDemo
        ? '该报告基于演示（Mock 模拟）数据。以下诊断为演示诊断，不代表真实 Provider 的 GEO 表现。'
        : '该报告含演示数据，指标仅基于真实子集；诊断口径与演示部分不同，请谨慎解读。',
      explanation: 'geolens-diagnosis-v2：Demo/Real 强隔离。演示报告不得伪装真实结论，UI 标注「演示诊断」。',
      metricName: 'metricSource', currentValue: null, referenceValue: null,
      queryCount: 0, evidenceCount: 0, provider: null, requestedModel: null, responseModel: null,
      competitorName: null, priorityScore: computePriorityScore(isDemo ? 'INFO' : 'MEDIUM', 0, 1, 0), evidenceLinks: [],
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Rule: LOW_VISIBILITY
// ---------------------------------------------------------------------------
export function evaluateLowVisibility(input: DiagnosisInput): DiagnosisCandidate[] {
  const r = input.report;
  if (r.analyzedRuns <= 0) return [];
  const rate = r.overall.visibilityRate;
  if (rate === null) return [];
  if (rate >= DIAGNOSIS_V1_RULES.visibility.low) return [];
  const severity = severityForRate(rate, DIAGNOSIS_V1_RULES.visibility.high, DIAGNOSIS_V1_RULES.visibility.medium) ?? 'LOW';
  const mentioned = r.overall.visibilityRate !== null
    ? Math.round(r.overall.visibilityRate * r.analyzedRuns) : 0;
  const mentionedCount = Math.min(r.analyzedRuns, mentioned);
  const absent = r.analyzedRuns - mentionedCount;
  const links: DiagnosisEvidenceLink[] = input.queries
    .filter(q => q.status === 'SUCCEEDED' && q.analysisVersion === r.analysisVersion && !q.sanity && q.brandMentioned === false && q.evidenceId)
    .slice(0, 3)
    .map(q => ({ runId: q.runId, evidenceId: q.evidenceId!, queryText: q.queryText, reason: '品牌在该问题回答中未被提及（代表性未提及样本）' }));
  return [{
    findingType: 'LOW_VISIBILITY', severity, category: null,
    title: '品牌整体可见度偏低',
    summary: `${r.analyzedRuns} 个已分析测试问题中，品牌仅在 ${mentionedCount} 个回答中被提及（可见率 ${(rate * 100).toFixed(1)}%）。`,
    explanation: `geolens-diagnosis-v2：visibilityRate 阈值 <${(DIAGNOSIS_V1_RULES.visibility.high * 100).toFixed(0)}% 高 / <${(DIAGNOSIS_V1_RULES.visibility.medium * 100).toFixed(0)}% 中 / <${(DIAGNOSIS_V1_RULES.visibility.low * 100).toFixed(0)}% 低（internal heuristic）。品牌可见率偏低=品牌经常不出现在 AI 回答中。`,
    metricName: 'visibilityRate', currentValue: rate, referenceValue: DIAGNOSIS_V1_RULES.visibility.low,
    queryCount: absent, evidenceCount: links.length, provider: r.provider,
    requestedModel: r.requestedModel, responseModel: r.responseModel, competitorName: null,
    priorityScore: computePriorityScore(severity, absent, r.analyzedRuns, links.length),
    evidenceLinks: links,
  }];
}

// ---------------------------------------------------------------------------
// Rule: LOW_RECOMMENDATION（区别于可见性：品牌被提及但很少被推荐）
// ---------------------------------------------------------------------------
export function evaluateLowRecommendation(input: DiagnosisInput): DiagnosisCandidate[] {
  const r = input.report;
  if (r.analyzedRuns <= 0) return [];
  const mentioned = input.queries.filter(q => q.status === 'SUCCEEDED' && q.analysisVersion === r.analysisVersion && !q.sanity && q.brandMentioned === true);
  if (mentioned.length < DIAGNOSIS_V1_RULES.recommendationMinMentioned) return [];
  const recommended = mentioned.filter(q => q.recommended === true).length;
  const ratio = recommended / mentioned.length;
  if (ratio >= DIAGNOSIS_V1_RULES.recommendationAmongMentioned.low) return [];
  const severity = severityForRate(ratio, DIAGNOSIS_V1_RULES.recommendationAmongMentioned.high, DIAGNOSIS_V1_RULES.recommendationAmongMentioned.medium) ?? 'LOW';
  const notRec = mentioned.length - recommended;
  const links: DiagnosisEvidenceLink[] = mentioned
    .filter(q => q.recommended === false && q.evidenceId)
    .slice(0, 3)
    .map(q => ({ runId: q.runId, evidenceId: q.evidenceId!, queryText: q.queryText, reason: '品牌被提及但未被推荐（代表性样本）' }));
  return [{
    findingType: 'LOW_RECOMMENDATION', severity, category: null,
    title: '品牌推荐表现偏弱',
    summary: `品牌在 ${mentioned.length} 个问题中被提及，其中仅 ${recommended} 个获得推荐（推荐率 ${(ratio * 100).toFixed(1)}%）。`,
    explanation: `geolens-diagnosis-v2：推荐率（被提及样本中 recommended 占比）阈值 <${(DIAGNOSIS_V1_RULES.recommendationAmongMentioned.high * 100).toFixed(0)}% 高 / <${(DIAGNOSIS_V1_RULES.recommendationAmongMentioned.medium * 100).toFixed(0)}% 中 / <${(DIAGNOSIS_V1_RULES.recommendationAmongMentioned.low * 100).toFixed(0)}% 低。仅当品牌被提及样本 ≥${DIAGNOSIS_V1_RULES.recommendationMinMentioned} 才触发（否则样本不足交由 DATA_QUALITY_WARNING）。区别于可见性问题：品牌能出现，但 AI 未优先推荐。`,
    metricName: 'recommendationRate', currentValue: ratio, referenceValue: DIAGNOSIS_V1_RULES.recommendationAmongMentioned.low,
    queryCount: notRec, evidenceCount: links.length, provider: r.provider,
    requestedModel: r.requestedModel, responseModel: r.responseModel, competitorName: null,
    priorityScore: computePriorityScore(severity, notRec, mentioned.length, links.length),
    evidenceLinks: links,
  }];
}

// ---------------------------------------------------------------------------
// Rule: CATEGORY_GAP（byCategory 显著低于 overall / category visibility = 0）
// ---------------------------------------------------------------------------
export function evaluateCategoryGap(input: DiagnosisInput): DiagnosisCandidate[] {
  const r = input.report;
  if (r.analyzedRuns <= 0) return [];
  const overallVis = r.overall.visibilityRate;
  if (overallVis === null) return [];
  const out: DiagnosisCandidate[] = [];
  for (const row of r.byCategory) {
    if (row.queryEligibleCount <= 0) continue;
    const catVis = row.metrics.visibilityRate;
    if (catVis === null) continue;
    let severity: DiagnosisSeverity | null = null;
    // category visibility = 0 且样本 ≥2、整体有可见度 → 明显缺口（HIGH）
    if (catVis === 0 && row.queryEligibleCount >= DIAGNOSIS_V1_RULES.category.highEligible && overallVis > 0) {
      severity = 'HIGH';
    } else if (overallVis >= DIAGNOSIS_V1_RULES.category.overallFloor && catVis > 0
      && overallVis - catVis >= DIAGNOSIS_V1_RULES.category.gap) {
      severity = catVis < DIAGNOSIS_V1_RULES.visibility.medium ? 'MEDIUM' : 'LOW';
    }
    if (!severity) continue;
    const categoryQueries = input.queries.filter(q => q.status === 'SUCCEEDED' && q.analysisVersion === r.analysisVersion && !q.sanity && q.category === row.category);
    const absent = categoryQueries.filter(q => q.brandMentioned === false);
    const links: DiagnosisEvidenceLink[] = absent
      .filter(q => q.evidenceId)
      .slice(0, 3)
      .map(q => ({ runId: q.runId, evidenceId: q.evidenceId!, queryText: q.queryText, reason: '该场景下品牌缺失的代表性证据' }));
    out.push({
      findingType: 'CATEGORY_GAP', severity, category: row.category,
      title: `${row.category} 场景存在明显品牌缺口`,
      summary: `「${row.category}」场景：可见率 ${(catVis * 100).toFixed(1)}%（${row.queryMentionedCount}/${row.queryEligibleCount} 提及），总体可见率 ${(overallVis * 100).toFixed(1)}%。`,
      explanation: 'geolens-diagnosis-v2：category 可见率为 0（样本≥2 且 overall>0）→ HIGH；低于 overall 超过 15pp → MEDIUM/LOW。场景分类使用 Benchmark canonical category。',
      metricName: 'visibilityRate', currentValue: catVis, referenceValue: overallVis,
      queryCount: absent.length, evidenceCount: links.length, provider: r.provider,
      requestedModel: r.requestedModel, responseModel: r.responseModel, competitorName: null,
      priorityScore: computePriorityScore(severity, absent.length, row.queryEligibleCount, links.length),
      evidenceLinks: links,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule: QUERY_GAP（具体 Query 长期缺失，带竞争/跨模型锚点）
// ---------------------------------------------------------------------------
export function evaluateQueryGap(input: DiagnosisInput): DiagnosisCandidate[] {
  const r = input.report;
  if (r.analyzedRuns <= 0) return [];
  const eligible = input.queries.filter(q => q.status === 'SUCCEEDED' && q.analysisVersion === r.analysisVersion && !q.sanity);
  const withSet = r.competitorSetId !== null && input.report.approvedCompetitors.length > 0;
  const hasComparison = Boolean(input.comparison);
  const out: DiagnosisCandidate[] = [];

  // 按 category 聚合展示（避免 24 个重复 finding；evidence 全量保留）
  const byCat = new Map<string | null, DiagnosisQueryFact[]>();
  for (const q of eligible) {
    if (q.brandMentioned !== false) continue; // 只关心品牌缺席
    const arr = byCat.get(q.category) ?? [];
    arr.push(q);
    byCat.set(q.category, arr);
  }
  for (const [category, queries] of byCat) {
    const anchored = queries.filter(q => {
      // A) 已审核竞品在该回答中被提及/被推荐
      if (withSet && q.competitorPositive) return true;
      // C) 跨 Provider 对比：comparison 侧同问题也缺席（API 按 queryText 对齐判定）
      if (hasComparison && q.absentInComparison === true) return true;
      return false;
    });
    if (anchored.length === 0) continue;
    const links: DiagnosisEvidenceLink[] = anchored
      .filter(q => q.evidenceId)
      .slice(0, 8)
      .map(q => ({ runId: q.runId, evidenceId: q.evidenceId!, queryText: q.queryText, reason: '品牌在该问题缺席（query-level gap）' }));
    const severity: DiagnosisSeverity = anchored.length >= 4 ? 'MEDIUM' : anchored.length >= 2 ? 'LOW' : 'INFO';
    const label = category ? `「${category}」场景` : '若干';
    out.push({
      findingType: 'QUERY_GAP', severity, category,
      title: `${label}存在品牌缺席的问题`,
      summary: `${anchored.length} 个已分析问题中品牌未出现：${anchored.slice(0, 3).map(q => `“${q.queryText}”`).join('、')}${anchored.length > 3 ? ' 等' : ''}。`,
      explanation: 'geolens-diagnosis-v2：仅当缺席 query 带锚点才报——(A) 已审核竞品被提及/被推荐，或 (C) 跨 Provider 对比中两侧均缺席。无锚点的纯缺席归入 CATEGORY_GAP / LOW_VISIBILITY，避免噪声。',
      metricName: 'visibilityRate', currentValue: 0, referenceValue: 1,
      queryCount: anchored.length, evidenceCount: links.length, provider: r.provider,
      requestedModel: r.requestedModel, responseModel: r.responseModel, competitorName: null,
      priorityScore: computePriorityScore(severity, anchored.length, eligible.length, links.length),
      evidenceLinks: links,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule: COMPETITOR_RECOMMENDED_TARGET_ABSENT（竞品被推荐而品牌缺席 —— 高价值）
// ---------------------------------------------------------------------------
export function evaluateCompetitorRecommendedTargetAbsent(input: DiagnosisInput): DiagnosisCandidate[] {
  const r = input.report;
  if (r.analyzedRuns <= 0 || r.competitorSetId === null) return [];
  if (input.report.approvedCompetitors.length === 0) return [];
  const eligible = input.queries.filter(q => q.status === 'SUCCEEDED' && q.analysisVersion === r.analysisVersion && !q.sanity);
  const hits = eligible.filter(q => q.brandMentioned === false && q.competitorPositive && q.evidenceId);
  if (hits.length === 0) return [];
  const links: DiagnosisEvidenceLink[] = hits.slice(0, 8).map(q => ({
    runId: q.runId, evidenceId: q.evidenceId!, queryText: q.queryText,
    reason: '已审核竞品被正面提及/推荐而目标品牌缺席（原始回答见 Evidence）',
  }));
  const severity: DiagnosisSeverity = hits.length >= 3 ? 'HIGH' : hits.length >= 2 ? 'MEDIUM' : 'LOW';
  return [{
    findingType: 'COMPETITOR_RECOMMENDED_TARGET_ABSENT', severity, category: null,
    title: '竞品被推荐，但目标品牌缺席',
    summary: `${hits.length} 个问题中，已审核竞品被正面提及（推荐信号），但目标品牌未出现：${hits.slice(0, 3).map(q => `“${q.queryText}”`).join('、')}${hits.length > 3 ? ' 等' : ''}。`,
    explanation: '「已审核竞品」指激活 Competitor Set 内的 approved 竞品（DISCOVERED 未审核候选绝不使用）。competitorPositive 依据存储的 Analysis mention 情感（同一确定性词法规则）为 positive（= 被推荐/正面提及）。本项为高商业价值信号：竞品正在抢占品牌缺席的回答。',
    metricName: null, currentValue: null, referenceValue: null,
    queryCount: hits.length, evidenceCount: links.length, provider: r.provider,
    requestedModel: r.requestedModel, responseModel: r.responseModel, competitorName: null,
    priorityScore: computePriorityScore(severity, hits.length, eligible.length, links.length),
    evidenceLinks: links,
  }];
}

// ---------------------------------------------------------------------------
// Rule: COMPETITOR_DOMINANCE（基于 Competitor Set / SoV / coverage）
// ---------------------------------------------------------------------------
export function evaluateCompetitorDominance(input: DiagnosisInput): DiagnosisCandidate[] {
  const r = input.report;
  if (r.analyzedRuns <= 0 || !r.competitor || r.competitor.length === 0) return [];
  const cfg = DIAGNOSIS_V1_RULES.competitorDominance;
  const targetSoV = r.overall.shareOfVoice ?? 0;
  const targetVis = r.overall.visibilityRate ?? 0;
  const out: DiagnosisCandidate[] = [];
  const candidates = [...r.competitor]
    .filter(c => c.shareOfVoice !== null && c.shareOfVoice >= cfg.minShare
      && c.shareOfVoice > Math.max(targetSoV * cfg.targetSoVScale, 0.05)
      && targetVis <= cfg.maxTargetVisibility)
    .sort((a, b) => (b.shareOfVoice ?? 0) - (a.shareOfVoice ?? 0))
    .slice(0, cfg.topN);
  for (const c of candidates) {
    const share = c.shareOfVoice ?? 0;
    const severity: DiagnosisSeverity = share >= cfg.highShare ? 'HIGH' : share >= cfg.mediumShare ? 'MEDIUM' : 'LOW';
    const coverage = r.analyzedRuns > 0 ? (c.evidenceCount / r.analyzedRuns) : 0;
    const links: DiagnosisEvidenceLink[] = input.queries
      .filter(q => q.status === 'SUCCEEDED' && q.analysisVersion === r.analysisVersion && !q.sanity && q.evidenceId)
      .slice(0, 5)
      .map(q => ({ runId: q.runId, evidenceId: q.evidenceId!, queryText: q.queryText, reason: `竞品「${c.canonicalName}」出现/可能出现的样本（供对照）` }));
    out.push({
      findingType: 'COMPETITOR_DOMINANCE', severity, category: null,
      title: `竞品「${c.canonicalName}」在当前测试场景具有明显曝光优势`,
      summary: `${c.canonicalName}：${c.evidenceCount} 条证据提及（coverage ${(coverage * 100).toFixed(0)}%）、SoV ${(share * 100).toFixed(0)}%；目标品牌可见率 ${(targetVis * 100).toFixed(1)}%。`,
      explanation: 'SoV 为 AI 声量份额（mention 占比），不是市场占有率。geolens-diagnosis-v2：竞品 SoV≥15% 且显著高于目标品牌（> max(targetSoV×0.5, 5%)）且目标可见率≤50% → 触发；≥50% HIGH / ≥25% MEDIUM。',
      metricName: 'shareOfVoice', currentValue: share, referenceValue: targetSoV,
      queryCount: c.evidenceCount, evidenceCount: links.length, provider: r.provider,
      requestedModel: r.requestedModel, responseModel: r.responseModel, competitorName: c.canonicalName,
      priorityScore: computePriorityScore(severity, c.evidenceCount, r.analyzedRuns, links.length),
      evidenceLinks: links,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule: POOR_MENTION_POSITION（品牌出现但位置靠后）
// ---------------------------------------------------------------------------
export function evaluatePoorMentionPosition(input: DiagnosisInput): DiagnosisCandidate[] {
  const r = input.report;
  if (r.analyzedRuns <= 0) return [];
  const positions = input.queries
    .filter(q => q.status === 'SUCCEEDED' && q.analysisVersion === r.analysisVersion && !q.sanity && q.brandMentioned === true && q.mentionPosition !== null)
    .map(q => ({ q, position: q.mentionPosition as number }));
  if (positions.length < DIAGNOSIS_V1_RULES.mentionPosition.minPositions) return [];
  const avg = positions.reduce((s, x) => s + x.position, 0) / positions.length;
  const cfg = DIAGNOSIS_V1_RULES.mentionPosition;
  let severity: DiagnosisSeverity | null = null;
  if (avg >= cfg.high) severity = 'HIGH';
  else if (avg >= cfg.medium) severity = 'MEDIUM';
  else if (avg >= cfg.low) severity = 'LOW';
  if (!severity) return [];
  const links: DiagnosisEvidenceLink[] = positions
    .filter(x => x.q.evidenceId)
    .slice(0, 3)
    .map(x => ({ runId: x.q.runId, evidenceId: x.q.evidenceId!, queryText: x.q.queryText, reason: `品牌提及位置 ${x.position}（平均 ${avg.toFixed(1)}）` }));
  return [{
    findingType: 'POOR_MENTION_POSITION', severity, category: null,
    title: '品牌在回答中的提及位置偏后',
    summary: `品牌被提及的 ${positions.length} 个问题平均提及位置 ${avg.toFixed(1)}（${positions.map(p => p.position).join('、')}）。`,
    explanation: 'geolens-diagnosis-v2：平均提及位置 ≥5 HIGH / ≥3.5 MEDIUM / ≥2.6 LOW；仅品牌被提及的问题参与计算，需 ≥2 个位置样本（否则交 DATA_QUALITY_WARNING）。位置靠后=品牌出现但可能在推荐列表中不占优。',
    metricName: 'averageMentionPosition', currentValue: avg, referenceValue: cfg.low,
    queryCount: positions.length, evidenceCount: links.length, provider: r.provider,
    requestedModel: r.requestedModel, responseModel: r.responseModel, competitorName: null,
    priorityScore: computePriorityScore(severity, positions.length, r.analyzedRuns, links.length),
    evidenceLinks: links,
  }];
}

// ---------------------------------------------------------------------------
// Rule: CITATION_GAP（诚实语义 —— 仅说明未观察到引用信号，不做因果推断）
// ---------------------------------------------------------------------------
export function evaluateCitationGap(input: DiagnosisInput): DiagnosisCandidate[] {
  const r = input.report;
  if (r.analyzedRuns < DIAGNOSIS_V1_RULES.citation.minAnalyzed) return [];
  if (r.overall.citationCount > 0) return [];
  const links: DiagnosisEvidenceLink[] = input.queries
    .filter(q => q.status === 'SUCCEEDED' && q.analysisVersion === r.analysisVersion && !q.sanity && q.evidenceId)
    .slice(0, 3)
    .map(q => ({ runId: q.runId, evidenceId: q.evidenceId!, queryText: q.queryText, reason: '无引用样本的代表性证据' }));
  return [{
    findingType: 'CITATION_GAP', severity: 'INFO', category: null,
    title: '当前样本中未观察到明显引用信号',
    summary: `${r.analyzedRuns} 个已分析问题中引用数 0、引用域名数 0。当前检索模式为普通模型 API（api_plain），该结果仅表示未观察到引用，不代表官网权威性不足。`,
    explanation: 'geolens-diagnosis-v2 诚实语义：在非联网检索（api_plain）下不做“权威性不足”的因果推断；只有当样本 ≥5 且全无引用时才提示。',
    metricName: 'citationCount', currentValue: 0, referenceValue: 1,
    queryCount: r.analyzedRuns, evidenceCount: links.length, provider: r.provider,
    requestedModel: r.requestedModel, responseModel: r.responseModel, competitorName: null,
    priorityScore: computePriorityScore('INFO', r.analyzedRuns, r.analyzedRuns, links.length),
    evidenceLinks: links,
  }];
}

// ---------------------------------------------------------------------------
// Rule: SENTIMENT_RISK（仅当 negative Analysis 存在 —— 规则版情感，非舆情 AI）
// ---------------------------------------------------------------------------
export function evaluateSentimentRisk(input: DiagnosisInput): DiagnosisCandidate[] {
  const r = input.report;
  if (r.analyzedRuns <= 0) return [];
  const negative = input.queries.filter(q => q.status === 'SUCCEEDED' && q.analysisVersion === r.analysisVersion && !q.sanity && q.sentiment === 'negative');
  if (negative.length === 0) return [];
  const ratio = negative.length / r.analyzedRuns;
  const cfg = DIAGNOSIS_V1_RULES.sentimentRiskRatio;
  const severity: DiagnosisSeverity = ratio >= cfg.high ? 'HIGH' : ratio >= cfg.medium ? 'MEDIUM' : 'LOW';
  const links: DiagnosisEvidenceLink[] = negative
    .filter(q => q.evidenceId)
    .slice(0, 3)
    .map(q => ({ runId: q.runId, evidenceId: q.evidenceId!, queryText: q.queryText, reason: '负面情感分析样本（规则版情感判断）' }));
  return [{
    findingType: 'SENTIMENT_RISK', severity, category: null,
    title: '存在负面情感风险',
    summary: `${negative.length}/${r.analyzedRuns} 个已分析问题被当前规则版情感分析判为负面（${(ratio * 100).toFixed(1)}%）。`,
    explanation: 'geolens-diagnosis-v2：仅当负面 Analysis 存在才触发；情感来自确定性词法规则（非 LLM 舆情分析），比例 ≥30% HIGH / ≥12% MEDIUM。',
    metricName: 'sentimentDistribution.negative', currentValue: negative.length, referenceValue: 0,
    queryCount: negative.length, evidenceCount: links.length, provider: r.provider,
    requestedModel: r.requestedModel, responseModel: r.responseModel, competitorName: null,
    priorityScore: computePriorityScore(severity, negative.length, r.analyzedRuns, links.length),
    evidenceLinks: links,
  }];
}

// ---------------------------------------------------------------------------
// Rule: PROVIDER_GAP（跨模型比较 —— 必须带 compatible comparison）
// ---------------------------------------------------------------------------
export function evaluateProviderGap(input: DiagnosisInput): DiagnosisCandidate[] {
  const c = input.comparison;
  if (!c) return [];
  const a = input.report;
  if (a.analyzedRuns <= 0 || c.overall.visibilityRate === null || a.overall.visibilityRate === null) return [];
  const cfg = DIAGNOSIS_V1_RULES.providerGap;
  const visA = a.overall.visibilityRate;
  const visB = c.overall.visibilityRate;
  const delta = visB - visA; // 正值 = comparison(通常是另一 Provider) 更高
  if (Math.abs(delta) < cfg.minAbsDelta) return [];
  const highSide = Math.max(visA, visB);
  if (highSide < cfg.highSideFloor) return [];
  const lowSide = Math.min(visA, visB);
  const ratio = highSide > 0 ? lowSide / highSide : 0;
  if (ratio > cfg.highRatio) return [];
  const aName = `${a.engineName ?? a.provider}`;
  const bName = `${c.engineName ?? c.provider}`;
  const lowIsA = visA < visB;
  const lowName = lowIsA ? aName : bName;
  const highName = lowIsA ? bName : aName;
  const severity: DiagnosisSeverity = ratio <= 0.25 ? 'HIGH' : ratio <= cfg.highRatio ? 'MEDIUM' : 'LOW';
  const links: DiagnosisEvidenceLink[] = [];
  // 证据链接：低可见率一侧的代表性缺席样本（若本报告为该侧）或比较侧报告代表样本。
  if (lowIsA) {
    for (const q of input.queries.filter(q => q.status === 'SUCCEEDED' && q.analysisVersion === a.analysisVersion && !q.sanity && q.brandMentioned === false && q.evidenceId).slice(0, 3)) {
      links.push({ runId: q.runId, evidenceId: q.evidenceId!, queryText: q.queryText, reason: '低可见率 Provider 侧品牌缺席样本' });
    }
  }
  return [{
    findingType: 'PROVIDER_GAP', severity, category: null,
    title: '品牌在某模型服务中的可见度明显更低',
    summary: `${lowName} 可见率 ${(lowSide * 100).toFixed(1)}% vs ${highName} ${(highSide * 100).toFixed(1)}%（Δ ${(delta * 100).toFixed(1)}pp）。`,
    explanation: `这是跨模型服务比较（${aName} vs ${bName}），仅在 comparison 维度兼容（COMPARABLE 或仅 Provider/模型差异的 PARTIALLY_COMPARABLE）时输出。阈值：可见率差≥${(cfg.minAbsDelta * 100).toFixed(0)}pp 且较高侧≥${(cfg.highSideFloor * 100).toFixed(0)}%、低/高≤${(cfg.highRatio * 100).toFixed(0)}% → HIGH（≤25%）/ MEDIUM。结果反映模型服务差异，不代表单一口径回归。`,
    metricName: 'visibilityRate', currentValue: lowIsA ? visA : visB, referenceValue: lowIsA ? visB : visA,
    queryCount: 0, evidenceCount: links.length,
    provider: lowIsA ? a.provider : c.provider,
    requestedModel: lowIsA ? a.requestedModel : c.requestedModel,
    responseModel: lowIsA ? a.responseModel : c.responseModel,
    competitorName: null,
    priorityScore: computePriorityScore(severity, 1, 1, links.length),
    evidenceLinks: links,
  }];
}

// ---------------------------------------------------------------------------
// Supported-finding 说明（v1 无法可靠支持的类型如实说明，不伪造）
// ---------------------------------------------------------------------------
export function supportedFindingTypes(input: DiagnosisInput): Array<{ findingType: FindingType; supported: boolean; reason: string }> {
  const list: Array<{ findingType: FindingType; supported: boolean; reason: string }> = [
    { findingType: 'LOW_VISIBILITY', supported: true, reason: '' },
    { findingType: 'LOW_RECOMMENDATION', supported: true, reason: '' },
    { findingType: 'CATEGORY_GAP', supported: true, reason: '' },
    { findingType: 'QUERY_GAP', supported: true, reason: '需竞品锚点或跨 Provider 对比，否则无锚点缺席归入 CATEGORY_GAP/LOW_VISIBILITY' },
    { findingType: 'PROVIDER_GAP', supported: true, reason: '需传入 compatible secondaryReport（comparison）' },
    { findingType: 'COMPETITOR_DOMINANCE', supported: input.report.competitorSetId !== null && (input.report.competitor?.length ?? 0) > 0, reason: '需要激活 Competitor Set（m6b-competitors-v1）的竞对明细快照' },
    { findingType: 'COMPETITOR_RECOMMENDED_TARGET_ABSENT', supported: input.report.competitorSetId !== null && input.report.approvedCompetitors.length > 0, reason: '需要激活 Competitor Set 中的已审核竞品与 positive 提及' },
    { findingType: 'POOR_MENTION_POSITION', supported: true, reason: '' },
    { findingType: 'CITATION_GAP', supported: true, reason: '仅输出“未观察到引用信号”的诚实语义，不做权威性推断' },
    { findingType: 'SENTIMENT_RISK', supported: true, reason: '基于规则版情感分析，非 LLM 舆情' },
    { findingType: 'DATA_QUALITY_WARNING', supported: true, reason: '' },
  ];
  return list.map(item => ({
    ...item,
    supported: item.findingType === 'PROVIDER_GAP' ? Boolean(input.comparison) : item.supported,
  }));
}

// ---------------------------------------------------------------------------
// Orchestrator —— 组装并排序（DATA_QUALITY 最先；无输入突变）
// ---------------------------------------------------------------------------
const ALL_RULES: Array<{ type: FindingType; evaluate: (input: DiagnosisInput) => DiagnosisCandidate[] }> = [
  { type: 'DATA_QUALITY_WARNING', evaluate: evaluateDataQuality },
  { type: 'LOW_VISIBILITY', evaluate: evaluateLowVisibility },
  { type: 'LOW_RECOMMENDATION', evaluate: evaluateLowRecommendation },
  { type: 'CATEGORY_GAP', evaluate: evaluateCategoryGap },
  { type: 'QUERY_GAP', evaluate: evaluateQueryGap },
  { type: 'COMPETITOR_RECOMMENDED_TARGET_ABSENT', evaluate: evaluateCompetitorRecommendedTargetAbsent },
  { type: 'COMPETITOR_DOMINANCE', evaluate: evaluateCompetitorDominance },
  { type: 'POOR_MENTION_POSITION', evaluate: evaluatePoorMentionPosition },
  { type: 'CITATION_GAP', evaluate: evaluateCitationGap },
  { type: 'SENTIMENT_RISK', evaluate: evaluateSentimentRisk },
  { type: 'PROVIDER_GAP', evaluate: evaluateProviderGap },
];

export interface DiagnosisSummary {
  severityCounts: Record<DiagnosisSeverity, number>;
  findingCount: number;
  topCategoryGap: string | null;
  topCompetitorSignal: string | null;
  hasProviderGap: boolean;
  dataQualityNote: string | null;
}

export function runDiagnosis(input: DiagnosisInput): { candidates: DiagnosisCandidate[]; summary: DiagnosisSummary } {
  const candidates: DiagnosisCandidate[] = [];
  for (const rule of ALL_RULES) {
    const found = rule.evaluate(input);
    for (const c of found) candidates.push(c);
  }
  // deterministic sort：severity 权重降序 → 同 severity 内 DATA_QUALITY 恒优先
  // （数据质量提示限定其余结论的可信度，必须最先可见）→ priority 降序 → type → title
  const dqFirst = (x: DiagnosisCandidate, y: DiagnosisCandidate) =>
    (x.findingType === 'DATA_QUALITY_WARNING' ? -1 : y.findingType === 'DATA_QUALITY_WARNING' ? 1 : 0);
  candidates.sort((x, y) =>
    severityRank(y.severity) - severityRank(x.severity)
    || dqFirst(x, y)
    || y.priorityScore - x.priorityScore
    || x.findingType.localeCompare(y.findingType)
    || x.title.localeCompare(y.title));

  const severityCounts: Record<DiagnosisSeverity, number> = { HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
  for (const c of candidates) severityCounts[c.severity] += 1;

  const categoryGaps = candidates.filter(c => c.findingType === 'CATEGORY_GAP');
  const competitorSignals = candidates.filter(c => c.findingType === 'COMPETITOR_DOMINANCE' || c.findingType === 'COMPETITOR_RECOMMENDED_TARGET_ABSENT');
  const dq = candidates.find(c => c.findingType === 'DATA_QUALITY_WARNING');
  const summary: DiagnosisSummary = {
    severityCounts,
    findingCount: candidates.length,
    topCategoryGap: categoryGaps.length > 0 ? categoryGaps[0].category : null,
    topCompetitorSignal: competitorSignals.length > 0 ? competitorSignals[0].competitorName ?? competitorSignals[0].title : null,
    hasProviderGap: candidates.some(c => c.findingType === 'PROVIDER_GAP'),
    dataQualityNote: dq ? dq.title : null,
  };
  return { candidates, summary };
}
