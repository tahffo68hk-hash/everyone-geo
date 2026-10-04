"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { EvidenceDialog } from "../../monitor/evidence-dialog";
import { formatMetricSource, formatVersion, friendlyError } from "@/lib/labels";

type Project = { id: string; name: string };
type ReportRow = {
  id: string; suiteName: string; suiteVersion: string; runType: string;
  engineName: string; requestedModel: string | null; responseModel: string | null;
  metricSource: string; analysisVersion: string; generatedAt: string;
};
type CompareRow = { metric: string; a: number | null; b: number | null; delta: number | null };
type CompareResult = {
  compatibility: {
    verdict: "COMPARABLE" | "PARTIALLY_COMPARABLE" | "NOT_COMPARABLE";
    dimensions: Array<{ key: string; a: string | null; b: string | null; compatible: boolean }>;
  };
  reports: {
    a: { id: string; suite: string; provider: string; engineName: string; requestedModel: string | null; responseModel: string | null; completion: { succeededRuns: number; completedRuns: number; failedRuns: number }; generatedAt: string };
    b: { id: string; suite: string; provider: string; engineName: string; requestedModel: string | null; responseModel: string | null; completion: { succeededRuns: number; completedRuns: number; failedRuns: number }; generatedAt: string };
  };
  deltaOverall: CompareRow[];
  byCategory: Array<{ category: string; a: { visibilityRate: number | null; recommendationRate: number | null } | null; b: { visibilityRate: number | null; recommendationRate: number | null } | null; delta: { visibilityRate: number | null; recommendationRate: number | null } | null }>;
  warnings: string[];
};

