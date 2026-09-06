import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVALUATION_VERSION, EXPERIMENT_EVALUATION_V1_RULES, EXPERIMENT_VERSION,
  alignQueryDeltas, computeMetricDeltas, evaluateCompatibility,
  evaluateExperiment, fingerprintQuerySet, primaryMetricsFor, semanticRowKey,
  type ExperimentEvaluationInput, type ExperimentQueryFact, type ExperimentReportFacts,
  type QueryFingerprintRow,
} from '../src/index';

const baseRow = (i: number): QueryFingerprintRow => ({
  queryText: `q${i} 用什么 AI 工具？`, category: 'tool-discovery', intent: 'intent', locale: 'zh-CN',
  weight: 1, sanity: false, sortOrder: i,
});

const mkFacts = (overrides: Partial<ExperimentReportFacts> = {}): ExperimentReportFacts => ({
  reportId: 'rep-b', benchmarkRunId: 'run-b', suiteName: 'S', suiteVersion: '1',
  provider: 'mock', engineKey: 'mock-alpha', engineName: 'Mock', requestedModel: 'geolens-mock', responseModel: 'geolens-mock',
  metricSource: 'demo', analysisVersion: 'm4-rule-v1', competitorSetVersion: null,
  generatedAt: '2026-09-10T00:00:00Z',
  completion: { plannedRuns: 3, completedRuns: 3, succeededRuns: 3, failedRuns: 0, analyzedRuns: 3, partial: false },
  metrics: {
    visibilityRate: 0.25, recommendationRate: 0.125, averageMentionPosition: 4.5,
    shareOfVoice: 0.08, citationCount: 10, citationDomainCount: 3,
  },
  queryFingerprint: 'f1', queryCount: 3,
  ...overrides,
});
const mkQ = (i: number, overrides: Partial<ExperimentQueryFact> = {}): ExperimentQueryFact => ({
  sortOrder: i, queryText: baseRow(i).queryText, category: 'tool-discovery', intent: 'intent',
  runStatus: 'SUCCEEDED', hasAnalysis: true, brandMentioned: false, recommended: false,
  mentionPosition: null, citationCount: 0, evidenceId: `ev-b${i}`, ...overrides,
});
const beforeQs = () => [mkQ(0, { brandMentioned: false }), mkQ(1, { brandMentioned: true, mentionPosition: 5 }), mkQ(2, { brandMentioned: true, recommended: true, mentionPosition: 2 })];
const afterQs = (overrides: Array<Partial<ExperimentQueryFact>> = []) => {
  const defaults = [
    mkQ(0, { brandMentioned: true, mentionPosition: 3, evidenceId: 'ev-a0' }),
    mkQ(1, { brandMentioned: true, mentionPosition: 2, evidenceId: 'ev-a1' }),
    mkQ(2, { brandMentioned: true, recommended: true, mentionPosition: 1, evidenceId: 'ev-a2' }),
  ];
  return defaults.map((q, i) => ({ ...q, ...(overrides[i] ?? {}) }));
};
const mkInput = (overrides: Partial<ExperimentEvaluationInput> = {}): ExperimentEvaluationInput => ({
  evaluationVersion: EVALUATION_VERSION,
  experiment: { id: 'exp-1', expectedSignals: ['VISIBILITY', 'RECOMMENDATION'], executedAt: '2026-09-10T00:00:00Z' },
  before: mkFacts(),
  after: mkFacts({ reportId: 'rep-a', benchmarkRunId: 'run-a', metrics: { visibilityRate: 0.375, recommendationRate: 0.2, averageMentionPosition: 2.8, shareOfVoice: 0.11, citationCount: 14, citationDomainCount: 5 } }),
  beforeQueries: beforeQs(),
  afterQueries: afterQs(),
  ...overrides,
});

/* ---------------- fingerprint（§77） ---------------- */
test('版本集中常量', () => {
  assert.equal(EXPERIMENT_VERSION, 'geolens-experiment-v1');
  assert.equal(EVALUATION_VERSION, 'geolens-experiment-evaluation-v1');
  assert.ok(EXPERIMENT_EVALUATION_V1_RULES.ratePp.meaningful > EXPERIMENT_EVALUATION_V1_RULES.ratePp.neutral);
});

