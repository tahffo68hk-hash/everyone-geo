"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  getContentCampaign,
  updateContentCampaign,
  generateCampaignCalendar,
  startScheduleItemProduction,
  type ContentCampaign,
  type ContentScheduleItem,
  type CampaignStatus,
} from "@/lib/content-api";
import {
  CampaignStatusBadge,
  ProductionStatusBadge,
  PlatformBadge,
} from "./production-status-badge";
import { LoadingSkeleton, EmptyState } from "@/components/ui";
import { friendlyError } from "@/lib/labels";
import { EditScheduleModal } from "./edit-schedule-modal";

interface CampaignWorkspaceViewProps {
  projectId: string;
  campaigns: ContentCampaign[];
  onRefreshCampaigns: () => Promise<void>;
  onNavigateToQueue: (campaignId?: string) => void;
  onNavigateToCalendar: (campaignId?: string) => void;
  onNavigateToStrategy: (strategyId?: string) => void;
  onOpenCreateCampaign: () => void;
  initialCampaignId?: string;
}

export function CampaignWorkspaceView({
  projectId,
  campaigns,
  onRefreshCampaigns,
  onNavigateToQueue,
  onNavigateToCalendar,
  onNavigateToStrategy,
  onOpenCreateCampaign,
  initialCampaignId,
}: CampaignWorkspaceViewProps) {
  const router = useRouter();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(
    initialCampaignId || (campaigns.length > 0 ? campaigns[0].id : "")
  );

  const [campaignDetail, setCampaignDetail] = useState<ContentCampaign | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [generatingCalendar, setGeneratingCalendar] = useState(false);
  const [startingProductionItemId, setStartingProductionItemId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // 排期编辑弹窗
  const [editingItem, setEditingItem] = useState<ContentScheduleItem | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // 初始化选择
  useEffect(() => {
    if (!selectedCampaignId && campaigns.length > 0) {
      setSelectedCampaignId(campaigns[0].id);
    }
  }, [campaigns, selectedCampaignId]);

  // 加载战役详情
  async function loadDetail(id: string) {
    if (!id) {
      setCampaignDetail(null);
      return;
    }
    setLoadingDetail(true);
    setError("");
    try {
      const data = await getContentCampaign(id);
      setCampaignDetail(data);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    if (selectedCampaignId) {
      void loadDetail(selectedCampaignId);
    }
  }, [selectedCampaignId]);

  // 修改战役状态
  async function handleStatusChange(newStatus: CampaignStatus) {
    if (!selectedCampaignId) return;
    setUpdatingStatus(true);
    setError("");
    setSuccessMsg("");
    try {
      await updateContentCampaign(selectedCampaignId, { status: newStatus });
      setSuccessMsg(`战役状态已更新为「${newStatus === "ACTIVE" ? "执行中" : newStatus === "PAUSED" ? "已暂停" : "已完成"}」`);
      await onRefreshCampaigns();
      await loadDetail(selectedCampaignId);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setUpdatingStatus(false);
    }
  }

  // 自动生成日历排期
  async function handleGenerateCalendar() {
    if (!selectedCampaignId) return;
    setGeneratingCalendar(true);
    setError("");
    setSuccessMsg("");
    try {
      await generateCampaignCalendar(selectedCampaignId, {
        pacingStrategy: "WORKDAYS_ONLY",
        maxItemsPerDay: 2,
        timezone: "Asia/Shanghai",
      });
      setSuccessMsg("已成功为该战役规划工作日节奏的内容排期！");
      await loadDetail(selectedCampaignId);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setGeneratingCalendar(false);
    }
  }

  // 开始生产
  async function handleStartProduction(itemId: string) {
    setStartingProductionItemId(itemId);
    setError("");
    setSuccessMsg("");
    try {
      const res = await startScheduleItemProduction(itemId);
      const draftId = res.draft?.id;
      if (draftId) {
        router.push(`/app/content/${draftId}`);
      } else {
        setSuccessMsg("生产已启动");
        await loadDetail(selectedCampaignId);
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setStartingProductionItemId(null);
    }
  }

  // 全局概览统计
  const overallStats = useMemo(() => {
    let active = 0;
    let completed = 0;
    for (const c of campaigns) {
      if (c.status === "ACTIVE") active++;
      if (c.status === "COMPLETED") completed++;
    }
    return {
      totalCampaigns: campaigns.length,
      activeCampaigns: active,
      completedCampaigns: completed,
    };
  }, [campaigns]);

  if (campaigns.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
        <span className="text-3xl">🚀</span>
        <h3 className="mt-3 text-base font-semibold text-slate-900">尚未创建任何运营战役 (Campaign)</h3>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
          运营战役是将 GEO 内容战略落地为日常内容生产队列与日历的关键载体。请基于已有的内容战略一键实例化战役。
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <button
            type="button"
            onClick={onOpenCreateCampaign}
            className="ui-button primary text-xs"
          >
            新建首个运营战役
          </button>
          <button
            type="button"
            onClick={() => onNavigateToStrategy()}
            className="ui-button secondary text-xs"
          >
            查看内容战略库
          </button>
        </div>
      </div>
    );
  }

  const progress = campaignDetail?.progress;
  const scheduleItems = campaignDetail?.scheduleItems || [];

  const completionPercentage = progress
    ? Math.round((progress.completionRate ?? 0) * 100)
    : 0;
  const blockedTotal = (progress?.blockedFacts ?? 0) + (progress?.blockedAssets ?? 0);
  const approvedAndDone =
    (progress?.done ?? 0) +
    (progress?.readyToPublish ?? 0) +
    (progress?.approved ?? 0);

  return (
    <div className="space-y-6">
      {/* 顶部总体指标与操作栏 */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <span className="text-[11px] font-semibold text-slate-400 uppercase">战役总数</span>
            <p className="text-xl font-bold text-slate-900">{overallStats.totalCampaigns}</p>
          </div>
          <div className="border-l border-slate-200 pl-6">
            <span className="text-[11px] font-semibold text-emerald-600 uppercase">执行中战役</span>
            <p className="text-xl font-bold text-emerald-700">{overallStats.activeCampaigns}</p>
          </div>
          <div className="border-l border-slate-200 pl-6">
            <span className="text-[11px] font-semibold text-slate-500 uppercase">已完成战役</span>
            <p className="text-xl font-bold text-slate-600">{overallStats.completedCampaigns}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenCreateCampaign}
            className="ui-button primary text-xs"
          >
            新建运营战役
          </button>
        </div>
      </div>

      {/* 消息提示 */}
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

      {/* 主体两栏布局：左侧战役列表，右侧战役全景与生产项 */}
      <div className="grid gap-6 lg:grid-cols-4">
        {/* 左侧：战役列表导航 */}
        <aside className="space-y-3 lg:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              运营战役列表 ({campaigns.length})
            </span>
          </div>

          <div className="space-y-2">
            {campaigns.map((c) => {
              const isSelected = c.id === selectedCampaignId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCampaignId(c.id)}
                  className={`w-full rounded-xl border p-3.5 text-left transition-all ${
                    isSelected
                      ? "border-teal-600 bg-teal-50/50 shadow-xs"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="line-clamp-1 text-xs font-bold text-slate-900">{c.name}</h4>
                    <CampaignStatusBadge status={c.status} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] text-slate-500">
                    {c.objective || c.description || "无战役描述"}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                    <span>
                      {c.startDate?.slice(0, 10)} ~ {c.endDate?.slice(0, 10)}
                    </span>
                    <span>{c.scheduleItems?.length ?? 0} 生产项</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* 右侧：战役全景看板 */}
        <div className="space-y-6 lg:col-span-3">
          {loadingDetail ? (
            <LoadingSkeleton rows={5} />
          ) : !campaignDetail ? (
            <EmptyState title="请选择左侧战役查看全景" description="从战役列表选择即可查看生产进度、日历排期与执行细则。" />
          ) : (
            <>
              {/* 战役基本信息 Banner */}
              <section className="surface p-6 bg-linear-to-r from-teal-50/40 via-white to-slate-50/20">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold text-slate-900">{campaignDetail.name}</h2>
                      <CampaignStatusBadge status={campaignDetail.status} />
                    </div>
                    <p className="text-xs text-slate-600">{campaignDetail.description || campaignDetail.objective}</p>
                    <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-slate-500">
                      <span>
                        执行周期：<strong>{campaignDetail.startDate?.slice(0, 10)}</strong> 至{" "}
                        <strong>{campaignDetail.endDate?.slice(0, 10)}</strong>
                      </span>
                      <span>·</span>
                      <span>
                        创建时间：{new Date(campaignDetail.createdAt).toLocaleDateString("zh-CN")}
                      </span>
                    </div>
                  </div>

                  {/* 状态操作与流转按钮 */}
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={campaignDetail.status}
                      disabled={updatingStatus}
                      onChange={(e) => handleStatusChange(e.target.value as CampaignStatus)}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-2xs hover:bg-slate-50 focus:border-teal-600 focus:outline-hidden"
                    >
                      <option value="ACTIVE">执行中</option>
                      <option value="PAUSED">已暂停</option>
                      <option value="COMPLETED">已完成</option>
                      <option value="ARCHIVED">已归档</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => onNavigateToQueue(campaignDetail.id)}
                      className="ui-button primary text-xs"
                    >
                      进入生产队列
                    </button>

                    <button
                      type="button"
                      onClick={() => onNavigateToCalendar(campaignDetail.id)}
                      className="ui-button secondary text-xs"
                    >
                      查看日历排期
                    </button>
                  </div>
                </div>
              </section>

              {/* 战役溯源与 GEO 核心目标 (Lineage & Objective) */}
              <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:grid-cols-2">
                <div className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50/40 p-3.5">
                  <span className="text-[11px] font-bold text-amber-900 uppercase">聚焦的 GEO 核心缺口</span>
                  <p className="text-xs leading-relaxed text-amber-950 font-medium">
                    {campaignDetail.primaryGeoGap}
                  </p>
                </div>

                <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-600 uppercase">战略血统追溯 (Lineage)</span>
                    {campaignDetail.strategyId && (
                      <button
                        type="button"
                        onClick={() => onNavigateToStrategy(campaignDetail.strategyId)}
                        className="text-[11px] text-indigo-700 hover:underline"
                      >
                        查看原始战略 →
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-800">
                    来源战略：{campaignDetail.strategyName || campaignDetail.strategyId || "GEO 核心战略"}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    数据链路：GEO诊断 → 优化建议 → 战略机会 → 9问战略规划 → 运营战役
                  </p>
                </div>
              </section>

              {/* 严谨事实进度指标 (Factual Progress Metrics - NO FAKE AI SCORES) */}
              <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold text-slate-900">
                      📊 战役生产真实进度（事实核验与闭环指标）
                    </h3>
                    {(progress?.overdue ?? 0) > 0 && (
                      <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                        ⚠️ {progress?.overdue} 项逾期
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-bold text-indigo-700">
                    完成度：{completionPercentage}%
                  </span>
                </div>

                {/* 进度条 */}
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-indigo-600 transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(0, completionPercentage))}%` }}
                  />
                </div>

                {/* 指标卡片网格 */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 pt-1">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase">总生产项</span>
                    <p className="text-lg font-bold text-slate-900">{progress?.total ?? 0}</p>
                    <span className="mt-0.5 block text-[10px] text-slate-500">
                      {(progress?.overdue ?? 0) > 0 ? `逾期: ${progress?.overdue}` : "全部已排期"}
                    </span>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 text-center">
                    <span className="text-[10px] font-semibold text-amber-700 uppercase">缺少事实/物料</span>
                    <p className="text-lg font-bold text-amber-800">{blockedTotal}</p>
                    <span className="mt-0.5 block text-[10px] text-amber-600">
                      事实: {progress?.blockedFacts ?? 0} · 素材: {progress?.blockedAssets ?? 0}
                    </span>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 text-center">
                    <span className="text-[10px] font-semibold text-emerald-700 uppercase">就绪可生产</span>
                    <p className="text-lg font-bold text-emerald-800">{progress?.ready ?? 0}</p>
                    <span className="mt-0.5 block text-[10px] text-emerald-600">
                      生产中: {progress?.inProgress ?? 0}
                    </span>
                  </div>
                  <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 text-center">
                    <span className="text-[10px] font-semibold text-blue-700 uppercase">已生成草稿</span>
                    <p className="text-lg font-bold text-blue-800">{progress?.draftCreated ?? 0}</p>
                    <span className="mt-0.5 block text-[10px] text-blue-600">
                      待审核: {progress?.inReview ?? 0}
                    </span>
                  </div>
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 text-center">
                    <span className="text-[10px] font-semibold text-indigo-700 uppercase">审核与完成</span>
                    <p className="text-lg font-bold text-indigo-800">{approvedAndDone}</p>
                    <span className="mt-0.5 block text-[10px] text-indigo-600">
                      完成: {progress?.done ?? 0} · 批准: {progress?.approved ?? 0}
                    </span>
                  </div>
                </div>
              </section>

              {/* 战役排期与生产清单 */}
              <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">
                      📝 战役内容排期清单 ({scheduleItems.length})
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      根据战略中的平台生产计划自动排期，支持人工微调生产状态、日期与时间
                    </p>
                  </div>

                  {scheduleItems.length === 0 && (
                    <button
                      type="button"
                      disabled={generatingCalendar}
                      onClick={handleGenerateCalendar}
                      className="rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-indigo-800 disabled:opacity-50"
                    >
                      {generatingCalendar ? "排期中..." : "✨ 自动生成工作日排期"}
                    </button>
                  )}
                </div>

                {scheduleItems.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center">
                    <p className="text-xs text-slate-500">该战役暂未生成具体生产排期</p>
                    <button
                      type="button"
                      disabled={generatingCalendar}
                      onClick={handleGenerateCalendar}
                      className="mt-3 rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
                    >
                      点击生成初始排期
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                    {scheduleItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex flex-wrap items-center justify-between gap-3 p-3.5 hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <PlatformBadge platform={item.planItem?.platform || "WECHAT"} />
                          <div>
                            <p className="text-xs font-bold text-slate-900">
                              {item.planItem?.title || "未命名排期项"}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                              <span>
                                排期日期：{item.scheduledDate?.slice(0, 10)} {item.scheduledTime || "10:00"}
                              </span>
                              <span>·</span>
                              <span>时区：{item.timezone || "Asia/Shanghai"}</span>
                              {item.blockReason && (
                                <>
                                  <span>·</span>
                                  <span className="text-amber-700">⚠️ {item.blockReason}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <ProductionStatusBadge status={item.productionStatus} />
                          <button
                            type="button"
                            onClick={() => {
                              setEditingItem(item);
                              setShowEditModal(true);
                            }}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            调整排期
                          </button>
                          <button
                            type="button"
                            disabled={startingProductionItemId === item.id}
                            onClick={() => handleStartProduction(item.id)}
                            className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                          >
                            {startingProductionItemId === item.id
                              ? "启动中..."
                              : item.productionStatus === "DRAFT_CREATED" ||
                                item.productionStatus === "IN_REVIEW" ||
                                item.productionStatus === "APPROVED" ||
                                item.productionStatus === "READY_TO_PUBLISH" ||
                                item.productionStatus === "DONE"
                              ? "查看草稿"
                              : "立即生产"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      {/* 排期调整弹窗 */}
      <EditScheduleModal
        item={editingItem}
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingItem(null);
        }}
        onSaved={async () => {
          setShowEditModal(false);
          setEditingItem(null);
          setSuccessMsg("生产排期已成功调整");
          if (selectedCampaignId) {
            await loadDetail(selectedCampaignId);
          }
        }}
        onStartProduction={handleStartProduction}
      />
    </div>
  );
}
