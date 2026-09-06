import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_OPPORTUNITY_VERSION, buildContentOpportunities, canonicalQueryKey,
  resolveRecommendationMapping, OPPORTUNITY_TYPES, CONTENT_INTENTS,
  type OpportunityEngineInput, type OpportunityQueryFact,
  type OpportunityRecommendationInput, type OpportunityEngineFact,
} from '../src/index';

const VER = CONTENT_OPPORTUNITY_VERSION;
const ENG_MOCK: OpportunityEngineFact = { provider: 'mock', engineKey: 'm7c-mock', engineName: 'Mock Engine', requestedModel: 'geolens-mock', responseModel: 'geolens-mock' };

let qSeq = 0;
const mkQuery = (overrides: Partial<OpportunityQueryFact> & { queryText: string }): OpportunityQueryFact => {
  qSeq += 1;
  return {
    queryText: overrides.queryText,
    category: 'tool-discovery', intent: 'intent x', locale: 'zh-CN',
    brandAbsent: true, competitorPositive: false,
    engine: ENG_MOCK, evidenceId: `ev-${qSeq}`, runId: `run-${qSeq}`, reason: '代表性证据',
    ...overrides,
  };
};

const mkRec = (overrides: Partial<OpportunityRecommendationInput> & { recommendationType: string }): OpportunityRecommendationInput => ({
  id: 'rec-' + overrides.recommendationType + '-' + Math.random().toString(36).slice(2, 7),
  recommendationType: overrides.recommendationType,
  title: 't', summary: 's', rationale: 'r',
  priority: 'MEDIUM', priorityScore: 60,
  category: null, competitorName: null, expectedSignal: null, effortLevel: 'MEDIUM',
  findingIds: ['f-1'],
  findings: [{ id: 'f-1', findingType: 'CATEGORY_GAP', severity: 'HIGH', title: 'ft', summary: 'fs', category: null, competitorName: null, priorityScore: 60 }],
  queries: [mkQuery({ queryText: `问题 ${qSeq} ？` })],
  ...overrides,
});

const mkInput = (recs: OpportunityRecommendationInput[], extra: Partial<OpportunityEngineInput> = {}): OpportunityEngineInput => ({
  opportunityVersion: VER,
  recommendationRun: { id: 'rr-1', recommendationVersion: 'geolens-recommendation-v1', metricSource: 'demo' },
  recommendations: recs,
  approvedCompetitors: [],
  hasDataQualityIssue: false,
  ...extra,
});

const single = (rec: OpportunityRecommendationInput, extra?: Partial<OpportunityEngineInput>) =>
  buildContentOpportunities(mkInput([rec], extra)).opportunities;

/* ------------------------------ mapping（§16/§56） ------------------------------ */
test('版本集中常量：v1 + types/intents 常量', () => {
  assert.equal(VER, 'geolens-content-opportunity-v1');
  assert.ok(OPPORTUNITY_TYPES.includes('USE_CASE_PAGE'));
  assert.ok(CONTENT_INTENTS.includes('COMPARISON'));
});

test('ENTITY_CLARITY → ENTITY_OVERVIEW（alts PRODUCT_PAGE，intent INFORMATIONAL）', () => {
  const opps = single(mkRec({ recommendationType: 'ENTITY_CLARITY' }));
  assert.equal(opps.length, 1);
  assert.equal(opps[0].opportunityType, 'ENTITY_OVERVIEW');
  assert.equal(opps[0].assetType, 'ENTITY_OVERVIEW');
  assert.equal(opps[0].contentIntent, 'INFORMATIONAL');
  assert.ok(opps[0].alternativeAssetTypes.includes('PRODUCT_PAGE'));
});

test('POSITIONING_CLARITY → PRODUCT_PAGE（alts CONTENT_REFRESH）', () => {
  const opp = single(mkRec({ recommendationType: 'POSITIONING_CLARITY' }))[0];
  assert.equal(opp.opportunityType, 'PRODUCT_PAGE');
  assert.ok(opp.alternativeAssetTypes.includes('CONTENT_REFRESH'));
  assert.equal(opp.contentIntent, 'RECOMMENDATION');
});

