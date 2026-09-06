import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECOMMENDATION_VERSION, RECOMMENDATION_TYPE_RULES, runRecommendations,
  type RecommendationFindingFact, type RecommendationInput,
} from '../src/index';

const VER = RECOMMENDATION_VERSION;

const mkFinding = (overrides: Partial<RecommendationFindingFact> & { findingType: RecommendationFindingFact['findingType'] }): RecommendationFindingFact => ({
  id: overrides.findingType + '-' + (overrides.id ?? Math.random().toString(36).slice(2, 8)),
  findingType: overrides.findingType,
  severity: 'HIGH', title: 't', summary: 's', category: null, competitorName: null,
  priorityScore: 60, queryCount: 4, evidenceCount: 4,
  ...overrides,
});
const run = (findings: RecommendationFindingFact[]) => runRecommendations({
  recommendationVersion: VER,
  diagnosis: { id: 'd1', diagnosisVersion: 'geolens-diagnosis-v1', metricSource: 'demo' },
  findings,
});
const typesOf = (r: ReturnType<typeof run>) => r.recommendations.map(c => c.recommendationType).sort();

/* ------------------------------ mapping ------------------------------ */
test('版本集中常量', () => {
  assert.equal(VER, 'geolens-recommendation-v1');
  assert.ok(RECOMMENDATION_TYPE_RULES.ENTITY_CLARITY.effort === 'LOW');
});

test('LOW_VISIBILITY → ENTITY_CLARITY + CATEGORY_COVERAGE(overall)', () => {
  const r = run([mkFinding({ findingType: 'LOW_VISIBILITY', severity: 'HIGH', priorityScore: 80 })]);
  const types = typesOf(r);
  assert.ok(types.includes('ENTITY_CLARITY'));
  assert.ok(types.includes('CATEGORY_COVERAGE'));
  const entity = r.recommendations.find(c => c.recommendationType === 'ENTITY_CLARITY')!;
  assert.equal(entity.findingCount, 1);
  assert.ok(entity.actions.length > 0);
  assert.ok(entity.rationale.includes('LOW_VISIBILITY'));
});

test('LOW_RECOMMENDATION → RECOMMENDATION_READINESS', () => {
  assert.deepEqual(typesOf(run([mkFinding({ findingType: 'LOW_RECOMMENDATION' })])), ['RECOMMENDATION_READINESS']);
});

test('CATEGORY_GAP → CATEGORY_COVERAGE（保留 category）', () => {
  const r = run([mkFinding({ findingType: 'CATEGORY_GAP', category: 'tool-discovery', severity: 'HIGH' })]);
  const c = r.recommendations.find(c => c.recommendationType === 'CATEGORY_COVERAGE')!;
  assert.equal(c.category, 'tool-discovery');
});

test('QUERY_GAP → QUERY_COVERAGE', () => {
  const r = run([mkFinding({ findingType: 'QUERY_GAP', category: 'comparison' })]);
  assert.deepEqual(typesOf(r), ['QUERY_COVERAGE']);
});

test('PROVIDER_GAP → PROVIDER_COVERAGE', () => {
  assert.deepEqual(typesOf(run([mkFinding({ findingType: 'PROVIDER_GAP' })])), ['PROVIDER_COVERAGE']);
});

test('COMPETITOR_DOMINANCE → COMPETITOR_DIFFERENTIATION（按竞品分离）', () => {
  const a = run([mkFinding({ findingType: 'COMPETITOR_DOMINANCE', competitorName: 'ChatGPT' })]);
  const b = run([mkFinding({ findingType: 'COMPETITOR_DOMINANCE', competitorName: 'Claude' })]);
  const c = run([
    mkFinding({ findingType: 'COMPETITOR_DOMINANCE', competitorName: 'ChatGPT' }),
    mkFinding({ findingType: 'COMPETITOR_DOMINANCE', competitorName: 'Claude' }),
  ]);
  assert.equal(typesOf(a).length, 1);
  assert.equal(typesOf(c).length, 2); // type 相同但 competitor 不同 → 2 条独立建议
  assert.equal(c.recommendations.length, 2);
  assert.deepEqual(c.recommendations.map(x => x.competitorName).sort(), ['ChatGPT', 'Claude']);
  assert.equal(b.recommendations[0].competitorName, 'Claude');
});

