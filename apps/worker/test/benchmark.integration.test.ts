/**
 * M6A Benchmark worker 集成测试（真实 PostgreSQL geo_test + 真实 Redis）。
 * 硬保护：顶层加载 test-env.cjs 强制 geo_test。
 *
 * 目标：证明 Benchmark Run 编排出的 MonitorTask/Run 与普通监测任务完全同构 ——
 * 由真实 Worker processor 消费后走完 PENDING → SUCCEEDED → Evidence → Analysis 全链，
 * 不创建第二套 Evidence 系统。
 */
import "../../../packages/database/scripts/test-env.cjs";
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import {
  createRunQueue, dispatchPendingRuns, jobIdForRun,
  type RunQueue,
} from "@geo/queue";
import { createRunProcessor } from "../src/processor";

let queue: RunQueue;
let fixture: {
  organizationId: string;
  projectId: string;
  suiteId: string;
  engineId: string;
  benchmarkRunId: string;
  taskId: string;
  runId: string;
};

before(async () => {
  queue = createRunQueue();
  const suffix = randomUUID();
  const user = await prisma.user.create({ data: { email: `bench-w-${suffix}@m6w.test`, name: "Bench W" } });
  const organization = await prisma.organization.create({ data: { name: `Bench W Org ${suffix}`, slug: `bench-w-org-${suffix}` } });
  await prisma.organizationMember.create({ data: { userId: user.id, organizationId: organization.id, role: "OWNER" } });
  const project = await prisma.project.create({ data: { organizationId: organization.id, name: `Bench W Project ${suffix}` } });
  await prisma.brand.create({
    data: { projectId: project.id, name: "ProjectMentor", aliases: ["Project Mentor"], website: null, description: null, products: [] },
  });
  const engine = await prisma.engine.create({
    data: { key: `bench-w-mock-${suffix}`, name: "Bench W mock", provider: "mock", config: { delayMs: 5, scenario: "first" } },
  });
  const suite = await prisma.benchmarkSuite.create({ data: { projectId: project.id, name: `Bench W Suite ${suffix}`, version: "1" } });
  // 1 条 benchmark query + 1 条 PAUSED 镜像 Query
  const mirror = await prisma.query.create({ data: { projectId: project.id, text: "推荐适合大学生比赛的 AI 工具", source: "IMPORTED", status: "PAUSED" } });
  await prisma.benchmarkQuery.create({
    data: { suiteId: suite.id, sortOrder: 0, queryText: mirror.text, category: "recommendation", intent: "direct recommendation", projectQueryId: mirror.id },
  });
  const task = await prisma.monitorTask.create({
    data: {
      organizationId: organization.id, projectId: project.id, totalRuns: 1,
      runs: { create: [{ queryId: mirror.id, engineId: engine.id }] },
    },
    include: { runs: true },
  });
  const benchmarkRun = await prisma.benchmarkRun.create({
    data: {
      organizationId: organization.id, projectId: project.id, suiteId: suite.id,
      suiteName: suite.name, suiteVersion: "1", runType: "DEMO", provider: "mock",
      engineId: engine.id, monitorTaskId: task.id, plannedRuns: 1, status: "PENDING",
    },
  });
  fixture = {
    organizationId: organization.id, projectId: project.id, suiteId: suite.id,
    engineId: engine.id, benchmarkRunId: benchmarkRun.id, taskId: task.id, runId: task.runs[0].id,
  };
});

after(async () => {
  try {
    await prisma.benchmarkRun.deleteMany({ where: { id: fixture.benchmarkRunId } });
    await prisma.monitorTask.deleteMany({ where: { projectId: fixture.projectId } });
    await prisma.engine.deleteMany({ where: { id: fixture.engineId } });
    await prisma.project.deleteMany({ where: { id: fixture.projectId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: fixture.organizationId } });
    await prisma.organization.deleteMany({ where: { id: fixture.organizationId } });
    await prisma.user.deleteMany({ where: { email: { contains: "@m6w.test" } } });
  } finally {
    await queue.close();
    await prisma.$disconnect();
  }
});

