/**
 * M4 Evidence/Analysis 集成测试（真实 PostgreSQL geo_test + 真实 Redis + 真实 processor）。
 * 硬保护：顶层加载 test-env.cjs（强制 geo_test）。
 *
 * 覆盖任务书 M4 核心约束：
 *   - SUCCEEDED Run 原子写入 Evidence（同事务，含 entitySnapshot / sourceType=mock）
 *   - Evidence 不可变：DB trigger 拒绝 UPDATE（Raw Evidence 不能被 Analysis 覆盖）
 *   - processor 成功路径随后写出 Analysis（brandMentioned / mentionPosition / citations）
 *   - 重复投递不重复 Analysis（幂等 + 版本唯一约束）
 *   - 分析失败：Raw Evidence 保留，Run 仍 SUCCEEDED，仅 analysisStatus=FAILED
 *   - recoverAnalyses：把 FAILED/PENDING 且 attempts<3 的已成功 Run 补分析
 *
 * 进程退出纪律：单 Queue before 创建 / after close；DB 清理逆序 + finally disconnect。
 */
import "../../../packages/database/scripts/test-env.cjs";
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import { createRunQueue, dispatchPendingRuns, jobIdForRun, MAX_RUN_ATTEMPTS, type RunQueue } from "@geo/queue";
import { createRunProcessor } from "../src/processor";
import { analyzeEvidence, recoverAnalyses, snapshotEntities } from "../src/evidence";

let queue: RunQueue;
let fixture: {
  organizationId: string;
  projectId: string;
  brandId: string;
  competitorIds: string[];
  queryIds: string[];
  engineId: string; // scenario=first: 品牌第一推荐 + competitor
  engineNegativeId: string; // scenario=negative: 负面 + 不推荐品牌
};

async function runJobThroughProcessor(runId: string) {
  const processor = createRunProcessor(prisma, { timeoutMs: 3000, logger: () => {} });
  const job = await queue.getJob(jobIdForRun(runId));
  assert.ok(job, `job ${jobIdForRun(runId)} should exist`);
  return processor(job as never);
}

before(async () => {
  queue = createRunQueue();
  const suffix = randomUUID().slice(0, 12);
  const user = await prisma.user.create({ data: { email: `evidence-${suffix}@m4.test`, name: "Evidence Test" } });
  const organization = await prisma.organization.create({ data: { name: `Evidence Org ${suffix}`, slug: `evidence-org-${suffix}` } });
  await prisma.organizationMember.create({ data: { userId: user.id, organizationId: organization.id, role: "OWNER" } });
  const project = await prisma.project.create({ data: { organizationId: organization.id, name: `Evidence Project ${suffix}` } });
  const brand = await prisma.brand.create({
    data: { projectId: project.id, name: "ProjectMentor", aliases: ["Project Mentor", "项目导师", "PMentor"] },
  });
  const mkCompetitor = async (name: string, aliases: string[]) => {
    const row = await prisma.competitor.create({ data: { projectId: project.id, name, aliases } });
    return row.id;
  };
  const competitorIds = [
    await mkCompetitor("Competitor A", ["CompA"]),
    await mkCompetitor("Competitor B", ["CompB"]),
    await mkCompetitor("Competitor C", ["CompC"]),
  ];
  const queryIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    const query = await prisma.query.create({ data: { projectId: project.id, text: `推荐 AI 项目工具 ${suffix} ${i}` } });
    queryIds.push(query.id);
  }
  const engine = await prisma.engine.create({ data: { key: `m4-first-${suffix}`, name: "M4 First", provider: "mock", config: { delayMs: 20, scenario: "first" } as never } });
  const engineNegative = await prisma.engine.create({ data: { key: `m4-negative-${suffix}`, name: "M4 Negative", provider: "mock", config: { delayMs: 20, scenario: "negative" } as never } });
  fixture = { organizationId: organization.id, projectId: project.id, brandId: brand.id, competitorIds, queryIds, engineId: engine.id, engineNegativeId: engineNegative.id };
});

after(async () => {
  try {
    await prisma.monitorTask.deleteMany({ where: { projectId: fixture.projectId } });
    await prisma.engine.deleteMany({ where: { id: { in: [fixture.engineId, fixture.engineNegativeId] } } });
    await prisma.project.deleteMany({ where: { id: fixture.projectId } }); // 级联 Brand/Competitor/Query
    await prisma.organizationMember.deleteMany({ where: { organizationId: fixture.organizationId } });
    await prisma.organization.deleteMany({ where: { id: fixture.organizationId } });
    await prisma.user.deleteMany({ where: { email: { contains: "@m4.test" }, memberships: { none: {} } } });
  } finally {
    await queue.close();
    await prisma.$disconnect();
  }
});