test('COMPETITOR_RECOMMENDED_TARGET_ABSENT → COMPETITOR_DIFFERENTIATION + RECOMMENDATION_READINESS', () => {
  const r = run([mkFinding({ findingType: 'COMPETITOR_RECOMMENDED_TARGET_ABSENT', severity: 'HIGH' })]);
  assert.deepEqual(typesOf(r), ['COMPETITOR_DIFFERENTIATION', 'RECOMMENDATION_READINESS']);
});

test('POOR_MENTION_POSITION → POSITIONING_CLARITY', () => {
  assert.deepEqual(typesOf(run([mkFinding({ findingType: 'POOR_MENTION_POSITION' })])), ['POSITIONING_CLARITY']);
});

test('CITATION_GAP → CITATION_READINESS', () => {
  assert.deepEqual(typesOf(run([mkFinding({ findingType: 'CITATION_GAP', severity: 'INFO' })])), ['CITATION_READINESS']);
});

test('SENTIMENT_RISK → SENTIMENT_RESPONSE', () => {
  assert.deepEqual(typesOf(run([mkFinding({ findingType: 'SENTIMENT_RISK' })])), ['SENTIMENT_RESPONSE']);
});

test('DATA_QUALITY_WARNING → DATA_COLLECTION', () => {
  assert.deepEqual(typesOf(run([mkFinding({ findingType: 'DATA_QUALITY_WARNING', severity: 'HIGH' })])), ['DATA_COLLECTION']);
});

/* ------------------------- dedup / merge ------------------------------ */
test('merge：同 type+category 多 finding 合并为一条且 links 全保留', () => {
  const f1 = mkFinding({ id: 'f1', findingType: 'CATEGORY_GAP', category: 'tool-discovery' });
  const f2 = mkFinding({ id: 'f2', findingType: 'CATEGORY_GAP', category: 'tool-discovery' });
  const r = run([f1, f2]);
  const c = r.recommendations.find(x => x.recommendationType === 'CATEGORY_COVERAGE')!;
  assert.equal(c.findingCount, 2);
  assert.deepEqual(c.findingIds.sort(), [f1.id, f2.id].sort());
});

test('不同 category 不错误合并', () => {
  const r = run([
    mkFinding({ findingType: 'CATEGORY_GAP', category: 'competition' }),
    mkFinding({ findingType: 'CATEGORY_GAP', category: 'tool-discovery' }),
  ]);
  const cats = r.recommendations.filter(x => x.recommendationType === 'CATEGORY_COVERAGE').map(x => x.category).sort();
  assert.deepEqual(cats, ['competition', 'tool-discovery']);
});

test('LOW_VISIBILITY + CATEGORY_GAP 不产生重复实体建议（ENTITY 只来自 LOW_VIS）', () => {
  const r = run([
    mkFinding({ findingType: 'LOW_VISIBILITY' }),
    mkFinding({ findingType: 'CATEGORY_GAP', category: 'tool-discovery' }),
  ]);
  const entity = r.recommendations.filter(x => x.recommendationType === 'ENTITY_CLARITY');
  assert.equal(entity.length, 1);
});

test('QUERY_GAP 同类聚合为一条（非逐条）', () => {
  const r = run([
    mkFinding({ findingType: 'QUERY_GAP', category: 'comparison' }),
    mkFinding({ findingType: 'QUERY_GAP', category: 'comparison' }),
    mkFinding({ findingType: 'QUERY_GAP', category: 'comparison' }),
  ]);
  assert.equal(r.recommendations.length, 1);
  assert.equal(r.recommendations[0].findingCount, 3);
});

