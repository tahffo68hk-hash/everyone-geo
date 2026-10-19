"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type {
  AiProvider,
  ContentAsset,
  DistributionTask,
  ProviderStatus,
  QuickStartReport,
  QuickStartRun,
  QuickStartSession,
  QuestionDraft,
} from "@/lib/quick-start.types";

type Organization = { id: string; name: string; role: string };
type SessionSummary = {
  id: string;
  currentStep: string;
  updatedAt: string;
  project: { id: string; name: string };
  brand: { name: string };
  runs: Array<{ id: string; status: string; isMock: boolean }>;
};
type MeResponse = { user: { name: string | null }; organizations: Organization[] };

const steps = [
  { number: 1, label: "输入品牌", stage: "BRAND" },
  { number: 2, label: "确认问题", stage: "QUESTIONS" },
  { number: 3, label: "执行检测", stage: "MONITOR" },
  { number: 4, label: "查看报告", stage: "REPORT" },
  { number: 5, label: "生成内容", stage: "CONTENT" },
  { number: 6, label: "进入发布", stage: "DISTRIBUTION" },
] as const;

const platforms = [
  { id: "geo", label: "官网文章" },
  { id: "xiaohongshu", label: "小红书" },
  { id: "douyin", label: "抖音" },
  { id: "bilibili", label: "B 站" },
  { id: "channels", label: "微信视频号" },
  { id: "kuaishou", label: "快手" },
  { id: "weibo", label: "微博" },
  { id: "wechat", label: "微信公众号" },
  { id: "zhihu", label: "知乎" },
  { id: "toutiao", label: "今日头条/百家号" },
];

const buttonPrimary =
  "inline-flex min-h-10 items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
const buttonSecondary =
  "inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
const card = "rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6";
const inputClass =
  "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-50";

function stageNumber(stage?: string) {
  return steps.find((step) => step.stage === stage)?.number ?? 1;
}

function validQuestionCount(count: number) {
  return count >= 8 && count <= 12;
}

function providerLabel(provider: AiProvider) {
  if (provider === "MOCK") return "Mock · 模拟数据/未真实验证";
  if (provider === "DEEPSEEK") return "DeepSeek · 真实 Provider";
  return "Qwen / DashScope · 真实 Provider";
}

