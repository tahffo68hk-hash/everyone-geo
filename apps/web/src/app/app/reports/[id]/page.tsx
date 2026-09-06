"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { EvidenceDialog } from "../../monitor/evidence-dialog";
import {
  formatCategory, formatMetricSource, formatRunType, formatSourceType, formatStatus, friendlyError,
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
const badge = (color: string, text: string) => `inline-block rounded px-2 py-0.5 text-xs font-semibold ${color}`;

export default function ReportDetailPage() {
  const params = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [rows, setRows] = useState<EvidenceRow[]>([]);
  const [error, setError] = useState("");
  const [evidenceRunId, setEvidenceRunId] = useState<string | null>(null);

  useEffect(() => {
    api<Report>(`/reports/${encodeURIComponent(params.id)}`)
      .then(setReport)
      .catch(err => setError(friendlyError(err)));
    api<{ rows: EvidenceRow[] }>(`/reports/${encodeURIComponent(params.id)}/evidence`)
      .then(data => setRows(data.rows))
      .catch(() => { /* rows 可选 */ });
  }, [params.id]);

  if (error) return <main className="p-8 text-red-700">{error}</main>;
  if (!report) return <main className="p-8 text-slate-500">正在加载报告…</main>;
  const snap = report.metricsSnapshot;
  const competitor = snap.competitor;
  const totalShare = (competitor?.competitors ?? []).reduce((sum, c) => sum + (c.shareOfVoice ?? 0), 0);

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <Link href="/app/reports" className="text-sm text-blue-700 hover:underline">← 返回报告列表</Link>
          <h1 className="mt-3 text-2xl font-semibold">GEO 基准测试报告</h1>
          {report.completion.partial && (
            <p className="mt-2 inline-block rounded bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-800">
              ⚠️ 部分完成 —— 本报告不代表完整测试集（成功 {report.completion.succeededRuns} / 总计划 {report.completion.completedRuns + report.completion.failedRuns} 条）
            </p>
          )}
        </header>

        {/* 报告头 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold">{report.suiteName} v{report.suiteVersion}</span>
            <span className={badge(report.metricSource === "demo" ? "bg-amber-100 text-amber-800" : report.metricSource === "real" ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800", `数据类型：${formatMetricSource(report.metricSource)}`)} />
            <span className={badge(report.runType === "DEMO" ? "bg-slate-100 text-slate-600" : "bg-blue-100 text-blue-800", formatRunType(report.runType))} />
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["测试集", `${report.suiteName} v${report.suiteVersion}`],
              ["模型服务（provider）", report.provider === "mock" ? "演示（Mock）" : `${report.engineName ?? report.provider}`],
              ["请求模型（requestedModel）", report.requestedModel ?? "历史记录未保存"],
              ["响应模型（responseModel）", report.responseModel ?? "未知"],
              ["分析版本", report.analysisVersion],
              ["竞品集合", report.competitorSet ? `${report.competitorSet.name} v${report.competitorSet.version}` : "—（m4-rule-v1 无竞对集）"],
              ["数据类型", `${formatRunType(report.runType)} · ${formatMetricSource(report.metricSource)}`],
              ["报告生成时间", new Date(report.generatedAt).toLocaleString("zh-CN", { hour12: false })],
              ["指标版本", snap.metricVersion],
            ].map(([label, value]) => (
              <div key={String(label)}><dt className="text-slate-500">{label}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>
            ))}
          </dl>
        </section>

        {/* 核心指标 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold">核心指标</h2>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {[
              ["品牌可见率", percent(snap.overall.visibilityRate)],
              ["推荐率", percent(snap.overall.recommendationRate)],
              ["平均提及位置", snap.overall.averageMentionPosition == null ? "—" : snap.overall.averageMentionPosition.toFixed(2)],
              ["AI 声量份额（Share of Voice）", percent(snap.overall.shareOfVoice)],
              ["引用次数", snap.overall.citationCount],
              ["引用域名数", snap.overall.citationDomainCount],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="mt-1 text-xl font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-slate-500">情感分布：正面 {snap.overall.sentimentDistribution.positive} / 中性 {snap.overall.sentimentDistribution.neutral} / 负面 {snap.overall.sentimentDistribution.negative} / 未知 {snap.overall.sentimentDistribution.unknown}</p>
        </section>

        {/* 场景表现 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
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
          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold">竞品表现（AI 声量份额 · Share of Voice）</h2>
            <p className="mt-1 text-xs text-slate-500">竞品集合：{competitor.competitorSet.name} v{competitor.competitorSet.version}</p>
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

        {/* 问题级结果 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold">问题级结果（点击可下钻到原始证据）</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr><th className="p-2">检测问题</th><th className="p-2">场景分类</th><th className="p-2">是否提及品牌</th><th className="p-2">是否被推荐</th><th className="p-2">提及位置</th><th className="p-2">引用数</th><th className="p-2">状态</th><th className="p-2">原始证据</th></tr>
              </thead>
              <tbody>
                {snap.byQuery.map(row => (
                  <tr key={row.queryText} className="border-b border-slate-100 align-top">
                    <td className="min-w-56 break-words p-2">{row.queryText}</td>
                    <td className="p-2 whitespace-nowrap text-slate-600">{row.category ? formatCategory(row.category) : "—"}</td>
                    <td className="p-2">{row.analyzed ? (row.brandMentioned ? "是" : "否") : "—"}</td>
                    <td className="p-2">{row.analyzed ? (row.recommended ? "是" : "否") : "—"}</td>
                    <td className="p-2">{row.analyzed ? row.mentionPosition ?? "—" : "—"}</td>
                    <td className="p-2">{row.analyzed ? row.citationCount ?? "—" : "—"}</td>
                    <td className="p-2 whitespace-nowrap">{formatStatus(row.status)}</td>
                    <td className="p-2">
                      {(() => { const hit = rows.find(r => r.queryText === row.queryText); return hit && hit.runId
                        ? <button type="button" className="whitespace-nowrap text-blue-700 underline" onClick={() => setEvidenceRunId(hit.runId)}>查看原始回答</button>
                        : <span className="text-slate-300">—</span>; })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 证据说明 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-slate-700">证据说明</h2>
          <p className="mt-2 text-xs text-slate-500">
            本报告所有指标均可追溯到模型原始回答（Evidence）：报告 → 基准测试 Run → 检测问题 → 检测记录 → 原始证据 → 分析结果。报告为生成时冻结快照，后续编辑测试集 / 竞品集合 / 新增分析版本不会改变本报告。
          </p>
        </section>
      </div>
      {evidenceRunId && <EvidenceDialog key={evidenceRunId} runId={evidenceRunId} onClose={() => setEvidenceRunId(null)} />}
    </main>
  );
}
