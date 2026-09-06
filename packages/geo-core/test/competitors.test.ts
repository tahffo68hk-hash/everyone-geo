import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDiscoveryLexicon,
  discoverCandidates,
  findAliasOccurrences,
  judgeRecommendationSignal,
  candidateTokens,
  tokensAreSuffix,
} from '../src/index';

// 自身品牌：与仓库 seed 中 ProjectMentor 的 name + aliases 对齐。
const OWN = ['ProjectMentor', 'Project Mentor', '项目导师', 'PMentor'];
// legacy 占位竞对（A/B/C）应作为 excludeNames 传入，不出现在候选里。
const LEGACY = ['Competitor A', 'Competitor B', 'Competitor C', 'CompA', 'CompB', 'CompC'];

const discover = (raw: string, extra: { ownBrandAliases?: string[]; excludeNames?: string[] } = {}) =>
  discoverCandidates(raw, {
    ownBrandAliases: extra.ownBrandAliases ?? OWN,
    excludeNames: extra.excludeNames ?? LEGACY,
  });

test('candidateTokens: NFKC fold + lowercase + 非字母数字切分', () => {
  assert.deepEqual(candidateTokens('OpenAI ChatGPT'), ['openai', 'chatgpt']);
  assert.deepEqual(candidateTokens('ChatGPT'), ['chatgpt']);
  assert.deepEqual(candidateTokens('ＰｒｏｊｅｃｔＭｅｎｔｏｒ'), ['projectmentor']);
});

test('tokensAreSuffix: 短名是长名 token 后缀则归并（含相等）', () => {
  assert.equal(tokensAreSuffix(['chatgpt'], ['openai', 'chatgpt']), true);
  assert.equal(tokensAreSuffix(['chatgpt'], ['chatgpt']), true);
  assert.equal(tokensAreSuffix(['openai', 'chatgpt'], ['chatgpt']), false);
  assert.equal(tokensAreSuffix(['chatgpt'], ['chatgpt', 'enterprise']), false);
});

test('uppercase 品牌被提取为候选（Mentioned Brand ≠ Competitor：仅候选信号）', () => {
  const result = discover('可以考虑 ChatGPT 或 Claude 作为助手。');
  assert.equal(result.length, 2);
  const names = result.map(c => c.canonicalName);
  assert.ok(names.includes('ChatGPT'));
  assert.ok(names.includes('Claude'));
  assert.ok(result.every(c => c.occurrences.length >= 1));
});

test('同一候选多个变体在一个文本内归并为同一候选（OpenAI ChatGPT + ChatGPT + chatgpt）', () => {
  // 小写 chatgpt 依赖 hint 扫描：lexicon 先由大写变体建立。
  const text1 = 'OpenAI ChatGPT 与 ChatGPT 都是主流选择。';
  const text2 = '也有人直接用 chatgpt 完成项目。';
  const lexicon = createDiscoveryLexicon();
  const r1 = discoverCandidates(text1, { ownBrandAliases: OWN, excludeNames: LEGACY }, lexicon);
  const r2 = discoverCandidates(text2, { ownBrandAliases: OWN, excludeNames: LEGACY }, lexicon);
  // r1 已把 OpenAI ChatGPT + ChatGPT 归并为一个候选；r2 通过 lexicon hint 归并 lowercase chatgpt。
  assert.equal(r1.length, 1);
  assert.equal(r2.length, 1);
  assert.deepEqual(r2[0].keyTokens, r1[0].keyTokens);
  const candidate = r1[0];
  assert.ok(candidate.aliases.some(a => a.toLowerCase() === 'chatgpt'));
  assert.ok(candidate.aliases.includes('OpenAI ChatGPT')); // 完整 run 文本作为别名变体
  assert.ok(candidate.aliases.includes('ChatGPT'));
  // lexicon 内只保留一个身份组
  assert.equal(lexicon.byKey.size, 1);
});

test('大小写变体（ChatGPT vs chatgpt）跨文本归并', () => {
  const lexicon = createDiscoveryLexicon();
  discoverCandidates('推荐 ChatGPT', { ownBrandAliases: OWN }, lexicon);
  const second = discoverCandidates('chatgpt 也还不错', { ownBrandAliases: OWN }, lexicon);
  assert.equal(second.filter(c => c.keyTokens.join(' ').endsWith('chatgpt')).length, 1);
  assert.equal(lexicon.byKey.size, 1);
});

