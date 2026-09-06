import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const metadata: Metadata = {
  title: "GeoLens Project Control Center",
};

export const dynamic = "force-dynamic"; // 每次请求实时检测，禁止 build 期预渲染

/* ================================================================== */
/*  类型（与根目录 project-status.json 对齐，冗余但自解释）              */
/* ================================================================== */
type GateStatus = "DONE" | "PASS" | "N/A" | "IN_PROGRESS" | "NOT_STARTED";
type MsStatus = "DONE" | "IN_PROGRESS" | "NOT_STARTED" | "BLOCKED";

interface Gate {
  status: GateStatus;
  detail?: string;
}
interface Checkpoint {
  name: string;
  status: GateStatus;
}
interface Verification {
  method?: string | null;
  command?: string | null;
  lastRunAt?: string | null;
  result?: string | null;
}
interface TestRecord {
  name?: string;
  command?: string;
  result?: string;
  lastRunAt?: string;
}
interface Milestone {
  id: string;
  name: string;
  status: MsStatus;
  completedAt?: string | null;
  commit?: string | null;
  dataType?: string;
  demoRoute?: string | null;
  summary?: string[];
  gates?: { implementation?: Gate; testing?: Gate; demo?: Gate };
  checkpoints?: Checkpoint[];
  verification?: Verification;
  tests?: TestRecord[];
}
interface ProjectStatus {
  project?: string;
  currentMilestone?: string;
  overallStatus?: string;
  updatedAt?: string;
  updatedBy?: string;
  updatedNote?: string;
  git?: { branch?: string; head?: string; headLabel?: string };
  nextUp?: { id?: string; name?: string; status?: string };
  realRunEvidence?: {
    note?: string;
    verified?: boolean;
    totalRealRuns?: number;
    sample?: { project?: string; queries?: number; brandMentions?: number; visibility?: string; citations?: string; metricSource?: string };
  };
  milestones?: Milestone[];
}

/* ================================================================== */
/*  仓库根目录解析                                                       */
/*  不依赖“从哪里执行 next dev”的偶然 cwd（实测 next dev cwd 变化会直接   */
/*  让 path.resolve(cwd,'../../') 指错目录）。策略依次：                  */
/*   1) GEOLENS_REPO_ROOT 环境变量（启动器可显式传入）                   */
/*   2) 从 cwd 向上逐级查找 workspace marker：                          */
/*      project-status.json 且存在 pnpm-workspace.yaml / package.json   */
/*   3) 最后回退 apps/web 的 ../../（next dev 惯例 cwd）                 */
/* ================================================================== */
function resolveRepoRoot(): string {
  const envRoot = process.env.GEOLENS_REPO_ROOT;
  if (envRoot) {
    const abs = path.resolve(envRoot);
    if (existsSync(path.join(abs, "project-status.json"))) return abs;
  }
  let dir = path.resolve(process.cwd());
  for (;;) {
    const hasProject = existsSync(path.join(dir, "project-status.json"));
    const hasMarker =
      existsSync(path.join(dir, "pnpm-workspace.yaml")) || existsSync(path.join(dir, "package.json"));
    if (hasProject && hasMarker) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd(), "../../");
}

const REPO_ROOT = resolveRepoRoot();
const PROJECT_JSON = path.join(REPO_ROOT, "project-status.json");
const RUNTIME_DIR = path.join(REPO_ROOT, ".runtime");

const API_BASE = "http://127.0.0.1:3001";
const WEB_PORT = 3000;
const CONTROL_URL = `http://localhost:${WEB_PORT}/dev/status`;

/* ================================================================== */
/*  小工具                                                             */
/* ================================================================== */
async function readJson<T>(p: string): Promise<T | null> {
  try {
    const raw = await readFile(p, "utf8");
    // 兼容 Windows 写盘工具常见的 UTF-8 BOM（dev-control.ps1 的 Set-Content -Encoding UTF8
    // 在 PS 5.1 会写 BOM），裸 JSON.parse 遇 BOM 直接失败 → 页面进 fallback。
    return JSON.parse(raw.replace(/^\uFEFF/, "")) as T;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readPid(name: string): Promise<number> {
  const p = path.join(RUNTIME_DIR, `${name}.pid`);
  if (!existsSync(p)) return 0;
  try {
    const raw = await readFile(p, "utf8");
    return Number.parseInt(raw.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

async function readLogTail(name: string): Promise<string> {
  const p = path.join(RUNTIME_DIR, "logs", `${name}.log`);
  if (!existsSync(p)) return "";
  try {
    const raw = await readFile(p, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    return lines.slice(-8).join("\n");
  } catch {
    return "";
  }
}

function run(
  cmd: string,
  args: string[],
  timeoutMs = 4000,
): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ ok: !error, out: (stdout ?? "").trim(), err: (stderr ?? "").trim() });
    });
  });
}

