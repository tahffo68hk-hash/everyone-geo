"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useProjectContext } from "@/components/project-context";
import { EmptyState, ErrorState, LoadingSkeleton, Pagination, StatusBadge } from "@/components/ui";
import { friendlyError } from "@/lib/labels";
import {
  listChannelCapabilities,
  listChannelConnections,
  listContentAssets,
  listContentDrafts,
  listPublications,
  uploadContentAsset,
  listContentStrategies,
  getContentStrategy,
  generateContentStrategy,
  updateContentPlanItem,
  createDraftFromPlanItem,
  listContentCampaigns,
  type Asset,
  type Capability,
  type Connection,
  type Draft,
  type DraftStatus,
  type PublicationListItem,
  type PublicationStatus,
  type ContentStrategy,
  type ContentPlanItem,
  type ContentCampaign,
} from "@/lib/content-api";
import { ProductionQueueView } from "@/components/content/production-queue-view";
import { ContentCalendarView } from "@/components/content/content-calendar-view";
import { CampaignWorkspaceView } from "@/components/content/campaign-workspace-view";
import { CreateCampaignModal } from "@/components/content/create-campaign-modal";
import { OutcomeWorkspaceView } from "@/components/content/outcome-workspace/outcome-workspace-view";
import { DistributionWorkbench } from "@/components/content/distribution/distribution-workbench";
import { AiActionButton } from "@/components/ai/ai-action-button";
import { AiGenerationModal } from "@/components/ai/ai-generation-modal";
import {
  draftAiStrategy,
  generateAiOutline,
  type AiResponseMeta,
} from "@/lib/ai-api";

const statusLabel: Record<string, string> = {
  DRAFT: "草稿",
  READY_FOR_REVIEW: "待审核",
  CHANGES_REQUESTED: "需要修改",
  APPROVED: "已批准",
  REJECTED: "已拒绝",
  PUBLISHED: "已发布",
  ARCHIVED: "已归档",
};

const channelLabel: Record<string, string> = {
  XIAOHONGSHU: "小红书",
  DOUYIN: "抖音",
  WEIBO: "微博",
  WECHAT: "微信",
  WECHAT_OFFICIAL_ACCOUNT: "微信公众号",
  BILIBILI: "Bilibili",
  BAIDU: "百度",
  OTHER: "其他",
};

const publicationStatuses: Array<[PublicationStatus | "", string]> = [
  ["", "全部发布"],
  ["PENDING", "等待中"],
  ["QUEUED", "排队中"],
  ["PUBLISHING", "发布中"],
  ["PUBLISHED", "已发布"],
  ["FAILED", "失败"],
];

