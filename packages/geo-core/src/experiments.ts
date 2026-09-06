/**
 * M7D Optimization Experiment & Re-test Evaluation —— 确定性、受控复测基础。
 *
 * 语义边界：
 *   - M7D 回答“执行之后重新测试，观察到什么变化”，输出是 Observed Outcome，
 *     不是 Proven Causal Effect。UI 恒带 attribution disclaimer。
 *   - Frozen Re-test：querySetFingerprint（SHA-256 over 有序语义行）保证 After 与
 *     Before 是同口径测试集；不读当前 Project/Benchmark 配置猜历史。
 *   - Compatibility 复用 M6 语义并更严格：实验要求 same query fingerprint /
 *     metricSource / provider / requestedModel / analysisVersion /
 *     competitorSetVersion（hard）；responseModel 仅 soft（drift → 降级 + 警告）。
 *   - Metric Delta：Visibility/Recommendation/SoV 用 pp；Mention Position 用“位”
 *     （数字越低越好，direction 由 metric 定义）；Citation 用 count —— 绝不显示相对 %。
 *   - Query Delta：Before/After 按冻结快照顺序对齐；failed run ≠ brand missing，
 *     一律 NOT_EVALUABLE。
 *   - 本模块纯函数：不 import DB/HTTP/env/LLM。
 */
import { createHash } from 'node:crypto';

export const EXPERIMENT_VERSION = 'geolens-experiment-v1';
export const EVALUATION_VERSION = 'geolens-experiment-evaluation-v1';

// ---------------------------------------------------------------------------
// 阈值配置（集中常量；GeoLens internal heuristic，非行业标准）
// ---------------------------------------------------------------------------
export const EXPERIMENT_EVALUATION_V1_RULES = {
  /** 率类指标（visibility/recommendation/SoV）Δ 单位 pp：<3 NEUTRAL，3–5 SMALL，≥5 MEANINGFUL */
  ratePp: { neutral: 3, meaningful: 5 },
  /** 平均提及位置 Δ，单位 位（越低越好）：<0.5 NEUTRAL，0.5–1.0 SMALL，≥1.0 MEANINGFUL */
  position: { neutral: 0.5, meaningful: 1.0 },
  /** 引用类 count Δ：0 NEUTRAL；1–2 SMALL；≥3 MEANINGFUL */
  count: { meaningful: 3 },
  /** After 成功样本显著少于 Before 时视为 coverage 不足（比例低于该值时 INCONCLUSIVE） */
  coverageMinAfterRatio: 0.9,
} as const;

export type MetricName =
  | 'visibilityRate' | 'recommendationRate' | 'averageMentionPosition'
  | 'shareOfVoice' | 'citationCount' | 'citationDomainCount';

export type DeltaUnit = 'pp' | 'position' | 'count';
export type Direction = 'IMPROVED' | 'DECLINED' | 'NEUTRAL';
export type Meaningfulness = 'MEANINGFUL' | 'SMALL' | 'NEUTRAL';
export type Outcome =
  | 'IMPROVED_SIGNALS' | 'MIXED_SIGNALS' | 'NO_CLEAR_CHANGE'
  | 'REGRESSED_SIGNALS' | 'INCONCLUSIVE';
export type Verdict = 'CONTROLLED_COMPARABLE' | 'PARTIALLY_COMPARABLE' | 'NOT_COMPARABLE';

export type QueryTransition =
  | 'GAINED_VISIBILITY' | 'LOST_VISIBILITY' | 'GAINED_RECOMMENDATION'
  | 'LOST_RECOMMENDATION' | 'POSITION_IMPROVED' | 'POSITION_DECLINED'
  | 'CITATION_GAINED' | 'CITATION_LOST' | 'UNCHANGED' | 'MULTIPLE_CHANGES'
  | 'NOT_EVALUABLE';

