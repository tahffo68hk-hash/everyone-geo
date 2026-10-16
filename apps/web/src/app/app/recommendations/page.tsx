"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useProjectContext } from "@/components/project-context";
import { PageHeader, EmptyState, LoadingSkeleton } from "@/components/ui";
import { formatMetricSource, formatVersion, friendlyError } from "@/lib/labels";
import { AiActionButton } from "@/components/ai/ai-action-button";
import { AiGenerationModal } from "@/components/ai/ai-generation-modal";
import { draftAiRecommendation, type AiResponseMeta } from "@/lib/ai-api";

type Project = { id: string; name: string };
type ReportRow = { id: string; suiteName: string; suiteVersion: string; metricSource: string };
type RecRun = {
  id: string; diagnosisRunId: string; recommendationVersion: string;
  summary: { priorityCounts: { HIGH: number; MEDIUM: number; LOW: number }; recommendationCount: number; actionItemCount: number; directions: string[] };
  metadata: { metricSource?: string | null };
  generatedAt: string;
};

export default function RecommendationsListPage() {
  const { projectId: contextProjectId } = useProjectContext();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState<Array<{ run: RecRun; report: ReportRow }>>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // AI 智能建议草稿状态
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiMeta, setAiMeta] = useState<AiResponseMeta | null>(null);
  const [aiRecResult, setAiRecResult] = useState<{
    title: string;
    problem: string;
    action: string;
    expectedObservableSignal: string;
    priorityRationale: string;
    dependencies: string[];
    risks: string[];
  } | null>(null);

  async function handleAiDraft(run?: RecRun) {
    if (!projectId) return;
    setIsAiModalOpen(true);
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await draftAiRecommendation(projectId, {
        diagnosisId: run?.diagnosisRunId,
        problemDescription: run ? `针对建议集 ${run.recommendationVersion}，包含 ${run.summary.recommendationCount} 条行动项。` : "针对核心选型问题的可见度优化",
      });
      setAiMeta(res);
      setAiRecResult(res.data);
    } catch (e: any) {
      setAiError(e?.message || "AI 生成建议草稿失败");
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
    <div className="space-y-6">
      <PageHeader
        title="GEO 优化建议"
        description="基于 GEO 问题诊断生成的优化行动建议（属于优化假设，非效果承诺）。每个建议都可回链到诊断 → 测试问题 → 原始回答；效果须后续复测验证。"
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="project" className="text-xs text-slate-500 font-medium">项目：</label>
            <select id="project" value={projectId} className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-700 focus:outline-hidden" onChange={event => setProjectId(event.target.value)}>
              {projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
        }
      />

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {loading && <LoadingSkeleton rows={4} />}
      {!loading && !error && rows.length === 0 && (
        <EmptyState
          title="暂无优化建议"
          description="优化建议基于 GEO 问题诊断深入剖析生成。请先在问题诊断中完成分析，再生成优化建议。"
          href={`/app/diagnosis?project=${encodeURIComponent(projectId)}`}
          action="前往查看问题诊断"
        />
      )}
        {rows.length > 0 && (
          <section className="space-y-3">
            {rows.map(({ run, report }) => {
              const c = run.summary?.priorityCounts ?? { HIGH: 0, MEDIUM: 0, LOW: 0 };
              return (
                <div key={run.id} className="rounded-lg border border-slate-200 bg-white p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/app/recommendations/${run.id}`} className="text-base font-semibold text-blue-700 hover:underline">
                      {report.suiteName} {formatVersion(report.suiteVersion)} · 优化建议
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
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1 text-xs">
                      {(run.summary?.directions ?? []).map(d => (
                        <span key={d} className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-600">{d}</span>
                      ))}
                    </div>
                    <AiActionButton
                      size="sm"
                      label="AI 建议扩写"
                      onClick={() => handleAiDraft(run)}
                    />
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {/* AI 优化建议草稿弹窗 */}
        <AiGenerationModal
          isOpen={isAiModalOpen}
          onClose={() => setIsAiModalOpen(false)}
          title="AI 智能优化建议草稿"
          description="基于确定性诊断事实与观测信号，生成针对性行动计划草稿（非效果承诺）"
          loading={aiLoading}
          error={aiError}
          meta={aiMeta}
          onRegenerate={() => handleAiDraft()}
        >
          {aiRecResult && (
            <div className="space-y-4">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-xs text-slate-500 font-medium">建议方案标题：</span>
                <p className="text-sm font-bold text-slate-900 mt-1">{aiRecResult.title}</p>
                <p className="text-xs text-slate-500 mt-1">定位问题：{aiRecResult.problem}</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-xs text-slate-500 font-medium">建议具体行动：</span>
                <p className="text-xs text-slate-800 mt-1.5 leading-relaxed">{aiRecResult.action}</p>
              </div>

              <div className="p-3 bg-teal-50/20 border border-teal-800/40 rounded-lg text-xs">
                <span className="font-semibold text-teal-700">预期可观测信号 (Expected Observable Signal)：</span>
                <p className="text-teal-200/90 mt-1 leading-relaxed">{aiRecResult.expectedObservableSignal}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1 text-xs">
                <div className="p-2.5 bg-slate-50 rounded border border-slate-200">
                  <span className="font-semibold text-slate-500">前置依赖：</span>
                  <ul className="list-disc pl-4 mt-1 text-slate-700 space-y-0.5">
                    {aiRecResult.dependencies.map((dep, idx) => (
                      <li key={idx}>{dep}</li>
                    ))}
                  </ul>
                </div>
                <div className="p-2.5 bg-slate-50 rounded border border-slate-200">
                  <span className="font-semibold text-amber-400">潜在风险注意：</span>
                  <ul className="list-disc pl-4 mt-1 text-slate-700 space-y-0.5">
                    {aiRecResult.risks.map((risk, idx) => (
                      <li key={idx}>{risk}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </AiGenerationModal>
    </div>
  );
}
