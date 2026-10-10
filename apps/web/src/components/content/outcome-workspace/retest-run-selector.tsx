"use client";

import React, { useId } from "react";
import type { AssetOutcomeWorkspace } from "../../../lib/outcome-api";

export interface RetestRunSelectorProps {
  runs: AssetOutcomeWorkspace["retestRuns"];
  selectedRunId: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}

function displayText(value: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : "未知";
}

function displaySequence(value: number): string {
  return Number.isSafeInteger(value) && value > 0 ? `第 ${value} 批` : "批次序号未知";
}

/** 仅接受有效的、包含时区信息的 ISO 时间戳，不把坏日期解释为当前时间。 */
function displayRequestedAt(raw: string): string {
  if (typeof raw !== "string") return "时间未知";
  const value = raw.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i.exec(value);
  if (!match) return "时间未知";

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");
  const zone = match[7] ?? "";
  const offset = /^([+-])(\d{2}):(\d{2})$/.exec(zone);
  if (hour > 23 || minute > 59 || second > 59) return "时间未知";
  if (offset && (Number(offset[2]) > 23 || Number(offset[3]) > 59)) return "时间未知";

  const calendar = new Date(0);
  calendar.setUTCHours(0, 0, 0, 0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  ) {
    return "时间未知";
  }

  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return "时间未知";
  try {
    // Keep SSR and the first client render identical across local time zones.
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(timestamp) + " UTC";
  } catch {
    return "时间未知";
  }
}

/** 纯选择器：不自动选择最新批次、不请求数据、不操作复测执行器。 */
export function RetestRunSelector({
  runs,
  selectedRunId,
  onChange,
  disabled = false,
}: RetestRunSelectorProps) {
  const selectId = useId();
  const hasRuns = runs.length > 0;
  const selectedValue =
    selectedRunId !== null && runs.some((run) => run.id === selectedRunId && run.id.length > 0)
      ? selectedRunId
      : "";

  return (
    <div className="space-y-2">
      <label htmlFor={selectId} className="block text-sm font-medium text-slate-800">
        复测批次
      </label>
      <select
        id={selectId}
        aria-label="选择复测批次"
        value={selectedValue}
        onChange={(event) => onChange(event.currentTarget.value || null)}
        disabled={disabled || !hasRuns}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">{hasRuns ? "请选择复测批次" : "暂无复测批次"}</option>
        {runs.map((run) => (
          <option key={run.id} value={run.id} disabled={!run.id}>
            {displaySequence(run.sequence)} · {displayText(run.status)} · {displayText(run.provider)} / {displayText(run.model)} · {displayText(run.sourceType)} · 请求于 {displayRequestedAt(run.requestedAt)}
          </option>
        ))}
      </select>
      {!hasRuns ? (
        <p className="text-xs text-slate-500">当前资产没有可选的复测批次。</p>
      ) : selectedValue === "" ? (
        <p className="text-xs text-slate-500">尚未选择有效批次；请显式选择，不会自动切换到最新批次。</p>
      ) : null}
    </div>
  );
}
