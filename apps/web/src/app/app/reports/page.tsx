"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useProjectContext } from "@/components/project-context";
import { PageHeader, LoadingSkeleton, EmptyState, StatusBadge } from "@/components/ui";
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
              className="ui-button secondary compact"
            >
              + 运行基准测试
            </Link>
            <Link
              href="/app/reports/compare"
              className="ui-button primary compact"
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
        <div className="surface overflow-hidden">
          <div className="section-heading">
            <h2>
              <span>基准测试快照记录</span>
              <span className="text-xs font-normal text-slate-400">（共 {reports.length} 份冻结报告）</span>
            </h2>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <caption className="sr-only">基准测试报告列表</caption>
              <thead>
                <tr>
                  <th>测试集</th>
                  <th>报告时间</th>
                  <th>数据类型</th>
                  <th>模型服务</th>
                  <th>请求模型</th>
                  <th>响应模型</th>
                  <th>分析版本</th>
                  <th>品牌可见率</th>
                  <th>状态</th>
                  <th className="text-right">问题诊断与解读</th>
                </tr>
              </thead>
              <tbody>
                {reports.map(report => (
                  <tr key={report.id}>
                    <td>
                      <Link href={`/app/reports/${report.id}`} className="font-semibold text-slate-900 hover:text-indigo-600 transition">
                        {report.suiteName} {formatVersion(report.suiteVersion)}
                      </Link>
                      {report.competitorSet && <small>竞品集合 {formatVersion(report.competitorSet.version)}</small>}
                    </td>
                    <td className="whitespace-nowrap text-slate-600 text-xs">{new Date(report.generatedAt).toLocaleString("zh-CN", { hour12: false })}</td>
                    <td className="whitespace-nowrap text-xs text-slate-700">
                      <span className="px-2 py-0.5 rounded bg-slate-100 font-medium text-slate-700 border border-slate-200">
                        {formatRunType(report.runType)}
                      </span>
                      <span className="ml-1 text-slate-400">· {formatMetricSource(report.metricSource)}</span>
                    </td>
                    <td className="whitespace-nowrap text-xs font-medium text-slate-800">{report.provider === "mock" ? "演示（Mock）" : `${report.engineName ?? "DeepSeek"}`}</td>
                    <td className="text-slate-600 font-mono text-[11px]">{report.requestedModel ?? "历史记录未保存"}</td>
                    <td className="text-slate-600 font-mono text-[11px]">{report.responseModel ?? "未知"}</td>
                    <td>
                      <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-slate-50 text-slate-600 border border-slate-200">
                        {report.analysisVersion}
                      </span>
                    </td>
                    <td>
                      <span className={`font-bold tabular-nums text-sm ${
                        (report.summary?.visibilityRate ?? 0) >= 0.6 ? "text-emerald-600" : (report.summary?.visibilityRate ?? 0) >= 0.3 ? "text-amber-600" : "text-rose-600"
                      }`}>
                        {percent(report.summary?.visibilityRate)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap">
                      <StatusBadge status={report.completion.partial ? "PARTIAL" : "COMPLETED"} />
                      <div className="mt-0.5 text-[10px] text-slate-400">成功 {report.completion.succeededRuns}/{report.completion.completedRuns}</div>
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-2">
                        {report.completion.succeededRuns > 0 ? (
                          <button
                            type="button"
                            disabled={busyId !== ""}
                            onClick={() => void generateDiagnosis(report.id)}
                            className="ui-button secondary compact text-xs"
                          >
                            {busyId === report.id ? "生成中…" : "生成 GEO 诊断"}
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
          </div>
        </div>
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
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-xs text-slate-500 font-medium">执行摘要：</span>
              <p className="text-sm text-slate-800 mt-1 leading-relaxed">{aiReportResult.executiveSummary}</p>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-700">核心洞察与发现：</span>
              <ul className="space-y-1.5 text-xs text-slate-700">
                {aiReportResult.keyFindings.map((kf, idx) => (
                  <li key={idx} className="p-2.5 bg-slate-50 rounded border border-slate-200 flex items-start gap-2">
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
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-500">
                <span className="font-semibold text-slate-700">数据与观测局限性：</span>
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