test('fingerprint：同语义有序行 → 稳定；编辑 queryText 后变化', () => {
  const a = fingerprintQuerySet([baseRow(0), baseRow(1), baseRow(2)]);
  const b = fingerprintQuerySet([baseRow(0), baseRow(1), baseRow(2)]);
  assert.equal(a, b);
  const edited = fingerprintQuerySet([baseRow(0), { ...baseRow(1), queryText: '编辑过的问题？' }, baseRow(2)]);
  assert.notEqual(a, edited);
});

test('fingerprint：顺序语义来自 sortOrder（而非输入数组顺序）；不含 DB id/createdAt', () => {
  const rows = [baseRow(0), baseRow(1)];
  assert.equal(fingerprintQuerySet([rows[1], rows[0]]), fingerprintQuerySet(rows)); // 输入乱序 → 按 sortOrder 规范化后同指纹
  const reorderedSemantics = fingerprintQuerySet([{ ...baseRow(0), sortOrder: 5 }, baseRow(1)]);
  assert.notEqual(fingerprintQuerySet(rows), reorderedSemantics); // 语义顺序不同 → 指纹不同
  const withMeta = rows.map(r => ({ ...r }));
  assert.equal(fingerprintQuerySet(withMeta), fingerprintQuerySet(rows)); // 无 id/时间字段可被忽略
});

/* ---------------- compatibility（§78） ---------------- */
test('same context → CONTROLLED_COMPARABLE', () => {
  const res = evaluateCompatibility(mkFacts(), mkFacts({ reportId: 'rep-a' }));
  assert.equal(res.verdict, 'CONTROLLED_COMPARABLE');
  assert.equal(res.comparableForOutcome, true);
  assert.ok(res.inconclusiveReasons.length === 0);
});

test('query fingerprint mismatch → NOT_COMPARABLE', () => {
  const res = evaluateCompatibility(mkFacts(), mkFacts({ reportId: 'rep-a', queryFingerprint: 'other' }));
  assert.equal(res.verdict, 'NOT_COMPARABLE');
  assert.ok(res.warnings.some(w => w.code === 'QUERY_SET_CHANGED'));
});

test('provider mismatch → NOT_COMPARABLE（实验口径比 M6 跨 provider 更严）', () => {
  const res = evaluateCompatibility(mkFacts(), mkFacts({ reportId: 'rep-a', provider: 'deepseek' }));
  assert.equal(res.verdict, 'NOT_COMPARABLE');
  assert.ok(res.warnings.some(w => w.code === 'PROVIDER_CHANGED'));
});

test('requestedModel mismatch → PARTIALLY + 警告', () => {
  const res = evaluateCompatibility(mkFacts(), mkFacts({ reportId: 'rep-a', requestedModel: 'qwen-plus' }));
  assert.equal(res.verdict, 'PARTIALLY_COMPARABLE');
  assert.ok(res.warnings.some(w => w.code === 'REQUESTED_MODEL_CHANGED'));
});

test('responseModel drift → MODEL_DRIFT_WARNING（不硬 NOT）', () => {
  const res = evaluateCompatibility(mkFacts(), mkFacts({ reportId: 'rep-a', responseModel: 'qwen-plus-202609' }));
  assert.equal(res.verdict, 'PARTIALLY_COMPARABLE');
  assert.ok(res.warnings.some(w => w.code === 'MODEL_DRIFT_WARNING'));
});

test('analysisVersion mismatch → NOT_COMPARABLE', () => {
  const res = evaluateCompatibility(mkFacts(), mkFacts({ reportId: 'rep-a', analysisVersion: 'future-v2' }));
  assert.equal(res.verdict, 'NOT_COMPARABLE');
  assert.ok(res.warnings.some(w => w.code === 'ANALYSIS_VERSION_CHANGED'));
});

test('competitorSet mismatch → NOT_COMPARABLE（SoV 不可直接当结果）', () => {
  const res = evaluateCompatibility(mkFacts({ competitorSetVersion: 'v1' }), mkFacts({ reportId: 'rep-a', competitorSetVersion: 'v2' }));
  assert.equal(res.verdict, 'NOT_COMPARABLE');
  assert.ok(res.warnings.some(w => w.code === 'COMPETITOR_SET_CHANGED'));
});

test('metricSource mismatch → NOT_COMPARABLE（Demo/Real 隔离）', () => {
  const res = evaluateCompatibility(mkFacts({ metricSource: 'demo' }), mkFacts({ reportId: 'rep-a', metricSource: 'real' }));
  assert.equal(res.verdict, 'NOT_COMPARABLE');
  assert.ok(res.warnings.some(w => w.code === 'METRIC_SOURCE_CHANGED'));
});

