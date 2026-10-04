"use client";

import React from "react";
import { AiResponseMeta } from "@/lib/ai-api";

interface AiGenerationModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  loading: boolean;
  error?: string | null;
  meta?: AiResponseMeta | null;
  onApply?: () => void;
  onRegenerate?: () => void;
  provider?: "auto" | "deepseek" | "qwen";
  onProviderChange?: (provider: "auto" | "deepseek" | "qwen") => void;
  applyLabel?: string;
  children: React.ReactNode;
}

export function AiGenerationModal({
  isOpen,
  onClose,
  title,
  description,
  loading,
  error,
  meta,
  onApply,
  onRegenerate,
  provider = "auto",
  onProviderChange,
  applyLabel = "应用结果",
  children,
}: AiGenerationModalProps) {
  if (!isOpen) return null;

  const isQwenError = provider === "qwen" && Boolean(error);
  const userFacingError = isQwenError
    ? "通义千问当前无法完成请求。你可以稍后重试，或者切换至 DeepSeek 继续生成。"
    : error;

  return (
    <div className="ai-modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ai-modal-panel flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden border border-slate-200 bg-white">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-teal-700">AI 辅助</span>
              <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            </div>
            {description && <p className="max-w-2xl text-xs leading-5 text-slate-500">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="icon-button" aria-label="关闭">
            ✕
          </button>
        </header>

        {onProviderChange && (
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-2.5">
            <div>
              <p className="text-xs font-medium text-slate-700">生成模型</p>
              <p className="text-[11px] text-slate-500">默认自动选择；模型信息仅作为生成上下文。</p>
            </div>
            <select
              aria-label="AI 模型"
              value={provider}
              onChange={event => onProviderChange(event.target.value as "auto" | "deepseek" | "qwen")}
              disabled={loading}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 disabled:opacity-50"
            >
              <option value="auto">自动选择</option>
              <option value="deepseek">DeepSeek</option>
              <option value="qwen">Qwen</option>
            </select>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-5 text-sm text-slate-700">
          {loading && (
            <div className="py-12 text-center">
              <div className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-teal-700" />
              <p className="mt-3 text-xs text-slate-500">正在生成结构化结果…</p>
            </div>
          )}

          {error && !loading && (
            <div className="flex items-start gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">生成失败</p>
                <p className="mt-0.5 leading-5">{userFacingError}</p>
              </div>
              {isQwenError && onProviderChange && (
                <button type="button" onClick={() => onProviderChange("deepseek")} className="shrink-0 rounded-md border border-red-200 bg-white px-2.5 py-1 font-medium hover:bg-red-50">
                  切换至 DeepSeek
                </button>
              )}
            </div>
          )}

          {!loading && !error && children}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3">
          <div className="min-h-4 text-[11px] text-slate-400">
            {meta && (
              <span>
                {meta.provider} · {meta.model} · {meta.latencyMs}ms{meta.totalTokens ? ` · ${meta.totalTokens} tokens` : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="ui-button secondary" disabled={loading}>取消</button>
            {onRegenerate && (
              <button type="button" onClick={onRegenerate} disabled={loading} className="ui-button secondary">重新生成</button>
            )}
            {onApply && (
              <button type="button" onClick={onApply} disabled={loading || Boolean(error)} className="ui-button primary">{applyLabel}</button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