test("snapshotEntities：读取项目品牌(首个)+竞品，保持稳定排序", async () => {
  const entities = await snapshotEntities(prisma, fixture.projectId);
  assert.equal(entities.filter((e) => e.entityType === "brand").length, 1);
  const brand = entities.find((e) => e.entityType === "brand");
  assert.equal(brand?.canonicalName, "ProjectMentor");
  assert.ok(brand?.aliases.includes("项目导师"));
  const competitors = entities.filter((e) => e.entityType === "competitor");
  assert.equal(competitors.length, 3);
});

test("processor 成功 → Evidence 原子写入 + Analysis(brand 第一推荐, position=1)", async () => {
  const task = await prisma.monitorTask.create({
    data: { organizationId: fixture.organizationId, projectId: fixture.projectId, totalRuns: 1, runs: { create: [{ queryId: fixture.queryIds[0], engineId: fixture.engineId }] } },
    include: { runs: true },
  });
  const runId = task.runs[0].id;
  await dispatchPendingRuns(prisma, queue);
  const result = await runJobThroughProcessor(runId);
  assert.ok(result);

  const dbRun = await prisma.run.findUniqueOrThrow({ where: { id: runId }, include: { evidence: { include: { analyses: { include: { mentions: true, citations: true } } } } } });
  assert.equal(dbRun.status, "SUCCEEDED");
  assert.equal(dbRun.analysisStatus, "SUCCEEDED");
  assert.ok(dbRun.evidence, "SUCCEEDED Run 必须写 Evidence");
  assert.equal(dbRun.evidence.runId, runId);
  assert.equal(dbRun.evidence.provider, "mock");
  assert.equal(dbRun.evidence.sourceType, "mock");
  const query = await prisma.query.findUniqueOrThrow({ where: { id: task.runs[0].queryId } });
  assert.equal(dbRun.evidence.queryText, query.text);
  assert.ok(dbRun.evidence.rawResponse.includes("ProjectMentor"), "mock scenario=first 文案应含品牌");
  const snap = dbRun.evidence.entitySnapshot as { entityType: string; canonicalName: string }[];
  assert.ok(Array.isArray(snap) && snap.length >= 4, "entitySnapshot 应含 brand + 3 competitors");
  assert.equal(dbRun.evidence.analyses.length, 1);
  const analysis = dbRun.evidence.analyses[0];
  assert.equal(analysis.analysisVersion, "m4-rule-v1");
  assert.equal(analysis.brandMentioned, true);
  assert.equal(analysis.mentionPosition, 1, "scenario=first 品牌应第一推荐");
  assert.equal(analysis.recommended, true);
  assert.equal(analysis.sentiment, "positive");
  assert.ok(analysis.mentions.some((m) => m.entityType === "brand" && m.entityId === fixture.brandId));
  assert.ok(analysis.mentions.length >= 2, "应有 brand + competitor 提及");
  assert.equal(new Set(analysis.mentions.map((m) => m.position)).size, analysis.mentions.length, "position 连续且唯一");
});

test("Evidence 不可变：DB trigger 拒绝 UPDATE（rawResponse 不可覆盖）", async () => {
  const task = await prisma.monitorTask.create({
    data: { organizationId: fixture.organizationId, projectId: fixture.projectId, totalRuns: 1, runs: { create: [{ queryId: fixture.queryIds[1], engineId: fixture.engineId }] } },
    include: { runs: true },
  });
  const runId = task.runs[0].id;
  await dispatchPendingRuns(prisma, queue);
  await runJobThroughProcessor(runId);
  const evidence = await prisma.evidence.findUniqueOrThrow({ where: { runId } });
  await assert.rejects(
    () => prisma.evidence.update({ where: { id: evidence.id }, data: { rawResponse: "hacked" } }),
    /immutable|23514|Raw Evidence/i,
  );
  const after = await prisma.evidence.findUniqueOrThrow({ where: { id: evidence.id } });
  assert.ok(after.rawResponse.includes("ProjectMentor"), "UPDATE 被拒后 rawResponse 必须保持原样");
});

