import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  aggregateMeasurementFacts,
  classifyMeasurementFact,
  factsFromRetrievalModes,
  measurementGuard,
  type MeasurementGuardResult,
  type MeasurementModeFact,
} from '../src/index';

const fact = (over: Partial<MeasurementModeFact>): MeasurementModeFact => ({
  retrievalMode: 'api_plain',
  sourceType: 'official_api',
  ...over,
});

test('1. api_plain ⇒ INVALID_FOR_WEB_CHANGE（MODEL_BEHAVIOR_ONLY）', () => {
  const r = classifyMeasurementFact(fact({ retrievalMode: 'api_plain', sourceType: 'official_api' }));
  assert.equal(r.verdict, 'INVALID_FOR_WEB_CHANGE');
  assert.equal(r.mode, 'MODEL_BEHAVIOR_ONLY');
  assert.ok(r.reasons.some(x => x.includes('api_plain')));
});

test('2. api_web_search 无 provenance ⇒ PARTIALLY_VALID；有 provenance ⇒ VALID', () => {
  const no = classifyMeasurementFact(fact({ retrievalMode: 'api_web_search', sourceType: 'official_api' }));
  assert.equal(no.verdict, 'PARTIALLY_VALID');
  const yes = classifyMeasurementFact(fact({ retrievalMode: 'api_web_search', sourceType: 'official_api', retrievalConfirmed: true }));
  assert.equal(yes.verdict, 'VALID_FOR_WEB_CHANGE');
  assert.equal(yes.mode, 'WEB_VALIDATED');
});

test('3. manual verified 有效', () => {
  const ok = classifyMeasurementFact(fact({
    retrievalMode: 'manual_verified', sourceType: 'manual',
    manualVerified: { verifiedBy: 'user-1', verifiedAt: '2026-09-07T00:00:00Z' },
  }));
  assert.equal(ok.verdict, 'VALID_FOR_WEB_CHANGE');
  assert.equal(ok.mode, 'MANUAL_VERIFIED');
  // 缺少确认字段 ⇒ PARTIALLY_VALID
  const weak = classifyMeasurementFact(fact({ retrievalMode: 'manual_verified', sourceType: 'manual', manualVerified: null }));
  assert.equal(weak.verdict, 'PARTIALLY_VALID');
});

test('4. unknown ⇒ UNKNOWN', () => {
  const r = classifyMeasurementFact(fact({ retrievalMode: 'unknown', sourceType: 'unknown' }));
  assert.equal(r.verdict, 'UNKNOWN');
  assert.equal(r.mode, 'UNKNOWN');
});

test('5. provider 名称不决定判定（mock sourceType 即使 api_plain 语义也按演示拒绝）', () => {
  // 即使 retrievalMode 像 api_plain，sourceType=mock 也必须是 INVALID + 提示演示来源
  const r = classifyMeasurementFact(fact({ retrievalMode: 'api_plain', sourceType: 'mock' }));
  assert.equal(r.verdict, 'INVALID_FOR_WEB_CHANGE');
  assert.ok(r.reasons.some(x => x.includes('演示') || x.includes('mock')));
});

test('6. demo（mock/estimated）不能作为真实 pilot', () => {
  for (const sourceType of ['mock', 'estimated']) {
    const r = classifyMeasurementFact(fact({ retrievalMode: 'manual_verified', sourceType }));
    assert.equal(r.verdict, 'INVALID_FOR_WEB_CHANGE');
  }
});

test('7. 聚合：全 VALID ⇒ VALID；全 api_plain ⇒ INVALID；混合 ⇒ PARTIALLY', () => {
  const valid = aggregateMeasurementFacts([
    fact({ retrievalMode: 'manual_verified', sourceType: 'manual', manualVerified: { verifiedBy: 'u', verifiedAt: 't' } }),
    fact({ retrievalMode: 'manual_verified', sourceType: 'manual', manualVerified: { verifiedBy: 'u', verifiedAt: 't' } }),
  ]);
  assert.equal(valid.verdict, 'VALID_FOR_WEB_CHANGE');

  const plain = aggregateMeasurementFacts([
    fact({ retrievalMode: 'api_plain', sourceType: 'official_api' }),
    fact({ retrievalMode: 'api_plain', sourceType: 'official_api' }),
  ]);
  assert.equal(plain.verdict, 'INVALID_FOR_WEB_CHANGE');
  assert.equal(plain.mode, 'MODEL_BEHAVIOR_ONLY');

  const mixed = aggregateMeasurementFacts([
    fact({ retrievalMode: 'manual_verified', sourceType: 'manual', manualVerified: { verifiedBy: 'u', verifiedAt: 't' } }),
    fact({ retrievalMode: 'api_plain', sourceType: 'official_api' }),
  ]);
  assert.equal(mixed.verdict, 'PARTIALLY_VALID');
});

test('8. 聚合：空 ⇒ UNKNOWN；demo 混入 ⇒ INVALID', () => {
  assert.equal(aggregateMeasurementFacts([]).verdict, 'UNKNOWN');
  const withDemo = aggregateMeasurementFacts([
    fact({ retrievalMode: 'manual_verified', sourceType: 'manual', manualVerified: { verifiedBy: 'u', verifiedAt: 't' } }),
    fact({ retrievalMode: 'api_plain', sourceType: 'mock' }),
  ]);
  assert.equal(withDemo.verdict, 'INVALID_FOR_WEB_CHANGE');
});

test('9. measurement guard：目标 WEB_CONTENT + INVALID ⇒ 阻断 INVALID_MEASUREMENT', () => {
  const g: MeasurementGuardResult = measurementGuard({ verdict: 'INVALID_FOR_WEB_CHANGE', targetChangeType: 'WEB_CONTENT' });
  assert.equal(g.allowsWebChangeClaim, false);
  assert.equal(g.blockedOutcome, 'INVALID_MEASUREMENT');
});

test('10. measurement guard：VALID ⇒ 放行；PARTIALLY ⇒ INCONCLUSIVE', () => {
  assert.equal(measurementGuard({ verdict: 'VALID_FOR_WEB_CHANGE', targetChangeType: 'WEB_CONTENT' }).allowsWebChangeClaim, true);
  assert.equal(measurementGuard({ verdict: 'PARTIALLY_VALID', targetChangeType: 'WEB_CONTENT' }).blockedOutcome, 'INCONCLUSIVE');
  assert.equal(measurementGuard({ verdict: 'UNKNOWN', targetChangeType: 'WEB_CONTENT' }).blockedOutcome, 'INCONCLUSIVE');
});

test('11. measurement guard：非 WEB_CONTENT 目标不施加 guard', () => {
  const g = measurementGuard({ verdict: 'INVALID_FOR_WEB_CHANGE', targetChangeType: 'MODEL_BEHAVIOR' });
  assert.equal(g.allowsWebChangeClaim, true);
  assert.equal(g.blockedOutcome, null);
});

test('12. deterministic：同输入同输出；factsFromRetrievalModes 过滤空', () => {
  const a = classifyMeasurementFact(fact({ retrievalMode: 'api_plain' }));
  const b = classifyMeasurementFact(fact({ retrievalMode: 'api_plain' }));
  assert.deepEqual(a, b);
  assert.equal(factsFromRetrievalModes([{ retrievalMode: 'api_plain', sourceType: 'official_api' }, {}]).length, 1);
});
