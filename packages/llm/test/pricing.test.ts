import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { calculateEstimatedCost } from '../src/pricing';

test('calculateEstimatedCost', async (t) => {
  await t.test('Known model returns correct cost', () => {
    const cost = calculateEstimatedCost('deepseek-chat', 1000, 1000);
    assert.equal(cost, 0.00042);
  });

  await t.test('Unknown model returns null', () => {
    assert.equal(calculateEstimatedCost('unknown-model', 100, 100), null);
  });

  await t.test('Null tokens returns null', () => {
    assert.equal(calculateEstimatedCost('deepseek-chat', null, 100), null);
    assert.equal(calculateEstimatedCost('deepseek-chat', 100, null), null);
    assert.equal(calculateEstimatedCost('deepseek-chat', null, null), null);
  });

  await t.test('Zero tokens returns 0', () => {
    assert.equal(calculateEstimatedCost('deepseek-chat', 0, 0), 0);
  });

  await t.test('Mock models return $0', () => {
    assert.equal(calculateEstimatedCost('mock-ai-engine', 1000, 1000), 0);
  });

  await t.test('geolens-mock returns $0', () => {
    assert.equal(calculateEstimatedCost('geolens-mock', 1000, 1000), 0);
  });
});
