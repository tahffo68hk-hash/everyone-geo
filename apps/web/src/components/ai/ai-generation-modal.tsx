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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/80 bg-zinc-900/50">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-6 h-6 rounded bg-indigo-500/10 text-indigo-400 text-xs font-semibold">
              ✦
            </span>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
              {description && (
                <p className="text-xs text-zinc-400 mt-0.5">{description}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* 内容主体区 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-zinc-300 text-sm">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <svg
                className="animate-spin h-6 w-6 text-indigo-400"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <p className="text-xs text-zinc-400">
                正在调用大模型生成结构化结果，请稍候...
              </p>
            </div>
          )}

          {error && !loading && (
            <div className="p-3 bg-red-950/40 border border-red-800/60 rounded-lg text-red-300 text-xs flex items-start gap-2">
              <span className="font-semibold text-red-400">调用失败:</span>
              <span>{userFacingError}</span>
              {isQwenError && onProviderChange && (
                <button
                  type="button"
                  onClick={() => onProviderChange("deepseek")}
                  className="ml-auto shrink-0 rounded-md border border-red-700/70 px-2 py-1 font-medium text-red-200 hover:bg-red-900/50"
                >
                  切换至 DeepSeek
                </button>
              )}
            </div>
          )}

          {!loading && !error && children}
        </div>

        {/* 底部元数据与操作栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800/80 bg-zinc-950/40 text-xs">
          <div className="flex items-center gap-3 text-zinc-500">
            {onProviderChange && (
              <label className="inline-flex items-center gap-1.5 text-zinc-400">
                <span>AI 模型</span>
                <select
                  aria-label="AI 模型"
                  value={provider}
                  onChange={event => onProviderChange(event.target.value as "auto" | "deepseek" | "qwen")}
                  disabled={loading}
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200 disabled:opacity-50"
                >
                  <option value="auto">自动选择</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="qwen">Qwen</option>
                </select>
              </label>
            )}
            {meta && (
              <>
                <span className="inline-flex items-center gap-1 font-mono text-zinc-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  {meta.provider} · {meta.model}
                </span>
                <span>耗时 {meta.latencyMs}ms</span>
                {meta.totalTokens && <span>Tokens: {meta.totalTokens}</span>}
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                disabled={loading}
                className="px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                重新生成
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              取消
            </button>
            {onApply && (
              <button
                type="button"
                onClick={onApply}
                disabled={loading || Boolean(error)}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors disabled:opacity-50"
              >
                {applyLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
