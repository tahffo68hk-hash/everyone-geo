/**
 * M4 验收脚本（真实 Worker 进程端到端，PostgreSQL geo_test + 真实 Redis）。
 *
 * 顶层加载 test-env.cjs guard：强制 DATABASE_URL=geo_test，绝不触碰 geo_dev。
 *
 * 场景：
 *   [A1] 15 Runs → 15 Evidence → 15 Analysis（5 Query × 3 scenario Engine，真实 worker）
 *   [A2] Evidence 不可变：DB trigger 拒绝 UPDATE（Raw Response 不可被 Analysis 覆盖）
 *   [A3] Analysis 版本化：同 Evidence 追加 v2 成功；重放 v1 幂等不重复
 *   [A4] Metrics 对账：aggregateMetrics(真实 DB 快照) 分母/速率与几何期望一致
 *   [A5] worker restart 后 recoverAnalyses：把缺失分析的成功 Run 补齐（Evidence 不被重写）
 *
 * 退出纪律：所有 spawn 的 worker 在 finally 中被 SIGTERM；prisma.$disconnect。
 */
import "../../../packages/database/scripts/test-env.cjs";
import { strict as assert } from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { prisma } from "@geo/database";
import { createRunQueue, dispatchPendingRuns } from "@geo/queue";
import { analyzeEvidence, recoverAnalyses } from "../src/evidence";
import { aggregateMetrics, ANALYSIS_VERSION, analyzeResponse, RuleJudge, type ResponseJudge } from "@geo/core";
import { setTimeout as delay } from "node:timers/promises";

const WORKER_CWD = fileURLToPath(new URL("..", import.meta.url)); // …/apps/worker/
const children: ChildProcess[] = [];
const started = Date.now();
const log = (msg: string) => console.log(`[m4:${Math.round((Date.now() - started) / 1000)}s] ${msg}`);
const stamp = () => `${Math.round((Date.now() - started) / 1000)}s`;

function spawnWorker(label: string): ChildProcess {
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: WORKER_CWD,
    env: { ...process.env, WORKER_CONCURRENCY: "4" },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", code => log(`worker ${label} exited code=${code}`));
  children.push(child);
  log(`worker ${label} spawned pid=${child.pid}`);
  return child;
}

async function stopWorker(child: ChildProcess, label: string) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>(resolve => {
    const t = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 8000);
    child.once("exit", () => { clearTimeout(t); resolve(); });
  });
  log(`worker ${label} stopped`);
}

async function waitFor(desc: string, fn: () => Promise<boolean>, timeoutMs = 45000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) { log(`${desc} -> OK (${stamp()})`); return; }
    await delay(intervalMs);
  }
  throw new Error(`WAIT_TIMEOUT: ${desc}（${timeoutMs}ms 内未满足）`);
}

async function taskRuns(taskId: string) {
  return prisma.run.findMany({
    where: { monitorTaskId: taskId },
    include: { evidence: { include: { analyses: { include: { mentions: true, citations: true } } } } },
    orderBy: { createdAt: "asc" },
  });
}

// ---------------- Fixture ----------------
const suffix = randomUUID().slice(0, 8);
let ids: Record<string, string> = {};
let taskA1 = "", taskA3 = "", taskA5 = "";

async function cleanupLegacyAcceptance() {
  const legacy = await prisma.organization.findMany({ where: { slug: { startsWith: "m4accept-" } }, select: { id: true } });
  if (legacy.length === 0) return;
  const orgIds = legacy.map(o => o.id);
  await prisma.monitorTask.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.engine.deleteMany({ where: { key: { startsWith: "m4a-" } } });
  await prisma.project.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@m4accept.test.com" } } });
  log(`cleaned legacy M4 acceptance fixtures orgs=${legacy.length}`);
}

