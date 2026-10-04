"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { EvidenceDialog } from "../../monitor/evidence-dialog";
import {
  formatCategory, formatMetricSource, formatRunType, formatStatus, formatVersion, friendlyError,
} from "@/lib/labels";

type Report = {
  id: string;
  suiteName: string;
  suiteVersion: string;
  runType: "DEMO" | "REAL";
  provider: string;
  engineName: string;
  requestedModel: string | null;
  responseModel: string | null;
  metricSource: "demo" | "real" | "mixed";
  analysisVersion: string;
  competitorSet: { id: string; name: string; version: string } | null;
  completion: { completedRuns: number; succeededRuns: number; failedRuns: number; analyzedRuns: number; partial: boolean };
  generatedAt: string;
  metricsSnapshot: {
    metricVersion: string;
    plannedRuns: number | null;
    metricQueryScope?: string | null;
    metricScopeQueryCount?: number | null;
    excludedSanityCount?: number | null;
    excludedContaminatedCount?: number | null;
    overall: {
      visibilityRate: number | null; recommendationRate: number | null; averageMentionPosition: number | null;
      shareOfVoice: number | null; citationCount: number; citationDomainCount: number;
      sentimentDistribution: Record<string, number>;
    };
    byCategory: Array<{ category: string; queryEligibleCount: number; queryMentionedCount: number; metrics: { visibilityRate: number | null; recommendationRate: number | null; analyzedRuns?: number } }>;
    byQuery: Array<{
      queryText: string; category: string | null; sortOrder: number | null; status: string;
      analyzed: boolean; brandMentioned: boolean | null; recommended: boolean | null;
      mentionPosition: number | null; citationCount: number | null;
    }>;
    competitor: null | {
      status: string;
      competitorSet: { id: string; name: string; version: string };
      competitors: Array<{ canonicalName: string; competitorType: string; mentionCount: number; evidenceCount: number; shareOfVoice: number | null }>;
      note: string;
    };
  };
};

type EvidenceRow = { runId: string; evidenceId: string | null; queryText: string; category: string | null; intent: string | null; sortOrder: number | null; sanity: boolean; status: string; analysisStatus: string; hasSnapshotAnalysis: boolean };

const percent = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const share = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const badge = (color: string) => `inline-block rounded px-2 py-0.5 text-xs font-semibold ${color}`;

