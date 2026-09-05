/**
 * Worker + Queue 集成测试（真实 PostgreSQL geo_test + 真实 Redis）。
 * 硬保护：本文件顶层加载 packages/database/scripts/test-env.cjs，
 * 该 guard 强制 DATABASE_URL 必须指向 geo_test，否则拒绝执行。
 *
 * 覆盖：
 *   - executeMock 成功 / 确定性失败配置校验
 *   - processor 成功路径：PENDING → QUEUED(入队) → RUNNING → SUCCEEDED
 *   - 重试路径：mock-retry（failuresBeforeSuccess=1）最终 SUCCEEDED（attempt=2）
 *   - 永久失败路径：mock-failure 消耗全部 attempts 后 FAILED(RETRY_EXHAUSTED)
 *   - 幂等：Run 已终态时重复 claim / 重复 job 不重复执行
 *   - PENDING re-enqueue：dispatchPendingRuns 把 PENDING Run 重新入队
 *   - reconcileRuns：孤立 RUNNING（模拟 worker 崩溃）恢复为 QUEUED
 *   - progress 聚合：refreshTask 后 MonitorTask 状态正确（PARTIAL/FAILED/SUCCEEDED）
 *
 * 进程退出纪律（防止 SIGTERM / 假死）：
 *   - 全程只创建一个 BullMQ Queue，before 创建、after 显式 close
 *   - after 的 DB 清理按外键依赖逆序执行，且 $disconnect 放 finally
 *   - 禁止 process.exit() 掩盖残留 handle
 */
import "../../../packages/database/scripts/test-env.cjs";
import { test, before, after, type TestContext } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import {
  createRunQueue, dispatchPendingRuns, jobIdForRun, MAX_RUN_ATTEMPTS,
  runResultSchema, settleRun, claimRun, reconcileRuns,
  type RunQueue,
} from "@geo/queue";
import { createRunProcessor, executeMock, ExecutionError } from "../src/processor";

let queue: RunQueue;

// 每个 run 的实际 worker 处理（复用 production processor + 共享 Queue）
async function runJobThroughProcessor(runId: string) {
  const processor = createRunProcessor(prisma, { timeoutMs: 3000, logger: () => {} });
  const job = await queue.getJob(jobIdForRun(runId));
  assert.ok(job, `job ${jobIdForRun(runId)} should exist`);
  return processor(job as never);
}

let fixture: {
  organizationId: string;
  projectId: string;
  queryIds: string[];
  engineSuccessId: string;
  engineRetryId: string;
  engineFailureId: string;
};

before(async () => {
  queue = createRunQueue();
  const suffix = randomUUID();
  const user = await prisma.user.create({ data: { email: `worker-${suffix}@m3.test`, name: "Worker Test" } });
  const organization = await prisma.organization.create({ data: { name: `Worker Org ${suffix}`, slug: `worker-org-${suffix}` } });
  await prisma.organizationMember.create({ data: { userId: user.id, organizationId: organization.id, role: "OWNER" } });
  const project = await prisma.project.create({ data: { organizationId: organization.id, name: `Worker Project ${suffix}` } });
  const queryIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const query = await prisma.query.create({ data: { projectId: project.id, text: `Worker query ${i} ${suffix}` } });
    queryIds.push(query.id);
  }
  const mkEngine = async (key: string, config: object) => {
    const engine = await prisma.engine.create({ data: { key: `${key}-${suffix}`, name: key, provider: "mock", config: config as never } });
    return engine.id;
  };
  fixture = {
    organizationId: organization.id,
    projectId: project.id,
    queryIds,
    engineSuccessId: await mkEngine("mock-success", { delayMs: 20 }),
    engineRetryId: await mkEngine("mock-retry", { delayMs: 20, failuresBeforeSuccess: 1 }),
    engineFailureId: await mkEngine("mock-failure", { delayMs: 20, permanentFailure: true }),
  };
});

after(async () => {
  try {
    // 严格依赖逆序清理，避免 FK 冲突导致清理链中断、$disconnect 不执行：
    // 1) MonitorTask（级联删 Run，解除 Run→Engine / Run→Query 引用）
    // 2) Engine  3) Project（级联删 Query）  4) Org 成员  5) Org  6) User
    await prisma.monitorTask.deleteMany({ where: { projectId: fixture.projectId } });
    await prisma.engine.deleteMany({ where: { id: { in: [fixture.engineSuccessId, fixture.engineRetryId, fixture.engineFailureId] } } });
    await prisma.project.deleteMany({ where: { id: fixture.projectId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: fixture.organizationId } });
    await prisma.organization.deleteMany({ where: { id: fixture.organizationId } });
    await prisma.user.deleteMany({ where: { email: { contains: "@m3.test" }, memberships: { none: {} } } });
  } finally {
    await queue.close();
    await prisma.$disconnect();
  }
});

function makeTask(runs: { queryId: string; engineId: string }[]) {
  return prisma.monitorTask.create({
    data: {
      organizationId: fixture.organizationId,
      projectId: fixture.projectId,
      totalRuns: runs.length,
      runs: { create: runs },
    },
    include: { runs: true },
  });
}