async function buildFixture() {
  const user = await prisma.user.create({ data: { email: `m4acc-${suffix}@m4accept.test.com`, name: "M4 Acceptance" } });
  const org = await prisma.organization.create({ data: { name: `M4 Accept ${suffix}`, slug: `m4accept-${suffix}` } });
  await prisma.organizationMember.create({ data: { userId: user.id, organizationId: org.id, role: "OWNER" } });
  const project = await prisma.project.create({ data: { organizationId: org.id, name: `M4 Accept Project ${suffix}` } });
  // 品牌 + 竞品（模拟任务书验收：ProjectMentor vs A/B/C）
  const brand = await prisma.brand.create({ data: { projectId: project.id, name: "ProjectMentor", aliases: ["Project Mentor", "项目导师", "PMentor"] } });
  const mkCompetitor = async (name: string) => prisma.competitor.create({ data: { projectId: project.id, name } });
  await mkCompetitor("Competitor A");
  await mkCompetitor("Competitor B");
  await mkCompetitor("Competitor C");
  const queryIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const q = await prisma.query.create({ data: { projectId: project.id, text: `M4 accept query ${i} ${suffix}` } });
    queryIds.push(q.id);
  }
  const mkEngine = async (key: string, config: object) => {
    const e = await prisma.engine.create({ data: { key: `m4a-${key}-${suffix}`, name: key, provider: "mock", config: config as never } });
    return e.id;
  };
  ids = {
    organizationId: org.id, projectId: project.id, brandId: brand.id,
    q0: queryIds[0], q1: queryIds[1], q2: queryIds[2], q3: queryIds[3], q4: queryIds[4],
    e1: await mkEngine("first", { delayMs: 40, scenario: "first" }),      // 品牌第一推荐 + competitor
    e2: await mkEngine("second", { delayMs: 40, scenario: "second" }),    // 品牌第二推荐 + competitor
    e3: await mkEngine("citation", { delayMs: 40, scenario: "citation" }), // 品牌 + citation URL
  };
  log(`fixture ready org=${org.id} project=${project.id}`);
}

async function makeTask(name: string, runs: { queryId: string; engineId: string }[]) {
  const t = await prisma.monitorTask.create({
    data: { organizationId: ids.organizationId, projectId: ids.projectId, totalRuns: runs.length, runs: { create: runs } },
  });
  log(`task ${name} created id=${t.id} runs=${runs.length}`);
  return t.id;
}

// ---------------- Cleanup ----------------
async function cleanup() {
  for (const c of children) { try { c.kill("SIGTERM"); } catch { /* noop */ } }
  await delay(300);
  if (ids.projectId) {
    await prisma.monitorTask.deleteMany({ where: { projectId: ids.projectId } }).catch(() => undefined);
    await prisma.engine.deleteMany({ where: { key: { startsWith: `m4a-${suffix}` } } }).catch(() => undefined);
    await prisma.project.deleteMany({ where: { id: ids.projectId } }).catch(() => undefined);
    await prisma.organizationMember.deleteMany({ where: { organizationId: ids.organizationId } }).catch(() => undefined);
    await prisma.organization.deleteMany({ where: { id: ids.organizationId } }).catch(() => undefined);
  }
  await prisma.user.deleteMany({ where: { email: `m4acc-${suffix}@m4accept.test.com` } }).catch(() => undefined);
  await prisma.$disconnect();
  log("cleanup done");
}

