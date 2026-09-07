"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import {
  formatManualProduct, formatQueryType, friendlyError, MANUAL_NAV,
} from "@/lib/labels";

type Analysis = {
  analysisVersion: string; brandMentioned: boolean; mentionPosition: number | null;
  recommended: boolean; sentiment: string;
  mentions: Array<{ entityType: string; canonicalName: string; position: number }>;
  citations: Array<{ url: string; domain: string }>;
};
type EvidenceRow = {
  id: string; rawResponse: string; retrievalMode: string; sourceType: string;
  requestedModel: string | null; responseModel: string | null; submittedAt: string;
  metadata: Record<string, unknown>;
  analysis: Analysis | null;
};
type ManualRow = {
  id: string; status: string; queryText: string; queryType: string | null;
  category: string | null; intent: string | null; sortOrder: number; sanity: boolean;
  errorMessage: string | null;
  evidence: EvidenceRow | null;
};
type ManualWorkspace = {
  id: string; executionMode: string; measurementProduct: string | null;
  runType: string; status: string;
  suite: { id: string; name: string; version: string };
  targetSnapshot: Record<string, unknown> | null;
  isManual: boolean; isDemo: boolean;
  progress: { total: number; submitted: number; skipped: number; remaining: number; complete: boolean };
  runs: ManualRow[];
  createdAt: string;
};

type Editing = { rawResponse: string; retrieval: "confirmed" | "unknown" | null; signals: string; notes: string; observedAt: string; citations: string; displayedModel: string; submitting: boolean; error: string };
const emptyEditing = (): Editing => ({ rawResponse: "", retrieval: null, signals: "", notes: "", observedAt: "", citations: "", displayedModel: "", submitting: false, error: "" });

