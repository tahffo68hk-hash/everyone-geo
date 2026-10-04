"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import {
  formatExperimentStatus, formatOpportunityAsset, formatOutcome,
  friendlyError, EXPERIMENT_NAV,
} from "@/lib/labels";

type Project = { id: string; name: string };
type Experiment = {
  id: string; contentOpportunityId: string; experimentVersion: string; title: string;
  status: string; metricSource: string; provider: string; requestedModel: string | null;
  suiteName: string | null; suiteVersion: string | null; plannedQueryCount: number;
  executionRecordedAt: string | null; completedAt: string | null; createdAt: string;
  metadata: { contentOpportunityType?: string; contentOpportunityTitleDirection?: string } | null;
};
type Evaluation = {
  id: string; outcome: string; verdict: string; generatedAt: string;
  summary: { queryCounts?: { gainedVisibility?: number; gainedRecommendation?: number; notEvaluable?: number } } | null;
};
type OppBrief = { id: string; opportunityType: string; titleDirection: string };
type Row = { exp: Experiment; opp: OppBrief; latestEvaluation: Evaluation | null };

const EXP_STATUS_BADGE: Record<string, string> = {
  PLANNED: "bg-slate-100 text-slate-600", EXECUTION_RECORDED: "bg-blue-100 text-blue-800",
  RETEST_RUNNING: "bg-amber-100 text-amber-800", EVALUATED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-slate-200 text-slate-500",
};

