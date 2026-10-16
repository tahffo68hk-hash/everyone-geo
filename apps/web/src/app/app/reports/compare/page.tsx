"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useProjectContext } from "@/components/project-context";
import { EvidenceDialog } from "../../monitor/evidence-dialog";
import { formatMetricSource, formatVersion, friendlyError } from "@/lib/labels";

type ReportRow = {
  id: string;
  suiteName: string;
  suiteVersion: string;
  runType: string;
  engineName: string;
  provider: string;
  requestedModel: string | null;
  responseModel: string | null;
  metricSource: string;
  analysisVersion: string;
  generatedAt: string;
  summary?: { visibilityRate: number | null };
};

type CompareRow = { metric: string; a: number | null; b: number | null; delta: number | null };
type CompareResult = {
  compatibility: {
    verdict: "COMPARABLE" | "PARTIALLY_COMPARABLE" | "NOT_COMPARABLE";
    dimensions: Array<{ key: string; a: string | null; b: string | null; compatible: boolean }>;
  };
  reports: {
    a: {
      id: string;
      suite: string;
      provider: string;
      engineName: string;
      requestedModel: string | null;
      responseModel: string | null;
      completion: { succeededRuns: number; completedRuns: number; failedRuns: number };
      generatedAt: string;
    };
    b: {
      id: string;
      suite: string;
      provider: string;
      engineName: string;
      requestedModel: string | null;
      responseModel: string | null;
      completion: { succeededRuns: number; completedRuns: number; failedRuns: number };
      generatedAt: string;
    };
  };
  deltaOverall: CompareRow[];
  byCategory: Array<{
    category: string;
    a: { visibilityRate: number | null; recommendationRate: number | null } | null;
    b: { visibilityRate: number | null; recommendationRate: number | null } | null;
    delta: { visibilityRate: number | null; recommendationRate: number | null } | null;
  }>;
  warnings: string[];
};

