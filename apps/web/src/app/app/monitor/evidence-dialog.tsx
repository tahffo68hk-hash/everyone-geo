"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  EMPTY_TEXT, formatAnalysisStatus, formatEntityType, formatRetrievalMode,
  formatSentiment, formatSourceType, formatStatus, friendlyError, withRaw,
} from "@/lib/labels";
import { FactInterpretation } from "@/components/productization";

type Analysis = {
  id: string; analysisVersion: string; brandMentioned: boolean; mentionPosition: number | null;
  recommended: boolean; sentiment: string; createdAt: string;
  mentions: Array<{ id: string; entityType: string; entityId: string; canonicalName: string; displayName: string; position: number; context: string; sentiment: string; startOffset: number; endOffset: number }>;
  citations: Array<{ id: string; url: string; domain: string; title: string | null; position: number }>;
};
type RunDetail = {
  id: string; status: string; attempt: number; analysisStatus: string; analysisErrorCode: string | null;
  query: { id: string; text: string }; engine: { id: string; key: string; name: string };
  evidence: null | {
    id: string; runId: string; queryText: string; rawPrompt: string; rawResponse: string;
    provider: string; engineKey: string; engineName: string; model: string; modelVersion: string | null;
    requestedModel: string | null; responseModel: string | null; // M6C model identity
    retrievalMode: string; sourceType: string; metadata: unknown; createdAt: string; analyses: Analysis[];
  };
};
const buttonClass = "rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100";
function safeHref(value: string) {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}
function usageTokens(metadata: unknown): string | null {
  const usage = (metadata as { usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } } | null)?.usage;
  if (!usage || typeof usage !== "object") return null;
  const { promptTokens, completionTokens, totalTokens } = usage;
  if (typeof totalTokens !== "number") return null;
  return `输入 ${promptTokens ?? "—"} · 输出 ${completionTokens ?? "—"} · 合计 ${totalTokens}`;
}
function structuredCitationCount(metadata: unknown): number {
  const value = (metadata as { structuredCitations?: unknown[] } | null)?.structuredCitations;
  return Array.isArray(value) ? value.length : 0;
}

