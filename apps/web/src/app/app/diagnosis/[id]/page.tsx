"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  DIAGNOSIS_NAV, formatFindingType, formatMetricName, formatMetricSource,
  formatSeverity, formatVersion, friendlyError, RECOMMENDATION_NAV, SEVERITY_BADGE, withRaw,
} from "@/lib/labels";
import { EvidenceDialog } from "../../monitor/evidence-dialog";

type Summary = { severityCounts: { HIGH: number; MEDIUM: number; LOW: number; INFO: number }; findingCount: number; dataQualityNote: string | null };
type FindingLink = { id: string; evidenceId: string; runId: string; queryText: string; reason: string };
type Finding = {
  id: string; findingType: string; severity: "HIGH" | "MEDIUM" | "LOW" | "INFO";
  category: string | null; title: string; summary: string; explanation: string;
  metricName: string | null; currentValue: number | null; referenceValue: number | null;
  queryCount: number; evidenceCount: number; provider: string | null;
  requestedModel: string | null; responseModel: string | null; competitorName: string | null;
  priorityScore: number; evidence: FindingLink[];
};
type DiagnosisRun = {
  id: string; reportId: string; diagnosisVersion: string; secondaryReportId: string | null;
  status: string; summary: Summary; generatedAt: string; metadata: { comparisonVerdict?: string | null; supportedFindingTypes?: Array<{ findingType: string; supported: boolean; reason: string }> };
};
type ReportIdentity = {
  suiteName: string; suiteVersion: string; provider: string; engineName: string;
  requestedModel: string | null; responseModel: string | null; metricSource: string;
  analysisVersion: string; competitorSet: { name: string; version: string } | null;
  completion: { partial: boolean };
};

const num = (v: number | null, isRate: boolean) => v == null ? "—" : isRate ? `${(v * 100).toFixed(1)}%` : String(Math.round(v * 100) / 100);

