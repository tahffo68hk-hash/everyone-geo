"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatMetricSource, friendlyError } from "@/lib/labels";

type Project = { id: string; name: string };
type ReportRow = { id: string; suiteName: string; suiteVersion: string; metricSource: string };
type RecRun = {
  id: string; diagnosisRunId: string; recommendationVersion: string;
  summary: { priorityCounts: { HIGH: number; MEDIUM: number; LOW: number }; recommendationCount: number; actionItemCount: number; directions: string[] };
  metadata: { metricSource?: string | null };
  generatedAt: string;
};

export default function RecommendationsListPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState<Array<{ run: RecRun; report: ReportRow }>>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

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
        const reports = await api<ReportRow[]>(`/projects/${encodeURIComponent(projectId)}/reports`);
        const collected: Array<{ run: RecRun; report: ReportRow }> = [];
        for (const report of reports) {
          try {
            const diags = await api<Array<{ id: string }>>(`/reports/${report.id}/diagnoses`);
            for (const d of diags) {
              try {
                const runs = await api<RecRun[]>(`/diagnoses/${d.id}/recommendations`);
                for (const run of runs) collected.push({ run, report });
              } catch { /* 单个诊断无建议 run 时忽略 */ }
            }
          } catch { /* 单个 report 无诊断时忽略 */ }
        }
        collected.sort((a, b) => b.run.generatedAt.localeCompare(a.run.generatedAt));
        setRows(collected);
      } catch (err) {
        setError(friendlyError(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <Link href="/app" className="text-sm text-blue-700 hover:underline">← 返回工作台</Link>
          <h1 className="mt-3 text-2xl font-semibold">GEO 优化建议</h1>
          <p className="mt-2 text-sm text-slate-500">
            基于 GEO 问题诊断（M7A）生成的优化行动建议（hypothesis-backed，非因果证明、非效果承诺）。
            每个建议都可回链到诊断 → 测试问题 → 原始回答；效果须后续复测验证。
          </p>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <label htmlFor="project" className="mb-2 block text-sm font-medium">项目</label>
          <select id="project" value={projectId} className="w-full rounded-lg border border-slate-300 p-2 sm:max-w-sm" onChange={event => setProjectId(event.target.value)}>
            {projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </section>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {loading && <p role="status" className="text-sm text-slate-500">正在加载优化建议…</p>}
        {!loading && !error && rows.length === 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
            暂无优化建议 —— 请先在「GEO 问题诊断」页为报告生成诊断，再基于诊断生成优化建议。
          </section>
        )}
        {rows.length > 0 && (
          <section className="space-y-3">
            {rows.map(({ run, report }) => {
              const c = run.summary?.priorityCounts ?? { HIGH: 0, MEDIUM: 0, LOW: 0 };
              return (
                <div key={run.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/app/recommendations/${run.id}`} className="text-base font-semibold text-blue-700 hover:underline">
                      {report.suiteName} v{report.suiteVersion} · 优化建议
                    </Link>
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">{run.recommendationVersion}</span>
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{formatMetricSource(report.metricSource)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">来源诊断：{run.diagnosisRunId} · 生成 {new Date(run.generatedAt).toLocaleString("zh-CN", { hour12: false })}</p>
                  <p className="mt-2 text-sm">
                    建议 {run.summary?.recommendationCount ?? "—"} 条 · 行动项 {run.summary?.actionItemCount ?? "—"} 项 ·
                    高 <span className="font-semibold text-red-700">{c.HIGH}</span> ·
                    中 <span className="font-semibold text-amber-700">{c.MEDIUM}</span> ·
                    低 <span className="font-semibold text-blue-700">{c.LOW}</span>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1 text-xs">
                    {(run.summary?.directions ?? []).map(d => (
                      <span key={d} className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-600">{d}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
