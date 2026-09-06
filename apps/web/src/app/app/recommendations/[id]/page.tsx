"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  ACTION_STATUS, formatActionStatus, formatActionType, formatEffortLevel,
  formatExpectedSignal, formatImpactArea, formatMetricSource,
  formatRecommendationPriority, formatRecommendationStatus, formatRecommendationType,
  formatTargetAsset, friendlyError, RECOMMENDATION_NAV, RECOMMENDATION_VERSION_LABEL,
  SEVERITY_BADGE,
} from "@/lib/labels";
import { EvidenceDialog } from "../../monitor/evidence-dialog";

type RecRun = {
  id: string; diagnosisRunId: string; recommendationVersion: string;
  summary: {
    priorityCounts: { HIGH: number; MEDIUM: number; LOW: number };
    recommendationCount: number; actionItemCount: number;
    directions: string[]; dataQualityDamped: boolean;
  };
  metadata: { metricSource?: string | null; engineDurationMs?: number };
  generatedAt: string;
};
type Recommendation = {
  id: string; recommendationRunId: string; recommendationType: string;
  title: string; summary: string; rationale: string;
  priority: string; priorityScore: number; impactArea: string;
  targetAssetType: string | null; expectedSignal: string | null; effortLevel: string | null;
  status: string; findingCount: number; evidenceCount: number;
  category: string | null; competitorName: string | null;
  actionItems?: ActionItem[];
};
type ActionItem = {
  id: string; actionType: string; title: string; description: string;
  sortOrder: number; effortLevel: string; verificationMethod: string | null;
  status: string;
};
type Finding = {
  id: string; findingType: string; severity: string; title: string; summary: string;
  explanation: string; evidence: Array<{ id: string; runId: string; evidenceId: string; queryText: string; reason: string }>;
};

const PRIO_BADGE: Record<string, string> = {
  HIGH: "bg-red-100 text-red-800", MEDIUM: "bg-amber-100 text-amber-800", LOW: "bg-blue-100 text-blue-800",
};
const REC_STATUS_BADGE: Record<string, string> = {
  PROPOSED: "bg-slate-100 text-slate-600", ACCEPTED: "bg-emerald-100 text-emerald-800", DISMISSED: "bg-slate-200 text-slate-500",
};