test("Benchmark Run 的 Run 经真实 Worker processor：SUCCEEDED → Evidence → Analysis", async () => {
  await dispatchPendingRuns(prisma, queue);
  const job = await queue.getJob(jobIdForRun(fixture.runId));
  assert.ok(job, "job should exist after dispatch");
  const processor = createRunProcessor(prisma, { timeoutMs: 3000, logger: () => {} });
  await processor(job as never);

  const run = await prisma.run.findUniqueOrThrow({
    where: { id: fixture.runId },
    include: { evidence: { include: { analyses: { include: { mentions: true } } } }, monitorTask: true },
  });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.analysisStatus, "SUCCEEDED");
  assert.ok(run.evidence, "evidence must be written by the standard pipeline");
  assert.equal(run.evidence.queryText, "推荐适合大学生比赛的 AI 工具");
  assert.equal(run.evidence.sourceType, "mock");
  const analysis = run.evidence.analyses[0];
  assert.ok(analysis, "analysis must exist");
  assert.equal(analysis.analysisVersion, "m4-rule-v1");
  assert.equal(analysis.brandMentioned, true);
  assert.equal(analysis.recommended, true);
  assert.ok(analysis.mentions.some(mention => mention.entityType === "brand" && mention.canonicalName === "ProjectMentor"));
  assert.equal(run.monitorTask.completedRuns, 1);
  assert.equal(run.monitorTask.status, "SUCCEEDED");
});

test("历史 BenchmarkRun 版本快照不随 Suite 编辑改变", async () => {
  const beforeSnapshot = await prisma.benchmarkRun.findUniqueOrThrow({ where: { id: fixture.benchmarkRunId } });
  // 模拟未来对 Suite 的编辑（改名 + 新增查询），历史 Run 快照必须不受影响
  await prisma.benchmarkSuite.update({ where: { id: fixture.suiteId }, data: { name: "Edited Suite Name" } });
  const afterSnapshot = await prisma.benchmarkRun.findUniqueOrThrow({ where: { id: fixture.benchmarkRunId } });
  assert.equal(afterSnapshot.suiteName, beforeSnapshot.suiteName);
  assert.equal(afterSnapshot.suiteVersion, beforeSnapshot.suiteVersion);
  assert.notEqual(afterSnapshot.suiteName, "Edited Suite Name");
});

test("M8C-R0：AWAITING_MANUAL_INPUT Run 永不被 dispatch（0 provider 调用隔离）", async () => {
  // 额外创建一条 manual run（engine provider=manual —— worker registry 无此 provider）
  const suffix = randomUUID();
  const manualEngine = await prisma.engine.create({
    data: { key: `bench-w-manual-${suffix}`, name: "人工 Web UI", provider: "manual", config: { manual: true } },
  });
  const manualMirror = await prisma.query.create({ data: { projectId: fixture.projectId, text: "适合小型销售团队的 CRM 有哪些？", source: "IMPORTED", status: "PAUSED" } });
  const manualTask = await prisma.monitorTask.create({
    data: {
      organizationId: fixture.organizationId, projectId: fixture.projectId, totalRuns: 1,
      runs: { create: [{ queryId: manualMirror.id, engineId: manualEngine.id, status: "AWAITING_MANUAL_INPUT" }] },
    },
    include: { runs: true },
  });
  const manualRunId = manualTask.runs[0].id;
  try {
    // 真实 dispatch：worker 轮询只会捞 PENDING/QUEUED —— manual run 必须无 job。
    await dispatchPendingRuns(prisma, queue);
    const job = await queue.getJob(jobIdForRun(manualRunId));
    assert.equal(job ?? null, null, "manual run 不得产生 worker job");
    const run = await prisma.run.findUniqueOrThrow({ where: { id: manualRunId } });
    assert.equal(run.status, "AWAITING_MANUAL_INPUT");
    assert.equal(run.attempt, 0);
    // manual engine provider 不被 worker registry 解析（双保险）
    const { createProviderRegistry } = await import("../src/processor");
    const resolved = createProviderRegistry().resolve(manualEngine.provider);
    assert.equal(resolved, undefined, "manual provider 不应被解析为任何 adapter");
  } finally {
    await prisma.run.deleteMany({ where: { id: manualRunId } });
    await prisma.monitorTask.deleteMany({ where: { id: manualTask.id } });
    await prisma.engine.deleteMany({ where: { id: manualEngine.id } });
    await prisma.query.deleteMany({ where: { id: manualMirror.id } });
  }
});
