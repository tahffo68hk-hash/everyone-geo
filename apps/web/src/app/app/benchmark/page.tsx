"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { EvidenceDialog } from "../monitor/evidence-dialog";

/* ------------------------------------------------------------------ */
/* 类型定义（与后端 /benchmark API 返回结构一致）                        */
/* ------------------------------------------------------------------ */

type Engine = {
  id: string; key: string; name: string;
  provider: string; sourceType: string | null; model: string | null; configured: boolean;
};

type Options = {
  projects: Array<{ id: string; name: string }>;
  engines: Engine[];
};

type SuiteQuery = {
  id: string; queryText: string; category: string; intent: string;
  sortOrder: number; enabled: boolean; sanity: boolean;
};

type Suite = {
  id: string; name: string; version: string; description: string | null;
  status: string; queryCount: number; sanityQueryCount: number;
  categoryCounts: Record<string, number>;
  createdAt: string; updatedAt: string; queries: SuiteQuery[];
};

type RunRow = {
  id: string; status: string; attempt: number; errorCode: string | null; errorMessage: string | null;
  analysisStatus: string; queryText: string; benchmarkQueryId: string | null;
  category: string | null; intent: string | null; sortOrder: number | null; sanity: boolean;
};

type BenchmarkRun = {
  id: string; runType: "DEMO" | "REAL"; provider: string;
  suite: { id: string; name: string; version: string };
  engine: { id: string; key: string; name: string; provider: string };
  status: string; plannedRuns: number; completedRuns: number; failedRuns: number;
  succeededRuns: number; analyzedRuns: number; progress: number;
  terminal: boolean; metricReady: boolean;
  createdAt: string; startedAt: string | null; completedAt: string | null;
  runs: RunRow[];
};

type MetricsRow = {
  metricVersion: string; analysisVersion: string; metricSource: "demo" | "real" | "mixed";
  competitorScope: { status: string; note: string };
  suite: { id: string; name: string; version: string };
  overall: MetricBlock;
  byCategory: Array<{ category: string; queryEligibleCount: number; queryMentionedCount: number; metrics: MetricBlock }>;
  byQuery: Array<{
    benchmarkQueryId: string | null; queryText: string; category: string | null;
    intent: string | null; sortOrder: number | null; status: string; analyzed: boolean;
    brandMentioned: boolean | null; recommended: boolean | null; mentionPosition: number | null;
    sentiment: string | null; citationCount: number | null;
  }>;
};

type MetricBlock = {
  totalRuns: number; successfulRuns: number; failedRuns: number; cancelledRuns: number;
  analyzedRuns: number; analysisMissingRuns: number;
  visibilityRate: number | null; recommendationRate: number | null; averageMentionPosition: number | null;
  shareOfVoice: number | null; citationCount: number; citationDomainCount: number;
  sentimentDistribution: Record<string, number>;
  queryEligibleCount?: number; queryMentionedCount?: number;
};

/* ------------------------------------------------------------------ */
/* 常量与工具                                                           */
/* ------------------------------------------------------------------ */

const CATEGORY_LABELS: Record<string, string> = {
  "tool-discovery": "Tool Discovery",
  comparison: "Comparison",
  workflow: "Workflow / How-to",
  recommendation: "Recommendation",
  "pain-point": "Pain Point",
  competition: "Competition-specific",
  "sanity-control": "Sanity Control",
};

const statusLabels: Record<string, string> = {
  PENDING: "待执行", QUEUED: "排队中", RUNNING: "执行中", RETRYING: "重试中",
  SUCCEEDED: "成功", FAILED: "失败", PARTIAL: "部分成功", CANCELLED: "已取消",
};

const runTypeLabels: Record<string, string> = { DEMO: "Demo", REAL: "Real" };
const terminalStatuses = new Set(["SUCCEEDED", "FAILED", "PARTIAL", "CANCELLED"]);
const percent = (value: number | null) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const badge = (color: string, text: string) => `inline-block rounded px-2 py-0.5 text-xs font-semibold ${color}`;
const buttonClass = "rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "请求失败，请稍后重试。";
}

/* ------------------------------------------------------------------ */
/* 主页面                                                               */
/* ------------------------------------------------------------------ */

