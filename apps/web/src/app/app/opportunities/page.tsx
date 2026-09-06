"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import {
  formatCategory, formatEffortLevel, formatExpectedSignal,
  formatOpportunityAsset, formatOpportunityPriority,
  formatOpportunityStatus, friendlyError, OPPORTUNITY_NAV, OPPORTUNITY_TYPE,
} from "@/lib/labels";

type Project = { id: string; name: string };
type OppRun = {
  id: string; recommendationRunId: string; opportunityVersion: string;
  metadata: { metricSource?: string | null; suiteName?: string; suiteVersion?: string; engineDurationMs?: number };
  generatedAt: string; summary: { opportunityCount: number; blockedByDataQuality: boolean } | null;
};
type Opportunity = {
  id: string; opportunityRunId: string; opportunityType: string; titleDirection: string;
  summary: string; priority: string; priorityScore: number; category: string | null;
  assetType: string; contentIntent: string; effortLevel: string; expectedSignals: string[];
  targetQueryCount: number; targetEngineCount: number; targetCompetitorCount: number;
  evidenceCount: number; recommendationCount: number; findingCount: number; status: string;
  dataQualityLimited: boolean; engines: Array<{ provider: string; engineKey: string; engineName: string }>;
  competitors: Array<{ canonicalName: string; competitorType: string | null }>;
  createdAt: string;
};
type Row = { opp: Opportunity; run: OppRun };

const PRIO_BADGE: Record<string, string> = {
  HIGH: "bg-red-100 text-red-800", MEDIUM: "bg-amber-100 text-amber-800", LOW: "bg-blue-100 text-blue-800",
};
const STATUS_BADGE: Record<string, string> = {
  PROPOSED: "bg-slate-100 text-slate-600", APPROVED: "bg-emerald-100 text-emerald-800", DISMISSED: "bg-slate-200 text-slate-500",
};

function engineLabel(e: { engineName: string; engineKey: string }): string {
  return e.engineName && e.engineName !== "Engine" ? e.engineName : e.engineKey;
}