test('模型身份未知（null）不误判 NOT（soft）', () => {
  const res = evaluateCompatibility(mkFacts({ requestedModel: null, responseModel: null }), mkFacts({ reportId: 'rep-a', requestedModel: 'geolens-mock' }));
  assert.equal(res.verdict, 'CONTROLLED_COMPARABLE');
});

/* ---------------- metric delta（§79） ---------------- */
test('visibility pp：0.25 → 0.375 = +12.5pp（非相对 %）', () => {
  const d = computeMetricDeltas(mkFacts(), mkFacts({ reportId: 'r', metrics: { visibilityRate: 0.375, recommendationRate: 0.2, averageMentionPosition: 2.8, shareOfVoice: 0.11, citationCount: 14, citationDomainCount: 5 } }))
    .find(x => x.metric === 'visibilityRate')!;
  assert.equal(d.deltaValue, 12.5);
  assert.equal(d.deltaUnit, 'pp');
  assert.equal(d.direction, 'IMPROVED');
});

test('recommendation pp & SoV pp', () => {
  const deltas = computeMetricDeltas(mkFacts(), mkFacts({ reportId: 'r', metrics: { visibilityRate: 0.25, recommendationRate: 0.2, averageMentionPosition: 4.5, shareOfVoice: 0.11, citationCount: 10, citationDomainCount: 3 } }));
  const rec = deltas.find(x => x.metric === 'recommendationRate')!;
  assert.equal(rec.deltaValue, 7.5);
  assert.equal(rec.deltaUnit, 'pp');
  const sov = deltas.find(x => x.metric === 'shareOfVoice')!;
  assert.equal(sov.deltaValue, 3);
});

test('mention position direction：4.5 → 2.8 raw delta=-1.7 但 direction=IMPROVED', () => {
  const d = computeMetricDeltas(mkFacts(), mkFacts({ reportId: 'r', metrics: { visibilityRate: 0.25, recommendationRate: 0.125, averageMentionPosition: 2.8, shareOfVoice: 0.08, citationCount: 10, citationDomainCount: 3 } }))
    .find(x => x.metric === 'averageMentionPosition')!;
  assert.equal(d.deltaValue, -1.7);
  assert.equal(d.direction, 'IMPROVED');
  assert.equal(d.deltaUnit, 'position');
});

test('citation count/domains 用 count（非 %）', () => {
  const d = computeMetricDeltas(mkFacts(), mkFacts({ reportId: 'r', metrics: { visibilityRate: 0.25, recommendationRate: 0.125, averageMentionPosition: 4.5, shareOfVoice: 0.08, citationCount: 14, citationDomainCount: 5 } }));
  assert.equal(d.find(x => x.metric === 'citationCount')!.deltaValue, 4);
  assert.equal(d.find(x => x.metric === 'citationDomainCount')!.deltaValue, 2);
});

test('null metrics → delta null，无 0/异常', () => {
  const d = computeMetricDeltas(mkFacts({ metrics: { visibilityRate: null, recommendationRate: null, averageMentionPosition: null, shareOfVoice: null, citationCount: null, citationDomainCount: null } }), mkFacts({ reportId: 'r', metrics: { visibilityRate: 0.5, recommendationRate: 0.1, averageMentionPosition: 1, shareOfVoice: 0.2, citationCount: 5, citationDomainCount: 2 } }))
    .find(x => x.metric === 'visibilityRate')!;
  assert.equal(d.deltaValue, null);
  assert.equal(d.direction, null);
});

test('meaningful threshold boundaries（rate：<3 NEUTRAL / ≥3 SMALL / ≥5 MEANINGFUL）', () => {
  const d = (delta: number) => computeMetricDeltas(
    mkFacts({ metrics: { visibilityRate: 0.25, recommendationRate: 0, averageMentionPosition: 4.5, shareOfVoice: 0, citationCount: 0, citationDomainCount: 0 } }),
    mkFacts({ reportId: 'r', metrics: { visibilityRate: 0.25 + delta / 100, recommendationRate: 0, averageMentionPosition: 4.5, shareOfVoice: 0, citationCount: 0, citationDomainCount: 0 } }),
  ).find(x => x.metric === 'visibilityRate')!;
  assert.equal(d(2.9).meaningful, 'NEUTRAL');
  assert.equal(d(3).meaningful, 'SMALL');
  assert.equal(d(5).meaningful, 'MEANINGFUL');
  assert.equal(d(-5).meaningful, 'MEANINGFUL');
  assert.equal(d(-5).direction, 'DECLINED');
});