test('CATEGORY_COVERAGE → USE_CASE_PAGE（category 保留；alts GUIDE）', () => {
  const rec = mkRec({ recommendationType: 'CATEGORY_COVERAGE', category: 'tool-discovery' });
  rec.queries = [mkQuery({ queryText: '有哪些 AI 工具可用于商业计划书？', category: 'tool-discovery' })];
  const opp = single(rec)[0];
  assert.equal(opp.opportunityType, 'USE_CASE_PAGE');
  assert.equal(opp.contentIntent, 'DISCOVERY');
  assert.equal(opp.category, 'tool-discovery');
  assert.ok(opp.alternativeAssetTypes.includes('GUIDE'));
});

test('QUERY_COVERAGE → USE_CASE_PAGE（alts FAQ_PAGE/GUIDE，intent INFORMATIONAL）', () => {
  const opp = single(mkRec({ recommendationType: 'QUERY_COVERAGE', category: 'comparison' }))[0];
  assert.equal(opp.opportunityType, 'USE_CASE_PAGE');
  assert.equal(opp.contentIntent, 'INFORMATIONAL');
  assert.ok(opp.alternativeAssetTypes.includes('FAQ_PAGE'));
  assert.ok(opp.alternativeAssetTypes.includes('GUIDE'));
});

test('RECOMMENDATION_READINESS → USE_CASE_PAGE（alts COMPARISON_PAGE）', () => {
  const opp = single(mkRec({ recommendationType: 'RECOMMENDATION_READINESS' }))[0];
  assert.equal(opp.opportunityType, 'USE_CASE_PAGE');
  assert.equal(opp.contentIntent, 'RECOMMENDATION');
  assert.ok(opp.alternativeAssetTypes.includes('COMPARISON_PAGE'));
});

test('COMPETITOR_DIFFERENTIATION → COMPARISON_PAGE（竞品保留、分离）', () => {
  const rec = mkRec({ recommendationType: 'COMPETITOR_DIFFERENTIATION', competitorName: 'ChatGPT' });
  const opp = single(rec, { approvedCompetitors: [{ canonicalName: 'ChatGPT', competitorType: 'DIRECT' }] })[0];
  assert.equal(opp.opportunityType, 'COMPARISON_PAGE');
  assert.equal(opp.contentIntent, 'COMPARISON');
  assert.equal(opp.competitors.length, 1);
  assert.equal(opp.competitors[0].canonicalName, 'ChatGPT');
  assert.equal(opp.competitors[0].competitorType, 'DIRECT');
  assert.equal(opp.targetCompetitorCount, 1);
});

test('CITATION_READINESS → DATA_REFERENCE（少量 Query；alts CASE_STUDY/DOCUMENTATION）', () => {
  const opp = single(mkRec({ recommendationType: 'CITATION_READINESS' }))[0];
  assert.equal(opp.opportunityType, 'DATA_REFERENCE');
  assert.equal(opp.contentIntent, 'AUTHORITY');
  assert.ok(opp.alternativeAssetTypes.includes('CASE_STUDY'));
  assert.ok(opp.alternativeAssetTypes.includes('DOCUMENTATION'));
});

test('CITATION_READINESS（≥6 Query）→ DOCUMENTATION（数据偏大型可引用内容）', () => {
  const rec = mkRec({ recommendationType: 'CITATION_READINESS' });
  rec.queries = Array.from({ length: 6 }, (_, i) => mkQuery({ queryText: `引用类问题 ${i + 1}？` }));
  const opp = single(rec)[0];
  assert.equal(opp.opportunityType, 'DOCUMENTATION');
  assert.ok(opp.alternativeAssetTypes.includes('DATA_REFERENCE'));
});