const platformNameMap: Record<string, { label: string; color: string }> = {
  WECHAT_OFFICIAL_ACCOUNT: { label: "微信公众号", color: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  WECHAT: { label: "微信公众号", color: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  XIAOHONGSHU: { label: "小红书", color: "bg-rose-100 text-rose-800 border-rose-300" },
  BILIBILI: { label: "Bilibili", color: "bg-sky-100 text-sky-800 border-sky-300" },
  DOUYIN: { label: "抖音", color: "bg-slate-800 text-white border-slate-700" },
  WEIBO: { label: "微博", color: "bg-amber-100 text-amber-800 border-amber-300" },
};

export default function ContentWorkspacePage() {
  const { projectId } = useProjectContext();
  const searchParams = useSearchParams();

  // Tab 状态：operations (M9B 运营执行), strategy (M9A 战略与计划), drafts (草稿与资产库), distribution (多平台分发), verification (M10E 效果验证与归因)
  const tabParam = searchParams.get("tab");
  const initialTab =
    tabParam === "strategy"
      ? "strategy"
      : tabParam === "drafts"
      ? "drafts"
      : tabParam === "distribution"
      ? "distribution"
      : tabParam === "verification"
      ? "verification"
      : "operations";
  const [activeTab, setActiveTab] = useState<"operations" | "strategy" | "drafts" | "distribution" | "verification">(initialTab);

  // 运营执行二级视图状态 (queue / calendar / campaigns)
  const initialOpView =
    tabParam === "calendar" ? "calendar" : tabParam === "campaigns" ? "campaigns" : "queue";
  const [opView, setOpView] = useState<"queue" | "calendar" | "campaigns">(initialOpView);
  const [targetCampaignId, setTargetCampaignId] = useState<string | undefined>(
    searchParams.get("campaignId") || undefined
  );

  // 运营战役状态
  const [campaigns, setCampaigns] = useState<ContentCampaign[]>([]);
  const [showCreateCampaignModal, setShowCreateCampaignModal] = useState(false);
  const [createCampaignStrategy, setCreateCampaignStrategy] = useState<ContentStrategy | null>(null);

  // 草稿与发布执行状态
  const [rows, setRows] = useState<Draft[]>([]);
  const [status, setStatus] = useState<DraftStatus | "">("");
  const [publications, setPublications] = useState<PublicationListItem[]>([]);
  const [pubTotal, setPubTotal] = useState(0);
  const [pubPage, setPubPage] = useState(1);
  const [pubStatus, setPubStatus] = useState<PublicationStatus | "">("");
  const [pubChannel, setPubChannel] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetType, setAssetType] = useState<Asset["type"]>("IMAGE");
  const [assetFile, setAssetFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [caps, setCaps] = useState<Capability[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // M9A 内容战略与生产计划状态
  const [strategies, setStrategies] = useState<ContentStrategy[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(searchParams.get("strategyId"));
  const [selectedStrategy, setSelectedStrategy] = useState<ContentStrategy | null>(null);
  const [loadingStrategy, setLoadingStrategy] = useState(false);
  const [showNewStrategyModal, setShowNewStrategyModal] = useState(false);
  const [customGuidance, setCustomGuidance] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [targetEntityInput, setTargetEntityInput] = useState("");
  const [generatingStrategy, setGeneratingStrategy] = useState(false);
  const [creatingDraftId, setCreatingDraftId] = useState<string | null>(null);

  interface StrategyDraftData {
    objective: string;
    priorityQuestions: string[];
    targetAudiences: string[];
    contentDirections: Array<{ name: string; description: string; targetChannels: string[] }>;
    successObservationPlan: string[];
    risks: string[];
  }

  interface OutlineData {
    outline: Array<{ section: string; subpoints: string[]; intentToSatisfy: string }>;
  }

  // AI 战略与大纲辅助状态
  const [strategyAiModalOpen, setStrategyAiModalOpen] = useState(false);
  const [strategyAiLoading, setStrategyAiLoading] = useState(false);
  const [strategyAiError, setStrategyAiError] = useState<string | null>(null);
  const [strategyAiMetadata, setStrategyAiMetadata] = useState<AiResponseMeta | null>(null);
  const [strategyDraftResult, setStrategyDraftResult] = useState<StrategyDraftData | null>(null);

  const [outlineAiModalOpen, setOutlineAiModalOpen] = useState(false);
  const [outlineAiLoading, setOutlineAiLoading] = useState(false);
  const [outlineAiError, setOutlineAiError] = useState<string | null>(null);
  const [outlineAiMetadata, setOutlineAiMetadata] = useState<AiResponseMeta | null>(null);
  const [outlineResult, setOutlineResult] = useState<OutlineData | null>(null);
  const [activeOutlineItemTitle, setActiveOutlineItemTitle] = useState<string>("");

  async function handleTriggerStrategyAi() {
    if (!projectId) return;
    setStrategyAiModalOpen(true);
    setStrategyAiLoading(true);
    setStrategyAiError(null);
    try {
      const res = await draftAiStrategy(projectId, {
        currentGoal: "提升品牌在生成式大模型评测中的推荐意图覆盖与权威事实引用",
        businessContext: "多平台内容矩阵",
      });
      setStrategyDraftResult(res.data);
      setStrategyAiMetadata(res);
    } catch (err: any) {
      setStrategyAiError(err?.message || "AI 战略规划生成失败");
    } finally {
      setStrategyAiLoading(false);
    }
  }

  async function handleTriggerOutlineAi(item: ContentPlanItem) {
    if (!projectId) return;
    setActiveOutlineItemTitle(item.title);
    setOutlineAiModalOpen(true);
    setOutlineAiLoading(true);
    setOutlineAiError(null);
    try {
      const res = await generateAiOutline(projectId, {
        topic: item.title,
        targetQuery: item.targetQueries?.[0] || item.title,
        platform: item.platform,
        angle: item.objective,
      });
      setOutlineResult(res.data);
      setOutlineAiMetadata(res);
    } catch (err: any) {
      setOutlineAiError(err?.message || "AI 大纲生成失败");
    } finally {
      setOutlineAiLoading(false);
    }
  }

  // 加载草稿与发布数据
  async function loadDraftsData() {
    if (!projectId) return;
    try {
      const [drafts, capabilities, links, pub, assetPage] = await Promise.all([
        listContentDrafts(projectId, status || undefined),
        listChannelCapabilities(),
        listChannelConnections(projectId),
        listPublications(projectId, {
          page: pubPage,
          pageSize: 10,
          status: pubStatus || undefined,
          channel: (pubChannel || undefined) as Capability["channel"] | undefined,
        }),
        listContentAssets(projectId),
      ]);
      setRows(drafts);
      setCaps(capabilities);
      setConnections(links);
      setPublications(pub.items);
      setPubTotal(pub.total);
      setAssets(assetPage.items);
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  // 加载战略列表
  async function loadStrategiesData() {
    if (!projectId) return;
    try {
      const res = await listContentStrategies(projectId);
      setStrategies(res.strategies);
      if (!selectedStrategyId && res.strategies.length > 0) {
        setSelectedStrategyId(res.strategies[0].id);
      }
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  // 加载战役列表
  async function loadCampaignsData() {
    if (!projectId) return;
    try {
      const data = await listContentCampaigns(projectId);
      setCampaigns(data);
    } catch (err) {
      console.error("加载运营战役失败", err);
    }
  }

  // 加载特定战略详情
  async function loadSelectedStrategy(id: string) {
    setLoadingStrategy(true);
    setError("");
    try {
      const strat = await getContentStrategy(id);
      setSelectedStrategy(strat);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoadingStrategy(false);
    }
  }

  // 跨 Tab 联动导航辅助函数
  function handleNavigateToQueue(campaignId?: string) {
    if (campaignId) setTargetCampaignId(campaignId);
    setActiveTab("operations");
    setOpView("queue");
  }

  function handleNavigateToCalendar(campaignId?: string) {
    if (campaignId) setTargetCampaignId(campaignId);
    setActiveTab("operations");
    setOpView("calendar");
  }

  function handleNavigateToCampaigns(campaignId?: string) {
    if (campaignId) setTargetCampaignId(campaignId);
    setActiveTab("operations");
    setOpView("campaigns");
  }

  function handleNavigateToStrategy(strategyId?: string) {
    if (strategyId) {
      setSelectedStrategyId(strategyId);
    }
    setActiveTab("strategy");
  }

  function handleOpenCreateCampaign(strategy?: ContentStrategy) {
    setCreateCampaignStrategy(
      strategy || selectedStrategy || (strategies.length > 0 ? strategies[0] : null)
    );
    setShowCreateCampaignModal(true);
  }

  useEffect(() => {
    async function init() {
      if (!projectId) return;
      setLoading(true);
      setError("");
      await Promise.all([loadDraftsData(), loadStrategiesData(), loadCampaignsData()]);
      setLoading(false);
    }
    void init();
  }, [projectId, status, pubPage, pubStatus, pubChannel]);

  useEffect(() => {
    if (selectedStrategyId) {
      void loadSelectedStrategy(selectedStrategyId);
    }
  }, [selectedStrategyId]);

  const counts = useMemo(
    () =>
      rows.reduce<Record<string, number>>((acc, row) => {
        acc[row.status] = (acc[row.status] ?? 0) + 1;
        return acc;
      }, {}),
    [rows]
  );

  async function upload() {
    if (!projectId || !assetFile) return;
    setUploading(true);
    setError("");
    try {
      await uploadContentAsset(projectId, { type: assetType, file: assetFile });
      setAssetFile(null);
      await loadDraftsData();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setUploading(false);
    }
  }

  // 生成新战略
  async function handleGenerateNewStrategy() {
    if (!projectId) return;
    setGeneratingStrategy(true);
    setError("");
    setSuccessMsg("");
    try {
      const strat = await generateContentStrategy(projectId, {
        title: customTitle.trim() || undefined,
        customGuidance: customGuidance.trim() || undefined,
        targetEntity: targetEntityInput.trim() || undefined,
      });
      setShowNewStrategyModal(false);
      setCustomTitle("");
      setCustomGuidance("");
      setTargetEntityInput("");
      setSuccessMsg(`已成功生成 GEO 内容战略与生产计划（包含 ${strat.planItems?.length || 5} 个平台生产计划）！`);
      await loadStrategiesData();
      setSelectedStrategyId(strat.id);
      setSelectedStrategy(strat);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setGeneratingStrategy(false);
    }
  }

  // 从计划项一键生成草稿
  async function handleCreateDraftFromPlan(item: ContentPlanItem) {
    if (!selectedStrategy) return;
    setCreatingDraftId(item.id);
    setError("");
    setSuccessMsg("");
    try {
      const res = await createDraftFromPlanItem(selectedStrategy.id, item.id);
      setSuccessMsg(
        res.reused
          ? `已关联现有草稿「${res.draft.title}」，可点击直接前往编辑。`
          : `已成功从计划项「${item.title}」生成首版结构化草稿，包含核心事实与正文大纲！`
      );
      // 局部更新当前战略中的该项状态
      setSelectedStrategy((prev) => {
        if (!prev || !prev.planItems) return prev;
        return {
          ...prev,
          planItems: prev.planItems.map((p) => (p.id === item.id ? res.planItem : p)),
        };
      });
      await loadDraftsData();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setCreatingDraftId(null);
    }
  }

  // 更新计划项状态
  async function handleStatusChange(item: ContentPlanItem, newStatus: string) {
    if (!selectedStrategy) return;
    try {
      const updated = await updateContentPlanItem(selectedStrategy.id, item.id, {
        status: newStatus as any,
      });
      setSelectedStrategy((prev) => {
        if (!prev || !prev.planItems) return prev;
        return {
          ...prev,
          planItems: prev.planItems.map((p) => (p.id === item.id ? updated : p)),
        };
      });
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 sm:p-8">
        <LoadingSkeleton rows={8} />
      </main>
    );
  }

  if (error && !rows.length && !strategies.length) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 sm:p-8">
        <ErrorState title="无法加载内容工作台" error={error} retry={() => void loadDraftsData()} />
      </main>
    );
  }

  return (
    <main className="space-y-5">
      <div className="space-y-5">
        {/* 顶栏 Header */}
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200/80 pb-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">内容运营与执行工作台</h1>
              <span className="status-badge status-active text-xs">
                内容运营中心
              </span>
            </div>
            <p className="mt-1 text-xs sm:text-sm text-slate-500 max-w-2xl leading-relaxed">
              从 GEO 诊断与战略规划驱动日常运营战役、内容排期日历与生产队列，实现闭环内容生产与事实核验。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <AiActionButton
              label="AI 辅助战略提案"
              loading={strategyAiLoading}
              variant="secondary"
              onClick={() => void handleTriggerStrategyAi()}
            />
            <button
              type="button"
              onClick={() => handleOpenCreateCampaign()}
              className="ui-button primary text-xs"
            >
              新建运营战役
            </button>
            <button
              type="button"
              onClick={() => setShowNewStrategyModal(true)}
              className="ui-button secondary text-xs"
            >
              生成内容战略
            </button>
            <Link href="/app/content/new" className="ui-button secondary text-xs">
              创建单篇草稿
            </Link>
          </div>
        </header>

        {/* 提示消息 */}
        {error && (
          <div role="alert" className="surface p-3 text-xs text-rose-800 border-rose-200 bg-rose-50/80">
            {error}
          </div>
        )}
        {successMsg && (
          <div role="status" className="surface p-3 text-xs text-teal-800 border-teal-200 bg-teal-50/80">
            {successMsg}
          </div>
        )}

        {/* Tab 导航切换 */}
        <div className="flex border-b border-slate-200 gap-1">
          <button
            type="button"
            onClick={() => setActiveTab("operations")}
            className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
              activeTab === "operations"
                ? "border-teal-700 text-teal-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            运营执行
            <span className="ml-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {campaigns.length} 战役
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("strategy")}
            className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
              activeTab === "strategy"
                ? "border-teal-700 text-teal-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            战略与生产计划
            <span className="ml-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {strategies.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("drafts")}
            className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
              activeTab === "drafts"
                ? "border-teal-700 text-teal-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            草稿与资产库 ({rows.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("distribution")}
            className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
              activeTab === "distribution"
                ? "border-teal-700 text-teal-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            多平台分发
            <span className="ml-1.5 rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700 border border-teal-200">
              自动+人工
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("verification")}
            className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
              activeTab === "verification"
                ? "border-teal-700 text-teal-800"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            效果验证与归因
          </button>
        </div>

        {/* TAB 0: 运营执行 (M9B) */}
        {activeTab === "operations" && (
          <div className="space-y-6">
            {/* 运营执行二级视图切换 */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-100/80 p-1.5">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setOpView("queue")}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    opView === "queue"
                      ? "bg-white text-indigo-700 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  今日生产队列
                </button>
                <button
                  type="button"
                  onClick={() => setOpView("calendar")}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    opView === "calendar"
                      ? "bg-white text-indigo-700 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  内容生产日历
                </button>
                <button
                  type="button"
                  onClick={() => setOpView("campaigns")}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    opView === "campaigns"
                      ? "bg-white text-indigo-700 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  运营战役全景
                </button>
              </div>
            </div>

            {/* 三种子视图 */}
            {opView === "queue" && (
              <ProductionQueueView
                projectId={projectId}
                campaigns={campaigns}
                onNavigateToCampaigns={handleNavigateToCampaigns}
                onNavigateToCalendar={handleNavigateToCalendar}
                onNavigateToStrategy={handleNavigateToStrategy}
              />
            )}

            {opView === "calendar" && (
              <ContentCalendarView
                projectId={projectId}
                campaigns={campaigns}
                initialCampaignId={targetCampaignId}
                onNavigateToQueue={handleNavigateToQueue}
                onNavigateToCampaigns={handleNavigateToCampaigns}
                onNavigateToStrategy={handleNavigateToStrategy}
              />
            )}

            {opView === "campaigns" && (
              <CampaignWorkspaceView
                projectId={projectId}
                campaigns={campaigns}
                initialCampaignId={targetCampaignId}
                onRefreshCampaigns={loadCampaignsData}
                onNavigateToQueue={handleNavigateToQueue}
                onNavigateToCalendar={handleNavigateToCalendar}
                onNavigateToStrategy={handleNavigateToStrategy}
                onOpenCreateCampaign={() => handleOpenCreateCampaign()}
              />
            )}
          </div>
        )}

        {/* TAB 1: GEO 战略与生产计划 (M9A) */}
        {activeTab === "strategy" && (
          <div className="space-y-6">
            {strategies.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
                
                <h3 className="mt-3 text-base font-semibold text-slate-900">尚未生成内容战略与生产计划</h3>
                <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                  回答“用户为什么要生成这篇内容”：从 GEO 缺口分析出发，自动形成涵盖 9 大战略问题与多平台落地的生产计划。
                </p>
                <div className="mt-5">
                  <button
                    type="button"
                    onClick={() => setShowNewStrategyModal(true)}
                    className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-800"
                  >
                    生成首份内容战略与计划
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-4">
                {/* 左侧：战略选择栏 */}
                <aside className="space-y-3 lg:col-span-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      项目内容战略清单
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowNewStrategyModal(true)}
                      className="text-xs text-indigo-700 hover:underline"
                    >
                      + 新增战略
                    </button>
                  </div>
                  <div className="space-y-2">
                    {strategies.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelectedStrategyId(s.id)}
                        className={`w-full rounded-lg border p-3.5 text-left transition-all ${
                          selectedStrategyId === s.id
                            ? "border-indigo-600 bg-indigo-50/50 shadow-xs"
                            : "border-slate-200 bg-white hover:border-slate-300"
                        }`}
                      >
                        <p className="line-clamp-2 text-xs font-semibold text-slate-900">{s.title}</p>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                          <span>{new Date(s.createdAt).toLocaleDateString("zh-CN")}</span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
                            {s.planItemCount ?? 5} 个生产计划
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </aside>

                {/* 右侧：战略 9 大维度与内容生产计划 */}
                <div className="space-y-6 lg:col-span-3">
                  {loadingStrategy ? (
                    <div className="rounded-lg border border-slate-200 bg-white p-6">
                      <LoadingSkeleton rows={6} />
                    </div>
                  ) : selectedStrategy ? (
                    <>
                      {/* 战略概览 Banner */}
                      <section className="rounded-lg border border-indigo-100 bg-linear-to-r from-indigo-50/70 via-white to-indigo-50/30 p-6 shadow-xs">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <span className="inline-flex items-center gap-1 rounded bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-800">
                              GEO 战略方案
                            </span>
                            <h2 className="text-xl font-bold text-slate-900">{selectedStrategy.title}</h2>
                            <p className="text-xs text-slate-500">
                              创建于 {new Date(selectedStrategy.createdAt).toLocaleString("zh-CN")} · 状态：
                              <span className="font-semibold text-emerald-700">{selectedStrategy.status}</span>
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleOpenCreateCampaign(selectedStrategy)}
                              className="inline-flex items-center rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-indigo-800"
                            >
                              转化为运营战役 (Campaign)
                            </button>
                            {selectedStrategy.sourceOpportunityId && (
                              <Link
                                href={`/app/opportunities/${selectedStrategy.sourceOpportunityId}`}
                                className="ui-button secondary compact"
                              >
                                查看关联优化机会 →
                              </Link>
                            )}
                          </div>
                        </div>
                      </section>

                      {/* 9 大战略问题全解析 (The 9 Strategic Pillars) */}
                      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-xs">
                        <h3 className="border-b border-slate-100 pb-3 text-base font-bold text-slate-900">
                          战略九问核心解答 (The 9 Strategic Pillars)
                        </h3>

                        {/* 1. 当前 GEO 缺口 */}
                        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
                          <p className="text-xs font-bold text-amber-900">1. 当前 GEO 缺口是什么？ (GEO Gap)</p>
                          <p className="mt-1.5 text-xs leading-relaxed text-amber-950">{selectedStrategy.geoGap}</p>
                        </div>

                        {/* 2. 最值得通过内容解决的问题 */}
                        <div className="space-y-2">
                          <p className="text-xs font-bold text-slate-800">
                            2. 哪些问题最值得通过内容解决？ (Priority Questions)
                          </p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {selectedStrategy.priorityQuestions?.map((q, idx) => (
                              <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-slate-900">{q.question}</span>
                                  <span
                                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                      q.urgency === "P0"
                                        ? "bg-red-100 text-red-800"
                                        : q.urgency === "P1"
                                        ? "bg-amber-100 text-amber-800"
                                        : "bg-blue-100 text-blue-800"
                                    }`}
                                  >
                                    {q.urgency}
                                  </span>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                                  <span>意图：{q.intent}</span>
                                  <span>·</span>
                                  <span>引擎：{q.targetEngines?.join(", ") || "主流 LLM"}</span>
                                </div>
                                <p className="mt-1 text-[11px] text-slate-600">{q.rationale}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* 3 & 4. 目标受众与心智目标 */}
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                            <p className="text-xs font-bold text-slate-800">3. 目标受众是谁？ (Target Audience)</p>
                            <p className="mt-1.5 text-xs leading-relaxed text-slate-700">
                              {selectedStrategy.targetAudience}
                            </p>
                          </div>
                          <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-4">
                            <p className="text-xs font-bold text-indigo-900">
                              4. 内容应该建立什么心智认知？ (Perception Goal)
                            </p>
                            <p className="mt-1.5 text-xs leading-relaxed text-indigo-950">
                              {selectedStrategy.perceptionGoal}
                            </p>
                          </div>
                        </div>

                        {/* 5. 核心覆盖主题 */}
                        <div className="space-y-2">
                          <p className="text-xs font-bold text-slate-800">5. 应该覆盖哪些主题？ (Key Themes)</p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {selectedStrategy.keyThemes?.map((t, idx) => (
                              <div key={idx} className="rounded-lg border border-slate-200 p-3 text-xs">
                                <p className="font-semibold text-slate-900">{t.theme}</p>
                                <p className="mt-0.5 text-slate-600">{t.focus}</p>
                                <ul className="mt-1.5 list-inside list-disc text-[11px] text-slate-500">
                                  {t.outlinePoints?.map((p, pIdx) => (
                                    <li key={pIdx}>{p}</li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* 6 & 7. 平台优先级与推荐形式 */}
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
                            <p className="text-xs font-bold text-slate-800">
                              6. 平台优先级与角色分工 (Platform Priorities)
                            </p>
                            <div className="space-y-2">
                              {selectedStrategy.platformPriorities?.map((p, idx) => {
                                const style = platformNameMap[p.platform] || {
                                  label: p.platformLabel || p.platform,
                                  color: "bg-slate-100 text-slate-800 border-slate-200",
                                };
                                return (
                                  <div key={idx} className="rounded border border-slate-200 bg-white p-2 text-xs">
                                    <div className="flex items-center justify-between">
                                      <span
                                        className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${style.color}`}
                                      >
                                        优先级 P{p.priority} · {style.label}
                                      </span>
                                      <span className="text-[10px] text-slate-500">{p.role}</span>
                                    </div>
                                    <p className="mt-1 text-[11px] text-slate-600">{p.rationale}</p>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
                            <p className="text-xs font-bold text-slate-800">7. 推荐内容形式 (Content Formats)</p>
                            <div className="space-y-2">
                              {selectedStrategy.contentFormats?.map((f, idx) => (
                                <div key={idx} className="rounded border border-slate-200 bg-white p-2 text-xs">
                                  <div className="flex items-center justify-between">
                                    <span className="font-semibold text-slate-900">
                                      {platformNameMap[f.platform]?.label || f.platform} · {f.format}
                                    </span>
                                    <span className="text-[10px] text-slate-500">{f.recommendedLength}</span>
                                  </div>
                                  <p className="mt-0.5 text-[11px] text-slate-500">结构：{f.structuralTemplate}</p>
                                  <p className="text-[11px] text-slate-600">语调：{f.tone}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* 8 & 9. 事实证据与验证指标 */}
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                            <p className="text-xs font-bold text-slate-800">8. 所需事实与依据 (Evidence Required)</p>
                            <ul className="mt-2 space-y-1.5 text-xs text-slate-700">
                              {selectedStrategy.evidenceRequired?.map((e, idx) => (
                                <li key={idx} className="flex items-start gap-2">
                                  <span className="font-bold text-emerald-600">✓</span>
                                  <div>
                                    <p>{e.claim}</p>
                                    {e.sourceRef && <p className="text-[10px] text-slate-500">依据：{e.sourceRef}</p>}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                            <p className="text-xs font-bold text-slate-800">9. 成功验证指标 (Validation Metrics)</p>
                            <ul className="mt-2 space-y-2 text-xs text-slate-700">
                              {selectedStrategy.validationMetrics?.map((m, idx) => (
                                <li key={idx} className="rounded border border-slate-200 bg-white p-2">
                                  <p className="font-semibold text-slate-900">{m.metric}</p>
                                  <p className="text-emerald-700">目标：{m.target}</p>
                                  <p className="text-[10px] text-slate-500">
                                    方式：{m.evaluationMethod} · 周期：{m.timeframe}
                                  </p>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </section>

                      {/* 具体生产落地计划 (Content Plan Items) */}
                      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-xs">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                          <div>
                            <h3 className="text-base font-bold text-slate-900">
                              落地内容生产计划 (Content Production Plan)
                            </h3>
                            <p className="text-xs text-slate-500">
                              明确平台分工、内容形式、生产目的与 GEO 目标；支持一键生成对应草稿并进入创作闭环。
                            </p>
                          </div>
                          <span className="text-xs text-slate-500">
                            共 {selectedStrategy.planItems?.length || 0} 项生产排期
                          </span>
                        </div>

                        <div className="space-y-4">
                          {selectedStrategy.planItems?.map((item) => {
                            const pStyle = platformNameMap[item.platform] || {
                              label: item.platform,
                              color: "bg-slate-100 text-slate-800 border-slate-200",
                            };
                            return (
                              <div
                                key={item.id}
                                className="rounded-lg border border-slate-200 bg-slate-50/50 p-5 transition-all hover:border-slate-300 hover:bg-white"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="space-y-1.5">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span
                                        className={`rounded border px-2 py-0.5 text-xs font-bold ${pStyle.color}`}
                                      >
                                        {pStyle.label}
                                      </span>
                                      <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                                        {item.format}
                                      </span>
                                      <span
                                        className={`rounded px-2 py-0.5 text-xs font-semibold ${
                                          item.status === "DRAFTED"
                                            ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                            : item.status === "READY"
                                            ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                            : item.status === "FACT_INPUT_REQUIRED"
                                            ? "bg-red-100 text-red-800 border border-red-300"
                                            : item.status === "ASSET_INPUT_REQUIRED"
                                            ? "bg-amber-100 text-amber-800 border border-amber-300"
                                            : item.status === "IN_PRODUCTION"
                                            ? "bg-blue-100 text-blue-800 border border-blue-300"
                                            : item.status === "COMPLETED"
                                            ? "bg-blue-100 text-blue-800 border border-blue-300"
                                            : "bg-slate-200 text-slate-700 border border-slate-300"
                                        }`}
                                      >
                                        {item.status === "DRAFTED"
                                          ? "已生成草稿"
                                          : item.status === "READY"
                                          ? "可生成内容"
                                          : item.status === "FACT_INPUT_REQUIRED"
                                          ? "缺少事实依据"
                                          : item.status === "ASSET_INPUT_REQUIRED"
                                          ? "需要视频素材"
                                          : item.status === "IN_PRODUCTION"
                                          ? "制作中"
                                          : item.status === "COMPLETED"
                                          ? "已发布"
                                          : "计划中"}
                                      </span>
                                      {item.metadata?.opportunityCount && item.metadata.opportunityCount > 1 && (
                                        <span className="rounded border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
                                          📌 聚类关联 {item.metadata.opportunityCount} 个机会
                                        </span>
                                      )}
                                    </div>
                                    <h4 className="text-base font-bold text-slate-900">{item.title}</h4>
                                  </div>

                                    {/* 操作按钮：一键生成草稿 或 查看已生成草稿 或 阻断禁用 */}
                                  <div className="flex items-center gap-2">
                                    <AiActionButton
                                      label="AI 拟定大纲"
                                      loading={outlineAiLoading && activeOutlineItemTitle === item.title}
                                      variant="secondary"
                                      onClick={() => void handleTriggerOutlineAi(item)}
                                    />
                                    {item.draftId ? (
                                      <Link
                                        href={`/app/content/${item.draftId}`}
                                        className="ui-button primary compact"
                                      >
                                        查看草稿与变体 →
                                      </Link>
                                    ) : item.status === "FACT_INPUT_REQUIRED" ? (
                                      <button
                                        type="button"
                                        disabled
                                        className="cursor-not-allowed rounded-lg bg-slate-200 px-3.5 py-1.5 text-xs font-bold text-slate-500 shadow-xs"
                                        title="该计划缺少关键核实事实，请先在知识库中补充事实依据"
                                      >
                                        需要补充事实依据
                                      </button>
                                    ) : item.status === "ASSET_INPUT_REQUIRED" ? (
                                      <button
                                        type="button"
                                        disabled
                                        className="cursor-not-allowed rounded-lg bg-amber-100 px-3.5 py-1.5 text-xs font-bold text-amber-800 shadow-xs"
                                        title="该视频计划缺少实拍视频素材，请先上传物料"
                                      >
                                        需要视频素材
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled={creatingDraftId === item.id}
                                        onClick={() => void handleCreateDraftFromPlan(item)}
                                        className="rounded-lg bg-indigo-700 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-indigo-800 disabled:opacity-50"
                                      >
                                        {creatingDraftId === item.id ? "正在派生草稿…" : "以此计划生成草稿"}
                                      </button>
                                    )}
                                    <select
                                      aria-label="变更计划状态"
                                      value={item.status}
                                      onChange={(e) => void handleStatusChange(item, e.target.value)}
                                      className="rounded-lg border border-slate-300 bg-white p-1 text-xs text-slate-600"
                                    >
                                      <option value="READY">可生成内容</option>
                                      <option value="FACT_INPUT_REQUIRED">缺少事实</option>
                                      <option value="ASSET_INPUT_REQUIRED">缺少素材</option>
                                      <option value="PLANNED">计划中</option>
                                      <option value="IN_PRODUCTION">制作中</option>
                                      <option value="COMPLETED">已完成</option>
                                      <option value="DISMISSED">已废弃</option>
                                    </select>
                                  </div>
                                </div>

                                {/* 准入理由与缺失告警 */}
                                {item.metadata?.platformEligibilityReason && (
                                  <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/50 p-2.5 text-xs">
                                    <span className="font-semibold text-indigo-900">平台入选理由：</span>
                                    <span className="text-indigo-950">{item.metadata.platformEligibilityReason}</span>
                                  </div>
                                )}

                                {item.metadata?.missingFacts && item.metadata.missingFacts.length > 0 && (
                                  <div className="mt-2 rounded-lg border border-red-200 bg-red-50/60 p-2.5 text-xs text-red-800">
                                    <span className="font-bold text-red-900">缺少事实依据：</span>
                                    <span>{item.metadata.missingFacts.join("、")}（请在知识库中补充核验事实以解锁生成）</span>
                                  </div>
                                )}

                                {item.metadata?.missingAssets && item.metadata.missingAssets.length > 0 && (
                                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 text-xs text-amber-800">
                                    <span className="font-bold text-amber-900">缺少前置物料：</span>
                                    <span>需要实拍或分镜视频素材（请在素材库中上传物料）</span>
                                  </div>
                                )}

                                <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                                    <span className="font-semibold text-slate-700">📌 生产目的：</span>
                                    <p className="mt-0.5 text-slate-600">{item.objective}</p>
                                  </div>
                                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                                    <span className="font-semibold text-slate-700">GEO 目标：</span>
                                    <p className="mt-0.5 text-slate-600">{item.geoTarget}</p>
                                  </div>
                                </div>

                                {item.targetQueries && item.targetQueries.length > 0 && (
                                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
                                    <span className="text-slate-400">目标词：</span>
                                    {item.targetQueries.map((q, qIdx) => (
                                      <span
                                        key={qIdx}
                                        className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700"
                                      >
                                        {q}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    </>
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                      请从左侧选择一份内容战略进行查看。
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: 草稿与发布执行 (保留既有所有能力) */}
        {activeTab === "drafts" && (
          <div className="space-y-6">
            <section className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-500">内容草稿</p>
                <p className="mt-1 text-2xl font-semibold">{rows.length}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-500">已连接账号</p>
                <p className="mt-1 text-2xl font-semibold">
                  {connections.filter((c) => c.status === "CONNECTED").length}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs text-slate-500">渠道能力</p>
                <p className="mt-1 text-sm font-medium">
                  {caps.length ? `${caps.length} 个渠道，均为模拟发布` : "能力信息待加载"}
                </p>
              </div>
            </section>

            <section className="flex flex-wrap gap-2">
              {[
                ["", "全部内容"],
                ["DRAFT", "草稿"],
                ["READY_FOR_REVIEW", "待审核"],
                ["CHANGES_REQUESTED", "需要修改"],
                ["APPROVED", "已批准"],
                ["PUBLISHED", "已发布"],
                ["ARCHIVED", "已归档"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatus(key as DraftStatus | "")}
                  className={`rounded-lg px-3 py-1.5 text-xs ${
                    status === key
                      ? "bg-slate-900 text-white"
                      : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {label}
                  {key && <span className="ml-1 opacity-70">{counts[key] ?? 0}</span>}
                </button>
              ))}
            </section>

            {rows.length === 0 ? (
              <EmptyState
                title={status ? `暂无${statusLabel[status] ?? "符合条件的"}内容` : "还没有内容草稿"}
                description="从战略生产计划一键生成草稿，或先创建一份人工内容草稿开始执行。"
                href="/app/content/new"
                action="创建内容草稿"
              />
            ) : (
              <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full min-w-[900px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-100 text-left text-xs text-slate-500">
                      <th className="px-4 py-3">标题</th>
                      <th className="px-4 py-3">渠道</th>
                      <th className="px-4 py-3">来源</th>
                      <th className="px-4 py-3">状态</th>
                      <th className="px-4 py-3">最新版本</th>
                      <th className="px-4 py-3">更新时间</th>
                      <th className="px-4 py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <Link href={`/app/content/${row.id}`} className="font-medium text-blue-700 hover:underline">
                            {row.title}
                          </Link>
                          <p className="text-xs text-slate-400">{row.topic ?? "未设置主题"}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-600">发布时选择</td>
                        <td className="px-4 py-3 text-slate-500">
                          {row.sourceStrategyId ? (
                            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700">
                              战略计划
                            </span>
                          ) : row.sourceOpportunityId ? (
                            "优化机会"
                          ) : row.sourceRecommendationId ? (
                            "建议"
                          ) : row.sourceDiagnosisId ? (
                            "诊断"
                          ) : (
                            "人工创建"
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {row.latestRevision ? `v${row.latestRevision.version}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {new Date(row.updatedAt).toLocaleString("zh-CN", { hour12: false })}
                        </td>
                        <td className="px-4 py-3">
                          <Link href={`/app/content/${row.id}`} className="text-xs text-blue-700 hover:underline">
                            查看详情
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* 发布列表 */}
            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">发布列表</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    项目范围内的真实 Publication 数据；Mock 发布会明确标识。
                  </p>
                </div>
                <div className="flex gap-2">
                  <select
                    aria-label="发布状态"
                    value={pubStatus}
                    onChange={(e) => {
                      setPubPage(1);
                      setPubStatus(e.target.value as PublicationStatus | "");
                    }}
                    className="rounded-lg border border-slate-300 p-2 text-xs"
                  >
                    {publicationStatuses.map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="发布渠道"
                    value={pubChannel}
                    onChange={(e) => {
                      setPubPage(1);
                      setPubChannel(e.target.value);
                    }}
                    className="rounded-lg border border-slate-300 p-2 text-xs"
                  >
                    <option value="">全部渠道</option>
                    {caps.map((c) => (
                      <option key={c.channel} value={c.channel}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {publications.length ? (
                <>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[900px] text-sm">
                      <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
                        <tr>
                          <th className="px-3 py-2">渠道</th>
                          <th className="px-3 py-2">状态</th>
                          <th className="px-3 py-2">Draft / Revision</th>
                          <th className="px-3 py-2">账号连接</th>
                          <th className="px-3 py-2">创建时间</th>
                          <th className="px-3 py-2">发布结果</th>
                        </tr>
                      </thead>
                      <tbody>
                        {publications.map((p) => (
                          <tr key={p.id} className="border-b border-slate-100 last:border-0">
                            <td className="px-3 py-2">{channelLabel[p.channel] ?? p.channel}</td>
                            <td className="px-3 py-2">
                              <StatusBadge status={p.status} />
                              {p.isMock && (
                                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">
                                  模拟发布
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <Link href={`/app/content/${p.draftId}`} className="text-blue-700 hover:underline">
                                {p.draftId.slice(0, 8)}…
                              </Link>
                              <span className="ml-1 text-xs text-slate-500">· {p.revisionId.slice(0, 8)}…</span>
                            </td>
                            <td className="px-3 py-2 text-xs">{p.accountConnection.displayName}</td>
                            <td className="px-3 py-2 text-xs text-slate-500">
                              {new Date(p.createdAt).toLocaleString("zh-CN", { hour12: false })}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {p.publishedAt
                                ? new Date(p.publishedAt).toLocaleString("zh-CN", { hour12: false })
                                : "—"}
                              {p.externalUrl && (
                                <a className="ml-2 text-blue-700 hover:underline" href={p.externalUrl}>
                                  模拟链接
                                </a>
                              )}
                              <Link className="ml-2 text-blue-700 hover:underline" href={`/app/content/publications/${p.id}`}>
                                详情
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pagination page={pubPage} pageSize={10} total={pubTotal} onChange={setPubPage} />
                </>
              ) : (
                <p className="mt-4 text-sm text-slate-500">暂无符合条件的发布任务。</p>
              )}
            </section>

            {/* 素材管理 */}
            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">开发环境素材</h2>
                  <p className="mt-1 text-xs text-slate-500">素材仅保存于开发环境；不会承诺生产对象存储持久化。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    aria-label="素材类型"
                    value={assetType}
                    onChange={(e) => setAssetType(e.target.value as Asset["type"])}
                    className="rounded-lg border border-slate-300 p-2 text-xs"
                  >
                    <option value="IMAGE">图片</option>
                    <option value="VIDEO">视频</option>
                    <option value="COVER">封面</option>
                    <option value="AUDIO">音频</option>
                  </select>
                  <input
                    aria-label="选择素材"
                    type="file"
                    onChange={(e) => setAssetFile(e.target.files?.[0] ?? null)}
                    className="max-w-56 text-xs"
                  />
                  <button
                    type="button"
                    disabled={!assetFile || uploading}
                    onClick={() => void upload()}
                    className="ui-button"
                  >
                    {uploading ? "上传中…" : "上传素材"}
                  </button>
                </div>
              </div>
              {assets.length ? (
                <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                  {assets.map((a) => (
                    <li key={a.id} className="rounded-lg border border-slate-200 p-3 text-xs">
                      <span className="font-medium">{a.type}</span> · {a.mimeType} · {(a.sizeBytes / 1024).toFixed(1)} KB · 已上传
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-slate-500">
                  暂无素材；选择文件后上传，后端会执行 MIME 与大小校验。
                </p>
              )}
            </section>
          </div>
        )}

        {/* 模态弹窗：一键生成新内容战略与计划 */}
        {showNewStrategyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-bold text-slate-900">生成 GEO 内容战略与生产计划</h3>
                <button
                  type="button"
                  onClick={() => setShowNewStrategyModal(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              </div>

              <div className="mt-4 space-y-3.5 text-xs">
                <div>
                  <label className="font-semibold text-slate-700">战略方案标题（可选）</label>
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="例如：智能洁足机品类权威认知与避坑内容生产战略"
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-xs"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700">目标实体 / 品牌（可选）</label>
                  <input
                    type="text"
                    value={targetEntityInput}
                    onChange={(e) => setTargetEntityInput(e.target.value)}
                    placeholder="缺省自动继承当前项目目标实体"
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-xs"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700">专项业务指导 / 重点诉求（可选）</label>
                  <textarea
                    rows={3}
                    value={customGuidance}
                    onChange={(e) => setCustomGuidance(e.target.value)}
                    placeholder="例如：重点突出 43dB 超静音与食品级抑菌硅胶，重点攻克‘宠物回家怎么洗脚’搜索词"
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-xs"
                  />
                </div>

                <div className="rounded-lg bg-indigo-50/60 p-3 text-[11px] text-indigo-950 leading-relaxed">
                  <strong>引擎自动处理</strong>：系统将全面聚合项目 Verified Facts、GEO
                  缺口数据与多模型检索结果，自动输出 9 大战略问题解答，并制定覆盖微信公众号、小红书、B站、抖音、微博的 5 平台落地生产计划。
                </div>
              </div>

              <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  disabled={generatingStrategy}
                  onClick={() => setShowNewStrategyModal(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={generatingStrategy}
                  onClick={() => void handleGenerateNewStrategy()}
                  className="rounded-lg bg-indigo-700 px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-indigo-800 disabled:opacity-50"
                >
                  {generatingStrategy ? "正在综合分析与生成…" : "立即生成战略与计划"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB: 多平台分发中心 */}
        {activeTab === "distribution" && (
          <DistributionWorkbench projectId={projectId} />
        )}

        {/* TAB 3: 效果验证与归因 (M10E) */}
        {activeTab === "verification" && (
          <OutcomeWorkspaceView
            projectId={projectId}
            initialAssetId={searchParams.get("assetId") || undefined}
          />
        )}

        {/* 实例化运营战役弹窗 (M9B) */}
        <CreateCampaignModal
          strategies={strategies}
          initialStrategyId={createCampaignStrategy?.id}
          isOpen={showCreateCampaignModal}
          onClose={() => setShowCreateCampaignModal(false)}
          onCreated={async (newCampaign) => {
            setShowCreateCampaignModal(false);
            setSuccessMsg(`已成功创建运营战役「${newCampaign.name}」！`);
            await loadCampaignsData();
            setTargetCampaignId(newCampaign.id);
            setActiveTab("operations");
            setOpView("campaigns");
          }}
        />

        {/* AI 辅助战略规划预览弹窗 */}
        <AiGenerationModal
          isOpen={strategyAiModalOpen}
          onClose={() => setStrategyAiModalOpen(false)}
          title="AI 辅助战略提案生成"
          description="战略规划"
          loading={strategyAiLoading}
          error={strategyAiError}
          meta={strategyAiMetadata}
          onRegenerate={() => void handleTriggerStrategyAi()}
          applyLabel="采纳并填入战略方案生成器"
          onApply={() => {
            if (strategyDraftResult) {
              setCustomTitle(strategyDraftResult.objective ? `GEO内容战略：${strategyDraftResult.objective}` : "");
              setCustomGuidance(
                `目标：${strategyDraftResult.objective}\n\n受众：${strategyDraftResult.targetAudiences?.join("、") || ""}\n\n重点问题：\n${strategyDraftResult.priorityQuestions?.map((q) => `· ${q}`).join("\n") || ""}`
              );
              setShowNewStrategyModal(true);
            }
            setStrategyAiModalOpen(false);
          }}
        >
          {strategyDraftResult && (
            <div className="space-y-4 text-xs">
              <div className="rounded-lg bg-indigo-50/70 p-3.5 border border-indigo-200/80">
                <div className="font-bold text-indigo-950 mb-1">战略目标 (Strategic Objective)</div>
                <p className="text-indigo-900 leading-relaxed">{strategyDraftResult.objective}</p>
              </div>

              {strategyDraftResult.priorityQuestions?.length > 0 && (
                <div className="rounded-lg bg-slate-50 p-3 border border-slate-200 space-y-1">
                  <span className="font-semibold text-slate-800">优先级战略问题：</span>
                  <ul className="list-disc list-inside space-y-0.5 text-slate-700">
                    {strategyDraftResult.priorityQuestions.map((q: string, i: number) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
              )}

              {strategyDraftResult.contentDirections?.length > 0 && (
                <div className="space-y-2">
                  <span className="font-semibold text-slate-800">推荐内容矩阵方向：</span>
                  {strategyDraftResult.contentDirections.map((dir: { name: string; description: string; targetChannels: string[] }, idx: number) => (
                    <div key={idx} className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">{dir.name}</span>
                        <div className="flex gap-1">
                          {dir.targetChannels?.map((ch: string, cIdx: number) => (
                            <span key={cIdx} className="rounded bg-slate-100 px-1 py-0.2 text-[10px] text-slate-600">
                              {ch}
                            </span>
                          ))}
                        </div>
                      </div>
                      <p className="mt-1 text-slate-600 text-[11px]">{dir.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </AiGenerationModal>

        {/* AI 内容大纲预览弹窗 */}
        <AiGenerationModal
          isOpen={outlineAiModalOpen}
          onClose={() => setOutlineAiModalOpen(false)}
          title={`AI 内容大纲拟定 · ${activeOutlineItemTitle}`}
          description="内容生产大纲"
          loading={outlineAiLoading}
          error={outlineAiError}
          meta={outlineAiMetadata}
          onRegenerate={() => {
            const currentItem = selectedStrategy?.planItems?.find((p) => p.title === activeOutlineItemTitle);
            if (currentItem) void handleTriggerOutlineAi(currentItem);
          }}
          applyLabel="确认并以此大纲推进"
          onApply={() => {
            setOutlineAiModalOpen(false);
            setSuccessMsg(`已完成「${activeOutlineItemTitle}」的 AI 大纲拟定，可直接点击「以此计划生成草稿」进入编辑创作。`);
          }}
        >
          {outlineResult && (
            <div className="space-y-4 text-xs">
              {outlineResult.outline?.length > 0 && (
                <div className="space-y-2.5">
                  <span className="font-semibold text-slate-800">推荐分节大纲与意图满足：</span>
                  {outlineResult.outline.map((sec: { section: string; subpoints: string[]; intentToSatisfy: string }, idx: number) => (
                    <div key={idx} className="rounded-lg border border-slate-200 bg-white p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">{sec.section}</span>
                        {sec.intentToSatisfy && (
                          <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700 font-medium">
                            满足意图: {sec.intentToSatisfy}
                          </span>
                        )}
                      </div>
                      {sec.subpoints?.length > 0 && (
                        <ul className="list-disc list-inside text-slate-600 text-[11px] pl-1 space-y-0.5 mt-1">
                          {sec.subpoints.map((pt: string, pIdx: number) => (
                            <li key={pIdx}>{pt}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </AiGenerationModal>
      </div>
    </main>
  );
}