// ================= RUN =================
(async () => {
  try {
    await cleanupLegacyAcceptance();
    await buildFixture();

    // ---- [A1] 15 Runs -> 15 Evidence -> 15 Analysis ----
    log("== [A1] 15 Runs -> 15 Evidence -> 15 Analysis ==");
    taskA1 = await makeTask("A1-15runs", [ids.q0, ids.q1, ids.q2, ids.q3, ids.q4].flatMap(q => [ids.e1, ids.e2, ids.e3].map(e => ({ queryId: q, engineId: e }))));
    const q1 = createRunQueue();
    await dispatchPendingRuns(prisma, q1);
    await q1.close();
    const w1 = spawnWorker("A1w");
    await waitFor(`[A1] T1 all SUCCEEDED + analysed`, async () => {
      const runs = await taskRuns(taskA1);
      return runs.length === 15
        && runs.every(r => r.status === "SUCCEEDED" && r.analysisStatus === "SUCCEEDED" && r.evidence && r.evidence.analyses.length === 1);
    }, 60000);
    const runs1 = await taskRuns(taskA1);
    assert.equal(runs1.length, 15);
    const evidences = runs1.map(r => r.evidence!).filter(Boolean);
    const analyses = evidences.flatMap(e => e.analyses);
    assert.equal(evidences.length, 15, "15 Raw Evidence");
    assert.equal(analyses.length, 15, "15 Analysis");
    assert.ok(analyses.every(a => a.analysisVersion === ANALYSIS_VERSION));
    assert.ok(evidences.every(e => e.sourceType === "mock"), "Mock Provider sourceType=mock");
    const withMentions = analyses.filter(a => a.brandMentioned).length;
    assert.ok(withMentions >= 10, `scenario first/second/citation 大多应提及品牌（实际 ${withMentions}/15）`);
    const withCitations = analyses.filter(a => a.citations.length > 0).length;
    assert.ok(withCitations >= 5, `citation 引擎的 5 条应含引用（实际 ${withCitations}）`);
    // Raw Response 可点开查看：内容非空且为确定性 mock 文案
    assert.ok(evidences.every(e => e.rawResponse.length > 10 && e.rawPrompt.length > 0));
    log(`[A1] PASS: evidence=${evidences.length} analysis=${analyses.length} brandMentioned=${withMentions} citations=${withCitations}`);
    await stopWorker(w1, "A1w");

    // ---- [A2] Evidence immutable ----
    log("== [A2] Evidence immutable (UPDATE rejected by DB trigger) ==");
    const firstEvidence = evidences[0];
    let updateRejected = false;
    try {
      await prisma.evidence.update({ where: { id: firstEvidence.id }, data: { rawResponse: "tampered" } });
    } catch { updateRejected = true; }
    assert.ok(updateRejected, "UPDATE Evidence 必须被 trigger 拒绝");
    const afterProbe = await prisma.evidence.findUniqueOrThrow({ where: { id: firstEvidence.id } });
    assert.ok(!afterProbe.rawResponse.startsWith("tampered"), "rawResponse 未被篡改");
    log(`[A2] PASS: Raw Evidence UPDATE rejected, content preserved (${afterProbe.rawResponse.length} chars)`);

    // ---- [A3] Analysis versioning ----
    log("== [A3] Analysis versioning (append v2; replay v1 idempotent) ==");
    taskA3 = await makeTask("A3-version", [{ queryId: ids.q0, engineId: ids.e1 }]);
    const q3 = createRunQueue();
    await dispatchPendingRuns(prisma, q3);
    await q3.close();
    const w3 = spawnWorker("A3w");
    await waitFor(`[A3] T3 analysed`, async () => {
      const runs = await taskRuns(taskA3);
      return runs.length === 1 && runs[0].analysisStatus === "SUCCEEDED" && runs[0].evidence?.analyses.length === 1;
    }, 30000);
    await stopWorker(w3, "A3w");
    const run3 = (await taskRuns(taskA3))[0];
    const ev3 = run3.evidence!;
    assert.equal(ev3.analyses.length, 1);
    // 追加 v2（不同版本，同一 Evidence）：analyzer 必须声明与请求一致的 analysisVersion
    const CUSTOM_VERSION = "m4-rule-v2-custom";
    const v2Judge: ResponseJudge = { analysisVersion: CUSTOM_VERSION, judge: input => new RuleJudge().judge(input) };
    const v2ok = await analyzeEvidence(prisma, ev3.id, {
      version: CUSTOM_VERSION,
      analyzer: input => analyzeResponse(input, v2Judge),
    });
    assert.equal(v2ok, true, "追加新 analysisVersion 应成功");
    // 重放默认 v1 → 幂等 true 且不重复建行
    const replay = await analyzeEvidence(prisma, ev3.id);
    assert.equal(replay, true, "已有版本重放应幂等成功");
    const ev3after = await prisma.evidence.findUniqueOrThrow({ where: { id: ev3.id }, include: { analyses: true } });
    assert.equal(ev3after.analyses.length, 2, "v1 + v2 共存，不重复");
    assert.ok(ev3after.rawResponse === ev3.rawResponse, "追加版本不改变 Raw Evidence");
    log(`[A3] PASS: versions=${ev3after.analyses.map(a => a.analysisVersion).join(",")} replay-idempotent`);

    // ---- [A4] Metrics reconciliation ----
    log("== [A4] Metrics reconciliation (aggregateMetrics over real DB snapshot) ==");
    const task1Row = await prisma.monitorTask.findUniqueOrThrow({ where: { id: taskA1 }, include: { runs: true } });
    const runsForMetrics = await prisma.run.findMany({
      where: { monitorTaskId: taskA1 },
      select: { status: true, evidence: { select: { analyses: { where: { analysisVersion: ANALYSIS_VERSION }, include: { mentions: true, citations: true } } } } },
    });
    const metrics = aggregateMetrics({
      analysisVersion: ANALYSIS_VERSION,
      runs: runsForMetrics.map(r => {
        const analysis = r.evidence?.analyses[0];
        return { status: r.status, analysis: analysis ? { ...analysis, mentions: analysis.mentions, citations: analysis.citations } : null };
      }),
    });
    assert.equal(metrics.totalRuns, 15);
    assert.equal(metrics.successfulRuns, 15);
    assert.equal(metrics.failedRuns, 0);
    assert.equal(metrics.analyzedRuns, 15);
    assert.equal(metrics.analysisMissingRuns, 0);
    assert.equal(metrics.visibilityRate, 1, "15/15 都提及品牌（scenario first/second/citation 均含品牌）");
    // first/citation 引擎各 5 条 position=1，second 引擎 5 条 position=2 → mean = (5*1+5*2+5*1)/15 = 20/15
    assert.ok(Math.abs(metrics.averageMentionPosition! - 20 / 15) < 1e-9, `平均提及排名应为 20/15（实际 ${metrics.averageMentionPosition}）`);
    assert.ok(metrics.citationCount >= 5 && metrics.citationDomainCount >= 1, "citation 引擎贡献引用");
    assert.ok(metrics.recommendationRate! >= 0.9, "绝大多数 scenario 推荐品牌");
    assert.ok(metrics.sentimentDistribution.positive >= 10, "多数分析为正面");
    log(`[A4] PASS: visibility=${metrics.visibilityRate} avgPos=${metrics.averageMentionPosition} reco=${metrics.recommendationRate} SOV=${metrics.shareOfVoice} citations=${metrics.citationCount}/${metrics.citationDomainCount} sentiment=${JSON.stringify(metrics.sentimentDistribution)}`);

    // ---- [A5] worker restart -> recoverAnalyses fills missing analyses ----
    log("== [A5] worker restart: recoverAnalyses repairs missing analysis ==");
    taskA5 = await makeTask("A5-recover", [
      { queryId: ids.q0, engineId: ids.e1 }, { queryId: ids.q1, engineId: ids.e2 }, { queryId: ids.q2, engineId: ids.e3 },
    ]);
    const q5 = createRunQueue();
    await dispatchPendingRuns(prisma, q5);
    await q5.close();
    const w5 = spawnWorker("A5w");
    await waitFor(`[A5] T5 all analysed`, async () => {
      const runs = await taskRuns(taskA5);
      return runs.length === 3 && runs.every(r => r.analysisStatus === "SUCCEEDED");
    }, 30000);
    await stopWorker(w5, "A5w");
    // 模拟：把其中 2 个 run 的分析删掉并重置为 PENDING（如同 worker 在分析前崩溃）
    const runs5 = await taskRuns(taskA5);
    for (const run of runs5.slice(0, 2)) {
      await prisma.analysis.deleteMany({ where: { evidence: { runId: run.id } } });
      await prisma.run.update({ where: { id: run.id }, data: { analysisStatus: "PENDING", analysisAttempts: 0 } });
    }
    // 重启 worker：poll 循环内 recoverAnalyses 应补齐
    const w5b = spawnWorker("A5w2");
    await waitFor(`[A5] recoverAnalyses repaired 2 runs`, async () => {
      const runs = await taskRuns(taskA5);
      return runs.filter(r => r.analysisStatus === "SUCCEEDED").length === 3;
    }, 30000);
    await stopWorker(w5b, "A5w2");
    const runs5after = await taskRuns(taskA5);
    const repaired = runs5after.filter(r => r.analysisStatus === "SUCCEEDED").length;
    assert.equal(repaired, 3, "重启后缺失分析被补齐");
    const evCount = (await taskRuns(taskA5)).filter(r => r.evidence).length;
    assert.equal(evCount, 3, "Evidence 不被重写或删除");
    log(`[A5] PASS: repaired analyses=3, evidences intact=3`);

    console.log("\n========== M4 ACCEPTANCE ALL PASS ==========");
    console.log("A1 15Ev/15An / A2 immutable / A3 versioned / A4 metrics / A5 restart-repair");
  } catch (err) {
    console.error("\n========== M4 ACCEPTANCE FAILED ==========");
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
})();