test('PROVIDER_COVERAGE → ENTITY_OVERVIEW（主题中性，引擎信息来自 Evidence）', () => {
  const opp = single(mkRec({ recommendationType: 'PROVIDER_COVERAGE' }))[0];
  assert.equal(opp.opportunityType, 'ENTITY_OVERVIEW');
  assert.equal(opp.engines.length, 1);
  assert.equal(opp.engines[0].engineKey, 'm7c-mock');
});

test('SENTIMENT_RESPONSE → CLARIFICATION_CONTENT', () => {
  const opp = single(mkRec({ recommendationType: 'SENTIMENT_RESPONSE' }))[0];
  assert.equal(opp.opportunityType, 'CLARIFICATION_CONTENT');
  assert.equal(opp.contentIntent, 'CLARIFICATION');
});

test('STRUCTURED_INFORMATION → FAQ_PAGE', () => {
  const opp = single(mkRec({ recommendationType: 'STRUCTURED_INFORMATION' }))[0];
  assert.equal(opp.opportunityType, 'FAQ_PAGE');
});

test('DATA_COLLECTION 不生成普通内容机会 + blockedByDataQuality', () => {
  const out = buildContentOpportunities(mkInput([mkRec({ recommendationType: 'DATA_COLLECTION' })], { hasDataQualityIssue: true }));
  assert.equal(out.opportunities.length, 0);
  assert.equal(out.summary.blockedByDataQuality, true);
  assert.equal(out.summary.dataQualityLimited, true);
  assert.equal(out.summary.opportunityCount, 0);
});

test('空 Recommendations → 空输出', () => {
  const out = buildContentOpportunities(mkInput([]));
  assert.equal(out.opportunities.length, 0);
  assert.equal(out.summary.opportunityCount, 0);
});

/* ------------------------------ clustering（§18/§57） ------------------------------ */
test('同 category 同 intent 的同类建议合并为一个机会（保留全部 source recs）', () => {
  const a = mkRec({ recommendationType: 'CATEGORY_COVERAGE', category: 'tool-discovery' });
  const b = mkRec({ recommendationType: 'CATEGORY_COVERAGE', category: 'tool-discovery' });
  b.queries = [mkQuery({ queryText: '工具发现场景问题 2？', category: 'tool-discovery' })];
  const opps = buildContentOpportunities(mkInput([a, b])).opportunities;
  assert.equal(opps.length, 1);
  assert.equal(opps[0].recommendationCount, 2);
  assert.ok(opps[0].recommendationIds.includes(a.id));
  assert.ok(opps[0].recommendationIds.includes(b.id));
  assert.equal(opps[0].targetQueryCount, 2);
});

test('不同 category 不误合并', () => {
  const a = mkRec({ recommendationType: 'CATEGORY_COVERAGE', category: 'tool-discovery' });
  const b = mkRec({ recommendationType: 'CATEGORY_COVERAGE', category: 'comparison' });
  const opps = buildContentOpportunities(mkInput([a, b])).opportunities;
  assert.equal(opps.length, 2);
  const cats = opps.map(o => o.category).sort();
  assert.deepEqual(cats, ['comparison', 'tool-discovery']);
});

test('不同竞品的 comparison 机会分离', () => {
  const a = mkRec({ recommendationType: 'COMPETITOR_DIFFERENTIATION', competitorName: 'ChatGPT' });
  const b = mkRec({ recommendationType: 'COMPETITOR_DIFFERENTIATION', competitorName: 'Notion' });
  const opps = buildContentOpportunities(mkInput([a, b], {
    approvedCompetitors: [{ canonicalName: 'ChatGPT', competitorType: 'DIRECT' }, { canonicalName: 'Notion', competitorType: 'ADJACENT' }],
  })).opportunities;
  assert.equal(opps.length, 2);
  const names = opps.map(o => o.competitors[0]?.canonicalName).sort();
  assert.deepEqual(names, ['ChatGPT', 'Notion']);
});

