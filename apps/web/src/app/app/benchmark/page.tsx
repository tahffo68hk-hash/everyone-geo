"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useProjectContext } from "@/components/project-context";
import { PageHeader, LoadingSkeleton, EmptyState } from "@/components/ui";
import {
  EMPTY_TEXT, formatCategory, formatProjectStatus, formatRunType, formatStatus, formatVersion, friendlyError,
} from "@/lib/labels";
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

const terminalStatuses = new Set(["SUCCEEDED", "FAILED", "PARTIAL", "CANCELLED"]);
const percent = (value: number | null) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const badge = (color: string, text: string) => `inline-block rounded px-2 py-0.5 text-xs font-semibold ${color}`;

function errorText(error: unknown) {
  return friendlyError(error);
}

/* ------------------------------------------------------------------ */
/* 主页面                                                               */
/* ------------------------------------------------------------------ */

export default function BenchmarkPage() {
  const { projectId, project, loading: projectLoading } = useProjectContext();
  const [options, setOptions] = useState<Options | null>(null);
  const [optionsError, setOptionsError] = useState("");
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

  // ---- 加载引擎选项 ----
  useEffect(() => {
    const controller = new AbortController();
    api<Options>("/monitor-tasks/options", { signal: controller.signal })
      .then(data => {
        setOptions(data);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setOptionsError(errorText(error));
      });
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
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setSuitesError(errorText(error));
      });
    return () => controller.abort();
  }, [projectId]);

  // ---- 加载 suite 详情 ----
  useEffect(() => {
    if (!suiteId) return;
    const controller = new AbortController();
    setSuite(null);
    api<Suite>(`/benchmark-suites/${encodeURIComponent(suiteId)}`, { signal: controller.signal })
      .then(setSuite)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setSuitesError(errorText(error));
      });
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

  if (projectLoading) return <LoadingSkeleton rows={6} />;
  if (!projectId) {
    return (
      <EmptyState
        title="请先选择监测项目"
        description="选择或创建项目后，方可开展基准测试集检测与指标分析。"
        href="/app/projects/new"
        action="新建监测项目"
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="GEO 基准测试"
        description="GEO 可见度基准检测（通用：适用于任意监测品牌/产品）。测试集版本化；每条结果可追溯到测试问题 → 检测记录 → 原始证据 → 分析结果。「演示」为 Mock 模拟，「真实」产生真实模型服务调用。"
      />

      {optionsError && <p role="alert" className="text-sm text-red-700">{optionsError}</p>}
      {!options && !optionsError && <p role="status" className="text-sm text-slate-500">正在加载引擎配置…</p>}

      {options && (
        <>
          {/* Suite 选择 */}
          <section aria-labelledby="suite-heading" className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 id="suite-heading" className="text-base font-bold text-slate-900">基准测试集</h2>
                <p className="text-xs text-slate-500">当前项目：<span className="font-semibold text-slate-700">{project?.name ?? "未选择"}</span></p>
              </div>
              <div className="w-full sm:w-auto min-w-[280px]">
                <label htmlFor="suite" className="sr-only">测试集（版本化）</label>
                <select id="suite" value={suiteId} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-teal-600 focus:outline-hidden" onChange={event => setSuiteId(event.target.value)}>
                  {suites.map(item => <option key={item.id} value={item.id}>{item.name} · {formatVersion(item.version)}（{formatProjectStatus(item.status)}）</option>)}
                </select>
              </div>
            </div>
            {suitesError && <p role="alert" className="mt-3 text-sm text-red-700">{suitesError}</p>}
            {projectId && !suitesError && !suites.length && (
              <p className="mt-3 text-sm text-slate-500">该项目暂无基准测试集（可运行 seed-benchmark-v1 创建 v1）。</p>
            )}
            {suite && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{suite.name}</span>
                  <span className={badge("bg-teal-100 text-teal-800", `版本 ${formatVersion(suite.version)}`)}>版本 {formatVersion(suite.version)}</span>
                  <span className={badge("bg-emerald-100 text-emerald-800", `测试问题 ${suite.queryCount}`)}>测试问题 {suite.queryCount}</span>
                  {suite.sanityQueryCount > 0 && <span className={badge("bg-slate-100 text-slate-600", `品牌控制 ${suite.sanityQueryCount}（不计主指标）`)}>品牌控制 {suite.sanityQueryCount}（不计主指标）</span>}
                  <span className={badge(suite.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600", suite.status)}>{formatProjectStatus(suite.status)}</span>
                </div>
                {suite.description && <p className="mt-2 text-sm text-slate-600">{suite.description}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(suite.categoryCounts).map(([category, count]) => (
                    <span key={category} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600">
                      {formatCategory(category)} · {count}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Query 列表（信息架构：Category → Intent → Query） */}
          {suite && (
            <section aria-labelledby="queries-heading" className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs">
              <h2 id="queries-heading" className="mb-1 text-base font-bold text-slate-900">测试问题清单</h2>
              <p className="mb-3 text-xs text-slate-500">主指标只统计启用且非品牌控制的问题（当前 {suite.queryCount - suite.sanityQueryCount} 条）；每条运行后可在下方结果中点击查看原始证据。</p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">按场景分类的测试问题</caption>
                  <thead className="border-b border-slate-200 text-slate-500">
                    <tr>
                      <th scope="col" className="p-2">#</th>
                      <th scope="col" className="p-2">场景分类</th>
                      <th scope="col" className="p-2">用户意图</th>
                      <th scope="col" className="p-2">测试问题</th>
                      <th scope="col" className="p-2">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suite.queries.map((query, index) => (
                      <tr key={query.id} className={`border-b border-slate-100 align-top ${query.sanity || !query.enabled ? "opacity-50" : ""}`}>
                        <td className="p-2 text-slate-400 font-mono text-xs">{index + 1}</td>
                        <td className="p-2 whitespace-nowrap">{formatCategory(query.category)}{query.sanity && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-700">品牌控制（sanity）</span>}</td>
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
          <section aria-labelledby="run-heading" className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs">
            <h2 id="run-heading" className="mb-4 text-base font-bold text-slate-900">基准测试运行</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="runType" className="mb-2 block text-xs font-semibold text-slate-700">运行类型</label>
                <select id="runType" value={runType} className="w-full rounded-lg border border-slate-300 p-2 text-xs" onChange={event => setRunType(event.target.value as "demo" | "real")}>
                  <option value="demo">演示（Mock 模拟，不计入真实）</option>
                  <option value="real">真实（DeepSeek 模型服务，有费用）</option>
                </select>
              </div>
              <div>
                <label htmlFor="engine" className="mb-2 block text-xs font-semibold text-slate-700">模型服务 / 检测引擎</label>
                <select id="engine" value={engineId} className="w-full rounded-lg border border-slate-300 p-2 text-xs" onChange={event => setEngineId(event.target.value)}>
                  {(runType === "demo" ? options.engines.filter(item => item.provider === "mock") : options.engines.filter(item => item.provider !== "mock")).map(item => (
                    <option key={item.id} value={item.id}>{item.name}{item.provider === "deepseek" || item.provider === "qwen" ? (item.configured ? " · 真实数据" : " · 未配置") : ""}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button type="button" disabled={!canStart} onClick={() => void startRun()} className="w-full rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50">
                  {starting ? "正在创建…" : runType === "demo" ? "开始演示测试" : "开始真实测试"}
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
              <div className="flex flex-wrap gap-2">
                <span className="font-semibold text-slate-700">计划运行数：{plannedRuns} 个测试问题 × 1 个模型服务 = {plannedRuns} 次运行</span>
                {runType === "demo"
                  ? <span className={badge("bg-amber-100 text-amber-800", "演示模式 · 无真实调用")} />
                  : <span className={badge("bg-teal-100 text-teal-800", "真实模式 · 需配置 DeepSeek 且受单任务上限约束")} />}
                {runType === "real" && realEngine && !realEngine.configured && <span className={badge("bg-red-100 text-red-800", "DeepSeek 未配置/未启用")} />}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">真实运行受 REAL_PROVIDER_MAX_RUNS_PER_TASK 上限保护，超出会在创建时拒绝并报出计划调用数。</p>
            </div>
            {startError && <p role="alert" className="mt-3 text-sm text-red-700">{startError}</p>}

            {runId && (
              <div className="mt-4">
                <p className="text-xs text-slate-500">检测记录 ID（Run ID）：<code className="font-mono text-slate-700">{runId}</code></p>
                {runError && <p role="alert" className="mt-2 text-sm text-red-700">{runError}</p>}
                {!run ? <p role="status" className="mt-3 text-sm text-slate-500">正在读取检测记录…</p> : (
                  <div role="status" className="mt-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold">{formatRunType(run.runType)} · {formatStatus(run.status)}</span>
                      <span className={badge(run.runType === "DEMO" ? "bg-amber-100 text-amber-800" : "bg-teal-100 text-teal-800", run.provider)}>{run.provider}</span>
                      <span className="text-slate-500">计划 {run.plannedRuns} · 已完成 {run.completedRuns} · 成功 {run.succeededRuns} · 失败 {run.failedRuns} · 已分析 {run.analyzedRuns}</span>
                    </div>
                    <progress aria-label="基准测试完成进度" className="mt-2 h-2.5 w-full accent-teal-700" value={run.progress} max={100} />
                    <p className="mt-1 text-xs text-slate-500">{run.progress}%</p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 结果（Overall / Category / Query） */}
          {metrics && (
            <section aria-labelledby="metrics-heading" className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs">
              <h2 id="metrics-heading" className="mb-3 text-base font-bold text-slate-900">基准测试指标</h2>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={badge(
                  metrics.metricSource === "demo" ? "bg-amber-100 text-amber-800"
                    : metrics.metricSource === "real" ? "bg-teal-100 text-teal-800"
                      : "bg-purple-100 text-purple-800",
                  metrics.metricSource === "demo" ? "演示数据（Mock）"
                    : metrics.metricSource === "real" ? "真实数据"
                      : "混合：仅真实子集计入真实基准",
                )} />
                <span className="text-slate-400">metricSource = {metrics.metricSource}</span>
              </div>
              {metrics.competitorScope?.status === "pending-m6b" && (
                <p role="note" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {metrics.competitorScope.note} —— AI 声量份额（Share of Voice）不作对外结论。
                </p>
              )}

              {/* Overall */}
              <div className="mt-4 rounded-lg border border-slate-200 p-4">
                <h3 className="text-xs font-bold text-slate-700">总体表现（{metrics.overall.queryEligibleCount ?? 0} 条有效问题）</h3>
                <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ["品牌可见率", percent(metrics.overall.visibilityRate), `${metrics.overall.queryMentionedCount ?? 0}/${metrics.overall.queryEligibleCount ?? 0}`],
                    ["推荐率", percent(metrics.overall.recommendationRate), ""],
                    ["平均提及位置", metrics.overall.averageMentionPosition == null ? "—" : metrics.overall.averageMentionPosition.toFixed(2), ""],
                    ["AI 声量份额（Share of Voice）", percent(metrics.overall.shareOfVoice), "演示/小样本口径，不作行业结论"],
                  ].map(([label, value, note]) => (
                    <div key={String(label)} className="rounded-lg bg-slate-50 p-3">
                      <dt className="text-xs text-slate-500">{label}</dt>
                      <dd className="mt-1 text-xl font-bold text-slate-900 tabular-nums">{value}</dd>
                      {note && <dd className="text-[10px] text-slate-400 mt-0.5">{note}</dd>}
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-xs text-slate-500">引用次数 {metrics.overall.citationCount} · 引用域名 {metrics.overall.citationDomainCount} · 情感：正面 {metrics.overall.sentimentDistribution.positive} / 中性 {metrics.overall.sentimentDistribution.neutral} / 负面 {metrics.overall.sentimentDistribution.negative}</p>
              </div>

              {/* by Category */}
              <div className="mt-4">
                <h3 className="text-xs font-bold text-slate-700">按场景分类</h3>
                {!metrics.byCategory.length && <p className="mt-2 text-xs text-slate-500">{EMPTY_TEXT.analyses}</p>}
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {metrics.byCategory.map(row => (
                    <div key={row.category} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-900">{formatCategory(row.category)}</span>
                        <span className={badge(row.metrics.visibilityRate != null && row.metrics.visibilityRate > 0 ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500", `${row.queryMentionedCount}/${row.queryEligibleCount}`)}>
                          被提及 {row.queryMentionedCount}/{row.queryEligibleCount}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">品牌可见率 {percent(row.metrics.visibilityRate)} · 推荐率 {percent(row.metrics.recommendationRate)}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* by Query + Evidence drill-down */}
              <div className="mt-5 overflow-x-auto">
                <h3 className="mb-2 text-xs font-bold text-slate-700">按问题（点击查看原始证据）</h3>
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">按问题查看基准测试结果</caption>
                  <thead className="border-b border-slate-200 text-slate-500 text-xs">
                    <tr><th scope="col" className="p-2">场景分类</th><th scope="col" className="p-2">测试问题</th><th scope="col" className="p-2">状态</th><th scope="col" className="p-2">提及品牌</th><th scope="col" className="p-2">被推荐</th><th scope="col" className="p-2">位置</th><th scope="col" className="p-2">原始证据</th></tr>
                  </thead>
                  <tbody>
                    {metrics.byQuery.map(row => {
                      const runRow = runRowByText.get(row.queryText);
                      return (
                        <tr key={String(row.benchmarkQueryId)} className="border-b border-slate-100 align-top">
                          <td className="p-2 whitespace-nowrap text-slate-600">{row.category ? formatCategory(row.category) : "—"}</td>
                          <td className="min-w-64 break-words p-2">{row.queryText}</td>
                          <td className="p-2 whitespace-nowrap">{formatStatus(row.status)}</td>
                          <td className="p-2">{row.analyzed ? (row.brandMentioned ? "✓" : "✗") : "—"}</td>
                          <td className="p-2">{row.analyzed ? (row.recommended ? "✓" : "✗") : "—"}</td>
                          <td className="p-2">{row.analyzed ? row.mentionPosition ?? "—" : "—"}</td>
                          <td className="p-2 whitespace-nowrap">
                            {runRow && runRow.status === "SUCCEEDED"
                              ? <button type="button" className="text-teal-700 underline hover:text-teal-800 text-xs font-medium" onClick={() => setEvidenceRunId(runRow.id)}>查看原始证据</button>
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

          {/* M6C：已完成 Run → 生成不可变 GEO 报告 */}
          {run && run.terminal && (
            <ReportBuilder benchmarkRunId={run.id} runType={run.runType} />
          )}
        </>
      )}

      {evidenceRunId && <EvidenceDialog key={evidenceRunId} runId={evidenceRunId} onClose={() => setEvidenceRunId(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* M6C：报告生成（快照语义：analysisVersion 显式选择）                    */
/* ------------------------------------------------------------------ */
function ReportBuilder({ benchmarkRunId, runType }: { benchmarkRunId: string; runType: string }) {
  const [version, setVersion] = useState("m4-rule-v1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdId, setCreatedId] = useState("");

  async function generate() {
    setBusy(true); setError(""); setCreatedId("");
    try {
      const body = await api<{ id: string; analysisVersion: string }>(
        `/benchmark-runs/${encodeURIComponent(benchmarkRunId)}/reports`,
        { method: "POST", body: JSON.stringify({ analysisVersion: version }) },
      );
      setCreatedId(body.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs">
      <h2 className="text-base font-bold text-slate-900">生成 GEO 基准测试报告</h2>
      <p className="mt-1 text-xs text-slate-500">报告 = 不可变快照：生成后测试集 / 分析版本 / 竞品集合 / 指标不再漂移。{runType === "DEMO" ? "演示数据，仅供功能验证。" : "真实数据。"}</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-slate-700">
          分析版本（analysisVersion）
          <select value={version} onChange={event => setVersion(event.target.value)} className="mt-1 block rounded-lg border border-slate-300 p-2 font-mono text-xs">
            <option value="m4-rule-v1">m4-rule-v1</option>
            <option value="m6b-competitors-v1">m6b-competitors-v1（含竞品集，需已重分析）</option>
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => void generate()}
          className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
          {busy ? "生成中…" : "生成报告"}
        </button>
        <Link href="/app/reports" className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
          查看报告列表
        </Link>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      {createdId && (
        <p role="status" className="mt-2 text-sm text-emerald-700">
          报告已生成（analysisVersion 快照已冻结）：{" "}
          <Link href={`/app/reports/${createdId}`} className="text-teal-700 underline font-medium">打开 GEO 报告 →</Link>
        </p>
      )}
    </section>
  );
}