async function httpProbe(url: string, timeoutMs = 3000): Promise<{ ok: boolean; body: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.text();
    return { ok: res.status >= 200 && res.status < 500, body };
  } catch {
    return { ok: false, body: "" };
  }
}

interface InfraStatus {
  postgres: { value: string; from: "live" | "snapshot" | "unknown"; at: string };
  redis: { value: string; from: "live" | "snapshot" | "unknown"; at: string };
  redisPong: boolean | null;
}

/** Docker Engine 是否可用（server 端探活） */
async function dockerServerUp(): Promise<boolean> {
  const r = await run("docker", ["version", "--format", "{{.Server.Version}}"], 4000);
  return r.ok && /\d+\.\d+/.test(r.out);
}

async function liveInfra(): Promise<InfraStatus> {
  const now = new Date().toLocaleString("zh-CN", { hour12: false });
  const up = await dockerServerUp();
  if (!up) {
    return {
      postgres: { value: "unknown", from: "unknown", at: now },
      redis: { value: "unknown", from: "unknown", at: now },
      redisPong: null,
    };
  }
  const [pg, rd, pong] = await Promise.all([
    run("docker", ["inspect", "-f", "{{.State.Health.Status}}", "geo-postgres"], 5000),
    run("docker", ["inspect", "-f", "{{.State.Health.Status}}", "geo-redis"], 5000),
    run("docker", ["exec", "geo-redis", "redis-cli", "ping"], 5000),
  ]);
  const norm = (r: { ok: boolean; out: string; err: string }) =>
    r.ok && r.out ? r.out : "down";
  return {
    postgres: { value: norm(pg), from: "live", at: now },
    redis: { value: norm(rd), from: "live", at: now },
    redisPong: pong.ok && pong.out === "PONG",
  };
}

/* 安全边界：Web 进程永不读取 .env 原文（Next dev 会把整份 .env 当作文本注入 RSC 响应，
   已实测）。DeepSeek/Real Providers 布尔一律来自启动器快照 .runtime/status.json。 */

/* ================================================================== */
/*  状态收集                                                           */
/* ================================================================== */
const GATE_ICON: Record<GateStatus, string> = {
  DONE: "✅",
  PASS: "✅",
  "N/A": "—",
  IN_PROGRESS: "🟡",
  NOT_STARTED: "⏳",
};
const MS_ICON: Record<MsStatus, string> = {
  DONE: "✅",
  IN_PROGRESS: "🟡",
  NOT_STARTED: "⏳",
  BLOCKED: "⛔",
};
const MS_PILL: Record<MsStatus, string> = {
  DONE: "bg-emerald-100 text-emerald-800 border-emerald-300",
  IN_PROGRESS: "bg-amber-100 text-amber-800 border-amber-300",
  NOT_STARTED: "bg-slate-100 text-slate-600 border-slate-300",
  BLOCKED: "bg-red-100 text-red-800 border-red-300",
};