test('Query dedup：同一 canonical 只保留一行，sourceEvidenceCount 累计', () => {
  const rec = mkRec({ recommendationType: 'QUERY_COVERAGE', category: 'tool-discovery' });
  const dup = { ...rec, id: 'rec-dup' };
  rec.queries = [mkQuery({ queryText: 'A 工具哪个好？' }), mkQuery({ queryText: 'A 工具哪个好？' })];
  dup.queries = [mkQuery({ queryText: 'a 工具哪个好？' })]; // 大小写/空白变体 → 同 canonical
  const opps = buildContentOpportunities(mkInput([rec, dup])).opportunities;
  assert.equal(opps.length, 1);
  assert.equal(opps[0].targetQueryCount, 1);
  assert.equal(opps[0].queries[0].sourceEvidenceCount, 3);
  assert.equal(opps[0].queries[0].queryText, 'A 工具哪个好？'); // UI 仍展示原 snapshot
});

test('evidence links 全保留（去重后 evidenceId/runId 完整）', () => {
  const rec = mkRec({ recommendationType: 'CATEGORY_COVERAGE' });
  const e1 = mkQuery({ queryText: '问题甲？' });
  const e2 = mkQuery({ queryText: '问题乙？' });
  rec.queries = [e1, e2];
  const opp = single(rec)[0];
  assert.equal(opp.evidenceCount, 2);
  const ids = opp.queries.flatMap(q => q.evidenceIds);
  assert.ok(ids.includes(e1.evidenceId));
  assert.ok(ids.includes(e2.evidenceId));
});

test('representative query deterministic：evidence 多者优先；同输入同输出', () => {
  const rec = mkRec({ recommendationType: 'CATEGORY_COVERAGE' });
  rec.queries = [
    mkQuery({ queryText: '低频问题？' }),
    mkQuery({ queryText: '高频问题？' }),
    mkQuery({ queryText: '高频问题？' }),
  ];
  const r1 = single(rec);
  const r2 = single(rec);
  assert.equal(r1[0].representativeQuery, '高频问题？');
  assert.equal(r2[0].representativeQuery, r1[0].representativeQuery);
  assert.deepEqual(JSON.parse(JSON.stringify(r1)), JSON.parse(JSON.stringify(r2)));
});

test('target engines deterministic（dedup 稳定排序）', () => {
  const rec = mkRec({ recommendationType: 'CATEGORY_COVERAGE' });
  rec.queries = [
    mkQuery({ queryText: 'q1？', engine: { provider: 'qwen', engineKey: 'qwen-api', engineName: 'Qwen', requestedModel: 'qwen-plus', responseModel: null } }),
    mkQuery({ queryText: 'q2？', engine: ENG_MOCK }),
  ];
  const opp = single(rec)[0];
  assert.equal(opp.targetEngineCount, 2);
  assert.deepEqual(opp.engines.map(e => e.provider), ['mock', 'qwen']);
});

test('target competitors 只来自已审核语义（未审核不在 approved 集 → 不计为正式目标）', () => {
  const rec = mkRec({ recommendationType: 'COMPETITOR_DIFFERENTIATION', competitorName: 'MysteryTool' });
  const opp = single(rec, { approvedCompetitors: [] })[0];
  assert.equal(opp.competitors.length, 0);
  assert.equal(opp.targetCompetitorCount, 0);
});

test('input not mutated（两次运行结果一致 + 输入 JSON 不变）', () => {
  const rec = mkRec({ recommendationType: 'CATEGORY_COVERAGE', category: 'tool-discovery' });
  rec.queries = [mkQuery({ queryText: '不变性问题？' })];
  const input = mkInput([rec]);
  const before = JSON.stringify(input);
  const out1 = buildContentOpportunities(input);
  const out2 = buildContentOpportunities(input);
  assert.equal(JSON.stringify(out1), JSON.stringify(out2));
  assert.equal(JSON.stringify(input), before);
});

