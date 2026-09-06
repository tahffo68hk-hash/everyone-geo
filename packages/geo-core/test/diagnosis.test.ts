import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIAGNOSIS_VERSION, DIAGNOSIS_V1_RULES,
  computePriorityScore, runDiagnosis, evaluateDataQuality, evaluateLowVisibility,
  evaluateLowRecommendation, evaluateCategoryGap, evaluateQueryGap,
  evaluateCompetitorRecommendedTargetAbsent, evaluateCompetitorDominance,
  evaluatePoorMentionPosition, evaluateCitationGap, evaluateSentimentRisk,
  evaluateProviderGap, supportedFindingTypes,
  type DiagnosisInput, type DiagnosisQueryFact, type DiagnosisComparisonFacts,
} from '../src/index';

/* ------------------------------------------------------------------ */
/* fixture helpers（deterministic —— 24-query 风格 demo）                */
/* ------------------------------------------------------------------ */
const BASE_REPORT = {
  reportId: 'r1', projectId: 'p1', suiteName: 'ProjectMentor GEO Benchmark', suiteVersion: '1',
  provider: 'mock', engineKey: 'mock-alpha', engineName: 'Mock Alpha',
  requestedModel: 'geolens-mock', responseModel: 'geolens-mock',
  metricSource: 'demo', analysisVersion: 'm4-rule-v1',
  competitorSetId: null, competitorSetName: null, competitorSetVersion: null,
  completedRuns: 24, succeededRuns: 24, failedRuns: 0, analyzedRuns: 24, partial: false,
};

const metric = (overrides: Record<string, unknown> = {}) => ({
  visibilityRate: 1, recommendationRate: 1, averageMentionPosition: 1,
  shareOfVoice: 0.5, citationCount: 0, citationDomainCount: 0,
  sentimentDistribution: { positive: 0, neutral: 24, negative: 0, unknown: 0 },
  ...overrides,
});

const mkQuery = (overrides: Partial<DiagnosisQueryFact> & { queryText: string }): DiagnosisQueryFact => ({
  runId: 'run-x', evidenceId: 'ev-x', category: 'comparison', intent: '', sortOrder: 1, sanity: false,
  status: 'SUCCEEDED', analysisVersion: 'm4-rule-v1', brandMentioned: true, mentionPosition: 1,
  recommended: true, sentiment: 'neutral', citationCount: 0, competitorPositive: false,
  absentInComparison: false, ...overrides,
});

const mkInput = (overrides: {
  overall?: Record<string, unknown>; byCategory?: DiagnosisInput['report']['byCategory'];
  queries?: DiagnosisQueryFact[]; competitor?: DiagnosisInput['report']['competitor'];
  approvedCompetitors?: string[]; competitorSetId?: string | null; metricSource?: string;
  analyzedRuns?: number; succeededRuns?: number; failedRuns?: number; partial?: boolean;
  comparison?: DiagnosisComparisonFacts | null; brandName?: string;
} = {}): DiagnosisInput => {
  const report = {
    ...BASE_REPORT,
    metricSource: overrides.metricSource ?? BASE_REPORT.metricSource,
    analyzedRuns: overrides.analyzedRuns ?? BASE_REPORT.analyzedRuns,
    succeededRuns: overrides.succeededRuns ?? BASE_REPORT.succeededRuns,
    failedRuns: overrides.failedRuns ?? BASE_REPORT.failedRuns,
    partial: overrides.partial ?? BASE_REPORT.partial,
    competitorSetId: overrides.competitorSetId !== undefined ? overrides.competitorSetId : null,
    competitorSetName: overrides.competitorSetId ? 'Competitor Set' : null,
    competitorSetVersion: overrides.competitorSetId ? '1' : null,
    overall: metric(overrides.overall ?? {}),
    byCategory: overrides.byCategory ?? [
      { category: 'comparison', queryEligibleCount: 12, queryMentionedCount: 12, metrics: metric() },
      { category: 'tool-discovery', queryEligibleCount: 12, queryMentionedCount: 12, metrics: metric() },
    ],
    competitor: overrides.competitor !== undefined ? overrides.competitor : null,
    approvedCompetitors: overrides.approvedCompetitors ?? [],
  };
  return {
    diagnosisVersion: DIAGNOSIS_VERSION,
    report,
    comparison: overrides.comparison ?? null,
    queries: overrides.queries ?? [
      mkQuery({ queryText: '推荐 ProjectMentor 的工具', brandMentioned: true, mentionPosition: 1, recommended: true }),
    ],
  };
};