function percent(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function metadataText(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
}

function renderContentSummary(metadata: Record<string, unknown> | null) {
  return typeof metadata?.summaryText === "string"
    ? metadata.summaryText
    : metadataText(metadata, "summary");
}

function metadataTextList(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function renderVideoScript(metadata: Record<string, unknown> | null) {
  const savedText = metadata?.videoScriptText;
  if (typeof savedText === "string") return savedText;
  const value = metadata?.videoScript;
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "";
  const script = value as Record<string, unknown>;
  const lines: string[] = [];
  if (typeof script.voiceover === "string") {
    lines.push(`口播：${script.voiceover}`);
    if (Array.isArray(script.shotSuggestions)) {
      const shots = script.shotSuggestions.filter((item): item is string => typeof item === "string");
      if (shots.length) lines.push(`画面建议：\n${shots.map((shot, index) => `第${index + 1}镜：${shot}`).join("\n")}`);
    }
  } else {
    if (typeof script.opening === "string") lines.push(`开场：${script.opening}`);
    if (typeof script.narration === "string") lines.push(`讲解稿：\n${script.narration}`);
    if (Array.isArray(script.outline)) {
      const chapters = script.outline.flatMap((item, index) => {
        if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
        const section = item as Record<string, unknown>;
        const heading = typeof section.heading === "string" ? section.heading : `章节 ${index + 1}`;
        const points = Array.isArray(section.keyPoints)
          ? section.keyPoints.filter((point): point is string => typeof point === "string")
          : [];
        return [`第${index + 1}节：${heading}`, ...points];
      });
      if (chapters.length) lines.push(`章节结构：\n${chapters.join("\n")}`);
    }
    if (typeof script.ending === "string") lines.push(`收尾：${script.ending}`);
  }
  return lines.join("\n\n") || JSON.stringify(script, null, 2);
}

function PaidCallConfirm({
  provider,
  count,
  checked,
  onChange,
}: {
  provider: AiProvider;
  count: number;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  if (provider === "MOCK") {
    return (
      <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-3.5 py-3 text-xs leading-5 text-emerald-800">
        当前使用 Mock：本地模拟回答，不调用外部模型，也不产生模型费用。
      </div>
    );
  }
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-3 text-xs leading-5 text-amber-900">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 accent-amber-600"
      />
      <span>
        我确认本次会发送 <strong>{count} 次真实模型请求</strong>，可能产生费用（金额未知）。
        只有勾选后才会发送。
      </span>
    </label>
  );
}

function Provenance({ isMock, evidenceMock }: { isMock: boolean; evidenceMock?: boolean }) {
  return (
    <div className={`rounded-xl border px-3.5 py-3 text-xs leading-5 ${isMock ? "border-amber-200 bg-amber-50 text-amber-900" : "border-blue-100 bg-blue-50 text-blue-900"}`}>
      <strong>{isMock ? "模拟数据/未真实验证" : "真实 Provider 生成"}</strong>
      {evidenceMock && <span> · 输入证据包含模拟回答/未真实验证</span>}
      {!isMock && <span> · API 回答不代表实时联网搜索或公开发布</span>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const style =
    status === "COMPLETED"
      ? "bg-emerald-50 text-emerald-700"
      : status === "RUNNING"
        ? "bg-blue-50 text-blue-700"
        : status === "PARTIAL"
          ? "bg-amber-50 text-amber-800"
          : status === "FAILED"
            ? "bg-rose-50 text-rose-700"
            : "bg-slate-100 text-slate-600";
  const label: Record<string, string> = {
    COMPLETED: "已完成",
    RUNNING: "进行中",
    PARTIAL: "部分完成",
    FAILED: "执行失败",
    DRAFT: "内容草稿",
    SAVED: "已保存草稿",
    NEEDS_HUMAN_REVIEW: "待人工复核",
  };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${style}`}>{label[status] ?? status}</span>;
}

export function QuickStartWizard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [targetProjectId, setTargetProjectId] = useState("");
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<QuickStartSession | null>(null);
  const [activeRun, setActiveRun] = useState<QuickStartRun | null>(null);
  const [report, setReport] = useState<QuickStartReport | null>(null);
  const [selectedContent, setSelectedContent] = useState<ContentAsset | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftSummary, setDraftSummary] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [draftVideoScriptText, setDraftVideoScriptText] = useState("");
  const [enterpriseContext, setEnterpriseContext] = useState("");
  const draftRevision = useRef(0);
  const activeReportIdRef = useRef<string | undefined>(undefined);
  const [questions, setQuestions] = useState<QuestionDraft[]>([]);
  const [questionsDirty, setQuestionsDirty] = useState(false);
  const [viewStep, setViewStep] = useState(0);
  const [brandName, setBrandName] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [competitorsText, setCompetitorsText] = useState("");
  const [provider, setProvider] = useState<AiProvider>("MOCK");
  const [model, setModel] = useState("geolens-mock-v1");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [industryConfirmed, setIndustryConfirmed] = useState(false);
  const [questionConfirmed, setQuestionConfirmed] = useState(false);
  const [runConfirmed, setRunConfirmed] = useState(false);
  const [suggestionConfirmed, setSuggestionConfirmed] = useState(false);
  const [contentConfirmed, setContentConfirmed] = useState(false);
  const [channel, setChannel] = useState("geo");
  const [platformSelection, setPlatformSelection] = useState<string[]>(["geo"]);
  const [distributionTasks, setDistributionTasks] = useState<DistributionTask[]>([]);

  const configuredProvider = providers.find((item) => item.provider === provider);
  const sessionProviderStatus = providers.find((item) => item.provider === session?.provider);
  const reportProvider: AiProvider = report?.run?.provider ?? activeRun?.provider ?? session?.provider ?? "MOCK";
  const reportProviderStatus = providers.find((item) => item.provider === reportProvider);
  const settingsChanged = Boolean(session && (provider !== session.provider || model !== session.model));
  const currentStep = viewStep || stageNumber(session?.currentStep ?? "BRAND");
  const reportId = activeRun?.report?.id ?? report?.id;
  const selectedRiskNotes = metadataTextList(selectedContent?.metadata ?? null, "riskNotes");
  const selectedQualityWarnings = metadataTextList(selectedContent?.metadata ?? null, "qualityWarnings");

  useEffect(() => {
    activeReportIdRef.current = reportId;
  }, [reportId]);

  async function loadSession(id: string) {
    draftRevision.current += 1;
    activeReportIdRef.current = undefined;
    setBusy("");
    const data = await api<QuickStartSession>(`/quick-start/sessions/${id}`);
    setSession(data);
    setOrganizationId((data.project as QuickStartSession["project"] & { organizationId?: string }).organizationId ?? "");
    setProvider(data.provider);
    setModel(data.model);
    setQuestions(data.questions ?? []);
    setQuestionsDirty(false);
    setActiveRun(data.runs?.[0] ?? null);
    const loadedReport = data.runs?.[0]?.report ?? null;
    activeReportIdRef.current = loadedReport?.id;
    setReport(loadedReport);
    const latestContent = loadedReport?.contentAssets?.[0] ?? null;
    setSelectedContent(latestContent);
    if (latestContent) {
      setChannel(latestContent.channel);
      setDraftTitle(latestContent.title);
      setDraftSummary(renderContentSummary(latestContent.metadata));
      setDraftBody(latestContent.body);
      setDraftTags(latestContent.hashtags.join(" "));
      setDraftVideoScriptText(renderVideoScript(latestContent.metadata));
      setEnterpriseContext(metadataText(latestContent.metadata, "enterpriseContext"));
      const existingPlatforms = latestContent.distributionTasks?.map((task) => task.platform) ?? [];
      setPlatformSelection(existingPlatforms.length ? existingPlatforms : [latestContent.channel]);
    } else {
      setDraftTitle("");
      setDraftSummary("");
      setDraftBody("");
      setDraftTags("");
      setDraftVideoScriptText("");
      setEnterpriseContext("");
    }
    setViewStep(0);
    return data;
  }

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      setLoading(true);
      setError("");
      try {
        const [me, providerData] = await Promise.all([
          api<MeResponse>("/auth/me"),
          api<ProviderStatus[]>("/quick-start/providers"),
        ]);
        if (cancelled) return;
        setOrganizations(me.organizations);
        setProviders(providerData);
        const requestedSession = new URLSearchParams(window.location.search).get("sessionId");
        if (requestedSession) {
          const loaded = await loadSession(requestedSession);
          if (cancelled) return;
          setBrandName(loaded.brand.name);
          setWebsite(loaded.brand.website ?? "");
          setIndustry(loaded.project.industry ?? "");
          return;
        }
        const requestedProject = new URLSearchParams(window.location.search).get("projectId");
        if (requestedProject) {
          const project = await api<QuickStartSession["project"] & {
            brands: Array<{ name: string; website: string | null }>;
          }>(`/projects/${requestedProject}`);
          if (cancelled) return;
          setTargetProjectId(project.id);
          setOrganizationId(project.organizationId);
          setBrandName(project.brands[0]?.name ?? project.name);
          setWebsite(project.brands[0]?.website ?? "");
          setIndustry(project.industry ?? "");
          setCompetitorsText(project.competitors.map((competitor) => competitor.name).join("，"));
          return;
        }
        const firstOrganization = me.organizations[0];
        if (firstOrganization) setOrganizationId(firstOrganization.id);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "加载快速开始失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void initialize();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!organizationId || session) return;
    let cancelled = false;
    api<SessionSummary[]>(`/quick-start/sessions?organizationId=${encodeURIComponent(organizationId)}`)
      .then((data) => {
        if (!cancelled) setRecentSessions(data);
      })
      .catch(() => {
        if (!cancelled) setRecentSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, session]);

  useEffect(() => {
    if (!activeRun || activeRun.status !== "RUNNING") return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const next = await api<QuickStartRun>(`/quick-start/runs/${activeRun.id}`);
        if (cancelled) return;
        setActiveRun(next);
        if (next.status !== "RUNNING") {
          if (next.report) setReport(next.report);
          if (session) {
            const refreshed = await loadSession(session.id);
            if (!cancelled && refreshed.runs?.[0]?.report) {
              setReport(refreshed.runs[0].report);
              setViewStep(4);
            }
          }
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "读取检测进度失败");
      }
    }, 900);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeRun?.id, activeRun?.status]);

  async function createSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy("create");
    try {
      const created = await api<QuickStartSession>("/quick-start/sessions", {
        method: "POST",
        body: JSON.stringify({
          organizationId,
          ...(targetProjectId ? { projectId: targetProjectId } : {}),
          brandName,
          website,
          industry,
          competitors: competitorsText.split(/[，,\n]/).map((value) => value.trim()).filter(Boolean),
          provider,
          model,
        }),
      });
      await loadSession(created.id);
      router.replace(`/app/quick-start?sessionId=${created.id}`);
      setNotice("项目、品牌和快速开始记录已保存到当前组织。");
      setViewStep(2);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建快速开始记录失败");
    } finally {
      setBusy("");
    }
  }

  async function suggestIndustry() {
    setError("");
    setNotice("");
    setBusy("industry");
    try {
      const result = await api<{ industry: string; isMock: boolean; message: string }>(
        "/quick-start/industry-inference",
        {
          method: "POST",
          body: JSON.stringify({ brandName, website, provider, model, confirmed: industryConfirmed }),
        },
      );
      setIndustry(result.industry);
      setIndustryConfirmed(false);
      setNotice(`${result.message} · ${providerLabel(provider)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "行业推断失败");
    } finally {
      setBusy("");
    }
  }

  async function saveSettings() {
    if (!session) return;
    setError("");
    setBusy("settings");
    try {
      await api(`/quick-start/sessions/${session.id}/settings`, {
        method: "PATCH",
        body: JSON.stringify({ provider, model }),
      });
      await loadSession(session.id);
      setNotice("模型设置已保存，只影响后续操作。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存模型设置失败");
    } finally {
      setBusy("");
    }
  }

  async function generateQuestions() {
    if (!session) return;
    setError("");
    setBusy("questions");
    try {
      const result = await api<{ questions: QuestionDraft[] }>(
        `/quick-start/sessions/${session.id}/questions/generate`,
        {
          method: "POST",
          body: JSON.stringify({ confirmed: questionConfirmed }),
        },
      );
      setQuestions(result.questions);
      setQuestionsDirty(false);
      setQuestionConfirmed(false);
      await loadSession(session.id);
      setNotice(`已生成并保存 ${result.questions.length} 条问题，可继续编辑。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成监测问题失败");
    } finally {
      setBusy("");
    }
  }

  async function saveQuestions(): Promise<boolean> {
    if (!session || questions.length === 0) return false;
    if (!validQuestionCount(questions.length)) {
      setError("监测问题需保持 8–12 条；请补充或删除后再保存。");
      return false;
    }
    setError("");
    setBusy("save-questions");
    try {
      const result = await api<{ questions: QuestionDraft[] }>(
        `/quick-start/sessions/${session.id}/questions`,
        { method: "PATCH", body: JSON.stringify({ questions }) },
      );
      setQuestions(result.questions);
      setQuestionsDirty(false);
      setNotice("问题已保存到项目 Query Set，可在完整项目中继续使用。");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存监测问题失败");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function startRun() {
    if (!session) return;
    if (questionsDirty && !(await saveQuestions())) return;
    setError("");
    setNotice("");
    setBusy("run");
    try {
      const run = await api<QuickStartRun>(`/quick-start/sessions/${session.id}/runs`, {
        method: "POST",
        body: JSON.stringify({ confirmed: runConfirmed }),
      });
      setActiveRun({ ...run, responses: [] });
      setRunConfirmed(false);
      setViewStep(3);
      setNotice("检测已启动，页面会自动更新进度；失败请求不会自动重试。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "启动检测失败");
    } finally {
      setBusy("");
    }
  }

  async function loadReport(id: string) {
    setError("");
    setBusy("report");
    try {
      const result = await api<QuickStartReport>(`/quick-start/reports/${id}`);
      setReport(result);
      setViewStep(4);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载报告失败");
    } finally {
      setBusy("");
    }
  }

  async function generateSuggestions() {
    if (!reportId) return;
    setError("");
    setBusy("suggestions");
    try {
      const result = await api<QuickStartReport>(`/quick-start/reports/${reportId}/suggestions`, {
        method: "POST",
        body: JSON.stringify({ confirmed: suggestionConfirmed }),
      });
      setReport(result);
      setSuggestionConfirmed(false);
      setNotice(`已生成 ${result.suggestions.length} 条与回答证据关联的建议。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成优化建议失败");
    } finally {
      setBusy("");
    }
  }

  async function generateContent(suggestionId?: string) {
    if (!reportId) return;
    const requestedReportId = reportId;
    const requestDraftRevision = draftRevision.current;
    const requestedContext = enterpriseContext.trim();
    setError("");
    setBusy("content");
    try {
      const result = await api<ContentAsset>(`/quick-start/reports/${reportId}/content`, {
        method: "POST",
        body: JSON.stringify({ channel, suggestionId, enterpriseContext: requestedContext, confirmed: contentConfirmed }),
      });
      if (activeReportIdRef.current !== requestedReportId) return;
      setReport((current) => current
        ? { ...current, contentAssets: [result, ...current.contentAssets.filter((item) => item.id !== result.id)] }
        : current);
      if (draftRevision.current === requestDraftRevision) {
        setSelectedContent(result);
        setDraftTitle(result.title);
        setDraftSummary(renderContentSummary(result.metadata));
        setDraftBody(result.body);
        setDraftTags(result.hashtags.join(" "));
        setDraftVideoScriptText(renderVideoScript(result.metadata));
      }
      setContentConfirmed(false);
      setViewStep(5);
      setNotice(draftRevision.current === requestDraftRevision
        ? "新内容已保存为草稿，并保留了检测证据关联。"
        : "新草稿已生成并保留在列表中；检测到你正在编辑内容，已保留当前编辑。可从右侧列表打开新草稿。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成内容失败");
    } finally {
      if (activeReportIdRef.current === requestedReportId) setBusy("");
    }
  }

  async function saveContent() {
    if (!selectedContent) return;
    setError("");
    setBusy("save-content");
    try {
      const result = await api<ContentAsset>(`/quick-start/content/${selectedContent.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: draftTitle,
          body: draftBody,
          summaryText: selectedContent.metadata?.summary !== undefined || typeof selectedContent.metadata?.summaryText === "string"
            ? draftSummary
            : undefined,
          hashtags: draftTags.split(/[，,\s]+/).map((tag) => tag.trim()).filter(Boolean),
          videoScriptText: selectedContent.metadata?.videoScript != null || typeof selectedContent.metadata?.videoScriptText === "string"
            ? draftVideoScriptText
            : undefined,
        }),
      });
      setSelectedContent(result);
      setNotice("内容草稿已保存，可进入发布工作台安排后续人工复核。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存内容失败");
    } finally {
      setBusy("");
    }
  }

  async function copyDraft() {
    try {
      const script = draftVideoScriptText.trim() ? `\n\n视频脚本\n${draftVideoScriptText.trim()}` : "";
      const summary = draftSummary.trim() ? `\n\n摘要\n${draftSummary.trim()}` : "";
      await navigator.clipboard.writeText(`${draftTitle}${summary}\n\n${draftBody}${script}\n\n${draftTags}`.trim());
      setNotice("当前草稿已复制为纯文本。");
    } catch {
      setError("复制失败，请检查浏览器剪贴板权限。");
    }
  }

  function exportDraft() {
    const script = draftVideoScriptText.trim() ? `\n\n视频脚本\n${draftVideoScriptText.trim()}` : "";
    const summary = draftSummary.trim() ? `\n\n摘要\n${draftSummary.trim()}` : "";
    const file = new Blob([`${draftTitle}${summary}\n\n${draftBody}${script}\n\n${draftTags}`.trim()], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `geolens-${selectedContent?.channel ?? "content"}-draft.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("草稿已导出为纯文本文件。");
  }

  async function createDistributionTasks() {
    if (!selectedContent || platformSelection.length === 0) return;
    setError("");
    setBusy("distribution");
    try {
      const result = await api<DistributionTask[]>(
        `/quick-start/content/${selectedContent.id}/distribution-tasks`,
        { method: "POST", body: JSON.stringify({ platforms: platformSelection }) },
      );
      setDistributionTasks(result);
      setViewStep(6);
      setNotice(`${result.length} 个草稿任务已进入发布工作台，等待人工复核。`);
      router.push("/app/distribution");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建分发任务失败");
    } finally {
      setBusy("");
    }
  }

  function newSession() {
    draftRevision.current += 1;
    activeReportIdRef.current = undefined;
    setSession(null);
    setActiveRun(null);
    setReport(null);
    setSelectedContent(null);
    setEnterpriseContext("");
    setDraftTitle("");
    setDraftSummary("");
    setDraftBody("");
    setDraftTags("");
    setDraftVideoScriptText("");
    setQuestions([]);
    setQuestionsDirty(false);
    setBrandName("");
    setWebsite("");
    setIndustry("");
    setCompetitorsText("");
    setProvider("MOCK");
    setModel(providers.find((item) => item.provider === "MOCK")?.model ?? "geolens-mock-v1");
    setViewStep(1);
    setError("");
    setNotice("");
    router.replace("/app/quick-start");
  }

  function changeProvider(next: AiProvider) {
    setProvider(next);
    setModel(providers.find((item) => item.provider === next)?.model ?? "");
    setIndustryConfirmed(false);
    setQuestionConfirmed(false);
    setRunConfirmed(false);
    setSuggestionConfirmed(false);
    setContentConfirmed(false);
  }

  const metrics = report?.metrics;
  const responses = activeRun?.responses ?? report?.run?.responses ?? [];
  const currentOrganization = organizations.find((item) => item.id === organizationId);

  if (loading) {
    return (
      <div className={`${card} flex min-h-72 flex-col items-center justify-center text-center`}>
        <span className="size-8 animate-spin rounded-full border-2 border-blue-100 border-t-blue-600" />
        <p className="mt-4 text-sm font-medium text-slate-700">正在恢复快速开始进度</p>
        <p className="mt-1 text-xs text-slate-400">已保存的项目、问题和报告会在这里继续。</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-blue-600">GEO QUICK START</p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">快速开始</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            从品牌和问题开始，一路看到回答证据、可执行建议，以及可带入发布工作台的内容草稿。
          </p>
        </div>
        {session ? (
          <button className={buttonSecondary} onClick={newSession}>新建一次检测</button>
        ) : null}
      </div>

      {session && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
          <span className="font-semibold text-slate-800">{session.brand.name}</span>
          <span>项目：{session.project.name}</span>
          <span>组织：{currentOrganization?.name ?? "已授权组织"}</span>
          <Link href={`/app/projects/${session.project.id}`} className="font-medium text-blue-700 hover:text-blue-800">
            在项目工作台继续 →
          </Link>
        </div>
      )}

      <nav className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white p-2 shadow-sm" aria-label="快速开始步骤">
        <ol className="flex min-w-[680px] items-center gap-1">
          {steps.map((step) => {
            const done = session && stageNumber(session.currentStep) > step.number;
            const active = currentStep === step.number;
            const disabled = !session && step.number > 1;
            return (
              <li key={step.number} className="flex-1">
                <button
                  disabled={disabled}
                  onClick={() => setViewStep(step.number)}
                  className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2.5 text-left transition sm:px-3 ${active ? "bg-blue-50 text-blue-800" : done ? "text-emerald-700 hover:bg-emerald-50/70" : "text-slate-500 hover:bg-slate-50"} disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${active ? "bg-blue-600 text-white" : done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                    {done ? "✓" : step.number}
                  </span>
                  <span className="whitespace-nowrap text-xs font-medium sm:text-sm">{step.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          <span>{error}</span>
          {session && <button className="font-semibold underline underline-offset-2" onClick={() => void loadSession(session.id)}>重新加载</button>}
        </div>
      )}
      {notice && <div className="rounded-xl border border-blue-100 bg-blue-50/80 px-4 py-3 text-sm text-blue-800" role="status">{notice}</div>}

      {currentStep === 1 && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className={card}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">步骤 01</p>
                <h2 className="mt-1.5 text-lg font-semibold text-slate-900">先告诉我们要监测哪个品牌</h2>
                <p className="mt-1.5 text-sm text-slate-500">只填写品牌名即可开始，其他信息都可以之后补充。</p>
              </div>
              <span className="hidden rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500 sm:inline-flex">约 1 分钟</span>
            </div>

            {organizations.length === 0 ? (
              <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                当前账号还没有可用组织，请先完成账号设置。
              </div>
            ) : (
              <form onSubmit={createSession} className="mt-6 space-y-4">
                {organizations.length > 1 && (
                  <label className="block text-sm font-medium text-slate-700">
                    保存到组织
                    <select className={inputClass} value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} required>
                      {organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
                    </select>
                  </label>
                )}
                <label className="block text-sm font-medium text-slate-700">
                  品牌或产品名称 <span className="text-rose-500">*</span>
                  <input className={`${inputClass} py-3 text-base`} value={brandName} onChange={(event) => setBrandName(event.target.value)} placeholder="例如：星河咖啡" maxLength={100} required />
                </label>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block text-sm font-medium text-slate-700">
                    官网 <span className="font-normal text-slate-400">可选</span>
                    <input className={inputClass} value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="www.example.com" maxLength={500} />
                    <span className="mt-1 block text-xs font-normal text-slate-400">仅保存到项目资料，不会自动抓取网站。</span>
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    行业 <span className="font-normal text-slate-400">可选，可修改</span>
                    <input className={inputClass} value={industry} onChange={(event) => setIndustry(event.target.value)} placeholder="例如：餐饮与饮品" maxLength={100} />
                  </label>
                </div>
                <label className="block text-sm font-medium text-slate-700">
                  竞品 <span className="font-normal text-slate-400">可选，用逗号分开</span>
                  <input className={inputClass} value={competitorsText} onChange={(event) => setCompetitorsText(event.target.value)} placeholder="例如：品牌 A，品牌 B" />
                </label>

                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <button type="button" onClick={() => setAdvancedOpen((value) => !value)} className="flex w-full items-center justify-between text-left text-sm font-semibold text-slate-700">
                    高级设置 <span className="text-slate-400">{advancedOpen ? "收起 −" : "按需展开 +"}</span>
                  </button>
                  {advancedOpen && (
                    <div className="mt-4 space-y-3">
                      <ProviderSettings
                        providers={providers}
                        provider={provider}
                        model={model}
                        onProvider={changeProvider}
                        onModel={setModel}
                      />
                      <div className="flex flex-wrap items-center gap-3">
                        <button type="button" className={buttonSecondary} disabled={busy === "industry" || !brandName.trim() || (provider !== "MOCK" && (!configuredProvider?.configured || !industryConfirmed))} onClick={() => void suggestIndustry()}>
                          {busy === "industry" ? "推断中…" : "建议行业"}
                        </button>
                        {provider !== "MOCK" && !configuredProvider?.configured && <span className="text-xs text-amber-700">服务端尚未配置该 Provider 的 API Key。</span>}
                      </div>
                      {provider !== "MOCK" && <PaidCallConfirm provider={provider} count={1} checked={industryConfirmed} onChange={setIndustryConfirmed} />}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <p className="max-w-md text-xs leading-5 text-slate-500">系统会在所选组织中复用或创建项目与品牌，并把后续问题保存为正式 Query。</p>
                  <button className={buttonPrimary} disabled={busy === "create" || !organizationId || !brandName.trim()}>
                    {busy === "create" ? "正在保存…" : "创建项目并继续"}
                  </button>
                </div>
              </form>
            )}
          </section>

          {!session && recentSessions.length > 0 && (
            <section className={card}>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">最近记录</p>
              <h2 className="mt-1.5 text-base font-semibold text-slate-900">继续上次的快速开始</h2>
              <ul className="mt-4 space-y-2">
                {recentSessions.map((item) => (
                  <li key={item.id}>
                    <button onClick={async () => { try { await loadSession(item.id); router.replace(`/app/quick-start?sessionId=${item.id}`); } catch (cause) { setError(cause instanceof Error ? cause.message : "恢复记录失败"); } }} className="w-full rounded-xl border border-slate-200 p-3 text-left transition hover:border-blue-200 hover:bg-blue-50/50">
                      <span className="block text-sm font-semibold text-slate-800">{item.brand.name}</span>
                      <span className="mt-1 block text-xs text-slate-500">{item.project.name} · 最近更新 {new Date(item.updatedAt).toLocaleDateString()}</span>
                      <span className="mt-2 inline-flex text-xs font-medium text-blue-700">继续第 {stageNumber(item.currentStep)} 步 →</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {currentStep === 2 && session && (
        <section className={card}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">步骤 02</p>
              <h2 className="mt-1.5 text-lg font-semibold text-slate-900">生成并确认监测问题</h2>
              <p className="mt-1.5 text-sm text-slate-500">问题会保存到项目的快速开始 Query Set。检测前可以编辑、删除或补充。</p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
              当前模型：<strong className="text-slate-800">{session.model}</strong>
              <span className="mt-1 block">{providerLabel(session.provider)}</span>
            </div>
          </div>

          <details open={advancedOpen} className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <summary onClick={(event) => { event.preventDefault(); setAdvancedOpen((value) => !value); }} className="cursor-pointer list-none text-sm font-semibold text-slate-700">高级设置 <span className="ml-2 text-xs font-normal text-slate-400">{advancedOpen ? "收起" : "更换 Provider 或模型"}</span></summary>
            {advancedOpen && (
              <div className="mt-4 space-y-3">
                <ProviderSettings providers={providers} provider={provider} model={model} onProvider={changeProvider} onModel={setModel} />
                <button className={buttonSecondary} disabled={busy === "settings"} onClick={() => void saveSettings()}>{busy === "settings" ? "保存中…" : "保存模型设置"}</button>
                {settingsChanged && <p className="text-xs text-amber-700">设置有未保存的修改。保存后才会用于生成问题或执行检测。</p>}
              </div>
            )}
          </details>

          {questions.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 px-5 py-8 text-center">
              <div className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-blue-50 text-lg font-semibold text-blue-700">?</div>
              <h3 className="mt-3 text-sm font-semibold text-slate-800">准备一组 8–12 条监测问题</h3>
              <p className="mx-auto mt-1.5 max-w-lg text-xs leading-5 text-slate-500">问题分为通用发现型和品牌相关两类，生成后可以逐条修改。</p>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {questions.map((question, index) => (
                <div key={question.queryId ?? `new-${index}`} className="rounded-2xl border border-slate-200 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-400">{String(index + 1).padStart(2, "0")}</span>
                      <select
                        value={question.kind}
                        onChange={(event) => {
                          setQuestions((items) => items.map((item, i) => i === index ? { ...item, kind: event.target.value as QuestionDraft["kind"] } : item));
                          setQuestionsDirty(true);
                        }}
                        className="rounded-full border-0 bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 outline-none focus:ring-2 focus:ring-blue-100"
                        aria-label={`第 ${index + 1} 条问题类型`}
                      >
                        <option value="DISCOVERY">通用发现</option>
                        <option value="BRANDED">品牌相关</option>
                      </select>
                    </div>
                    <button className="text-xs font-medium text-slate-400 transition hover:text-rose-600" onClick={() => { setQuestions((items) => items.filter((_, i) => i !== index)); setQuestionsDirty(true); }}>删除</button>
                  </div>
                  <textarea
                    className="w-full resize-y rounded-xl border border-slate-200 px-3.5 py-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                    rows={2}
                    value={question.text}
                    maxLength={500}
                    onChange={(event) => {
                      setQuestions((items) => items.map((item, i) => i === index ? { ...item, text: event.target.value } : item));
                      setQuestionsDirty(true);
                    }}
                  />
                  <input
                    className="mt-2 w-full rounded-lg border border-transparent bg-slate-50 px-3 py-2 text-xs text-slate-500 outline-none focus:border-blue-200 focus:bg-white"
                    value={question.intent}
                    maxLength={100}
                    aria-label={`第 ${index + 1} 条问题意图`}
                    onChange={(event) => {
                      setQuestions((items) => items.map((item, i) => i === index ? { ...item, intent: event.target.value } : item));
                      setQuestionsDirty(true);
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button className={buttonSecondary} disabled={busy === "questions" || settingsChanged || (provider !== "MOCK" && !configuredProvider?.configured)} onClick={() => void generateQuestions()}>
              {busy === "questions" ? "生成中…" : questions.length ? "重新生成问题" : "生成监测问题"}
            </button>
            {questions.length > 0 && (
              <button className={buttonSecondary} disabled={questions.length >= 12} onClick={() => { setQuestions((items) => [...items, { text: "", kind: "DISCOVERY", intent: "补充问题" }]); setQuestionsDirty(true); }}>＋ 补充问题</button>
            )}
            {questions.length > 0 && (
              <button className={buttonSecondary} disabled={!questionsDirty || busy === "save-questions" || !validQuestionCount(questions.length)} onClick={() => void saveQuestions()}>{busy === "save-questions" ? "保存中…" : questionsDirty ? "保存问题" : "问题已保存"}</button>
            )}
          </div>
          {questions.length > 0 && !validQuestionCount(questions.length) && <p className="mt-2 text-xs text-amber-700" role="status">当前 {questions.length} 条，保存和检测需要 8–12 条问题。</p>}
          {questionsDirty && <p className="mt-2 text-xs text-amber-700">还有未保存的修改。开始检测时会先保存问题。</p>}
          {provider !== "MOCK" && <div className="mt-4 max-w-xl"><PaidCallConfirm provider={provider} count={1} checked={questionConfirmed} onChange={setQuestionConfirmed} /></div>}
          {settingsChanged && <p className="mt-3 text-xs text-amber-700">请先保存高级设置，再生成问题或运行检测。</p>}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
            <p className="text-xs text-slate-500">检测前确认问题后，可继续查看每条原始回答和证据。</p>
              <button className={buttonPrimary} disabled={!validQuestionCount(questions.length) || questions.some((question) => !question.text.trim() || !question.intent.trim())} onClick={() => { setViewStep(3); setError(""); }}>确认问题并继续 <span aria-hidden="true" className="ml-2">→</span></button>
          </div>
        </section>
      )}

      {currentStep === 3 && session && (
        <section className={card}>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">步骤 03</p>
          <h2 className="mt-1.5 text-lg font-semibold text-slate-900">一键运行 GEO 检测</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">每个已确认的问题对应一次模型请求。原始回答会作为不可变证据保存到当前项目。</p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <InfoTile label="Provider" value={providerLabel(session.provider)} />
            <InfoTile label="模型" value={session.model} />
            <InfoTile label="已确认问题" value={`${questions.length} 条`} />
            <InfoTile label="预计请求" value={`${questions.length} 次`} />
          </div>
          {activeRun && (
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">最近一次检测</p>
                  <p className="mt-1 text-xs text-slate-500">{activeRun.model} · {activeRun.isMock ? "模拟数据/未真实验证" : "真实 Provider 回答"}</p>
                </div>
                <StatusPill status={activeRun.status} />
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${activeRun.requestCount ? Math.min(100, (activeRun.responseCount / activeRun.requestCount) * 100) : 0}%` }} />
              </div>
              <p className="mt-2 text-xs text-slate-500">已保存 {activeRun.responseCount} / {activeRun.requestCount} 条回答</p>
              {activeRun.error && <p className="mt-2 text-xs text-amber-800">{activeRun.error}</p>}
            </div>
          )}
          <div className="mt-5 max-w-2xl space-y-3">
            <Provenance isMock={session.provider === "MOCK"} />
            {session.provider !== "MOCK" && <PaidCallConfirm provider={session.provider} count={questions.length} checked={runConfirmed} onChange={setRunConfirmed} />}
            {session.provider !== "MOCK" && !sessionProviderStatus?.configured && <p className="text-xs text-amber-700">服务端没有配置 {providerLabel(session.provider)} 的 API Key；当前不会发送外部请求。</p>}
          </div>
          <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-100 pt-5">
            <button className={buttonPrimary} disabled={busy === "run" || activeRun?.status === "RUNNING" || settingsChanged || !validQuestionCount(questions.length) || (session.provider !== "MOCK" && !sessionProviderStatus?.configured)} onClick={() => void startRun()}>
              {busy === "run" ? "启动中…" : activeRun?.status === "RUNNING" ? "检测进行中…" : activeRun ? "重新运行检测" : "开始 GEO 检测"}
            </button>
            {activeRun?.report && <button className={buttonSecondary} onClick={() => void loadReport(activeRun.report!.id)}>查看本次报告</button>}
          </div>
        </section>
      )}

      {currentStep === 4 && session && (
        <div className="space-y-5">
          {!report ? (
            <section className={`${card} text-center`}>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">步骤 04</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-900">检测报告还没有生成</h2>
              <p className="mt-2 text-sm text-slate-500">先运行一组监测问题，完成的回答会汇总成报告。</p>
              <button className={`${buttonPrimary} mt-5`} onClick={() => setViewStep(3)}>返回检测</button>
            </section>
          ) : (
            <>
              <section className={card}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">步骤 04 · 本次样本报告</p>
                    <h2 className="mt-1.5 text-lg font-semibold text-slate-900">{session.brand.name} 的 AI 回答表现</h2>
                    <p className="mt-1.5 text-sm text-slate-500">提及率只统计本次已保存的回答样本，不代表全网排名或长期可见度。</p>
                  </div>
                  {activeRun && <StatusPill status={activeRun.status} />}
                </div>
                <div className="mt-5"><Provenance isMock={report.containsMockData} /></div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricTile label="品牌提及率" value={percent(metrics?.rate)} detail={`${metrics?.mentioned ?? 0} / ${metrics?.total ?? 0} 条回答提及`} accent />
                  <MetricTile label="通用发现问题" value={percent(metrics?.discovery.rate)} detail={`${metrics?.discovery.mentioned ?? 0} / ${metrics?.discovery.total ?? 0} 条提及`} />
                  <MetricTile label="品牌相关问题" value={percent(metrics?.branded.rate)} detail={`${metrics?.branded.mentioned ?? 0} / ${metrics?.branded.total ?? 0} 条提及`} />
                  <MetricTile label="待关注机会" value={`${responses.filter((response) => !response.brandMentioned).length} 条`} detail="回答中未出现品牌" />
                </div>
                {metrics?.sampleNote && <p className="mt-3 text-xs text-slate-400">{metrics.sampleNote}</p>}
              </section>

              <section className={card}>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">逐题回答与证据</h3>
                    <p className="mt-1 text-xs text-slate-500">原始回答只读保存，可展开查看本次问题与来源信息。</p>
                  </div>
                  <span className="text-xs text-slate-400">{responses.length} 条已保存回答</span>
                </div>
                <div className="mt-4 space-y-3">
                  {responses.map((response, index) => (
                    <article key={response.id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-slate-400">{String(index + 1).padStart(2, "0")}</span>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{response.kind === "DISCOVERY" ? "通用发现" : "品牌相关"}</span>
                        <span className={`rounded-full px-2.5 py-1 text-xs ${response.brandMentioned ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{response.brandMentioned ? `已提及${response.mentionPosition ? ` · 第 ${response.mentionPosition} 位` : ""}` : "未提及"}</span>
                        {response.isMock && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-900">模拟回答</span>}
                      </div>
                      <h4 className="mt-3 text-sm font-semibold leading-6 text-slate-800">{response.queryText}</h4>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{response.rawResponse}</p>
                      <details className="mt-3 border-t border-slate-100 pt-3">
                        <summary className="cursor-pointer text-xs font-medium text-blue-700">查看原始检测信息</summary>
                        <div className="mt-3 space-y-2 text-xs text-slate-500">
                          <p>Provider：{providerLabel(response.isMock ? "MOCK" : activeRun?.provider ?? session.provider)} · 模型：{activeRun?.model ?? session.model} · 延迟 {response.latencyMs} ms</p>
                          <pre className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 font-sans leading-5">{response.rawPrompt}</pre>
                          {response.citations.length > 0 ? (
                            <div className="flex flex-wrap gap-2">{response.citations.map((citation) => { const href = safeHttpUrl(citation); return href ? <a key={citation} href={href} target="_blank" rel="noreferrer" className="break-all text-blue-700 underline">{citation}</a> : null; })}</div>
                          ) : <p>本次回答没有可保存的引用链接。</p>}
                        </div>
                      </details>
                    </article>
                  ))}
                  {responses.length === 0 && <EmptyState title="暂无回答" body="运行检测后，这里会显示逐题回答。" />}
                </div>
              </section>

              <section className={card}>
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">从证据到行动</p>
                    <h3 className="mt-1.5 text-base font-semibold text-slate-900">AI 优化建议</h3>
                    <p className="mt-1 text-xs text-slate-500">每条建议都会链接回对应回答和 Query，可用于后续复核。</p>
                  </div>
                  <button className={buttonSecondary} disabled={busy === "suggestions" || (reportProvider !== "MOCK" && !reportProviderStatus?.configured)} onClick={() => void generateSuggestions()}>
                    {busy === "suggestions" ? "生成中…" : report.suggestions.length ? "重新生成建议" : "生成优化建议"}
                  </button>
                </div>
                {reportProvider !== "MOCK" && <div className="mt-4 max-w-xl"><PaidCallConfirm provider={reportProvider} count={1} checked={suggestionConfirmed} onChange={setSuggestionConfirmed} /></div>}
                {report.suggestions.length > 0 ? (
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    {report.suggestions.map((suggestion) => (
                      <article key={suggestion.id} className="rounded-2xl border border-slate-200 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className="text-sm font-semibold text-slate-900">{suggestion.title}</h4>
                          <span className="text-[11px] text-slate-400">{suggestion.isMock ? "模拟建议" : "真实模型生成"}</span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{suggestion.action}</p>
                        {suggestion.evidence.map(({ response }) => (
                          <div key={response.id} className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600">
                            <span className="font-medium text-slate-800">关联问题：</span>{response.queryText}
                            <p className="mt-1 line-clamp-2 text-slate-500">{response.rawResponse}</p>
                          </div>
                        ))}
                        <button className="mt-3 text-xs font-semibold text-blue-700 hover:text-blue-800" onClick={() => { setViewStep(5); setChannel("geo"); void generateContent(suggestion.id); }}>从这条建议生成内容 →</button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4"><EmptyState title="建议还没有生成" body="生成后可选择其中一条，直接进入多平台内容草稿。" /></div>
                )}
              </section>

              <div className="flex flex-wrap justify-end gap-3">
                <button className={buttonSecondary} onClick={() => setViewStep(3)}>返回检测进度</button>
                <button className={buttonPrimary} onClick={() => setViewStep(5)}>继续生成内容 <span aria-hidden="true" className="ml-2">→</span></button>
              </div>
            </>
          )}
        </div>
      )}

      {currentStep === 5 && session && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <section className={card}>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">步骤 05</p>
            <h2 className="mt-1.5 text-lg font-semibold text-slate-900">把检测机会整理成多平台内容</h2>
            <p className="mt-1.5 text-sm leading-6 text-slate-500">生成结果会以正式内容草稿保存，并保留关联报告、回答证据和模型来源。</p>
            {!report ? (
              <div className="mt-5"><EmptyState title="需要先有一份检测报告" body="完成 Mock 或真实 Provider 检测后，就能从回答证据生成内容。" /><button className={`${buttonPrimary} mt-4`} onClick={() => setViewStep(3)}>返回检测</button></div>
            ) : (
              <>
                <label className="mt-5 block text-sm font-medium text-slate-700">
                  目标平台
                  <select className={inputClass} value={channel} onChange={(event) => { draftRevision.current += 1; setChannel(event.target.value); }}>
                    {platforms.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
                <label className="mt-4 block text-sm font-medium text-slate-700">
                  补充企业资料（可选）
                  <textarea
                    className={`${inputClass} min-h-24 resize-y leading-6`}
                    value={enterpriseContext}
                    maxLength={4000}
                    onChange={(event) => { draftRevision.current += 1; setEnterpriseContext(event.target.value); }}
                    placeholder="可填写产品或服务、目标客户、使用场景、已确认的优势和品牌表达方式。缺少的信息会作为待核实项提示。"
                  />
                  <span className="mt-1 block text-xs font-normal text-slate-400">本次资料会随新草稿保存，帮助后续复核生成依据。</span>
                </label>
                <div className="mt-4 max-w-xl space-y-3">
                  {reportProvider !== "MOCK" && <PaidCallConfirm provider={reportProvider} count={1} checked={contentConfirmed} onChange={setContentConfirmed} />}
                  <button className={buttonSecondary} disabled={busy === "content" || (reportProvider !== "MOCK" && !reportProviderStatus?.configured)} onClick={() => void generateContent()}>
                    {busy === "content" ? "生成中…" : "生成新的平台草稿"}
                  </button>
                </div>

                {selectedContent ? (
                  <div className="mt-6 border-t border-slate-100 pt-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">编辑内容草稿</h3>
                        <p className="mt-1 text-xs text-slate-500">修改不会覆盖原始检测回答和生成记录。</p>
                      </div>
                      <StatusPill status={selectedContent.status} />
                    </div>
                    <div className="mt-4 space-y-4">
                      <label className="block text-sm font-medium text-slate-700">标题<input className={inputClass} value={draftTitle} maxLength={200} onChange={(event) => { draftRevision.current += 1; setDraftTitle(event.target.value); }} /></label>
                      <label className="block text-sm font-medium text-slate-700">摘要<textarea className={`${inputClass} min-h-20 resize-y leading-6`} value={draftSummary} maxLength={500} onChange={(event) => { draftRevision.current += 1; setDraftSummary(event.target.value); }} /></label>
                      <label className="block text-sm font-medium text-slate-700">正文<textarea className={`${inputClass} min-h-64 resize-y leading-6`} value={draftBody} maxLength={30000} onChange={(event) => { draftRevision.current += 1; setDraftBody(event.target.value); }} /></label>
                      {(selectedContent.metadata?.videoScript != null || typeof selectedContent.metadata?.videoScriptText === "string") && (
                        <label className="block text-sm font-medium text-slate-700">
                          视频脚本
                          <textarea
                            className={`${inputClass} min-h-48 resize-y leading-6`}
                            value={draftVideoScriptText}
                            maxLength={20000}
                            onChange={(event) => { draftRevision.current += 1; setDraftVideoScriptText(event.target.value); }}
                          />
                        </label>
                      )}
                      <label className="block text-sm font-medium text-slate-700">话题标签<input className={inputClass} value={draftTags} onChange={(event) => { draftRevision.current += 1; setDraftTags(event.target.value); }} placeholder="#品牌名 #选择指南" /></label>
                      <Provenance isMock={selectedContent.isMock} evidenceMock={selectedContent.evidenceMock} />
                      {(selectedRiskNotes.length > 0 || selectedQualityWarnings.length > 0) && (
                        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-900">
                          <strong>发布前人工核对</strong>
                          <ul className="mt-1 list-disc space-y-1 pl-4">
                            {[...selectedRiskNotes, ...selectedQualityWarnings].map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
                          </ul>
                          <p className="mt-2 text-amber-800">自动检查只能提示可疑表达，不能证明事实真伪。</p>
                        </div>
                      )}
                      {selectedContent.generations[0] && <p className="text-xs text-slate-400">{selectedContent.generations[0].provider} / {selectedContent.generations[0].model} · {selectedContent.generations[0].promptVersion}</p>}
                      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4" aria-label="纯文本预览">
                        <p className="text-xs font-semibold text-slate-500">纯文本预览</p>
                        <h4 className="mt-2 text-sm font-semibold text-slate-900">{draftTitle}</h4>
                        {draftSummary.trim() && <p className="mt-2 text-sm leading-6 text-slate-500">{draftSummary}</p>}
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{draftBody}</p>
                        {draftVideoScriptText.trim() && <p className="mt-3 whitespace-pre-wrap border-t border-slate-200 pt-3 text-sm leading-6 text-slate-700"><strong className="text-xs text-slate-500">视频脚本</strong><br />{draftVideoScriptText}</p>}
                        {draftTags.trim() && <p className="mt-2 text-sm text-blue-700">{draftTags}</p>}
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <button className={buttonPrimary} disabled={busy === "save-content" || !draftTitle.trim() || !draftBody.trim()} onClick={() => void saveContent()}>{busy === "save-content" ? "保存中…" : "保存内容草稿"}</button>
                        <button className={buttonSecondary} disabled={!draftTitle.trim() || !draftBody.trim()} onClick={() => void copyDraft()}>复制纯文本</button>
                        <button className={buttonSecondary} disabled={!draftTitle.trim() || !draftBody.trim()} onClick={exportDraft}>导出 TXT</button>
                        <button className={buttonSecondary} disabled={selectedContent.status !== "SAVED" || busy === "distribution"} onClick={() => setViewStep(6)}>选择平台并进入发布 →</button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 border-t border-slate-100 pt-5"><EmptyState title="还没有内容草稿" body="选择平台后生成一份可编辑草稿。" /></div>
                )}
              </>
            )}
          </section>

          <aside className="space-y-4">
            <section className={card}>
              <h3 className="text-sm font-semibold text-slate-900">内容依据</h3>
              <p className="mt-2 text-xs leading-5 text-slate-500">草稿围绕本次报告的未提及问题和优化建议生成。发布前请核实产品事实、来源和适用边界。</p>
              {report?.suggestions?.[0] && <div className="mt-3 rounded-xl bg-blue-50 p-3 text-xs leading-5 text-blue-900"><span className="font-semibold">优先建议</span><p className="mt-1">{report.suggestions[0].title}</p></div>}
            </section>
            {report?.contentAssets?.length ? (
              <section className={card}>
                <h3 className="text-sm font-semibold text-slate-900">已保存的内容</h3>
                <ul className="mt-3 space-y-2">
                  {report.contentAssets.map((asset) => (
                    <li key={asset.id}>
                      <button className={`w-full rounded-xl border p-3 text-left ${selectedContent?.id === asset.id ? "border-blue-200 bg-blue-50/50" : "border-slate-200 hover:bg-slate-50"}`} onClick={() => { draftRevision.current += 1; setSelectedContent(asset); setChannel(asset.channel); setDraftTitle(asset.title); setDraftSummary(renderContentSummary(asset.metadata)); setDraftBody(asset.body); setDraftTags(asset.hashtags.join(" ")); setDraftVideoScriptText(renderVideoScript(asset.metadata)); setEnterpriseContext(metadataText(asset.metadata, "enterpriseContext")); }}>
                        <span className="block text-xs font-semibold text-slate-700">{platforms.find((item) => item.id === asset.channel)?.label ?? asset.channel}</span>
                        <span className="mt-1 block line-clamp-2 text-xs text-slate-500">{asset.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </aside>
        </div>
      )}

      {currentStep === 6 && session && (
        <section className={card}>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">步骤 06</p>
          <h2 className="mt-1.5 text-lg font-semibold text-slate-900">把已保存内容带入发布工作台</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">每个平台都会创建一个正式项目内的分发草稿任务。GeoLens 当前未配置平台连接器，任务会等待人工复核，不会自动公开发布。</p>
          {!selectedContent ? (
            <div className="mt-5"><EmptyState title="还没有可带入的内容" body="先生成并保存一份内容草稿。" /><button className={`${buttonPrimary} mt-4`} onClick={() => setViewStep(5)}>返回内容生成</button></div>
          ) : (
            <>
              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                <p className="text-xs font-semibold text-slate-500">准备进入工作台的草稿</p>
                <p className="mt-1.5 text-sm font-semibold text-slate-900">{draftTitle || selectedContent.title}</p>
                <p className="mt-1 text-xs text-slate-500">{selectedContent.isMock ? "模拟生成/未真实验证" : "真实 Provider 生成"} · 项目 {session.project.name}</p>
              </div>
              <div className="mt-5">
                <p className="text-sm font-medium text-slate-800">选择要创建的分发任务</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {platforms.map((platform) => (
                    <label key={platform.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-sm transition ${platformSelection.includes(platform.id) ? "border-blue-200 bg-blue-50/70 text-blue-900" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                      <input type="checkbox" checked={platformSelection.includes(platform.id)} className="size-4 accent-blue-600" onChange={(event) => setPlatformSelection((current) => event.target.checked ? Array.from(new Set([...current, platform.id])) : current.filter((id) => id !== platform.id))} />
                      {platform.label}
                      {platform.id === selectedContent.channel && <span className="ml-auto text-[10px] text-slate-400">草稿格式</span>}
                    </label>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-400">任务创建后可在发布工作台复制内容、查看来源和进行人工复核。此操作不会模拟发布，也不会创建已发布记录。</p>
              </div>
              <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-100 pt-5">
                <button className={buttonPrimary} disabled={platformSelection.length === 0 || busy === "distribution"} onClick={() => void createDistributionTasks()}>{busy === "distribution" ? "正在创建…" : "进入发布工作台"}</button>
                <Link className={buttonSecondary} href={`/app/projects/${session.project.id}`}>在项目工作台继续</Link>
              </div>
              {distributionTasks.length > 0 && <ul className="mt-4 space-y-2">{distributionTasks.map((task) => <li key={task.id} className="flex items-center justify-between rounded-xl bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-900"><span>{task.platformLabel}</span><span>待人工复核</span></li>)}</ul>}
            </>
          )}
        </section>
      )}

      {!session && currentStep > 1 && <section className={card}><EmptyState title="先创建品牌监测上下文" body="第一步会自动复用或创建当前组织下的项目和品牌。" /><button className={`${buttonPrimary} mt-4`} onClick={() => setViewStep(1)}>返回输入品牌</button></section>}
    </div>
  );
}

function ProviderSettings({
  providers,
  provider,
  model,
  onProvider,
  onModel,
}: {
  providers: ProviderStatus[];
  provider: AiProvider;
  model: string;
  onProvider: (provider: AiProvider) => void;
  onModel: (model: string) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <label className="block text-sm font-medium text-slate-700">
        Provider
        <select className={inputClass} value={provider} onChange={(event) => onProvider(event.target.value as AiProvider)}>
          {providers.map((item) => <option key={item.provider} value={item.provider}>{item.label}{item.provider !== "MOCK" && !item.configured ? "（未配置）" : ""}</option>)}
        </select>
        <span className="mt-1 block text-xs font-normal text-slate-400">真实模型 Key 由服务端环境变量管理，不会保存到浏览器。</span>
      </label>
      <label className="block text-sm font-medium text-slate-700">
        模型
        <input className={inputClass} value={model} onChange={(event) => onModel(event.target.value)} maxLength={100} />
        <span className="mt-1 block text-xs font-normal text-slate-400">每次真实调用前都会显示请求数量并要求确认。</span>
      </label>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5"><p className="text-xs text-slate-400">{label}</p><p className="mt-1.5 break-words text-sm font-semibold text-slate-800">{value}</p></div>;
}

function MetricTile({ label, value, detail, accent = false }: { label: string; value: string; detail: string; accent?: boolean }) {
  return <div className={`rounded-2xl border p-4 ${accent ? "border-blue-100 bg-blue-50/70" : "border-slate-200 bg-white"}`}><p className="text-xs font-medium text-slate-500">{label}</p><p className={`mt-2 text-2xl font-semibold tracking-tight ${accent ? "text-blue-700" : "text-slate-900"}`}>{value}</p><p className="mt-1 text-xs text-slate-400">{detail}</p></div>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-5 py-7 text-center"><div className="mx-auto flex size-10 items-center justify-center rounded-2xl bg-white text-sm font-semibold text-slate-400 shadow-sm">—</div><h3 className="mt-3 text-sm font-semibold text-slate-800">{title}</h3><p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-slate-500">{body}</p></div>;
}