export default function BenchmarkPage() {
  const [options, setOptions] = useState<Options | null>(null);
  const [optionsError, setOptionsError] = useState("");
  const [projectId, setProjectId] = useState("");
  const [suites, setSuites] = useState<Suite[]>([]);
  const [suitesError, setSuitesError] = useState("");
  const [suiteId, setSuiteId] = useState("");
  const [suite, setSuite] = useState<Suite | null>(null);

  const [runType, setRunType] = useState<"demo" | "real">("demo");
  const [engineId, setEngineId] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<BenchmarkRun | null>(null);
  const [runError, setRunError] = useState("");
  const [metrics, setMetrics] = useState<MetricsRow | null>(null);
  const [metricsError, setMetricsError] = useState("");
  const [evidenceRunId, setEvidenceRunId] = useState<string | null>(null);
  const activeRun = useRef<string | null>(null);

  // ---- 加载项目/引擎 ----
  useEffect(() => {
    const controller = new AbortController();
    api<Options>("/monitor-tasks/options", { signal: controller.signal })
      .then(data => {
        setOptions(data);
        const first = data.projects[0];
        if (first) setProjectId(first.id);
      })
      .catch((error: unknown) => setOptionsError(errorText(error)));
    return () => controller.abort();
  }, []);

  // ---- 加载 suite 列表 ----
  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    setSuites([]); setSuitesError(""); setSuiteId(""); setSuite(null);
    setRunId(null); setRun(null); setMetrics(null);
    api<Suite[]>(`/projects/${encodeURIComponent(projectId)}/benchmark-suites`, { signal: controller.signal })
      .then(data => {
        setSuites(data);
        const first = data[0];
        if (first) setSuiteId(first.id);
      })
      .catch((error: unknown) => setSuitesError(errorText(error)));
    return () => controller.abort();
  }, [projectId]);

  // ---- 加载 suite 详情 ----
  useEffect(() => {
    if (!suiteId) return;
    const controller = new AbortController();
    setSuite(null);
    api<Suite>(`/benchmark-suites/${encodeURIComponent(suiteId)}`, { signal: controller.signal })
      .then(setSuite)
      .catch((error: unknown) => setSuitesError(errorText(error)));
    return () => controller.abort();
  }, [suiteId]);

  // ---- 默认选 demo 可用 mock 引擎 ----
  useEffect(() => {
    if (!options || engineId) return;
    const mock = options.engines.find(engine => engine.provider === "mock");
    setEngineId(mock?.id ?? "");
  }, [options, engineId]);

  // ---- 轮询 run ----
  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const data = await api<BenchmarkRun>(`/benchmark-runs/${encodeURIComponent(runId!)}`, { signal: controller.signal });
        if (controller.signal.aborted || activeRun.current !== runId) return;
        setRun(data);
        setRunError("");
        if (terminalStatuses.has(data.status)) setMetrics(prev => prev); // 由下方独立加载
        else timer = setTimeout(poll, 1000);
      } catch (error) {
        if (controller.signal.aborted || activeRun.current !== runId) return;
        setRunError(errorText(error));
        timer = setTimeout(poll, 3000);
      }
    }
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [runId]);

  // ---- run 终态后加载 metrics ----
  const runTerminal = run != null && terminalStatuses.has(run.status);
  useEffect(() => {
    if (!runId || !runTerminal) return;
    const controller = new AbortController();
    setMetrics(null); setMetricsError("");
    api<MetricsRow>(`/benchmark-runs/${encodeURIComponent(runId)}/metrics`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setMetrics(data); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setMetricsError(errorText(error)); });
    return () => controller.abort();
  }, [runId, runTerminal]);

  const project = options?.projects.find(item => item.id === projectId);
  const engine = options?.engines.find(item => item.id === engineId);
  const realEngine = options?.engines.find(item => item.provider === "deepseek");
  const plannedRuns = suite?.queryCount ?? 0;
  const canStart = Boolean(suite) && Boolean(engineId) && !starting;

  async function startRun() {
    if (!suiteId || !engineId || !canStart) return;
    setStarting(true); setStartError(""); setRun(null); setMetrics(null);
    try {
      const data = await api<BenchmarkRun>(`/benchmark-suites/${encodeURIComponent(suiteId)}/runs`, {
        method: "POST",
        body: JSON.stringify({ engineId, runType }),
      });
      activeRun.current = data.id;
      setRunId(data.id);
      setRun(data);
    } catch (error) {
      setStartError(errorText(error));
    } finally {
      setStarting(false);
    }
  }

  const runRowByText = new Map(run?.runs.map(row => [row.queryText, row]) ?? []);
  const selectedRunForEvidence = (queryText: string) => runRowByText.get(queryText);

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <Link href="/app" className="text-sm text-blue-700 hover:underline">← 返回工作台</Link>
          <h1 className="mt-3 text-2xl font-semibold">GEO Benchmark</h1>
          <p className="mt-2 text-sm text-slate-500">
            ProjectMentor 自然可见度基准（M6A）。Suite 版本化；每条结果可追溯到
            Query → Run → Evidence → Analysis。Demo 为 Mock 模拟，Real 才会产生真实 Provider 调用。
          </p>
        </header>

        {optionsError && <p role="alert" className="text-sm text-red-700">{optionsError}</p>}
        {!options && !optionsError && <p role="status" className="text-sm text-slate-500">正在加载项目与引擎…</p>}

        {options && (
          <>
            {/* 项目 / Suite 选择 */}
            <section aria-labelledby="suite-heading" className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 id="suite-heading" className="mb-4 text-lg font-semibold">Benchmark Suite</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="project" className="mb-2 block text-sm font-medium">项目</label>
                  <select id="project" value={projectId} className="w-full rounded-lg border border-slate-300 p-2" onChange={event => setProjectId(event.target.value)}>
                    {options.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="suite" className="mb-2 block text-sm font-medium">Suite（版本化）</label>
                  <select id="suite" value={suiteId} className="w-full rounded-lg border border-slate-300 p-2" onChange={event => setSuiteId(event.target.value)}>
                    {suites.map(item => <option key={item.id} value={item.id}>{item.name} · v{item.version}（{item.status}）</option>)}
                  </select>
                </div>
              </div>
              {suitesError && <p role="alert" className="mt-3 text-sm text-red-700">{suitesError}</p>}
              {projectId && !suitesError && !suites.length && (
                <p className="mt-3 text-sm text-slate-500">该项目暂无 Benchmark Suite（可运行 seed-benchmark-v1 创建 v1）。</p>
              )}
              {suite && (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{suite.name}</span>
                    <span className={badge("bg-blue-100 text-blue-800", `v${suite.version}`)}>Version {suite.version}</span>
                    <span className={badge("bg-emerald-100 text-emerald-800", `${suite.queryCount} Queries`)}>Query Count {suite.queryCount}</span>
                    {suite.sanityQueryCount > 0 && <span className={badge("bg-slate-100 text-slate-600", `${suite.sanityQueryCount} Sanity（不计主指标）`)} />}
                    <span className={badge(suite.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600", suite.status)}>{suite.status}</span>
                  </div>
                  {suite.description && <p className="mt-2 text-sm text-slate-600">{suite.description}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(suite.categoryCounts).map(([category, count]) => (
                      <span key={category} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600">
                        {CATEGORY_LABELS[category] ?? category} · {count}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* Query 列表（信息架构：Category → Intent → Query） */}
            {suite && (
              <section aria-labelledby="queries-heading" className="rounded-2xl border border-slate-200 bg-white p-6">
                <h2 id="queries-heading" className="mb-1 text-lg font-semibold">Benchmark v1 查询列表</h2>
                <p className="mb-3 text-xs text-slate-500">主指标只统计启用且非 sanity 的 24 条；每条运行后可在下方结果中点击查看 Evidence。</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">Benchmark queries by category</caption>
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr><th scope="col" className="p-2">#</th><th scope="col" className="p-2">Category</th><th scope="col" className="p-2">Intent</th><th scope="col" className="p-2">Query</th><th scope="col" className="p-2">状态</th></tr>
                    </thead>
                    <tbody>
                      {suite.queries.map(query => (
                        <tr key={query.id} className={`border-b border-slate-100 align-top ${query.sanity || !query.enabled ? "opacity-50" : ""}`}>
                          <td className="p-2 text-slate-400">{query.sortOrder}</td>
                          <td className="p-2 whitespace-nowrap">{CATEGORY_LABELS[query.category] ?? query.category}{query.sanity && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-700">sanity</span>}</td>
                          <td className="max-w-56 break-words p-2 text-slate-600">{query.intent}</td>
                          <td className="min-w-64 break-words p-2">{query.queryText}</td>
                          <td className="p-2 whitespace-nowrap">{query.enabled ? "启用" : "停用（不派发）"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Run 控制 + 进度 */}
            <section aria-labelledby="run-heading" className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 id="run-heading" className="mb-4 text-lg font-semibold">Benchmark Run</h2>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="runType" className="mb-2 block text-sm font-medium">Run Type</label>
                  <select id="runType" value={runType} className="w-full rounded-lg border border-slate-300 p-2" onChange={event => setRunType(event.target.value as "demo" | "real")}>
                    <option value="demo">Demo（Mock 模拟，不计入 Real）</option>
                    <option value="real">Real（DeepSeek Provider，有费用）</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="engine" className="mb-2 block text-sm font-medium">Provider / Engine</label>
                  <select id="engine" value={engineId} className="w-full rounded-lg border border-slate-300 p-2" onChange={event => setEngineId(event.target.value)}>
                    {(runType === "demo" ? options.engines.filter(item => item.provider === "mock") : options.engines.filter(item => item.provider !== "mock")).map(item => (
                      <option key={item.id} value={item.id}>{item.name}{item.provider === "deepseek" ? (item.configured ? " · REAL" : " · 未配置") : ""}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <button type="button" disabled={!canStart} onClick={() => void startRun()} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
                    {starting ? "正在创建…" : "Start Benchmark Run"}
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <div className="flex flex-wrap gap-2">
                  <span className="font-semibold">Planned：{plannedRuns} queries × 1 provider = {plannedRuns} runs</span>
                  {runType === "demo"
                    ? <span className={badge("bg-amber-100 text-amber-800", "Demo 模式 · 无真实调用")} />
                    : <span className={badge("bg-blue-100 text-blue-800", "Real 模式 · 需配置 DeepSeek 且受单任务上限约束")} />}
                  {runType === "real" && realEngine && !realEngine.configured && <span className={badge("bg-red-100 text-red-800", "DeepSeek 未配置/未启用")} />}
                </div>
                <p className="mt-2 text-xs text-slate-500">真实运行受 REAL_PROVIDER_MAX_RUNS_PER_TASK 上限保护，超出会在创建时拒绝并报出计划调用数。</p>
              </div>
              {startError && <p role="alert" className="mt-3 text-sm text-red-700">{startError}</p>}

              {runId && (
                <div className="mt-4">
                  <p className="text-xs text-slate-500">Run ID：{runId}</p>
                  {runError && <p role="alert" className="mt-2 text-sm text-red-700">{runError}</p>}
                  {!run ? <p role="status" className="mt-3 text-sm">正在读取 Run…</p> : (
                    <div role="status" className="mt-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-semibold">{runTypeLabels[run.runType] ?? run.runType} · {statusLabels[run.status] ?? run.status}</span>
                        <span className={badge(run.runType === "DEMO" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800", run.provider)}>{run.provider}</span>
                        <span className="text-slate-500">Planned {run.plannedRuns} · Completed {run.completedRuns} · Succeeded {run.succeededRuns} · Failed {run.failedRuns} · Analyzed {run.analyzedRuns}</span>
                      </div>
                      <progress aria-label="Benchmark 完成进度" className="mt-2 h-3 w-full accent-blue-700" value={run.progress} max={100} />
                      <p className="mt-1 text-xs text-slate-500">{run.progress}%</p>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* 结果（Overall / Category / Query） */}
            {metrics && (
              <section aria-labelledby="metrics-heading" className="rounded-2xl border border-slate-200 bg-white p-6">
                <h2 id="metrics-heading" className="mb-3 text-lg font-semibold">Benchmark Metrics</h2>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={badge(
                    metrics.metricSource === "demo" ? "bg-amber-100 text-amber-800"
                      : metrics.metricSource === "real" ? "bg-blue-100 text-blue-800"
                        : "bg-purple-100 text-purple-800",
                    metrics.metricSource === "demo" ? "Demo 数据（Mock）"
                      : metrics.metricSource === "real" ? "Real Provider 数据"
                        : "Mixed：仅真实子集计入 Real Benchmark",
                  )} />
                  <span className="text-slate-400">metricSource = {metrics.metricSource}</span>
                </div>
                {metrics.competitorScope?.status === "pending-m6b" && (
                  <p role="note" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    ⚠️ {metrics.competitorScope.note} —— Share of Voice 不作对外结论。
                  </p>
                )}

                {/* Overall */}
                <div className="mt-4 rounded-xl border border-slate-200 p-4">
                  <h3 className="text-sm font-semibold text-slate-700">Overall（{metrics.overall.queryEligibleCount ?? 0} eligible queries）</h3>
                  <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ["Visibility", percent(metrics.overall.visibilityRate), `${metrics.overall.queryMentionedCount ?? 0}/${metrics.overall.queryEligibleCount ?? 0}`],
                      ["Recommendation", percent(metrics.overall.recommendationRate), ""],
                      ["Avg Mention Position", metrics.overall.averageMentionPosition == null ? "—" : metrics.overall.averageMentionPosition.toFixed(2), ""],
                      ["Share of Voice", percent(metrics.overall.shareOfVoice), "（pending M6B）"],
                    ].map(([label, value, note]) => (
                      <div key={String(label)} className="rounded-lg bg-slate-50 p-3">
                        <dt className="text-xs text-slate-500">{label}</dt>
                        <dd className="mt-1 text-xl font-semibold">{value}</dd>
                        {note && <dd className="text-[10px] text-slate-400">{note}</dd>}
                      </div>
                    ))}
                  </dl>
                  <p className="mt-2 text-xs text-slate-500">Citations {metrics.overall.citationCount} · Domains {metrics.overall.citationDomainCount} · 情感：正面 {metrics.overall.sentimentDistribution.positive} / 中性 {metrics.overall.sentimentDistribution.neutral} / 负面 {metrics.overall.sentimentDistribution.negative}</p>
                </div>

                {/* by Category */}
                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-slate-700">按 Category</h3>
                  {!metrics.byCategory.length && <p className="mt-2 text-xs text-slate-500">暂无已分析结果。</p>}
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {metrics.byCategory.map(row => (
                      <div key={row.category} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{CATEGORY_LABELS[row.category] ?? row.category}</span>
                          <span className={badge(row.metrics.visibilityRate != null && row.metrics.visibilityRate > 0 ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500", `${row.queryMentionedCount}/${row.queryEligibleCount}`)}>
                            Visibility {row.queryMentionedCount}/{row.queryEligibleCount}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">Visibility Rate {percent(row.metrics.visibilityRate)} · Recommendation {percent(row.metrics.recommendationRate)}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* by Query + Evidence drill-down */}
                <div className="mt-5 overflow-x-auto">
                  <h3 className="mb-2 text-sm font-semibold text-slate-700">按 Query（点击查看 Evidence）</h3>
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">Per query benchmark results</caption>
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr><th scope="col" className="p-2">Category</th><th scope="col" className="p-2">Query</th><th scope="col" className="p-2">状态</th><th scope="col" className="p-2">Visible</th><th scope="col" className="p-2">Recommended</th><th scope="col" className="p-2">Pos</th><th scope="col" className="p-2">Evidence</th></tr>
                    </thead>
                    <tbody>
                      {metrics.byQuery.map(row => {
                        const runRow = runRowByText.get(row.queryText);
                        return (
                          <tr key={String(row.benchmarkQueryId)} className="border-b border-slate-100 align-top">
                            <td className="p-2 whitespace-nowrap text-slate-600">{row.category ? CATEGORY_LABELS[row.category] ?? row.category : "—"}</td>
                            <td className="min-w-64 break-words p-2">{row.queryText}</td>
                            <td className="p-2 whitespace-nowrap">{statusLabels[row.status] ?? row.status}</td>
                            <td className="p-2">{row.analyzed ? (row.brandMentioned ? "✓" : "✗") : "—"}</td>
                            <td className="p-2">{row.analyzed ? (row.recommended ? "✓" : "✗") : "—"}</td>
                            <td className="p-2">{row.analyzed ? row.mentionPosition ?? "—" : "—"}</td>
                            <td className="p-2 whitespace-nowrap">
                              {runRow && runRow.status === "SUCCEEDED"
                                ? <button type="button" className="text-blue-700 underline" onClick={() => setEvidenceRunId(runRow.id)}>查看 Evidence</button>
                                : <span className="text-slate-300">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {metricsError && <p role="alert" className="text-sm text-red-700">{metricsError}</p>}
          </>
        )}
      </div>
      {evidenceRunId && <EvidenceDialog key={evidenceRunId} runId={evidenceRunId} onClose={() => setEvidenceRunId(null)} />}
    </main>
  );
}
