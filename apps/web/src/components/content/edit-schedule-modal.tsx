"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  updateContentScheduleItem,
  type ContentScheduleItem,
  type ProductionStatus,
} from "@/lib/content-api";
import { ProductionStatusBadge, PlatformBadge } from "./production-status-badge";
import { friendlyError } from "@/lib/labels";
import { useProjectContext } from "@/components/project-context";

interface EditScheduleModalProps {
  item:
    | (ContentScheduleItem & {
        campaignName?: string;
        planItem?: any;
      })
    | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  onStartProduction?: (itemId: string) => void;
}

export function EditScheduleModal({
  item,
  isOpen,
  onClose,
  onSaved,
  onStartProduction,
}: EditScheduleModalProps) {
  const { me } = useProjectContext();
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [productionStatus, setProductionStatus] = useState<ProductionStatus>("PLANNED");
  const [assignedToId, setAssignedToId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (item) {
      const d = item.scheduledDate
        ? new Date(item.scheduledDate).toISOString().slice(0, 10)
        : "";
      setScheduledDate(d);
      setScheduledTime(item.scheduledTime || "10:00");
      setTimezone(item.timezone || "Asia/Shanghai");
      setProductionStatus(item.productionStatus);
      setAssignedToId(item.assignedToId || "");
      setError("");
    }
  }, [item]);

  if (!isOpen || !item) return null;

  const currentUserId = me?.user?.id;
  const currentUserName = me?.user?.name || me?.user?.email || "当前操作员";

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    setSaving(true);
    setError("");
    try {
      await updateContentScheduleItem(item.id, {
        scheduledDate: scheduledDate ? new Date(scheduledDate).toISOString() : undefined,
        scheduledTime: scheduledTime || undefined,
        timezone,
        productionStatus,
        assignedToId: assignedToId ? assignedToId : null as any,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  const draftId = item.planItem?.draftId || (item.metadata as any)?.draftId;
  const isReady = item.productionStatus === "READY";
  const isBlocked =
    item.productionStatus === "BLOCKED_FACTS" ||
    item.productionStatus === "BLOCKED_ASSETS";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <PlatformBadge platform={item.planItem?.platform || (item.metadata as any)?.platform || ""} />
              <ProductionStatusBadge status={item.productionStatus} isOverdue={item.isOverdue} />
            </div>
            <h3 id="schedule-modal-title" className="text-base font-bold text-slate-900">
              {item.planItem?.title || (item.metadata as any)?.title || "调整排期项"}
            </h3>
            {item.campaignName && (
              <p className="text-xs text-slate-500">
                所属战役：<span className="font-medium text-slate-700">{item.campaignName}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="关闭弹窗"
          >
            ✕
          </button>
        </div>

        {error && (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* 依赖项提示 */}
        {item.dependsOn && (
          <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 text-xs text-indigo-900">
            <span className="font-semibold">前置依赖：</span>
            <span>
              {item.dependsOn.planItem?.title} ({item.dependsOn.planItem?.platform}) · 状态：{item.dependsOn.productionStatus}
            </span>
          </div>
        )}

        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="scheduled-date-input" className="block text-xs font-semibold text-slate-700">
                计划生产日期
              </label>
              <input
                id="scheduled-date-input"
                type="date"
                required
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-hidden"
              />
            </div>
            <div>
              <label htmlFor="scheduled-time-input" className="block text-xs font-semibold text-slate-700">
                计划时间段
              </label>
              <input
                id="scheduled-time-input"
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-hidden"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="timezone-select" className="block text-xs font-semibold text-slate-700">
                排期时区
              </label>
              <select
                id="timezone-select"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-hidden"
              >
                <option value="Asia/Shanghai">Asia/Shanghai (北京时间)</option>
                <option value="Asia/Tokyo">Asia/Tokyo (东京)</option>
                <option value="UTC">UTC (世界协调时)</option>
              </select>
            </div>
            <div>
              <label htmlFor="assignee-select" className="block text-xs font-semibold text-slate-700">
                指派负责人
              </label>
              <select
                id="assignee-select"
                value={assignedToId}
                onChange={(e) => setAssignedToId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-hidden"
              >
                <option value="">未分配</option>
                {currentUserId && (
                  <option value={currentUserId}>
                    {currentUserName} (我自己)
                  </option>
                )}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="status-select" className="block text-xs font-semibold text-slate-700">
              生产状态
            </label>
            <select
              id="status-select"
              value={productionStatus}
              onChange={(e) => setProductionStatus(e.target.value as ProductionStatus)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-hidden"
            >
              <option value="PLANNED">计划中 (PLANNED)</option>
              <option value="READY">可开始生产 (READY)</option>
              <option value="BLOCKED_FACTS">缺少事实依据 (BLOCKED_FACTS)</option>
              <option value="BLOCKED_ASSETS">缺少素材物料 (BLOCKED_ASSETS)</option>
              <option value="IN_PROGRESS">生产中 (IN_PROGRESS)</option>
              <option value="DRAFT_CREATED">草稿已创建 (DRAFT_CREATED)</option>
              <option value="IN_REVIEW">待审核 (IN_REVIEW)</option>
              <option value="APPROVED">已批准 (APPROVED)</option>
              <option value="READY_TO_PUBLISH">待发布 (READY_TO_PUBLISH)</option>
              <option value="DONE">生产完成 (DONE)</option>
            </select>
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 pt-4">
            <div>
              {draftId ? (
                <Link
                  href={`/app/content/${draftId}`}
                  className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                >
                  📝 进入草稿工作台 →
                </Link>
              ) : isReady && onStartProduction ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onStartProduction(item.id);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 shadow-xs"
                >
                  🚀 立即开始生产
                </button>
              ) : isBlocked ? (
                <span className="text-[11px] text-amber-700 font-medium">
                  ⚠️ 当前受阻，请先补全依据/物料
                </span>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-indigo-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-800 shadow-xs disabled:opacity-50"
              >
                {saving ? "正在保存…" : "保存排期"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