/** 方向定义：true = 越大越好（率/SoV/count），false = 越小越好（位置）。 */
export const METRIC_HIGHER_IS_BETTER: Record<MetricName, boolean> = {
  visibilityRate: true,
  recommendationRate: true,
  averageMentionPosition: false,
  shareOfVoice: true,
  citationCount: true,
  citationDomainCount: true,
};

export const METRIC_UNIT: Record<MetricName, DeltaUnit> = {
  visibilityRate: 'pp',
  recommendationRate: 'pp',
  averageMentionPosition: 'position',
  shareOfVoice: 'pp',
  citationCount: 'count',
  citationDomainCount: 'count',
};

/** ContentOpportunity expectedSignals → 主信号 metric 映射（其余为 secondary）。 */
export const SIGNAL_TO_METRIC: Record<string, MetricName> = {
  VISIBILITY: 'visibilityRate',
  RECOMMENDATION: 'recommendationRate',
  MENTION_POSITION: 'averageMentionPosition',
  COMPETITOR_SOV: 'shareOfVoice',
  CITATION: 'citationCount',
};

// ---------------------------------------------------------------------------
// 输入事实（API 组装；engine 只读、不突变输入）
// ---------------------------------------------------------------------------
export interface QueryFingerprintRow {
  queryText: string;
  category: string | null;
  intent: string | null;
  locale: string | null;
  weight: number | null;
  sanity: boolean | null;
  sortOrder: number | null;
}

export interface ExperimentReportFacts {
  reportId: string;
  benchmarkRunId: string;
  suiteName: string | null;
  suiteVersion: string | null;
  provider: string;
  engineKey: string | null;
  engineName: string | null;
  requestedModel: string | null;
  responseModel: string | null;
  metricSource: string;
  analysisVersion: string;
  competitorSetVersion: string | null;
  generatedAt: string;
  completion: { plannedRuns: number; completedRuns: number; succeededRuns: number; failedRuns: number; analyzedRuns: number; partial: boolean };
  metrics: {
    visibilityRate: number | null;
    recommendationRate: number | null;
    averageMentionPosition: number | null;
    shareOfVoice: number | null;
    citationCount: number | null;
    citationDomainCount: number | null;
  };
  queryFingerprint: string | null;
  queryCount: number;
}

export interface ExperimentQueryFact {
  sortOrder: number;
  queryText: string;
  category: string | null;
  intent: string | null;
  runStatus: string; // SUCCEEDED / FAILED / …
  hasAnalysis: boolean;
  brandMentioned: boolean | null;
  recommended: boolean | null;
  mentionPosition: number | null;
  citationCount: number | null;
  evidenceId: string | null;
}