const VERDICT: Record<string, string> = {
  COMPARABLE: "完全可比",
  PARTIALLY_COMPARABLE: "部分可比",
  NOT_COMPARABLE: "不建议直接比较",
};
const VERDICT_CLASS: Record<string, string> = {
  COMPARABLE: "bg-emerald-100 text-emerald-800",
  PARTIALLY_COMPARABLE: "bg-amber-100 text-amber-800",
  NOT_COMPARABLE: "bg-red-100 text-red-800",
};
const VERDICT_NOTE: Record<string, string> = {
  COMPARABLE: "测试问题、分析规则、竞品口径与模型服务均一致。",
  PARTIALLY_COMPARABLE: "测试问题、分析规则和竞品口径一致，但模型服务/模型身份不同（如 DeepSeek vs 通义千问），结果用于比较不同 AI 引擎的品牌表现。",
  NOT_COMPARABLE: "测试集版本 / 数据类型 / 分析版本 / 竞品集合版本等硬口径不一致，不建议直接比较。",
};
type EvRow = { runId: string; queryText: string; status: string; hasSnapshotAnalysis?: boolean };
const DIM_LABELS: Record<string, string> = {
  suiteVersion: "测试集版本",
  metricSource: "数据类型",
  provider: "模型服务",
  analysisVersion: "分析版本",
  requestedModel: "请求模型",
  responseModel: "响应模型",
  competitorSetVersion: "竞品集合版本",
};
const METRIC_LABELS: Record<string, string> = {
  visibilityRate: "品牌可见率",
  recommendationRate: "推荐率",
  averageMentionPosition: "平均提及位置",
  shareOfVoice: "AI 声量份额",
  citationCount: "引用次数",
  citationDomainCount: "引用域名数",
};
const fmt = (value: number | null, isRate: boolean) => value == null ? "—" : isRate ? `${(value * 100).toFixed(1)}%` : value.toFixed(value % 1 === 0 ? 0 : 2);
const fmtDelta = (value: number | null, isRate: boolean) => value == null ? "—" : isRate
  ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}pp` // 率用百分点（percentage points）
  : `${value >= 0 ? "+" : ""}${value.toFixed(value % 1 === 0 ? 0 : 2)}`;
const providerLabel = (provider: string | null) => provider === "deepseek" ? "DeepSeek" : provider === "qwen" ? "通义千问（Qwen）" : provider ?? "未知";
const RATE_KEYS = new Set(["visibilityRate", "recommendationRate", "shareOfVoice"]);

export default function ReportsComparePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [evRows, setEvRows] = useState<{ a: EvRow[]; b: EvRow[] }>({ a: [], b: [] });
  const [evidenceRunId, setEvidenceRunId] = useState<string | null>(null);

  useEffect(() => {
    api<{ projects: Project[] }>("/monitor-tasks/options")
      .then(data => { setProjects(data.projects); if (data.projects[0]) setProjectId(data.projects[0].id); })
      .catch(err => setError(friendlyError(err)));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    api<ReportRow[]>(`/projects/${encodeURIComponent(projectId)}/reports`)
      .then(rows => { setReports(rows); if (rows[0] && !aId) setAId(rows[0].id); if (rows[1] && !bId) setBId(rows[1].id); })
      .catch(err => setError(friendlyError(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const reportA = useMemo(() => reports.find(row => row.id === aId), [reports, aId]);
  const reportB = useMemo(() => reports.find(row => row.id === bId), [reports, bId]);

  async function compare() {
    if (!aId || !bId) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const body = await api<CompareResult>("/reports/compare", {
        method: "POST",
        body: JSON.stringify({ reportAId: aId, reportBId: bId }),
      });
      setResult(body);
      // Evidence A/B（同一 suite 的查询文本一致 → 按 queryText 对齐下钻）
      const [ea, eb] = await Promise.all([
        api<{ rows: EvRow[] }>(`/reports/${aId}/evidence`).catch(() => ({ rows: [] as EvRow[] })),
        api<{ rows: EvRow[] }>(`/reports/${bId}/evidence`).catch(() => ({ rows: [] as EvRow[] })),
      ]);
      setEvRows({ a: ea.rows, b: eb.rows });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <Link href="/app/reports" className="text-sm text-blue-700 hover:underline">← 返回报告列表</Link>
          <h1 className="mt-3 text-2xl font-semibold">报告对比（Report A vs Report B）</h1>
          <p className="mt-2 text-sm text-slate-500">先判定可比性再给出 Δ —— 不同口径绝不无警告解读数字。</p>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr]">
            <label className="text-sm text-slate-600">
              报告 A（Report A）
              <select value={aId} onChange={event => setAId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-slate-900">
                {reports.map(row => <option key={row.id} value={row.id}>{row.suiteName} {formatVersion(row.suiteVersion)} · {new Date(row.generatedAt).toLocaleDateString("zh-CN")}</option>)}
              </select>
            </label>
            <div className="flex items-end"><span className="pb-2 text-lg text-slate-400">vs</span></div>
            <label className="text-sm text-slate-600">
              报告 B（Report B）
              <select value={bId} onChange={event => setBId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-slate-900">
                {reports.map(row => <option key={row.id} value={row.id}>{row.suiteName} {formatVersion(row.suiteVersion)} · {new Date(row.generatedAt).toLocaleDateString("zh-CN")}</option>)}
              </select>
            </label>
          </div>
          <button type="button" disabled={busy || !aId || !bId || aId === bId} onClick={() => void compare()}
            className="mt-4 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50">
            {busy ? "对比中…" : "开始对比"}
          </button>
          {aId === bId && <p className="mt-2 text-xs text-amber-700">请选择两份不同的报告。</p>}
        </section>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {result && (
          <>
            <section className="rounded-lg border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold">可比性</h2>
              <p className="mt-2">
                判定结果：
                <span className={`ml-2 rounded px-2 py-0.5 text-sm font-semibold ${VERDICT_CLASS[result.compatibility.verdict]}`}>
                  {VERDICT[result.compatibility.verdict]}
                </span>
              </p>
              <p className="mt-2 text-xs text-slate-600">
                模型服务 A：{providerLabel(result.reports.a.provider)}（{result.reports.a.engineName ?? result.reports.a.provider}）· 请求模型 {result.reports.a.requestedModel ?? "未保存"} · 响应模型 {result.reports.a.responseModel ?? "未知"}
                <br />
                模型服务 B：{providerLabel(result.reports.b.provider)}（{result.reports.b.engineName ?? result.reports.b.provider}）· 请求模型 {result.reports.b.requestedModel ?? "未保存"} · 响应模型 {result.reports.b.responseModel ?? "未知"}
              </p>
              <p className="mt-1 text-xs text-slate-500">{VERDICT_NOTE[result.compatibility.verdict]}</p>
              {result.warnings.length > 0 && (
                <ul className="mt-3 list-inside list-disc rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
                </ul>
              )}
              <table className="mt-3 w-full text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr><th className="p-2">维度</th><th className="p-2">报告 A</th><th className="p-2">报告 B</th><th className="p-2">是否一致</th></tr>
                </thead>
                <tbody>
                  {result.compatibility.dimensions.map(dim => (
                    <tr key={dim.key} className="border-b border-slate-100">
                      <td className="p-2">{DIM_LABELS[dim.key] ?? dim.key}</td>
                      <td className="p-2 font-mono text-[11px]">{dim.a ?? "未保存/未知"}</td>
                      <td className="p-2 font-mono text-[11px]">{dim.b ?? "未保存/未知"}</td>
                      <td className="p-2">{dim.compatible ? <span className="text-emerald-700">一致</span> : <span className="text-red-700">不一致</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold">总体指标：A / B / 变化</h2>
              <table className="mt-3 w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr><th className="p-2">指标</th><th className="p-2">报告 A</th><th className="p-2">报告 B</th><th className="p-2">变化（Δ）</th></tr>
                </thead>
                <tbody>
                  {result.deltaOverall.map(row => (
                    <tr key={row.metric} className="border-b border-slate-100">
                      <td className="p-2">{METRIC_LABELS[row.metric] ?? row.metric}</td>
                      <td className="p-2">{fmt(row.a, RATE_KEYS.has(row.metric))}</td>
                      <td className="p-2">{fmt(row.b, RATE_KEYS.has(row.metric))}</td>
                      <td className="p-2 font-medium">{RATE_KEYS.has(row.metric) ? fmtDelta(row.delta, true) : row.delta == null ? "—" : (row.delta >= 0 ? "+" : "") + row.delta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {result.byCategory.length > 0 && (
              <section className="rounded-lg border border-slate-200 bg-white p-6">
                <h2 className="text-lg font-semibold">场景对比矩阵（A / B / Δ · 率用百分点 pp）</h2>
                <table className="mt-3 w-full text-left text-sm">
                  <thead className="border-b border-slate-200 text-slate-500">
                    <tr><th className="p-2">场景分类</th><th className="p-2">A 可见率</th><th className="p-2">B 可见率</th><th className="p-2">Δ 可见率</th><th className="p-2">A 推荐率</th><th className="p-2">B 推荐率</th><th className="p-2">Δ 推荐率</th></tr>
                  </thead>
                  <tbody>
                    {result.byCategory.map(row => (
                      <tr key={row.category} className="border-b border-slate-100">
                        <td className="p-2">{row.category}</td>
                        <td className="p-2">{fmt(row.a?.visibilityRate ?? null, true)}</td>
                        <td className="p-2">{fmt(row.b?.visibilityRate ?? null, true)}</td>
                        <td className="p-2">{row.delta ? fmtDelta(row.delta.visibilityRate, true) : "—"}</td>
                        <td className="p-2">{fmt(row.a?.recommendationRate ?? null, true)}</td>
                        <td className="p-2">{fmt(row.b?.recommendationRate ?? null, true)}</td>
                        <td className="p-2">{row.delta ? fmtDelta(row.delta.recommendationRate, true) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.warnings.length > 0 && <p className="mt-3 text-xs text-amber-700">{result.warnings.join(" ")} 同一场景分类按名称对齐，跨版本语义可能已变。</p>}
              </section>
            )}

            <p className="text-xs text-slate-400">报告 A：{reportA ? `${reportA.suiteName} v${reportA.suiteVersion}` : "—"} · 报告 B：{reportB ? `${reportB.suiteName} v${reportB.suiteVersion}` : "—"}</p>

            {/* 问题级 Evidence A/B：同一 suite 的 queryText 对齐 → 点开两个 Provider 的原始回答 */}
            {evRows.a.length > 0 && evRows.b.length > 0 && (
              <section className="rounded-lg border border-slate-200 bg-white p-6">
                <h2 className="text-lg font-semibold">问题级证据对比（同一测试问题 · 两个模型服务的原始回答）</h2>
                <p className="mt-1 text-xs text-slate-500">回答为什么 {providerLabel(result.reports.a.provider)} 提及/推荐了品牌，而 {providerLabel(result.reports.b.provider)} 没有 —— 直接看原始回答。</p>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr><th className="p-2">检测问题</th><th className="p-2">{providerLabel(result.reports.a.provider)} 原始回答</th><th className="p-2">{providerLabel(result.reports.b.provider)} 原始回答</th></tr>
                    </thead>
                    <tbody>
                      {evRows.a.map(rowA => {
                        const rowB = evRows.b.find(row => row.queryText === rowA.queryText);
                        return (
                          <tr key={rowA.queryText} className="border-b border-slate-100 align-top">
                            <td className="min-w-56 break-words p-2">{rowA.queryText}</td>
                            <td className="p-2">
                              {rowA.runId && rowA.status === "SUCCEEDED"
                                ? <button type="button" className="text-blue-700 underline" onClick={() => setEvidenceRunId(rowA.runId)}>查看原始回答</button>
                                : <span className="text-slate-400">无证据（{rowA.status}）</span>}
                            </td>
                            <td className="p-2">
                              {rowB?.runId && rowB.status === "SUCCEEDED"
                                ? <button type="button" className="text-blue-700 underline" onClick={() => setEvidenceRunId(rowB.runId)}>查看原始回答</button>
                                : <span className="text-slate-400">无对应记录{rowB ? `（${rowB.status}）` : "（B 侧未运行该问题）"}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </div>
      {evidenceRunId && <EvidenceDialog key={evidenceRunId} runId={evidenceRunId} onClose={() => setEvidenceRunId(null)} />}
    </main>
  );
}