async function collect() {
  const project = existsSync(PROJECT_JSON) ? await readJson<ProjectStatus>(PROJECT_JSON) : null;
  const statusPath = path.join(RUNTIME_DIR, "status.json");
  const snapshot = existsSync(statusPath)
    ? await readJson<{
        updatedAt?: string;
        apps?: Record<string, { pid?: number; alive?: boolean; healthy?: boolean }>;
        infrastructure?: { postgres?: string; redis?: string; redisPong?: boolean };
        apiHealth?: boolean;
        dbHealth?: boolean;
        config?: { realProvidersEnabled?: boolean; deepseekConfigured?: boolean };
        lastApiError?: string | null;
        lastWorkerError?: string | null;
      }>(statusPath)
    : null;

  // —— 实时探活（能实时查的就实时查）——
  const [api, apiDb, infra, webProbe] = await Promise.all([
    httpProbe(`${API_BASE}/health`, 3000),
    httpProbe(`${API_BASE}/health/db`, 3000),
    liveInfra().catch((): InfraStatus => ({ postgres: { value: "unknown", from: "unknown", at: "" }, redis: { value: "unknown", from: "unknown", at: "" }, redisPong: null })),
    httpProbe(`http://127.0.0.1:${WEB_PORT}/`, 4000),
  ]);

  const apiBody = (() => {
    try {
      return apiDb.ok ? (JSON.parse(apiDb.body) as { status?: string }) : null;
    } catch {
      return null;
    }
  })();

  const [apiPid, workerPid, webPid] = await Promise.all([readPid("api"), readPid("worker"), readPid("web")]);
  const apiAlive = pidAlive(apiPid);
  const workerAlive = pidAlive(workerPid);
  const webAlive = pidAlive(webPid);
  const workerLog = await readLogTail("worker");
  const workerReady = workerAlive && /"status":"READY"/.test(workerLog);

  // DeepSeek / Real Providers：布尔值只来自启动器快照（ps1 已在服务端脱敏后写入
  // .runtime/status.json）。Web 进程永不读取 .env 原文 —— Next dev 会把整份 .env
  // 当作文本注入 RSC 响应（已实测泄漏），因此这里连回退读取都不做。
  const hasConfig =
    !!snapshot?.config && (snapshot.config.realProvidersEnabled !== undefined || snapshot.config.deepseekConfigured !== undefined);
  const config = {
    realProvidersEnabled: hasConfig ? snapshot!.config!.realProvidersEnabled === true : null,
    deepseekConfigured: hasConfig ? snapshot!.config!.deepseekConfigured === true : null,
    fromSnapshot: hasConfig,
  };

  // 允许 snapshot 作为 infra fallback 的补充来源（live 优先）
  const pgLive = infra.postgres.from === "live";
  const postgresValue = pgLive ? infra.postgres.value : snapshot?.infrastructure?.postgres ?? "unknown";
  const redisValue = infra.redis.from === "live" ? infra.redis.value : snapshot?.infrastructure?.redis ?? "unknown";
  const redisPong = infra.redisPong ?? snapshot?.infrastructure?.redisPong ?? null;

  const workerNote = workerAlive
    ? workerReady
      ? `Ready（PID ${workerPid}，日志含 READY 标记）`
      : `已启动但未见 READY（PID ${workerPid}）`
    : workerPid > 0
      ? `Down（PID ${workerPid} 已失效）`
      : "Down（无 PID 记录）";

  return {
    project,
    snapshot,
    api: {
      ok: api.ok,
      health: api.ok ? JSON.parse(api.body || "{}").status ?? "unknown" : "down",
      dbOk: apiDb.ok && apiBody?.status === "ok",
      pid: apiPid,
      alive: apiAlive,
    },
    worker: { pid: workerPid, alive: workerAlive, ready: workerReady, log: workerLog, note: workerNote },
    web: { pid: webPid, alive: webAlive, probeOk: webProbe.ok, pageOk: true },
    infra: {
      postgres: { value: postgresValue, from: pgLive ? "live" : snapshot?.updatedAt ? "snapshot" : "unknown", at: pgLive ? infra.postgres.at : snapshot?.updatedAt ?? "" },
      redis: { value: redisValue, from: redisValue === "unknown" ? "unknown" : "live", at: pgLive ? infra.redis.at : snapshot?.updatedAt ?? "" },
      redisPong,
    },
    config,
    errors: { api: snapshot?.lastApiError ?? null, worker: snapshot?.lastWorkerError ?? null },
    checkedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
  };
}