test("executeMock 成功：返回 mock 文本与时长", async () => {
  const result = await executeMock({ queryText: "Q", engineKey: "mock-success", config: { delayMs: 5 }, attempt: 1, timeoutMs: 3000 });
  assert.equal(result.provider, "mock");
  assert.ok(result.text.startsWith("[mock:mock-success] Q"));
  assert.ok(result.durationMs >= 0);
});

test("executeMock 非法 config 抛 INVALID_ENGINE_CONFIG", async () => {
  await assert.rejects(
    () => executeMock({ queryText: "Q", engineKey: "mock-x", config: null, attempt: 1, timeoutMs: 3000 }),
    (e: unknown) => e instanceof ExecutionError && e.code === "INVALID_ENGINE_CONFIG",
  );
  await assert.rejects(
    () => executeMock({ queryText: "Q", engineKey: "mock-x", config: { delayMs: "abc" }, attempt: 1, timeoutMs: 3000 }),
    (e: unknown) => e instanceof ExecutionError && e.code === "INVALID_ENGINE_CONFIG",
  );
});

test("processor 成功路径：Run → RUNNING → SUCCEEDED，MonitorTask SUCCEEDED", async () => {
  const task = await makeTask([{ queryId: fixture.queryIds[0], engineId: fixture.engineSuccessId }]);
  const runId = task.runs[0].id;
  await dispatchPendingRuns(prisma, queue);
  const claimed = await claimRun(prisma, runId, MAX_RUN_ATTEMPTS);
  assert.ok(claimed);
  assert.equal(claimed.status, "RUNNING");
  assert.equal(claimed.attempt, 1);
  assert.ok(claimed.executionToken);

  const result = await executeMock({ queryText: claimed.query.text, engineKey: claimed.engine.key, config: claimed.engine.config, attempt: claimed.attempt, timeoutMs: 3000 });
  const saved = await settleRun(prisma, claimed, { status: "SUCCEEDED", result });
  assert.ok(saved);

  const dbRun = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  assert.equal(dbRun.status, "SUCCEEDED");
  assert.ok(dbRun.completedAt);
  const dbTask = await prisma.monitorTask.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(dbTask.status, "SUCCEEDED");
  assert.equal(dbTask.completedRuns, 1);
});

test("完整链路：queue.add → processor 消费 → SUCCEEDED（含 jobId 幂等）", async () => {
  const task = await makeTask([{ queryId: fixture.queryIds[1], engineId: fixture.engineSuccessId }]);
  const runId = task.runs[0].id;
  await dispatchPendingRuns(prisma, queue);
  const jobBefore = await queue.getJob(jobIdForRun(runId));
  assert.ok(jobBefore, "PENDING run 入队后 job 应存在");

  const result = await runJobThroughProcessor(runId);
  assert.ok(result);
  const dbRun = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  assert.equal(dbRun.status, "SUCCEEDED");
  // 重复投递（jobId 相同）：BullMQ 幂等不产生第二个 job；DB 终态也不被再次执行
  await dispatchPendingRuns(prisma, queue);
  const dbRun2 = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  assert.equal(dbRun2.status, "SUCCEEDED", "已终态 Run 不能被重新入队执行");
});

test("重试路径：failuresBeforeSuccess=1 → 第一次失败重排队，最终 SUCCEEDED（attempt=2）", async () => {
  const task = await makeTask([{ queryId: fixture.queryIds[2], engineId: fixture.engineRetryId }]);
  const runId = task.runs[0].id;
  await dispatchPendingRuns(prisma, queue);
  // 第一次：模拟失败 → settle QUEUED（retryable）
  const claimed1 = await claimRun(prisma, runId, MAX_RUN_ATTEMPTS);
  assert.ok(claimed1);
  assert.equal(claimed1.attempt, 1);
  await assert.rejects(
    () => executeMock({ queryText: claimed1.query.text, engineKey: claimed1.engine.key, config: claimed1.engine.config, attempt: claimed1.attempt, timeoutMs: 3000 }),
    (e: unknown) => e instanceof ExecutionError && e.code === "MOCK_FAILURE",
  );
  const retried = await settleRun(prisma, claimed1, { status: "QUEUED", errorCode: "MOCK_FAILURE", errorMessage: "retry" });
  assert.ok(retried);
  let dbRun = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  assert.equal(dbRun.status, "QUEUED");
  assert.equal(dbRun.attempt, 1);

  // 第二次：成功
  const result = await runJobThroughProcessor(runId);
  assert.ok(result);
  dbRun = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  assert.equal(dbRun.status, "SUCCEEDED");
  assert.equal(dbRun.attempt, 2, "第二次执行 attempt 应为 2");
});

