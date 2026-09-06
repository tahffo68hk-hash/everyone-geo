"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { formatMetricSource, formatRunType, formatSourceType, friendlyError } from "@/lib/labels";

type Project = { id: string; name: string };
type ReportRow = {
  id: string;
  suiteName: string;
  suiteVersion: string;
  runType: "DEMO" | "REAL";
  provider: string;
  engineKey: string;
  engineName: string;
  requestedModel: string | null;
  responseModel: string | null;
  metricSource: "demo" | "real" | "mixed";
  analysisVersion: string;
  competitorSet: { id: string; name: string; version: string } | null;
  completion: { completedRuns: number; succeededRuns: number; failedRuns: number; analyzedRuns: number; partial: boolean };
  generatedAt: string;
  summary?: { visibilityRate: number | null };
};

const percent = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;

export default function ReportsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");

  /** 生成（幂等：已存在则返回既有诊断）并进入诊断详情。 */
  async function generateDiagnosis(reportId: string) {
    if (!reportId || busyId) return;
    setBusyId(reportId);
    try {
      const d = await api<{ id: string }>(`/reports/${reportId}/diagnoses`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      router.push(`/app/diagnosis/${d.id}`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyId("");
    }
  }

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
    api<ReportRow[]>(`/projects/${encodeURIComponent(projectId)}/reports`)
      .then(setReports)
      .catch(err => setError(friendlyError(err)))
      .finally(() => setLoading(false));
  }, [projectId]);

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/app" className="text-sm text-blue-700 hover:underline">← 返回工作台</Link>
            <h1 className="mt-3 text-2xl font-semibold">GEO 基准测试报告</h1>
            <p className="mt-2 text-sm text-slate-500">报告 = 生成时冻结的快照：测试集 / 分析版本 / 竞品集合 / 指标均不随后续编辑漂移。</p>
          </div>
          <Link href="/app/reports/compare" className="rounded-lg border border-blue-700 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">
            报告对比 →
          </Link>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <label htmlFor="project" className="mb-2 block text-sm font-medium">项目</label>
          <select id="project" value={projectId} className="w-full rounded-lg border border-slate-300 p-2 sm:max-w-sm" onChange={event => setProjectId(event.target.value)}>
            {projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </section>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {loading && <p role="status" className="text-sm text-slate-500">正在加载报告…</p>}
        {!loading && !error && reports.length === 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
            暂无基准测试报告 —— 请先在 GEO 基准测试中完成一次 Benchmark Run，再生成报告。
          </section>
        )}
        {reports.length > 0 && (
          <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-4">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">基准测试报告列表</caption>
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="p-2">测试集</th>
                  <th className="p-2">报告时间</th>
                  <th className="p-2">数据类型</th>
                  <th className="p-2">模型服务</th>
                  <th className="p-2">请求模型</th>
                  <th className="p-2">响应模型</th>
                  <th className="p-2">分析版本</th>
                  <th className="p-2">品牌可见率</th>
                  <th className="p-2">状态</th>
                  <th className="p-2">问题诊断</th>
                </tr>
              </thead>
              <tbody>
                {reports.map(report => (
                  <tr key={report.id} className="border-b border-slate-100 align-top">
                    <td className="p-2">
                      <Link href={`/app/reports/${report.id}`} className="font-medium text-blue-700 hover:underline">
                        {report.suiteName} v{report.suiteVersion}
                      </Link>
                      {report.competitorSet && <div className="text-xs text-slate-400">竞品集合 v{report.competitorSet.version}</div>}
                    </td>
                    <td className="p-2 whitespace-nowrap">{new Date(report.generatedAt).toLocaleString("zh-CN", { hour12: false })}</td>
                    <td className="p-2">{formatRunType(report.runType)} · {formatMetricSource(report.metricSource)}</td>
                    <td className="p-2">{report.provider === "mock" ? "演示（Mock）" : `${report.engineName ?? "DeepSeek"}`}</td>
                    <td className="p-2">{report.requestedModel ?? "历史记录未保存"}</td>
                    <td className="p-2">{report.responseModel ?? "未知"}</td>
                    <td className="p-2 font-mono text-xs">{report.analysisVersion}</td>
                    <td className="p-2">{percent(report.summary?.visibilityRate)}</td>
                    <td className="p-2">
                      {report.completion.partial
                        ? <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">部分完成</span>
                        : <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">已完成</span>}
                      <div className="mt-0.5 text-[10px] text-slate-400">成功 {report.completion.succeededRuns}/{report.completion.completedRuns}</div>
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      {report.completion.succeededRuns > 0 ? (
                        <button type="button" disabled={busyId !== ""} onClick={() => void generateDiagnosis(report.id)}
                          className="rounded-lg border border-indigo-700 px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
                          {busyId === report.id ? "生成中…" : "生成 GEO 问题诊断"}
                        </button>
                      ) : <span className="text-slate-300">—</span>}
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