export default function RecommendationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<RecRun | null>(null);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [reportLabel, setReportLabel] = useState<string>("");
  const [metricSource, setMetricSource] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string>("");
  const [basis, setBasis] = useState<Record<string, Finding[]>>({});
  const [loadingBasis, setLoadingBasis] = useState<Record<string, boolean>>({});
  const [evidenceRunId, setEvidenceRunId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const [r, list] = await Promise.all([
        api<RecRun>(`/recommendation-runs/${id}`),
        api<{ recommendations: Recommendation[] }>(`/recommendation-runs/${id}/recommendations`),
      ]);
      setRun(r);
      // 完整详情（含 actionItems）
      const full = await Promise.all(list.recommendations.map(x => api<Recommendation>(`/recommendations/${x.id}`)));
      setRecs(full);
      setMetricSource(r.metadata?.metricSource ?? null);
      try {
        const d = await api<{ reportId: string }>(`/diagnoses/${r.diagnosisRunId}`);
        const rep = await api<{ suiteName: string; suiteVersion: string }>(`/reports/${d.reportId}`);
        setReportLabel(`${rep.suiteName} v${rep.suiteVersion}`);
      } catch { setReportLabel("—"); }
    } catch (err) {
      setError(friendlyError(err));
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function setStatus(rec: Recommendation, status: string) {
    try {
      await api(`/recommendations/${rec.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
    } catch (err) { setError(friendlyError(err)); }
  }
  async function setActionStatus(item: ActionItem, status: string) {
    try {
      await api(`/action-items/${item.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
    } catch (err) { setError(friendlyError(err)); }
  }
  async function toggleBasis(rec: Recommendation) {
    if (openId === rec.id) { setOpenId(""); return; }
    setOpenId(rec.id);
    if (!basis[rec.id]) {
      setLoadingBasis(prev => ({ ...prev, [rec.id]: true }));
      try {
        const res = await api<{ findings: Finding[] }>(`/recommendations/${rec.id}/findings`);
        setBasis(prev => ({ ...prev, [rec.id]: res.findings }));
      } catch (err) { setError(friendlyError(err)); }
      finally { setLoadingBasis(prev => ({ ...prev, [rec.id]: false })); }
    }
  }

  const counts = run?.summary?.priorityCounts;

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <Link href="/app/recommendations" className="text-sm text-blue-700 hover:underline">← 返回优化建议列表</Link>
          <h1 className="mt-3 text-2xl font-semibold">GEO 优化建议</h1>
          {run && (
            <p className="mt-2 text-sm text-slate-500">
              来源报告：{reportLabel} · 诊断版本：{RECOMMENDATION_VERSION_LABEL} · 建议版本：{run.recommendationVersion}
            </p>
          )}
        </header>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {run && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <p className="text-sm text-amber-900">{RECOMMENDATION_NAV.disclaimer}</p>
          </section>
        )}

        {run && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-slate-700">{RECOMMENDATION_NAV.summary}</span>
              {counts && (
                <>
                  <span className="rounded bg-red-100 px-2 py-0.5 font-semibold text-red-800">高：{counts.HIGH}</span>
                  <span className="rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">中：{counts.MEDIUM}</span>
                  <span className="rounded bg-blue-100 px-2 py-0.5 font-semibold text-blue-800">低：{counts.LOW}</span>
                </>
              )}
              <span className="text-slate-400">·</span>
              <span>{RECOMMENDATION_NAV.directions}：{(run.summary?.directions ?? []).map(formatImpactArea).join(" / ") || "—"}</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {metricSource && metricSource !== "real" ? "演示数据优化建议 —— 不伪装真实策略报告" : "真实数据优化建议"}
              {run.metadata?.engineDurationMs != null ? ` · 生成耗时 ${run.metadata.engineDurationMs}ms` : ""}
            </p>
          </section>
        )}

        {recs.map(rec => (
          <section key={rec.id} className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-xs font-semibold ${PRIO_BADGE[rec.priority]}`}>{formatRecommendationPriority(rec.priority)}优先级</span>
              <span className="rounded bg-fuchsia-100 px-2 py-0.5 text-xs text-fuchsia-800">{RECOMMENDATION_NAV.recLabel} · {formatRecommendationType(rec.recommendationType)}</span>
              {rec.category && <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800">场景：{rec.category}</span>}
              {rec.competitorName && <span className="rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-800">竞品：{rec.competitorName}</span>}
              <span className={`rounded px-2 py-0.5 text-xs font-semibold ${REC_STATUS_BADGE[rec.status] ?? "bg-slate-100 text-slate-600"}`}>{formatRecommendationStatus(rec.status)}</span>
              <h2 className="min-w-0 flex-1 text-lg font-semibold">{rec.title}</h2>
              <span className="text-xs text-slate-400" title={RECOMMENDATION_NAV.internalScore}>优先级 {rec.priorityScore}</span>
            </div>
            <p className="mt-2 text-sm text-slate-700">{rec.summary}</p>
            <p className="mt-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600"><span className="font-semibold">{RECOMMENDATION_NAV.rationale}：</span>{rec.rationale}</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
              <span>{RECOMMENDATION_NAV.impactArea}：{formatImpactArea(rec.impactArea)}</span>
              <span>{RECOMMENDATION_NAV.targetAsset}：{formatTargetAsset(rec.targetAssetType)}</span>
              <span>{RECOMMENDATION_NAV.expectedSignal}：{formatExpectedSignal(rec.expectedSignal) || "—"}</span>
              <span>{RECOMMENDATION_NAV.effort}：{formatEffortLevel(rec.effortLevel) || "—"}</span>
              <span>{RECOMMENDATION_NAV.findingCount}：{rec.findingCount}</span>
              <span>{RECOMMENDATION_NAV.evidenceCount}：{rec.evidenceCount}</span>
            </div>

            {/* 行动项 checklist */}
            <div className="mt-3 rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-700">{RECOMMENDATION_NAV.actionItems}（{rec.actionItems?.length ?? 0}）</span>
                <span className="flex-1" />
                <button type="button" onClick={() => void toggleBasis(rec)} className="rounded-lg border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100">
                  {RECOMMENDATION_NAV.viewBasis}（{rec.findingCount}）
                </button>
                {rec.status === "PROPOSED" && (
                  <>
                    <button type="button" onClick={() => void setStatus(rec, "ACCEPTED")} className="rounded-lg bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-800">
                      {RECOMMENDATION_NAV.accept}
                    </button>
                    <button type="button" onClick={() => void setStatus(rec, "DISMISSED")} className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100">
                      {RECOMMENDATION_NAV.dismiss}
                    </button>
                  </>
                )}
              </div>
              <ul className="mt-2 space-y-1.5">
                {(rec.actionItems ?? []).map(item => (
                  <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium"><span className="mr-1 rounded bg-white px-1 py-0.5 text-[10px] text-slate-500">{formatActionType(item.actionType)}</span>{item.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">工作量 {formatEffortLevel(item.effortLevel)} · {RECOMMENDATION_NAV.verification}：{item.verificationMethod}</p>
                    </div>
                    <select
                      aria-label="行动项状态"
                      value={item.status}
                      onChange={e => void setActionStatus(item, e.target.value)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                    >
                      {Object.keys(ACTION_STATUS).map(k => <option key={k} value={k}>{formatActionStatus(k)}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
            </div>

            {/* 依据：Recommendation → Finding → Evidence */}
            {openId === rec.id && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
                <p className="text-xs font-semibold text-slate-600">{RECOMMENDATION_NAV.factLabel}依据（点击查看原始回答）</p>
                {loadingBasis[rec.id] && <p className="mt-2 text-xs text-slate-500">加载中…</p>}
                {basis[rec.id] && (
                  <ul className="mt-2 space-y-2 text-xs">
                    {basis[rec.id].map(f => (
                      <li key={f.id} className="rounded-lg border border-slate-200 bg-white p-2">
                        <p><span className={`mr-1 rounded px-1 py-0.5 font-semibold ${SEVERITY_BADGE[f.severity] ?? ""}`}>{f.severity}</span>
                          <span className="font-medium">{f.title}</span></p>
                        <p className="mt-0.5 text-slate-500">{f.summary}</p>
                        {(f.evidence ?? []).slice(0, 3).map(ev => (
                          <p key={ev.id} className="mt-1 flex items-start justify-between gap-2">
                            <span className="break-words text-slate-500">“{ev.queryText}”</span>
                            <button type="button" className="shrink-0 text-blue-700 underline" onClick={() => setEvidenceRunId(ev.runId)}>查看原始回答</button>
                          </p>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        ))}
      </div>
      {evidenceRunId && <EvidenceDialog key={evidenceRunId} runId={evidenceRunId} onClose={() => setEvidenceRunId(null)} />}
    </main>
  );
}