export interface ExperimentEvaluationInput {
  evaluationVersion: string;
  experiment: {
    id: string;
    expectedSignals: string[];
    executedAt: string | null; // null = 尚未记录执行
  };
  before: ExperimentReportFacts;
  after: ExperimentReportFacts;
  beforeQueries: ExperimentQueryFact[];
  afterQueries: ExperimentQueryFact[];
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
export interface CompatibilityWarning { code: string; message: string }
export interface CompatibilityResult {
  verdict: Verdict;
  dimensions: Array<{ key: string; a: string | null; b: string | null; compatible: boolean }>;
  warnings: CompatibilityWarning[];
  comparableForOutcome: boolean;
  inconclusiveReasons: string[];
}

export interface MetricDeltaResult {
  metric: MetricName;
  metricName: string;
  beforeValue: number | null;
  afterValue: number | null;
  deltaValue: number | null; // after - before（raw）
  deltaUnit: DeltaUnit;
  direction: Direction | null;
  meaningful: Meaningfulness;
  primarySignal: boolean;
}

export interface QueryDeltaResult {
  sortOrder: number;
  queryText: string;
  category: string | null;
  beforeEvidenceId: string | null;
  afterEvidenceId: string | null;
  beforeMentioned: boolean | null;
  afterMentioned: boolean | null;
  beforeRecommended: boolean | null;
  afterRecommended: boolean | null;
  beforePosition: number | null;
  afterPosition: number | null;
  beforeCitationCount: number | null;
  afterCitationCount: number | null;
  transitionType: QueryTransition;
  status: 'EVALUATED' | 'NOT_EVALUABLE';
  note: string | null;
}

export interface ExperimentEvaluationSummary {
  metricSource: string;
  verdict: Verdict;
  outcome: Outcome;
  queryCounts: {
    evaluated: number;
    notEvaluable: number;
    gainedVisibility: number;
    lostVisibility: number;
    gainedRecommendation: number;
    lostRecommendation: number;
    positionImproved: number;
    positionDeclined: number;
    unchanged: number;
  };
  coverage: { beforeSucceeded: number; afterSucceeded: number; afterRatio: number | null };
  warnings: string[];
}

export interface ExperimentEvaluationOutput {
  evaluationVersion: string;
  compatibility: CompatibilityResult;
  metricDeltas: MetricDeltaResult[];
  queryDeltas: QueryDeltaResult[];
  outcome: Outcome;
  summary: ExperimentEvaluationSummary;
}

// ---------------------------------------------------------------------------
// Query Fingerprint
// ---------------------------------------------------------------------------

/** 语义行 → 单行 key（只含测试语义，不含 DB id / createdAt）。 */
export function semanticRowKey(row: QueryFingerprintRow): string {
  const weight = row.weight == null ? '' : String(row.weight);
  const order = row.sortOrder == null ? '' : String(row.sortOrder);
  return [order, row.queryText, row.category ?? '', row.intent ?? '', row.locale ?? '', weight, row.sanity ? '1' : '0'].join('\u001f');
}

export function canonicalSemanticRows(rows: QueryFingerprintRow[]): QueryFingerprintRow[] {
  return [...rows]
    .map(row => ({ ...row, category: row.category ?? null, intent: row.intent ?? null, locale: row.locale ?? null, weight: row.weight ?? null, sanity: row.sanity ?? false, sortOrder: row.sortOrder ?? null }))
    .sort((a, b) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) || a.queryText.localeCompare(b.queryText));
}

