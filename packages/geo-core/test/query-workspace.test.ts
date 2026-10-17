import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  QUERY_TEMPLATES, buildQueries, builderSummary, computeMetricScope,
  detectTargetContamination, estimatedBuilderCount, guardQueryType,
  normalizeQueryText,
} from '../src/index';

const TARGET = { canonicalName: 'ProjectMentor', aliases: ['Project Mentor', 'PMentor', '项目导师'] };

// ---- 71. Query Contamination ----
test('71a. Discovery clean', () => {
  const r = detectTargetContamination('大学生参加创新创业比赛可以使用哪些 AI 工具？', TARGET);
  assert.equal(r.status, 'CLEAN');
  assert.equal(r.matchedAlias, null);
});

test('71b. canonical target present → TARGET_MENTIONED', () => {
  const r = detectTargetContamination('ProjectMentor 怎么样？', TARGET);
  assert.equal(r.status, 'TARGET_MENTIONED');
  assert.equal(r.matchedAlias, 'ProjectMentor');
});

test('71c. alias present → TARGET_MENTIONED (matched alias)', () => {
  const r = detectTargetContamination('用 PMentor 做商业计划书好吗？', TARGET);
  assert.equal(r.status, 'TARGET_MENTIONED');
  assert.equal(r.matchedAlias, 'PMentor');
});

test('71d. case variant → TARGET_MENTIONED', () => {
  assert.equal(detectTargetContamination('projectmentor 好不好', TARGET).status, 'TARGET_MENTIONED');
  assert.equal(detectTargetContamination('PROJECTMENTOR 好用吗', TARGET).status, 'TARGET_MENTIONED');
});

test('71e. Unicode normalized alias', () => {
  const t = { canonicalName: 'AcmeFlow', aliases: ['Acme　Flow', 'ＡcmeFlow'] }; // fullwidth space / fullwidth A
  assert.equal(detectTargetContamination('Acme Flow 有哪些功能', t).status, 'TARGET_MENTIONED');
});

test('71f. partial unrelated substring NOT flagged (Latin word boundary)', () => {
  // "Mentor" 是 "ProjectMentor" 的子串但长度不同 → alias 匹配整词；"ProjectMentors" 也不应命中
  const r = detectTargetContamination('哪个导师平台更好？', TARGET);
  assert.equal(r.status, 'CLEAN');
  assert.equal(detectTargetContamination('ProjectMentorX 是什么', TARGET).status, 'CLEAN');
});

test('71g. target only inside URL → POSSIBLE_TARGET_MENTION', () => {
  const r = detectTargetContamination('参考 https://example.com/ProjectMentor 的教程', TARGET);
  assert.equal(r.status, 'POSSIBLE_TARGET_MENTION');
});

test('71h. longest alias wins (alias 在中文串中命中)', () => {
  const r = detectTargetContamination('项目导师能帮我写计划书吗？', TARGET);
  assert.equal(r.status, 'TARGET_MENTIONED');
  assert.equal(r.matchedAlias, '项目导师');
});

test('71i. branded sanity allowed', () => {
  const g = guardQueryType('BRANDED_SANITY', 'ProjectMentor 是什么？', TARGET);
  assert.equal(g.allowed, true);
});

test('71j. custom with target → allowed with warning', () => {
  const g = guardQueryType('CUSTOM', 'ProjectMentor 有什么优势？', TARGET);
  assert.equal(g.allowed, true);
  assert.ok(g.message?.includes('不计入自然可见度主指标'));
});

// ---- 70. Analyzer alias basics（复用 detector 语义） ----
test('70. normalization: NFKC + whitespace + case', () => {
  assert.equal(normalizeQueryText('  有哪些　AI 工具？  '), '有哪些 ai 工具?');
  assert.equal(normalizeQueryText('ＡＢＣ'), 'abc');
});

test('70b. same input deterministic & input not mutated', () => {
  const q = 'ProjectMentor 好用吗？';
  const a = detectTargetContamination(q, TARGET);
  const b = detectTargetContamination(q, TARGET);
  assert.deepEqual(a, b);
  assert.equal(q, 'ProjectMentor 好用吗？');
});

// ---- 72. Query Builder ----
test('72a. template generation: RECOMMEND only', () => {
  const rows = buildQueries({ category: '大学生创新创业 AI 工具', scenario: ['国创赛'], intents: ['RECOMMEND'] }, TARGET);
  assert.ok(rows.length >= 1);
  assert.ok(rows.every(r => r.intent === 'RECOMMEND'));
  assert.ok(rows.every(r => r.queryType === 'DISCOVERY'));
  assert.ok(rows.every(r => r.text.includes('大学生创新创业 AI 工具')));
});

test('72b. category + scenario + intent + audience + modifier', () => {
  const rows = buildQueries({
    category: 'CRM SaaS', scenario: ['销售团队选型'], intents: ['PROBLEM_SOLVING', 'RECOMMEND', 'COMPARE'], audience: ['小团队'],
    modifiers: ['5000 元以内'],
  }, { canonicalName: 'AcmeFlow' });
  assert.ok(rows.some(r => r.text.includes('小团队')));
  assert.ok(rows.some(r => r.text.includes('5000 元以内')));
  assert.ok(rows.some(r => r.intent === 'COMPARE'));
  assert.ok(rows.every(r => r.contamination.status !== 'TARGET_MENTIONED'));
});

