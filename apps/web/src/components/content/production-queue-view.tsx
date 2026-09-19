"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  getProductionQueue,
  startScheduleItemProduction,
  type ContentScheduleItem,
  type ProductionStatus,
  type ContentCampaign,
} from "@/lib/content-api";
import { ProductionStatusBadge, PlatformBadge } from "./production-status-badge";
import { LoadingSkeleton, EmptyState, ErrorState } from "@/components/ui";
import { friendlyError } from "@/lib/labels";
import { EditScheduleModal } from "./edit-schedule-modal";

interface ProductionQueueViewProps {
  projectId: string;
  campaigns: ContentCampaign[];
  onNavigateToCampaigns: (campaignId?: string) => void;
  onNavigateToCalendar: (campaignId?: string) => void;
  onNavigateToStrategy: (strategyId?: string) => void;
}

export function ProductionQueueView({
  projectId,
  campaigns,
  onNavigateToCampaigns,
  onNavigateToCalendar,
  onNavigateToStrategy,
}: ProductionQueueViewProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [queueData, setQueueData] = useState<{
    summary: {
      total: number;
      overdueCount: number;
      blockedCount: number;
      readyCount: number;
      inProgressCount: number;
      doneCount: number;
    };
    items: any[];
  } | null>(null);

  // 筛选状态
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [selectedPlatform, setSelectedPlatform] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [startingProductionItemId, setStartingProductionItemId] = useState<string | null>(null);

  // 排期编辑弹窗
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // 缺失事实详情弹窗
  const [viewingMissingFactsItem, setViewingMissingFactsItem] = useState<any | null>(null);
  // 缺失素材详情弹窗
  const [viewingMissingAssetsItem, setViewingMissingAssetsItem] = useState<any | null>(null);

  async function loadQueue() {
    if (!projectId) return;
    setLoading(true);
    setError("");
    try {
      const res = await getProductionQueue({
        projectId,
        campaignId: selectedCampaignId || undefined,
        platform: selectedPlatform || undefined,
        productionStatus: (selectedStatus as ProductionStatus) || undefined,
        overdueOnly: overdueOnly || undefined,
      });
      setQueueData(res);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadQueue();
  }, [projectId, selectedCampaignId, selectedPlatform, selectedStatus, overdueOnly]);

  // 开始生产 (Start Production -> Draft Workbench)
  async function handleStartProduction(itemId: string) {
    setStartingProductionItemId(itemId);
    setError("");
    setActionSuccess("");
    try {
      const res = await startScheduleItemProduction(itemId);
      const draftId = res.draft?.id;
      if (draftId) {
        // 如果是复用已有草稿，友好提示
        if (res.reused) {
          setActionSuccess("已为您打开该计划项的既有草稿");
        }
        // 直接导航至现有 Content Draft Workbench
        router.push(`/app/content/${draftId}`);
      } else {
        await loadQueue();
      }
    } catch (err: any) {
      setError(friendlyError(err));
    } finally {
      setStartingProductionItemId(null);
    }
  }

  // 视觉分组：逾期 (Overdue) / 今日 (Today) / 接下来 (Upcoming)
  // 严格保留 API 返回的相对确定性顺序
  const groupedSections = useMemo(() => {
    if (!queueData?.items) return { overdue: [], today: [], upcoming: [] };

    const todayStr = new Date().toISOString().slice(0, 10);
    const overdue: any[] = [];
    const today: any[] = [];
    const upcoming: any[] = [];

    for (const item of queueData.items) {
      const itemDateStr = item.scheduledDate
        ? new Date(item.scheduledDate).toISOString().slice(0, 10)
        : "";

      if (item.isOverdue) {
        overdue.push(item);
      } else if (itemDateStr === todayStr) {
        today.push(item);
      } else {
        upcoming.push(item);
      }
    }

    return { overdue, today, upcoming };
  }, [queueData]);

  // 渲染单个队列卡片
  function renderQueueItemCard(item: any) {
    const isStarting = startingProductionItemId === item.id;
    const planItem = item.planItem || {};
    const missingFacts = (planItem.metadata as any)?.missingFacts || [];
    const isVideoPlatform =
      planItem.platform === "BILIBILI" ||
      planItem.platform === "DOUYIN" ||
      (planItem.format && (planItem.format.includes("视频") || planItem.format.includes("脚本")));

    const draftId = planItem.draftId || (item.metadata as any)?.draftId;

    // 核心主按钮 CTA 处理
    let primaryButtonText = item.nextAction || "下一步";
    let primaryButtonAction = () => {};
    let primaryButtonVariant: "primary" | "warning" | "outline" | "disabled" = "outline";

    switch (item.productionStatus) {
      case "BLOCKED_FACTS":
        primaryButtonText = "补充事实依据";
        primaryButtonVariant = "warning";
        primaryButtonAction = () => setViewingMissingFactsItem(item);
        break;
      case "BLOCKED_ASSETS":
        primaryButtonText = isVideoPlatform ? "准备视频素材" : "补充设计素材";
        primaryButtonVariant = "warning";
        primaryButtonAction = () => setViewingMissingAssetsItem(item);
        break;
      case "READY":
        primaryButtonText = "开始生产";
        primaryButtonVariant = "primary";
        primaryButtonAction = () => handleStartProduction(item.id);
        break;
      case "DRAFT_CREATED":
      case "IN_PROGRESS":
        primaryButtonText = "查看草稿";
        primaryButtonVariant = "outline";
        primaryButtonAction = () => {
          if (draftId) router.push(`/app/content/${draftId}`);
        };
        break;
      case "IN_REVIEW":
        primaryButtonText = "去审核";
        primaryButtonVariant = "outline";
        primaryButtonAction = () => {
          if (draftId) router.push(`/app/content/${draftId}`);
        };
        break;
      case "APPROVED":
      case "READY_TO_PUBLISH":
        primaryButtonText = "准备发布";
        primaryButtonVariant = "outline";
        primaryButtonAction = () => {
          if (draftId) router.push(`/app/content/${draftId}`);
        };
        break;
      case "DONE":
        primaryButtonText = "已完成";
        primaryButtonVariant = "disabled";
        primaryButtonAction = () => {
          if (draftId) router.push(`/app/content/${draftId}`);
        };
        break;
      default:
        primaryButtonText = item.nextAction || "查看排期";
        primaryButtonVariant = "outline";
        primaryButtonAction = () => {
          setEditingItem(item);
          setShowEditModal(true);
        };
        break;
    }

    return (
      <div
        key={item.id}
        className={`rounded-2xl border bg-white p-5 transition-all hover:shadow-md ${
          item.isOverdue
            ? "border-red-300 bg-red-50/10"
            : item.productionStatus === "READY"
            ? "border-emerald-200 bg-emerald-50/10"
            : "border-slate-200"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          {/* 左侧：平台、标题与归属 */}
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <PlatformBadge platform={planItem.platform || ""} />
              <ProductionStatusBadge status={item.productionStatus} isOverdue={item.isOverdue} />
              {planItem.format && (
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  {planItem.format}
                </span>
              )}
            </div>

            <h4 className="text-base font-bold text-slate-900 leading-snug">
              {planItem.title || (item.metadata as any)?.title || "未命名生产任务"}
            </h4>

            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
              {item.campaignName && (
                <span>
                  所属战役：
                  <button
                    type="button"
                    onClick={() => onNavigateToCampaigns(item.campaignId)}
                    className="font-medium text-indigo-600 hover:underline"
                  >
                    {item.campaignName}
                  </button>
                </span>
              )}
              <span>·</span>
              <span>
                排期时间：
                <strong className="text-slate-700">
                  {item.scheduledDate ? new Date(item.scheduledDate).toLocaleDateString("zh-CN") : "未排期"}
                  {item.scheduledTime ? ` ${item.scheduledTime}` : ""}
                </strong>
              </span>
              <span>·</span>
              <span>
                负责人：
                <span className="font-medium text-slate-700">
                  {item.assignedToId ? "已指派" : "未分配"}
                </span>
              </span>
            </div>

            {/* 阻断详情高亮条 */}
            {item.productionStatus === "BLOCKED_FACTS" && (
              <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50/80 p-2.5 text-xs text-rose-800">
                <div className="flex items-center gap-1.5 font-semibold">
                  <span aria-hidden="true">🔒</span>
                  <span>缺少关键核验事实依据，无法直接开始生产</span>
                </div>
                {missingFacts.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-[11px] text-rose-700 space-y-0.5">
                    {missingFacts.map((fact: string, idx: number) => (
                      <li key={idx}>{fact}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {item.productionStatus === "BLOCKED_ASSETS" && (
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/80 p-2.5 text-xs text-amber-800">
                <div className="flex items-center gap-1.5 font-semibold">
                  <span aria-hidden="true">⚠️</span>
                  <span>
                    {isVideoPlatform
                      ? "该平台（视频类）需要视频素材前置就绪，当前暂无可用视频资产"
                      : "缺少设计素材物料，无法直接开始生产"}
                  </span>
                </div>
              </div>
            )}

            {/* 依赖前置项 */}
            {item.dependsOn && (
              <div className="mt-1 text-[11px] text-indigo-700 font-medium">
                🔗 前置依赖：{item.dependsOn.planItem?.title} ({item.dependsOn.planItem?.platform}) · 状态：{item.dependsOn.productionStatus}
              </div>
            )}
          </div>

          {/* 右侧：主按钮 Next Action 与辅助操作 */}
          <div className="flex flex-col items-end gap-2">
            <button
              type="button"
              disabled={isStarting || primaryButtonVariant === "disabled"}
              onClick={primaryButtonAction}
              className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold shadow-xs transition-all ${
                primaryButtonVariant === "primary"
                  ? "bg-emerald-600 text-white hover:bg-emerald-700 hover:shadow-sm"
                  : primaryButtonVariant === "warning"
                  ? "border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                  : primaryButtonVariant === "disabled"
                  ? "border border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                  : "border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
              }`}
            >
              {isStarting ? "正在创建草稿…" : primaryButtonText}
              {!isStarting && primaryButtonVariant !== "disabled" && <span aria-hidden="true">→</span>}
            </button>

            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setEditingItem(item);
                  setShowEditModal(true);
                }}
                className="text-slate-500 hover:text-indigo-600 hover:underline"
              >
                调整排期
              </button>
              {item.campaignId && (
                <>
                  <span className="text-slate-300">·</span>
                  <button
                    type="button"
                    onClick={() => onNavigateToCalendar(item.campaignId)}
                    className="text-slate-500 hover:text-indigo-600 hover:underline"
                  >
                    日历视图
                  </button>
                </>
              )}
              {item.strategyId && (
                <>
                  <span className="text-slate-300">·</span>
                  <button
                    type="button"
                    onClick={() => onNavigateToStrategy(item.strategyId)}
                    className="text-slate-500 hover:text-indigo-600 hover:underline"
                  >
                    来源战略
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 顶部指标 Banner */}
      {queueData?.summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="metric-card">
            <span className="metric-label">待生产总数</span>
            <strong className="text-slate-900">{queueData.summary.total}</strong>
            <span className="metric-note">排期计划总量</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">已逾期条目</span>
            <strong className={queueData.summary.overdueCount > 0 ? "text-rose-700" : "text-slate-800"}>
              {queueData.summary.overdueCount}
            </strong>
            <span className="metric-note">
              {queueData.summary.overdueCount > 0 ? "需优先安排生产" : "进度正常"}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">依据/素材阻断</span>
            <strong className={queueData.summary.blockedCount > 0 ? "text-amber-700" : "text-slate-800"}>
              {queueData.summary.blockedCount}
            </strong>
            <span className="metric-note">
              {queueData.summary.blockedCount > 0 ? "需补充事实/物料" : "前置就绪"}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">可开始生产</span>
            <strong className={queueData.summary.readyCount > 0 ? "text-emerald-700" : "text-slate-800"}>
              {queueData.summary.readyCount}
            </strong>
            <span className="metric-note">前置条件完全满足</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">生产推进中</span>
            <strong className={queueData.summary.inProgressCount > 0 ? "text-teal-700" : "text-slate-800"}>
              {queueData.summary.inProgressCount}
            </strong>
            <span className="metric-note">草稿已建/审核中</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">已完成生产</span>
            <strong className="text-slate-700">{queueData.summary.doneCount}</strong>
            <span className="metric-note">已进入发布或复测</span>
          </div>
        </div>
      )}

      {/* 提示消息 */}
      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}
      {actionSuccess && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {actionSuccess}
        </div>
      )}

      {/* 过滤控制栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          {/* 战役选择 */}
          <div>
            <label htmlFor="filter-campaign" className="sr-only">筛选战役</label>
            <select
              id="filter-campaign"
              value={selectedCampaignId}
              onChange={(e) => setSelectedCampaignId(e.target.value)}
              className="w-full max-w-[280px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700"
            >
              <option value="">全部战役</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* 平台选择 */}
          <div>
            <label htmlFor="filter-platform" className="sr-only">筛选平台</label>
            <select
              id="filter-platform"
              value={selectedPlatform}
              onChange={(e) => setSelectedPlatform(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700"
            >
              <option value="">全部平台</option>
              <option value="WECHAT_OFFICIAL_ACCOUNT">微信公众号</option>
              <option value="XIAOHONGSHU">小红书</option>
              <option value="WEIBO">微博</option>
              <option value="BILIBILI">Bilibili</option>
              <option value="DOUYIN">抖音</option>
            </select>
          </div>

          {/* 生产状态选择 */}
          <div>
            <label htmlFor="filter-status" className="sr-only">筛选状态</label>
            <select
              id="filter-status"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700"
            >
              <option value="">全部状态</option>
              <option value="READY">可开始生产 (READY)</option>
              <option value="BLOCKED_FACTS">缺少事实依据 (BLOCKED_FACTS)</option>
              <option value="BLOCKED_ASSETS">缺少素材物料 (BLOCKED_ASSETS)</option>
              <option value="IN_PROGRESS">生产中 (IN_PROGRESS)</option>
              <option value="DRAFT_CREATED">草稿已创建 (DRAFT_CREATED)</option>
              <option value="IN_REVIEW">待审核 (IN_REVIEW)</option>
              <option value="APPROVED">已批准 (APPROVED)</option>
              <option value="DONE">已完成 (DONE)</option>
            </select>
          </div>

          {/* 仅看逾期 Quick Filter */}
          <label className="flex items-center gap-1.5 text-xs font-semibold text-red-700 cursor-pointer">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
              className="rounded text-red-600 focus:ring-red-500"
            />
            <span>仅看已逾期</span>
          </label>
        </div>

        <div className="min-w-0 max-w-full break-words text-xs font-medium text-slate-400">
          按紧急度与优先级严格排序（逾期优先 · 排期升序 · 平台重要度）
        </div>
      </div>

      {/* 队列列表 */}
      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <LoadingSkeleton rows={5} />
        </div>
      ) : queueData?.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <span className="text-3xl" aria-hidden="true">🎉</span>
          <h3 className="mt-3 text-base font-semibold text-slate-900">当前没有需要处理的内容</h3>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
            全部计划项均已推进或暂无待生产条目。您可以从内容战略创建新的营销战役，或在日历中查看整体节奏。
          </p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => onNavigateToCampaigns()}
              className="rounded-lg bg-indigo-700 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-indigo-800"
            >
              查看运营战役
            </button>
            <button
              type="button"
              onClick={() => onNavigateToCalendar()}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50"
            >
              查看内容日历
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* 分组 1: 逾期 (Overdue) */}
          {groupedSections.overdue.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 border-b border-red-200 pb-2">
                <span className="flex h-2.5 w-2.5 rounded-full bg-red-600" aria-hidden="true" />
                <h3 className="text-sm font-bold text-red-900">
                  已逾期待办 ({groupedSections.overdue.length})
                </h3>
                <span className="text-xs text-red-600 font-medium">需要尽快处理或重新调整排期</span>
              </div>
              <div className="space-y-3">
                {groupedSections.overdue.map(renderQueueItemCard)}
              </div>
            </div>
          )}

          {/* 分组 2: 今日 (Today) */}
          {groupedSections.today.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 border-b border-blue-200 pb-2">
                <span className="flex h-2.5 w-2.5 rounded-full bg-blue-600" aria-hidden="true" />
                <h3 className="text-sm font-bold text-blue-900">
                  今日生产安排 ({groupedSections.today.length})
                </h3>
                <span className="text-xs text-blue-600 font-medium">今天建议完成的内容生产任务</span>
              </div>
              <div className="space-y-3">
                {groupedSections.today.map(renderQueueItemCard)}
              </div>
            </div>
          )}

          {/* 分组 3: 接下来 (Upcoming) */}
          {groupedSections.upcoming.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                <span className="flex h-2.5 w-2.5 rounded-full bg-slate-400" aria-hidden="true" />
                <h3 className="text-sm font-bold text-slate-900">
                  排期进行中 ({groupedSections.upcoming.length})
                </h3>
                <span className="text-xs text-slate-500">按战略节奏编排的后续内容生产项</span>
              </div>
              <div className="space-y-3">
                {groupedSections.upcoming.map(renderQueueItemCard)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 排期修改弹窗 */}
      <EditScheduleModal
        item={editingItem}
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingItem(null);
        }}
        onSaved={loadQueue}
        onStartProduction={handleStartProduction}
      />

      {/* 补充事实提示弹窗 */}
      {viewingMissingFactsItem && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-rose-700">
              <span className="text-xl" aria-hidden="true">🔒</span>
              <h3 className="text-base font-bold">缺少关键核验事实依据</h3>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              该计划项受到服务端准入安全保护。AI 写作引擎严禁虚构参数，必须有经核实的事实依据方可生成草稿。
            </p>
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              <span className="font-semibold">当前缺失依据：</span>
              <ul className="mt-1.5 list-disc pl-5 space-y-1 text-[11px]">
                {((viewingMissingFactsItem.planItem?.metadata as any)?.missingFacts || [
                  "未绑定已核实的实验室参数或产品规格事实依据",
                ]).map((fact: string, idx: number) => (
                  <li key={idx}>{fact}</li>
                ))}
              </ul>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              请前往内容战略页面或事实库录入经核实的参数凭证后，系统将自动解锁生产。
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setViewingMissingFactsItem(null)}
                className="rounded-lg border border-slate-200 px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                关闭
              </button>
              {viewingMissingFactsItem.strategyId && (
                <button
                  type="button"
                  onClick={() => {
                    const sId = viewingMissingFactsItem.strategyId;
                    setViewingMissingFactsItem(null);
                    onNavigateToStrategy(sId);
                  }}
                  className="rounded-lg bg-indigo-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-800 shadow-xs"
                >
                  前往战略方案补充 →
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 准备视频素材提示弹窗 */}
      {viewingMissingAssetsItem && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-amber-700">
              <span className="text-xl" aria-hidden="true">🎬</span>
              <h3 className="text-base font-bold">缺少视频素材前置物料</h3>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              平台（如 Bilibili、抖音）强依赖实拍或剪辑视频素材，AI 脚本生产前必须确认物料就绪。
            </p>
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <span className="font-semibold">前置要求：</span>
              <p className="mt-1 text-[11px]">
                请上传至少一条与本主题（{viewingMissingAssetsItem.planItem?.title}）相符的实拍视频或演示样片，然后将排期状态变更为可开始生产。
              </p>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setViewingMissingAssetsItem(null)}
                className="rounded-lg border border-slate-200 px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
