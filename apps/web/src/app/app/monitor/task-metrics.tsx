"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Metrics = {
  metricVersion: string; analysisVersion: string; totalRuns: number; successfulRuns: number;
  failedRuns: number; cancelledRuns: number; analyzedRuns: number; analysisMissingRuns: number;
  visibilityRate: number | null; recommendationRate: number | null; averageMentionPosition: number | null;
  shareOfVoice: number | null; citationCount: number; citationDomainCount: number;
  sentimentDistribution: { positive: number; neutral: number; negative: number; unknown: number };
  metricSource?: "demo" | "real" | "mixed";
};
const percentage = (value: number | null) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const sourceLabels: Record<string, string> = {
  demo: "Demo 数据（模拟引擎）",
  real: "Real Provider 数据（DeepSeek API · Official API）",
  mixed: "混合任务：指标仅基于真实 Provider，已排除 Demo 数据",
};
export function TaskMetrics({ taskId, taskStatus }: { taskId: string; taskStatus?: string }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let count = 0;
    setMetrics(null); setError(""); setPaused(false);
    async function poll() {
      let shouldPoll = true;
      try {
        const data = await api<Metrics>(`/monitor-tasks/${encodeURIComponent(taskId)}/metrics`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setMetrics(data); setError("");
        const terminal = ["SUCCEEDED", "FAILED", "PARTIAL", "CANCELLED"].includes(taskStatus ?? "");
        shouldPoll = !terminal || data.analysisMissingRuns > 0 || count < 3;
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "无法加载指标。");
      }
      count += 1;
      if (shouldPoll && count < 20) timer = setTimeout(poll, Math.min(2000 * 2 ** Math.floor(count / 4), 15000));
      else if (shouldPoll) setPaused(true);
    }
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [taskId, taskStatus, retry]);
  return <section aria-labelledby="metrics-heading" className="rounded-2xl border border-slate-200 bg-white p-6">
    <div className="flex items-center justify-between gap-4"><h2 id="metrics-heading" className="text-lg font-semibold">任务指标</h2><button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100" onClick={() => setRetry((value) => value + 1)}>刷新指标</button></div>
    <p className="mt-2 text-xs text-slate-500">指标版本：{metrics?.metricVersion ?? "geolens-v1"} · 分析版本：{metrics?.analysisVersion ?? "m4-rule-v1"} · 缺失值显示为 —</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {!metrics && !error && <p role="status" className="mt-3 text-sm">正在加载指标…</p>}
    {paused && <p className="mt-3 text-sm text-amber-800">自动刷新已暂停，可手动刷新获取最新分析结果。</p>}
    {metrics && <>
      {metrics.metricSource && <p className={`mt-3 inline-block rounded px-2 py-0.5 text-xs font-semibold ${metrics.metricSource === "demo" ? "bg-amber-100 text-amber-900" : "bg-blue-100 text-blue-900"}`}>{sourceLabels[metrics.metricSource] ?? metrics.metricSource}</p>}
      <p className="mt-3 text-sm text-slate-600">总运行 {metrics.totalRuns} · 成功 {metrics.successfulRuns} · 失败 {metrics.failedRuns} · 取消 {metrics.cancelledRuns} · 已分析 {metrics.analyzedRuns} · 分析缺失 {metrics.analysisMissingRuns}</p>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">{[["可见率", percentage(metrics.visibilityRate)], ["推荐率", percentage(metrics.recommendationRate)], ["平均提及排名", metrics.averageMentionPosition == null ? "—" : metrics.averageMentionPosition.toFixed(2)], ["SoV（GeoLens 内部指标）", percentage(metrics.shareOfVoice)], ["引用数", metrics.citationCount], ["引用域名数", metrics.citationDomainCount]].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-xl font-semibold">{value}</dd></div>)}</dl>
      <p className="mt-4 text-sm text-slate-600">情感分布：正面 {metrics.sentimentDistribution.positive} · 中性 {metrics.sentimentDistribution.neutral} · 负面 {metrics.sentimentDistribution.negative} · 未知 {metrics.sentimentDistribution.unknown}</p>
    </>}
  </section>;
}