function ExperimentsInner() {
  const params = useSearchParams();
  const oppFilter = params.get("opp") ?? "";
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");

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
                    const oppRuns = await api<Array<{ id: string }>>(`/recommendation-runs/${recRun.id}/opportunities`);
                    for (const oppRun of oppRuns) {
                      try {
                        const oppRows = await api<{ opportunities: Array<OppBrief & { id: string }> }>(`/opportunity-runs/${oppRun.id}/opportunities`);
                        for (const opp of oppRows.opportunities) {
                          try {
                            const exps = await api<Experiment[]>(`/content-opportunities/${opp.id}/experiments`);
                            for (const exp of exps) {
                              try {
                                const evs = await api<{ evaluations: Evaluation[] }>(`/experiments/${exp.id}/evaluations`);
                                collected.push({ exp, opp: { id: opp.id, opportunityType: opp.opportunityType, titleDirection: opp.titleDirection }, latestEvaluation: evs.evaluations[0] ?? null });
                              } catch {
                                collected.push({ exp, opp: { id: opp.id, opportunityType: opp.opportunityType, titleDirection: opp.titleDirection }, latestEvaluation: null });
                              }
                            }
                          } catch { /* 该机会无实验 */ }
                        }
                      } catch { /* 单个机会 run 无内容机会 */ }
                    }
                  } catch { /* 单个建议 run 无机会 run */ }
                }
              } catch { /* 单个诊断无建议 */ }
            }
          } catch { /* 单个报告无诊断 */ }
        }
        collected.sort((a, b) => b.exp.createdAt.localeCompare(a.exp.createdAt));
        setRows(collected);
      } catch (err) {
        setError(friendlyError(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  const visible = useMemo(() => {
    const filtered = oppFilter ? rows.filter(r => r.exp.contentOpportunityId === oppFilter) : rows;
    return filtered.filter(r => !statusFilter || r.exp.status === statusFilter);
  }, [rows, oppFilter, statusFilter]);

  const isOppFiltered = oppFilter && rows.some(r => r.exp.contentOpportunityId === oppFilter);

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header>
          <Link href="/app" className="text-sm text-blue-700 hover:underline">← 返回工作台</Link>
          <h1 className="mt-3 text-2xl font-semibold">优化实验</h1>
          <p className="mt-2 text-sm text-slate-500">
            Before → 执行记录 → Frozen Re-test → After → 评估（Observed Outcome ≠ Proven Causal Effect）。
            复测始终复用基线测试问题快照（query fingerprint 一致），杜绝口径漂移。
            {isOppFiltered && (
              <Link href="/app/experiments" className="ml-2 text-blue-700 hover:underline">← 查看全部</Link>
            )}
          </p>
        </header>

        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {EXPERIMENT_NAV.attributionDisclaimer}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label htmlFor="project" className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">项目</span>
              <select id="project" value={projectId} className="rounded-lg border border-slate-300 p-2 text-sm" onChange={e => setProjectId(e.target.value)}>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label htmlFor="exp-status-filter" className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">实验状态</span>
              <select id="exp-status-filter" value={statusFilter} className="rounded-lg border border-slate-300 p-2 text-sm" onChange={e => setStatusFilter(e.target.value)}>
                <option value="">全部</option>
                <option value="PLANNED">已规划</option>
                <option value="EXECUTION_RECORDED">已记录执行</option>
                <option value="RETEST_RUNNING">复测中</option>
                <option value="EVALUATED">已评估</option>
                <option value="CANCELLED">已取消</option>
              </select>
            </label>
            <p className="ml-auto text-xs text-slate-400">共 {visible.length} 个实验</p>
          </div>
        </section>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {loading && (
          <section aria-busy="true" role="status" className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="flex h-11 animate-pulse items-center gap-4 border-b border-slate-100 px-4 last:border-0">
                <div className="h-3 w-1/4 rounded bg-slate-200" />
                <div className="h-3 w-24 rounded bg-slate-200" />
                <div className="h-3 w-16 rounded bg-slate-200" />
                <div className="h-3 w-14 rounded bg-slate-200" />
              </div>
            ))}
          </section>
        )}

        {!loading && !error && rows.length === 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            <p className="font-medium">{EXPERIMENT_NAV.emptyExperiments}</p>
            <p className="mx-auto mt-2 max-w-2xl">{EXPERIMENT_NAV.emptyHint}</p>
            <p className="mt-4"><Link href="/app/opportunities" className="text-blue-700 hover:underline">{EXPERIMENT_NAV.backToOpportunities}</Link></p>
          </section>
        )}

        {visible.length > 0 && (
          <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[1080px] border-collapse text-sm">
              <thead>
                <tr className="sticky top-0 border-b border-slate-200 bg-slate-100/80 text-left text-xs text-slate-500">
                  <th className="px-3 py-2.5 font-medium">实验</th>
                  <th className="px-3 py-2.5 font-medium">来源内容机会</th>
                  <th className="px-3 py-2.5 font-medium">基线</th>
                  <th className="px-3 py-2.5 font-medium">状态</th>
                  <th className="px-3 py-2.5 font-medium">复测/评估</th>
                  <th className="px-3 py-2.5 font-medium">Observed Outcome</th>
                  <th className="px-3 py-2.5 font-medium">Provider / 类型</th>
                  <th className="px-3 py-2.5 font-medium">创建时间</th>
                  <th className="px-3 py-2.5 text-right font-medium">更多</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ exp, opp, latestEvaluation }) => (
                  <tr key={exp.id} className="h-11 border-b border-slate-100 align-middle transition-colors last:border-0 hover:bg-slate-50">
                    <td className="max-w-[260px] px-3">
                      <Link href={`/app/experiments/${exp.id}`} className="block font-medium text-slate-900 hover:text-blue-700 hover:underline">{exp.title}</Link>
                      <span className="text-[11px] text-slate-400">{exp.experimentVersion} · Query {exp.plannedQueryCount} · 指纹 已冻结</span>
                    </td>
                    <td className="max-w-[220px] px-3">
                      <span className="block truncate text-slate-600">{formatOpportunityAsset(opp.opportunityType)} · {opp.titleDirection}</span>
                      <Link href={`/app/opportunities/${opp.id}`} className="text-[11px] text-blue-700 hover:underline">查看内容机会</Link>
                    </td>
                    <td className="whitespace-nowrap px-3 text-slate-600">{exp.suiteName ? `${exp.suiteName} v${exp.suiteVersion ?? ""}` : "—"}</td>
                    <td className="whitespace-nowrap px-3">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${EXP_STATUS_BADGE[exp.status] ?? ""}`}>{formatExperimentStatus(exp.status)}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 text-slate-600">
                      {latestEvaluation ? `${formatExperimentStatus("EVALUATED")} ${new Date(latestEvaluation.generatedAt).toLocaleDateString("zh-CN")}` : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3">
                      {latestEvaluation
                        ? <span className="font-medium text-slate-700">{formatOutcome(latestEvaluation.outcome)}</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 text-slate-600">
                      {exp.provider}
                      <span className="ml-1 text-[11px] text-slate-400">{exp.metricSource === "real" ? "真实" : "演示"}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 text-xs text-slate-500">{new Date(exp.createdAt).toLocaleString("zh-CN", { hour12: false })}</td>
                    <td className="whitespace-nowrap px-3 text-right">
                      <Link href={`/app/experiments/${exp.id}`} className="text-xs text-blue-700 hover:underline">查看</Link>
                      <span className="ml-2 text-[11px] text-slate-400">{exp.status === "EVALUATED" ? "已评估" : "未评估"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </main>
  );
}

export default function ExperimentsPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><p className="text-sm text-slate-500">正在加载优化实验…</p></main>}>
      <ExperimentsInner />
    </Suspense>
  );
}
