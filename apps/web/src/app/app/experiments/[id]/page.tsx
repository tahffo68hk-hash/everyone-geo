"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import {
  EVALUATION_VERSION_LABEL, EXPERIMENT_VERSION_LABEL, formatDeltaDirection,
  formatDeltaText, formatExecutionType, formatExperimentStatus, formatExperimentVerdict,
  formatMeaningful, formatMetricValue, formatOutcome, formatQueryTransition,
  formatWarningCode, friendlyError, EXPERIMENT_NAV, EXECUTION_TYPE,
  formatMetricSource, OPPORTUNITY_NAV,
} from "@/lib/labels";
import { EvidenceDialog } from "../../monitor/evidence-dialog";

type Experiment = {
  id: string; contentOpportunityId: string; experimentVersion: string; title: string; hypothesis: string;
  status: string; baselineReportId: string; querySetFingerprint: string;
  metricSource: string; provider: string; engineKey: string | null; engineName: string | null;
  requestedModel: string | null; responseModel: string | null;
  analysisVersion: string; competitorSetVersion: string | null;
  suiteName: string | null; suiteVersion: string | null; plannedQueryCount: number;
  executionRecordedAt: string | null; completedAt: string | null;
  executionCount?: number | null; retestCount?: number | null; evaluationCount?: number | null;
  createdAt: string; metadata: { contentOpportunityTitleDirection?: string; contentOpportunityType?: string } | null;
};
type Execution = {
  id: string; executionType: string; changeSummary: string; assetType: string | null;
  assetReference: string | null; executedAt: string; status: string;
};
type Retest = {
  id: string; sequence: number; benchmarkRunId: string | null; reportId: string | null;
  status: string; runType: string; provider: string; plannedQueryCount: number;
  expectedCallCount: number; querySetFingerprint: string;
  startedAt: string | null; completedAt: string | null;
  live?: { status: string; terminal: boolean; progress: number; succeededRuns: number; failedRuns: number } | null;
};
type Evaluation = {
  id: string; retestId: string; evaluationVersion: string; beforeReportId: string; afterReportId: string;
  outcome: string; verdict: string | null; warnings: Array<{ code: string; message: string }>;
  inconclusiveReasons: string[];
  summary: {
    queryCounts?: { evaluated: number; notEvaluable: number; gainedVisibility: number; lostVisibility: number; gainedRecommendation: number; lostRecommendation: number; positionImproved: number; positionDeclined: number; unchanged: number };
    warnings?: string[];
    coverage?: { beforeSucceeded: number; afterSucceeded: number; afterRatio: number | null };
  } | null;
  metricSource: string; generatedAt: string;
  metricDeltaCount?: number | null; queryDeltaCount?: number | null;
};
type MetricDelta = { id: string; metricName: string; beforeValue: number | null; afterValue: number | null; deltaValue: number | null; deltaUnit: string; direction: string | null; meaningful: string; primarySignal: boolean };
type QueryDelta = {
  id: string; sortOrder: number; queryText: string; category: string | null;
  beforeMentioned: boolean | null; afterMentioned: boolean | null;
  beforeRecommended: boolean | null; afterRecommended: boolean | null;
  beforePosition: number | null; afterPosition: number | null;
  beforeCitationCount: number | null; afterCitationCount: number | null;
  transitionType: string; status: string;
};
type Pair = { before: { evidenceId: string; runId: string; queryText: string } | null; after: { evidenceId: string; runId: string; queryText: string } | null };

const STATUS_BADGE: Record<string, string> = {
  PLANNED: "bg-slate-100 text-slate-600", EXECUTION_RECORDED: "bg-blue-100 text-blue-800",
  RETEST_READY: "bg-indigo-100 text-indigo-800", RETEST_RUNNING: "bg-amber-100 text-amber-800",
  READY_FOR_EVALUATION: "bg-orange-100 text-orange-800", EVALUATED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-slate-200 text-slate-500",
};
const OUTCOME_BADGE: Record<string, string> = {
  IMPROVED_SIGNALS: "bg-emerald-100 text-emerald-800",
  MIXED_SIGNALS: "bg-amber-100 text-amber-800",
  NO_CLEAR_CHANGE: "bg-slate-100 text-slate-600",
  REGRESSED_SIGNALS: "bg-blue-100 text-blue-800",
  INCONCLUSIVE: "bg-red-50 text-red-700",
};
const METRIC_ORDER = ["visibilityRate", "recommendationRate", "averageMentionPosition", "shareOfVoice", "citationCount", "citationDomainCount"];

