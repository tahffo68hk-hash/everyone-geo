"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

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

export function EvidenceDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
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
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "无法加载证据。");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void fetchRun();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [runId, retry]);
  const evidence = run?.evidence;
  const analysis = evidence?.analyses.find((item) => item.id === analysisId) ?? evidence?.analyses[0];
  return (
    <dialog ref={dialog} aria-labelledby="evidence-heading" onCancel={onClose} className="m-auto max-h-[90vh] w-[calc(100%_-_2rem)] max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 text-slate-900 shadow-xl backdrop:bg-slate-900/50">
      <div className="flex items-center justify-between gap-4"><h2 id="evidence-heading" className="text-xl font-semibold">运行证据</h2><button autoFocus type="button" onClick={onClose} className={buttonClass}>关闭</button></div>
      <p className="mt-2 break-all text-xs text-slate-500">Run ID：{runId}</p>
      <button type="button" onClick={() => setRetry((value) => value + 1)} className={`${buttonClass} mt-3`}>刷新证据</button>
      {loading && <p role="status" className="mt-4">正在加载证据…</p>}
      {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
      {run && <p className="mt-4 text-sm">运行：{run.status} · 尝试 {run.attempt} 次 · 分析：{run.analysisStatus}{run.analysisErrorCode ? `（${run.analysisErrorCode}）` : ""}</p>}
      {run && !evidence && <p className="mt-4 text-sm text-slate-600">暂无证据。运行完成后可刷新查看；失败或取消的运行可能没有证据。</p>}
      {evidence && <div className="mt-5 space-y-6">
        {evidence.sourceType.toLowerCase() === "mock" && <p className="inline-block rounded bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900">Mock / Demo · 模拟数据</p>}
        {evidence.sourceType.toLowerCase() === "official_api" && <p className="inline-block rounded bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-900">DeepSeek API Response · Official API 真实调用</p>}
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {[["查询", evidence.queryText], ["Provider", evidence.provider], ["引擎", `${evidence.engineName} (${evidence.engineKey})`], ["模型", evidence.model], ["模型版本", evidence.modelVersion ?? "—"], ["时间", evidence.createdAt], ["来源", evidence.sourceType === "official_api" ? "Official API" : evidence.sourceType], ["检索模式", evidence.retrievalMode === "api_plain" ? "API 普通对话（非联网搜索）" : evidence.retrievalMode], ["Token 用量", usageTokens(evidence.metadata) ?? "—"]].map(([label, value]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>)}
        </dl>
        <section><h3 className="mb-2 font-semibold">完整 Prompt</h3><pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-4 text-sm">{evidence.rawPrompt}</pre></section>
        <section><h3 className="mb-2 font-semibold">原始响应</h3><pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-4 text-sm">{evidence.rawResponse}</pre></section>
        <section>
          <h3 className="mb-3 font-semibold">分析结果</h3>
          {!analysis ? <p className="text-sm text-slate-500">{run?.analysisStatus === "FAILED" ? "分析失败；原始证据仍可查看。" : "尚无分析结果，可稍后刷新。"}</p> : <>
            <label htmlFor="analysis-version" className="mr-2 text-sm">已保存分析版本</label>
            <select id="analysis-version" value={analysis.id} onChange={(event) => setAnalysisId(event.target.value)} className="max-w-full rounded border border-slate-300 p-2 text-sm">{evidence.analyses.map((item) => <option key={item.id} value={item.id}>{item.analysisVersion} · {item.createdAt}</option>)}</select>
            <p className="mt-3 text-sm">品牌提及：{analysis.brandMentioned ? "是" : "否"} · 提及排名：{analysis.mentionPosition ?? "—"} · 推荐：{analysis.recommended ? "是" : "否"} · 情感：{analysis.sentiment}</p>
            <h4 className="mt-4 font-medium">品牌与竞品提及</h4>
            {!analysis.mentions.length ? <p className="mt-2 text-sm text-slate-500">无提及记录。</p> : <ul className="mt-2 space-y-3 text-sm">{analysis.mentions.map((mention) => <li key={mention.id} className="rounded border border-slate-200 p-3"><p>{mention.displayName}（{mention.canonicalName}） · {mention.entityType} · 排名 {mention.position} · {mention.sentiment}</p><p className="mt-1 whitespace-pre-wrap break-words text-slate-600">{mention.context}</p></li>)}</ul>}
            <h4 className="mt-4 font-medium">引用来源</h4>
            {!analysis.citations.length ? <p className="mt-2 text-sm text-slate-500">无引用记录。</p> : <>
              {structuredCitationCount(evidence.metadata) > 0
                ? <p className="mt-2 text-xs text-slate-500">引用来源类型：Provider 结构化引用。</p>
                : <p className="mt-2 text-xs text-slate-500">引用来源类型：回答正文 URL 提取（该 Provider 未返回结构化引用，非伪造）。</p>}
              <ul className="mt-2 space-y-2 text-sm">{analysis.citations.map((citation) => { const href = safeHref(citation.url); return <li key={citation.id} className="break-words">{citation.position}. {href ? <a className="text-blue-700 underline" href={href} target="_blank" rel="noopener noreferrer">{citation.title ?? citation.url}</a> : <span>{citation.title ?? citation.url}（无效或非 HTTP 链接）</span>} <span className="text-slate-500">· {citation.domain}</span></li>; })}</ul>
            </>}
          </>}
        </section>
      </div>}
    </dialog>
  );
}