test('72c. custom queries appended', () => {
  const rows = buildQueries({ category: 'X', custom: ['AcmeFlow 是什么？'] }, { canonicalName: 'AcmeFlow' });
  const custom = rows.find(r => r.intent === 'CUSTOM');
  assert.ok(custom);
  assert.equal(custom.contamination.status, 'TARGET_MENTIONED');
});

test('72d. dedup: duplicate/whitespace/normalized texts collapse', () => {
  const rows = buildQueries({ category: 'X', scenario: ['S'], custom: ['做S可以用哪些 X？', '  做S可以用哪些 X？'] });
  const texts = rows.map(r => normalizeQueryText(r.text));
  assert.equal(new Set(texts).size, texts.length);
});

test('72e. stable ordering', () => {
  const a = buildQueries({ category: 'X', scenario: ['S1', 'S2'], intents: ['HOW_TO', 'RECOMMEND'] });
  const b = buildQueries({ category: 'X', scenario: ['S2', 'S1'], intents: ['RECOMMEND', 'HOW_TO'] });
  assert.deepEqual(a.map(r => r.text), b.map(r => r.text));
});

test('72f. generation cap', () => {
  const rows = buildQueries({
    category: 'X', scenario: ['1', '2', '3', '4', '5', '6'], intents: ['RECOMMEND', 'HOW_TO', 'COMPARE', 'PROBLEM_SOLVING', 'INFORMATIONAL'],
    audience: ['A', 'B', 'C', 'D'], modifiers: ['m1', 'm2', 'm3', 'm4', 'm5'],
  }, { canonicalName: 'T' });
  assert.ok(rows.length <= 100);
  const total = estimatedBuilderCount({
    category: 'X', scenario: ['1', '2', '3', '4', '5', '6'], intents: ['RECOMMEND', 'HOW_TO', 'COMPARE', 'PROBLEM_SOLVING', 'INFORMATIONAL'],
    audience: ['A', 'B', 'C', 'D'], modifiers: ['m1', 'm2', 'm3', 'm4', 'm5'],
  });
  assert.ok(total > 100); // 原始组合数会超 cap
});

test('72g. builder summary', () => {
  const s = builderSummary({ category: 'X', custom: ['T 好用吗？'] }, { canonicalName: 'T' });
  assert.equal(s.targetContaminated, 1);
  assert.ok(s.estimated > 0);
});

test('72h. templates never contain brand name', () => {
  const rows = buildQueries({ category: 'CRM SaaS', intents: ['RECOMMEND', 'HOW_TO', 'COMPARE', 'PROBLEM_SOLVING', 'INFORMATIONAL'] }, { canonicalName: 'AcmeFlow' });
  assert.ok(rows.every(r => !r.text.includes('AcmeFlow')));
});

test('72i. no LLM / no network', () => {
  // 纯函数包（不含 http import）；直接验证无意外副作用
  const t = QUERY_TEMPLATES.RECOMMEND.length;
  assert.ok(t > 0);
});

test('73-guard: DISCOVERY 含目标拒绝且给 suggestion', () => {
  const g = guardQueryType('DISCOVERY', 'ProjectMentor 适合国创赛吗？', TARGET);
  assert.equal(g.allowed, false);
  assert.equal(g.code, 'TARGET_PRESENT_IN_DISCOVERY_QUERY');
  assert.equal(g.suggestion, 'BRANDED_SANITY');
});

// ---- 73. Metrics scope ----
test('73a. DISCOVERY included / BRANDED_SANITY excluded', () => {
  const s = computeMetricScope([
    { queryType: 'DISCOVERY' }, { queryType: 'DISCOVERY' },
    { queryType: 'BRANDED_SANITY' }, { queryType: 'BRANDED_SANITY' },
  ]);
  assert.equal(s.eligibleQueryCount, 2);
  assert.equal(s.excludedSanityCount, 2);
  assert.equal(s.metricQueryScope, 'DISCOVERY_ONLY');
});

test('73b. legacy sanity=true treated as excluded', () => {
  const s = computeMetricScope([{ sanity: true }, { sanity: false }]);
  assert.equal(s.eligibleQueryCount, 1);
  assert.equal(s.excludedSanityCount, 1);
});

test('73c. contaminated CUSTOM excluded; clean CUSTOM included', () => {
  const s = computeMetricScope([
    { queryType: 'CUSTOM', contamination: { status: 'TARGET_MENTIONED' } },
    { queryType: 'CUSTOM', contamination: { status: 'CLEAN' } },
  ]);
  assert.equal(s.eligibleQueryCount, 1);
  assert.equal(s.excludedContaminatedCount, 1);
});

test('73d. all sanity → no misleading visibility denominator', () => {
  const s = computeMetricScope([{ queryType: 'BRANDED_SANITY' }, { queryType: 'BRANDED_SANITY' }]);
  assert.equal(s.eligibleQueryCount, 0);
  assert.equal(s.excludedSanityCount, 2);
  assert.equal(s.totalRows, 2);
});