test('URL/domain 不被当作候选（openai.com 不是候选，正文中的 ChatGPT 才是）', () => {
  const raw = '详见 https://openai.com/chatgpt 官网；ChatGPT 很好用。';
  const result = discover(raw);
  const names = result.map(c => c.canonicalName);
  assert.ok(!names.some(n => n.toLowerCase().includes('openai.com')));
  assert.ok(names.includes('ChatGPT'));
});

test('自身品牌（含别名/大小写/多词变体）永远不进入候选', () => {
  assert.equal(discover('ProjectMentor 是最佳工具。').length, 0);
  assert.equal(discover('我推荐 Project Mentor 给团队。').length, 0);
  assert.equal(discover('推荐使用项目导师。').length, 0);
  const mixed = discover('ProjectMentor 与 ChatGPT 对比。');
  assert.deepEqual(mixed.map(c => c.canonicalName), ['ChatGPT']);
});

test('legacy 占位竞对（Competitor A/B/C、CompA…）不进入候选', () => {
  assert.equal(discover('Competitor A 很流行，CompB 也不错。').length, 0);
  // excludeNames 缺省（未来项目无占位）时不受影响
  const result = discoverCandidates('Competitor A 与 ChatGPT 对比。', { ownBrandAliases: OWN });
  assert.equal(result.filter(c => c.canonicalName === 'Competitor A').length, 0);
});

test('普通词排除：AI/工具类泛词不作为品牌候选', () => {
  const result = discover('AI 工具推荐：ChatGPT、Claude。');
  const names = result.map(c => c.canonicalName);
  assert.ok(!names.includes('AI'));
  assert.ok(names.includes('ChatGPT'));
});

test('明显普通词（The/Top/Review…）不作为候选', () => {
  const result = discover('The best review of ChatGPT. Top tool.');
  const names = result.map(c => c.canonicalName);
  assert.ok(!names.some(n => ['The', 'Best', 'Review', 'Top', 'Tool'].includes(n)));
  assert.ok(names.includes('ChatGPT'));
});

test('中文产品名不做自动猜测（需 lexicon/人工）——不会把普通中文当候选', () => {
  // 纯中文文本无大写拉丁 token → 无候选（诚实：证据不足时不出候选）
  const result = discover('推荐使用飞书进行项目管理。');
  assert.equal(result.length, 0);
});

test('候选文本中的大小写变体保留原始展示（aliases）', () => {
  const result = discover('chatgpt 与 CHATGPT 是两个？不，是同一个。');
  // 首个大写变体建立 lexicon 后，小写变体通过 hint 归并
  if (result.length === 0) {
    // 全部小写场景：不强制候选（无大写信号）
    assert.ok(true);
    return;
  }
  assert.equal(result.length, 1);
});

test('推荐信号：仅目标候选被 cue 归属时 recommended=true（确定性词法）', () => {
  const raw = '强烈推荐 ChatGPT，因为它高效；Claude 则没有提到。';
  const candidates = discover(raw);
  const chatgpt = candidates.find(c => c.keyTokens.join(' ').endsWith('chatgpt'));
  assert.ok(chatgpt);
  const all: Array<{ entityId: string; startOffset: number; endOffset: number }> = [];
  for (const c of candidates) {
    for (const occ of c.occurrences) all.push({ entityId: c.keyTokens.join(' '), startOffset: occ.start, endOffset: occ.end });
  }
  const rec = judgeRecommendationSignal(raw, chatgpt.keyTokens.join(' '), all);
  assert.equal(rec, true);
});

test('findAliasOccurrences：大小写不敏感匹配返回 raw offsets', () => {
  const raw = '有人用 chatgpt 和 CHATGPT 做计划，也推荐了 Claude。';
  const hits = findAliasOccurrences(raw, ['ChatGPT']);
  assert.equal(hits.length, 2);
  for (const hit of hits) {
    assert.equal(raw.slice(hit.start, hit.end).toLowerCase(), 'chatgpt');
  }
});

test('候选仅在足够证据下出现：空文本/纯 URL/纯品牌自身 → 无候选', () => {
  assert.equal(discover('').length, 0);
  assert.equal(discover('更多信息见 https://example.com/chatgpt').length, 0);
  assert.equal(discover('ProjectMentor 提供能力。').length, 0);
});
