import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  assertSafeFetchUrl,
  assertPublicIp,
  blocksToChangeItems,
  canonicalAssetUrl,
  synthesizePilotReview,
  type PilotReviewInput,
} from '../src/index';

// ---- Measurement / Pilot review 合成（§76） ----

const baseReview = (over: Partial<PilotReviewInput>): PilotReviewInput => ({
  measurementVerdict: 'VALID_FOR_WEB_CHANGE',
  measurementMode: 'MANUAL_VERIFIED',
  executionValidity: 'CHANGE_VERIFIED',
  comparisonVerdict: 'CONTROLLED_COMPARABLE',
  evaluationOutcome: 'IMPROVED_SIGNALS',
  retrievalObservedForChangedAsset: 'TRUE',
  ...over,
});

test('57. review snapshot：有效路径 + 改善 → VALIDATED_OBSERVATION', () => {
  const r = synthesizePilotReview(baseReview({}));
  assert.equal(r.observedOutcome, 'VALIDATED_OBSERVATION');
});

test('58. measurementValidity 无效 → INVALID_MEASUREMENT（优先于 evaluation outcome）', () => {
  const r = synthesizePilotReview(baseReview({ measurementVerdict: 'INVALID_FOR_WEB_CHANGE', evaluationOutcome: 'IMPROVED_SIGNALS' }));
  assert.equal(r.observedOutcome, 'INVALID_MEASUREMENT');
  assert.equal(r.attributionConfidence, 'LOW');
});

test('59. executionValidity 未证实 → CHANGE_NOT_VERIFIED', () => {
  const r = synthesizePilotReview(baseReview({ executionValidity: 'CHANGE_NOT_OBSERVED' }));
  assert.equal(r.observedOutcome, 'CHANGE_NOT_VERIFIED');
  const notRec = synthesizePilotReview(baseReview({ executionValidity: 'NOT_RECORDED' }));
  assert.equal(notRec.observedOutcome, 'CHANGE_NOT_VERIFIED');
});

test('60. comparisonValidity 不可比 → INCONCLUSIVE', () => {
  const r = synthesizePilotReview(baseReview({ comparisonVerdict: 'NOT_COMPARABLE', evaluationOutcome: 'IMPROVED_SIGNALS' }));
  assert.equal(r.observedOutcome, 'INCONCLUSIVE');
});

test('61. attribution confidence：满足条件 MEDIUM，否则 LOW', () => {
  const med = synthesizePilotReview(baseReview({}));
  assert.equal(med.attributionConfidence, 'MEDIUM');
  const low = synthesizePilotReview(baseReview({ retrievalObservedForChangedAsset: 'FALSE' }));
  assert.equal(low.attributionConfidence, 'LOW');
});

test('62. 所有 outcome 映射允许失败结果（不强制正向）', () => {
  assert.equal(synthesizePilotReview(baseReview({ evaluationOutcome: 'NO_CLEAR_CHANGE' })).observedOutcome, 'NO_CLEAR_OBSERVATION');
  assert.equal(synthesizePilotReview(baseReview({ evaluationOutcome: 'REGRESSED_SIGNALS' })).observedOutcome, 'NEGATIVE_OBSERVATION');
  assert.equal(synthesizePilotReview(baseReview({ evaluationOutcome: 'MIXED_SIGNALS' })).observedOutcome, 'MIXED_OBSERVATION');
  assert.equal(synthesizePilotReview(baseReview({ evaluationOutcome: 'INCONCLUSIVE' })).observedOutcome, 'INCONCLUSIVE');
});

test('63. 无 causal 措辞；deterministic', () => {
  const a = synthesizePilotReview(baseReview({}));
  const b = synthesizePilotReview(baseReview({}));
  assert.deepEqual(a, b);
  assert.ok(!a.reasons.some(x => x.includes('已证明') || x.includes('证明提升') || x.includes('一定提升')));
});

// ---- Change items（§73 部分） ----

test('73. blocksToChangeItems：确定性 + no final body', () => {
  const items = blocksToChangeItems([
    { blockType: 'USER_SCENARIO', title: '用户场景', purpose: '说明用户为什么找这类工具', sortOrder: 1 },
    { blockType: 'FAQ', title: 'FAQ', purpose: '覆盖常见问题', sortOrder: 2 },
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0]!.changeType, 'ADD_USE_CASE');
  assert.equal(items[1]!.changeType, 'ADD_FAQ');
  assert.ok(items.every(i => i.instruction.length < 200));
  assert.ok(!items.some(i => i.instruction.includes('发表') || i.instruction.length > 400));
  const again = blocksToChangeItems([
    { blockType: 'USER_SCENARIO', title: '用户场景', purpose: '说明用户为什么找这类工具', sortOrder: 1 },
    { blockType: 'FAQ', title: 'FAQ', purpose: '覆盖常见问题', sortOrder: 2 },
  ]);
  assert.deepEqual(items, again);
});

// ---- URL safety（§72） ----

test('19/20/21/22. localhost / loopback / private / metadata IP blocked', () => {
  for (const url of [
    'http://localhost:3000/a', 'http://127.0.0.1/x', 'http://[::1]/x', 'http://10.0.0.5/x',
    'http://192.168.1.1/x', 'http://172.16.5.5/x', 'http://169.254.169.254/latest/meta-data',
    'http://metadata.google.internal/',
  ]) {
    const r = assertSafeFetchUrl(url);
    assert.equal(r.ok, false, `${url} should be blocked: ${r.reason}`);
  }
});

test('23. file/ftp 协议 blocked；仅 http/https', () => {
  assert.equal(assertSafeFetchUrl('file:///etc/passwd').ok, false);
  assert.equal(assertSafeFetchUrl('ftp://example.com/x').ok, false);
  assert.equal(assertSafeFetchUrl('https://example.com/x').ok, true);
});

test('24. allowedHosts 白名单强制', () => {
  const ok = assertSafeFetchUrl('https://www.projectmentor.cn/guide', { allowedHosts: ['projectmentor.cn'] });
  assert.equal(ok.ok, true);
  const bad = assertSafeFetchUrl('https://evil.example.com/guide', { allowedHosts: ['projectmentor.cn'] });
  assert.equal(bad.ok, false);
});

test('25/26. DNS 复查 IP（私网拒绝）+ userinfo 拒绝 + fragment 归一', () => {
  assert.equal(assertPublicIp('127.0.0.1').ok, false);
  assert.equal(assertPublicIp('10.1.2.3').ok, false);
  assert.equal(assertPublicIp('::ffff:192.168.1.1').ok, false);
  assert.equal(assertPublicIp('8.8.8.8').ok, true);
  assert.equal(assertPublicIp('2606:4700:4700::1111').ok, true);
  assert.equal(assertSafeFetchUrl('https://user:pass@example.com/').ok, false);
  assert.equal(canonicalAssetUrl('https://example.com/path/#frag'), 'https://example.com/path');
  assert.equal(canonicalAssetUrl('https://example.com:443/a/b/'), 'https://example.com/a/b');
});