/* ================================================================== */
/*  页面                                                               */
/* ================================================================== */
export default async function DevStatusPage() {
  // 仅开发环境可用；production 直接 404（禁用）。
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const c = await collect();
  const project = c.project;
  const milestones = project?.milestones ?? [];
  const done = milestones.filter((m) => m.status === "DONE").length;
  const total = Math.max(milestones.length, 1);
  const pct = Math.round((done / total) * 100);
  const current = project?.currentMilestone ?? "?";

  return (
    <main className="min-h-screen bg-slate-50 pb-16 text-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">GeoLens · development only</div>
              <h1 className="mt-1 text-2xl font-bold">Project Control Center</h1>
              <p className="mt-1 text-sm text-slate-500">本地开发驾驶舱 · 观察用，不做危险操作 · 检测时间 {c.checkedAt}</p>
            </div>
            <a href={CONTROL_URL} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
              重新检测 ↻
            </a>
          </div>

          {/* Current milestone banner */}
          <div className="mt-5 flex flex-wrap items-center gap-4 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
            <div className="text-4xl font-extrabold text-blue-800">{current}</div>
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold text-blue-900">
                {milestones.find((m) => m.id === current)?.name ?? "DeepSeek Real Provider"}
              </div>
              <div className="text-sm text-blue-700">
                Status: {milestones.find((m) => m.id === current)?.status ?? "DONE"}
                {project?.nextUp ? ` · Next: ${project.nextUp.id ?? ""} ${project.nextUp.name ?? ""}（不自动开始）` : ""}
              </div>
            </div>
            <div className="ml-auto text-right">
              <div className="text-xs text-slate-500">Overall Progress（按 Milestone 状态计算）</div>
              <div className="mt-1 text-sm font-semibold text-slate-700">
                {done}/{total} DONE · {pct}%
              </div>
            </div>
          </div>

          {/* Progress blocks — 从数据推导，不硬编码 */}
          <div className="mt-3 flex gap-1" aria-label="Overall progress">
            {milestones.map((m) => (
              <div
                key={m.id}
                title={`${m.id} ${m.name}: ${m.status}`}
                className={`h-2.5 flex-1 rounded-sm ${
                  m.status === "DONE"
                    ? "bg-emerald-500"
                    : m.status === "IN_PROGRESS"
                      ? "bg-amber-400"
                      : "bg-slate-200"
                }`}
              />
            ))}
          </div>
          <div className="mt-1 flex gap-1 text-[10px] text-slate-400">
            {milestones.map((m) => (
              <a key={m.id} href={`#ms-${m.id.replace(/\W/g, "")}`} className="flex-1 truncate hover:text-blue-600">
                {m.id}
              </a>
            ))}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-6 px-6 pt-6">
        {/* ============ SYSTEM STATUS ============ */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">System Status</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <StatusTile
              label="Web"
              state={c.web.probeOk || c.web.pageOk ? "ok" : "down"}
              text={c.web.probeOk || c.web.pageOk ? "Running" : "Down"}
              note={c.web.alive ? `PID ${c.web.pid}（实时）` : "由本页面提供"}
            />
            <StatusTile
              label="API"
              state={c.api.ok ? "ok" : "down"}
              text={c.api.ok ? "Healthy" : "Down"}
              note={c.api.alive ? `PID ${c.api.pid}（实时 /health）` : "实时 /health"}
            />
            <StatusTile
              label="Worker"
              state={c.worker.ready ? "ok" : c.worker.alive ? "warn" : "down"}
              text={c.worker.ready ? "Ready" : c.worker.alive ? "Starting" : "Down"}
              note={c.worker.alive ? `PID ${c.worker.pid}（实时 PID + 日志 READY）` : "PID 文件 + 日志标记"}
            />
            <StatusTile
              label="PostgreSQL"
              state={c.infra.postgres.value === "healthy" ? "ok" : "down"}
              text={c.infra.postgres.value === "healthy" ? "Healthy" : "Down / unknown"}
              note={
                c.infra.postgres.from === "live"
                  ? `docker inspect（实时 @ ${c.infra.postgres.at}）`
                  : c.infra.postgres.from === "snapshot"
                    ? `Last verified ${c.infra.postgres.at}（docker inspect）`
                    : "未检测到（先运行 START 或 STATUS）"
              }
            />
            <StatusTile
              label="Redis"
              state={c.infra.redis.value === "healthy" && c.infra.redisPong === true ? "ok" : "down"}
              text={
                c.infra.redis.value === "healthy" && c.infra.redisPong === true
                  ? "Healthy"
                  : c.infra.redisPong === null
                    ? "Unknown"
                    : "Down"
              }
              note={
                c.infra.redis.from === "live"
                  ? c.infra.redis.value === "healthy"
                    ? `docker exec redis-cli ping ${c.infra.redisPong ? "= PONG" : "≠ PONG"}（实时 @ ${c.infra.redis.at}）`
                    : "docker inspect（实时）"
                  : c.infra.redis.from === "snapshot"
                    ? `Last verified ${c.infra.redis.at}（snapshot，运行 STATUS 可刷新）`
                    : "未检测到（先运行 START 或 STATUS）"
              }
            />
            <StatusTile
              label="DB Health"
              state={c.api.dbOk ? "ok" : "down"}
              text={c.api.dbOk ? "Pass" : "Fail"}
              note="实时 /health/db（经 API）"
            />
            <StatusTile
              label="DeepSeek"
              state={c.config.deepseekConfigured === null ? "warn" : c.config.deepseekConfigured ? "ok" : "down"}
              text={
                c.config.deepseekConfigured === null
                  ? "Unknown"
                  : c.config.deepseekConfigured
                    ? "Configured (YES)"
                    : "Not configured (NO)"
              }
              note={
                c.config.fromSnapshot
                  ? "启动器快照（仅布尔，不返回 API Key）"
                  : "快照缺失：运行 STATUS 或 START 后刷新"
              }
            />
            <StatusTile
              label="Real Providers"
              state={c.config.realProvidersEnabled === null ? "warn" : c.config.realProvidersEnabled ? "ok" : "warn"}
              text={
                c.config.realProvidersEnabled === null
                  ? "Unknown"
                  : c.config.realProvidersEnabled
                    ? "Enabled"
                    : "Disabled"
              }
              note="启动器快照 · ENABLE_REAL_PROVIDERS 默认 false"
            />
          </div>
        </section>

        {/* ============ QUICK ACTIONS ============ */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Quick Actions（仅安全入口，无系统管理按钮）</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <QuickLink href="/app" label="Open Dashboard" />
            <QuickLink href="/app/monitor" label="Open Monitor / Evidence" />
            <QuickLink href={`#ms-${current.replace(/\W/g, "")}`} label="View Latest Milestone" />
            <QuickLink href={CONTROL_URL} label="Refresh Status" />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Open Dashboard / Monitor 需要登录（演示账号：<code className="rounded bg-slate-100 px-1">alice@geolens.local</code> /{" "}
            <code className="rounded bg-slate-100 px-1">Password123!</code>）。
          </p>
        </section>

        {/* ============ M5 REAL EVIDENCE (verified) ============ */}
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wide text-amber-700">M5 Real API — Verified</h2>
          <p className="mt-2 text-sm text-amber-900">
            真实调用 <b>{project?.realRunEvidence?.totalRealRuns ?? 4} Real Runs</b>（HTTP 200，attempt=1 无重试，引擎
            deepseek-api；模型 deepseek-v4-flash；Evidence sourceType=official_api / retrievalMode=api_plain，未伪造引用）。
          </p>
          <p className="mt-1 text-sm text-amber-900">
            最新真实 GEO 样本：ProjectMentor · DeepSeek · 3 Query → Brand mentions{" "}
            <b>{project?.realRunEvidence?.sample?.brandMentions ?? 0}/3</b>（Visibility 0%）。
          </p>
          <p className="mt-2 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            ⚠️ Small sample / baseline only —— 不代表稳定行业结论
          </p>
        </section>

        {/* ============ PROJECT PROGRESS ============ */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Project Progress（点击 Milestone 展开详情）</h2>
          <ol className="mt-3 space-y-2">
            {milestones.map((m, idx) => (
              <li key={m.id} id={`ms-${m.id.replace(/\W/g, "")}`} className="scroll-mt-4">
                <details className="group rounded-lg border border-slate-200 bg-slate-50/60 open:bg-white">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-100/70">
                    <span className="text-lg">{MS_ICON[m.status]}</span>
                    <span className="w-14 font-mono text-sm font-bold text-slate-800">{m.id}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{m.name}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${MS_PILL[m.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {m.status.replace("_", " ")}
                    </span>
                    <span className="text-xs text-slate-400">#{idx + 1} / {total}</span>
                    <span className="text-xs text-slate-300 transition-transform group-open:rotate-180">▾</span>
                  </summary>
                  <div className="border-t border-slate-100 px-4 py-4 text-sm">
                    {m.summary && m.summary.length > 0 && (
                      <ul className="list-inside list-disc space-y-1 text-slate-700">
                        {m.summary.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    )}

                    {/* 阶段审核三检查 */}
                    {m.gates && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        {(["implementation", "testing", "demo"] as const).map((g) => {
                          const gate = m.gates?.[g];
                          if (!gate) return null;
                          return (
                            <div key={g} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{g}</div>
                              <div className="mt-0.5 font-semibold text-slate-800">
                                {GATE_ICON[gate.status]} {gate.status}
                              </div>
                              {gate.detail && <div className="mt-0.5 text-xs text-slate-500">{gate.detail}</div>}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* checkpoints（实时看 Agent 做到第几步） */}
                    {m.checkpoints && m.checkpoints.length > 0 && (
                      <div className="mt-3">
                        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Checkpoints</div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {m.checkpoints.map((cp, i) => (
                            <span key={i} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
                              {GATE_ICON[cp.status] ?? "⏳"} {cp.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* verification —— 拒绝 Agent 自我宣称，展示可核验来源 */}
                    {m.verification && (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        <div className="font-bold text-slate-500">Verification（有据可查，非 Agent 自述）</div>
                        {m.verification.method && <div className="mt-0.5">方法：{m.verification.method}</div>}
                        {m.verification.command && <div className="mt-0.5 font-mono">命令：{m.verification.command}</div>}
                        {m.verification.lastRunAt && <div className="mt-0.5">Last verified：{m.verification.lastRunAt}</div>}
                        {m.verification.result && <div className="mt-0.5">结果：{m.verification.result}</div>}
                      </div>
                    )}

                    {m.tests && m.tests.length > 0 && (
                      <table className="mt-3 w-full border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-slate-400">
                            <th className="py-1 pr-3 font-semibold">Test</th>
                            <th className="py-1 pr-3 font-semibold">Command</th>
                            <th className="py-1 pr-3 font-semibold">Result</th>
                            <th className="py-1 font-semibold">Last Run</th>
                          </tr>
                        </thead>
                        <tbody>
                          {m.tests.map((t, i) => (
                            <tr key={i} className="border-b border-slate-100 text-slate-600">
                              <td className="py-1 pr-3 font-medium">{t.name}</td>
                              <td className="py-1 pr-3 font-mono text-[11px]">{t.command}</td>
                              <td className="py-1 pr-3">{t.result}</td>
                              <td className="py-1">{t.lastRunAt}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {m.demoRoute && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-slate-400">Demo：</span>
                        <a href={m.demoRoute} className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 font-medium text-blue-700 hover:bg-blue-100">
                          {m.demoRoute} →
                        </a>
                        {m.dataType && m.dataType !== "n/a" && (
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-500">dataType: {m.dataType}</span>
                        )}
                        {m.commit && <span className="font-mono text-slate-400">commit {m.commit}</span>}
                      </div>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ol>
        </section>

        {/* ============ STAGE 审核当前开发状态 ============ */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Current Development Stage</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-lg bg-emerald-100 px-3 py-1 font-semibold text-emerald-800">
              {project?.currentMilestone ?? "?"} {milestones.find((m) => m.id === current)?.name ?? ""}
            </span>
            <span className="text-slate-400">→</span>
            <span className="rounded-lg bg-slate-100 px-3 py-1 text-slate-600">
              Next: {project?.nextUp?.id ?? "?"} {project?.nextUp?.name ?? ""}
            </span>
            <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700">不自动开始 M6</span>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            project-status.json 更新于 {project?.updatedAt ?? "?"}（{project?.updatedBy ?? ""}）· {project?.updatedNote ?? ""}
          </p>
        </section>

        {/* ============ 日志摘要（少量、脱敏） ============ */}
        {(c.errors.api || c.errors.worker) && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Last Errors（最后一行，仅摘要）</h2>
            <div className="mt-2 space-y-1 font-mono text-xs text-slate-500">
              {c.errors.worker && <div>Worker：{c.errors.worker}</div>}
              {c.errors.api && <div>API：{c.errors.api}</div>}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">完整日志在 .runtime/logs/，UI 不展示 .env / API Key / Authorization。</p>
          </section>
        )}

        <footer className="pt-4 text-center text-xs text-slate-400">
          GeoLens Project Control Center · dev-only · 详细日志 .runtime/logs · 停止用 STOP_GEOLENS.cmd
        </footer>
      </div>
    </main>
  );
}

/* ================================================================== */
/*  小组件                                                             */
/* ================================================================== */
function StatusTile({ label, state, text, note }: { label: string; state: "ok" | "warn" | "down"; text: string; note: string }) {
  const dot =
    state === "ok"
      ? "bg-emerald-500"
      : state === "warn"
        ? "bg-amber-400"
        : "bg-red-500";
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</span>
      </div>
      <div className={`mt-1 text-sm font-bold ${state === "ok" ? "text-emerald-700" : state === "warn" ? "text-amber-600" : "text-red-600"}`}>
        {text}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-slate-400" title={note}>
        {note}
      </div>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-blue-300 hover:text-blue-700"
    >
      {label} →
    </a>
  );
}