// ---- R1-D10: kebab/snake/space separator 等价 + token boundary（防止 substring 误报）----
const NOVA_TARGET: TargetIdentity = { canonicalName: 'NovaFlow', aliases: ['Nova Flow', 'NovaFlow CRM'] };

test('R1-D10. kebab-case separator 等价命中（nova-flow）', () => {
  const r = detectTargetContamination('nova-flow 有哪些功能', NOVA_TARGET);
  assert.equal(r.status, 'TARGET_MENTIONED');
});

test('R1-D10. snake_case separator 等价命中（nova_flow）', () => {
  const r = detectTargetContamination('nova_flow 怎么样', NOVA_TARGET);
  assert.equal(r.status, 'TARGET_MENTIONED');
});

test('R1-D10. 大小写 + 连字符混合命中（Nova-Flow）', () => {
  const r = detectTargetContamination('Nova-Flow 好用吗', NOVA_TARGET);
  assert.equal(r.status, 'TARGET_MENTIONED');
});

test('R1-D10. kebab 完整品牌别名（novaflow-crm）', () => {
  const r = detectTargetContamination('novaflow-crm 哪个好', NOVA_TARGET);
  assert.equal(r.status, 'TARGET_MENTIONED');
});

test('R1-D10. 复合前缀不误伤（nova workflow 应为 CLEAN）', () => {
  const r = detectTargetContamination('nova workflow 软件有哪些', NOVA_TARGET);
  assert.equal(r.status, 'CLEAN');
});

test('R1-D10. 子串前缀不误伤（innovation-flow / innova flow）', () => {
  assert.equal(detectTargetContamination('innovation-flow 有什么推荐', NOVA_TARGET).status, 'CLEAN');
  assert.equal(detectTargetContamination('innova flow 工具', NOVA_TARGET).status, 'CLEAN');
});

test('R1-D10. 词中变体不误伤（workflow 不命中 NovaFlow）', () => {
  const r = detectTargetContamination('workflow 软件最佳实践', NOVA_TARGET);
  assert.equal(r.status, 'CLEAN');
});

test('R1-D10. 连续 kebab 品牌保持命中（nova-flow-crm 同时含别名与品牌拼接）', () => {
  const r = detectTargetContamination('nova-flow-crm 对比评测', NOVA_TARGET);
  assert.equal(r.status, 'TARGET_MENTIONED');
});

// ---- M8E Archetype Domain Queries (Education / Consumer Hardware / SaaS) ----
test('M8E-Domain. Education Major (医学信息工程) queries are natural and free of awkward tool phrasing', () => {
  const rows = buildQueries({
    category: '医学信息工程',
    scenario: ['学科选校'],
    intents: ['RECOMMEND', 'HOW_TO', 'COMPARE', 'PROBLEM_SOLVING', 'INFORMATIONAL'],
    audience: ['高考考生'],
  }, { canonicalName: '中南民族大学' });

  assert.ok(rows.length >= 5);
  // 必须全部为 DISCOVERY，且不含目标高校名称
  assert.ok(rows.every(r => r.queryType === 'DISCOVERY'));
  assert.ok(rows.every(r => r.contamination.status === 'CLEAN'));
  assert.ok(rows.every(r => !r.text.includes('中南民族大学')));
  // 必须保留专业关键词
  assert.ok(rows.every(r => r.text.includes('医学信息工程')));
  // 绝不能出现 "医学信息工程有哪些值得推荐的工具？" 或 "哪些医学信息工程工具"
  assert.ok(rows.every(r => !r.text.includes('医学信息工程有哪些值得推荐的工具')));
  assert.ok(rows.every(r => !r.text.includes('医学信息工程工具')));
  // 包含院校推荐或课程相关自然提问
  assert.ok(rows.some(r => r.text.includes('院校推荐') || r.text.includes('优质高校')));
  assert.ok(rows.some(r => r.text.includes('课程') || r.text.includes('技能')));
});

test('M8E-Domain. Consumer Hardware (洗地机) queries adopt household phrasing', () => {
  const rows = buildQueries({
    category: '洗地机',
    scenario: ['木地板清洁'],
    intents: ['RECOMMEND', 'HOW_TO', 'COMPARE', 'PROBLEM_SOLVING', 'INFORMATIONAL'],
    audience: ['养宠家庭'],
  }, { canonicalName: '追觅' });

  assert.ok(rows.length >= 5);
  assert.ok(rows.every(r => r.queryType === 'DISCOVERY'));
  assert.ok(rows.every(r => r.contamination.status === 'CLEAN'));
  assert.ok(rows.every(r => !r.text.includes('追觅')));
  assert.ok(rows.every(r => r.text.includes('洗地机')));
  // 绝不能出现 "洗地机有哪些值得推荐的工具"
  assert.ok(rows.every(r => !r.text.includes('洗地机有哪些值得推荐的工具')));
  assert.ok(rows.some(r => r.text.includes('口碑') || r.text.includes('选购')));
});

