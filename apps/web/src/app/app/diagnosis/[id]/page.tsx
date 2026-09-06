"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  DIAGNOSIS_NAV, formatFindingType, formatMetricName, formatMetricSource,
  formatSeverity, friendlyError, RECOMMENDATION_NAV, SEVERITY_BADGE, withRaw,
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
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <Link href="/app/diagnosis" className="text-sm text-blue-700 hover:underline">← 返回诊断列表</Link>
          <h1 className="mt-3 text-2xl font-semibold">GEO 问题诊断</h1>
          {run && (
            <p className="mt-2 text-sm text-slate-500">
              诊断版本：{run.diagnosisVersion} · 状态：{run.status === "READY" ? "已生成" : run.status}
              {run.secondaryReportId ? " · 含跨模型对比" : ""}
            </p>
          )}
          {run && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={recBusy} onClick={() => void generateRecommendations()}
                className="rounded-lg bg-fuchsia-700 px-4 py-2 text-sm font-medium text-white hover:bg-fuchsia-800 disabled:opacity-50">
                {recBusy ? "生成中…" : `生成${RECOMMENDATION_NAV.generate}`}
              </button>
              {hasRecs && existingRecRunId && (
                <Link href={`/app/recommendations/${existingRecRunId}`} className="rounded-lg border border-fuchsia-700 px-4 py-2 text-sm font-medium text-fuchsia-700 hover:bg-fuchsia-50">
                  {RECOMMENDATION_NAV.view}
                </Link>
              )}
            </div>
          )}
        </header>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {run && report && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-slate-700">报告头</h2>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              {[
                ["来源报告", `${report.suiteName} v${report.suiteVersion}`],
                ["数据类型", formatMetricSource(report.metricSource)],
                ["模型服务（provider）", withRaw(report.engineName, report.provider)],
                ["请求模型", report.requestedModel ?? "历史记录未保存"],
                ["响应模型", report.responseModel ?? "未知"],
                ["分析版本", report.analysisVersion],
                ["竞品集合", report.competitorSet ? `${report.competitorSet.name} v${report.competitorSet.version}` : "未绑定"],
                ["诊断版本", run.diagnosisVersion],
                ["生成时间", new Date(run.generatedAt).toLocaleString()],
                ["报告状态", report.completion.partial ? "部分完成（PARTIAL）" : "完整"],
              ].map(([label, value]) => (
                <div key={label as string}><dt className="text-slate-500">{label}</dt><dd className="break-words">{value}</dd></div>
              ))}
            </dl>
            {report.metricSource !== "real" && (
              <p className="mt-3 inline-block rounded bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                {DIAGNOSIS_NAV.demoDiagnosis} —— 不伪装真实结论
              </p>
            )}
          </section>
        )}

        {run && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-slate-700">问题摘要</h2>
            {counts && (
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <span className={`rounded px-2 py-1 font-semibold ${SEVERITY_BADGE.HIGH}`}>{formatSeverity("HIGH")}：{counts.HIGH}</span>
                <span className={`rounded px-2 py-1 font-semibold ${SEVERITY_BADGE.MEDIUM}`}>{formatSeverity("MEDIUM")}：{counts.MEDIUM}</span>
                <span className={`rounded px-2 py-1 font-semibold ${SEVERITY_BADGE.LOW}`}>{formatSeverity("LOW")}：{counts.LOW}</span>
                <span className={`rounded px-2 py-1 font-semibold ${SEVERITY_BADGE.INFO}`}>{formatSeverity("INFO")}：{counts.INFO}</span>
              </div>
            )}
            <p className="mt-3 text-xs text-amber-700">
              所有诊断项均为确定性规则输出，每个判断可追溯到原始回答（查看证据）。
              {DIAGNOSIS_NAV.internalHeuristic}
            </p>
          </section>
        )}

        {findings.map(f => (
          <section key={f.id} className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-xs font-semibold ${SEVERITY_BADGE[f.severity]}`}>{formatSeverity(f.severity)}</span>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{formatFindingType(f.findingType)}</span>
              {f.category && <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800">场景：{f.category}</span>}
              {f.competitorName && <span className="rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-800">竞品：{f.competitorName}</span>}
              {f.provider && <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">模型服务：{f.provider}</span>}
              <h3 className="min-w-0 flex-1 text-lg font-semibold">{f.title}</h3>
              <span className="text-xs text-slate-400" title={DIAGNOSIS_NAV.internalPriority}>优先级 {f.priorityScore}</span>
            </div>
            <p className="mt-2 text-sm">{f.summary}</p>
            <p className="mt-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{f.explanation}</p>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
              <span>影响测试问题数：{f.queryCount}</span>
              <span>证据数：{f.evidenceCount}</span>
              {f.metricName && <span>指标：{formatMetricName(f.metricName)} = {num(f.currentValue, metricIsRate(f.metricName))}{f.referenceValue !== null ? `（参考 ${num(f.referenceValue, metricIsRate(f.metricName))}）` : ""}</span>}
            </div>
            {f.evidence.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-blue-700">查看证据（{f.evidence.length}）</summary>
                <ul className="mt-2 space-y-2 text-sm">
                  {f.evidence.map(link => (
                    <li key={link.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-200 p-2">
                      <div className="min-w-0 flex-1">
                        <p className="break-words">{link.queryText}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{link.reason}</p>
                      </div>
                      <button type="button" className="shrink-0 text-xs text-blue-700 underline" onClick={() => setEvidenceRunId(link.runId)}>
                        查看原始回答
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        ))}

        {!loading && !error && run && findings.length === 0 && (
          <p className="text-sm text-slate-400">该诊断暂无诊断项。</p>
        )}
      </div>
      {evidenceRunId && <EvidenceDialog key={evidenceRunId} runId={evidenceRunId} onClose={() => setEvidenceRunId(null)} />}
    </main>
  );
}