export function fingerprintQuerySet(rows: QueryFingerprintRow[]): string {
  const canonical = canonicalSemanticRows(rows);
  const payload = canonical.map(semanticRowKey).join('\n');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// 度量辅助
// ---------------------------------------------------------------------------
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function clampPpRate(value: number): number {
  // 率类 delta 输出 pp 原值（0–100 标度直接差），不做相对 %
  return Math.round(value * 1000) / 1000;
}

function directionOf(metric: MetricName, rawDelta: number): Direction {
  if (rawDelta === 0) return 'NEUTRAL';
  const improved = METRIC_HIGHER_IS_BETTER[metric] ? rawDelta > 0 : rawDelta < 0;
  return improved ? 'IMPROVED' : 'DECLINED';
}

function meaningfulOf(metric: MetricName, absDelta: number, beforeValue: number | null): Meaningfulness {
  const rules = EXPERIMENT_EVALUATION_V1_RULES;
  if (metric === 'averageMentionPosition') {
    if (absDelta < rules.position.neutral) return 'NEUTRAL';
    if (absDelta < rules.position.meaningful) return 'SMALL';
    return 'MEANINGFUL';
  }
  if (metric === 'citationCount' || metric === 'citationDomainCount') {
    if (absDelta === 0) return 'NEUTRAL';
    if (absDelta < rules.count.meaningful) return 'SMALL';
    return 'MEANINGFUL';
  }
  // 率类指标 delta 单位已是 pp
  if (absDelta < rules.ratePp.neutral) return 'NEUTRAL';
  if (absDelta < rules.ratePp.meaningful) return 'SMALL';
  return 'MEANINGFUL';
}

// ---------------------------------------------------------------------------
// Compatibility（复用 M6 口径并收紧为 controlled 语义）
// ---------------------------------------------------------------------------
export function evaluateCompatibility(before: ExperimentReportFacts, after: ExperimentReportFacts): CompatibilityResult {
  const dims: Array<{ key: string; a: string | null; b: string | null; compatible: boolean }> = [
    { key: 'querySetFingerprint', a: before.queryFingerprint, b: after.queryFingerprint, compatible: before.queryFingerprint === after.queryFingerprint && Boolean(before.queryFingerprint) },
    { key: 'metricSource', a: before.metricSource, b: after.metricSource, compatible: before.metricSource === after.metricSource },
    { key: 'provider', a: before.provider, b: after.provider, compatible: before.provider === after.provider },
    { key: 'analysisVersion', a: before.analysisVersion, b: after.analysisVersion, compatible: before.analysisVersion === after.analysisVersion },
    { key: 'competitorSetVersion', a: before.competitorSetVersion ?? null, b: after.competitorSetVersion ?? null, compatible: (before.competitorSetVersion ?? null) === (after.competitorSetVersion ?? null) },
    { key: 'requestedModel', a: before.requestedModel ?? null, b: after.requestedModel ?? null, compatible: (before.requestedModel ?? null) === (after.requestedModel ?? null) || before.requestedModel === null || after.requestedModel === null },
    { key: 'responseModel', a: before.responseModel ?? null, b: after.responseModel ?? null, compatible: (before.responseModel ?? null) === (after.responseModel ?? null) || before.responseModel === null || after.responseModel === null },
  ];
  const warnings: CompatibilityWarning[] = [];
  const hard = (key: string) => ['querySetFingerprint', 'metricSource', 'provider', 'analysisVersion', 'competitorSetVersion'].includes(key);
  const hardMismatch = dims.some(d => hard(d.key) && !d.compatible);
  const requestedDrift = before.requestedModel !== null && after.requestedModel !== null && before.requestedModel !== after.requestedModel;
  const responseDrift = before.responseModel !== null && after.responseModel !== null && before.responseModel !== after.responseModel;

  if (dims.find(d => d.key === 'querySetFingerprint')?.compatible === false) {
    warnings.push({ code: 'QUERY_SET_CHANGED', message: '复测测试集指纹与基线不一致（Before/After 不是同一组测试问题），不能作为受控实验对照。' });
  }
  if (!dims.find(d => d.key === 'metricSource')!.compatible) {
    warnings.push({ code: 'METRIC_SOURCE_CHANGED', message: 'Before/After 数据类型（Demo/Real/Mixed）不一致。' });
  }
  if (!dims.find(d => d.key === 'provider')!.compatible) {
    warnings.push({ code: 'PROVIDER_CHANGED', message: 'Before/After 使用不同 Provider。' });
  }
  if (requestedDrift) {
    warnings.push({ code: 'REQUESTED_MODEL_CHANGED', message: `请求模型发生变化：${before.requestedModel} → ${after.requestedModel}。` });
  }
  if (responseDrift) {
    warnings.push({ code: 'MODEL_DRIFT_WARNING', message: `模型响应身份发生变化（${before.responseModel ?? '未知'} → ${after.responseModel ?? '未知'}），Provider 后端可能升级；变化不能完全归因于内容。` });
  }
  if (!dims.find(d => d.key === 'analysisVersion')!.compatible) {
    warnings.push({ code: 'ANALYSIS_VERSION_CHANGED', message: '分析规则版本不同，指标口径不可混用。' });
  }
  if (!dims.find(d => d.key === 'competitorSetVersion')!.compatible) {
    warnings.push({ code: 'COMPETITOR_SET_CHANGED', message: '竞品集版本不同，SoV 不能直接作为实验结论。' });
  }

  let verdict: Verdict;
  const reasons: string[] = [];
  if (hardMismatch) {
    verdict = 'NOT_COMPARABLE';
    for (const d of dims) if (hard(d.key) && !d.compatible) reasons.push(`${d.key} 不一致`);
  } else if (responseDrift || requestedDrift) {
    verdict = 'PARTIALLY_COMPARABLE';
    reasons.push(responseDrift ? 'responseModel drift' : 'requestedModel 变化');
  } else {
    verdict = 'CONTROLLED_COMPARABLE';
  }

  return {
    verdict,
    dimensions: dims,
    warnings,
    comparableForOutcome: verdict === 'CONTROLLED_COMPARABLE' || (verdict === 'PARTIALLY_COMPARABLE' && (responseDrift || requestedDrift) && !hardMismatch),
    inconclusiveReasons: reasons,
  };
}

// ---------------------------------------------------------------------------
// Metric Delta
// ---------------------------------------------------------------------------
export function computeMetricDeltas(before: ExperimentReportFacts, after: ExperimentReportFacts): MetricDeltaResult[] {
  const all: MetricName[] = ['visibilityRate', 'recommendationRate', 'averageMentionPosition', 'shareOfVoice', 'citationCount', 'citationDomainCount'];
  return all.map(metric => {
    const bv = num(before.metrics[metric]);
    const av = num(after.metrics[metric]);
    if (bv === null || av === null) {
      return { metric, metricName: metric, beforeValue: bv, afterValue: av, deltaValue: null, deltaUnit: METRIC_UNIT[metric], direction: null, meaningful: 'NEUTRAL', primarySignal: false };
    }
    const raw = metric === 'averageMentionPosition'
      ? Math.round((av - bv) * 10) / 10 // 位：保留 1 位小数，避免浮点噪声
      : metric === 'citationCount' || metric === 'citationDomainCount'
        ? av - bv
        : clampPpRate((av - bv) * 100); // 内部 0-1 → pp 展示（e.g., 0.375-0.25=0.125 → +12.5pp）
    return {
      metric,
      metricName: metric,
      beforeValue: bv,
      afterValue: av,
      deltaValue: raw,
      deltaUnit: METRIC_UNIT[metric],
      direction: directionOf(metric, raw),
      meaningful: meaningfulOf(metric, Math.abs(raw), bv),
      primarySignal: false,
    };
  });
}

// ---------------------------------------------------------------------------
// Query Delta
// ---------------------------------------------------------------------------
function cite(before: ExperimentQueryFact): number | null {
  return before.citationCount == null ? null : before.citationCount;
}

function transitionFor(before: ExperimentQueryFact | null, after: ExperimentQueryFact | null): QueryDeltaResult {
  const base: QueryDeltaResult = {
    sortOrder: before?.sortOrder ?? after?.sortOrder ?? 0,
    queryText: before?.queryText ?? after?.queryText ?? '',
    category: before?.category ?? after?.category ?? null,
    beforeEvidenceId: before?.evidenceId ?? null,
    afterEvidenceId: after?.evidenceId ?? null,
    beforeMentioned: before?.brandMentioned ?? null,
    afterMentioned: after?.brandMentioned ?? null,
    beforeRecommended: before?.recommended ?? null,
    afterRecommended: after?.recommended ?? null,
    beforePosition: before?.mentionPosition ?? null,
    afterPosition: after?.mentionPosition ?? null,
    beforeCitationCount: before ? cite(before) : null,
    afterCitationCount: after ? cite(after) : null,
    transitionType: 'NOT_EVALUABLE',
    status: 'NOT_EVALUABLE',
    note: null,
  };
  const usable = (f: ExperimentQueryFact | null) => Boolean(f && f.runStatus === 'SUCCEEDED' && f.hasAnalysis);
  const b = usable(before) ? before! : null;
  const a = usable(after) ? after! : null;
  if (!b || !a) {
    base.note = b ? 'After 数据不可用（复测 run 失败或缺少分析）—— 不等于品牌缺席。' : 'Before 数据不可用。';
    return base;
  }

  const bMentioned = Boolean(b.brandMentioned);
  const aMentioned = Boolean(a.brandMentioned);
  const bRec = Boolean(b.recommended);
  const aRec = Boolean(a.recommended);
  const bPos = b.mentionPosition;
  const aPos = a.mentionPosition;
  const bCit = b.citationCount ?? 0;
  const aCit = a.citationCount ?? 0;

  const visibilityChanged = bMentioned !== aMentioned;
  const recChanged = bRec !== aRec;
  const posChanged = bPos !== null && aPos !== null && bPos !== aPos;
  const citChanged = bCit !== aCit;

  Object.assign(base, {
    beforeMentioned: bMentioned, afterMentioned: aMentioned,
    beforeRecommended: bRec, afterRecommended: aRec,
    beforePosition: bPos, afterPosition: aPos,
    beforeCitationCount: bCit, afterCitationCount: aCit,
    status: 'EVALUATED' as const,
  });

  if (visibilityChanged) {
    base.transitionType = bMentioned ? 'LOST_VISIBILITY' : 'GAINED_VISIBILITY';
    return base;
  }
  if (recChanged) {
    base.transitionType = bRec ? 'LOST_RECOMMENDATION' : 'GAINED_RECOMMENDATION';
    return base;
  }
  if (posChanged) {
    base.transitionType = (aPos! < bPos!) ? 'POSITION_IMPROVED' : 'POSITION_DECLINED';
    return base;
  }
  if (citChanged) {
    base.transitionType = aCit > bCit ? 'CITATION_GAINED' : 'CITATION_LOST';
    return base;
  }
  base.transitionType = 'UNCHANGED';
  return base;
}

/** 按冻结快照顺序对齐 Before/After Query（不允许猜测历史语义）。 */
export function alignQueryDeltas(before: ExperimentQueryFact[], after: ExperimentQueryFact[]): QueryDeltaResult[] {
  const byOrderB = new Map(before.map(q => [q.sortOrder, q]));
  const byOrderA = new Map(after.map(q => [q.sortOrder, q]));
  const orders = [...new Set([...byOrderB.keys(), ...byOrderA.keys()])].sort((x, y) => x - y);
  return orders.map(order => transitionFor(byOrderB.get(order) ?? null, byOrderA.get(order) ?? null));
}

// ---------------------------------------------------------------------------
// Outcome（完全 deterministic；无 causal 措辞）
// ---------------------------------------------------------------------------
export function computeOutcome(
  compatibility: CompatibilityResult,
  deltas: MetricDeltaResult[],
  expectedSignals: string[],
  primaryMetrics: MetricName[],
): Outcome {
  if (!compatibility.comparableForOutcome || compatibility.inconclusiveReasons.length > 0) return 'INCONCLUSIVE';
  const sig = new Set(primaryMetrics);
  const meaningful = deltas.filter(d => d.direction !== null && d.meaningful === 'MEANINGFUL' && sig.has(d.metric));
  const improved = meaningful.filter(d => d.direction === 'IMPROVED').length;
  const declined = meaningful.filter(d => d.direction === 'DECLINED').length;
  if (improved > 0 && declined === 0) return 'IMPROVED_SIGNALS';
  if (improved > 0 && declined > 0) return 'MIXED_SIGNALS';
  if (improved === 0 && declined > 0) return 'REGRESSED_SIGNALS';
  return 'NO_CLEAR_CHANGE';
}

export function primaryMetricsFor(expectedSignals: string[]): MetricName[] {
  const mapped = [...new Set(expectedSignals.map(s => SIGNAL_TO_METRIC[s]).filter((m): m is MetricName => Boolean(m)))];
  return mapped.length > 0 ? mapped : ['visibilityRate', 'recommendationRate'];
}

// ---------------------------------------------------------------------------
// Core evaluation（输入不突变）
// ---------------------------------------------------------------------------
export function evaluateExperiment(input: ExperimentEvaluationInput): ExperimentEvaluationOutput {
  const before = cloneReport(input.before);
  const after = cloneReport(input.after);
  const beforeQueries = input.beforeQueries.map(cloneQuery);
  const afterQueries = input.afterQueries.map(cloneQuery);

  const compatibility = evaluateCompatibility(before, after);
  const metricDeltas = computeMetricDeltas(before, after).map(d => ({ ...d, primarySignal: primaryMetricsFor(input.experiment.expectedSignals).includes(d.metric) }));
  const queryDeltas = alignQueryDeltas(beforeQueries, afterQueries);

  // Coverage guard：After 成功率/样本显著低于 Before → INCONCLUSIVE（§28/§36）。
  const planned = Math.max(1, after.completion.plannedRuns || after.completion.succeededRuns || 0);
  const beforeSucceeded = before.completion.succeededRuns;
  const afterSucceeded = after.completion.succeededRuns;
  const afterRatio = planned > 0 ? afterSucceeded / planned : null;
  if (afterSucceeded < beforeSucceeded && (afterRatio === null || afterRatio < EXPERIMENT_EVALUATION_V1_RULES.coverageMinAfterRatio)) {
    if (!compatibility.warnings.some(w => w.code === 'SUCCESS_COVERAGE_CHANGED')) {
      compatibility.warnings.push({ code: 'SUCCESS_COVERAGE_CHANGED', message: `样本完整性不同（Before ${beforeSucceeded} 成功 vs After ${afterSucceeded} 成功）：当前实验结果暂无法稳定判断。` });
    }
    compatibility.comparableForOutcome = false;
    compatibility.inconclusiveReasons.push('successCoverage 不足');
  }
  if (after.completion.partial && !compatibility.warnings.some(w => w.code === 'PARTIAL_RUN')) {
    compatibility.warnings.push({ code: 'PARTIAL_RUN', message: 'After 报告为部分完成（PARTIAL），结果仅供参考。' });
  }
  if (!input.experiment.executedAt) {
    compatibility.warnings.push({ code: 'EXECUTION_MISSING', message: '尚未记录执行时间，无法确认 Before→执行→After 时序。' });
    compatibility.comparableForOutcome = false;
    compatibility.inconclusiveReasons.push('execution 未记录');
  }

  const outcome = computeOutcome(compatibility, metricDeltas, input.experiment.expectedSignals, primaryMetricsFor(input.experiment.expectedSignals));

  const counts = { evaluated: 0, notEvaluable: 0, gainedVisibility: 0, lostVisibility: 0, gainedRecommendation: 0, lostRecommendation: 0, positionImproved: 0, positionDeclined: 0, unchanged: 0 };
  for (const q of queryDeltas) {
    if (q.status === 'NOT_EVALUABLE') { counts.notEvaluable += 1; continue; }
    counts.evaluated += 1;
    if (q.transitionType === 'GAINED_VISIBILITY') counts.gainedVisibility += 1;
    else if (q.transitionType === 'LOST_VISIBILITY') counts.lostVisibility += 1;
    else if (q.transitionType === 'GAINED_RECOMMENDATION') counts.gainedRecommendation += 1;
    else if (q.transitionType === 'LOST_RECOMMENDATION') counts.lostRecommendation += 1;
    else if (q.transitionType === 'POSITION_IMPROVED') counts.positionImproved += 1;
    else if (q.transitionType === 'POSITION_DECLINED') counts.positionDeclined += 1;
    else if (q.transitionType === 'UNCHANGED') counts.unchanged += 1;
  }

  return {
    evaluationVersion: input.evaluationVersion,
    compatibility,
    metricDeltas,
    queryDeltas,
    outcome,
    summary: {
      metricSource: after.metricSource,
      verdict: compatibility.verdict,
      outcome,
      queryCounts: counts,
      coverage: { beforeSucceeded, afterSucceeded, afterRatio },
      warnings: compatibility.warnings.map(w => w.message),
    },
  };
}

function cloneReport(r: ExperimentReportFacts): ExperimentReportFacts {
  return { ...r, completion: { ...r.completion }, metrics: { ...r.metrics } };
}
function cloneQuery(q: ExperimentQueryFact): ExperimentQueryFact {
  return { ...q };
}
