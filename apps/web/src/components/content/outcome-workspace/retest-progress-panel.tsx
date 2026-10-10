"use client";

import { deriveRetestProgress } from "../../../lib/retest-progress";
import type { RetestProgressInput, RetestProgressView } from "../../../lib/retest-progress";

export interface RetestProgressPanelProps {
  input: RetestProgressInput;
  error?: string | null;
}

const executionToneClasses: Record<RetestProgressView["tone"], string> = {
  neutral: "bg-slate-100 text-slate-700",
  running: "bg-sky-100 text-sky-800",
  warning: "bg-amber-100 text-amber-900",
  error: "bg-red-100 text-red-800",
  success: "bg-emerald-100 text-emerald-800",
};

/** 展示阶段事实，不暗示复测、结果对比与归因共同完成。 */
export function RetestProgressPanel({ input, error = null }: RetestProgressPanelProps) {
  const progress = deriveRetestProgress(input);
  const visibleError = typeof error === "string" && error.trim() ? error.trim() : null;

  return (
    <section aria-label="复测分阶段进度" aria-live="polite" aria-atomic="false" className="surface space-y-4 rounded-xl border border-slate-200 p-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">复测进度</h3>
        <p className="mt-1 text-xs text-slate-500">执行、对比、归因分别展示；已读取的结果条数不代表整个闭环完成。</p>
      </div>
      <ol className="grid gap-3 md:grid-cols-3">
        <li className="rounded-lg border border-slate-200 p-3">
          <span className={`inline-block rounded-full px-2 py-1 text-xs font-medium ${executionToneClasses[progress.tone]}`}>
            1 · 复测执行
          </span>
          <p className="mt-2 text-sm text-slate-800">{progress.executionLabel}</p>
        </li>
        <li className="rounded-lg border border-slate-200 p-3">
          <span className="inline-block rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
            2 · 结果对比
          </span>
          <p className="mt-2 text-sm text-slate-800">{progress.outcomeLabel}</p>
        </li>
        <li className="rounded-lg border border-slate-200 p-3">
          <span className="inline-block rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
            3 · 结果归因
          </span>
          <p className="mt-2 text-sm text-slate-800">{progress.attributionLabel}</p>
        </li>
      </ol>
      {progress.warnings.length > 0 && (
        <div role="status" className="rounded-lg border border-amber-200 p-3 text-sm text-amber-900">
          <p className="font-medium">需要核验</p>
          <ul className="mt-1 list-inside list-disc space-y-1">
            {progress.warnings.map((warning, index) => (
              <li key={`${index}-${warning}`}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      {visibleError && (
        <div role="alert" className="rounded-lg border border-red-200 p-3 text-sm text-red-800">
          <p className="font-semibold">复测错误</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{visibleError}</p>
        </div>
      )}
    </section>
  );
}