export default function DiagnosisDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [run, setRun] = useState<DiagnosisRun | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [report, setReport] = useState<ReportIdentity | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [evidenceRunId, setEvidenceRunId] = useState<string | null>(null);
  const [recBusy, setRecBusy] = useState(false);
  const [hasRecs, setHasRecs] = useState(false);
  const [existingRecRunId, setExistingRecRunId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const [d, f] = await Promise.all([
        api<DiagnosisRun>(`/diagnoses/${id}`),
        api<{ findings: Finding[] }>(`/diagnoses/${id}/findings`),
      ]);
      setRun(d);
      setFindings(f.findings);
      try { setReport(await api<ReportIdentity>(`/reports/${d.reportId}`)); } catch { /* 报告身份展示尽力而为 */ }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
    // 检查是否已有优化建议
    try {
      const recRuns = await api<Array<{ id: string }>>(`/diagnoses/${id}/recommendations`);
      if (recRuns.length > 0) { setHasRecs(true); setExistingRecRunId(recRuns[0].id); }
    } catch { /* 无建议 run 属正常 */ }
  }, [id]);

  useEffect(() => { void load(); }, [load]);


  async function generateRecommendations() {
    if (recBusy) return;
    setRecBusy(true); setError("");
    try {
      const run = await api<{ id: string }>(`/diagnoses/${id}/recommendations`, { method: "POST", body: JSON.stringify({}) });
      setHasRecs(true); setExistingRecRunId(run.id);
      router.push(`/app/recommendations/${run.id}`);
    } catch (err) { setError(friendlyError(err)); } finally { setRecBusy(false); }
  }

  const counts = run?.summary?.severityCounts ?? null;
  const metricIsRate = (name: string | null) => name === "visibilityRate" || name === "recommendationRate";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/app/diagnosis" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-600 transition mb-1.5">
            ← 返回诊断列表
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">GEO 问题诊断详情</h1>
          {run && (
            <p className="mt-1 text-xs text-slate-500">
              诊断版本：<span className="font-mono">{run.diagnosisVersion}</span> · 状态：{run.status === "READY" ? "已生成" : run.status}
              {run.secondaryReportId ? " · 含跨模型对比" : ""}
            </p>
          )}
        </div>
        {run && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={recBusy}
              onClick={() => void generateRecommendations()}
              className="ui-button primary compact text-xs"
            >
              {recBusy ? "生成中…" : `生成${RECOMMENDATION_NAV.generate}`}
            </button>
            {hasRecs && existingRecRunId && (
              <Link href={`/app/recommendations/${existingRecRunId}`} className="ui-button secondary compact text-xs">
                {RECOMMENDATION_NAV.view}
              </Link>
            )}
          </div>
        )}
      </header>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {run && report && (
        <div className="surface overflow-hidden">
          <div className="section-heading">
            <h2>
              <span>关联报告基准与技术参数</span>
            </h2>
          </div>
          <div className="p-5">
            <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["来源报告", `${report.suiteName} v${report.suiteVersion}`],
                ["数据类型", formatMetricSource(report.metricSource)],
                ["模型服务", withRaw(report.engineName, report.provider)],
                ["请求模型", report.requestedModel ?? "未保存"],
                ["响应模型", report.responseModel ?? "未知"],
                ["分析版本", report.analysisVersion],
                ["竞品集合", report.competitorSet ? `${report.competitorSet.name} ${formatVersion(report.competitorSet.version)}` : "未绑定"],
                ["报告状态", report.completion.partial ? "部分完成（PARTIAL）" : "完整有效"],
              ].map(([label, value]) => (
                <div key={label as string} className="p-3 bg-slate-50/70 rounded-lg border border-slate-100">
                  <dt className="text-slate-400 font-medium mb-0.5">{label}</dt>
                  <dd className="font-semibold text-slate-800 break-words">{value}</dd>
                </div>
              ))}
            </dl>
            {report.metricSource !== "real" && (
              <p className="mt-3 inline-block rounded-md bg-amber-50 border border-amber-200/60 px-3 py-1 text-xs font-semibold text-amber-900">
                {DIAGNOSIS_NAV.demoDiagnosis} —— 不伪装真实结论
              </p>
            )}
          </div>
        </div>
      )}

      {run && (
        <div className="surface overflow-hidden">
          <div className="section-heading">
            <h2>
              <span>问题级别汇总与优先级</span>
            </h2>
          </div>
          <div className="p-5 space-y-3">
            {counts && (
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                  {formatSeverity("HIGH")}：{counts.HIGH}
                </span>
                <span className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  {formatSeverity("MEDIUM")}：{counts.MEDIUM}
                </span>
                <span className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  {formatSeverity("LOW")}：{counts.LOW}
                </span>
                <span className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                  {formatSeverity("INFO")}：{counts.INFO}
                </span>
              </div>
            )}
            <p className="text-xs text-slate-500">
              所有诊断项均为确定性规则输出，每个判断可追溯到原始回答证据。
              {DIAGNOSIS_NAV.internalHeuristic}
            </p>
          </div>
        </div>
      )}

      {findings.map(f => (
        <div key={f.id} className="surface overflow-hidden">
          <div className="section-heading">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                f.severity === "HIGH" ? "bg-rose-50 text-rose-700 border border-rose-200" :
                f.severity === "MEDIUM" ? "bg-amber-50 text-amber-700 border border-amber-200" :
                f.severity === "LOW" ? "bg-blue-50 text-blue-700 border border-blue-200" :
                "bg-slate-100 text-slate-600 border border-slate-200"
              }`}>
                {formatSeverity(f.severity)}
              </span>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 border border-slate-200">
                {formatFindingType(f.findingType)}
              </span>
              {f.category && <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 border border-indigo-200">场景：{f.category}</span>}
              {f.competitorName && <span className="rounded-md bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 border border-purple-200">竞品：{f.competitorName}</span>}
              {f.provider && <span className="rounded-md bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 border border-sky-200">模型：{f.provider}</span>}
            </div>
            <span className="text-xs text-slate-400 font-medium" title={DIAGNOSIS_NAV.internalPriority}>
              优先级评分：{f.priorityScore}
            </span>
          </div>
          <div className="p-5 space-y-3">
            <h3 className="text-base font-bold text-slate-900">{f.title}</h3>
            <p className="text-xs text-slate-700 leading-relaxed">{f.summary}</p>
            <p className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-xs text-slate-600 leading-relaxed">{f.explanation}</p>
            <div className="flex flex-wrap gap-4 text-xs text-slate-500 pt-1">
              <span>影响测试问题数：<strong className="text-slate-800">{f.queryCount}</strong></span>
              <span>关联证据数：<strong className="text-slate-800">{f.evidenceCount}</strong></span>
              {f.metricName && (
                <span>
                  对应指标：<strong>{formatMetricName(f.metricName)}</strong> = {num(f.currentValue, metricIsRate(f.metricName))}
                  {f.referenceValue !== null ? `（参考基准 ${num(f.referenceValue, metricIsRate(f.metricName))}）` : ""}
                </span>
              )}
            </div>
            {f.evidence.length > 0 && (
              <details className="mt-3 pt-2 border-t border-slate-100">
                <summary className="cursor-pointer text-xs font-semibold text-indigo-600 hover:text-indigo-700 select-none">
                  查看原始证据追溯（{f.evidence.length} 条）
                </summary>
                <ul className="mt-2 space-y-2 text-xs">
                  {f.evidence.map(link => (
                    <li key={link.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-800 break-words">{link.queryText}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{link.reason}</p>
                      </div>
                      <button
                        type="button"
                        className="ui-button secondary compact text-xs shrink-0"
                        onClick={() => setEvidenceRunId(link.runId)}
                      >
                        原始回答 →
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      ))}

      {!loading && !error && run && findings.length === 0 && (
        <p className="text-xs text-slate-400">该诊断暂无诊断项。</p>
      )}

      {evidenceRunId && <EvidenceDialog key={evidenceRunId} runId={evidenceRunId} onClose={() => setEvidenceRunId(null)} />}
    </div>
  );
}