export function EvidenceDrawer({ runId, onClose, analysisVersion }: { runId: string; onClose: () => void; analysisVersion?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [analysisId, setAnalysisId] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    setRun(null); setLoading(true); setError(""); setAnalysisId("");
    async function fetchRun() {
      try {
        const result = await api<RunDetail>(`/runs/${encodeURIComponent(runId)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setRun(result); setError("");
        if ((result.analysisStatus === "PENDING" || ["PENDING", "QUEUED", "RUNNING", "RETRYING"].includes(result.status)) && polls++ < 12) {
          timer = setTimeout(fetchRun, Math.min(2000 * 2 ** Math.floor(polls / 3), 15000));
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(friendlyError(cause));
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void fetchRun();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [runId, retry]);
  const evidence = run?.evidence;
  const analysis = analysisVersion !== undefined
    ? evidence?.analyses.find((item) => item.analysisVersion === analysisVersion)
    : evidence?.analyses.find((item) => item.id === analysisId) ?? evidence?.analyses[0];
  return (
    <dialog ref={dialog} aria-labelledby="evidence-heading" onCancel={onClose} className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-3xl overflow-y-auto rounded-l-2xl bg-white p-6 text-slate-900 shadow-sm backdrop:bg-slate-900/50">
      <div className="flex items-center justify-between gap-4"><h2 id="evidence-heading" className="text-xl font-semibold">原始证据</h2><button autoFocus type="button" onClick={onClose} className={buttonClass}>关闭</button></div>

      <button type="button" onClick={() => setRetry((value) => value + 1)} className={`${buttonClass} mt-3`}>刷新证据</button>
      {loading && <p role="status" className="mt-4">正在加载证据…</p>}
      {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
      {run && <p className="mt-4 text-sm">运行状态：{formatStatus(run.status)} · 尝试 {run.attempt} 次 · 分析状态：{formatAnalysisStatus(run.analysisStatus)}{run.analysisErrorCode ? `（错误码 ${run.analysisErrorCode}）` : ""}</p>}
      {run && !evidence && <p className="mt-4 text-sm text-slate-600">{EMPTY_TEXT.evidence}。运行完成后可刷新查看；失败或取消的运行可能没有证据。</p>}
      {evidence && <div className="mt-5 space-y-6">
        {evidence.sourceType.toLowerCase() === "mock" && <p className="inline-block rounded bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">演示数据（Mock/Demo）</p>}
        {evidence.sourceType.toLowerCase() === "official_api" && <p className="inline-block rounded bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-900">官方 API · 真实调用</p>}
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {[["检测问题", evidence.queryText], ["检测引擎", evidence.engineName], ["响应模型", evidence.responseModel ?? evidence.model ?? "未知"], ["记录时间", new Date(evidence.createdAt).toLocaleString("zh-CN")], ["检索模式", formatRetrievalMode(evidence.retrievalMode)], ["数据来源", formatSourceType(evidence.sourceType)]].map(([label, value]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>)}
        </dl>
        <section><h3 className="mb-2 font-semibold">模型原始回答（rawResponse）</h3><pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-4 text-sm">{evidence.rawResponse}</pre></section>
        <section>
          <h3 className="mb-3 font-semibold">分析结果</h3>
          {!analysis ? <p className="text-sm text-slate-500">{analysisVersion !== undefined ? `报告冻结分析版本 ${analysisVersion} 缺失；原始回答仍可查看，不使用其他版本替代。` : run?.analysisStatus === "FAILED" ? "分析失败；原始证据仍可查看。" : "尚无分析结果，可稍后刷新。"}</p> : <>
            {analysisVersion !== undefined ? <p className="text-sm text-slate-600">报告冻结分析版本：{analysisVersion}</p> : <><label htmlFor="analysis-version" className="mr-2 text-sm">已保存分析版本</label>
            <select id="analysis-version" value={analysis.id} onChange={(event) => setAnalysisId(event.target.value)} className="max-w-full rounded border border-slate-300 p-2 text-sm">{evidence.analyses.map((item) => <option key={item.id} value={item.id}>{item.analysisVersion} · {item.createdAt}</option>)}</select></>}
            <FactInterpretation
              facts={<span>品牌提及：{analysis.brandMentioned ? "是" : "否"} · 首次提及位次：{analysis.mentionPosition ?? "—"} · 被推荐：{analysis.recommended ? "是" : "否"} · 情感倾向：{formatSentiment(analysis.sentiment)}</span>}
              interpretation="这里展示的是已保存的分析结果；它是对原始回答的解释，不会覆盖原始证据。"
            />
            <h4 className="mt-4 font-medium">品牌与竞品提及</h4>
            {!analysis.mentions.length ? <p className="mt-2 text-sm text-slate-500">无提及记录。</p> : <ul className="mt-2 space-y-3 text-sm">{analysis.mentions.map((mention) => <li key={mention.id} className="rounded border border-slate-200 p-3"><p>{mention.displayName}（{mention.canonicalName}） · {formatEntityType(mention.entityType)} · 首次提及位次 {mention.position} · {formatSentiment(mention.sentiment)}</p><p className="mt-1 whitespace-pre-wrap break-words text-slate-600">{mention.context}</p></li>)}</ul>}
            <h4 className="mt-4 font-medium">引用来源</h4>
            {!analysis.citations.length ? <p className="mt-2 text-sm text-slate-500">无引用记录。</p> : <>
              {structuredCitationCount(evidence.metadata) > 0
                ? <p className="mt-2 text-xs text-slate-500">引用来源类型：Provider 结构化引用。</p>
                : <p className="mt-2 text-xs text-slate-500">引用来源类型：回答正文 URL 提取（该 Provider 未返回结构化引用，非伪造）。</p>}
              <ul className="mt-2 space-y-2 text-sm">{analysis.citations.map((citation) => { const href = safeHref(citation.url); return <li key={citation.id} className="break-words">{citation.position}. {href ? <a className="text-blue-700 underline" href={href} target="_blank" rel="noopener noreferrer">{citation.title ?? citation.url}</a> : <span>{citation.title ?? citation.url}（无效或非 HTTP 链接）</span>} <span className="text-slate-500">· {citation.domain}</span></li>; })}</ul>
            </>}
          </>}
        </section>
        <details className="rounded-lg border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-medium">技术详情与原始提示词</summary>
          <p className="my-3 break-all text-xs text-slate-500">检测记录 ID：{runId} · 证据 ID：{evidence.id}</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {[
            ["原始问题（queryText）", evidence.queryText],
            ["模型服务（provider）", evidence.provider],
            ["检测引擎", `${evidence.engineName}（${evidence.engineKey}）`],
            ["请求模型（requestedModel）", evidence.requestedModel ?? "历史记录未保存"],
            ["响应模型（responseModel）", evidence.responseModel ?? "未知"],
            ["模型（model · legacy）", evidence.model],
            ["模型版本（legacy）", evidence.modelVersion ?? "—"],
            ["时间", evidence.createdAt],
            ["数据来源（sourceType）", withRaw(formatSourceType(evidence.sourceType), evidence.sourceType)],
            ["检索模式（retrievalMode）", withRaw(formatRetrievalMode(evidence.retrievalMode), evidence.retrievalMode)],
            ["Token 用量", usageTokens(evidence.metadata) ?? "—"],
          ].map(([label, value]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>)}
        </dl>
        {!evidence.requestedModel && !evidence.responseModel && (
          <p className="text-xs text-slate-400">注：该记录创建于模型身份字段引入之前，请求/响应模型未保存（不猜测历史）。</p>
        )}
        <section><h3 className="mb-2 font-semibold">原始提示词（rawPrompt）</h3><pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-4 text-sm">{evidence.rawPrompt}</pre></section>
          <h3 className="mt-4 font-medium">全部已保存分析版本</h3><ul className="text-xs text-slate-500">{evidence.analyses.map(item => <li key={item.id}>{item.analysisVersion} · {item.createdAt}</li>)}</ul>
          <h3 className="mt-4 font-medium">原始元数据</h3><pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(evidence.metadata, null, 2)}</pre>
        </details>
      </div>}
    </dialog>
  );
}

// Preserve existing monitor callers while sharing the report drawer.
export const EvidenceDialog = EvidenceDrawer;
