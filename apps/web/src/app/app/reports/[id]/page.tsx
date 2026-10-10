"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { EvidenceDialog } from "../../monitor/evidence-dialog";
import { StatusBadge } from "@/components/ui";
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
  const [copiedShare, setCopiedShare] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [sharingBusy, setSharingBusy] = useState(false);

  async function copyShareLink() {
    if (!report) return;
    setSharingBusy(true);
    try {
      const res = await api<{ shareToken: string; shareUrl: string }>(
        `/reports/${encodeURIComponent(params.id)}/share`,
        { method: "POST" }
      );
      setShareToken(res.shareToken);
      const url = `${window.location.origin}/share/report/${res.shareToken}`;
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setCopiedShare(true);
        setTimeout(() => setCopiedShare(false), 2500);
      } else {
        prompt("请复制以下安全公开分享链接：", url);
      }
    } catch (e) {
      alert("创建分享链接失败：" + friendlyError(e));
    } finally {
      setSharingBusy(false);
    }
  }

  async function revokeShare() {
    if (!report) return;
    if (!confirm("确定要撤销公开分享吗？撤销后，外部客户将无法再访问此报告。")) return;
    setSharingBusy(true);
    try {
      await api(`/reports/${encodeURIComponent(params.id)}/revoke-share`, { method: "POST" });
      setShareToken(null);
      alert("已成功撤销公开分享，外部链接已失效。");
    } catch (e) {
      alert("撤销失败：" + friendlyError(e));
    } finally {
      setSharingBusy(false);
    }
  }

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
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/app/reports" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-600 transition mb-1.5">
            ← 返回报告列表
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              {report.suiteName} <span className="text-slate-400 font-mono text-base font-normal">v{report.suiteVersion}</span>
            </h1>
            <span className={badge(report.metricSource === "demo" ? "bg-amber-100 text-amber-800" : report.metricSource === "real" ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800")}>
              {formatMetricSource(report.metricSource)}
            </span>
            <span className={badge(report.runType === "DEMO" ? "bg-slate-100 text-slate-600" : "bg-indigo-100 text-indigo-800")}>
              {formatRunType(report.runType)}
            </span>
          </div>
          {report.completion.partial && (
            <p className="mt-2 inline-block rounded-md bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-800">
              部分完成 —— 本报告不代表完整测试集（成功 {report.completion.succeededRuns} / 总计划 {snap.plannedRuns ?? report.completion.completedRuns + report.completion.failedRuns} 条）
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            生成时间：{new Date(report.generatedAt).toLocaleString("zh-CN", { hour12: false })} · 已分析 {report.completion.analyzedRuns} 条 · 成功 {report.completion.succeededRuns} 条 · 失败 {report.completion.failedRuns} 条
          </p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            disabled={sharingBusy}
            onClick={copyShareLink}
            className="ui-button primary compact"
            title="生成或复制客户免登安全分享链接，支持微信与移动端 H5 快速查阅"
          >
            <span>{copiedShare ? "✓ 已复制安全链接" : "🔗 复制移动端 H5 分享链接"}</span>
          </button>
          {shareToken && (
            <>
              <Link
                href={`/share/report/${shareToken}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ui-button secondary compact"
                title="在新标签页预览移动端公开诊断报告"
              >
                <span>📱 预览 H5</span>
              </Link>
              <button
                type="button"
                disabled={sharingBusy}
                onClick={revokeShare}
                className="ui-button danger compact"
                title="撤销公开分享，使外部链接立刻失效"
              >
                撤销分享
              </button>
            </>
          )}
        </div>
      </header>

      {/* 核心指标 */}
      <div className="surface overflow-hidden">
        <div className="section-heading">
          <h2>
            <span>核心量化指标</span>
            <span className="text-xs font-normal text-slate-400">（点击指标卡片可下钻定位对应检测记录）</span>
          </h2>
          {snap.metricQueryScope && (
            <span className="text-xs text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200">
              样本范围：{snap.metricQueryScope}（{snap.metricScopeQueryCount ?? "—"} 个可用问题）
            </span>
          )}
        </div>
        <div className="p-5 space-y-4">
          <div className="metric-grid">
            {[
              { label: "品牌可见度", value: percent(snap.overall.visibilityRate), queries: snap.byQuery.filter(q => q.analyzed && q.brandMentioned).map(q => q.queryText), note: "查看提及品牌的问题" },
              { label: "推荐率", value: percent(snap.overall.recommendationRate), queries: snap.byQuery.filter(q => q.analyzed && q.recommended).map(q => q.queryText), note: "查看推荐品牌的问题" },
              { label: "引用次数", value: `${snap.overall.citationCount} 次`, queries: snap.byQuery.filter(q => q.analyzed && (q.citationCount ?? 0) > 0).map(q => q.queryText), note: `${snap.overall.citationDomainCount} 个权威独立域名` },
              { label: "AI 声量份额（SOV）", value: !report.competitorSet ? "不适用" : competitor?.status !== "ready" ? "暂不可用" : percent(snap.overall.shareOfVoice), queries: snap.byQuery.filter(q => q.analyzed).map(q => q.queryText), note: !report.competitorSet ? "未绑定竞品集合" : "查看品牌与竞品对抗" },
            ].map(metric => (
              <button
                key={metric.label}
                type="button"
                onClick={() => selectEvidence(metric.label, metric.queries)}
                className="metric-card"
              >
                <div className="metric-header">
                  <span className="metric-label">{metric.label}</span>
                </div>
                <strong>{metric.value}</strong>
                <div className="metric-note">
                  <span>{metric.note} →</span>
                </div>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
            <span>平均首次提及位次：<strong>{snap.overall.averageMentionPosition == null ? "—" : `第 ${snap.overall.averageMentionPosition.toFixed(2)} 位`}</strong> · 引用独立域名数：<strong>{snap.overall.citationDomainCount}</strong></span>
            <span>情感倾向分布：正面 {snap.overall.sentimentDistribution.positive} / 中性 {snap.overall.sentimentDistribution.neutral} / 负面 {snap.overall.sentimentDistribution.negative}</span>
          </div>
        </div>
      </div>

      {/* 场景表现 */}
      <div className="surface overflow-hidden">
        <div className="section-heading">
          <h2>
            <span>按场景细分表现</span>
            <span className="text-xs font-normal text-slate-400">（按不同业务/行业提问类别统计可见度与推荐率）</span>
          </h2>
        </div>
        {snap.byCategory.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            暂无按场景统计（无成功样本或该分析版本无结果）。
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>场景分类</th>
                  <th>成功样本</th>
                  <th>提及问题数</th>
                  <th>品牌可见率</th>
                  <th>强推荐率</th>
                </tr>
              </thead>
              <tbody>
                {snap.byCategory.map(row => (
                  <tr key={row.category}>
                    <td className="font-medium text-slate-800">{formatCategory(row.category)}</td>
                    <td className="tabular-nums">{row.queryEligibleCount}</td>
                    <td className="tabular-nums">{row.queryMentionedCount}</td>
                    <td className="font-semibold tabular-nums text-slate-900">{percent(row.metrics.visibilityRate)}</td>
                    <td className="font-semibold tabular-nums text-indigo-600">{percent(row.metrics.recommendationRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 竞品表现 */}
      {competitor?.status === "ready" && (
        <div className="surface overflow-hidden">
          <div className="section-heading">
            <h2>
              <span>竞品声量份额对抗（Share of Voice · SoV）</span>
              <span className="text-xs font-normal text-slate-400">
                竞品集合：{competitor.competitorSet.name} {formatVersion(competitor.competitorSet.version)}
              </span>
            </h2>
          </div>
          <div className="p-5 space-y-4">
            <div className="space-y-3">
              {competitor.competitors.map(item => (
                <div key={item.canonicalName} className="flex items-center gap-3 text-xs">
                  <span className="w-36 shrink-0 font-medium text-slate-800 truncate">{item.canonicalName}</span>
                  <span className="w-16 shrink-0 text-[11px] text-slate-400">{item.competitorType}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100 border border-slate-200">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500"
                      style={{ width: `${totalShare ? Math.round(((item.shareOfVoice ?? 0) / Math.max(totalShare, 1e-9)) * 100) : 0}%` }}
                    />
                  </div>
                  <span className="w-32 shrink-0 text-right text-slate-600 tabular-nums">
                    {item.mentionCount} 次提及 · <strong>{share(item.shareOfVoice)}</strong>
                  </span>
                </div>
              ))}
            </div>
            <p className="rounded-lg bg-amber-50 border border-amber-200/60 px-3 py-2 text-xs text-amber-900 leading-relaxed">
              {competitor.note}
            </p>
          </div>
        </div>
      )}

      {competitor?.status !== "ready" && (
        <div className="surface overflow-hidden">
          <div className="section-heading">
            <h2>
              <span>竞品声量份额（SOV）</span>
            </h2>
          </div>
          <div className="p-5 text-xs text-slate-500 leading-relaxed">
            {competitor === null
              ? "该报告生成时未绑定竞品集合，SOV（AI 声量份额）不适用。为项目绑定竞品集合后重新生成报告，即可查看竞品 SOV 对抗图谱。"
              : `该报告竞品分析尚未就绪（状态：${competitor.status}），SOV 暂不可用。`}
          </div>
        </div>
      )}

      {/* 问题级结果 */}
      <div className="surface overflow-hidden">
        <div className="section-heading">
          <h2>
            <span>检测问题明细与命中判定</span>
            <span className="text-xs font-normal text-slate-400">（评估引擎：{report.engineName}）</span>
          </h2>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>检测问题</th>
                <th>场景分类</th>
                <th>品牌提及</th>
                <th>强推荐</th>
                <th>首次提及位次</th>
                <th>引用数</th>
                <th>状态</th>
                <th className="text-right">原始证据</th>
              </tr>
            </thead>
            <tbody>
              {snap.byQuery.map(row => (
                <tr key={row.queryText}>
                  <td className="min-w-64 break-words font-medium text-slate-900">{row.queryText}</td>
                  <td className="whitespace-nowrap text-slate-600 text-xs">{row.category ? formatCategory(row.category) : "—"}</td>
                  <td>
                    {row.analyzed ? (
                      row.brandMentioned ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold text-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> 是
                        </span>
                      ) : <span className="text-slate-400 text-xs">否</span>
                    ) : "—"}
                  </td>
                  <td>
                    {row.analyzed ? (
                      row.recommended ? (
                        <span className="inline-flex items-center gap-1 text-indigo-700 font-semibold text-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" /> 首选
                        </span>
                      ) : <span className="text-slate-400 text-xs">否</span>
                    ) : "—"}
                  </td>
                  <td className="tabular-nums">
                    {row.analyzed ? (row.mentionPosition == null ? "—" : `第 ${row.mentionPosition} 位`) : "—"}
                  </td>
                  <td className="tabular-nums">
                    {row.analyzed ? row.citationCount ?? "0" : "—"}
                  </td>
                  <td className="whitespace-nowrap">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="ui-button secondary compact text-xs"
                      onClick={() => selectEvidence(row.queryText, [row.queryText])}
                    >
                      检测记录 →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 证据清单 */}
      <div id="report-evidence" className="scroll-mt-24 surface overflow-hidden">
        <div className="section-heading">
          <h2>
            <span>原始证据链追溯（Evidence）</span>
            <span className="text-xs font-normal text-slate-400">
              当前范围：{selection.label} · {selectedRows.length} 条记录
            </span>
          </h2>
          <button
            type="button"
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:underline"
            onClick={() => setSelection({ label: "全部检测记录", queries: null })}
          >
            查看全部记录
          </button>
        </div>
        <div className="p-5">
          {evidenceLoading ? (
            <p role="status" className="text-xs text-slate-500">正在加载证据清单…</p>
          ) : evidenceError ? (
            <p role="alert" className="text-xs text-rose-700">证据清单加载失败：{evidenceError}</p>
          ) : selectedRows.length === 0 ? (
            <p className="text-xs text-slate-500">当前范围没有可展示的检测记录。</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {selectedRows.map(row => (
                <li key={row.runId} className="flex items-start justify-between gap-4 py-3">
                  <div>
                    <p className="text-xs font-medium text-slate-800">{row.queryText}</p>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                      <StatusBadge status={row.status} />
                      <span>{row.hasSnapshotAnalysis ? "具有冻结分析" : "缺少冻结分析"}</span>
                      {row.sanity && <span className="text-amber-600 font-medium">· 品牌认知测试</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEvidenceRunId(row.runId)}
                    className="ui-button secondary compact text-xs shrink-0"
                  >
                    {row.evidenceId ? "查看原始回答" : "查看运行状态"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 报告技术详情 */}
      <details className="surface overflow-hidden">
        <summary className="section-heading cursor-pointer select-none">
          <h2>
            <span>报告技术快照详情与不可变冻结参数</span>
            <span className="text-xs font-normal text-slate-400">（点击展开）</span>
          </h2>
        </summary>
        <div className="p-5">
          <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
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
              <div key={String(label)} className="p-3 bg-slate-50/70 rounded-lg border border-slate-100">
                <dt className="text-slate-400 font-medium mb-0.5">{label}</dt>
                <dd className="whitespace-pre-wrap break-words font-semibold text-slate-800">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </details>

      {/* 下一步与证据说明 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="surface p-5 space-y-2">
          <h2 className="text-sm font-bold text-slate-800">下一步行动建议</h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            结合原始回答确认品牌遗漏原因与高频被引第三方域名，随后进入 GEO 问题诊断制定定向优化策略。
          </p>
          <div className="pt-1">
            <Link href="/app/diagnosis" className="ui-button primary compact text-xs">
              进入 GEO 问题诊断 →
            </Link>
          </div>
        </div>

        <div className="surface p-5 space-y-2">
          <h2 className="text-sm font-bold text-slate-800">科学量化说明</h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            本报告所有指标均可追溯到大模型原始回答（Evidence），报告为生成时冻结快照，后续编辑测试集或新增分析版本不会改变本报告历史数据。
          </p>
        </div>
      </div>

      {evidenceRunId && (
        <EvidenceDialog
          key={evidenceRunId}
          runId={evidenceRunId}
          analysisVersion={report.analysisVersion}
          onClose={() => setEvidenceRunId(null)}
        />
      )}
    </div>
  );
}