/* ---------------- query delta（§80） ---------------- */
test('query absent → mentioned = GAINED_VISIBILITY', () => {
  const qs = alignQueryDeltas([mkQ(0, { brandMentioned: false })], [mkQ(0, { brandMentioned: true, mentionPosition: 1, evidenceId: 'ev-a' })]);
  assert.equal(qs[0].transitionType, 'GAINED_VISIBILITY');
  assert.equal(qs[0].status, 'EVALUATED');
});

test('mentioned → absent = LOST_VISIBILITY（仅当 after 数据可用时）', () => {
  const qs = alignQueryDeltas([mkQ(0, { brandMentioned: true })], [mkQ(0, { brandMentioned: false })]);
  assert.equal(qs[0].transitionType, 'LOST_VISIBILITY');
});

test('not recommended → recommended = GAINED_RECOMMENDATION', () => {
  const qs = alignQueryDeltas([mkQ(0, { brandMentioned: true, recommended: false })], [mkQ(0, { brandMentioned: true, recommended: true, mentionPosition: 1 })]);
  assert.equal(qs[0].transitionType, 'GAINED_RECOMMENDATION');
});

test('position improves = POSITION_IMPROVED（数字变小）', () => {
  const qs = alignQueryDeltas([mkQ(0, { brandMentioned: true, mentionPosition: 5 })], [mkQ(0, { brandMentioned: true, mentionPosition: 2 })]);
  assert.equal(qs[0].transitionType, 'POSITION_IMPROVED');
  const declined = alignQueryDeltas([mkQ(0, { brandMentioned: true, mentionPosition: 2 })], [mkQ(0, { brandMentioned: true, mentionPosition: 5 })]);
  assert.equal(declined[0].transitionType, 'POSITION_DECLINED');
});

test('citation gained/lost', () => {
  const gained = alignQueryDeltas([mkQ(0, { brandMentioned: true, citationCount: 0 })], [mkQ(0, { brandMentioned: true, citationCount: 3 })]);
  assert.equal(gained[0].transitionType, 'CITATION_GAINED');
  const lost = alignQueryDeltas([mkQ(0, { brandMentioned: true, citationCount: 2 })], [mkQ(0, { brandMentioned: true, citationCount: 0 })]);
  assert.equal(lost[0].transitionType, 'CITATION_LOST');
});

test('provider failure after → NOT_EVALUABLE（≠ brand absent）', () => {
  const qs = alignQueryDeltas([mkQ(0, { brandMentioned: true })], [mkQ(0, { runStatus: 'FAILED', hasAnalysis: false, brandMentioned: null, evidenceId: null })]);
  assert.equal(qs[0].transitionType, 'NOT_EVALUABLE');
  assert.equal(qs[0].status, 'NOT_EVALUABLE');
  assert.match(qs[0].note ?? '', /不等于品牌缺席/);
});

test('unchanged', () => {
  const qs = alignQueryDeltas([mkQ(0, { brandMentioned: true, recommended: true, mentionPosition: 2, citationCount: 1 })], [mkQ(0, { brandMentioned: true, recommended: true, mentionPosition: 2, citationCount: 1 })]);
  assert.equal(qs[0].transitionType, 'UNCHANGED');
});

test('query exact alignment by sortOrder；快照编辑不漂移（queryText 以输入快照为准）', () => {
  const qs = alignQueryDeltas([mkQ(0, { queryText: '原始快照问题？' })], [mkQ(0, { queryText: '已被编辑的问题？' })]);
  assert.equal(qs.length, 1);
  assert.equal(qs[0].queryText, '原始快照问题？'); // 以 before 快照展示
});

/* ---------------- outcome（§81） ---------------- */
test('improved expected signals → IMPROVED_SIGNALS（不写 causal）', () => {
  const out = evaluateExperiment(mkInput());
  assert.equal(out.outcome, 'IMPROVED_SIGNALS');
  assert.equal(out.evaluationVersion, EVALUATION_VERSION);
});

test('mixed signals → MIXED_SIGNALS（部分涨部分跌 meaningful）', () => {
  const input = mkInput({
    after: mkFacts({ reportId: 'r', metrics: { visibilityRate: 0.375, recommendationRate: 0.02, averageMentionPosition: 2.8, shareOfVoice: 0.11, citationCount: 14, citationDomainCount: 5 } }),
  });
  assert.equal(input.after.metrics.recommendationRate, 0.02);
  const out = evaluateExperiment(input);
  assert.equal(out.outcome, 'MIXED_SIGNALS');
});

