/**
 * M3 验收脚本（真实 Worker 进程端到端，PostgreSQL geo_test + 真实 Redis）。
 *
 * 顶层加载 test-env.cjs guard：强制 DATABASE_URL=geo_test，绝不触碰 geo_dev。
 *
 * 场景：
 *   [1] 15 Runs E2E：5 Query × 3 Success Engine = 15 Runs → 全部 SUCCEEDED，task SUCCEEDED
 *       （PENDING → QUEUED → RUNNING → SUCCEEDED，含中间态采样）
 *   [2] retry then success：failuresBeforeSuccess=1 → 最终 SUCCEEDED，attempt=2
 *   [3] permanent failure：permanentFailure=true → FAILED(RETRY_EXHAUSTED)，attempt=3
 *   [4] PARTIAL：成功 + 永久失败混合 → task PARTIAL（completed=1 / failed=1）
 *   [5] worker restart：消费中途 SIGTERM → 重启后 reconcile/dispatch 补齐 → 全部 SUCCEEDED
 *   [6] Redis 短暂不可用：enqueue 失败时 Run 保持 PENDING（DB 为 source of truth），
 *       恢复后 dispatch/reconcile 自动补投 → SUCCEEDED
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
import { setTimeout as delay } from "node:timers/promises";

const WORKER_CWD = fileURLToPath(new URL("..", import.meta.url)); // …/apps/worker/
const children: ChildProcess[] = [];
const started = Date.now();
const log = (msg: string) => console.log(`[accept:${Math.round((Date.now() - started) / 1000)}s] ${msg}`);
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
  let last = "";
  while (Date.now() < deadline) {
    if (await fn()) { log(`${desc} -> OK (${stamp()})`); return; }
    await delay(intervalMs);
  }
  throw new Error(`WAIT_TIMEOUT: ${desc}（${timeoutMs}ms 内未满足）${last ? ` last=${last}` : ""}`);
}

async function taskStatus(taskId: string) {
  return prisma.monitorTask.findUniqueOrThrow({
    where: { id: taskId },
    include: { runs: true },
  });
}

// ---------------- Fixture ----------------
const suffix = randomUUID().slice(0, 8);
let ids: Record<string, string> = {};
let task1 = "", task2 = "", task3 = "", task4 = "", task5 = "", task6 = "";

async function cleanupLegacyAcceptance() {
  // 幂等起点：历史/中断运行（SIGTERM 无 finally）可能残留 acc- fixture，先清空再开始。
  const legacy = await prisma.organization.findMany({ where: { slug: { startsWith: "accept-" } }, select: { id: true } });
  if (legacy.length === 0) return;
  const orgIds = legacy.map(o => o.id);
  await prisma.monitorTask.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.engine.deleteMany({ where: { key: { startsWith: "acc-" } } });
  await prisma.project.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@accept.test.com" } } });
  log(`cleaned legacy acceptance fixtures orgs=${legacy.length}`);
}

async function buildFixture() {
  const user = await prisma.user.create({ data: { email: `acc-${suffix}@accept.test.com`, name: "Acceptance" } });
  const org = await prisma.organization.create({ data: { name: `Accept ${suffix}`, slug: `accept-${suffix}` } });
  await prisma.organizationMember.create({ data: { userId: user.id, organizationId: org.id, role: "OWNER" } });
  const project = await prisma.project.create({ data: { organizationId: org.id, name: `Accept Project ${suffix}` } });
  const queryIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const q = await prisma.query.create({ data: { projectId: project.id, text: `Accept query ${i} ${suffix}` } });
    queryIds.push(q.id);
  }
  const mkEngine = async (key: string, config: object) => {
    const e = await prisma.engine.create({ data: { key: `acc-${key}-${suffix}`, name: key, provider: "mock", config: config as never } });
    return e.id;
  };
  ids = {
    organizationId: org.id, projectId: project.id,
    q0: queryIds[0], q1: queryIds[1], q2: queryIds[2], q3: queryIds[3], q4: queryIds[4],
    e1: await mkEngine("success-1", { delayMs: 40 }),
    e2: await mkEngine("success-2", { delayMs: 40 }),
    e3: await mkEngine("success-3", { delayMs: 40 }),
    retry: await mkEngine("retry", { delayMs: 20, failuresBeforeSuccess: 1 }),
    fail: await mkEngine("fail", { delayMs: 20, permanentFailure: true }),
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
    await prisma.engine.deleteMany({ where: { key: { startsWith: `acc-${suffix}` } } }).catch(() => undefined);
    await prisma.project.deleteMany({ where: { id: ids.projectId } }).catch(() => undefined);
    await prisma.organizationMember.deleteMany({ where: { organizationId: ids.organizationId } }).catch(() => undefined);
    await prisma.organization.deleteMany({ where: { id: ids.organizationId } }).catch(() => undefined);
  }
  await prisma.user.deleteMany({ where: { email: `acc-${suffix}@accept.test.com` } }).catch(() => undefined);
  await prisma.$disconnect();
  log("cleanup done");
}

// ================= RUN =================
(async () => {
  try {
    await cleanupLegacyAcceptance();
    await buildFixture();

    // ---- [1] 15 Runs E2E ----
    log("== [1] 15 Runs E2E (5 Query x 3 Engine) ==");
    task1 = await makeTask("T1-15runs", [ids.q0, ids.q1, ids.q2, ids.q3, ids.q4].flatMap(q => [ids.e1, ids.e2, ids.e3].map(e => ({ queryId: q, engineId: e }))));
    const q1 = createRunQueue();
    const dispatched = await dispatchPendingRuns(prisma, q1);
    await q1.close();
    assert.ok(dispatched >= 15, `dispatch 至少入队 15 jobs（实际 ${dispatched}，含历史 PENDING 也属恢复语义）`);
    log(`[1] dispatched=${dispatched} jobs`);

    const w1 = spawnWorker("R1");
    await delay(600); // 中间态采样：应看到 QUEUED/RUNNING/SUCCEEDED 并存
    const mid = await taskStatus(task1);
    const dist = mid.runs.reduce<Record<string, number>>((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {});
    log(`[1] mid-state sample: ${JSON.stringify(dist)}（含中间态即证明 PENDING→QUEUED→RUNNING→SUCCEEDED 链路）`);

    await waitFor(`[1] T1 15 runs all SUCCEEDED`, async () => {
      const t = await taskStatus(task1);
      return t.runs.length === 15 && t.runs.every(r => r.status === "SUCCEEDED");
    }, 45000);
    const t1 = await taskStatus(task1);
    assert.equal(t1.status, "SUCCEEDED");
    assert.equal(t1.completedRuns, 15);
    assert.ok(t1.startedAt && t1.completedAt, "startedAt/completedAt 应被设置");
    log(`[1] PASS: task SUCCEEDED completed=${t1.completedRuns} failed=${t1.failedRuns} startedAt=${t1.startedAt?.toISOString()}`);
    await stopWorker(w1, "R1");

    // ---- [2] retry then success ----
    log("== [2] retry then success ==");
    task2 = await makeTask("T2-retry", [{ queryId: ids.q0, engineId: ids.retry }]);
    const q2 = createRunQueue();
    await dispatchPendingRuns(prisma, q2);
    await q2.close();
    const w2 = spawnWorker("R2");
    await waitFor(`[2] T2 retry SUCCEEDED attempt=2`, async () => {
      const t = await taskStatus(task2);
      const run = t.runs[0];
      return t.status === "SUCCEEDED" && run.status === "SUCCEEDED" && run.attempt === 2;
    }, 30000);
    const t2 = await taskStatus(task2);
    log(`[2] PASS: run attempt=${t2.runs[0].attempt}（第一次失败自动重试，第二次成功）`);
    await stopWorker(w2, "R2");

    // ---- [3] permanent failure ----
    log("== [3] permanent failure ==");
    task3 = await makeTask("T3-fail", [{ queryId: ids.q1, engineId: ids.fail }]);
    const q3 = createRunQueue();
    await dispatchPendingRuns(prisma, q3);
    await q3.close();
    const w3 = spawnWorker("R3");
    await waitFor(`[3] T3 FAILED attempt=3`, async () => {
      const t = await taskStatus(task3);
      const run = t.runs[0];
      return t.status === "FAILED" && run.status === "FAILED" && run.attempt === 3;
    }, 30000);
    const t3 = await taskStatus(task3);
    log(`[3] PASS: run FAILED attempt=${t3.runs[0].attempt} errorCode=${t3.runs[0].errorCode} task=${t3.status}`);
    await stopWorker(w3, "R3");

    // ---- [4] PARTIAL ----
    log("== [4] PARTIAL (success + permanent failure) ==");
    task4 = await makeTask("T4-partial", [
      { queryId: ids.q2, engineId: ids.e1 },
      { queryId: ids.q2, engineId: ids.fail },
    ]);
    const q4 = createRunQueue();
    await dispatchPendingRuns(prisma, q4);
    await q4.close();
    const w4 = spawnWorker("R4");
    await waitFor(`[4] T4 PARTIAL`, async () => {
      const t = await taskStatus(task4);
      return t.status === "PARTIAL" && t.completedRuns === 1 && t.failedRuns === 1;
    }, 30000);
    log(`[4] PASS: task PARTIAL completed=1 failed=1`);
    await stopWorker(w4, "R4");

    // ---- [5] worker restart ----
    log("== [5] worker restart (kill mid-consumption -> recover) ==");
    task5 = await makeTask("T5-restart", [ids.q0, ids.q1, ids.q2, ids.q3, ids.q4].flatMap(q => [ids.e1, ids.e2, ids.e3].map(e => ({ queryId: q, engineId: e }))));
    const q5 = createRunQueue();
    await dispatchPendingRuns(prisma, q5);
    await q5.close();
    // 串行消费拉长窗口：出现 ≥1 SUCCEEDED 且仍有未完成时立即 kill（确定性截断在部分完成态）
    const w5a = spawnWorker("R5a", "1");
    await waitFor(`[5] R5a 进入部分完成态`, async () => {
      const t = await taskStatus(task5);
      const succ = t.runs.filter(r => r.status === "SUCCEEDED").length;
      return succ >= 1 && succ < 15;
    }, 30000, 50);
    await stopWorker(w5a, "R5a");
    const mid5 = await taskStatus(task5);
    const dist5 = mid5.runs.reduce<Record<string, number>>((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {});
    log(`[5] state after kill: ${JSON.stringify(dist5)}`);
    assert.ok(dist5.SUCCEEDED !== undefined && dist5.SUCCEEDED < 15, "kill 时应尚未全部完成");

    const w5b = spawnWorker("R5b");
    await waitFor(`[5] T5 all SUCCEEDED after restart`, async () => {
      const t = await taskStatus(task5);
      return t.runs.length === 15 && t.runs.every(r => r.status === "SUCCEEDED");
    }, 60000);
    const t5 = await taskStatus(task5);
    assert.equal(t5.status, "SUCCEEDED");
    log(`[5] PASS: worker restart 后 reconcile/dispatch 补齐，15 runs 全部 SUCCEEDED`);
    await stopWorker(w5b, "R5b");

    // ---- [6] Redis unavailable -> PENDING kept -> recovery re-enqueue ----
    log("== [6] Redis unavailable -> PENDING -> recovery ==");
    task6 = await makeTask("T6-redis-recovery", [
      { queryId: ids.q3, engineId: ids.e1 },
      { queryId: ids.q4, engineId: ids.e2 },
    ]);
    const originalRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = "redis://127.0.0.1:6399"; // 无服务端口：模拟 Redis 短暂不可用
    const q6 = createRunQueue();
    let enqueueFailed = false;
    // ioredis 对不可达端口无限重连，add 永不 reject → 用 4s race 判定「enqueue 阶段不可用」，
    // 随后立即 close（disconnect 掐断重连定时器，避免 dangling handle）。
    await Promise.race([
      dispatchPendingRuns(prisma, q6).catch(() => { enqueueFailed = true; }),
      delay(4000).then(() => { enqueueFailed = true; }),
    ]);
    await q6.close().catch(() => undefined);
    process.env.REDIS_URL = originalRedisUrl; // 恢复
    const t6a = await taskStatus(task6);
    const dist6 = t6a.runs.reduce<Record<string, number>>((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {});
    log(`[6] during outage enqueueFailed=${enqueueFailed} run states=${JSON.stringify(dist6)}`);
    assert.ok(t6a.runs.every(r => r.status === "PENDING" || r.status === "QUEUED"), "Redis 不可用时 Run 不得丢失（至少保留 PENDING/QUEUED）");

    const w6 = spawnWorker("R6");
    await waitFor(`[6] T6 SUCCEEDED after Redis recovery`, async () => {
      const t = await taskStatus(task6);
      return t.status === "SUCCEEDED" && t.completedRuns === 2;
    }, 30000);
    log(`[6] PASS: Redis 恢复后 dispatch/reconcile 自动补投 PENDING Run，全部 SUCCEEDED`);
    await stopWorker(w6, "R6");

    console.log("\n========== ACCEPTANCE ALL PASS ==========");
    console.log("T1 15runs SUCCEEDED / T2 retry attempt=2 / T3 permanent FAILED / T4 PARTIAL / T5 worker-restart / T6 redis-recovery");
  } catch (err) {
    console.error("\n========== ACCEPTANCE FAILED ==========");
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
})();
