"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useProjectContext } from "@/components/project-context";
import { PageHeader, EmptyState, LoadingSkeleton } from "@/components/ui";
import {
  DIAGNOSIS_NAV, formatMetricSource, formatSeverity, formatVersion, friendlyError, SEVERITY_BADGE,
} from "@/lib/labels";
import { AiActionButton } from "@/components/ai/ai-action-button";
import { AiGenerationModal } from "@/components/ai/ai-generation-modal";
import { explainAiDiagnosis, type AiResponseMeta } from "@/lib/ai-api";

type Project = { id: string; name: string };
type ReportRow = { id: string; suiteName: string; suiteVersion: string; metricSource: string; generatedAt: string };
type DiagnosisRow = {
  id: string; reportId: string; diagnosisVersion: string; status: string;
  generatedAt: string; findingCount?: number | null;
  summary: { severityCounts: { HIGH: number; MEDIUM: number; LOW: number; INFO: number }; findingCount: number } | null;
};

export default function DiagnosisListPage() {
  const { projectId: contextProjectId } = useProjectContext();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState<Array<{ diagnosis: DiagnosisRow; report: ReportRow }>>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // AI 解读状态
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiMeta, setAiMeta] = useState<AiResponseMeta | null>(null);
  const [selectedDiag, setSelectedDiag] = useState<{ diag: DiagnosisRow; report: ReportRow } | null>(null);
  const [aiExplanationResult, setAiExplanationResult] = useState<{
    summary: string;
    explanation: string;
    keyFindings: Array<{ point: string; impact: string; reason: string }>;
    supportingEvidenceIds: string[];
    limitations: string[];
  } | null>(null);

  async function handleAiExplain(diagnosis: DiagnosisRow, report: ReportRow) {
    setSelectedDiag({ diag: diagnosis, report });
    setIsAiModalOpen(true);
    setAiLoading(true);
    setAiError(null);
    try {
      const c = counts(diagnosis);
      const res = await explainAiDiagnosis(projectId, {
        diagnosisRunId: diagnosis.id,
        diagnosisSummary: `针对 ${report.suiteName} (${report.metricSource}) 的基准测试诊断，发现高风险问题 ${c.HIGH} 项，中风险 ${c.MEDIUM} 项。`,
        findings: [
          { severity: "HIGH", count: c.HIGH },
          { severity: "MEDIUM", count: c.MEDIUM },
        ],
      });
      setAiMeta(res);
      setAiExplanationResult(res.data);
    } catch (e: any) {
      setAiError(e?.message || "AI 诊断解读失败");
    } finally {
      setAiLoading(false);
    }
  }

  useEffect(() => {
    api<{ projects: Project[] }>("/monitor-tasks/options")
      .then(data => {
        setProjects(data.projects);
        const first = data.projects[0];
        const preferred = data.projects.find(item => item.id === contextProjectId) ?? first;
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
    <div className="space-y-6">
      <PageHeader
        title="GEO 问题诊断"
        description="基于已冻结的基准测试报告，用确定性规则定位问题（品牌整体/场景/具体问题/模型差异/竞品信号/引用与情感风险），每个判断都可追溯到原始证据。"
        actions={
          <div className="flex items-center gap-3">
            <label htmlFor="project" className="text-xs text-slate-500 font-medium">监测项目：</label>
            <select
              id="project"
              value={projectId}
              className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-700 focus:border-indigo-500 focus:outline-hidden"
              onChange={event => setProjectId(event.target.value)}
            >
              {projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
        }
      />

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {loading && <LoadingSkeleton rows={4} />}
      {!loading && !error && rows.length === 0 && (
        <EmptyState
          title="暂无 GEO 问题诊断"
          description="请在「GEO 基准测试报告」中为已完成报告点击「生成 GEO 问题诊断」。"
          href="/app/reports"
          action="前往基准报告"
        />
      )}
      {rows.length > 0 && (
        <div className="surface overflow-hidden">
          <div className="section-heading">
            <h2>
              <span>诊断发现记录</span>
              <span className="text-xs font-normal text-slate-400">（共 {rows.length} 份分析）</span>
            </h2>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <caption className="sr-only">GEO 问题诊断列表</caption>
              <thead>
                <tr>
                  <th>测试集</th>
                  <th>数据类型</th>
                  <th>诊断版本</th>
                  <th>生成时间</th>
                  <th>诊断项</th>
                  <th>问题级别分布（高 / 中 / 低 / 提示）</th>
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ diagnosis, report }) => {
                  const c = counts(diagnosis);
                  return (
                    <tr key={diagnosis.id}>
                      <td>
                        <Link href={`/app/diagnosis/${diagnosis.id}`} className="font-semibold text-slate-900 hover:text-indigo-600 transition">
                          {report.suiteName} {formatVersion(report.suiteVersion)}
                        </Link>
                      </td>
                      <td>
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-xs text-slate-600 border border-slate-200">
                          {formatMetricSource(report.metricSource)}
                        </span>
                      </td>
                      <td className="font-mono text-xs text-slate-600">{diagnosis.diagnosisVersion}</td>
                      <td className="whitespace-nowrap text-xs text-slate-600">{new Date(diagnosis.generatedAt).toLocaleString("zh-CN", { hour12: false })}</td>
                      <td>
                        <span className="font-bold tabular-nums text-slate-900">
                          {diagnosis.findingCount ?? diagnosis.summary?.findingCount ?? "—"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200/70">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                            高 {c.HIGH}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200/70">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                            中 {c.MEDIUM}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/70">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                            低 {c.LOW}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                            提示 {c.INFO}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link href={`/app/diagnosis/${diagnosis.id}`} className="ui-button secondary compact text-xs">
                            查看详情 →
                          </Link>
                          <AiActionButton
                            size="sm"
                            label="AI 解读"
                            onClick={() => handleAiExplain(diagnosis, report)}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {rows.length > 0 && (
        <p className="text-xs text-slate-400">诊断项按高/中/低/提示统计，全部为确定性规则输出并与证据链路双向溯源。</p>
      )}

      {/* AI 解读弹窗 */}
      <AiGenerationModal
          isOpen={isAiModalOpen}
          onClose={() => setIsAiModalOpen(false)}
          title={`AI 解读诊断：${selectedDiag?.report.suiteName || ""}`}
          description="基于确定性诊断事实与 Evidence，生成通俗易懂的根因分析与局限性声明"
          loading={aiLoading}
          error={aiError}
          meta={aiMeta}
          onRegenerate={selectedDiag ? () => handleAiExplain(selectedDiag.diag, selectedDiag.report) : undefined}
        >
          {aiExplanationResult && (
            <div className="space-y-4">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-xs text-slate-500 font-medium">执行摘要：</span>
                <p className="text-sm text-slate-800 mt-1 leading-relaxed">{aiExplanationResult.summary}</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-xs text-slate-500 font-medium">详细解读分析：</span>
                <p className="text-xs text-slate-700 mt-1.5 leading-relaxed">{aiExplanationResult.explanation}</p>
              </div>

              {aiExplanationResult.keyFindings.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-slate-700">关键发现与影响判定：</span>
                  {aiExplanationResult.keyFindings.map((kf, idx) => (
                    <div key={idx} className="p-2.5 bg-zinc-950/30 rounded border border-slate-200 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-800">{kf.point}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${kf.impact === "HIGH" ? "bg-red-950 text-red-300" : "bg-amber-50 text-amber-700"}`}>
                          影响：{kf.impact}
                        </span>
                      </div>
                      <p className="text-slate-500 text-[11px] mt-1">{kf.reason}</p>
                    </div>
                  ))}
                </div>
              )}

              {aiExplanationResult.limitations.length > 0 && (
                <div className="p-2.5 bg-amber-50/20 border border-amber-800/40 rounded text-[11px] text-amber-700/90">
                  <span className="font-semibold">证据与观测局限：</span>
                  <ul className="list-disc pl-4 mt-1 space-y-0.5">
                    {aiExplanationResult.limitations.map((lim, idx) => (
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
