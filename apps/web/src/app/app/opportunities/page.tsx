"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useProjectContext } from "@/components/project-context";
import { PageHeader, EmptyState, LoadingSkeleton } from "@/components/ui";
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
  const { projectId: contextProjectId } = useProjectContext();
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
        const preferred = (contextProjectId && data.projects.find(p => p.id === contextProjectId)) ?? first;
        if (preferred) setProjectId(preferred.id);
      })
      .catch(err => setError(friendlyError(err)))
      .finally(() => setLoading(false));
  }, [contextProjectId]);

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
    <div className="space-y-6">
      <PageHeader
        title="内容机会"
        description="根据 GEO 问题诊断与优化建议生成的内容任务 brief，梳理待建设的内容资产类型、目标问题、模型差异与引用证据。"
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="project" className="text-xs text-slate-500 font-medium">项目：</label>
            <select id="project" value={projectId} className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-700 focus:outline-hidden" onChange={e => setProjectId(e.target.value)}>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        }
      />

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
        {OPPORTUNITY_NAV.whyHint}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
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
          <section aria-busy="true" role="status" className="overflow-hidden rounded-lg border border-slate-200 bg-white">
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
          <EmptyState
            title="暂无内容机会"
            description="内容机会由系统基于优化建议提炼而成。请先在优化建议中确认方向并生成内容机会。"
            href={`/app/recommendations?project=${encodeURIComponent(projectId)}`}
            action="查看优化建议"
          />
        )}

        {!loading && !error && rows.length > 0 && visible.length === 0 && !noDataLimited && (
          <section className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            没有符合条件的过滤结果，请调整筛选条件。
          </section>
        )}

        {noDataLimited && !error && (
          <section className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            {OPPORTUNITY_NAV.emptyDataLimited}
          </section>
        )}

        {visible.length > 0 && (
          <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[1080px] border-collapse text-sm">
              <thead>
                <tr className="sticky top-0 border-b border-slate-200 bg-slate-100/80 text-left text-xs text-slate-500">
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
  );
}

export default function OpportunitiesPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-slate-400">正在加载内容机会…</div>}>
      <OpportunitiesInner />
    </Suspense>
  );
}