export default function ReportDetailPage() {
  const params = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [rows, setRows] = useState<EvidenceRow[]>([]);
  const [evidenceError, setEvidenceError] = useState("");
  const [evidenceLoading, setEvidenceLoading] = useState(true);
  const [selection, setSelection] = useState<{ label: string; queries: string[] | null }>({ label: "全部检测记录", queries: null });
  const [error, setError] = useState("");
  const [evidenceRunId, setEvidenceRunId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setReport(null); setRows([]); setError(""); setEvidenceError(""); setEvidenceLoading(true);
    setEvidenceRunId(null); setSelection({ label: "全部检测记录", queries: null });
    api<Report>(`/reports/${encodeURIComponent(params.id)}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setReport(data); })
      .catch(err => { if (!controller.signal.aborted) setError(friendlyError(err)); });
    api<{ rows: EvidenceRow[] }>(`/reports/${encodeURIComponent(params.id)}/evidence`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setRows(data.rows); })
      .catch(err => { if (!controller.signal.aborted) setEvidenceError(friendlyError(err)); })
      .finally(() => { if (!controller.signal.aborted) setEvidenceLoading(false); });
    return () => controller.abort();
  }, [params.id]);

  if (error) return <main className="p-8 text-red-700">{error}</main>;
  if (!report) return <main className="p-8 text-slate-500">正在加载报告…</main>;
  const snap = report.metricsSnapshot;
  const competitor = snap.competitor;
  const totalShare = (competitor?.competitors ?? []).reduce((sum, c) => sum + (c.shareOfVoice ?? 0), 0);

  function selectEvidence(label: string, queries: string[] | null) {
    setSelection({ label, queries });
    document.getElementById("report-evidence")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const selectedRows = rows.filter(row => selection.queries === null || selection.queries.includes(row.queryText));

  return (
    <main className="text-slate-900">
      <div className="mx-auto max-w-none space-y-6">
        <header>
          <Link href="/app/reports" className="text-sm text-blue-700 hover:underline">← 返回报告列表</Link>
          <h1 className="mt-3 text-2xl font-semibold">检测报告</h1>
          {report.completion.partial && (
            <p className="mt-2 inline-block rounded bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-800">
              部分完成 —— 本报告不代表完整测试集（成功 {report.completion.succeededRuns} / 总计划 {snap.plannedRuns ?? report.completion.completedRuns + report.completion.failedRuns} 条）
            </p>
          )}
        </header>

        {/* 报告头 */}
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold">{report.suiteName} {formatVersion(report.suiteVersion)}</span>
            <span className={badge(report.metricSource === "demo" ? "bg-amber-100 text-amber-800" : report.metricSource === "real" ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800")}>{formatMetricSource(report.metricSource)}</span>
            <span className={badge(report.runType === "DEMO" ? "bg-slate-100 text-slate-600" : "bg-blue-100 text-blue-800")}>{formatRunType(report.runType)}</span>
          </div>
          <p className="mt-3 text-sm text-slate-600">{new Date(report.generatedAt).toLocaleString("zh-CN", { hour12: false })} · 已分析 {report.completion.analyzedRuns} 条 · 成功 {report.completion.succeededRuns} 条 · 失败 {report.completion.failedRuns} 条</p>
          <p className="mt-2 text-sm text-slate-600">以下结果来自生成报告时的冻结快照。点击指标查看对应问题的检测记录，再打开原始回答核对。</p>
        </section>

        {/* 核心指标 */}
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold">核心指标</h2>
          {snap.metricQueryScope && (
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              核心指标样本：{snap.metricQueryScope}（{snap.metricScopeQueryCount ?? "—"} 个可用问题
              {snap.excludedSanityCount ? ` · 排除品牌认知测试 ${snap.excludedSanityCount} 个` : ""}
              {snap.excludedContaminatedCount ? ` · 排除含品牌自定义问题 ${snap.excludedContaminatedCount} 个` : ""}）。
              品牌认知测试不混入核心可见度指标。
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { label: "品牌可见度", value: percent(snap.overall.visibilityRate), queries: snap.byQuery.filter(q => q.analyzed && q.brandMentioned).map(q => q.queryText), note: "查看提及品牌的问题" },
              { label: "推荐率", value: percent(snap.overall.recommendationRate), queries: snap.byQuery.filter(q => q.analyzed && q.recommended).map(q => q.queryText), note: "查看推荐品牌的问题" },
              { label: "引用次数", value: snap.overall.citationCount, queries: snap.byQuery.filter(q => q.analyzed && (q.citationCount ?? 0) > 0).map(q => q.queryText), note: `${snap.overall.citationDomainCount} 个引用域名` },
              { label: "AI 声量份额（SOV）", value: !report.competitorSet ? "不适用" : competitor?.status !== "ready" ? "暂不可用" : percent(snap.overall.shareOfVoice), queries: snap.byQuery.filter(q => q.analyzed).map(q => q.queryText), note: !report.competitorSet ? "未绑定竞品集合" : "查看分析样本中的品牌与竞品提及" },
            ].map(metric => <button key={metric.label} type="button" onClick={() => selectEvidence(metric.label, metric.queries)} className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-left hover:border-teal-600 focus-visible:outline-teal-700"><span className="block text-sm text-slate-600">{metric.label}</span><strong className="mt-2 block text-2xl">{metric.value}</strong><span className="mt-2 block text-xs text-slate-500">{metric.note} →</span></button>)}
          </div>
          <p className="mt-3 text-sm text-slate-600">平均首次提及位次：{snap.overall.averageMentionPosition == null ? "—" : snap.overall.averageMentionPosition.toFixed(2)} · 引用域名数：{snap.overall.citationDomainCount}</p>
          <p className="mt-3 text-xs text-slate-500">情感分布：正面 {snap.overall.sentimentDistribution.positive} / 中性 {snap.overall.sentimentDistribution.neutral} / 负面 {snap.overall.sentimentDistribution.negative} / 未知 {snap.overall.sentimentDistribution.unknown}</p>
        </section>

        {/* 场景表现 */}
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold">按场景表现</h2>
          {snap.byCategory.length === 0 ? <p className="mt-3 text-sm text-slate-500">暂无按场景统计（无成功样本或该分析版本无结果）。</p> : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr><th className="p-2">场景分类</th><th className="p-2">成功样本</th><th className="p-2">提及问题数</th><th className="p-2">品牌可见率</th><th className="p-2">推荐率</th></tr>
                </thead>
                <tbody>
                  {snap.byCategory.map(row => (
                    <tr key={row.category} className="border-b border-slate-100">
                      <td className="p-2">{formatCategory(row.category)}</td>
                      <td className="p-2">{row.queryEligibleCount}</td>
                      <td className="p-2">{row.queryMentionedCount}</td>
                      <td className="p-2">{percent(row.metrics.visibilityRate)}</td>
                      <td className="p-2">{percent(row.metrics.recommendationRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 竞品表现 */}
        {competitor?.status === "ready" && (
          <section className="rounded-lg border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold">竞品表现（AI 声量份额 · Share of Voice）</h2>
            <p className="mt-1 text-xs text-slate-500">竞品集合：{competitor.competitorSet.name} {formatVersion(competitor.competitorSet.version)}</p>
            <div className="mt-3 space-y-2">
              {competitor.competitors.map(item => (
                <div key={item.canonicalName} className="flex items-center gap-3 text-sm">
                  <span className="w-40 shrink-0 font-medium">{item.canonicalName}</span>
                  <span className="w-20 shrink-0 text-xs text-slate-400">{item.competitorType}</span>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                    <div className="h-full rounded bg-blue-600" style={{ width: `${totalShare ? Math.round(((item.shareOfVoice ?? 0) / Math.max(totalShare, 1e-9)) * 100) : 0}%` }} />
                  </div>
                  <span className="w-28 shrink-0 text-right text-xs text-slate-500">{item.mentionCount} 次 · {share(item.shareOfVoice)}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{competitor.note}</p>
          </section>
        )}

        {competitor?.status !== "ready" && (
          <section className="rounded-lg border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold">竞品表现（AI 声量份额 · Share of Voice）</h2>
            <p className="mt-2 text-sm text-slate-500">
              {competitor === null
                ? "该报告生成时未绑定竞品集合，SOV（AI 声量份额）不适用，核心指标中 AI 声量份额显示“不适用”。为项目绑定竞品集合后重新生成报告，即可查看竞品 SOV。"
                : `该报告竞品分析尚未就绪（状态：${competitor.status}），SOV 暂不可用。`}
            </p>
          </section>
        )}

        {/* 问题级结果 */}
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold">问题级结果</h2><p className="mt-2 text-sm text-slate-500">检测引擎：{report.engineName} · 点击检测记录查看原始证据。</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr><th className="p-2">检测问题</th><th className="p-2">场景分类</th><th className="p-2">是否提及品牌</th><th className="p-2">是否被推荐</th><th className="p-2" title="品牌在模型回答中的首次提及顺序，不代表推荐排名">首次提及位次</th><th className="p-2">引用数</th><th className="p-2">状态</th><th className="p-2">原始证据</th></tr>
              </thead>
              <tbody>
                {snap.byQuery.map(row => (
                  <tr key={row.queryText} className="border-b border-slate-100 align-top">
                    <td className="min-w-56 break-words p-2">{row.queryText}</td>
                    <td className="p-2 whitespace-nowrap text-slate-600">{row.category ? formatCategory(row.category) : "—"}</td>
                    <td className="p-2">{row.analyzed ? (row.brandMentioned ? "是" : "否") : "—"}</td>
                    <td className="p-2">{row.analyzed ? (row.recommended ? "是" : "否") : "—"}</td>
                    <td className="p-2">{row.analyzed ? (row.mentionPosition == null ? "—" : `第 ${row.mentionPosition} 位`) : "—"}</td>
                    <td className="p-2">{row.analyzed ? row.citationCount ?? "—" : "—"}</td>
                    <td className="p-2 whitespace-nowrap">{formatStatus(row.status)}</td>
                    <td className="p-2">
                      <button type="button" className="whitespace-nowrap text-teal-700 underline" onClick={() => selectEvidence(row.queryText, [row.queryText])}>查看检测记录</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="report-evidence" className="scroll-mt-24 rounded-lg border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">证据清单</h2><button type="button" className="text-sm text-teal-700 underline" onClick={() => setSelection({ label: "全部检测记录", queries: null })}>查看全部</button></div>
          <p className="mt-2 break-words text-sm text-slate-500">当前范围：{selection.label} · {selectedRows.length} 条检测记录。分析仅使用报告冻结版本；缺失版本会明确标注。</p>
          {evidenceLoading ? <p role="status" className="mt-4">正在加载证据清单…</p> : evidenceError ? <p role="alert" className="mt-4 text-red-700">证据清单加载失败：{evidenceError}</p> : selectedRows.length === 0 ? <p className="mt-4 text-sm text-slate-500">当前范围没有可展示的检测记录。</p> : <ul className="mt-4 divide-y divide-slate-100">{selectedRows.map(row => <li key={row.runId} className="flex items-start justify-between gap-4 py-4"><div><p className="text-sm">{row.queryText}</p><p className="mt-1 text-xs text-slate-500">{formatStatus(row.status)} · {row.hasSnapshotAnalysis ? "具有报告冻结分析" : "缺少报告冻结分析"}{row.sanity ? " · 品牌认知测试" : ""}</p></div><button type="button" onClick={() => setEvidenceRunId(row.runId)} className="shrink-0 text-sm text-teal-700 underline">{row.evidenceId ? "查看原始回答" : "查看运行状态"}</button></li>)}</ul>}
        </section>
        <details className="rounded-lg border border-slate-200 bg-white p-6"><summary className="cursor-pointer font-semibold">报告技术详情</summary>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["测试集", `${report.suiteName} v${report.suiteVersion}`],
              ["模型服务（provider）", report.provider === "mock" ? "演示（Mock）" : `${report.engineName ?? report.provider}`],
              ["请求模型（requestedModel）", report.requestedModel ?? "历史记录未保存"],
              ["响应模型（responseModel）", report.responseModel ?? "未知"],
              ["分析版本", report.analysisVersion],
              ["竞品集合", report.competitorSet ? `${report.competitorSet.name} ${formatVersion(report.competitorSet.version)}` : "—（m4-rule-v1 无竞对集）"],
              ["数据类型", `${formatRunType(report.runType)} · ${formatMetricSource(report.metricSource)}`],
              ["报告生成时间", new Date(report.generatedAt).toLocaleString("zh-CN", { hour12: false })],
              ["指标版本", snap.metricVersion],
            ].map(([label, value]) => (
              <div key={String(label)}><dt className="text-slate-500">{label}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>
            ))}
          </dl>
        </details>
        <section className="rounded-lg border border-slate-200 bg-white p-6"><h2 className="font-semibold">下一步</h2><p className="mt-2 text-sm text-slate-600">结合原始回答确认遗漏与引用来源，再查看项目洞察制定优化动作。</p><Link href="/app/diagnosis" className="mt-3 inline-block text-sm text-teal-700 underline">查看洞察与优化 →</Link></section>
        {/* 证据说明 */}
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-slate-700">证据说明</h2>
          <p className="mt-2 text-xs text-slate-500">
            本报告所有指标均可追溯到模型原始回答（Evidence）：报告 → 基准测试 Run → 检测问题 → 检测记录 → 原始证据 → 分析结果。报告为生成时冻结快照，后续编辑测试集 / 竞品集合 / 新增分析版本不会改变本报告。
          </p>
        </section>
      </div>
      {evidenceRunId && <EvidenceDialog key={evidenceRunId} runId={evidenceRunId} analysisVersion={report.analysisVersion} onClose={() => setEvidenceRunId(null)} />}
    </main>
  );
}
