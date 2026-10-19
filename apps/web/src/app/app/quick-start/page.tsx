"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProjectContext } from "@/components/project-context";
import { PageHeader, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import {
  buildBenchmarkQueries,
  extractQuickStartRecommendations,
  normalizeGeneratedQuestions,
  quickStartPendingProjectKey,
  quickStartStorageKey,
  replaceQuickStartQuestions,
  selectReportAnalysis,
  type QuickStartQuestion,
} from "@/lib/quick-start";

type RunType = "demo" | "real";
type AiProvider = "mock" | "deepseek" | "qwen";
type Engine = { id: string; key: string; name: string; provider: string; model: string; configured: boolean; sourceType?: string };
type FlowState = {
  step: number;
  brandName: string;
  organizationId: string;
  website: string;
  industry: string;
  category: string;
  competitorsText: string;
  aiProvider: AiProvider;
  runType: RunType;
  engineId: string;
  questions: QuickStartQuestion[];
  suiteId: string;
  runId: string;
  reportId: string;
  diagnosisId: string;
  recommendationRunId: string;
  aiRecommendation: Record<string, unknown> | null;
  title: string;
  body: string;
  summary: string;
  channel: string;
  draftId: string;
};

const initialFlow: FlowState = {
  step: 0,
  brandName: "",
  organizationId: "",
  website: "",
  industry: "",
  category: "",
  competitorsText: "",
  aiProvider: "mock",
  runType: "demo",
  engineId: "",
  questions: [],
  suiteId: "",
  runId: "",
  reportId: "",
  diagnosisId: "",
  recommendationRunId: "",
  aiRecommendation: null,
  title: "",
  body: "",
  summary: "",
  channel: "XIAOHONGSHU",
  draftId: "",
};

const steps = ["品牌信息", "确认问题", "GEO 检测", "报告与建议", "生成内容", "进入分发"];
const json = (method: string, value?: unknown): RequestInit => ({ method, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
const unwrap = <T,>(value: unknown): T => {
  if (value && typeof value === "object" && "data" in value) return (value as { data: T }).data;
  return value as T;
};
const pct = (value: unknown) => typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "暂无数据";
const safeError = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试。";

function providerLabel(provider: string) {
  if (provider === "mock") return "Mock 演示";
  if (provider === "deepseek") return "DeepSeek 真实调用";
  if (provider === "qwen") return "Qwen 真实调用";
  return provider || "未知 Provider";
}

export default function QuickStartPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedProjectId = searchParams.get("project") ?? "";
  const { projectId, project, target, projects, me, loading: contextLoading } = useProjectContext();
  const [projectOverride, setProjectOverride] = useState("");
  const activeProjectId = projectOverride || projectId;
  const storageKey = useMemo(() => quickStartStorageKey(me?.user.id ?? "guest", activeProjectId || "new"), [me?.user.id, activeProjectId]);
  const pendingProjectKey = useMemo(() => quickStartPendingProjectKey(me?.user.id ?? "guest"), [me?.user.id]);
  const [flow, setFlow] = useState<FlowState>(initialFlow);
  const [hydrated, setHydrated] = useState(false);
  const [hydratedStorageKey, setHydratedStorageKey] = useState("");
  const [engines, setEngines] = useState<Engine[]>([]);
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [run, setRun] = useState<{ status: string; progress: number; completedRuns: number; plannedRuns: number; analyzedRuns: number; terminal?: boolean; provider: string; engine?: { model?: string; name?: string } } | null>(null);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [evidence, setEvidence] = useState<Array<Record<string, unknown>>>([]);
  const [recommendations, setRecommendations] = useState<Array<Record<string, unknown>>>([]);
  const [advanced, setAdvanced] = useState(false);
  const processingRun = useRef("");
  const processedReport = useRef("");
  const activeProjectRef = useRef(activeProjectId);
  activeProjectRef.current = activeProjectId;

  const update = (patch: Partial<FlowState>) => setFlow((current) => ({ ...current, ...patch }));

  useEffect(() => {
    if (contextLoading) return;
    setHydrated(false);
    setHydratedStorageKey("");
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<FlowState>;
        setFlow({ ...initialFlow, ...parsed, questions: Array.isArray(parsed.questions) ? parsed.questions : [] });
      } else if (target?.canonicalName && target.projectId === activeProjectId) {
        setFlow({ ...initialFlow, brandName: target.canonicalName, category: target.productCategory ?? "" });
      } else {
        setFlow(initialFlow);
      }
    } catch {
      setFlow(initialFlow);
    }
    setHydrated(true);
    setHydratedStorageKey(storageKey);
  }, [contextLoading, storageKey]);

  useEffect(() => {
    if (contextLoading || !me?.user.id || projectOverride) return;
    const pendingProjectId = localStorage.getItem(pendingProjectKey);
    if (!pendingProjectId) return;
    if (requestedProjectId && requestedProjectId !== pendingProjectId) {
      localStorage.removeItem(pendingProjectKey);
      return;
    }
    if (projectId === pendingProjectId) {
      localStorage.removeItem(pendingProjectKey);
      return;
    }
    if (!requestedProjectId) router.replace(`/app/quick-start?project=${encodeURIComponent(pendingProjectId)}`);
  }, [contextLoading, me?.user.id, pendingProjectKey, projectId, projectOverride, requestedProjectId, router]);

  useEffect(() => {
    if (!projectOverride || !projectId) return;
    setProjectOverride("");
    localStorage.removeItem(pendingProjectKey);
  }, [pendingProjectKey, projectId, projectOverride]);

  useEffect(() => {
    if (!hydrated || hydratedStorageKey !== storageKey || !me?.user.id) return;
    localStorage.setItem(storageKey, JSON.stringify(flow));
  }, [flow, hydrated, hydratedStorageKey, me?.user.id, storageKey]);

  useEffect(() => {
    if (!target?.canonicalName || target.projectId !== activeProjectId || flow.brandName) return;
    update({ brandName: target.canonicalName, category: target.productCategory ?? "" });
  }, [activeProjectId, target?.canonicalName, target?.productCategory, flow.brandName]);

  useEffect(() => {
    let cancelled = false;
    api<{ engines?: Engine[]; projects?: unknown[] }>("/monitor-tasks/options")
      .then((result) => { if (!cancelled) setEngines(result.engines ?? []); })
      .catch(() => { if (!cancelled) setEngines([]); });
    if (!projects.length) {
      api<Array<{ id: string; name: string }>>("/organizations")
        .then((result) => {
          if (cancelled) return;
          setOrganizations(result);
          setFlow((current) => current.organizationId || !result[0] ? current : { ...current, organizationId: result[0].id });
        })
        .catch(() => { if (!cancelled) setOrganizations([]); });
    }
    return () => { cancelled = true; };
  }, [projects.length]);

  const availableEngines = useMemo(() => engines.filter((engine) => engine.provider === "mock" || ((engine.provider === "deepseek" || engine.provider === "qwen") && engine.configured)), [engines]);
  const runEngineCandidates = useMemo(() => availableEngines.filter((engine) => flow.runType === "demo" ? engine.provider === "mock" : engine.provider === "deepseek" || engine.provider === "qwen"), [availableEngines, flow.runType]);
  const selectedRunEngine = useMemo(() => {
    const preferred = runEngineCandidates.find((engine) => engine.key === "mock" || engine.key === "geolens-mock")
      ?? runEngineCandidates.find((engine) => /GeoLens Mock/i.test(engine.name))
      ?? runEngineCandidates.find((engine) => !/(fail|retry|e2e|test)/i.test(`${engine.key} ${engine.name}`));
    return runEngineCandidates.find((engine) => engine.id === flow.engineId) ?? preferred ?? runEngineCandidates[0] ?? null;
  }, [runEngineCandidates, flow.engineId]);
  const aiProviderReady = flow.aiProvider === "mock" || engines.some((engine) => engine.provider === flow.aiProvider && engine.configured);
  const reportMetrics = (report?.metricsSnapshot ?? {}) as Record<string, unknown>;
  const overall = (reportMetrics.overall ?? {}) as Record<string, unknown>;
  const byQuery = Array.isArray(reportMetrics.byQuery) ? reportMetrics.byQuery as Array<Record<string, unknown>> : [];
  const unmentionedCount = byQuery.filter((row) => row.brandMentioned === false).length;
  const distributionHref = flow.draftId
    ? `/app/content/distribution?project=${encodeURIComponent(activeProjectId)}&draftId=${encodeURIComponent(flow.draftId)}&channel=${encodeURIComponent(flow.channel)}`
    : `/app/content?project=${encodeURIComponent(activeProjectId)}`;

  const ensureProject = useCallback(async (brandName: string, industry: string, organizationId: string) => {
    if (activeProjectId) return { id: activeProjectId, created: false };
    const availableOrganizations = organizations.length ? organizations : await api<Array<{ id: string; name: string }>>("/organizations");
    if (!availableOrganizations.length) throw new Error("当前账号还没有可用组织，无法创建项目。请先在 GeoLens 中创建或加入组织。");
    const organization = availableOrganizations.find((candidate) => candidate.id === organizationId) ?? availableOrganizations[0];
    const created = await api<{ id: string }>(`/organizations/${organization.id}/projects`, json("POST", {
      name: brandName,
      industry: industry || undefined,
      description: `由快速开始创建的 GEO 监测项目：${brandName}`,
    }));
    return { id: created.id, created: true };
  }, [activeProjectId, organizations]);

  const confirmPaidAi = (purpose: string) => flow.aiProvider === "mock" || window.confirm(
    `${purpose}将调用 ${providerLabel(flow.aiProvider)}。这会向外部 AI 服务发送本次输入，并可能产生费用。继续吗？`,
  );

  const generateQuestions = async (project: string, brandName: string, industry: string, category: string, competitorsText: string, website: string) => {
    const generated = await api<unknown>(`/projects/${project}/ai/query-set`, json("POST", {
      provider: flow.aiProvider,
      brandName,
      category: category || industry,
      industry,
      competitors: competitorsText.split(/[，,、\n]/).map((item) => item.trim()).filter(Boolean),
      queryCount: 10,
    }));
    const data = unwrap<{ queries?: unknown[] }>(generated);
    const questions = normalizeGeneratedQuestions(data?.queries, brandName);
    if (!questions.length) throw new Error("AI 暂未返回可用问题，请重新生成或手动添加问题。");
    const nextFlow: FlowState = {
      ...flow,
      brandName, industry, category, website, competitorsText,
      questions, step: 1, suiteId: "", runId: "", reportId: "", diagnosisId: "", recommendationRunId: "", aiRecommendation: null, draftId: "",
    };
    return nextFlow;
  };

  const startWithBrand = async () => {
    const brandName = flow.brandName.trim();
    if (!brandName) { setError("请先填写品牌或产品名称。"); return; }
    if (!aiProviderReady) { setError("所选真实 AI Provider 尚未配置，请选择 Mock 演示或使用已启用的 Provider。"); return; }
    if (!confirmPaidAi("品牌解析与监测问题生成")) return;
    setBusy("正在准备项目并生成监测问题…"); setError("");
    try {
      const projectContext = await ensureProject(brandName, flow.industry.trim(), flow.organizationId);
      const projectForBrand = projectContext.id;
      if (projectContext.created) {
        const pendingFlow = {
          ...flow,
          brandName,
          industry: flow.industry.trim(),
          category: flow.category.trim(),
          website: flow.website.trim(),
          competitorsText: flow.competitorsText.trim(),
        };
        localStorage.setItem(quickStartStorageKey(me?.user.id ?? "guest", projectForBrand), JSON.stringify(pendingFlow));
        localStorage.setItem(pendingProjectKey, projectForBrand);
        setFlow(pendingFlow);
        setProjectOverride(projectForBrand);
      }
      const resolved = await api<unknown>(`/projects/${projectForBrand}/ai/resolve-brand`, json("POST", {
        provider: flow.aiProvider,
        brandName,
        industryHint: flow.industry.trim() || undefined,
        regionHint: "中国",
      }));
      const brandData = unwrap<{ industry?: string; competitors?: string[]; aliases?: string[] }>(resolved);
      const industry = flow.industry.trim() || brandData?.industry || "";
      const competitorsText = flow.competitorsText.trim() || (Array.isArray(brandData?.competitors) ? brandData.competitors.join("，") : "");
      const category = flow.category.trim() || industry;
      await api(`/projects/${projectForBrand}/target-profile`, json("PUT", {
        canonicalName: brandName,
        entityType: "BRAND",
        productCategory: category || null,
        website: flow.website.trim() || null,
        description: industry ? `行业：${industry}` : null,
      }));
      const nextFlow = await generateQuestions(projectForBrand, brandName, industry, category, competitorsText, flow.website.trim());
      if (activeProjectRef.current && activeProjectRef.current !== projectForBrand) return;
      setFlow(nextFlow);
      localStorage.setItem(quickStartStorageKey(me?.user.id ?? "guest", projectForBrand), JSON.stringify(nextFlow));
      if (projectId !== projectForBrand) {
        router.replace(`/app/quick-start?project=${encodeURIComponent(projectForBrand)}`);
      }
    } catch (cause) {
      setError(safeError(cause));
    } finally { setBusy(""); }
  };

  const regenerateQuestions = async () => {
    if (!activeProjectId || !flow.brandName.trim()) return;
    if (!aiProviderReady) { setError("所选真实 AI Provider 尚未配置。"); return; }
    if (!confirmPaidAi("重新生成监测问题")) return;
    setBusy("正在重新生成问题…"); setError("");
    try {
      const nextFlow = await generateQuestions(activeProjectId, flow.brandName, flow.industry, flow.category, flow.competitorsText, flow.website);
      if (activeProjectRef.current === activeProjectId) setFlow(nextFlow);
    } catch (cause) { setError(safeError(cause)); }
    finally { setBusy(""); }
  };

  const beginRun = async () => {
    if (!activeProjectId || !selectedRunEngine) { setError("当前没有匹配的可用检测引擎，请检查引擎配置。"); return; }
    if (flow.questions.length < 3) { setError("至少保留 3 个问题后才能开始检测。"); return; }
    setBusy("正在准备检测…"); setError("");
    try {
      let suiteId = flow.suiteId;
      if (!suiteId) {
        const suite = await api<{ id: string }>(`/projects/${activeProjectId}/benchmark-suites`, json("POST", {
          name: `${flow.brandName} 快速检测`,
          version: `qs-${Date.now().toString(36)}`,
          description: "通过 GeoLens 快速开始创建，问题与检测结果进入正式 Benchmark / Evidence 流程。",
          queries: buildBenchmarkQueries(flow.questions),
        }));
        suiteId = suite.id;
        update({ suiteId });
      }
      if (flow.runType === "real") {
        const preflight = await api<{ blocked: boolean; blockedReason?: string | null; estimatedCalls: number; estimatedCost: number | null; currency: string | null }>(
          `/projects/${activeProjectId}/queries/cost-preflight`, json("POST", { suiteId, engineIds: [selectedRunEngine.id], runType: "real" }),
        );
        if (preflight.blocked) throw new Error(preflight.blockedReason || "真实 Provider 当前不可用。");
        const price = preflight.estimatedCost == null ? "系统暂无法估算费用" : `预计费用 ${preflight.estimatedCost} ${preflight.currency ?? ""}`;
        if (!window.confirm(`将通过 ${selectedRunEngine.name} 发起 ${preflight.estimatedCalls} 次真实模型请求；${price}。确认后开始？`)) return;
      }
      const created = await api<{ id: string }>(`/benchmark-suites/${suiteId}/runs`, json("POST", { engineId: selectedRunEngine.id, runType: flow.runType }));
      update({ suiteId, runId: created.id, engineId: selectedRunEngine.id, step: 2, reportId: "", diagnosisId: "", recommendationRunId: "", aiRecommendation: null });
      setRun({ status: "PENDING", progress: 0, completedRuns: 0, plannedRuns: flow.questions.length, analyzedRuns: 0, terminal: false, provider: selectedRunEngine.provider, engine: { model: selectedRunEngine.model, name: selectedRunEngine.name } });
    } catch (cause) { setError(safeError(cause)); }
    finally { setBusy(""); }
  };

  const loadReportContext = useCallback(async (reportId: string, projectForReport: string) => {
    if (processedReport.current === reportId) return;
    processedReport.current = reportId;
    try {
      const [reportResult, evidenceResult] = await Promise.all([
        api<Record<string, unknown>>(`/reports/${reportId}`),
        api<{ rows?: Array<Record<string, unknown>> }>(`/reports/${reportId}/evidence`),
      ]);
      setReport(reportResult);
      const rows = evidenceResult.rows ?? [];
      const withAnswers = await Promise.all(rows.slice(0, 5).map(async (row) => {
        if (!row.runId) return row;
        try {
          const runResult = await api<Record<string, unknown>>(`/runs/${row.runId}`);
          const evidenceRow = runResult.evidence as Record<string, unknown> | null;
          const analyses = Array.isArray(evidenceRow?.analyses) ? evidenceRow.analyses as Array<Record<string, unknown>> : [];
          const analysisVersion = typeof reportResult.analysisVersion === "string" ? reportResult.analysisVersion : "";
          return { ...row, rawResponse: evidenceRow?.rawResponse ?? null, analysis: selectReportAnalysis(analyses, analysisVersion) };
        } catch { return row; }
      }));
      setEvidence(withAnswers);

      const diagnosis = await api<{ id: string }>(`/reports/${reportId}/diagnoses`, json("POST", {}));
      update({ diagnosisId: diagnosis.id });
      const recommendationRun = await api<{ id: string }>(`/diagnoses/${diagnosis.id}/recommendations`, json("POST"));
      update({ recommendationRunId: recommendationRun.id });
      const generated = await api<unknown>(`/recommendation-runs/${recommendationRun.id}/recommendations`);
      setRecommendations(extractQuickStartRecommendations(generated));
    } catch (cause) {
      processedReport.current = "";
      setError(`报告已生成；诊断或证据加载暂未完成：${safeError(cause)}`);
    } finally {
      update({ step: 3 });
    }
  }, []);

  const createReportForRun = useCallback(async (runId: string, projectForReport: string) => {
    setBusy("正在整理正式检测报告…"); setError("");
    try {
      const existing = await api<Array<Record<string, unknown>>>(`/projects/${projectForReport}/reports`);
      let reportRow = existing.find((item) => item.benchmarkRunId === runId);
      if (!reportRow) reportRow = await api<Record<string, unknown>>(`/benchmark-runs/${runId}/reports`, json("POST", {}));
      const reportId = String(reportRow.id ?? "");
      if (!reportId) throw new Error("检测完成，但正式报告没有返回编号。");
      update({ reportId, step: 3 });
      await loadReportContext(reportId, projectForReport);
    } catch (cause) {
      setError(`检测已结束，但正式报告暂未生成：${safeError(cause)}`);
    } finally { setBusy(""); }
  }, [loadReportContext]);

  useEffect(() => {
    if (flow.step !== 2 || !flow.runId || !activeProjectId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const current = await api<{
          id: string; status: string; progress: number; completedRuns: number; plannedRuns: number; analyzedRuns: number;
          provider: string; terminal?: boolean; engine?: { model?: string; name?: string };
        }>(`/benchmark-runs/${flow.runId}`);
        if (cancelled) return;
        setRun(current);
        if (current.terminal || ["SUCCEEDED", "PARTIAL", "FAILED", "CANCELLED"].includes(current.status)) {
          if (processingRun.current === flow.runId) return;
          processingRun.current = flow.runId;
          if (cancelled) return;
          if (current.analyzedRuns <= 0) {
            setError("本次检测没有成功分析样本，未生成报告。你可以重试检测，项目和问题集会保留。");
            return;
          }
          await createReportForRun(flow.runId, activeProjectId);
        } else {
          timer = setTimeout(poll, 2200);
        }
      } catch (cause) {
        if (!cancelled) {
          processingRun.current = "";
          setError(safeError(cause));
          timer = setTimeout(poll, 4500);
        }
      }
    };
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [activeProjectId, createReportForRun, flow.runId, flow.step]);

  useEffect(() => {
    if (flow.step !== 3 || !flow.reportId || !activeProjectId) return;
    if (processedReport.current === flow.reportId) return;
    void loadReportContext(flow.reportId, activeProjectId);
  }, [activeProjectId, flow.reportId, flow.step, loadReportContext]);

  const generateAiRecommendation = async () => {
    if (!activeProjectId || !flow.diagnosisId) { setError("正式诊断尚未准备好，请稍后重试。"); return; }
    if (!aiProviderReady) { setError("所选真实 AI Provider 尚未配置。"); return; }
    if (!confirmPaidAi("AI 优化建议生成")) return;
    setBusy("正在结合诊断与证据生成建议…"); setError("");
    try {
      const result = await api<unknown>(`/projects/${activeProjectId}/ai/recommendation-draft`, json("POST", {
        provider: flow.aiProvider,
        diagnosisId: flow.diagnosisId,
        targetQueries: flow.questions.map((question) => question.text),
      }));
      update({ aiRecommendation: unwrap<Record<string, unknown>>(result) });
    } catch (cause) { setError(safeError(cause)); }
    finally { setBusy(""); }
  };

  const generateContent = async () => {
    if (!activeProjectId) return;
    if (!aiProviderReady) { setError("所选真实 AI Provider 尚未配置。"); return; }
    if (!confirmPaidAi("多平台内容生成")) return;
    const recommendation = flow.aiRecommendation;
    const suggestedTitle = String(recommendation?.title ?? recommendations[0]?.title ?? `${flow.brandName}：${flow.industry || "行业"}选型与实用指南`);
    const brief = [
      `品牌：${flow.brandName}`,
      `行业：${flow.industry || flow.category || "未指定"}`,
      `检测建议：${String(recommendation?.action ?? recommendations[0]?.summary ?? "围绕用户高频问题提供清晰、可核验的答案。")}`,
      "内容须事实准确，明确区分事实、观点与建议。",
    ].join("\n");
    setBusy("正在生成平台内容…"); setError("");
    try {
      const result = await api<unknown>(`/projects/${activeProjectId}/ai/content-draft`, json("POST", {
        provider: flow.aiProvider,
        title: suggestedTitle,
        channel: flow.channel,
        targetQueries: flow.questions.slice(0, 8).map((question) => question.text),
        brief,
      }));
      const content = unwrap<{ title?: string; body?: string; summary?: string }>(result);
      update({ title: content.title || suggestedTitle, body: content.body || "", summary: content.summary || "", step: 4 });
    } catch (cause) { setError(safeError(cause)); }
    finally { setBusy(""); }
  };

  const saveContent = async () => {
    if (!activeProjectId || !flow.title.trim() || !flow.body.trim()) { setError("请填写标题和正文后保存。"); return; }
    setBusy("正在保存到 GeoLens 内容工作台…"); setError("");
    try {
      const saved = await api<{ id: string }>(`/projects/${activeProjectId}/content-drafts`, json("POST", {
        title: flow.title.trim(),
        topic: flow.brandName,
        generationMode: "AI_GENERATED",
        ...(recommendations[0]?.id ? { sourceRecommendationId: recommendations[0].id } : flow.diagnosisId ? { sourceDiagnosisId: flow.diagnosisId } : {}),
        body: flow.body.trim(),
        summary: flow.summary.trim(),
        changeNote: "由快速开始向导根据 GEO 检测报告生成并经用户编辑保存。",
      }));
      update({ draftId: saved.id, step: 5 });
    } catch (cause) { setError(safeError(cause)); }
    finally { setBusy(""); }
  };

  const restart = () => {
    localStorage.removeItem(storageKey);
    processedReport.current = "";
    processingRun.current = "";
    setFlow(initialFlow); setRun(null); setReport(null); setEvidence([]); setRecommendations([]); setError("");
  };

  const addQuestion = () => setFlow((current) => replaceQuickStartQuestions(current, [...current.questions, {
    id: `manual-${Date.now()}`, text: "", category: "tool-discovery", intent: "用户决策", queryType: "DISCOVERY", rationale: "",
  }]));

  const updateQuestion = (id: string, patch: Partial<QuickStartQuestion>) => setFlow((current) => replaceQuickStartQuestions(current,
    current.questions.map((question) => question.id === id ? { ...question, ...patch } : question),
  ));

  const removeQuestion = (id: string) => setFlow((current) => replaceQuickStartQuestions(current, current.questions.filter((question) => question.id !== id)));

  if (contextLoading || !hydrated) return <div className="surface p-8 text-sm text-slate-500">正在加载快速开始…</div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="快速开始"
        description="用一份品牌监测报告，快速走完 GEO 检测、优化建议和内容准备。结果会进入当前 GeoLens 正式项目。"
        badge={<span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">{projects.find((candidate) => candidate.id === activeProjectId)?.name ?? project?.name ?? (flow.brandName || "引导式工作流")}</span>}
        actions={<Link className="ui-button secondary" href={`/app?project=${encodeURIComponent(activeProjectId)}`}>完整工作台</Link>}
      />

      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="快速开始进度">
        {steps.map((label, index) => {
          const complete = flow.step > index;
          const active = flow.step === index;
          return <li key={label} className={`rounded-xl border px-3 py-3 text-xs ${active ? "border-indigo-300 bg-indigo-50 text-indigo-800" : complete ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-400"}`}>
            <span className="mr-1.5 font-bold">{complete ? "✓" : `0${index + 1}`}</span>{label}
          </li>;
        })}
      </ol>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}

      {flow.step === 0 && <section className="surface p-5 sm:p-7">
        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600">先从一个品牌开始</p>
            <h2 className="mt-2 text-xl font-bold text-slate-900">AI 搜索会怎样回答关于你的问题？</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">输入品牌名称，GeoLens 会帮你整理监测问题，创建或复用当前组织下的正式项目，并保存品牌监测对象。</p>
            <label className="mt-6 block text-sm font-semibold text-slate-800" htmlFor="quick-start-brand">品牌或产品名称</label>
            <input id="quick-start-brand" className="mt-2 w-full max-w-xl rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" value={flow.brandName} onChange={(event) => update({ brandName: event.target.value })} placeholder="例如：星河项目管理" maxLength={120} />
            <details className="mt-4 max-w-xl rounded-xl border border-slate-200 bg-slate-50 px-4 py-3" open={advanced} onToggle={(event) => setAdvanced((event.currentTarget as HTMLDetailsElement).open)}>
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">高级设置：官网、行业、竞品和 AI Provider</summary>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {!activeProjectId && organizations.length > 1 && <label className="text-xs font-medium text-slate-600 sm:col-span-2">新项目所属组织<select className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={flow.organizationId} onChange={(event) => update({ organizationId: event.target.value })}>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>}
                <label className="text-xs font-medium text-slate-600">官网地址<input className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={flow.website} onChange={(event) => update({ website: event.target.value })} placeholder="https://example.com" /></label>
                <label className="text-xs font-medium text-slate-600">行业（可留空，由 AI 推断）<input className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={flow.industry} onChange={(event) => update({ industry: event.target.value })} placeholder="例如：协同办公软件" /></label>
                <label className="text-xs font-medium text-slate-600 sm:col-span-2">竞品名称（可选，用逗号分隔）<input className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={flow.competitorsText} onChange={(event) => update({ competitorsText: event.target.value })} placeholder="例如：品牌甲，品牌乙" /></label>
                <label className="text-xs font-medium text-slate-600 sm:col-span-2">问题与内容生成 Provider<select className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={flow.aiProvider} onChange={(event) => update({ aiProvider: event.target.value as AiProvider })}>
                  <option value="mock">Mock 演示（不产生外部调用）</option>
                  {engines.filter((engine) => (engine.provider === "deepseek" || engine.provider === "qwen") && engine.configured).map((engine) => <option key={engine.provider} value={engine.provider}>{providerLabel(engine.provider)} · {engine.model}</option>)}
                </select><span className="mt-1 block text-[11px] text-slate-500">选择真实 Provider 时，每次外部调用前都会显示确认提示。</span></label>
              </div>
            </details>
            <button type="button" className="ui-button primary mt-5" disabled={Boolean(busy) || !flow.brandName.trim()} onClick={startWithBrand}>
              {busy || "生成监测问题"} <span aria-hidden="true">→</span>
            </button>
          </div>
          <aside className="rounded-2xl border border-slate-200 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-indigo-50 via-white to-sky-50 p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-lg text-white">G</div>
            <h3 className="mt-4 font-semibold text-slate-900">一次引导，结果留在正式项目</h3>
            <ul className="mt-3 space-y-2 text-xs leading-5 text-slate-600">
              <li>✓ 使用 GeoLens Benchmark 与正式问题集</li><li>✓ 保存原始回答与 Evidence</li><li>✓ 报告、诊断和内容可在工作台继续使用</li>
            </ul>
            <p className="mt-4 rounded-lg bg-white/80 px-3 py-2 text-[11px] leading-5 text-slate-500">Mock 检测将明确标记为演示数据，不计作真实模型观测。</p>
          </aside>
        </div>
      </section>}

      {flow.step === 1 && <section className="surface p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs font-semibold text-indigo-600">第二步 · 人工确认</p><h2 className="mt-1 text-xl font-bold text-slate-900">检查监测问题</h2><p className="mt-1 text-sm text-slate-600">已按「{flow.brandName}」生成 {flow.questions.length} 个问题。品牌相关问题会单独标记为品牌认知测试。</p></div>
          <button type="button" className="ui-button secondary" disabled={Boolean(busy)} onClick={regenerateQuestions}>{busy || "重新生成"}</button>
        </div>
        <div className="mt-5 space-y-3">
          {flow.questions.map((question, index) => <article key={question.id} className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
            <div className="flex items-start gap-3"><span className="mt-2 text-xs font-bold text-slate-400">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0 flex-1">
              <textarea aria-label={`监测问题 ${index + 1}`} className="min-h-20 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6 text-slate-800 focus:border-indigo-400 focus:outline-none" value={question.text} onChange={(event) => updateQuestion(question.id, { text: event.target.value })} />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select aria-label={`问题 ${index + 1} 类型`} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600" value={question.queryType} onChange={(event) => updateQuestion(question.id, { queryType: event.target.value as QuickStartQuestion["queryType"] })}><option value="DISCOVERY">自然发现问题</option><option value="BRANDED_SANITY">品牌认知测试</option><option value="CUSTOM">自定义问题</option></select>
                <span className="text-[11px] text-slate-400">{question.category} · {question.intent}</span>
              </div>
            </div><button type="button" className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-rose-50 hover:text-rose-700" onClick={() => removeQuestion(question.id)}>删除</button></div>
          </article>)}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><button type="button" className="ui-button secondary" onClick={addQuestion}>＋ 添加问题</button><span className="text-xs text-slate-500">建议使用 8–12 个问题；至少 3 个才能检测。</span></div>
        <div className="mt-6 flex flex-wrap justify-between gap-3 border-t border-slate-100 pt-5"><button type="button" className="ui-button secondary" onClick={() => update({ step: 0 })}>← 返回品牌信息</button><button type="button" className="ui-button primary" disabled={flow.questions.filter((question) => question.text.trim()).length < 3 || Boolean(busy)} onClick={() => update({ questions: flow.questions.filter((question) => question.text.trim()), step: 2 })}>确认问题并继续 →</button></div>
      </section>}

      {flow.step === 2 && <section className="surface p-5 sm:p-7">
        <p className="text-xs font-semibold text-indigo-600">第三步 · GEO 检测</p><h2 className="mt-1 text-xl font-bold text-slate-900">选择检测方式</h2><p className="mt-1 text-sm text-slate-600">本次计划运行 {flow.questions.length} 个问题，预计发起 {flow.questions.length} 次模型请求。</p>
        {!flow.runId ? <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button type="button" className={`rounded-xl border p-4 text-left ${flow.runType === "demo" ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100" : "border-slate-200 bg-white"}`} onClick={() => update({ runType: "demo", engineId: "" })}><span className="flex items-center justify-between"><strong className="text-sm">Mock 演示检测</strong><span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800">演示数据</span></span><span className="mt-2 block text-xs leading-5 text-slate-600">使用 GeoLens Mock 引擎，无外部请求或费用。适合体验完整流程。</span></button>
            <button type="button" className={`rounded-xl border p-4 text-left ${flow.runType === "real" ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100" : "border-slate-200 bg-white"}`} onClick={() => update({ runType: "real", engineId: "" })}><span className="flex items-center justify-between"><strong className="text-sm">真实 Provider 检测</strong><span className="rounded-full bg-rose-100 px-2 py-1 text-[10px] font-bold text-rose-800">可能产生费用</span></span><span className="mt-2 block text-xs leading-5 text-slate-600">仅显示已配置的 DeepSeek / Qwen 引擎。执行前会预检并由你确认。</span></button>
          </div>
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="grid gap-3 text-sm sm:grid-cols-3"><div><span className="block text-xs text-slate-500">Provider</span><strong>{selectedRunEngine ? providerLabel(selectedRunEngine.provider) : "暂无可用引擎"}</strong></div><div><span className="block text-xs text-slate-500">模型</span><strong>{selectedRunEngine?.model || "—"}</strong></div><div><span className="block text-xs text-slate-500">问题数 / 预计请求</span><strong>{flow.questions.length} / {flow.questions.length}</strong></div></div>
            {runEngineCandidates.length > 1 && <label className="mt-4 block text-xs font-medium text-slate-600">检测引擎<select aria-label="检测引擎" className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={selectedRunEngine?.id ?? ""} onChange={(event) => update({ engineId: event.target.value })}>{runEngineCandidates.map((engine) => <option key={engine.id} value={engine.id}>{engine.name} · {engine.model} · {providerLabel(engine.provider)}</option>)}</select></label>}
            {!selectedRunEngine && <p className="mt-3 text-xs text-rose-700">当前选择下没有已启用引擎。请在系统配置中启用 Mock 或配置真实 Provider。</p>}
          </div>
          <div className="mt-6 flex flex-wrap justify-between gap-3"><button type="button" className="ui-button secondary" onClick={() => update({ step: 1 })}>← 返回问题</button><button type="button" className="ui-button primary" disabled={Boolean(busy) || !selectedRunEngine} onClick={beginRun}>{busy || (flow.runType === "demo" ? "开始 Mock 检测" : "预检并开始真实检测")} →</button></div>
        </> : <div className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-slate-900">{run?.terminal ? (run.analyzedRuns > 0 ? "检测完成，正在准备报告" : "检测结束，暂无可用分析") : "检测任务正在执行"}</h3><p className="mt-1 text-xs text-slate-600">{run?.engine?.name || selectedRunEngine?.name} · {run?.engine?.model || selectedRunEngine?.model} · {providerLabel(run?.provider || selectedRunEngine?.provider || "")}</p></div><StatusBadge status={run?.status ?? "QUEUED"} /></div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${Math.max(3, run?.progress ?? 0)}%` }} /></div>
          <div className="mt-2 flex justify-between text-xs text-slate-500"><span>{run?.completedRuns ?? 0} / {run?.plannedRuns ?? flow.questions.length} 个问题已完成</span><span>{run?.progress ?? 0}%</span></div>
          <p className="mt-4 text-xs leading-5 text-slate-600">任务结果会自动归档到 Benchmark 和 Evidence。你可以刷新页面，向导会继续恢复检测进度。</p>
          {run?.terminal && !flow.reportId && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"><p className="text-xs leading-5 text-slate-600">{run.analyzedRuns > 0 ? "检测样本已有分析，但报告暂未完成。" : "没有成功分析的样本，因此不会生成空报告。"}</p>{run.analyzedRuns > 0 ? <button type="button" className="ui-button secondary" disabled={Boolean(busy)} onClick={() => createReportForRun(flow.runId, activeProjectId)}>{busy || "重试生成报告"}</button> : <button type="button" className="ui-button secondary" onClick={() => { processingRun.current = ""; setRun(null); setError(""); update({ runId: "", reportId: "" }); }}>重新运行检测</button>}</div>}
        </div>}
      </section>}

      {flow.step === 3 && <section className="space-y-5">
        <div className="surface p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold text-indigo-600">第四步 · 正式检测报告</p><h2 className="mt-1 text-xl font-bold text-slate-900">{flow.brandName} 的 GEO 检测结果</h2><p className="mt-1 text-sm text-slate-600">报告由正式 Benchmark Run 和 Evidence 快照生成，检测类型：{report?.runType === "DEMO" ? "Mock 演示" : "真实观测"}。</p></div>{flow.reportId && <Link className="ui-button secondary" href={`/app/reports/${flow.reportId}?project=${encodeURIComponent(activeProjectId)}`}>查看完整报告 ↗</Link>}</div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-slate-200 p-4"><span className="text-xs text-slate-500">品牌提及率</span><div className="mt-1 text-2xl font-bold text-slate-900">{pct(overall.visibilityRate)}</div><p className="mt-1 text-[11px] text-slate-500">基于正式 GEO 指标快照</p></div><div className="rounded-xl border border-slate-200 p-4"><span className="text-xs text-slate-500">被推荐比例</span><div className="mt-1 text-2xl font-bold text-slate-900">{pct(overall.recommendationRate)}</div><p className="mt-1 text-[11px] text-slate-500">来自 Benchmark 分析结果</p></div><div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><span className="text-xs text-amber-800">未提及机会</span><div className="mt-1 text-2xl font-bold text-amber-950">{unmentionedCount || "—"}</div><p className="mt-1 text-[11px] text-amber-800">个问题中未发现品牌提及</p></div></div>
          {report?.runType === "DEMO" && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">此报告来自 Mock 模拟回答，已在正式报告中标记为演示数据，不代表真实模型表现。</p>}
        </div>

        <div className="surface p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">代表性回答与证据</h3><p className="mt-1 text-xs text-slate-500">原始回答和分析均来自正式 Evidence 记录。</p></div><span className="text-xs text-slate-500">{evidence.length} 条展示</span></div>
          {evidence.length ? <div className="mt-4 space-y-3">{evidence.map((item, index) => {
            const analysis = item.analysis && typeof item.analysis === "object" ? item.analysis as Record<string, unknown> : {};
            return <article key={String(item.evidenceId ?? item.runId ?? index)} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-slate-800">{String(item.queryText ?? "监测问题")}</strong><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${analysis.brandMentioned === true ? "bg-emerald-100 text-emerald-800" : analysis.brandMentioned === false ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{analysis.brandMentioned === true ? "已提及品牌" : analysis.brandMentioned === false ? "未提及品牌" : "待分析"}</span></div><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">{String(item.rawResponse ?? (item.status === "SUCCEEDED" ? "原始回答已写入 Evidence。" : `检测状态：${item.status ?? "未知"}`)).slice(0, 900)}</p>{Array.isArray(analysis.citations) && analysis.citations.length > 0 && <p className="mt-2 text-[11px] text-slate-500">引用来源：{(analysis.citations as Array<Record<string, unknown>>).slice(0, 3).map((citation) => String(citation.domain ?? citation.url ?? "来源")).join(" · ")}</p>}</article>;
          })}</div> : <p className="mt-4 rounded-lg bg-slate-50 px-4 py-5 text-sm text-slate-500">正在读取 Evidence…如果检测失败，报告仍会保留成功和失败样本分母。</p>}
        </div>

        <div className="surface p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="font-bold text-slate-900">可执行优化建议</h3><p className="mt-1 text-xs text-slate-500">规则建议来自正式 Diagnosis / Recommendation，并与对应发现和 Evidence 关联。</p></div><button type="button" className="ui-button secondary" disabled={Boolean(busy) || !flow.diagnosisId} onClick={generateAiRecommendation}>{busy || (flow.aiRecommendation ? "重新生成 AI 建议" : "生成 AI 优化建议")}</button></div>
          {recommendations.length ? <div className="mt-4 grid gap-3 md:grid-cols-2">{recommendations.slice(0, 4).map((recommendation, index) => <article key={String(recommendation.id ?? index)} className="rounded-xl border border-slate-200 p-4"><div className="flex items-center gap-2"><span className="rounded-md bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700">{String(recommendation.priority ?? "建议")}</span><strong className="text-sm text-slate-800">{String(recommendation.title ?? "优化建议")}</strong></div><p className="mt-2 text-xs leading-5 text-slate-600">{String(recommendation.summary ?? recommendation.rationale ?? "")} </p><p className="mt-2 text-[11px] text-slate-500">可观察信号：{String(recommendation.expectedSignal ?? "通过后续复测观察变化")}</p></article>)}</div> : <p className="mt-4 rounded-lg bg-slate-50 px-4 py-5 text-sm text-slate-500">诊断正在根据报告证据生成规则建议…</p>}
          {flow.aiRecommendation && <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4"><div className="text-[11px] font-semibold text-indigo-700">AI 补充建议 · {providerLabel(flow.aiProvider)}</div><h4 className="mt-2 font-semibold text-slate-900">{String(flow.aiRecommendation.title ?? "优化建议")}</h4><p className="mt-2 text-sm leading-6 text-slate-700">{String(flow.aiRecommendation.action ?? flow.aiRecommendation.problem ?? "")}</p><p className="mt-2 text-xs text-slate-600">观察信号：{String(flow.aiRecommendation.expectedObservableSignal ?? "")} </p></div>}
        </div>
        <div className="flex flex-wrap justify-between gap-3"><button type="button" className="ui-button secondary" onClick={() => update({ step: 2 })}>← 查看检测状态</button><button type="button" className="ui-button primary" onClick={() => update({ step: 4 })}>根据建议生成内容 →</button></div>
      </section>}

      {flow.step === 4 && <section className="surface p-5 sm:p-7">
        <p className="text-xs font-semibold text-indigo-600">第五步 · 内容生产</p><h2 className="mt-1 text-xl font-bold text-slate-900">把检测机会变成可编辑内容</h2><p className="mt-1 text-sm text-slate-600">内容由 GeoLens AI Gateway 生成，保存后进入正式内容工作台，并保留诊断或建议来源。</p>
        {!flow.body ? <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4"><label className="block text-sm font-semibold text-slate-800">目标平台<select className="mt-2 w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={flow.channel} onChange={(event) => update({ channel: event.target.value })}><option value="XIAOHONGSHU">小红书</option><option value="ZHIHU">知乎</option><option value="WECHAT_OFFICIAL_ACCOUNT">微信公众号</option><option value="BILIBILI">哔哩哔哩</option><option value="WORDPRESS">官网 / WordPress</option></select></label><p className="mt-3 text-xs text-slate-500">平台内容会保存在内容草稿中，不会自动对外发布。</p><button type="button" className="ui-button primary mt-4" disabled={Boolean(busy)} onClick={generateContent}>{busy || "生成平台内容"}</button></div> : <div className="mt-5 space-y-4">
          <label className="block text-sm font-semibold text-slate-700">目标平台<select className="mt-2 block w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal" value={flow.channel} onChange={(event) => update({ channel: event.target.value })}><option value="XIAOHONGSHU">小红书</option><option value="ZHIHU">知乎</option><option value="WECHAT_OFFICIAL_ACCOUNT">微信公众号</option><option value="BILIBILI">哔哩哔哩</option><option value="WORDPRESS">官网 / WordPress</option></select></label>
          <label className="block text-sm font-semibold text-slate-700">标题<input className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" value={flow.title} onChange={(event) => update({ title: event.target.value })} maxLength={200} /></label>
          <label className="block text-sm font-semibold text-slate-700">正文<textarea className="mt-2 block min-h-[300px] w-full resize-y rounded-lg border border-slate-300 px-3 py-3 text-sm font-normal leading-6" value={flow.body} onChange={(event) => update({ body: event.target.value })} maxLength={20000} /></label>
          <label className="block text-sm font-semibold text-slate-700">摘要<input className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal" value={flow.summary} onChange={(event) => update({ summary: event.target.value })} maxLength={500} /></label>
          <div className="flex flex-wrap justify-between gap-3 border-t border-slate-100 pt-5"><button type="button" className="ui-button secondary" onClick={() => update({ body: "", title: "", summary: "" })}>重新生成</button><button type="button" className="ui-button primary" disabled={Boolean(busy)} onClick={saveContent}>{busy || "保存到内容工作台"} →</button></div>
        </div>}
      </section>}

      {flow.step === 5 && <section className="surface overflow-hidden">
        <div className="bg-slate-900 px-5 py-8 text-white sm:px-8"><div className="text-xs font-semibold text-emerald-300">快速开始已完成</div><h2 className="mt-2 text-2xl font-bold">报告和内容已进入正式工作台</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">已保存一份可继续编辑的内容草稿。你可以在分发工作台选择平台、生成渠道版本并按现有流程人工确认。</p></div>
        <div className="grid gap-3 p-5 sm:grid-cols-3 sm:p-8"><div className="rounded-xl border border-slate-200 p-4"><span className="text-xs text-slate-500">项目</span><div className="mt-1 font-semibold text-slate-900">{project?.name ?? flow.brandName}</div></div><div className="rounded-xl border border-slate-200 p-4"><span className="text-xs text-slate-500">正式检测报告</span><div className="mt-1 font-semibold text-slate-900">{flow.reportId ? "已归档" : "—"}</div></div><div className="rounded-xl border border-slate-200 p-4"><span className="text-xs text-slate-500">内容草稿</span><div className="mt-1 font-semibold text-slate-900">{flow.title}</div></div></div>
        <div className="flex flex-wrap gap-3 border-t border-slate-100 px-5 py-5 sm:px-8"><Link className="ui-button primary" href={distributionHref}>进入多平台分发工作台 →</Link>{flow.reportId && <Link className="ui-button secondary" href={`/app/reports/${flow.reportId}?project=${encodeURIComponent(activeProjectId)}`}>查看报告</Link>}<Link className="ui-button secondary" href={`/app?project=${encodeURIComponent(activeProjectId)}`}>进入完整项目工作台</Link><button type="button" className="ui-button secondary" onClick={restart}>开始新的快速检测</button></div>
        <p className="px-5 pb-5 text-xs text-slate-500 sm:px-8">当前内容状态为草稿。GeoLens 不会在此流程中代替你执行公开发布。</p>
      </section>}
    </div>
  );
}