const findType = (cands: ReturnType<typeof runDiagnosis>['candidates'], type: string) =>
  cands.filter(c => c.findingType === type);

/* =============================== 基础 =============================== */
test('version + threshold config exported & 集中常量', () => {
  assert.equal(DIAGNOSIS_VERSION, 'geolens-diagnosis-v1');
  assert.ok(DIAGNOSIS_V1_RULES.visibility.high === 0.2);
});

test('severity + priority deterministic（相同输入 → 相同输出，无输入突变）', () => {
  const input = mkInput({ overall: { visibilityRate: 0.1 } });
  const first = runDiagnosis(JSON.parse(JSON.stringify(input)));
  const second = runDiagnosis(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(first.candidates, second.candidates);
  const p = computePriorityScore('HIGH', 6, 24, 3);
  assert.equal(p, computePriorityScore('HIGH', 6, 24, 3));
  // 输入未被突变
  assert.equal(input.queries[0].runId, 'run-x');
});

test('priority：严重度高者更大；阈值边界确定', () => {
  assert.ok(computePriorityScore('HIGH', 0, 1, 0) > computePriorityScore('INFO', 0, 1, 0));
  assert.equal(computePriorityScore('HIGH', 24, 24, 0), computePriorityScore('HIGH', 24, 24, 0));
  assert.equal(computePriorityScore('HIGH', 100, 24, 0), 75); // 50(sev) + 25(affected) + 0(ev)
});

/* ========================= DATA_QUALITY ============================= */
test('DATA_QUALITY：小样本 → HIGH；demo → INFO 恒在', () => {
  const input = mkInput({ analyzedRuns: 3, succeededRuns: 3, queries: [
    mkQuery({ queryText: 'a', brandMentioned: true }), mkQuery({ queryText: 'b' }),
    mkQuery({ queryText: 'c' }),
  ] });
  const dq = findType(evaluateDataQuality(input), 'DATA_QUALITY_WARNING');
  assert.ok(dq.some(c => c.title === '样本量较小' && c.severity === 'HIGH'));
  assert.ok(dq.some(c => c.title === '演示数据诊断' && c.severity === 'INFO'));
  // 样本量警告永远排在最前（runDiagnosis sort）
  const all = runDiagnosis(input).candidates;
  assert.equal(all[0].findingType, 'DATA_QUALITY_WARNING');
});

test('DATA_QUALITY：成功率低 + partial', () => {
  const input = mkInput({ analyzedRuns: 20, succeededRuns: 10, failedRuns: 10, partial: true, queries: [] });
  const dq = findType(evaluateDataQuality(input), 'DATA_QUALITY_WARNING');
  assert.ok(dq.some(c => c.title === '成功样本率偏低'));
  assert.ok(dq.some(c => c.title === '报告为部分完成'));
});

test('DATA_QUALITY：0 成功样本', () => {
  const input = mkInput({ analyzedRuns: 0, succeededRuns: 0, failedRuns: 5, queries: [] });
  const dq = findType(evaluateDataQuality(input), 'DATA_QUALITY_WARNING');
  assert.ok(dq.some(c => c.title === '没有可诊断的成功样本'));
});

/* ========================== LOW_VISIBILITY ========================== */
test('LOW_VISIBILITY：0% → HIGH；>60% → 无', () => {
  const low = evaluateLowVisibility(mkInput({ overall: { visibilityRate: 0 } }));
  assert.equal(low.length, 1); assert.equal(low[0].severity, 'HIGH');
  assert.ok(low[0].summary.includes('提及'));
  const okVis = evaluateLowVisibility(mkInput({ overall: { visibilityRate: 0.7 } }));
  assert.equal(okVis.length, 0);
});

test('LOW_VISIBILITY：boundary 20%/40%/60%', () => {
  assert.equal(evaluateLowVisibility(mkInput({ overall: { visibilityRate: 0.199 } }))[0]?.severity, 'HIGH');
  assert.equal(evaluateLowVisibility(mkInput({ overall: { visibilityRate: 0.399 } }))[0]?.severity, 'MEDIUM');
  assert.equal(evaluateLowVisibility(mkInput({ overall: { visibilityRate: 0.599 } }))[0]?.severity, 'LOW');
  assert.equal(evaluateLowVisibility(mkInput({ overall: { visibilityRate: 0.6 } })).length, 0);
});

/* ======================== LOW_RECOMMENDATION ======================== */
test('LOW_RECOMMENDATION：被提及 ≥3 但很少被推荐 → 触发', () => {
  const queries = [1, 2, 3, 4].map(i => mkQuery({ queryText: `q${i}`, brandMentioned: true, recommended: i === 1 }));
  const rec = evaluateLowRecommendation(mkInput({ queries, overall: { visibilityRate: 0.5 } }));
  assert.equal(rec.length, 1);
  assert.equal(rec[0].severity, 'MEDIUM'); // 1/4=25% → <40% 且 ≥20% → MEDIUM
  assert.ok(rec[0].summary.includes('1 个获得推荐'));
});

test('LOW_RECOMMENDATION：全部被推荐 → 无；被提及 <3 → 无（样本交给 DQ）', () => {
  const allRec = [1, 2, 3].map(i => mkQuery({ queryText: `q${i}`, brandMentioned: true, recommended: true }));
  assert.equal(evaluateLowRecommendation(mkInput({ queries: allRec })).length, 0);
  const tooFew = [mkQuery({ queryText: 'only', brandMentioned: true, recommended: false })];
  assert.equal(evaluateLowRecommendation(mkInput({ queries: tooFew })).length, 0);
});

/* =========================== CATEGORY_GAP =========================== */
test('CATEGORY_GAP：category 可见率 0（样本≥2）→ HIGH', () => {
  const queries = [
    mkQuery({ queryText: 'tool-a', category: 'tool-discovery', brandMentioned: false }),
    mkQuery({ queryText: 'tool-b', category: 'tool-discovery', brandMentioned: false }),
  ];
  const cat = evaluateCategoryGap(mkInput({
    overall: { visibilityRate: 0.3 },
    byCategory: [
      { category: 'tool-discovery', queryEligibleCount: 2, queryMentionedCount: 0, metrics: metric({ visibilityRate: 0 }) },
      { category: 'comparison', queryEligibleCount: 10, queryMentionedCount: 10, metrics: metric({ visibilityRate: 1 }) },
    ],
    queries,
  }));
  assert.equal(cat.length, 1);
  assert.equal(cat[0].category, 'tool-discovery');
  assert.equal(cat[0].severity, 'HIGH');
  assert.equal(cat[0].evidenceLinks.length, 2);
});

test('CATEGORY_GAP：低于 overall 15pp → MEDIUM；持平 → 无', () => {
  const cat = evaluateCategoryGap(mkInput({
    overall: { visibilityRate: 0.5 },
    byCategory: [{ category: 'workflow', queryEligibleCount: 8, queryMentionedCount: 4, metrics: metric({ visibilityRate: 0.3 }) }],
    queries: [],
  }));
  assert.equal(cat.length, 1); assert.equal(cat[0].severity, 'MEDIUM');
  const flat = evaluateCategoryGap(mkInput({
    overall: { visibilityRate: 0.5 },
    byCategory: [{ category: 'workflow', queryEligibleCount: 8, queryMentionedCount: 4, metrics: metric({ visibilityRate: 0.5 }) }],
  }));
  assert.equal(flat.length, 0);
});

/* ============================= QUERY_GAP ============================ */
test('QUERY_GAP：品牌缺席且竞品 positive → 聚合触发（含证据链）', () => {
  const queries = [
    mkQuery({ queryText: 'comp-q', category: 'comparison', brandMentioned: false, competitorPositive: true, evidenceId: 'ev1' }),
    mkQuery({ queryText: 'brand-q', category: 'comparison', brandMentioned: true }),
    mkQuery({ queryText: 'plain-q', category: 'tool-discovery', brandMentioned: false, competitorPositive: false }),
  ];
  const qg = evaluateQueryGap(mkInput({ queries, competitorSetId: 'set1', approvedCompetitors: ['ChatGPT'] }));
  assert.equal(qg.length, 1);
  assert.equal(qg[0].findingType, 'QUERY_GAP');
  assert.equal(qg[0].queryCount, 1);
  assert.equal(qg[0].evidenceLinks.length, 1);
});

test('QUERY_GAP：无竞品锚点且无 comparison → 不报（避免噪声）', () => {
  const queries = [mkQuery({ queryText: 'plain-q', brandMentioned: false, competitorPositive: false })];
  const qg = evaluateQueryGap(mkInput({ queries }));
  assert.equal(qg.length, 0);
});

test('QUERY_GAP：comparison 侧同问题也缺席 → 触发', () => {
  const queries = [mkQuery({ queryText: 'cross-q', brandMentioned: false, absentInComparison: true })];
  const qg = evaluateQueryGap(mkInput({ queries, comparison: fakeComparison() }));
  assert.equal(qg.length, 1);
});

function fakeComparison(): DiagnosisComparisonFacts {
  return {
    reportId: 'r2', provider: 'qwen', engineName: 'Qwen API', requestedModel: 'qwen-plus',
    responseModel: 'qwen-plus', suiteVersion: '1', metricSource: 'demo',
    analysisVersion: 'm4-rule-v1', competitorSetVersion: null, succeededRuns: 24, partial: false,
    overall: metric({ visibilityRate: 0.8 }), byCategory: [],
  };
}

/* ============== COMPETITOR_RECOMMENDED_TARGET_ABSENT ================ */
test('CRTA：目标缺席 + 已审核竞品 positive → HIGH（≥3）', () => {
  const queries = [1, 2, 3].map(i => mkQuery({
    queryText: `hit-${i}`, brandMentioned: false, competitorPositive: true, evidenceId: `ev${i}`,
  }));
  const crta = evaluateCompetitorRecommendedTargetAbsent(mkInput({
    queries, competitorSetId: 'set1', approvedCompetitors: ['ChatGPT'],
  }));
  assert.equal(crta.length, 1);
  assert.equal(crta[0].findingType, 'COMPETITOR_RECOMMENDED_TARGET_ABSENT');
  assert.equal(crta[0].severity, 'HIGH');
  assert.equal(crta[0].queryCount, 3);
});

test('CRTA：无竞品集/无竞品 positive → 不触发', () => {
  const absent = evaluateCompetitorRecommendedTargetAbsent(mkInput({
    queries: [mkQuery({ queryText: 'x', brandMentioned: false, competitorPositive: true })],
  }));
  assert.equal(absent.length, 0);
  const noPositive = evaluateCompetitorRecommendedTargetAbsent(mkInput({
    queries: [mkQuery({ queryText: 'x', brandMentioned: false, competitorPositive: false })],
    competitorSetId: 'set1', approvedCompetitors: ['ChatGPT'],
  }));
  assert.equal(noPositive.length, 0);
});

/* ======================== COMPETITOR_DOMINANCE ====================== */
test('COMPETITOR_DOMINANCE：竞品 SoV 高 + 目标可见率低 → 触发', () => {
  const dom = evaluateCompetitorDominance(mkInput({
    overall: { visibilityRate: 0.1, shareOfVoice: 0.1 },
    competitorSetId: 'set1', approvedCompetitors: ['ChatGPT'],
    competitor: [{ candidateId: 'c1', canonicalName: 'ChatGPT', competitorType: 'DIRECT', mentionCount: 12, evidenceCount: 15, shareOfVoice: 0.5 }],
  }));
  assert.equal(dom.length, 1);
  assert.equal(dom[0].findingType, 'COMPETITOR_DOMINANCE');
  assert.equal(dom[0].severity, 'HIGH');
  assert.equal(dom[0].competitorName, 'ChatGPT');
});

test('COMPETITOR_DOMINANCE：无竞对明细/目标可见率高 → 无', () => {
  assert.equal(evaluateCompetitorDominance(mkInput({})).length, 0);
  assert.equal(evaluateCompetitorDominance(mkInput({
    overall: { visibilityRate: 0.9, shareOfVoice: 0.5 },
    competitor: [{ candidateId: 'c1', canonicalName: 'ChatGPT', competitorType: 'DIRECT', mentionCount: 12, evidenceCount: 15, shareOfVoice: 0.6 }],
  })).length, 0);
});

/* ====================== POOR_MENTION_POSITION ======================= */
test('POOR_MENTION_POSITION：平均位置 5.2 → HIGH', () => {
  const queries = [
    mkQuery({ queryText: 'a', brandMentioned: true, mentionPosition: 5 }),
    mkQuery({ queryText: 'b', brandMentioned: true, mentionPosition: 6 }),
  ];
  const pos = evaluatePoorMentionPosition(mkInput({ queries }));
  assert.equal(pos.length, 1);
  assert.equal(pos[0].severity, 'HIGH');
  assert.ok(pos[0].summary.includes('5.5'));
});

test('POOR_MENTION_POSITION：位置靠前/样本不足 → 无', () => {
  const good = evaluatePoorMentionPosition(mkInput({ queries: [
    mkQuery({ queryText: 'a', mentionPosition: 1 }), mkQuery({ queryText: 'b', mentionPosition: 2 }),
  ] }));
  assert.equal(good.length, 0);
  assert.equal(evaluatePoorMentionPosition(mkInput({ queries: [mkQuery({ queryText: 'solo', mentionPosition: 9 })] })).length, 0);
});

/* =========================== CITATION_GAP =========================== */
test('CITATION_GAP：样本≥5 且无引用 → INFO（诚实语义不推断权威性）', () => {
  const queries = Array.from({ length: 6 }, (_, i) => mkQuery({ queryText: `q${i}` }));
  const cg = evaluateCitationGap(mkInput({ queries }));
  assert.equal(cg.length, 1);
  assert.equal(cg[0].severity, 'INFO');
  assert.ok(cg[0].summary.includes('不代表官网权威性不足'));
});

test('CITATION_GAP：样本<5 或有引用 → 无', () => {
  assert.equal(evaluateCitationGap(mkInput({ analyzedRuns: 1, succeededRuns: 1, queries: [mkQuery({ queryText: 'q' })] })).length, 0);
  assert.equal(evaluateCitationGap(mkInput({
    overall: { citationCount: 3 },
    queries: Array.from({ length: 6 }, (_, i) => mkQuery({ queryText: `q${i}` })),
  })).length, 0);
});

/* ========================== SENTIMENT_RISK ========================== */
test('SENTIMENT_RISK：负面存在 → 触发（比例判级）', () => {
  const queries = [
    mkQuery({ queryText: 'neg', sentiment: 'negative', evidenceId: 'e1' }),
    mkQuery({ queryText: 'neu', sentiment: 'neutral' }),
    mkQuery({ queryText: 'neu2', sentiment: 'neutral' }),
  ];
  const sr = evaluateSentimentRisk(mkInput({ analyzedRuns: 3, succeededRuns: 3, queries }));
  assert.equal(sr.length, 1);
  assert.equal(sr[0].severity, 'HIGH'); // 1/3=33% ≥30% → HIGH? 33%≥0.3 → HIGH
});

test('SENTIMENT_RISK：无负面 → 无', () => {
  assert.equal(evaluateSentimentRisk(mkInput({ queries: [mkQuery({ queryText: 'neu', sentiment: 'neutral' })] })).length, 0);
});

/* =========================== PROVIDER_GAP =========================== */
test('PROVIDER_GAP：comparison 低可见率 → 触发（跨模型）', () => {
  const pg = evaluateProviderGap(mkInput({
    overall: { visibilityRate: 0.4 },
    comparison: fakeComparison(), // 0.8
  }));
  assert.equal(pg.length, 1);
  assert.equal(pg[0].findingType, 'PROVIDER_GAP');
  assert.equal(pg[0].provider, 'mock'); // 本报告（低侧）为 mock
  assert.ok(pg[0].summary.includes('Δ 40.0pp'));
});

test('PROVIDER_GAP：无 comparison → 无；差异过小 → 无', () => {
  assert.equal(evaluateProviderGap(mkInput({ overall: { visibilityRate: 0.5 } })).length, 0);
  const small = evaluateProviderGap(mkInput({
    overall: { visibilityRate: 0.7 },
    comparison: fakeComparison(), // 0.8 → Δ0.1 <0.15
  }));
  assert.equal(small.length, 0);
});

/* ========================= supportedFindingTypes ==================== */
test('supportedFindingTypes：v1 未可靠支持的如实说明', () => {
  const plain = supportedFindingTypes(mkInput({}));
  const byType = Object.fromEntries(plain.map(x => [x.findingType, x.supported]));
  assert.equal(byType.COMPETITOR_DOMINANCE, false);
  assert.equal(byType.COMPETITOR_RECOMMENDED_TARGET_ABSENT, false);
  assert.equal(byType.PROVIDER_GAP, false);
  const withComp = supportedFindingTypes(mkInput({
    competitorSetId: 's1', approvedCompetitors: ['X'],
    competitor: [{ candidateId: 'c', canonicalName: 'X', competitorType: 'DIRECT', mentionCount: 1, evidenceCount: 1, shareOfVoice: 0.2 }],
    comparison: fakeComparison(),
  }));
  const by2 = Object.fromEntries(withComp.map(x => [x.findingType, x.supported]));
  assert.equal(by2.COMPETITOR_DOMINANCE, true);
  assert.equal(by2.PROVIDER_GAP, true);
});

/* =========================== runDiagnosis =========================== */
test('runDiagnosis：汇总 + 全类型确定性输出', () => {
  const input = mkInput({
    overall: { visibilityRate: 0.05, citationCount: 0, shareOfVoice: 0.02 },
    analyzedRuns: 3, succeededRuns: 3,
    queries: [1, 2, 3].map(i => mkQuery({
      queryText: `hit-${i}`, brandMentioned: false, competitorPositive: true, sentiment: 'negative',
      mentionPosition: 6,
    })),
  });
  const { candidates, summary } = runDiagnosis(input);
  assert.equal(summary.findingCount, candidates.length);
  const types = new Set(candidates.map(c => c.findingType));
  assert.ok(types.has('DATA_QUALITY_WARNING')); // 样本小
  assert.ok(types.has('SENTIMENT_RISK')); // negative ×3/3 → HIGH
  // 排序：首个必为 HIGH 的数据质量或同等 severity 项
  assert.ok(['HIGH', 'MEDIUM'].includes(candidates[0].severity));
  assert.equal(candidates[0].findingType, 'DATA_QUALITY_WARNING'); // data quality always first by sort (HIGH same weight; priority)
});

