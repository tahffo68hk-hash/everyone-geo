"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useProjectContext } from "@/components/project-context";
import { PageHeader, LoadingSkeleton, EmptyState } from "@/components/ui";
import { formatMetricSource, formatRunType, formatVersion, friendlyError } from "@/lib/labels";
import { AiActionButton } from "@/components/ai/ai-action-button";
import { AiGenerationModal } from "@/components/ai/ai-generation-modal";
import { summarizeAiReport, type AiResponseMeta } from "@/lib/ai-api";

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

const percent = (value: number | null | undefined) => (value == null ? "—" : `${(value * 100).toFixed(1)}%`);

export default function ReportsPage() {
  const router = useRouter();
  const { projectId, project, loading: projectLoading } = useProjectContext();
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");

  // AI 总结状态
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiMeta, setAiMeta] = useState<AiResponseMeta | null>(null);
  const [selectedReport, setSelectedReport] = useState<ReportRow | null>(null);
  const [aiReportResult, setAiReportResult] = useState<{
    executiveSummary: string;
    keyFindings: string[];
    evidenceLimitations: string[];
    recommendedNextSteps: string[];
  } | null>(null);

  async function handleAiSummarizeReport(report?: ReportRow) {
    if (!projectId) return;
    const targetRep = report || reports[0];
    setSelectedReport(targetRep || null);
    setIsAiModalOpen(true);
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await summarizeAiReport(projectId, {
        reportId: targetRep?.id,
        overallScore: targetRep?.summary?.visibilityRate ?? 0.75,
      });
      setAiMeta(res);
      setAiReportResult(res.data);
    } catch (e: any) {
      setAiError(e?.message || "AI 总结报告失败");
    } finally {
      setAiLoading(false);
    }
  }

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
    if (!projectId) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<ReportRow[]>(`/projects/${encodeURIComponent(projectId)}/reports`, { signal: controller.signal })
      .then(setReports)
      .catch(err => {
        if (!controller.signal.aborted) setError(friendlyError(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId]);

  if (projectLoading) return <LoadingSkeleton rows={6} />;
  if (!projectId) {
    return (
      <EmptyState
        title="请先选择监测项目"
        description="选择或创建项目后，方可查看该项目的 GEO 基准测试报告快照。"
        href="/app/projects/new"
        action="新建监测项目"
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="GEO 基准测试报告"
        description={`不可变报告快照：测试集、分析版本、竞品集合与指标均在生成时冻结，不随后续操作漂移。当前项目：${project?.name ?? "未选择"}`}
        actions={
          <div className="flex items-center gap-2">
            {reports.length > 0 && (
              <AiActionButton
                label="AI 总结全周期报告"
                onClick={() => handleAiSummarizeReport()}
                loading={aiLoading && !selectedReport}
              />
            )}
            <Link
              href="/app/benchmark"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50"
            >
              + 运行基准测试
            </Link>
            <Link
              href="/app/reports/compare"
              className="rounded-lg bg-teal-700 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-teal-800"
            >
              报告对比 →
            </Link>
          </div>
        }
      />

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      
      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : reports.length === 0 ? (
        <EmptyState
          title="暂无基准测试报告"
          description="请先在 GEO 基准测试中完成一次 Benchmark Run，再生成报告快照。"
          href="/app/benchmark"
          action="前往基准测试"
        />
      ) : (
        <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xs">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">基准测试报告列表</caption>
            <thead className="border-b border-slate-200 bg-slate-50/80 text-slate-600 font-semibold">
              <tr>
                <th className="p-3">测试集</th>
                <th className="p-3">报告时间</th>
                <th className="p-3">数据类型</th>
                <th className="p-3">模型服务</th>
                <th className="p-3">请求模型</th>
                <th className="p-3">响应模型</th>
                <th className="p-3">分析版本</th>
                <th className="p-3">品牌可见率</th>
                <th className="p-3">状态</th>
                <th className="p-3 text-right">问题诊断</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reports.map(report => (
                <tr key={report.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="p-3">
                    <Link href={`/app/reports/${report.id}`} className="font-semibold text-teal-700 hover:text-teal-800 hover:underline">
                      {report.suiteName} {formatVersion(report.suiteVersion)}
                    </Link>
                    {report.competitorSet && <div className="text-[11px] text-slate-400 mt-0.5">竞品集合 {formatVersion(report.competitorSet.version)}</div>}
                  </td>
                  <td className="p-3 whitespace-nowrap text-slate-600">{new Date(report.generatedAt).toLocaleString("zh-CN", { hour12: false })}</td>
                  <td className="p-3 whitespace-nowrap text-slate-700">{formatRunType(report.runType)} · {formatMetricSource(report.metricSource)}</td>
                  <td className="p-3 whitespace-nowrap text-slate-700">{report.provider === "mock" ? "演示（Mock）" : `${report.engineName ?? "DeepSeek"}`}</td>
                  <td className="p-3 text-slate-600 font-mono text-[11px]">{report.requestedModel ?? "历史记录未保存"}</td>
                  <td className="p-3 text-slate-600 font-mono text-[11px]">{report.responseModel ?? "未知"}</td>
                  <td className="p-3 font-mono text-[11px] text-slate-600">{report.analysisVersion}</td>
                  <td className="p-3 font-bold text-slate-900 tabular-nums">{percent(report.summary?.visibilityRate)}</td>
                  <td className="p-3 whitespace-nowrap">
                    {report.completion.partial
                      ? <span className="inline-flex rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-800">部分完成</span>
                      : <span className="inline-flex rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">已完成</span>}
                    <div className="mt-0.5 text-[10px] text-slate-400">成功 {report.completion.succeededRuns}/{report.completion.completedRuns}</div>
                  </td>
                  <td className="p-3 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      {report.completion.succeededRuns > 0 ? (
                        <button
                          type="button"
                          disabled={busyId !== ""}
                          onClick={() => void generateDiagnosis(report.id)}
                          className="rounded-lg bg-teal-50 border border-teal-200 px-2.5 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-100 disabled:opacity-50"
                        >
                          {busyId === report.id ? "生成中…" : "生成 GEO 问题诊断"}
                        </button>
                      ) : <span className="text-slate-300">—</span>}

                      <AiActionButton
                        size="sm"
                        label="AI 总结"
                        onClick={() => handleAiSummarizeReport(report)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* AI 报告总结弹窗 */}
      <AiGenerationModal
        isOpen={isAiModalOpen}
        onClose={() => setIsAiModalOpen(false)}
        title={`AI 总结报告：${selectedReport ? selectedReport.suiteName : "全周期报告"}`}
        description="客观提炼测试集的核心表现、亮点、证据局限性与下一步行动"
        loading={aiLoading}
        error={aiError}
        meta={aiMeta}
        onRegenerate={() => handleAiSummarizeReport(selectedReport || undefined)}
      >
        {aiReportResult && (
          <div className="space-y-4">
            <div className="p-3 bg-zinc-950/60 rounded-lg border border-zinc-800">
              <span className="text-xs text-zinc-400 font-medium">执行摘要：</span>
              <p className="text-sm text-zinc-200 mt-1 leading-relaxed">{aiReportResult.executiveSummary}</p>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-semibold text-zinc-300">核心洞察与发现：</span>
              <ul className="space-y-1.5 text-xs text-zinc-300">
                {aiReportResult.keyFindings.map((kf, idx) => (
                  <li key={idx} className="p-2.5 bg-zinc-950/40 rounded border border-zinc-800 flex items-start gap-2">
                    <span className="text-indigo-400 font-bold">•</span>
                    <span>{kf}</span>
                  </li>
                ))}
              </ul>
            </div>

            {aiReportResult.recommendedNextSteps.length > 0 && (
              <div className="p-3 bg-indigo-950/20 border border-indigo-800/40 rounded-lg text-xs">
                <span className="font-semibold text-indigo-300">建议下一步行动 (AI 建议，非强制)：</span>
                <ul className="list-disc pl-4 mt-1.5 text-indigo-200/90 space-y-1">
                  {aiReportResult.recommendedNextSteps.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ul>
              </div>
            )}

            {aiReportResult.evidenceLimitations.length > 0 && (
              <div className="p-2.5 bg-zinc-950/40 border border-zinc-800 rounded text-[11px] text-zinc-400">
                <span className="font-semibold text-zinc-300">数据与观测局限性：</span>
                <ul className="list-disc pl-4 mt-1 space-y-0.5">
                  {aiReportResult.evidenceLimitations.map((lim, idx) => (
                    <li key={idx}>{lim}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </AiGenerationModal>
    </div>
  );
}