test('no meaningful change → NO_CLEAR_CHANGE', () => {
  const input = mkInput({
    after: mkFacts({ reportId: 'r', metrics: { visibilityRate: 0.251, recommendationRate: 0.126, averageMentionPosition: 4.5, shareOfVoice: 0.08, citationCount: 10, citationDomainCount: 3 } }),
  });
  const out = evaluateExperiment(input);
  assert.equal(out.outcome, 'NO_CLEAR_CHANGE');
});

test('regressed → REGRESSED_SIGNALS', () => {
  const input = mkInput({
    after: mkFacts({ reportId: 'r', metrics: { visibilityRate: 0.15, recommendationRate: 0.05, averageMentionPosition: 6.5, shareOfVoice: 0.02, citationCount: 2, citationDomainCount: 0 } }),
  });
  const out = evaluateExperiment(input);
  assert.equal(out.outcome, 'REGRESSED_SIGNALS');
});

test('incompatible → INCONCLUSIVE', () => {
  const input = mkInput({ before: mkFacts({ queryFingerprint: 'before-fp' }), after: mkFacts({ reportId: 'r', queryFingerprint: 'after-fp' }) });
  const out = evaluateExperiment(input);
  assert.equal(out.outcome, 'INCONCLUSIVE');
});

test('coverage mismatch → INCONCLUSIVE（样本完整性不足）', () => {
  const input = mkInput({
    before: mkFacts({ completion: { plannedRuns: 24, completedRuns: 24, succeededRuns: 24, failedRuns: 0, analyzedRuns: 24, partial: false } }),
    after: mkFacts({ reportId: 'r', completion: { plannedRuns: 24, completedRuns: 24, succeededRuns: 18, failedRuns: 6, analyzedRuns: 18, partial: true } }),
  });
  const out = evaluateExperiment(input);
  assert.equal(out.outcome, 'INCONCLUSIVE');
  assert.ok(out.compatibility.warnings.some(w => w.code === 'SUCCESS_COVERAGE_CHANGED'));
});

test('response model drift → 不产生 strong causal 结论（outcome 仍基于数据但带 warning）', () => {
  const input = mkInput({ after: mkFacts({ reportId: 'r', responseModel: 'qwen-plus-202609' }) });
  const out = evaluateExperiment(input);
  assert.equal(out.compatibility.verdict, 'PARTIALLY_COMPARABLE');
  assert.ok(out.compatibility.warnings.some(w => w.code === 'MODEL_DRIFT_WARNING'));
  assert.ok(['IMPROVED_SIGNALS', 'MIXED_SIGNALS', 'NO_CLEAR_CHANGE', 'REGRESSED_SIGNALS', 'INCONCLUSIVE'].includes(out.outcome));
  assert.ok(!out.summary.warnings.some(w => /已证明|导致/.test(w)));
});

test('execution 未记录 → INCONCLUSIVE + warning', () => {
  const input = mkInput({ experiment: { id: 'e', expectedSignals: ['VISIBILITY'], executedAt: null } });
  const out = evaluateExperiment(input);
  assert.equal(out.outcome, 'INCONCLUSIVE');
  assert.ok(out.compatibility.warnings.some(w => w.code === 'EXECUTION_MISSING'));
});

test('deterministic + input not mutated', () => {
  const input = mkInput();
  const before = JSON.stringify(input);
  const a = evaluateExperiment(input);
  const b = evaluateExperiment(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(input), before);
});

test('primaryMetricsFor：expectedSignals 无映射时回退 visibility+recommendation', () => {
  assert.deepEqual(primaryMetricsFor(['VISIBILITY', 'RECOMMENDATION']), ['visibilityRate', 'recommendationRate']);
  assert.deepEqual(primaryMetricsFor(['CITATION']), ['citationCount']);
  assert.deepEqual(primaryMetricsFor(['ENTITY_UNDERSTANDING']), ['visibilityRate', 'recommendationRate']);
});

test('canonicalSemanticRows 稳定 & semanticRowKey 不含 id', () => {
  const k1 = semanticRowKey(baseRow(1));
  assert.ok(k1.includes(baseRow(1).queryText));
  assert.ok(!k1.includes('db-'));
});
