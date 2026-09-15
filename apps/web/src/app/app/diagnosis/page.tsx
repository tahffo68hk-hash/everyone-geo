"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  DIAGNOSIS_NAV, formatMetricSource, formatSeverity, formatVersion, friendlyError, SEVERITY_BADGE,
} from "@/lib/labels";

type Project = { id: string; name: string };
type ReportRow = { id: string; suiteName: string; suiteVersion: string; metricSource: string; generatedAt: string };
type DiagnosisRow = {
  id: string; reportId: string; diagnosisVersion: string; status: string;
  generatedAt: string; findingCount?: number | null;
  summary: { severityCounts: { HIGH: number; MEDIUM: number; LOW: number; INFO: number }; findingCount: number } | null;
};

export default function DiagnosisListPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState<Array<{ diagnosis: DiagnosisRow; report: ReportRow }>>([]);
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
        const byId = new Map(reports.map(r => [r.id, r]));
        const collected: Array<{ diagnosis: DiagnosisRow; report: ReportRow }> = [];
        for (const report of reports) {
          try {
            const list = await api<DiagnosisRow[]>(`/reports/${report.id}/diagnoses`);
            for (const d of list) collected.push({ diagnosis: d, report: byId.get(report.id)! });
          } catch { /* 单个 report 失败不阻塞整体 */ }
        }
        collected.sort((a, b) => b.diagnosis.generatedAt.localeCompare(a.diagnosis.generatedAt));
        setRows(collected);
      } catch (err) {
        setError(friendlyError(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  const counts = (d: DiagnosisRow) => d.summary?.severityCounts ?? { HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <Link href="/app" className="text-sm text-blue-700 hover:underline">← 返回工作台</Link>
          <h1 className="mt-3 text-2xl font-semibold">GEO 问题诊断</h1>
          <p className="mt-2 text-sm text-slate-500">
            基于已冻结的基准测试报告，用确定性规则定位问题（品牌整体/场景/具体问题/模型差异/竞品信号/引用与情感风险），
            每个判断都可追溯到原始证据。阈值属 GeoLens 内部启发式，非行业标准。
          </p>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <label htmlFor="project" className="mb-2 block text-sm font-medium">项目</label>
          <select id="project" value={projectId} className="w-full rounded-lg border border-slate-300 p-2 sm:max-w-sm" onChange={event => setProjectId(event.target.value)}>
            {projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </section>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {loading && <p role="status" className="text-sm text-slate-500">正在加载诊断…</p>}
        {!loading && !error && rows.length === 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
            {DIAGNOSIS_NAV.noDiagnosis} —— 请在「GEO 基准测试报告」中为已完成报告点击「生成 GEO 问题诊断」。
          </section>
        )}
        {rows.length > 0 && (
          <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-4">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">GEO 问题诊断列表</caption>
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="p-2">测试集</th>
                  <th className="p-2">数据类型</th>
                  <th className="p-2">诊断版本</th>
                  <th className="p-2">生成时间</th>
                  <th className="p-2">诊断项</th>
                  <th className="p-2">优先级（高/中/低/提示）</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ diagnosis, report }) => {
                  const c = counts(diagnosis);
                  return (
                    <tr key={diagnosis.id} className="border-b border-slate-100 align-top">
                      <td className="p-2">{report.suiteName} {formatVersion(report.suiteVersion)}</td>
                      <td className="p-2">{formatMetricSource(report.metricSource)}</td>
                      <td className="p-2 font-mono text-xs">{diagnosis.diagnosisVersion}</td>
                      <td className="p-2 whitespace-nowrap text-slate-600">{new Date(diagnosis.generatedAt).toLocaleString()}</td>
                      <td className="p-2">{diagnosis.findingCount ?? diagnosis.summary?.findingCount ?? "—"}</td>
                      <td className="p-2 whitespace-nowrap">
                        <span className={`mr-1 rounded px-1.5 py-0.5 text-xs font-semibold ${SEVERITY_BADGE.HIGH}`}>高 {c.HIGH}</span>
                        <span className={`mr-1 rounded px-1.5 py-0.5 text-xs font-semibold ${SEVERITY_BADGE.MEDIUM}`}>中 {c.MEDIUM}</span>
                        <span className={`mr-1 rounded px-1.5 py-0.5 text-xs font-semibold ${SEVERITY_BADGE.LOW}`}>低 {c.LOW}</span>
                        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${SEVERITY_BADGE.INFO}`}>提示 {c.INFO}</span>
                      </td>
                      <td className="p-2 whitespace-nowrap"><Link href={`/app/diagnosis/${diagnosis.id}`} className="text-blue-700 underline">查看详情</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
        {rows.length > 0 && (
          <p className="text-xs text-slate-400">诊断项按 {formatSeverity("HIGH")}/{formatSeverity("MEDIUM")}/{formatSeverity("LOW")}/{formatSeverity("INFO")} 统计 · 全部为确定性规则输出。</p>
        )}
      </div>
    </main>
  );
}