function ManualRunInner() {
  const { id } = useParams<{ id: string }>();
  const [ws, setWs] = useState<ManualWorkspace | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, Editing>>({});
  const [skipReason, setSkipReason] = useState<Record<string, string>>({});
  const [busySkip, setBusySkip] = useState<string | null>(null);

  /**
   * 受控表单状态补丁。Editing 的每个字段都必须始终是字符串/布尔/null 的完整形状：
   * 直接 { ...prev[row.id], ...patch } 在该行还没有记录时（prev[row.id] === undefined）
   * 会产出缺键对象，导致后续 render 中其它 input 的 value 变成 undefined，
   * React 判定「uncontrolled → controlled」并告警。
   * 这里始终以 emptyEditing() 为基底合并，保证任意首写都补齐全部字段。
   */
  const patchEditing = useCallback((rowId: string, patch: Partial<Editing>) => {
    setEditing(prev => {
      const base = prev[rowId] ?? emptyEditing();
      return { ...prev, [rowId]: { ...base, ...patch } };
    });
  }, []);

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await api<ManualWorkspace>(`/manual-runs/${id}`);
      setWs(data);
      // workspace 到达后一次性保证每个 row 都有「完整」的 editing state。
      // 只补缺失行（??= 语义），绝不覆盖当前未提交的用户输入 ——
      // 刷新/提交后重新 load 不会清空其它行正在输入的内容。
      // render 期仍有 `?? createEmptyEditing()` 兜底，但 state 层显式
      // 初始化才是「value 恒为 string/枚举」的真正保证。
      if (data.runs.length > 0) {
        setEditing(prev => {
          let changed = false;
          const next: Record<string, Editing> = { ...prev };
          for (const row of data.runs) {
            if (!next[row.id]) { next[row.id] = emptyEditing(); changed = true; }
          }
          return changed ? next : prev;
        });
      }
    } catch (e) { setError(friendlyError(e)); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function submitEvidence(row: ManualRow) {
    const ed = editing[row.id] ?? emptyEditing();
    if (!ed || !ed.rawResponse.trim()) { setNotice("请先粘贴完整回答。"); return; }
    if (ed.retrieval === null) { setNotice("请确认是否联网检索（是/无法确认）。"); return; }
    patchEditing(row.id, { submitting: true, error: "" });
    try {
      await api(`/runs/${row.id}/manual-evidence`, {
        method: "POST",
        body: JSON.stringify({
          rawResponse: ed.rawResponse,
          measurementProduct: ws?.measurementProduct ?? "qwen-web",
          retrievalConfirmed: ed.retrieval === "confirmed",
          ...(ed.displayedModel.trim() ? { displayedModel: ed.displayedModel.trim() } : {}),
          ...(ed.signals.trim() ? { verificationSignals: ed.signals.trim() } : {}),
          ...(ed.notes.trim() ? { verificationNotes: ed.notes.trim() } : {}),
          ...(ed.observedAt.trim() ? { observedAt: new Date(ed.observedAt).toISOString() } : {}),
          ...(ed.citations.trim() ? { citations: ed.citations.split(/\n/).map(s => s.trim()).filter(Boolean) } : {}),
        }),
      });
      setEditing(prev => ({ ...prev, [row.id]: emptyEditing() }));
      setNotice("证据已提交并通过自动分析。");
      await load();
    } catch (e) { patchEditing(row.id, { error: friendlyError(e), submitting: false }); }
  }

  async function skipRow(row: ManualRow) {
    if (!window.confirm("确认跳过该问题？跳过 ≠ 品牌未出现。")) return;
    setBusySkip(row.id);
    try {
      await api(`/runs/${row.id}/manual-skip`, { method: "POST", body: JSON.stringify({ reason: skipReason[row.id] ?? undefined }) });
      setNotice("已跳过。");
      await load();
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusySkip(null); }
  }

  async function copyQuery(row: ManualRow) {
    try {
      await navigator.clipboard.writeText(row.queryText);
      setCopiedId(row.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch { setNotice("复制失败，请手动选择问题文本复制。"); }
  }

  if (!ws && !error) return <div className="space-y-2" aria-busy="true">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-8 animate-pulse rounded-lg bg-slate-100" />)}</div>;

  const target = ws?.targetSnapshot as Record<string, unknown> | null;
  const productLabel = ws?.measurementProduct ? formatManualProduct(ws.measurementProduct) : "—";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/app/queries" className="text-xs text-blue-700 hover:underline">← 返回问题集</Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-800">{MANUAL_NAV.workspaceTitle}</h1>
          <p className="mt-1 text-xs text-slate-500">
            监测对象：<span className="font-medium text-slate-700">{(target as { canonicalName?: string } | null)?.canonicalName ?? "—"}</span>
            {target ? <>（{(target as { productCategory?: string | null }).productCategory ?? "未设产品类别"}）</> : ""}
            · 问题集 {ws?.suite.name} v{ws?.suite.version}
            · AI 产品：<span className="font-medium text-slate-700">{productLabel}</span>
            · {ws?.isDemo ? <span className="text-amber-700">{MANUAL_NAV.demoBadge}</span> : <span className="text-emerald-700">{MANUAL_NAV.realBadge}</span>}
          </p>
        </div>
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}

      {ws && (
        <>
          {/* 进度 */}
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="text-2xl font-semibold text-slate-800">{ws.progress.submitted}<span className="text-base text-slate-400"> / {ws.progress.total}</span></div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded bg-teal-50 px-2 py-1 text-teal-700">{MANUAL_NAV.submittedCount} {ws.progress.submitted}</span>
                <span className="rounded bg-slate-50 px-2 py-1 text-slate-600">{MANUAL_NAV.remainingCount} {ws.progress.remaining}</span>
                <span className="rounded bg-amber-50 px-2 py-1 text-amber-700">{MANUAL_NAV.skippedCount} {ws.progress.skipped}</span>
              </div>
              {ws.progress.complete && <span className="rounded-lg bg-emerald-100 px-3 py-1.5 text-sm font-medium text-emerald-800">{MANUAL_NAV.complete}</span>}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">{MANUAL_NAV.evidenceNotEditable}</p>
          </section>

          {/* 每条 Query */}
          {ws.runs.map(row => {
            const ed = editing[row.id] ?? emptyEditing();
            const submitted = row.status === "SUCCEEDED";
            const skipped = row.status === "SKIPPED";
            const analysis = row.evidence?.analysis;
            return (
              <section key={row.id} className={`rounded-xl border bg-white p-4 ${submitted ? "border-emerald-200" : skipped ? "border-amber-200" : "border-slate-200"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">Q{row.sortOrder + 1}</span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{row.queryType ? formatQueryType(row.queryType) : "未分类"}</span>
                  {submitted && <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800">{MANUAL_NAV.submitted}</span>}
                  {skipped && <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">{MANUAL_NAV.skippedLabel}</span>}
                  {!submitted && !skipped && <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{MANUAL_NAV.awaitingInput}</span>}
                </div>
                <p className="mt-2 text-sm font-medium text-slate-800">“{row.queryText}”</p>

                {submitted && row.evidence ? (
                  <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded bg-teal-100 px-1.5 py-0.5 text-teal-800">{MANUAL_NAV.manualSourceBadge}</span>
                      {row.evidence.retrievalMode === "manual_verified"
                        ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">{MANUAL_NAV.confirmedBadge}</span>
                        : <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">{MANUAL_NAV.unknownBadge}</span>}
                      {row.evidence.responseModel ? <span className="text-slate-500">模型：{row.evidence.responseModel}</span> : ""}
                      <span className="text-slate-400">{new Date(row.evidence.submittedAt).toLocaleString()}</span>
                    </div>
                    {row.evidence.retrievalMode !== "manual_verified" && (
                      <p className="rounded bg-amber-50 px-2 py-1 text-amber-800">{MANUAL_NAV.notConfirmedWarning}</p>
                    )}
                    <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-white p-2 text-slate-700">{row.evidence.rawResponse}</p>
                    {analysis && (
                      <div className="space-y-1">
                        <p className="text-slate-500">{MANUAL_NAV.analysisNote}</p>
                        <p>品牌提及：{analysis.brandMentioned ? "是" : "否"}
                          {analysis.brandMentioned && analysis.mentionPosition !== null ? ` · 位置 #${analysis.mentionPosition}` : ""}
                          · 推荐：{analysis.recommended ? "是" : "否"} · 情感：{analysis.sentiment}</p>
                        <p className="text-slate-500">提及实体：{analysis.mentions.map(m => m.canonicalName).join("、") || "—"}</p>
                        <p className="break-all text-slate-500">引用：{analysis.citations.map(c => c.url).join("、") || "—"}</p>
                      </div>
                    )}
                  </div>
                ) : skipped ? (
                  <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                    <p>已跳过：{row.errorMessage ?? "用户跳过"}</p>
                    <p className="mt-1 text-amber-700">{MANUAL_NAV.skipNote}</p>
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <p className="text-xs text-slate-500">{MANUAL_NAV.step1}</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void copyQuery(row)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                        {copiedId === row.id ? MANUAL_NAV.copied : MANUAL_NAV.copyQuery}
                      </button>
                    </div>
                    <div className="space-y-2">
                      <label className="block">
                        <span className="text-[11px] text-slate-500">{MANUAL_NAV.rawResponse}</span>
                        <textarea
                          value={ed.rawResponse ?? ""}
                          onChange={e => patchEditing(row.id, { rawResponse: e.target.value })}
                          className="mt-0.5 w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-800"
                          rows={6}
                          placeholder={MANUAL_NAV.rawResponseHint}
                        />
                      </label>
                      <label className="block">
                        <span className="text-[11px] text-slate-500">{MANUAL_NAV.displayedModel}</span>
                        <input value={ed.displayedModel ?? ""} onChange={e => patchEditing(row.id, { displayedModel: e.target.value })} className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" placeholder="如 Qwen3-Web（可选）" />
                      </label>
                      <div>
                        <span className="text-[11px] text-slate-500">{MANUAL_NAV.retrievalConfirm}</span>
                        <div className="mt-1 flex gap-2">
                          {(["confirmed", "unknown"] as const).map(k => (
                            <button key={k} type="button"
                              onClick={() => patchEditing(row.id, { retrieval: k })}
                              className={`rounded-lg border px-3 py-1.5 text-xs ${ed.retrieval === k ? (k === "confirmed" ? "border-teal-600 bg-teal-50 text-teal-800" : "border-amber-600 bg-amber-50 text-amber-800") : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                              {k === "confirmed" ? MANUAL_NAV.retrievalYes : MANUAL_NAV.retrievalNo}
                            </button>
                          ))}
                        </div>
                        {ed.retrieval === "confirmed" && (
                          <input value={ed.signals ?? ""} onChange={e => patchEditing(row.id, { signals: e.target.value })}
                            className="mt-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" placeholder="你如何确认？如：界面显示联网搜索 / 显示网页来源 / 显示引用链接" />
                        )}
                      </div>
                      <label className="block">
                        <span className="text-[11px] text-slate-500">{MANUAL_NAV.notes}</span>
                        <input value={ed.notes ?? ""} onChange={e => patchEditing(row.id, { notes: e.target.value })} className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" placeholder="可选" />
                      </label>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="block">
                          <span className="text-[11px] text-slate-500">{MANUAL_NAV.observedAt}</span>
                          <input type="datetime-local" value={ed.observedAt ?? ""} onChange={e => patchEditing(row.id, { observedAt: e.target.value })} className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                        </label>
                        <label className="block">
                          <span className="text-[11px] text-slate-500">{MANUAL_NAV.citations}</span>
                          <textarea value={ed.citations ?? ""} onChange={e => patchEditing(row.id, { citations: e.target.value })} className="mt-0.5 w-full rounded-lg border border-slate-300 p-1.5 text-xs" rows={1} placeholder={MANUAL_NAV.citations} />
                        </label>
                      </div>
                      {ed.error && <p className="rounded bg-rose-50 px-2 py-1 text-xs text-rose-700">{ed.error}</p>}
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={ed.submitting} onClick={() => void submitEvidence(row)} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-40">{MANUAL_NAV.submitEvidence}</button>
                        <div className="flex items-center gap-1">
                          <input value={skipReason[row.id] ?? ""} onChange={e => setSkipReason(prev => ({ ...prev, [row.id]: e.target.value }))} className="w-40 rounded-lg border border-slate-300 px-2 py-1.5 text-xs" placeholder={MANUAL_NAV.skipReason} />
                          <button type="button" disabled={busySkip === row.id} onClick={() => void skipRow(row)} className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-40">{MANUAL_NAV.skipThis}</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            );
          })}

          {/* 完成后 CTA */}
          {ws.progress.complete && (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 text-center">
              <h2 className="text-lg font-semibold text-emerald-900">{MANUAL_NAV.complete}</h2>
              <p className="mt-1 text-xs text-emerald-700">已提交 {ws.progress.submitted} / 共 {ws.progress.total}（跳过 {ws.progress.skipped}）。</p>
              <div className="mt-3 flex justify-center gap-2">
                <Link href={`/app/benchmark?run=${ws.id}`} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800">{MANUAL_NAV.viewMetrics}</Link>
                <button type="button" disabled={ws.progress.submitted === 0} onClick={() => {
                  if (!window.confirm("生成报告？报告为不可变快照。")) return;
                  void (async () => {
                    try {
                      const r = await api<{ id: string }>(`/benchmark-runs/${ws.id}/reports`, { method: "POST", body: JSON.stringify({}) });
                      window.location.href = `/app/reports/${r.id}`;
                    } catch (e) { setError(friendlyError(e)); }
                  })();
                }} className="rounded-lg border border-emerald-700 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">{MANUAL_NAV.generateReport}</button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

export default function ManualRunPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <ManualRunInner />
    </div>
  );
}