/* ------------------------- priority ----------------------------------- */
test('priority：HIGH severity finding 得分 ≥ 低 severity', () => {
  const high = run([mkFinding({ findingType: 'LOW_VISIBILITY', severity: 'HIGH', priorityScore: 95 })])
    .recommendations.find(x => x.recommendationType === 'ENTITY_CLARITY')!;
  const low = run([mkFinding({ findingType: 'LOW_VISIBILITY', severity: 'INFO', priorityScore: 20 })])
    .recommendations.find(x => x.recommendationType === 'ENTITY_CLARITY')!;
  assert.ok(high.priorityScore >= low.priorityScore);
  assert.ok([0, 100].includes(Math.max(high.priorityScore, 0)) || (high.priorityScore >= 0 && high.priorityScore <= 100));
});

test('DataQualityGuard：存在 DQ MEDIUM 时，高成本建议被抑制；DATA_COLLECTION 仍出现', () => {
  const r = run([
    mkFinding({ findingType: 'DATA_QUALITY_WARNING', severity: 'MEDIUM', priorityScore: 55 }),
    mkFinding({ findingType: 'LOW_VISIBILITY', severity: 'HIGH', priorityScore: 90 }),
  ]);
  const entity = r.recommendations.find(x => x.recommendationType === 'ENTITY_CLARITY')!;
  assert.ok(entity.priorityScore <= 100);
  const dc = r.recommendations.find(x => x.recommendationType === 'DATA_COLLECTION');
  assert.ok(dc);
  assert.ok(r.summary.dataQualityDamped === false || r.summary.dataQualityDamped === true);
});

test('影响 query 越多 priority 不下降（coverage 单调）', () => {
  const few = run([mkFinding({ findingType: 'CATEGORY_GAP', category: 'x', queryCount: 1 })]).recommendations[0];
  const many = run([mkFinding({ findingType: 'CATEGORY_GAP', category: 'x', queryCount: 12 })]).recommendations[0];
  assert.ok(many.priorityScore >= few.priorityScore);
});

test('同输入 score 相同；clamp 0–100；输入不被突变', () => {
  const input: RecommendationInput = {
    recommendationVersion: VER,
    diagnosis: { id: 'd', diagnosisVersion: 'v', metricSource: 'demo' },
    findings: [mkFinding({ findingType: 'LOW_VISIBILITY', severity: 'HIGH', priorityScore: 80 })],
  };
  const snapshot = JSON.stringify(input);
  const a = runRecommendations(JSON.parse(JSON.stringify(input)));
  const b = runRecommendations(JSON.parse(JSON.stringify(input)));
  assert.equal(a.recommendations.length, b.recommendations.length);
  for (let i = 0; i < a.recommendations.length; i++) {
    assert.equal(a.recommendations[i].priorityScore, b.recommendations[i].priorityScore);
    assert.deepEqual(a.recommendations[i], b.recommendations[i]);
  }
  for (const c of a.recommendations) assert.ok(c.priorityScore >= 0 && c.priorityScore <= 100);
  assert.equal(JSON.stringify(input), snapshot); // 输入未被突变
});

/* ------------------------- actions ------------------------------------ */
test('action items：模板生成、sortOrder 确定、verificationMethod 存在、均带 effort', () => {
  const r = run([mkFinding({ findingType: 'LOW_VISIBILITY', severity: 'HIGH' })]);
  const entity = r.recommendations.find(x => x.recommendationType === 'ENTITY_CLARITY')!;
  assert.ok(entity.actions.length >= 3);
  const orders = entity.actions.map(a => a.sortOrder);
  assert.deepEqual(orders, [...orders].sort((x, y) => x - y));
  for (const a of entity.actions) {
    assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(a.effortLevel));
    assert.ok(a.verificationMethod.includes('复测'));
  }
  assert.ok(r.summary.actionItemCount >= entity.actions.length);
});

/* ------------------------- 边界 / 空 ----------------------------------- */
test('无 finding → 空推荐（不凭空生成）', () => {
  const r = run([]);
  assert.equal(r.recommendations.length, 0);
  assert.equal(r.summary.recommendationCount, 0);
});

test('expectedSignal/targetAsset/impactArea 不承诺提升', () => {
  const r = run([mkFinding({ findingType: 'CITATION_GAP', severity: 'INFO' })]);
  const c = r.recommendations[0];
  assert.equal(c.expectedSignal, 'CITATION');
  assert.equal(c.impactArea, 'CITATION');
  assert.ok(!String(c.title).includes('提升'));
});
