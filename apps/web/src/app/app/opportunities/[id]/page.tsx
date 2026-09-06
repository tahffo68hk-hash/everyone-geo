"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  formatCategory, formatContentIntent, formatEffortLevel, formatExpectedSignal,
  formatOpportunityAsset, formatOpportunityPriority, formatOpportunityStatus,
  formatExperimentStatus, friendlyError, EXPERIMENT_NAV, OPPORTUNITY_NAV, OPPORTUNITY_VERSION_LABEL,
} from "@/lib/labels";
import { EvidenceDialog } from "../../monitor/evidence-dialog";

type OppRun = {
  id: string; opportunityVersion: string; status: string; generatedAt: string;
  summary: { opportunityCount: number; blockedByDataQuality: boolean; dataQualityLimited: boolean } | null;
  metadata: { metricSource?: string | null; suiteName?: string; suiteVersion?: string; hasDataQualityIssue?: boolean; engineDurationMs?: number };
};
type Opportunity = {
  id: string; opportunityRunId: string; opportunityType: string; titleDirection: string;
  summary: string; rationale: string; priority: string; priorityScore: number;
  category: string | null; assetType: string; contentIntent: string; effortLevel: string;
  expectedSignals: string[]; representativeQuery: string | null;
  targetQueryCount: number; targetEngineCount: number; targetCompetitorCount: number;
  evidenceCount: number; recommendationCount: number; findingCount: number;
  status: string; dataQualityLimited: boolean;
  alternativeAssetTypes: string[];
  engines: Array<{ provider: string; engineKey: string; engineName: string; requestedModel: string | null; responseModel: string | null }>;
  competitors: Array<{ canonicalName: string; competitorType: string | null }>;
  createdAt: string;
};
type QueryRow = {
  id: string; queryText: string; category: string | null; intent: string | null;
  brandAbsent: boolean | null; competitorPositive: boolean | null; sourceEvidenceCount: number;
  engines: Array<{ provider: string; engineName: string; engineKey: string }>;
};
type Block = { id: string; blockType: string; title: string; purpose: string; sortOrder: number };
type EvidenceLink = { id: string; evidenceId: string; runId: string; queryText: string; reason: string };
type SourceRec = {
  id: string; recommendationRunId: string; recommendationType: string; title: string; summary: string;
  rationale: string; priority: string; priorityScore: number; status: string;
};
type ExperimentBrief = {
  id: string; contentOpportunityId: string; title: string; status: string;
  metricSource: string; provider: string; plannedQueryCount: number; createdAt: string;
};

const PRIO_BADGE: Record<string, string> = {
  HIGH: "bg-red-100 text-red-800", MEDIUM: "bg-amber-100 text-amber-800", LOW: "bg-blue-100 text-blue-800",
};
const STATUS_BADGE: Record<string, string> = {
  PROPOSED: "bg-slate-100 text-slate-600", APPROVED: "bg-emerald-100 text-emerald-800", DISMISSED: "bg-slate-200 text-slate-500",
};
function engineLabel(e: { engineName: string; engineKey: string }): string {
  return e.engineName && e.engineName !== "Engine" ? e.engineName : e.engineKey;
}