const VERDICT: Record<string, string> = {
  COMPARABLE: "完全可比",
  PARTIALLY_COMPARABLE: "部分可比",
  NOT_COMPARABLE: "不建议直接比较",
};
const VERDICT_CLASS: Record<string, string> = {
  COMPARABLE: "bg-emerald-100 text-emerald-800 border-emerald-300",
  PARTIALLY_COMPARABLE: "bg-amber-100 text-amber-800 border-amber-300",
  NOT_COMPARABLE: "bg-rose-100 text-rose-800 border-rose-300",
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
const fmt = (value: number | null, isRate: boolean) =>
  value == null ? "—" : isRate ? `${(value * 100).toFixed(1)}%` : value.toFixed(value % 1 === 0 ? 0 : 2);
const fmtDelta = (value: number | null, isRate: boolean) =>
  value == null
    ? "—"
    : isRate
    ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}pp` // 率用百分点（percentage points）
    : `${value >= 0 ? "+" : ""}${value.toFixed(value % 1 === 0 ? 0 : 2)}`;
const providerLabel = (provider: string | null) =>
  provider === "deepseek"
    ? "DeepSeek"
    : provider === "qwen"
    ? "通义千问（Qwen）"
    : provider === "mock"
    ? "本地模拟引擎"
    : provider ?? "未知引擎";
const RATE_KEYS = new Set(["visibilityRate", "recommendationRate", "shareOfVoice"]);

function ReportsCompareInner() {
  const { projectId: contextProjectId, project: currentProject } = useProjectContext();
  const searchParams = useSearchParams();
  const queryProjectId = searchParams.get("project") || "";
  const activeProjectId = queryProjectId || contextProjectId;

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [evRows, setEvRows] = useState<{ a: EvRow[]; b: EvRow[] }>({ a: [], b: [] });
  const [evidenceRunId, setEvidenceRunId] = useState<string | null>(null);

  // 弹窗选择器状态 (null | 'A' | 'B')
  const [pickerTarget, setPickerTarget] = useState<"A" | "B" | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");

  useEffect(() => {
    if (!activeProjectId) return;
    setLoadingReports(true);
    setError("");
    api<ReportRow[]>(`/projects/${encodeURIComponent(activeProjectId)}/reports`)
      .then((rows) => {
        setReports(rows);
        if (rows.length >= 2) {
          if (!aId) setAId(rows[0].id);
          if (!bId || bId === rows[0].id) setBId(rows[1].id);
        } else if (rows.length === 1) {
          if (!aId) setAId(rows[0].id);
          setBId("");
        } else {
          setAId("");
          setBId("");
        }
      })
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setLoadingReports(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  const reportA = useMemo(() => reports.find((row) => row.id === aId), [reports, aId]);
  const reportB = useMemo(() => reports.find((row) => row.id === bId), [reports, bId]);

  // 筛选弹窗中的报告列表
  const filteredPickerReports = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r) => {
      const matchName = r.suiteName.toLowerCase().includes(q);
      const matchProv = (r.provider || "").toLowerCase().includes(q) || (r.engineName || "").toLowerCase().includes(q);
      const matchModel = (r.requestedModel || "").toLowerCase().includes(q) || (r.responseModel || "").toLowerCase().includes(q);
      const matchDate = new Date(r.generatedAt).toLocaleString("zh-CN").toLowerCase().includes(q);
      return matchName || matchProv || matchModel || matchDate;
    });
  }, [reports, pickerSearch]);

  function handleSelectReport(reportId: string) {
    if (pickerTarget === "A") {
      setAId(reportId);
      if (bId === reportId) setBId("");
    } else if (pickerTarget === "B") {
      setBId(reportId);
      if (aId === reportId) setAId("");
    }
    setPickerTarget(null);
    setPickerSearch("");
  }

  async function compare() {
    if (!aId || !bId) {
      setError("请先选择两份不同的报告。");
      return;
    }
    if (aId === bId) {
      setError("不能选择同一份报告作为 A/B，请选择两份不同的报告进行对比。");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const body = await api<CompareResult>("/reports/compare", {
        method: "POST",
        body: JSON.stringify({ reportAId: aId, reportBId: bId }),
      });
      setResult(body);
      // Evidence A/B（按 queryText 对齐下钻）
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
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link
              href={`/app/reports?project=${encodeURIComponent(activeProjectId)}`}
              className="text-xs font-semibold text-blue-700 hover:underline"
            >
              ← 返回报告列表
            </Link>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
              报告对比（Report A vs Report B）
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              限定于当前项目「{currentProject?.name ?? "当前项目"}」，先判定科学可比性再给出差异 Δ。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/app/benchmark?project=${encodeURIComponent(activeProjectId)}`}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 shadow-sm"
            >
              + 运行基准测试
            </Link>
          </div>
        </header>

        {error && (
          <div role="alert" className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-xs text-rose-800">
            {error}
          </div>
        )}

        {/* 报告选择与卡片工作台 */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
          {loadingReports ? (
            <div className="py-8 text-center text-xs text-slate-400">正在拉取当前项目报告列表…</div>
          ) : reports.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center space-y-3">
              <div className="text-3xl">📊</div>
              <h3 className="text-sm font-semibold text-slate-800">当前项目暂无可用的基准测试报告</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                报告对比需要至少两份已冻结的测试报告快照。请先前往基准测试运行测试并生成报告。
              </p>
              <Link
                href={`/app/benchmark?project=${encodeURIComponent(activeProjectId)}`}
                className="inline-block rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800"
              >
                前往基准测试
              </Link>
            </div>
          ) : reports.length === 1 ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 flex items-center justify-between gap-3">
                <div>
                  <span className="font-semibold">⚠️ 至少需要两份报告才能进行对比</span>
                  <p className="mt-0.5 text-amber-800">
                    当前项目仅有 1 份报告「{reports[0].suiteName} {formatVersion(reports[0].suiteVersion)}」，请先生成下一份报告以开启对比。
                  </p>
                </div>
                <Link
                  href={`/app/benchmark?project=${encodeURIComponent(activeProjectId)}`}
                  className="shrink-0 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800"
                >
                  运行下一轮测试 →
                </Link>
              </div>

              {/* 单份报告预览 */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
                <span className="font-semibold text-slate-700 block mb-1">报告 A 已选定：</span>
                <span className="text-slate-900 font-medium">{reports[0].suiteName}</span>{" "}
                <span className="text-slate-500">v{reports[0].suiteVersion}</span> ·{" "}
                <span className="text-slate-600">{providerLabel(reports[0].provider)}</span> ·{" "}
                <span className="text-slate-400">{new Date(reports[0].generatedAt).toLocaleString("zh-CN")}</span>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] items-center">
                {/* 报告 A 选择卡片 */}
                <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50 hover:border-slate-300 transition">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-700">报告 A（基线对照）</span>
                    <button
                      type="button"
                      onClick={() => setPickerTarget("A")}
                      className="text-xs font-semibold text-blue-700 hover:underline"
                    >
                      {reportA ? "更换报告" : "选择报告"}
                    </button>
                  </div>
                  {reportA ? (
                    <div className="space-y-1.5 text-xs">
                      <div className="font-semibold text-slate-900 truncate" title={reportA.suiteName}>
                        {reportA.suiteName} <span className="text-blue-700">v{reportA.suiteVersion}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                        <span className="rounded bg-slate-200/80 px-1.5 py-0.5 font-medium">
                          {providerLabel(reportA.provider)}
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">
                          {formatMetricSource(reportA.metricSource)}
                        </span>
                        {reportA.summary?.visibilityRate != null && (
                          <span className="text-emerald-700 font-medium">
                            可见率 {(reportA.summary.visibilityRate * 100).toFixed(1)}%
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        生成于：{new Date(reportA.generatedAt).toLocaleString("zh-CN")}
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPickerTarget("A")}
                      className="w-full py-4 rounded-lg border border-dashed border-slate-300 text-xs font-medium text-slate-500 hover:bg-white hover:text-slate-800 transition"
                    >
                      + 点击选择报告 A
                    </button>
                  )}
                </div>

                {/* VS 分隔标 */}
                <div className="flex justify-center text-sm font-bold text-slate-400">
                  <span className="rounded-full bg-slate-100 px-3 py-1 border border-slate-200">VS</span>
                </div>

                {/* 报告 B 选择卡片 */}
                <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50 hover:border-slate-300 transition">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-700">报告 B（对比目标）</span>
                    <button
                      type="button"
                      onClick={() => setPickerTarget("B")}
                      className="text-xs font-semibold text-blue-700 hover:underline"
                    >
                      {reportB ? "更换报告" : "选择报告"}
                    </button>
                  </div>
                  {reportB ? (
                    <div className="space-y-1.5 text-xs">
                      <div className="font-semibold text-slate-900 truncate" title={reportB.suiteName}>
                        {reportB.suiteName} <span className="text-blue-700">v{reportB.suiteVersion}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                        <span className="rounded bg-slate-200/80 px-1.5 py-0.5 font-medium">
                          {providerLabel(reportB.provider)}
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">
                          {formatMetricSource(reportB.metricSource)}
                        </span>
                        {reportB.summary?.visibilityRate != null && (
                          <span className="text-emerald-700 font-medium">
                            可见率 {(reportB.summary.visibilityRate * 100).toFixed(1)}%
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        生成于：{new Date(reportB.generatedAt).toLocaleString("zh-CN")}
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPickerTarget("B")}
                      className="w-full py-4 rounded-lg border border-dashed border-slate-300 text-xs font-medium text-slate-500 hover:bg-white hover:text-slate-800 transition"
                    >
                      + 点击选择报告 B
                    </button>
                  )}
                </div>
              </div>

              {/* 操作栏与校验提示 */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <div className="text-xs">
                  {aId && bId && aId === bId ? (
                    <span className="text-rose-600 font-medium">⚠️ 报告 A 与报告 B 不能是同一份报告。</span>
                  ) : !aId || !bId ? (
                    <span className="text-slate-500">请选满两份报告后开始对比。</span>
                  ) : (
                    <span className="text-emerald-700 font-medium">已就绪，两份报告可执行科学可比性分析。</span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy || !aId || !bId || aId === bId}
                  onClick={() => void compare()}
                  className="rounded-lg bg-blue-700 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-800 disabled:opacity-40 transition"
                >
                  {busy ? "对比分析中…" : "开始对比"}
                </button>
              </div>
            </>
          )}
        </section>

        {/* 报告选择弹窗 Modal */}
        {pickerTarget !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl border border-slate-200 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900">
                  选择报告 {pickerTarget}（{pickerTarget === "A" ? "基线对照" : "对比目标"}）
                </h3>
                <button
                  type="button"
                  onClick={() => setPickerTarget(null)}
                  className="text-slate-400 hover:text-slate-600 text-base font-bold"
                >
                  ×
                </button>
              </div>

              {/* 搜索过滤输入框 */}
              <div>
                <input
                  type="text"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="搜索报告名称、测试集、模型或生成时间…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-600"
                  autoFocus
                />
              </div>

              {/* 报告候选列表 */}
              <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
                {filteredPickerReports.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-400">无符合搜索条件的报告快照</p>
                ) : (
                  filteredPickerReports.map((row) => {
                    const isSelectedSelf = (pickerTarget === "A" ? aId : bId) === row.id;
                    const isSelectedOther = (pickerTarget === "A" ? bId : aId) === row.id;
                    return (
                      <div
                        key={row.id}
                        onClick={() => !isSelectedOther && handleSelectReport(row.id)}
                        className={`rounded-xl border p-3 text-xs transition cursor-pointer flex items-center justify-between gap-3 ${
                          isSelectedSelf
                            ? "border-blue-500 bg-blue-50/50"
                            : isSelectedOther
                            ? "border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed"
                            : "border-slate-200 hover:border-blue-400 hover:bg-slate-50/80"
                        }`}
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="font-semibold text-slate-800 flex items-center gap-2">
                            <span className="truncate">{row.suiteName}</span>
                            <span className="rounded bg-slate-100 px-1.5 py-0.2 text-[10px] text-slate-600 font-mono">
                              v{row.suiteVersion}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                            <span>{providerLabel(row.provider)}</span>
                            <span>·</span>
                            <span>{row.requestedModel || "默认模型"}</span>
                            <span>·</span>
                            <span>{formatMetricSource(row.metricSource)}</span>
                          </div>
                          <div className="text-[10px] text-slate-400">
                            生成时间：{new Date(row.generatedAt).toLocaleString("zh-CN")}
                          </div>
                        </div>

                        <div className="shrink-0 text-right">
                          {isSelectedOther ? (
                            <span className="text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                              已选为报告 {pickerTarget === "A" ? "B" : "A"}
                            </span>
                          ) : isSelectedSelf ? (
                            <span className="text-[11px] text-blue-700 bg-blue-100 font-semibold px-2 py-0.5 rounded">
                              当前选择 ✓
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
                            >
                              选取
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="flex justify-end pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPickerTarget(null)}
                  className="rounded-lg border border-slate-300 px-4 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 对比分析结果呈现 */}
        {result && (
          <div className="space-y-6 animate-fade-in">
            {/* 可比性判定 */}
            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-800">可比性科学判定</h2>
                <span
                  className={`rounded-full border px-3 py-0.5 text-xs font-semibold ${
                    VERDICT_CLASS[result.compatibility.verdict]
                  }`}
                >
                  {VERDICT[result.compatibility.verdict]}
                </span>
              </div>

              <p className="mt-3 text-xs text-slate-600 leading-relaxed">
                {VERDICT_NOTE[result.compatibility.verdict]}
              </p>

              <div className="mt-3 text-xs text-slate-500 space-y-1 bg-slate-50 p-3 rounded-lg border border-slate-100 font-mono">
                <div>
                  报告 A：{providerLabel(result.reports.a.provider)}（{result.reports.a.engineName ?? result.reports.a.provider}）· 请求模型 {result.reports.a.requestedModel ?? "未保存"} · 响应模型 {result.reports.a.responseModel ?? "未知"}
                </div>
                <div>
                  报告 B：{providerLabel(result.reports.b.provider)}（{result.reports.b.engineName ?? result.reports.b.provider}）· 请求模型 {result.reports.b.requestedModel ?? "未保存"} · 响应模型 {result.reports.b.responseModel ?? "未知"}
                </div>
              </div>

              {result.warnings.length > 0 && (
                <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200/80 p-3 text-xs text-amber-900 space-y-1">
                  <div className="font-semibold">⚠️ 可比性预警与口径差异：</div>
                  <ul className="list-inside list-disc pl-1 space-y-0.5">
                    {result.warnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 text-slate-400 font-medium">
                    <tr>
                      <th className="p-2">核验维度</th>
                      <th className="p-2">报告 A</th>
                      <th className="p-2">报告 B</th>
                      <th className="p-2">是否一致</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.compatibility.dimensions.map((dim) => (
                      <tr key={dim.key} className="border-b border-slate-100 last:border-0">
                        <td className="p-2 font-medium text-slate-700">{DIM_LABELS[dim.key] ?? dim.key}</td>
                        <td className="p-2 font-mono text-[11px] text-slate-600">{dim.a ?? "未保存/未知"}</td>
                        <td className="p-2 font-mono text-[11px] text-slate-600">{dim.b ?? "未保存/未知"}</td>
                        <td className="p-2">
                          {dim.compatible ? (
                            <span className="text-emerald-700 font-semibold">✓ 一致</span>
                          ) : (
                            <span className="text-rose-600 font-semibold">✕ 不一致</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 总体指标 Δ 表 */}
            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-base font-bold text-slate-800 border-b border-slate-100 pb-3">
                总体指标：A / B / 差异变化（Δ）
              </h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 text-slate-400 font-medium">
                    <tr>
                      <th className="p-2.5">指标维度</th>
                      <th className="p-2.5">报告 A</th>
                      <th className="p-2.5">报告 B</th>
                      <th className="p-2.5 font-bold">变化量（Δ）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.deltaOverall.map((row) => (
                      <tr key={row.metric} className="border-b border-slate-100 last:border-0">
                        <td className="p-2.5 font-medium text-slate-800">{METRIC_LABELS[row.metric] ?? row.metric}</td>
                        <td className="p-2.5 text-slate-700">{fmt(row.a, RATE_KEYS.has(row.metric))}</td>
                        <td className="p-2.5 text-slate-700">{fmt(row.b, RATE_KEYS.has(row.metric))}</td>
                        <td className="p-2.5 font-bold">
                          {RATE_KEYS.has(row.metric)
                            ? fmtDelta(row.delta, true)
                            : row.delta == null
                            ? "—"
                            : (row.delta >= 0 ? "+" : "") + row.delta}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 场景矩阵对比 */}
            {result.byCategory.length > 0 && (
              <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-base font-bold text-slate-800 border-b border-slate-100 pb-3">
                  场景对比矩阵（A / B / Δ · 率指标变化用百分点 pp）
                </h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 text-slate-400 font-medium">
                      <tr>
                        <th className="p-2.5">场景分类</th>
                        <th className="p-2.5">A 可见率</th>
                        <th className="p-2.5">B 可见率</th>
                        <th className="p-2.5 font-semibold">Δ 可见率</th>
                        <th className="p-2.5">A 推荐率</th>
                        <th className="p-2.5">B 推荐率</th>
                        <th className="p-2.5 font-semibold">Δ 推荐率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.byCategory.map((row) => (
                        <tr key={row.category} className="border-b border-slate-100 last:border-0">
                          <td className="p-2.5 font-medium text-slate-800">{row.category}</td>
                          <td className="p-2.5 text-slate-700">{fmt(row.a?.visibilityRate ?? null, true)}</td>
                          <td className="p-2.5 text-slate-700">{fmt(row.b?.visibilityRate ?? null, true)}</td>
                          <td className="p-2.5 font-bold text-blue-700">
                            {row.delta ? fmtDelta(row.delta.visibilityRate, true) : "—"}
                          </td>
                          <td className="p-2.5 text-slate-700">{fmt(row.a?.recommendationRate ?? null, true)}</td>
                          <td className="p-2.5 text-slate-700">{fmt(row.b?.recommendationRate ?? null, true)}</td>
                          <td className="p-2.5 font-bold text-blue-700">
                            {row.delta ? fmtDelta(row.delta.recommendationRate, true) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* 问题级证据下钻 */}
            {evRows.a.length > 0 && evRows.b.length > 0 && (
              <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
                <div className="border-b border-slate-100 pb-3">
                  <h2 className="text-base font-bold text-slate-800">
                    问题级证据对比（同一测试问题 · 两个模型服务的原始回答）
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    解释为什么 {providerLabel(result.reports.a.provider)} 提及/推荐了品牌，而{" "}
                    {providerLabel(result.reports.b.provider)} 没有 —— 直接调取原始输出。
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 text-slate-400 font-medium">
                      <tr>
                        <th className="p-2.5">检测问题</th>
                        <th className="p-2.5">{providerLabel(result.reports.a.provider)} 原始回答</th>
                        <th className="p-2.5">{providerLabel(result.reports.b.provider)} 原始回答</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evRows.a.map((rowA) => {
                        const rowB = evRows.b.find((row) => row.queryText === rowA.queryText);
                        return (
                          <tr key={rowA.queryText} className="border-b border-slate-100 last:border-0 align-top">
                            <td className="min-w-64 break-words p-2.5 font-medium text-slate-800">
                              {rowA.queryText}
                            </td>
                            <td className="p-2.5">
                              {rowA.runId && rowA.status === "SUCCEEDED" ? (
                                <button
                                  type="button"
                                  className="text-blue-700 font-medium hover:underline"
                                  onClick={() => setEvidenceRunId(rowA.runId)}
                                >
                                  查看回答证据 ↗
                                </button>
                              ) : (
                                <span className="text-slate-400">无证据（{rowA.status}）</span>
                              )}
                            </td>
                            <td className="p-2.5">
                              {rowB?.runId && rowB.status === "SUCCEEDED" ? (
                                <button
                                  type="button"
                                  className="text-blue-700 font-medium hover:underline"
                                  onClick={() => setEvidenceRunId(rowB.runId)}
                                >
                                  查看回答证据 ↗
                                </button>
                              ) : (
                                <span className="text-slate-400">
                                  无对应记录{rowB ? `（${rowB.status}）` : "（B 侧未运行）"}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {evidenceRunId && (
        <EvidenceDialog key={evidenceRunId} runId={evidenceRunId} onClose={() => setEvidenceRunId(null)} />
      )}
    </main>
  );
}

export default function ReportsComparePage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-xs text-slate-400">正在加载报告对比工作区…</div>
      }
    >
      <ReportsCompareInner />
    </Suspense>
  );
}