function OpportunitiesInner() {
  const params = useSearchParams();
  const runFilter = params.get("run") ?? "";
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  useEffect(() => {
    api<{ projects: Project[] }>("/monitor-tasks/options")
      .then(data => {
        setProjects(data.projects);
        const first = data.projects[0];
        if (first) setProjectId(first.id);
      })
      .catch(err => setError(friendlyError(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true); setError("");
    (async () => {
      try {
        const reports = await api<Array<{ id: string }>>(`/projects/${encodeURIComponent(projectId)}/reports`);
        const collected: Row[] = [];
        for (const report of reports) {
          try {
            const diags = await api<Array<{ id: string }>>(`/reports/${report.id}/diagnoses`);
            for (const d of diags) {
              try {
                const recRuns = await api<Array<{ id: string }>>(`/diagnoses/${d.id}/recommendations`);
                for (const recRun of recRuns) {
                  try {
                    const oppRuns = await api<OppRun[]>(`/recommendation-runs/${recRun.id}/opportunities`);
                    for (const oppRun of oppRuns) {
                      try {
                        const res = await api<{ opportunities: Opportunity[] }>(`/opportunity-runs/${oppRun.id}/opportunities`);
                        for (const opp of res.opportunities) collected.push({ opp, run: oppRun });
                      } catch { /* 单个 run 无可读机会时忽略 */ }
                    }
                  } catch { /* 单个建议 run 无机会 run 时忽略 */ }
                }
              } catch { /* 单个诊断无建议时忽略 */ }
            }
          } catch { /* 单个报告无诊断时忽略 */ }
        }
        collected.sort((a, b) => b.opp.createdAt.localeCompare(a.opp.createdAt));
        setRows(collected);
      } catch (err) {
        setError(friendlyError(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  const visible = useMemo(() => {
    const filtered = runFilter ? rows.filter(r => r.opp.opportunityRunId === runFilter) : rows;
    return filtered.filter(r =>
      (!statusFilter || r.opp.status === statusFilter)
      && (!priorityFilter || r.opp.priority === priorityFilter)
      && (!typeFilter || r.opp.opportunityType === typeFilter));
  }, [rows, runFilter, statusFilter, priorityFilter, typeFilter]);

  const isFilteredRun = runFilter && rows.some(r => r.opp.opportunityRunId === runFilter);
  const noDataLimited = rows.length > 0 && visible.length === 0 && rows.every(r => r.run.summary?.blockedByDataQuality);

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header>
          <Link href="/app" className="text-sm text-blue-700 hover:underline">← 返回工作台</Link>
          <h1 className="mt-3 text-2xl font-semibold">内容机会</h1>
          <p className="mt-2 text-sm text-slate-500">
            由 GeoLens 根据 GEO 问题诊断与优化建议确定性生成的内容任务 brief：告诉你要补哪种内容资产、
            覆盖哪些 Query、关注哪些模型与已审核竞品、结构中必须有什么、原始证据在哪。
            {runFilter && isFilteredRun && (
              <Link href="/app/opportunities" className="ml-2 text-blue-700 hover:underline">← 查看全部</Link>
            )}
          </p>
        </header>

        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {OPPORTUNITY_NAV.whyHint}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label htmlFor="project" className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">项目</span>
              <select id="project" value={projectId} className="rounded-lg border border-slate-300 p-2 text-sm" onChange={e => setProjectId(e.target.value)}>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label htmlFor="status-filter" className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">状态</span>
              <select id="status-filter" value={statusFilter} className="rounded-lg border border-slate-300 p-2 text-sm" onChange={e => setStatusFilter(e.target.value)}>
                <option value="">全部</option>
                <option value="PROPOSED">待评估</option>
                <option value="APPROVED">已规划</option>
                <option value="DISMISSED">已忽略</option>
              </select>
            </label>
            <label htmlFor="priority-filter" className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">优先级</span>
              <select id="priority-filter" value={priorityFilter} className="rounded-lg border border-slate-300 p-2 text-sm" onChange={e => setPriorityFilter(e.target.value)}>
                <option value="">全部</option>
                <option value="HIGH">高</option>
                <option value="MEDIUM">中</option>
                <option value="LOW">低</option>
              </select>
            </label>
            <label htmlFor="type-filter" className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">机会类型</span>
              <select id="type-filter" value={typeFilter} className="rounded-lg border border-slate-300 p-2 text-sm" onChange={e => setTypeFilter(e.target.value)}>
                <option value="">全部</option>
                {Object.entries(OPPORTUNITY_TYPE).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <p className="ml-auto text-xs text-slate-400">共 {visible.length} 条内容机会</p>
          </div>
        </section>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {loading && (
          <section aria-busy="true" role="status" className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="space-y-0">
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="flex h-11 animate-pulse items-center gap-4 border-b border-slate-100 px-4 last:border-0">
                  <div className="h-3 w-12 rounded bg-slate-200" />
                  <div className="h-3 w-1/3 rounded bg-slate-200" />
                  <div className="h-3 w-20 rounded bg-slate-200" />
                  <div className="h-3 w-14 rounded bg-slate-200" />
                </div>
              ))}
            </div>
          </section>
        )}

        {!loading && !error && rows.length === 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            <p className="font-medium">{OPPORTUNITY_NAV.empty}</p>
            <p className="mx-auto mt-2 max-w-2xl">{OPPORTUNITY_NAV.emptyHint}</p>
            <p className="mt-4"><Link href="/app/recommendations" className="text-blue-700 hover:underline">{OPPORTUNITY_NAV.backToRecommendations}</Link></p>
          </section>
        )}

        {!loading && !error && rows.length > 0 && visible.length === 0 && !noDataLimited && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            没有符合条件的过滤结果，请调整筛选条件。
          </section>
        )}

        {noDataLimited && !error && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            {OPPORTUNITY_NAV.emptyDataLimited}
          </section>
        )}

        {visible.length > 0 && (
          <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full min-w-[1080px] border-collapse text-sm">
              <thead>
                <tr className="sticky top-0 border-b border-slate-200 bg-slate-100/80 text-left text-xs text-slate-500 backdrop-blur">
                  <th className="px-3 py-2.5 font-medium">优先级</th>
                  <th className="px-3 py-2.5 font-medium">内容方向</th>
                  <th className="px-3 py-2.5 font-medium">类型</th>
                  <th className="px-3 py-2.5 font-medium">场景</th>
                  <th className="px-3 py-2.5 font-medium">建议资产</th>
                  <th className="px-3 py-2.5 text-right font-medium">目标 Query 数</th>
                  <th className="px-3 py-2.5 font-medium">目标模型</th>
                  <th className="px-3 py-2.5 font-medium">关联竞品</th>
                  <th className="px-3 py-2.5 font-medium">预期影响指标</th>
                  <th className="px-3 py-2.5 font-medium">工作量</th>
                  <th className="px-3 py-2.5 font-medium">状态</th>
                  <th className="px-3 py-2.5 text-right font-medium">更多</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(row => {
                  const { opp, run } = row;
                  return (
                    <tr key={opp.id} className="h-11 border-b border-slate-100 align-middle transition-colors last:border-0 hover:bg-slate-50">
                      <td className="px-3">
                        <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold ${PRIO_BADGE[opp.priority] ?? ""}`}>
                          {formatOpportunityPriority(opp.priority)}
                          {opp.dataQualityLimited && <span title="数据质量 guard 已降级">↓</span>}
                        </span>
                      </td>
                      <td className="max-w-[280px] px-3">
                        <Link href={`/app/opportunities/${opp.id}`} className="block font-medium text-slate-900 hover:text-blue-700 hover:underline">
                          {opp.titleDirection}
                        </Link>
                        <span className="text-[11px] text-slate-400">
                          {run.metadata?.suiteName ? `${run.metadata.suiteName} v${run.metadata.suiteVersion ?? ""}` : "—"}
                          {run.metadata?.metricSource && run.metadata.metricSource !== "real" ? " · 演示数据" : ""}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 text-slate-600">{formatOpportunityAsset(opp.opportunityType)}</td>
                      <td className="max-w-[120px] truncate px-3 text-slate-600">{formatCategory(opp.category) || "—"}</td>
                      <td className="whitespace-nowrap px-3 text-slate-600">{formatOpportunityAsset(opp.assetType)}</td>
                      <td className="px-3 text-right font-semibold text-slate-700">{opp.targetQueryCount}</td>
                      <td className="max-w-[160px] px-3">
                        <span className="flex flex-wrap gap-1">
                          {opp.engines.length === 0 ? <span className="text-slate-400">—</span>
                            : opp.engines.map(e => (
                              <span key={`${e.provider}-${e.engineKey}`} className="rounded bg-teal-50 px-1.5 py-0.5 text-[11px] text-teal-800">
                                {engineLabel(e)}
                              </span>
                            ))}
                        </span>
                      </td>
                      <td className="max-w-[160px] px-3">
                        {opp.competitors.length === 0
                          ? <span className="text-slate-400">{OPPORTUNITY_NAV.noCompetitor}</span>
                          : <span className="flex flex-wrap gap-1">{opp.competitors.map(c => <span key={c.canonicalName} className="rounded bg-purple-50 px-1.5 py-0.5 text-[11px] text-purple-800">{c.canonicalName}</span>)}</span>}
                      </td>
                      <td className="max-w-[150px] px-3 text-xs text-slate-500">
                        {opp.expectedSignals.map(formatExpectedSignal).join(" · ") || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 text-slate-600">{formatEffortLevel(opp.effortLevel)}</td>
                      <td className="whitespace-nowrap px-3">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[opp.status] ?? ""}`}>{formatOpportunityStatus(opp.status)}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 text-right">
                        <Link href={`/app/opportunities/${opp.id}`} className="text-xs text-blue-700 hover:underline">查看</Link>
                        <span className="ml-2 text-[11px] text-slate-400">Query {opp.targetQueryCount} · 证据 {opp.evidenceCount} · 建议 {opp.recommendationCount}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </main>
  );
}

export default function OpportunitiesPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><p className="text-sm text-slate-500">正在加载内容机会…</p></main>}>
      <OpportunitiesInner />
    </Suspense>
  );
}
