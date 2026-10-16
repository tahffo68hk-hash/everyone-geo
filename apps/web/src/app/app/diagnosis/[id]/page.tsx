"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  DIAGNOSIS_NAV, formatFindingType, formatMetricName, formatMetricSource,
  formatSeverity, formatVersion, friendlyError, RECOMMENDATION_NAV, SEVERITY_BADGE, withRaw,
} from "@/lib/labels";
import { useProjectContext } from "@/components/project-context";
import { createContentDraft } from "@/lib/content-api";
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


  const { projectId: contextProjectId, project } = useProjectContext();
  const projectId = project?.id || contextProjectId;

  // 根据诊断生成内容发布方案
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [planSubmitting, setPlanSubmitting] = useState(false);
  const [contentProposals, setContentProposals] = useState<
    Array<{
      id: string;
      title: string;
      channel: string;
      channelLabel: string;
      channelBadge: string;
      targetQuery: string;
      audience: string;
      coreMessage: string;
      factsToCite: string;
      outline: string[];
    }>
  >([]);

  function handleOpenContentPlanModal() {
    // 提取低覆盖/未提及问题 (Low Coverage Queries)
    const lowCoverage = findings.flatMap((f) => f.evidence?.map((e) => e.queryText) || []).filter(Boolean);
    const uniqueQueries = Array.from(new Set(lowCoverage));
    const mainQuery = uniqueQueries[0] || report?.suiteName || "核心业务选型与对比";
    const secondQuery = uniqueQueries[1] || `${mainQuery} 实践与标杆案例`;
    const thirdQuery = uniqueQueries[2] || `${mainQuery} 真实使用避坑`;

    const proposals = [
      {
        id: "zhihu-tech",
        channel: "ZHIHU",
        channelLabel: "知乎专栏 / 技术问答",
        channelBadge: "bg-sky-100 text-sky-800 border-sky-200",
        title: `【深度测评】${mainQuery}：技术架构、核心指标与多维度客观选型对比`,
        targetQuery: mainQuery,
        audience: "技术负责人、架构师及正在调研对比选型的专业采购决策者",
        coreMessage: "针对 AI 搜索在该问题中未提及本品的痛点，以客观深度横向技术测评与实测数据形式，直接截流高意向搜索流量。",
        factsToCite: "权威第三方基准跑分、行业合规标准认证、真实产研压测数据",
        outline: [
          "一、核心背景：用户在选型时最关心的关键指标与痛点",
          "二、主流方案横向多维度实测对比",
          "三、本品在关键业务场景下的落地优势与底层架构解析",
          "四、选型避坑指南与最佳实践",
        ],
      },
      {
        id: "wechat-auth",
        channel: "WECHAT_OFFICIAL_ACCOUNT",
        channelLabel: "微信公众号官方长文",
        channelBadge: "bg-emerald-100 text-emerald-800 border-emerald-200",
        title: `【权威方案】${secondQuery}：官方全景实践白皮书与标杆案例解析`,
        targetQuery: secondQuery,
        audience: "企业管理层、行业分析师及行业生态合作伙伴",
        coreMessage: "填补大模型抓取信源时的官方权威文档与深度白皮书空缺，树立搜索引擎与 AI 知识库公认的权威背书页面。",
        factsToCite: "官方产品技术白皮书、行业头部客户标杆实践案例、权威资质认证",
        outline: [
          "一、行业演化趋势与新一代标准要求",
          "二、官方整体解决方案与架构创新",
          "三、标杆客户实测成效与商业价值沉淀",
          "四、未来演进与官方服务保障",
        ],
      },
      {
        id: "xhs-seed",
        channel: "XIAOHONGSHU",
        channelLabel: "小红书图文笔记",
        channelBadge: "bg-rose-100 text-rose-800 border-rose-200",
        title: `真实测评避坑！${thirdQuery} 选型全攻略（附实测对比表）`,
        targetQuery: thirdQuery,
        audience: "注重实际体验、追求性价比的一线使用者与团队骨干",
        coreMessage: "从一线实际体验切入，以痛点图文种草与选型清单方式，补充社交大模型抓取的真实用户口碑信源。",
        factsToCite: "真实操作界面截图、功能选型对比表、新手入门避坑清单",
        outline: [
          "1. 为什么很多人在选型第一步就踩坑了？",
          "2. 深度实测：3个最容易忽视的核心细节",
          "3. 真实使用红黑榜对比",
          "4. 适合人群与手把手上手指南",
        ],
      },
    ];
    setContentProposals(proposals);
    setShowPlanModal(true);
  }

  async function handleTakeoverToPublish(proposal: typeof contentProposals[0]) {
    if (!projectId) {
      setError("未找到当前项目上下文，无法创建草稿。");
      return;
    }
    setPlanSubmitting(true);
    try {
      const fullBody = `# ${proposal.title}\n\n> 来源：GEO 诊断针对「${proposal.targetQuery}」的针对性优化方案\n\n## 核心目标与受众\n- 目标受众：${proposal.audience}\n- 核心观点：${proposal.coreMessage}\n- 引用论据：${proposal.factsToCite}\n\n## 推荐大纲\n${proposal.outline.map((line) => `- ${line}`).join("\n")}\n\n## 详细正文\n（您可以在此直接编辑，或在发布工作台由 AI 一键扩写生成完整的渠道稿件）\n`;

      const draft = await createContentDraft(projectId, {
        title: proposal.title,
        topic: proposal.targetQuery,
        generationMode: "AI_GENERATED",
        sourceDiagnosisId: id,
        body: fullBody,
        summary: proposal.coreMessage,
      });

      router.push(
        `/app/content/distribution?project=${encodeURIComponent(projectId)}&draftId=${encodeURIComponent(draft.id)}&channel=${encodeURIComponent(proposal.channel)}`,
      );
    } catch (err) {
      setError(friendlyError(err));
      setPlanSubmitting(false);
    }
  }

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
              onClick={handleOpenContentPlanModal}
              className="rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 transition flex items-center gap-1.5"
            >
              <span>✨ 根据诊断生成内容方案</span>
            </button>
            <button
              type="button"
              disabled={recBusy}
              onClick={() => void generateRecommendations()}
              className="ui-button secondary compact text-xs"
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

      {/* 根据诊断生成内容方案弹窗 */}
      {showPlanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden shadow-2xl border border-slate-200 flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 p-5 bg-slate-50/70">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <span>✨ 诊断转化：针对性内容发布方案</span>
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  已提取当前诊断中的低可见度问题与竞品差距，构建多平台针对性内容选题，支持一键带入内容发布工作台。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPlanModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-xl px-2"
              >
                ×
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-xs text-indigo-950 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="font-semibold">🎯 诊断归因溯源：</span>
                  <span className="ml-1 text-indigo-900">
                    针对 {findings.length} 项诊断发现，关联低可见问题：
                    {Array.from(new Set(findings.flatMap(f => f.evidence?.map(e => e.queryText) || []))).slice(0, 3).join("、") || "全场景中立问题"}
                  </span>
                </div>
                <span className="shrink-0 text-[11px] bg-white text-indigo-700 px-2 py-0.5 rounded font-medium border border-indigo-200">
                  诊断 ID: {id.slice(0, 8)}…
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {contentProposals.map((proposal) => (
                  <div
                    key={proposal.id}
                    className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 transition"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${proposal.channelBadge}`}>
                          {proposal.channelLabel}
                        </span>
                      </div>

                      <h4 className="text-xs font-bold text-slate-900 leading-snug">
                        {proposal.title}
                      </h4>

                      <div className="space-y-1.5 text-[11px] border-t border-slate-100 pt-2 text-slate-600">
                        <div>
                          <span className="font-semibold text-slate-700">针对提问：</span>
                          <span className="text-slate-800 font-medium">{proposal.targetQuery}</span>
                        </div>
                        <div>
                          <span className="font-semibold text-slate-700">核心观点：</span>
                          <span>{proposal.coreMessage}</span>
                        </div>
                        <div>
                          <span className="font-semibold text-slate-700">建议引用：</span>
                          <span className="text-emerald-700 font-medium">{proposal.factsToCite}</span>
                        </div>
                      </div>

                      <div className="rounded-lg bg-slate-50 p-2 text-[10px] text-slate-500 border border-slate-100">
                        <div className="font-semibold text-slate-600 mb-1">大纲结构：</div>
                        <ul className="space-y-0.5 pl-1">
                          {proposal.outline.map((line, idx) => (
                            <li key={idx} className="truncate">• {line}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-100 mt-3">
                      <button
                        type="button"
                        disabled={planSubmitting}
                        onClick={() => void handleTakeoverToPublish(proposal)}
                        className="w-full rounded-lg bg-indigo-600 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition flex items-center justify-center gap-1.5"
                      >
                        {planSubmitting ? "正在带入并创建…" : "一键带入内容发布 →"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end border-t border-slate-100 p-4 bg-slate-50">
              <button
                type="button"
                onClick={() => setShowPlanModal(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                稍后处理
              </button>
            </div>
          </div>
        </div>
      )}

      {evidenceRunId && <EvidenceDialog key={evidenceRunId} runId={evidenceRunId} onClose={() => setEvidenceRunId(null)} />}
    </div>
  );
}