/* ------------------------------ priority（§28/§58） ------------------------------ */
test('更多 target queries → coverage signal 更高（优先级提高）', () => {
  const mk = (n: number, score: number) => {
    const rec = mkRec({ recommendationType: 'CATEGORY_COVERAGE', category: 'tool-discovery', priorityScore: score });
    rec.queries = Array.from({ length: n }, (_, i) => mkQuery({ queryText: `问题 ${i + 1}？`, category: 'tool-discovery' }));
    return rec;
  };
  const low = single(mk(1, 70))[0];
  const high = single(mk(8, 70))[0];
  assert.ok(high.priorityScore > low.priorityScore, `${high.priorityScore} > ${low.priorityScore}`);
  assert.ok(low.priorityScore <= 100);
});

test('高优先级建议不无故降级（无 DQ 时不压分）', () => {
  const rec = mkRec({ recommendationType: 'COMPETITOR_DIFFERENTIATION', competitorName: 'ChatGPT', priorityScore: 95 });
  rec.queries = Array.from({ length: 8 }, (_, i) => mkQuery({ queryText: `对比问题 ${i + 1}？` }));
  const opp = single(rec, { approvedCompetitors: [{ canonicalName: 'ChatGPT', competitorType: 'DIRECT' }] })[0];
  assert.equal(opp.priority, 'HIGH');
  assert.ok(opp.priorityScore >= 80);
  assert.equal(opp.dataQualityLimited, false);
});

test('data quality warning 压制高成本机会（DOCUMENTATION → ≤49 + limited）', () => {
  const rec = mkRec({ recommendationType: 'CITATION_READINESS', priorityScore: 90 });
  rec.queries = Array.from({ length: 8 }, (_, i) => mkQuery({ queryText: `引用问题 ${i + 1}？` }));
  const oppNoDq = single(rec)[0];
  assert.equal(oppNoDq.opportunityType, 'DOCUMENTATION');
  const oppDq = single(rec, { hasDataQualityIssue: true })[0];
  assert.equal(oppDq.dataQualityLimited, true);
  assert.ok(oppDq.priorityScore <= 49);
});

test('clamp 0–100', () => {
  const rec = mkRec({ recommendationType: 'RECOMMENDATION_READINESS', priorityScore: 100 });
  rec.queries = Array.from({ length: 30 }, (_, i) => mkQuery({ queryText: `高分问题 ${i + 1}？` }));
  const opp = single(rec)[0];
  assert.ok(opp.priorityScore >= 0 && opp.priorityScore <= 100);
  const recLow = mkRec({ recommendationType: 'ENTITY_CLARITY', priorityScore: 0 });
  const oppLow = single(recLow)[0];
  assert.ok(oppLow.priorityScore >= 0);
});

test('deterministic priority：同输入重复调用分数一致', () => {
  const rec = mkRec({ recommendationType: 'CATEGORY_COVERAGE', category: 'workflow' });
  rec.queries = [mkQuery({ queryText: '稳定问题？', category: 'workflow' })];
  const input = mkInput([rec]);
  const a = buildContentOpportunities(input).opportunities[0].priorityScore;
  const b = buildContentOpportunities(input).opportunities[0].priorityScore;
  assert.equal(a, b);
});

test('no expectedDelta（候选不携带效果承诺字段）', () => {
  const opps = single(mkRec({ recommendationType: 'CATEGORY_COVERAGE' }));
  assert.ok(!('expectedDelta' in opps[0]));
  assert.ok(!('expectedImprovement' in opps[0]));
  for (const signal of opps[0].expectedSignals) assert.ok(!signal.includes('+'));
});

/* ------------------------------ structure blocks（§23/§59） ------------------------------ */
test('USE_CASE_PAGE blocks（含 用户场景/产品能力/可验证事实/FAQ）', () => {
  const opp = single(mkRec({ recommendationType: 'CATEGORY_COVERAGE' }))[0];
  const titles = opp.blocks.map(b => b.title);
  assert.ok(titles.includes('用户场景'));
  assert.ok(titles.includes('产品能力'));
  assert.ok(titles.includes('可验证事实'));
  assert.ok(titles.includes('常见问题'));
});

