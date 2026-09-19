"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  getCampaignCalendar,
  generateCampaignCalendar,
  startScheduleItemProduction,
  type ContentScheduleItem,
  type ContentCampaign,
  type CalendarViewResponse,
} from "@/lib/content-api";
import { ProductionStatusBadge, PlatformBadge } from "./production-status-badge";
import { LoadingSkeleton, EmptyState } from "@/components/ui";
import { friendlyError } from "@/lib/labels";
import { EditScheduleModal } from "./edit-schedule-modal";

interface ContentCalendarViewProps {
  projectId: string;
  campaigns: ContentCampaign[];
  initialCampaignId?: string;
  onNavigateToQueue: (campaignId?: string) => void;
  onNavigateToCampaigns: (campaignId?: string) => void;
  onNavigateToStrategy: (strategyId?: string) => void;
}

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function toDateStr(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const WEEKDAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export function ContentCalendarView({
  projectId,
  campaigns,
  initialCampaignId,
  onNavigateToQueue,
  onNavigateToCampaigns,
  onNavigateToStrategy,
}: ContentCalendarViewProps) {
  const router = useRouter();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(
    initialCampaignId || (campaigns.length > 0 ? campaigns[0].id : "")
  );

  const [loading, setLoading] = useState(false);
  const [generatingCalendar, setGeneratingCalendar] = useState(false);
  const [error, setError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [calendarData, setCalendarData] = useState<CalendarViewResponse | null>(null);

  // 周视图当前周的周一
  const [currentWeekMonday, setCurrentWeekMonday] = useState<Date>(() => getMonday(new Date()));

  // 编辑排期弹窗
  const [editingItem, setEditingItem] = useState<ContentScheduleItem | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [startingProductionItemId, setStartingProductionItemId] = useState<string | null>(null);

  // 选中的战役对象
  const currentCampaign = useMemo(
    () => campaigns.find((c) => c.id === selectedCampaignId) || null,
    [campaigns, selectedCampaignId]
  );

  // 当外部 campaigns 变动且无选中时初始化
  useEffect(() => {
    if (!selectedCampaignId && campaigns.length > 0) {
      setSelectedCampaignId(campaigns[0].id);
    }
  }, [campaigns, selectedCampaignId]);

  // 加载日历数据
  async function loadCalendar(campaignId: string) {
    if (!campaignId) {
      setCalendarData(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await getCampaignCalendar(campaignId);
      setCalendarData(res);
      // 如果战役排期包含日期，且当前周完全没有包含任何排期，可自动将视角切换至首个排期所在周
      if (res.items && res.items.length > 0) {
        const firstDateStr = res.items[0].scheduledDate?.slice(0, 10);
        if (firstDateStr) {
          const firstDate = new Date(firstDateStr);
          // 仅在当前周无排期时切到首日周
          const currentMondayStr = toDateStr(currentWeekMonday);
          const sunday = new Date(currentWeekMonday);
          sunday.setDate(sunday.getDate() + 6);
          const sundayStr = toDateStr(sunday);
          if (firstDateStr < currentMondayStr || firstDateStr > sundayStr) {
            setCurrentWeekMonday(getMonday(firstDate));
          }
        }
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (selectedCampaignId) {
      void loadCalendar(selectedCampaignId);
    }
  }, [selectedCampaignId]);

  // 生成初始日历排期
  async function handleGenerateCalendar(pacingStrategy: "WORKDAYS_ONLY" | "DAILY" | "SPREAD" = "WORKDAYS_ONLY") {
    if (!selectedCampaignId) return;
    setGeneratingCalendar(true);
    setError("");
    setActionSuccess("");
    try {
      await generateCampaignCalendar(selectedCampaignId, {
        pacingStrategy,
        maxItemsPerDay: 2,
        timezone: "Asia/Shanghai",
      });
      setActionSuccess("已成功为该战役生成工作日节奏的内容生产日历排期！");
      await loadCalendar(selectedCampaignId);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setGeneratingCalendar(false);
    }
  }

  // 开始生产 (从日历直接启动)
  async function handleStartProduction(itemId: string) {
    setStartingProductionItemId(itemId);
    setError("");
    setActionSuccess("");
    try {
      const res = await startScheduleItemProduction(itemId);
      const draftId = res.draft?.id;
      if (draftId) {
        router.push(`/app/content/${draftId}`);
      } else {
        setActionSuccess("生产任务已启动，正在准备草稿环境");
        if (selectedCampaignId) await loadCalendar(selectedCampaignId);
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setStartingProductionItemId(null);
    }
  }

  // 周导航
  function handlePrevWeek() {
    const prev = new Date(currentWeekMonday);
    prev.setDate(prev.getDate() - 7);
    setCurrentWeekMonday(prev);
  }

  function handleNextWeek() {
    const next = new Date(currentWeekMonday);
    next.setDate(next.getDate() + 7);
    setCurrentWeekMonday(next);
  }

  function handleCurrentWeek() {
    setCurrentWeekMonday(getMonday(new Date()));
  }

  // 计算当前周的 7 天
  const weekDays = useMemo(() => {
    const days: { date: Date; dateStr: string; label: string; isToday: boolean }[] = [];
    const todayStr = toDateStr(new Date());
    for (let i = 0; i < 7; i++) {
      const d = new Date(currentWeekMonday);
      d.setDate(d.getDate() + i);
      const str = toDateStr(d);
      days.push({
        date: d,
        dateStr: str,
        label: `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAY_NAMES[i]}`,
        isToday: str === todayStr,
      });
    }
    return days;
  }, [currentWeekMonday]);

  // 映射当天的数据项
  const itemsByDay = useMemo(() => {
    const map: Record<string, ContentScheduleItem[]> = {};
    weekDays.forEach((w) => {
      map[w.dateStr] = [];
    });
    if (!calendarData?.items) return map;

    for (const item of calendarData.items) {
      const dateStr = item.scheduledDate ? item.scheduledDate.slice(0, 10) : "";
      if (map[dateStr]) {
        map[dateStr].push(item);
      }
    }
    return map;
  }, [calendarData, weekDays]);

  const timezone = calendarData?.timezone || "Asia/Shanghai";
  const hasItems = calendarData?.items && calendarData.items.length > 0;

  if (campaigns.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
        <span className="text-3xl">📅</span>
        <h3 className="mt-3 text-base font-semibold text-slate-900">暂无进行中的运营战役</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
          内容日历必须依托于具体的运营战役 (Campaign)。请先创建运营战役并分配内容生产计划。
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <button
            type="button"
            onClick={() => onNavigateToCampaigns()}
            className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-teal-800"
          >
            🚀 前往运营战役管理
          </button>
          <button
            type="button"
            onClick={() => onNavigateToStrategy()}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            查看内容战略
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 战役选择与操作工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold text-slate-700">所属运营战役：</label>
          <select
            value={selectedCampaignId}
            onChange={(e) => setSelectedCampaignId(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 focus:border-indigo-500 focus:outline-hidden"
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.status === "ACTIVE" ? "进行中" : c.status === "PAUSED" ? "已暂停" : "已完成"})
              </option>
            ))}
          </select>

          {currentCampaign && (
            <div className="hidden items-center gap-2 text-xs text-slate-500 lg:flex">
              <span>周期：{currentCampaign.startDate?.slice(0, 10)} ~ {currentCampaign.endDate?.slice(0, 10)}</span>
              <span>·</span>
              <span>核心缺口：{currentCampaign.primaryGeoGap?.slice(0, 20)}...</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!hasItems && (
            <button
              type="button"
              disabled={generatingCalendar}
              onClick={() => handleGenerateCalendar("WORKDAYS_ONLY")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-indigo-800 disabled:opacity-50"
            >
              {generatingCalendar ? "正在规划节奏..." : "✨ 自动生成工作日排期"}
            </button>
          )}

          {hasItems && (
            <button
              type="button"
              disabled={generatingCalendar}
              onClick={() => handleGenerateCalendar("WORKDAYS_ONLY")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              title="按当前工作日生产节奏重排"
            >
              {generatingCalendar ? "重新排期中..." : "重新排期"}
            </button>
          )}

          <button
            type="button"
            onClick={() => onNavigateToQueue(selectedCampaignId)}
            className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            📋 查看生产队列
          </button>
        </div>
      </div>

      {/* 提示消息 */}
      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800">
          {error}
        </div>
      )}
      {actionSuccess && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800">
          {actionSuccess}
        </div>
      )}

      {/* 时区与排期规则提示条 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-2 text-xs text-indigo-900">
        <div className="flex items-center gap-2">
          <span>🕒</span>
          <span>当前时区：<strong className="font-mono">{timezone}</strong></span>
          <span className="text-indigo-400">|</span>
          <span>排期性质：<strong>内容生产与交付节点</strong>（非平台对外自动发布时间）</span>
        </div>
        <div className="text-[11px] text-indigo-700">
          共收录 {calendarData?.items?.length || 0} 个生产项 · 单日建议最多 2 篇
        </div>
      </div>

      {/* 周切换导航栏 */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrevWeek}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            ← 上一周
          </button>
          <button
            type="button"
            onClick={handleCurrentWeek}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            本周
          </button>
          <button
            type="button"
            onClick={handleNextWeek}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            下一周 →
          </button>
        </div>

        <div className="text-xs font-bold text-slate-800">
          {toDateStr(weekDays[0].date)} 至 {toDateStr(weekDays[6].date)}
        </div>
      </div>

      {/* 日历主体：周视图 7 列 */}
      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8">
          <LoadingSkeleton rows={6} />
        </div>
      ) : !hasItems ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <span className="text-3xl">🗓️</span>
          <h3 className="mt-3 text-base font-semibold text-slate-900">当前战役尚未生成生产日历</h3>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
            自动排期算法会根据战略中的多平台计划，遵循先图文核心事实、后视频衍生内容的节奏自动生成日历排期。
          </p>
          <div className="mt-5">
            <button
              type="button"
              disabled={generatingCalendar}
              onClick={() => handleGenerateCalendar("WORKDAYS_ONLY")}
              className="rounded-lg bg-indigo-700 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-indigo-800 disabled:opacity-50"
            >
              {generatingCalendar ? "排期算法运算中..." : "✨ 一键按工作日节奏生成排期"}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
          {weekDays.map((day) => {
            const dayItems = itemsByDay[day.dateStr] || [];
            return (
              <div
                key={day.dateStr}
                className={`flex min-h-[360px] flex-col rounded-xl border p-2.5 transition-all ${
                  day.isToday
                    ? "border-indigo-500 bg-indigo-50/20 shadow-xs ring-1 ring-indigo-400"
                    : "border-slate-200 bg-white"
                }`}
              >
                {/* 每日表头 */}
                <div className="mb-2 flex items-center justify-between border-b border-slate-100 pb-1.5">
                  <span
                    className={`text-xs font-bold ${
                      day.isToday ? "text-indigo-700" : "text-slate-800"
                    }`}
                  >
                    {day.label}
                  </span>
                  {day.isToday && (
                    <span className="rounded bg-indigo-600 px-1.5 py-0.2 text-[10px] font-bold text-white">
                      今天
                    </span>
                  )}
                </div>

                {/* 每日卡片列表 */}
                <div className="flex-1 space-y-2">
                  {dayItems.length === 0 ? (
                    <div className="flex h-24 items-center justify-center text-[11px] text-slate-400">
                      无生产排期
                    </div>
                  ) : (
                    dayItems.map((item) => {
                      const isBlocked =
                        item.productionStatus === "BLOCKED_FACTS" ||
                        item.productionStatus === "BLOCKED_ASSETS";
                      const isDone = item.productionStatus === "DONE";

                      return (
                        <div
                          key={item.id}
                          onClick={() => {
                            setEditingItem(item);
                            setShowEditModal(true);
                          }}
                          className={`group cursor-pointer rounded-lg border p-2.5 shadow-2xs transition-all hover:border-indigo-400 hover:shadow-xs ${
                            item.isOverdue
                              ? "border-red-300 bg-red-50/50"
                              : isBlocked
                              ? "border-amber-200 bg-amber-50/30"
                              : isDone
                              ? "border-slate-200 bg-slate-50/60 opacity-80"
                              : "border-slate-200 bg-white"
                          }`}
                        >
                          {/* 顶部：平台与时间 */}
                          <div className="flex items-center justify-between gap-1">
                            <PlatformBadge platform={item.planItem?.platform || "WECHAT"} />
                            <span className="font-mono text-[10px] text-slate-500">
                              {item.scheduledTime || "10:00"}
                            </span>
                          </div>

                          {/* 标题 */}
                          <h4 className="mt-1.5 line-clamp-2 text-xs font-bold text-slate-900 group-hover:text-indigo-600">
                            {item.planItem?.title || "未命名生产项"}
                          </h4>

                          {/* 状态徽标 */}
                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            <ProductionStatusBadge status={item.productionStatus} />
                            {item.isOverdue && (
                              <span className="rounded bg-red-100 px-1 py-0.2 text-[10px] font-bold text-red-700">
                                逾期
                              </span>
                            )}
                          </div>

                          {/* 阻断原因简短提示 */}
                          {item.blockReason && isBlocked && (
                            <p className="mt-1.5 line-clamp-1 text-[10px] text-amber-800">
                              ⚠️ {item.blockReason}
                            </p>
                          )}

                          {/* 底部快捷操作 */}
                          <div
                            className="mt-2.5 flex items-center justify-end border-t border-slate-100 pt-1.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              disabled={startingProductionItemId === item.id}
                              onClick={() => handleStartProduction(item.id)}
                              className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-indigo-100 hover:text-indigo-800 disabled:opacity-50"
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
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

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
          setActionSuccess("排期时间与生产状态已成功更新");
          if (selectedCampaignId) {
            await loadCalendar(selectedCampaignId);
          }
        }}
        onStartProduction={handleStartProduction}
      />
    </div>
  );
}
