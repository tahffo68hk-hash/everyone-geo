import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  aggregateRunStatuses,
  isTerminalRun,
  canSettleRun,
  runJobSchema,
  runResultSchema,
  jobIdForRun,
  QUEUE_NAME,
  JOB_NAME,
  MAX_RUN_ATTEMPTS,
} from '../src/index';

test('QUEUE_NAMES / JOB_NAMES 常量固定', () => {
  assert.equal(QUEUE_NAME, 'monitor-runs');
  assert.equal(JOB_NAME, 'execute-run');
  assert.equal(MAX_RUN_ATTEMPTS, 3);
});

test('runJobSchema 校验：仅接受单字段 uuid runId（严格对象）', () => {
  const uuid = '123e4567-e89b-12d3-a456-426614174000';
  assert.deepEqual(runJobSchema.parse({ runId: uuid }), { runId: uuid });
  // 多余字段被拒绝（strict）
  assert.throws(() => runJobSchema.parse({ runId: uuid, extra: 1 }));
  // 非 uuid 被拒绝
  assert.throws(() => runJobSchema.parse({ runId: 'not-a-uuid' }));
  // 缺字段被拒绝
  assert.throws(() => runJobSchema.parse({}));
  // 数组/null 被拒绝
  assert.throws(() => runJobSchema.parse([{ runId: uuid }]));
  assert.throws(() => runJobSchema.parse(null));
});

test('runResultSchema 校验：mock/deepseek/qwen provider + text + durationMs', () => {
  const ok = { provider: 'mock', text: 'hello', durationMs: 123 };
  assert.deepEqual(runResultSchema.parse(ok), ok);
  // M5/M6D: deepseek & qwen are supported provider contracts; unknown providers stay rejected.
  assert.deepEqual(runResultSchema.parse({ provider: 'deepseek', text: 'x', durationMs: 1 }), { provider: 'deepseek', text: 'x', durationMs: 1 });
  assert.deepEqual(runResultSchema.parse({ provider: 'qwen', text: 'x', durationMs: 1 }), { provider: 'qwen', text: 'x', durationMs: 1 });
  assert.throws(() => runResultSchema.parse({ provider: 'openai', text: 'x', durationMs: 1 }));
  assert.throws(() => runResultSchema.parse({ provider: 'mock', durationMs: 1 }));
  assert.throws(() => runResultSchema.parse({ provider: 'mock', text: 'x', durationMs: -1 }));
});

test('jobIdForRun 确定性且校验 runId', () => {
  const uuid = '123e4567-e89b-12d3-a456-426614174000';
  assert.equal(jobIdForRun(uuid), `run-${uuid}`);
  assert.equal(jobIdForRun(uuid), jobIdForRun(uuid)); // 幂等稳定
  assert.throws(() => jobIdForRun('bad'));
});

test('isTerminalRun：SUCCEEDED/FAILED/CANCELLED 为终态', () => {
  assert.ok(isTerminalRun('SUCCEEDED'));
  assert.ok(isTerminalRun('FAILED'));
  assert.ok(isTerminalRun('CANCELLED'));
  assert.ok(!isTerminalRun('PENDING'));
  assert.ok(!isTerminalRun('QUEUED'));
  assert.ok(!isTerminalRun('RUNNING'));
});

test('aggregateRunStatuses：空任务 → PENDING', () => {
  const r = aggregateRunStatuses([]);
  assert.equal(r.status, 'PENDING');
  assert.equal(r.totalRuns, 0);
});

test('aggregateRunStatuses：全部成功 → SUCCEEDED', () => {
  const r = aggregateRunStatuses(['SUCCEEDED', 'SUCCEEDED', 'SUCCEEDED']);
  assert.equal(r.status, 'SUCCEEDED');
  assert.equal(r.completedRuns, 3);
  assert.equal(r.failedRuns, 0);
});

test('aggregateRunStatuses：全部失败 → FAILED', () => {
  const r = aggregateRunStatuses(['FAILED', 'FAILED']);
  assert.equal(r.status, 'FAILED');
  assert.equal(r.failedRuns, 2);
});

test('aggregateRunStatuses：全部取消 → CANCELLED', () => {
  const r = aggregateRunStatuses(['CANCELLED', 'CANCELLED']);
  assert.equal(r.status, 'CANCELLED');
});

test('aggregateRunStatuses：部分失败 → PARTIAL', () => {
  const r = aggregateRunStatuses(['SUCCEEDED', 'FAILED', 'SUCCEEDED', 'FAILED']);
  assert.equal(r.status, 'PARTIAL');
  assert.equal(r.completedRuns, 2);
  assert.equal(r.failedRuns, 2);
});

test('aggregateRunStatuses：有 RUNNING 未完成 → RUNNING', () => {
  const r = aggregateRunStatuses(['SUCCEEDED', 'RUNNING', 'PENDING']);
  assert.equal(r.status, 'RUNNING');
});

test('aggregateRunStatuses：全部 QUEUED → QUEUED', () => {
  const r = aggregateRunStatuses(['QUEUED', 'QUEUED']);
  assert.equal(r.status, 'QUEUED');
});

test('aggregateRunStatuses：PENDING + QUEUED 混合 → QUEUED', () => {
  const r = aggregateRunStatuses(['PENDING', 'QUEUED']);
  assert.equal(r.status, 'QUEUED');
});

test('aggregateRunStatuses：部分完成且有未完成 → RUNNING', () => {
  const r = aggregateRunStatuses(['SUCCEEDED', 'FAILED', 'PENDING', 'QUEUED']);
  assert.equal(r.status, 'RUNNING');
});

test('canSettleRun：仅 RUNNING 且 token 匹配可结算', () => {
  assert.ok(canSettleRun({ status: 'RUNNING', executionToken: 'tok-1' }, 'tok-1'));
  assert.ok(!canSettleRun({ status: 'RUNNING', executionToken: null }, 'tok-1'));
  assert.ok(!canSettleRun({ status: 'SUCCEEDED', executionToken: 'tok-1' }, 'tok-1'));
  assert.ok(!canSettleRun({ status: 'RUNNING', executionToken: 'tok-1' }, 'tok-2'));
});