test('COMPARISON_PAGE blocks（含 功能维度/差异说明）', () => {
  const rec = mkRec({ recommendationType: 'COMPETITOR_DIFFERENTIATION', competitorName: 'ChatGPT' });
  const opp = single(rec, { approvedCompetitors: [{ canonicalName: 'ChatGPT', competitorType: 'DIRECT' }] })[0];
  const titles = opp.blocks.map(b => b.title);
  assert.ok(titles.includes('功能维度'));
  assert.ok(titles.includes('差异说明'));
});

test('FAQ_PAGE blocks（FAQ 结构）', () => {
  const opp = single(mkRec({ recommendationType: 'STRUCTURED_INFORMATION' }))[0];
  const titles = opp.blocks.map(b => b.title);
  assert.ok(titles.includes('适用场景'));
  assert.ok(titles.includes('事实来源'));
});

test('DATA_REFERENCE blocks（事实/来源/更新时间/引用方式）', () => {
  const opp = single(mkRec({ recommendationType: 'CITATION_READINESS' }))[0];
  const titles = opp.blocks.map(b => b.title);
  assert.ok(titles.includes('数据来源'));
  assert.ok(titles.includes('更新时间'));
  assert.ok(titles.includes('引用方式'));
});

test('no full article body（blocks 只有 title/purpose；opportunity 无正文字段）', () => {
  const opp = single(mkRec({ recommendationType: 'CATEGORY_COVERAGE' }))[0];
  for (const b of opp.blocks) {
    assert.ok(!('body' in b));
    assert.ok(!('content' in b));
    assert.ok(typeof b.purpose === 'string' && b.purpose.length > 0);
  }
  assert.ok(!('body' in opp));
  assert.ok(!('fullText' in opp));
  assert.ok(!('finalTitle' in opp));
});

test('stable sortOrder：0..n-1 且块顺序稳定', () => {
  const opp = single(mkRec({ recommendationType: 'CATEGORY_COVERAGE' }))[0];
  opp.blocks.forEach((b, i) => assert.equal(b.sortOrder, i));
  const again = single(mkRec({ recommendationType: 'CATEGORY_COVERAGE' }))[0];
  assert.deepEqual(again.blocks.map(b => b.blockType), opp.blocks.map(b => b.blockType));
});

test('block purpose present & 无空 block', () => {
  const opp = single(mkRec({ recommendationType: 'STRUCTURED_INFORMATION' }))[0];
  assert.equal(opp.opportunityType, 'FAQ_PAGE');
  assert.ok(opp.blocks.length > 0);
  for (const b of opp.blocks) {
    assert.ok(b.title.trim().length > 0);
    assert.ok(b.purpose.trim().length > 0);
    assert.ok(b.blockType.trim().length > 0);
  }
});

test('titleDirection 用「标题方向」语义（非营销最终标题）', () => {
  const rec = mkRec({ recommendationType: 'CATEGORY_COVERAGE', category: 'tool-discovery' });
  const opp = single(rec)[0];
  assert.ok(opp.titleDirection.includes('工具发现'));
  assert.ok(!opp.titleDirection.includes('点击'));
  assert.ok(!opp.titleDirection.includes('立即'));
  // rationale 不包含因果承诺
  assert.ok(!opp.rationale.includes('一定提升'));
});

test('canonicalQueryKey：NFKC/trim/大小写归一（英文）', () => {
  assert.equal(canonicalQueryKey('  AI Tool  '), 'ai tool');
  assert.equal(canonicalQueryKey('ＡＩ工具？'), canonicalQueryKey('AI工具？'));
  assert.equal(canonicalQueryKey('ChatGPT'), canonicalQueryKey('chatgpt'));
});

test('resolveRecommendationMapping 确定性与边界', () => {
  assert.equal(resolveRecommendationMapping('CATEGORY_COVERAGE', 100).primary, 'USE_CASE_PAGE');
  assert.equal(resolveRecommendationMapping('CITATION_READINESS', 5).primary, 'DATA_REFERENCE');
  assert.equal(resolveRecommendationMapping('CITATION_READINESS', 6).primary, 'DOCUMENTATION');
  assert.equal(resolveRecommendationMapping('DATA_COLLECTION', 10), undefined);
});