test("负面 scenario：分析为 negative + 不推荐，Evidence 与 Analysis 依旧成对", async () => {
  const task = await prisma.monitorTask.create({
    data: { organizationId: fixture.organizationId, projectId: fixture.projectId, totalRuns: 1, runs: { create: [{ queryId: fixture.queryIds[0], engineId: fixture.engineNegativeId }] } },
    include: { runs: true },
  });
  const runId = task.runs[0].id;
  await dispatchPendingRuns(prisma, queue);
  await runJobThroughProcessor(runId);
  const dbRun = await prisma.run.findUniqueOrThrow({ where: { id: runId }, include: { evidence: { include: { analyses: true } } } });
  assert.equal(dbRun.status, "SUCCEEDED");
  assert.equal(dbRun.analysisStatus, "SUCCEEDED");
  const analysis = dbRun.evidence!.analyses[0];
  assert.equal(analysis.brandMentioned, true);
  assert.equal(analysis.recommended, false, "负面描述不得判定为推荐");
  assert.equal(analysis.sentiment, "negative");
});

test("分析失败不丢 Evidence：analyzer 抛错 → Evidence 保留、Run 仍 SUCCEEDED、analysisStatus=FAILED", async () => {
  const task = await prisma.monitorTask.create({
    data: { organizationId: fixture.organizationId, projectId: fixture.projectId, totalRuns: 1, runs: { create: [{ queryId: fixture.queryIds[1], engineId: fixture.engineId }] } },
    include: { runs: true },
  });
  const runId = task.runs[0].id;
  await dispatchPendingRuns(prisma, queue);
  const processor = createRunProcessor(prisma, { timeoutMs: 3000, logger: () => {} });
  const job = await queue.getJob(jobIdForRun(runId));
  // 手动模拟：先正常消费（写 Evidence + Analysis），再把 analysisStatus 重置为 PENDING、
  // analysisAttempts=1，然后用一个必抛的 analyzer 重跑 analyzeEvidence。
  const result = await processor(job as never);
  assert.ok(result);
  await prisma.run.update({ where: { id: runId }, data: { analysisStatus: "PENDING", analysisAttempts: 1 } });
  await prisma.analysis.deleteMany({ where: { evidence: { runId } } });
  const evidence = await prisma.evidence.findUniqueOrThrow({ where: { runId } });
  const ok = await analyzeEvidence(prisma, evidence.id, { analyzer: () => { throw new Error("BOOM_ANALYZER"); } });
  assert.equal(ok, false, "分析失败返回 false");
  const dbRun = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  assert.equal(dbRun.status, "SUCCEEDED", "provider 成功不能被分析失败回滚");
  assert.equal(dbRun.analysisStatus, "FAILED");
  assert.equal(dbRun.analysisErrorCode, "ANALYSIS_FAILED");
  const kept = await prisma.evidence.findUniqueOrThrow({ where: { runId } });
  assert.ok(kept.rawResponse.includes("ProjectMentor"), "Raw Evidence 必须保留");
});

test("recoverAnalyses：把 FAILED(attempts<3) 的成功 Run 补上默认版本分析", async () => {
  // 复用上一条已 FAILED 的 run（analysisAttempts 已被失败路径 increment 到 2，仍 < 3）
  const target = await prisma.run.findFirstOrThrow({
    // Keep this assertion scoped to the fixture. The shared geo_test database
    // can contain older failed Runs, while recoverAnalyses intentionally
    // repairs only successful Runs that still have immutable Evidence.
    where: {
      status: "SUCCEEDED",
      analysisStatus: "FAILED",
      analysisAttempts: { lt: 3 },
      monitorTask: { projectId: fixture.projectId },
      evidence: { isNot: null },
    },
    orderBy: { createdAt: "desc" },
  });
  // recoverAnalyses intentionally works in bounded batches. The shared
  // geo_test database may have more than one batch of older repairable Runs,
  // so drive the poll loop until this fixture reaches its turn.
  let recovered: unknown;
  let dbRun = await prisma.run.findUniqueOrThrow({ where: { id: target.id } });
  for (let attempt = 0; attempt < 10 && dbRun.analysisStatus !== "SUCCEEDED"; attempt++) {
    recovered = await recoverAnalyses(prisma);
    dbRun = await prisma.run.findUniqueOrThrow({ where: { id: target.id } });
  }
  assert.equal(recovered, undefined, "recoverAnalyses 为同步兜底函数，无返回值");
  assert.equal(dbRun.analysisStatus, "SUCCEEDED", "recoverAnalyses 应以默认 analyzer 补分析成功");
  const analysisCount = await prisma.analysis.count({ where: { evidence: { runId: target.id } } });
  assert.equal(analysisCount, 1);
  assert.equal(dbRun.analysisErrorCode, null);
});