export default function ExperimentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [exp, setExp] = useState<Experiment | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [retests, setRetests] = useState<Retest[]>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [operating, setOperating] = useState(false);
  const [plan, setPlan] = useState<null | Record<string, unknown>>(null);
  const [evidenceRunId, setEvidenceRunId] = useState<string | null>(null);
  // 执行表单
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ executionType: "MANUAL_CONTENT_UPDATE", changeSummary: "", assetType: "", assetReference: "", executedAt: new Date().toISOString().slice(0, 16) });
  // 评估展开
  const [selectedEvalId, setSelectedEvalId] = useState<string | null>(null);
  const [metricDeltas, setMetricDeltas] = useState<MetricDelta[]>([]);
  const [queryDeltas, setQueryDeltas] = useState<QueryDelta[]>([]);
  const [queryFilter, setQueryFilter] = useState("");
  const [pair, setPair] = useState<Pair | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const [e, ex, rt, evs] = await Promise.all([
        api<Experiment>(`/experiments/${id}`),
        api<{ executions: Execution[] }>(`/experiments/${id}/executions`),
        api<{ retests: Retest[] }>(`/experiments/${id}/retests`),
        api<{ evaluations: Evaluation[] }>(`/experiments/${id}/evaluations`),
      ]);
      setExp(e); setExecutions(ex.executions); setRetests(rt.retests); setEvaluations(evs.evaluations);
      if (evs.evaluations.length > 0 && !selectedEvalId) setSelectedEvalId(evs.evaluations[0].id);
    } catch (err) { setError(friendlyError(err)); }
    finally { setLoading(false); }
  }, [id, selectedEvalId]);

  useEffect(() => { void load(); }, [load]);

  const latestEvaluation = evaluations[0] ?? null;

  const loadEvaluation = useCallback(async (evalId: string) => {
    try {
      const [m, q] = await Promise.all([
        api<{ metricDeltas: MetricDelta[] }>(`/experiment-evaluations/${evalId}/metric-deltas`),
        api<{ queryDeltas: QueryDelta[] }>(`/experiment-evaluations/${evalId}/query-deltas`),
      ]);
      setMetricDeltas(m.metricDeltas);
      setQueryDeltas(q.queryDeltas);
    } catch (err) { setError(friendlyError(err)); }
  }, []);

  useEffect(() => { if (selectedEvalId) void loadEvaluation(selectedEvalId); }, [selectedEvalId, loadEvaluation]);

  async function recordExecution() {
    if (!exp) return;
    setOperating(true); setError("");
    try {
      await api(`/experiments/${exp.id}/executions`, {
        method: "POST",
        body: JSON.stringify({
          executionType: form.executionType,
          changeSummary: form.changeSummary,
          assetType: form.assetType || undefined,
          assetReference: form.assetReference || undefined,
          executedAt: new Date(form.executedAt).toISOString(),
        }),
      });
      setFormOpen(false);
      setForm(prev => ({ ...prev, changeSummary: "", assetReference: "", assetType: "" }));
      await load();
    } catch (err) { setError(friendlyError(err)); }
    finally { setOperating(false); }
  }
  async function preparePlan() {
    if (!exp) return;
    setOperating(true); setError("");
    try {
      const p = await api<Record<string, unknown>>(`/experiments/${exp.id}/retest-plan`, { method: "POST" });
      setPlan(p);
    } catch (err) { setError(friendlyError(err)); }
    finally { setOperating(false); }
  }
  async function startRetest() {
    if (!exp) return;
    const real = exp.metricSource === "real";
    if (real && !window.confirm(`${EXPERIMENT_NAV.confirmRealRetest}：预计 ${plan?.expectedCallCount ?? exp.plannedQueryCount} 次真实模型调用。`)) return;
    setOperating(true); setError("");
    try {
      await api(`/experiments/${exp.id}/retests`, { method: "POST" });
      setPlan(null);
      await load();
    } catch (err) { setError(friendlyError(err)); }
    finally { setOperating(false); }
  }
  async function refreshRetest(r: Retest) {
    try {
      const detail = await api<Retest>(`/experiment-retests/${r.id}`);
      setRetests(prev => prev.map(x => x.id === r.id ? detail : x));
    } catch (err) { setError(friendlyError(err)); }
  }
  async function evaluate(r: Retest) {
    setOperating(true); setError("");
    try {
      await api(`/experiment-retests/${r.id}/evaluate`, { method: "POST" });
      await load();
    } catch (err) { setError(friendlyError(err)); }
    finally { setOperating(false); }
  }
  async function cancelExperiment() {
    if (!exp || !window.confirm("确定取消该实验吗？")) return;
    setOperating(true); setError("");
    try {
      await api(`/experiments/${exp.id}/status`, { method: "PATCH", body: JSON.stringify({ status: "CANCELLED" }) });
      await load();
    } catch (err) { setError(friendlyError(err)); }
    finally { setOperating(false); }
  }
  async function openEvidenceAB(q: QueryDelta) {
    try {
      const res = await api<Pair>(`/experiment-query-deltas/${q.id}/evidence`);
      setPair(res);
    } catch (err) { setError(friendlyError(err)); }
  }

  const filteredQueries = useMemo(() => {
    if (!queryFilter) return queryDeltas;
    if (queryFilter === "NOT_EVALUABLE") return queryDeltas.filter(q => q.status === "NOT_EVALUABLE");
    return queryDeltas.filter(q => q.transitionType === queryFilter);
  }, [queryDeltas, queryFilter]);

  const shownEval = evaluations.find(e => e.id === selectedEvalId) ?? latestEvaluation;

  if (loading) {
    return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><div className="mx-auto max-w-6xl space-y-3"><div className="h-4 w-1/3 animate-pulse rounded bg-slate-200" /><div className="h-10 w-2/3 animate-pulse rounded bg-slate-200" /><div className="h-40 animate-pulse rounded-2xl bg-slate-200" /><div className="h-64 animate-pulse rounded-2xl bg-slate-200" /></div></main>;
  }

  const real = exp?.metricSource === "real";

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <Link href="/app/experiments" className="text-sm text-blue-700 hover:underline">← 返回优化实验列表</Link>
          <h1 className="mt-3 text-2xl font-semibold">优化实验</h1>
          <p className="mt-2 text-sm text-slate-500">
            实验版本：{exp?.experimentVersion ?? EXPERIMENT_VERSION_LABEL} · 评估版本：{EVALUATION_VERSION_LABEL}
            {exp?.contentOpportunityId ? <> · <Link href={`/app/opportunities/${exp.contentOpportunityId}`} className="text-blue-700 hover:underline">来源内容机会</Link></> : ""}
          </p>
        </header>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {exp && (
          <>
            {/* Header */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[exp.status] ?? ""}`}>{formatExperimentStatus(exp.status)}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{formatMetricSource(exp.metricSource)}</span>
                {!real && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">{EXPERIMENT_NAV.demoLabel}</span>}
                <span className="rounded bg-teal-100 px-2 py-0.5 text-xs text-teal-800">Provider：{exp.provider} · {exp.engineKey ?? "—"}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">请求模型：{exp.requestedModel ?? "—"}</span>
                <span className="text-xs text-slate-400">Query {exp.plannedQueryCount} · 评估 {evaluations.length}</span>
                {exp.status === "CANCELLED" && <span className="text-xs text-red-600">已取消</span>}
                {!["EVALUATED", "CANCELLED"].includes(exp.status) && (
                  <button type="button" disabled={operating} onClick={() => void cancelExperiment()} className="ml-auto rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50">取消实验</button>
                )}
              </div>
              <h2 className="mt-3 text-lg font-semibold">{exp.title}</h2>
              <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><span className="font-semibold">{EXPERIMENT_NAV.hypothesis}：</span>{exp.hypothesis}</p>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                <span>创建 {new Date(exp.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
                {exp.executionRecordedAt && <span>执行记录于 {new Date(exp.executionRecordedAt).toLocaleString("zh-CN", { hour12: false })}</span>}
                {exp.completedAt && <span>评估完成 {new Date(exp.completedAt).toLocaleString("zh-CN", { hour12: false })}</span>}
                <span className="break-all font-mono text-[10px]">指纹 {exp.querySetFingerprint.slice(0, 24)}…</span>
              </div>
            </section>

            {/* Baseline */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-base font-semibold">{EXPERIMENT_NAV.baseline}</h2>
              <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
                <div><dt className="text-xs text-slate-500">套件</dt><dd className="font-medium">{exp.suiteName ? `${exp.suiteName} v${exp.suiteVersion ?? ""}` : "—"}</dd></div>
                <div><dt className="text-xs text-slate-500">测试问题</dt><dd className="font-medium">{exp.plannedQueryCount}</dd></div>
                <div><dt className="text-xs text-slate-500">分析版本</dt><dd className="break-all font-mono text-xs">{exp.analysisVersion}</dd></div>
                <div><dt className="text-xs text-slate-500">竞品集</dt><dd className="font-medium">{exp.competitorSetVersion ?? "无"}</dd></div>
                <div><dt className="text-xs text-slate-500">请求/响应模型</dt><dd className="break-all text-xs">{exp.requestedModel ?? "—"} / {exp.responseModel ?? "—"}</dd></div>
                <div><dt className="text-xs text-slate-500">测试集指纹（SHA-256）</dt><dd className="break-all font-mono text-[10px]">{exp.querySetFingerprint}</dd></div>
              </div>
            </section>

            {/* Execution */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">{EXPERIMENT_NAV.execution}</h2>
                {executions.length === 0 && (
                  <button type="button" className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800" onClick={() => setFormOpen(v => !v)}>
                    {EXPERIMENT_NAV.recordExecution}
                  </button>
                )}
                <span className="ml-auto text-xs text-slate-400">{EXPERIMENT_NAV.userConfirmed}</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">{EXPERIMENT_NAV.executionHint}</p>
              {formOpen && executions.length === 0 && (
                <div className="mt-3 space-y-2 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block text-sm"><span className="mb-1 block text-xs text-slate-500">执行类型</span>
                      <select className="w-full rounded border border-slate-300 p-2 text-sm" value={form.executionType} onChange={e => setForm(p => ({ ...p, executionType: e.target.value }))}>
                        {Object.entries(EXECUTION_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </label>
                    <label className="block text-sm"><span className="mb-1 block text-xs text-slate-500">执行时间</span>
                      <input type="datetime-local" className="w-full rounded border border-slate-300 p-2 text-sm" value={form.executedAt} onChange={e => setForm(p => ({ ...p, executedAt: e.target.value }))} />
                    </label>
                  </div>
                  <label className="block text-sm"><span className="mb-1 block text-xs text-slate-500">修改摘要</span>
                    <textarea className="w-full rounded border border-slate-300 p-2 text-sm" rows={2} value={form.changeSummary} onChange={e => setForm(p => ({ ...p, changeSummary: e.target.value }))} placeholder="例如：更新产品定义，新增工具发现类场景说明与 FAQ" />
                  </label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block text-sm"><span className="mb-1 block text-xs text-slate-500">优化对象（assetType）</span>
                      <input className="w-full rounded border border-slate-300 p-2 text-sm" value={form.assetType} onChange={e => setForm(p => ({ ...p, assetType: e.target.value }))} placeholder="如 PRODUCT_PAGE" />
                    </label>
                    <label className="block text-sm"><span className="mb-1 block text-xs text-slate-500">{EXPERIMENT_NAV.assetReferenceLabel}（URL / 标识，系统不访问）</span>
                      <input className="w-full rounded border border-slate-300 p-2 text-sm" value={form.assetReference} onChange={e => setForm(p => ({ ...p, assetReference: e.target.value }))} placeholder="https://…" />
                    </label>
                  </div>
                  <button type="button" disabled={operating || !form.changeSummary.trim()} onClick={() => void recordExecution()} className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50">
                    {operating ? "保存中…" : `${EXPERIMENT_NAV.recordExecution}（用户确认）`}
                  </button>
                </div>
              )}
              {executions.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {executions.map(e => (
                    <li key={e.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">{formatExecutionType(e.executionType)}</span>
                        <span className="text-slate-700">{e.changeSummary}</span>
                        <span className="ml-auto text-xs text-slate-400">执行于 {new Date(e.executedAt).toLocaleString("zh-CN", { hour12: false })}</span>
                      </div>
                      {e.assetReference && <p className="mt-1 break-all text-xs text-slate-500">{EXPERIMENT_NAV.assetReferenceLabel}：{e.assetReference}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Retest Plan */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{EXPERIMENT_NAV.retestPlan}</h2>
                {!plan && executions.length > 0 && exp.status !== "CANCELLED" && (
                  <button type="button" disabled={operating} onClick={() => void preparePlan()} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50">{EXPERIMENT_NAV.planTitle}</button>
                )}
              </div>
              {executions.length === 0 && exp.status !== "CANCELLED" && <p className="mt-2 text-xs text-slate-500">{EXPERIMENT_NAV.noExecutionFirst}</p>}
              {plan && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4 text-sm">
                  <p className="font-medium">即将以基线冻结口径复测：</p>
                  <p className="mt-1 text-xs text-slate-600">测试问题：{String(plan.queryCount)} · Provider：{String(plan.provider)} · 请求模型：{String(plan.requestedModel ?? "—")} · 数据类型：{formatMetricSource(String(plan.metricSource))} · 分析版本：{String(plan.analysisVersion)} · 预计调用：{String(plan.expectedCallCount)}</p>
                  {real ? (
                    <button type="button" disabled={operating} onClick={() => void startRetest()} className="mt-2 rounded-lg bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50">{EXPERIMENT_NAV.confirmRealRetest}</button>
                  ) : (
                    <button type="button" disabled={operating} onClick={() => void startRetest()} className="mt-2 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50">{operating ? "启动中…" : EXPERIMENT_NAV.startDemoRetest}（0 成本）</button>
                  )}
                </div>
              )}
              {retests.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {[...retests].sort((a, b) => b.sequence - a.sequence).map(r => (
                    <li key={r.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">复测 #{r.sequence}</span>
                        <span className="text-xs text-slate-500">{r.provider} · {r.plannedQueryCount} 问题 · 预计 {r.expectedCallCount} 次调用</span>
                        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${r.status === "SUCCEEDED" ? "bg-emerald-100 text-emerald-800" : r.status === "RUNNING" || r.status === "QUEUED" ? "bg-amber-100 text-amber-800" : r.status === "FAILED" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>
                          {r.status === "SUCCEEDED" ? "已完成" : r.status === "RUNNING" ? "复测中" : r.status === "QUEUED" ? "排队中" : r.status === "PARTIAL" ? "部分完成" : r.status === "FAILED" ? "失败" : r.status}
                        </span>
                        <span className="flex-1" />
                        <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => void refreshRetest(r)}>刷新</button>
                        {r.status !== "SUCCEEDED" && r.status !== "PARTIAL" && r.status !== "FAILED" && r.status !== "QUEUED" && r.status !== "RUNNING" && (
                          <button type="button" disabled={operating} onClick={() => void evaluate(r)} className="rounded-lg bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50">评估</button>
                        )}
                        {(r.status === "SUCCEEDED" || r.status === "PARTIAL") && !evaluations.some(ev => ev.retestId === r.id) && (
                          <button type="button" disabled={operating} onClick={() => void evaluate(r)} className="rounded-lg bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50">{EXPERIMENT_NAV.generate}</button>
                        )}
                      </div>
                      {r.live?.terminal && <p className="mt-1 text-xs text-slate-500">成功 {r.live.succeededRuns} / 失败 {r.live.failedRuns} · 进度 {r.live.progress}%</p>}
                    </li>
                  ))}
                </ul>
              )}
              {!real && retests.length > 0 && <p className="mt-2 text-xs text-amber-700">{EXPERIMENT_NAV.demoTip}</p>}
            </section>

            {/* Outcome / Evaluation */}
            {shownEval && (
              <>
                <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                  {EXPERIMENT_NAV.evaluationNote}
                  <p className="mt-1 text-xs text-amber-700">{EXPERIMENT_NAV.observedNotProven}</p>
                </section>
                <section className="rounded-2xl border border-slate-200 bg-white p-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-base font-semibold">{EXPERIMENT_NAV.observedOutcome}</h2>
                    <span className={`rounded px-2 py-0.5 text-sm font-semibold ${OUTCOME_BADGE[shownEval.outcome] ?? ""}`}>{formatOutcome(shownEval.outcome)}</span>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{formatExperimentVerdict(shownEval.verdict)}</span>
                    <span className="text-xs text-slate-400">{formatMetricSource(shownEval.metricSource)} · {new Date(shownEval.generatedAt).toLocaleString("zh-CN", { hour12: false })}</span>
                    {evaluations.length > 1 && (
                      <select aria-label="评估版本" className="ml-auto rounded border border-slate-300 p-1 text-xs" value={shownEval.id} onChange={e => setSelectedEvalId(e.target.value)}>
                        {evaluations.map(ev => <option key={ev.id} value={ev.id}>{ev.evaluationVersion} · {new Date(ev.generatedAt).toLocaleDateString("zh-CN")}</option>)}
                      </select>
                    )}
                  </div>
                  {(shownEval.summary?.queryCounts) && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                      <span>新增可见 <b className="text-emerald-700">{shownEval.summary.queryCounts.gainedVisibility}</b></span>
                      <span>失去可见 <b>{shownEval.summary.queryCounts.lostVisibility}</b></span>
                      <span>新增推荐 <b className="text-emerald-700">{shownEval.summary.queryCounts.gainedRecommendation}</b></span>
                      <span>位置改善 <b className="text-emerald-700">{shownEval.summary.queryCounts.positionImproved}</b></span>
                      <span>位置下降 <b>{shownEval.summary.queryCounts.positionDeclined}</b></span>
                      <span>无变化 <b>{shownEval.summary.queryCounts.unchanged}</b></span>
                      <span>不可评估 <b className="text-red-600">{shownEval.summary.queryCounts.notEvaluable}</b></span>
                    </div>
                  )}
                  {(shownEval.warnings?.length ?? 0) > 0 && (
                    <div className="mt-3 rounded-lg bg-amber-50 p-3">
                      <p className="text-xs font-semibold text-amber-800">{EXPERIMENT_NAV.warningsLabel}</p>
                      <ul className="mt-1 space-y-1 text-xs text-amber-800">
                        {shownEval.warnings.map((w, i) => <li key={i}>· {formatWarningCode(w.code, w.message)}</li>)}
                      </ul>
                    </div>
                  )}
                </section>

                {/* KPI Before/After */}
                <section className="rounded-2xl border border-slate-200 bg-white p-6">
                  <h2 className="text-base font-semibold">{EXPERIMENT_NAV.beforeAfterKpi}</h2>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[640px] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                          <th className="px-3 py-2 font-medium">指标</th>
                          <th className="px-3 py-2 text-right font-medium">Before</th>
                          <th className="px-3 py-2 text-right font-medium">After</th>
                          <th className="px-3 py-2 text-right font-medium">观察变化</th>
                          <th className="px-3 py-2 font-medium">方向</th>
                          <th className="px-3 py-2 font-medium">强度（internal）</th>
                          <th className="px-3 py-2 font-medium">信号</th>
                        </tr>
                      </thead>
                      <tbody>
                        {METRIC_ORDER.map(name => {
                          const d = metricDeltas.find(x => x.metricName === name);
                          if (!d) return null;
                          return (
                            <tr key={name} className="h-10 border-b border-slate-100 last:border-0">
                              <td className="px-3 text-slate-700">{EXPERIMENT_NAV.kpi[name as keyof typeof EXPERIMENT_NAV.kpi] ?? name}</td>
                              <td className="px-3 text-right">{formatMetricValue(name, d.beforeValue)}</td>
                              <td className="px-3 text-right">{formatMetricValue(name, d.afterValue)}</td>
                              <td className="px-3 text-right font-medium text-slate-800">{formatDeltaText(name, d.deltaValue, d.deltaUnit)}</td>
                              <td className="px-3">{d.direction ? formatDeltaDirection(d.direction) : "—"}</td>
                              <td className="px-3">{formatMeaningful(d.meaningful)}</td>
                              <td className="px-3">{d.primarySignal ? <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">{EXPERIMENT_NAV.primaryLabel}</span> : <span className="text-xs text-slate-400">{EXPERIMENT_NAV.secondaryLabel}</span>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>

                {/* Query Delta Table */}
                <section className="rounded-2xl border border-slate-200 bg-white p-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-base font-semibold">{EXPERIMENT_NAV.queryDeltaTable}（{queryDeltas.length}）</h2>
                    <select aria-label="Query 变化过滤" className="rounded border border-slate-300 p-1 text-xs" value={queryFilter} onChange={e => setQueryFilter(e.target.value)}>
                      <option value="">全部变化</option>
                      <option value="GAINED_VISIBILITY">新增可见</option>
                      <option value="LOST_VISIBILITY">失去可见</option>
                      <option value="GAINED_RECOMMENDATION">新增推荐</option>
                      <option value="POSITION_IMPROVED">位置改善</option>
                      <option value="POSITION_DECLINED">位置下降</option>
                      <option value="CITATION_GAINED">引用增加</option>
                      <option value="CITATION_LOST">引用减少</option>
                      <option value="UNCHANGED">无变化</option>
                      <option value="NOT_EVALUABLE">不可评估</option>
                    </select>
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[960px] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                          <th className="px-3 py-2 font-medium">监测问题</th>
                          <th className="px-3 py-2 font-medium">可见度</th>
                          <th className="px-3 py-2 font-medium">推荐</th>
                          <th className="px-3 py-2 font-medium">位置</th>
                          <th className="px-3 py-2 font-medium">引用</th>
                          <th className="px-3 py-2 font-medium">状态</th>
                          <th className="px-3 py-2 text-right font-medium">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredQueries.map(q => (
                          <tr key={q.id} className="h-10 border-b border-slate-100 align-middle last:border-0 hover:bg-slate-50">
                            <td className="max-w-[260px] px-3"><span className="line-clamp-2 break-words text-slate-800">“{q.queryText}”</span></td>
                            <td className="px-3 text-slate-600">
                              {q.beforeMentioned == null && q.afterMentioned == null ? "—" : `${q.beforeMentioned ? "M" : "—"} → ${q.afterMentioned ? "M" : "—"}`}
                            </td>
                            <td className="px-3 text-slate-600">{q.beforeRecommended == null && q.afterRecommended == null ? "—" : `${q.beforeRecommended ? "推荐" : "未推荐"} → ${q.afterRecommended ? "推荐" : "未推荐"}`}</td>
                            <td className="px-3 text-slate-600">{q.beforePosition == null && q.afterPosition == null ? "—" : `${q.beforePosition ?? "—"} → ${q.afterPosition ?? "—"}`}</td>
                            <td className="px-3 text-slate-600">{q.beforeCitationCount == null && q.afterCitationCount == null ? "—" : `${q.beforeCitationCount ?? 0} → ${q.afterCitationCount ?? 0}`}</td>
                            <td className="px-3">
                              {q.status === "NOT_EVALUABLE"
                                ? <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">{formatQueryTransition(q.transitionType)}（{EXPERIMENT_NAV.notEvaluableLabel}）</span>
                                : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{formatQueryTransition(q.transitionType)}</span>}
                            </td>
                            <td className="whitespace-nowrap px-3 text-right">
                              <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => void openEvidenceAB(q)}>{EXPERIMENT_NAV.evidenceAB}</button>
                            </td>
                          </tr>
                        ))}
                        {filteredQueries.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">没有符合条件的 Query 变化。</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}

            {/* Attribution */}
            <section className="rounded-2xl border border-slate-300 bg-slate-50 p-5">
              <h2 className="text-sm font-semibold text-slate-700">{EXPERIMENT_NAV.attribution}</h2>
              <p className="mt-2 text-sm text-slate-600">{EXPERIMENT_NAV.attributionDisclaimer}</p>
              <p className="mt-1 font-mono text-xs text-slate-400">{EXPERIMENT_NAV.observedNotProven}</p>
            </section>
          </>
        )}
      </div>

      {evidenceRunId && <EvidenceDialog key={evidenceRunId} runId={evidenceRunId} onClose={() => setEvidenceRunId(null)} />}

      {pair && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 overflow-y-auto" onClick={() => setPair(null)}>
          <div className="w-full max-w-5xl rounded-2xl bg-white p-6 text-slate-900 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">证据对照（A/B）</h2>
              <button type="button" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100" onClick={() => setPair(null)}>关闭</button>
            </div>
            <p className="mt-1 break-all text-xs text-slate-500">“{pair.before?.queryText ?? pair.after?.queryText ?? ""}”</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {[["Before", pair.before], ["After", pair.after]].map(([label, side]) => {
                const ev = side as Pair["before"];
                return (
                  <section key={String(label)} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">{label === "Before" ? "Before（基线）" : "After（复测）"}</h3>
                      {ev?.runId && <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => { const runId = ev.runId; setPair(null); setEvidenceRunId(runId); }}>{OPPORTUNITY_NAV.viewRawEvidence}</button>}
                    </div>
                    {!ev ? <p className="mt-2 text-sm text-slate-400">该侧无可用证据。</p> : (
                      <>
                        <p className="mt-2 text-xs text-slate-500">evidence：{ev.evidenceId}</p>
                        <p className="text-xs text-slate-500">run：{ev.runId}</p>
                        <p className="mt-2 text-xs text-slate-500">说明：点击上方「查看原始证据」打开完整 Evidence（含 rawResponse、模型身份、Mention、Citation）。</p>
                      </>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