export default function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [opp, setOpp] = useState<Opportunity | null>(null);
  const [run, setRun] = useState<OppRun | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [queries, setQueries] = useState<QueryRow[]>([]);
  const [evidence, setEvidence] = useState<EvidenceLink[]>([]);
  const [sources, setSources] = useState<SourceRec[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [evidenceRunId, setEvidenceRunId] = useState<string | null>(null);
  const [operating, setOperating] = useState(false);
  const [experiments, setExperiments] = useState<ExperimentBrief[]>([]);

  const load = useCallback(async () => {
    setError("");
    try {
      const detail = await api<Opportunity & { blocks: Block[]; queries: QueryRow[] }>(`/content-opportunities/${id}`);
      setOpp(detail);
      setBlocks(detail.blocks);
      setQueries(detail.queries);
      const [runRes, evRes, srcRes, expRes] = await Promise.all([
        api<OppRun>(`/opportunity-runs/${detail.opportunityRunId}`),
        api<{ evidence: EvidenceLink[] }>(`/content-opportunities/${id}/evidence`),
        api<{ recommendations: SourceRec[] }>(`/content-opportunities/${id}/recommendations`),
        api<ExperimentBrief[]>(`/content-opportunities/${id}/experiments`),
      ]);
      setRun(runRes);
      setEvidence(evRes.evidence);
      setSources(srcRes.recommendations);
      setExperiments(expRes);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function setStatus(status: string) {
    if (!opp) return;
    setOperating(true);
    try {
      await api(`/content-opportunities/${opp.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
    } catch (err) { setError(friendlyError(err)); }
    finally { setOperating(false); }
  }

  function openQueryEvidence(q: QueryRow) {
    const link = evidence.find(e => e.queryText === q.queryText);
    if (link) setEvidenceRunId(link.runId);
  }

  async function createExperiment() {
    setOperating(true);
    try {
      await api(`/content-opportunities/${id}/experiments`, { method: "POST" });
      await load();
    } catch (err) { setError(friendlyError(err)); }
    finally { setOperating(false); }
  }

  const metricSource = run?.metadata?.metricSource ?? null;

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="h-4 w-1/4 animate-pulse rounded bg-slate-200" />
          <div className="h-10 w-2/3 animate-pulse rounded bg-slate-200" />
          <div className="h-24 animate-pulse rounded-2xl bg-slate-200" />
          <div className="h-48 animate-pulse rounded-2xl bg-slate-200" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <Link href="/app/opportunities" className="text-sm text-blue-700 hover:underline">← 返回内容机会列表</Link>
          <h1 className="mt-3 text-2xl font-semibold">内容机会</h1>
          <p className="mt-2 text-sm text-slate-500">
            内容机会是内容任务 brief（brief foundation），不是最终稿。机会版本：{run?.opportunityVersion ?? OPPORTUNITY_VERSION_LABEL}
            {run?.metadata?.suiteName ? ` · 来源报告：${run.metadata.suiteName} v${run.metadata.suiteVersion ?? ""}` : ""}
          </p>
        </header>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {opp && (
          <>
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              {OPPORTUNITY_NAV.whyHint}
              <p className="mt-1 text-xs text-amber-700">{OPPORTUNITY_NAV.experimentHint}。</p>
            </section>

            {/* 顶部信息 */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${PRIO_BADGE[opp.priority]}`}>{formatOpportunityPriority(opp.priority)}优先级</span>
                <span className="rounded bg-fuchsia-100 px-2 py-0.5 text-xs text-fuchsia-800">{formatOpportunityAsset(opp.opportunityType)}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{OPPORTUNITY_NAV.sourceRecommendations}：{opp.recommendationCount}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{OPPORTUNITY_NAV.sourceFindings}：{opp.findingCount}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">目标 Query：{opp.targetQueryCount}</span>
                <span className="rounded bg-teal-100 px-2 py-0.5 text-xs text-teal-800">目标模型：{opp.engines.length === 0 ? "—" : opp.engines.map(engineLabel).join(" / ")}</span>
                <span className="rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-800">
                  关联竞品：{opp.competitors.length === 0 ? OPPORTUNITY_NAV.noCompetitor : opp.competitors.map(c => c.canonicalName).join("、")}
                </span>
                <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800">内容意图：{formatContentIntent(opp.contentIntent)}</span>
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[opp.status] ?? ""}`}>{formatOpportunityStatus(opp.status)}</span>
              </div>
              <h2 className="mt-4 text-xl font-semibold">标题方向：{opp.titleDirection}</h2>
              <p className="mt-1 text-xs text-slate-400">{OPPORTUNITY_NAV.titleDirectionHint}</p>
              <p className="mt-3 text-sm text-slate-700">{opp.summary}</p>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                <span>建议资产：{formatOpportunityAsset(opp.assetType)}</span>
                {opp.alternativeAssetTypes.length > 0 && (
                  <span>备选资产：{opp.alternativeAssetTypes.map(formatOpportunityAsset).join(" / ")}</span>
                )}
                <span>工作量：{formatEffortLevel(opp.effortLevel)}</span>
                <span>预期影响指标：{opp.expectedSignals.map(formatExpectedSignal).join(" · ") || "—"}</span>
                <span title={OPPORTUNITY_NAV.internalScore}>内部优先级 {opp.priorityScore}</span>
                <span>证据 {opp.evidenceCount} 条</span>
                <span>生成 {new Date(opp.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
              </div>
              {metricSource && metricSource !== "real" && (
                <p className="mt-3 inline-block rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">{OPPORTUNITY_NAV.demoLabel}</p>
              )}
              {opp.dataQualityLimited && (
                <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  数据质量提示：当前诊断样本/质量有限，本机会（或备选的高成本内容）已被系统降级，建议先补数据或优先低风险内容。
                </p>
              )}
              {opp.status === "PROPOSED" && (
                <div className="mt-4 flex gap-2">
                  <button type="button" disabled={operating} onClick={() => void setStatus("APPROVED")} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50">标记为已规划</button>
                  <button type="button" disabled={operating} onClick={() => void setStatus("DISMISSED")} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50">忽略该机会</button>
                </div>
              )}
              {opp.status === "APPROVED" && (
                <div className="mt-4 flex gap-2">
                  <button type="button" disabled={operating} onClick={() => void setStatus("PROPOSED")} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50">撤回为待评估</button>
                </div>
              )}
            </section>

            {/* M7D：优化实验集成 */}
            <section className="rounded-2xl border border-cyan-200 bg-cyan-50/40 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold text-slate-700">优化实验（Before → 执行 → Frozen Re-test → After）</span>
                {experiments.length === 0 ? (
                  <>
                    <button type="button" disabled={operating} onClick={() => void createExperiment()} className="rounded-lg bg-cyan-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-800 disabled:opacity-50">
                      {operating ? "创建中…" : EXPERIMENT_NAV.generate}
                    </button>
                    <span className="text-xs text-slate-500">{EXPERIMENT_NAV.noneHint} 创建后自动绑定本机会来源报告作为基线。</span>
                  </>
                ) : (
                  <>
                    <span className="rounded bg-cyan-100 px-2 py-0.5 text-xs text-cyan-800">已建 {experiments.length} 个实验</span>
                    {experiments.map(e => (
                      <Link key={e.id} href={`/app/experiments/${e.id}`} className="rounded-lg border border-cyan-300 bg-white px-2 py-1 text-xs text-cyan-800 hover:bg-cyan-50">
                        {e.title} · {formatExperimentStatus(e.status)}
                      </Link>
                    ))}
                    <Link href={`/app/experiments?opp=${id}`} className="text-xs text-blue-700 hover:underline">{EXPERIMENT_NAV.view} →</Link>
                  </>
                )}
              </div>
            </section>

            {/* Why */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-base font-semibold">{OPPORTUNITY_NAV.why}</h2>
              <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{opp.rationale}</p>
              {opp.representativeQuery && (
                <p className="mt-2 text-xs text-slate-500">代表性查询：<span className="text-slate-700">“{opp.representativeQuery}”</span></p>
              )}
              {sources.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold text-slate-600">{OPPORTUNITY_NAV.sourceRecommendations}（{sources.length}）</p>
                  {sources.map(s => (
                    <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800">{s.title}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{s.summary}</p>
                      </div>
                      <Link href={`/app/recommendations/${s.recommendationRunId}`} className="shrink-0 text-xs text-blue-700 hover:underline">
                        {OPPORTUNITY_NAV.viewSourceRecommendation} →
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 建议结构 */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-base font-semibold">{OPPORTUNITY_NAV.suggestedStructure}</h2>
              <p className="mt-1 text-xs text-slate-400">{OPPORTUNITY_NAV.suggestedStructureHint}</p>
              <ol className="mt-3 space-y-2">
                {blocks.map((b, index) => (
                  <li key={b.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span className="mr-2 font-mono text-xs text-slate-400">{String(index + 1).padStart(2, "0")}</span>
                    <span className="font-medium">{b.title}</span>
                    <span className="ml-2 text-xs text-slate-500">{OPPORTUNITY_NAV.blockPurpose}：{b.purpose}</span>
                  </li>
                ))}
              </ol>
            </section>

            {/* 目标 Query 表格 */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-base font-semibold">{OPPORTUNITY_NAV.targetQueries}（{queries.length}）</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                      <th className="px-3 py-2 font-medium">监测问题</th>
                      <th className="px-3 py-2 font-medium">场景</th>
                      <th className="px-3 py-2 font-medium">意图说明（Intent）</th>
                      <th className="px-3 py-2 font-medium">涉及模型</th>
                      <th className="px-3 py-2 font-medium">品牌是否缺席</th>
                      <th className="px-3 py-2 font-medium">竞品信号</th>
                      <th className="px-3 py-2 text-right font-medium">证据数</th>
                      <th className="px-3 py-2 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queries.map(q => (
                      <tr key={q.id} className="h-11 border-b border-slate-100 align-middle last:border-0 hover:bg-slate-50">
                        <td className="max-w-[300px] px-3"><span className="line-clamp-2 break-words text-slate-800">“{q.queryText}”</span></td>
                        <td className="whitespace-nowrap px-3 text-slate-600">{formatCategory(q.category) || "—"}</td>
                        <td className="max-w-[140px] truncate px-3 text-slate-600">{q.intent || "—"}</td>
                        <td className="px-3">
                          {q.engines.length === 0 ? <span className="text-slate-400">—</span>
                            : q.engines.map(e => <span key={`${e.provider}-${e.engineKey}`} className="mr-1 rounded bg-teal-50 px-1.5 py-0.5 text-[11px] text-teal-800">{engineLabel(e)}</span>)}
                        </td>
                        <td className="whitespace-nowrap px-3 text-slate-600">{q.brandAbsent == null ? "—" : q.brandAbsent ? "缺席" : "有提及"}</td>
                        <td className="whitespace-nowrap px-3 text-slate-600">{q.competitorPositive == null ? "—" : q.competitorPositive ? "出现" : "未出现"}</td>
                        <td className="px-3 text-right text-slate-700">{q.sourceEvidenceCount}</td>
                        <td className="whitespace-nowrap px-3 text-right">
                          <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => openQueryEvidence(q)}>查看证据</button>
                        </td>
                      </tr>
                    ))}
                    {queries.length === 0 && (
                      <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-400">该机会暂无可用证据链接的目标查询。</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 证据 */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-base font-semibold">{OPPORTUNITY_NAV.evidenceSection}（{evidence.length}）</h2>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                <span>Evidence Source：{metricSource === "real" ? "Real（真实数据）" : metricSource === "mixed" ? "Mixed" : "Demo / Mock（演示）"}</span>
                <span>Provider：{opp.engines.length === 0 ? "—" : [...new Set(opp.engines.map(e => e.provider))].join("、")}</span>
                <span>涉及模型：{opp.engines.length === 0 ? "—" : opp.engines.map(engineLabel).join("、")}</span>
              </div>
              <ul className="mt-3 space-y-2">
                {evidence.slice(0, 20).map(e => (
                  <li key={e.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <span className="min-w-0 break-words">“{e.queryText}”<span className="ml-2 text-slate-400">{e.reason}</span></span>
                    <button type="button" className="shrink-0 text-blue-700 hover:underline" onClick={() => setEvidenceRunId(e.runId)}>
                      {OPPORTUNITY_NAV.viewRawEvidence}
                    </button>
                  </li>
                ))}
                {evidence.length > 20 && <li className="text-xs text-slate-400">仅展示前 20 条，其余可在 Query 表格中按行查看。</li>}
                {evidence.length === 0 && (
                  <li className="text-sm text-slate-500">
                    {OPPORTUNITY_NAV.noCitation}（该机会暂无指向性证据链接）。
                  </li>
                )}
              </ul>
            </section>
          </>
        )}
      </div>
      {evidenceRunId && <EvidenceDialog key={evidenceRunId} runId={evidenceRunId} onClose={() => setEvidenceRunId(null)} />}
    </main>
  );
}