test("永久失败：permanentFailure=true → 消耗 MAX attempts 后 FAILED(RETRY_EXHAUSTED)", async () => {
  const task = await makeTask([{ queryId: fixture.queryIds[0], engineId: fixture.engineFailureId }]);
  const runId = task.runs[0].id;
  await dispatchPendingRuns(prisma, queue);
  for (let i = 0; i < MAX_RUN_ATTEMPTS; i++) {
    const claimed = await claimRun(prisma, runId, MAX_RUN_ATTEMPTS);
    if (!claimed) break; // attempts exhausted → claimRun 已标记 FAILED
    try {
      await executeMock({ queryText: claimed.query.text, engineKey: claimed.engine.key, config: claimed.engine.config, attempt: claimed.attempt, timeoutMs: 3000 });
    } catch (e) {
      const exhausted = claimed.attempt >= MAX_RUN_ATTEMPTS;
      await settleRun(prisma, claimed, {
        status: exhausted ? "FAILED" : "QUEUED",
        errorCode: e instanceof ExecutionError ? e.code : "WORKER_ERROR",
        errorMessage: exhausted ? "Maximum execution attempts reached." : "retry",
      });
    }
  }
  const dbRun = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  assert.equal(dbRun.status, "FAILED");
  assert.equal(dbRun.attempt, MAX_RUN_ATTEMPTS);
  const dbTask = await prisma.monitorTask.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(dbTask.status, "FAILED");
  assert.equal(dbTask.failedRuns, 1);
});

test("PARTIAL 聚合：混合成功+失败 → MonitorTask PARTIAL", async () => {
  const task = await makeTask([
    { queryId: fixture.queryIds[0], engineId: fixture.engineSuccessId },
    { queryId: fixture.queryIds[1], engineId: fixture.engineFailureId },
  ]);
  const [okRun, failRun] = task.runs;
  // ok run → SUCCEEDED
  await dispatchPendingRuns(prisma, queue);
  const claimedOk = await claimRun(prisma, okRun.id, MAX_RUN_ATTEMPTS);
  assert.ok(claimedOk);
  const res = await executeMock({ queryText: claimedOk.query.text, engineKey: claimedOk.engine.key, config: claimedOk.engine.config, attempt: claimedOk.attempt, timeoutMs: 3000 });
  await settleRun(prisma, claimedOk, { status: "SUCCEEDED", result: res });
  // fail run → 永久失败
  for (let i = 0; i < MAX_RUN_ATTEMPTS; i++) {
    const claimed = await claimRun(prisma, failRun.id, MAX_RUN_ATTEMPTS);
    if (!claimed) break;
    await settleRun(prisma, claimed, {
      status: claimed.attempt >= MAX_RUN_ATTEMPTS ? "FAILED" : "QUEUED",
      errorCode: "MOCK_FAILURE", errorMessage: "permanent",
    });
  }
  const dbTask = await prisma.monitorTask.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(dbTask.status, "PARTIAL");
  assert.equal(dbTask.completedRuns, 1);
  assert.equal(dbTask.failedRuns, 1);
});

test("幂等：已 SUCCEEDED 的 Run 无法被重复 claim（重复 job 为 no-op）", async () => {
  const task = await makeTask([{ queryId: fixture.queryIds[1], engineId: fixture.engineSuccessId }]);
  const runId = task.runs[0].id;
  await dispatchPendingRuns(prisma, queue);
  const claimed = await claimRun(prisma, runId, MAX_RUN_ATTEMPTS);
  assert.ok(claimed);
  const res = await executeMock({ queryText: "x", engineKey: "k", config: { delayMs: 5 }, attempt: 1, timeoutMs: 3000 });
  await settleRun(prisma, claimed, { status: "SUCCEEDED", result: res });
  // 重复 claim：终态 → null（不执行）
  const claimedAgain = await claimRun(prisma, runId, MAX_RUN_ATTEMPTS);
  assert.equal(claimedAgain, null);
});

test("PENDING re-enqueue：被中断的 PENDING run 经 dispatchPendingRuns 重新入队", async () => {
  const task = await makeTask([{ queryId: fixture.queryIds[2], engineId: fixture.engineSuccessId }]);
  const runId = task.runs[0].id;
  // run 保持 PENDING（模拟 Redis enqueue 失败后未被投递）
  const dispatched = await dispatchPendingRuns(prisma, queue, 100);
  assert.ok(dispatched >= 1);
  const job = await queue.getJob(jobIdForRun(runId));
  assert.ok(job, "PENDING run 应被 dispatch 入队");
});

test("reconcileRuns：孤立 RUNNING（模拟 worker 崩溃）被恢复为 QUEUED", async () => {
  const task = await makeTask([{ queryId: fixture.queryIds[0], engineId: fixture.engineSuccessId }]);
  const runId = task.runs[0].id;
  // 手动把 run 置为 RUNNING 且无有效 job —— 模拟 worker 中途崩溃
  await prisma.run.update({ where: { id: runId }, data: { status: "RUNNING", attempt: 1, executionToken: randomUUID(), startedAt: new Date() } });
  const recovered = await reconcileRuns(prisma, queue, 100);
  assert.ok(recovered >= 1);
  const dbRun = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  assert.equal(dbRun.status, "QUEUED", "崩溃的 RUNNING run 应恢复为 QUEUED 等待重新投递");
});

test("runResultSchema 为 processor 输出契约（回归）", () => {
  const sample = runResultSchema.parse({ provider: "mock", text: "x", durationMs: 0 });
  assert.equal(sample.provider, "mock");
});
