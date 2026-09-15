"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  COMPETITOR_TYPE_OPTIONS, EMPTY_TEXT, formatCandidateStatus, formatCompetitorType,
  formatMetricName, formatSetStatus, formatToastCode, formatVersion, friendlyError,
} from "@/lib/labels";
import { EvidenceDialog } from "../monitor/evidence-dialog";

/* ------------------------------------------------------------------ */
/* 类型定义（与后端 /competitor API 返回结构一致）                       */
/* ------------------------------------------------------------------ */

type Project = { id: string; name: string };

type Candidate = {
  id: string; canonicalName: string; normalizedName: string; aliases: string[];
  status: "DISCOVERED" | "APPROVED" | "REJECTED";
  competitorType: "UNKNOWN" | "DIRECT" | "ADJACENT" | "SUBSTITUTE" | "NON_COMPETITOR";
  firstSeenAt: string; lastSeenAt: string;
  evidenceCount: number; queryCount: number; mentionCount: number; recommendationCount: number;
  createdAt: string; updatedAt: string;
  exampleEvidence: { queryText: string; mentionText: string; evidenceId: string; runId: string; recommended: boolean } | null;
};

type CandidateDetail = Candidate & {
  evidenceLinks: Array<{
    id: string; evidenceId: string; runId: string; queryText: string;
    mentionText: string; mentionPosition: number; occurrenceCount: number;
    recommended: boolean; createdAt: string;
  }>;
  counts: { evidenceCount: number; queryCount: number; mentionCount: number; recommendationCount: number };
};

type CompetitorSet = {
  id: string; name: string; version: string; status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  createdAt: string; updatedAt: string; activatedAt: string | null; entryCount: number;
  entries: Array<{
    id: string; candidateId: string; canonicalName: string; aliases: string[];
    competitorType: string; sortOrder: number;
  }>;
};

type SovRow = {
  status: "ready" | "pending";
  reason?: string;
  competitorSet?: { id: string; name: string; version: string; status: string; activatedAt: string | null };
  analysisVersion?: string;
  pool?: { eligibleEvidence: number; note: string };
  competitors?: Array<{ candidateId: string; canonicalName: string; competitorType: string; mentionCount: number; evidenceCount: number; queryCount: number; shareOfVoice: number | null }>;
  note?: string;
};

type DiscoveryResult = {
  extractor: string; scope: string;
  eligibility: { totalSucceededEvidence: number; realEvidenceEligible: number; excludedEvidence: Record<string, number> };
  outcome: { candidatesDiscovered: number; candidatesRefreshed: number; candidatesSkippedRejected: number; candidatesPruned: number };
  candidates: Array<{ id: string; canonicalName: string; status: string; competitorType: string }>;
};

/* ------------------------------------------------------------------ */
/* 常量与工具                                                           */
/* ------------------------------------------------------------------ */

const badge = (color: string, text: string) => `inline-block rounded px-2 py-0.5 text-xs font-semibold ${color}`;
const buttonClass = "rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50";
function errorText(error: unknown) { return friendlyError(error); }

export default function CompetitorsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [expanded, setExpanded] = useState<Record<string, CandidateDetail>>({});
  const [expandingId, setExpandingId] = useState("");

  // 评审操作表单
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editAliases, setEditAliases] = useState("");
  const [approveType, setApproveType] = useState<string>("DIRECT");

  const [sets, setSets] = useState<CompetitorSet[]>([]);
  const [newSetName, setNewSetName] = useState("");
  const [newSetVersion, setNewSetVersion] = useState("1");
  const [sov, setSov] = useState<SovRow | null>(null);
  const [evidenceRunId, setEvidenceRunId] = useState<string | null>(null);
  const loadSeq = useRef(0);

  const load = useCallback(async (sequence: number) => {
    if (!projectId) return;
    const [cand, setList, sovRow] = await Promise.all([
      api<Candidate[]>(`/projects/${encodeURIComponent(projectId)}/competitor-candidates`).catch(() => [] as Candidate[]),
      api<CompetitorSet[]>(`/projects/${encodeURIComponent(projectId)}/competitor-sets`).catch(() => [] as CompetitorSet[]),
      api<SovRow>(`/projects/${encodeURIComponent(projectId)}/competitor-sov`).catch(() => ({ status: "pending" }) as SovRow),
    ]);
    if (sequence !== loadSeq.current) return;
    setCandidates(cand);
    setSets(setList);
    setSov(sovRow);
  }, [projectId]);

  useEffect(() => {
    api<{ projects: Project[] }>("/monitor-tasks/options")
      .then(data => {
        setProjects(data.projects);
        const first = data.projects[0];
        if (first) setProjectId(first.id);
      })
      .catch(err => setError(errorText(err)));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    const sequence = ++loadSeq.current;
    load(sequence).catch(err => { if (sequence === loadSeq.current) setError(errorText(err)); });
  }, [projectId, load]);

  async function runDiscovery() {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<DiscoveryResult>(`/projects/${encodeURIComponent(projectId)}/competitor-discovery`, { method: "POST" });
      const excluded = Object.entries(result.eligibility.excludedEvidence)
        .map(([key, value]) => `${formatToastCode(key, "其他原因")} ${value}`).join("；") || "无";
      setNotice(
        `发现完成：可用真实证据 ${result.eligibility.realEvidenceEligible} 条（共 ${result.eligibility.totalSucceededEvidence} 条；排除 ${excluded}）· 新增候选 ${result.outcome.candidatesDiscovered} · 刷新 ${result.outcome.candidatesRefreshed}`,
      );
      await load(loadSeq.current);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleExpand(candidate: Candidate) {
    if (expanded[candidate.id]) {
      const next = { ...expanded };
      delete next[candidate.id];
      setExpanded(next);
      return;
    }
    setExpandingId(candidate.id);
    try {
      const detail = await api<CandidateDetail>(`/competitor-candidates/${encodeURIComponent(candidate.id)}`);
      setExpanded(prev => ({ ...prev, [candidate.id]: detail }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setExpandingId("");
    }
  }

  async function review(candidate: Candidate, payload: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      await api(`/competitor-candidates/${encodeURIComponent(candidate.id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      await load(loadSeq.current);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function approve(candidate: Candidate, type: string) {
    await review(candidate, { status: "APPROVED", competitorType: type });
  }

  async function reject(candidate: Candidate) {
    await review(candidate, { status: "REJECTED" });
  }

  function startEdit(candidate: Candidate) {
    setEditId(candidate.id);
    setEditName(candidate.canonicalName);
    setEditAliases(candidate.aliases.join(", "));
    setApproveType(candidate.competitorType !== "UNKNOWN" && candidate.competitorType !== "NON_COMPETITOR" ? candidate.competitorType : "DIRECT");
  }

  async function saveEdit(candidate: Candidate) {
    const payload: Record<string, unknown> = {
      canonicalName: editName.trim(),
      aliases: editAliases.split(",").map(s => s.trim()).filter(Boolean),
    };
    if (candidate.status === "DISCOVERED") payload.status = "APPROVED";
    await review(candidate, { ...payload, competitorType: approveType });
    setEditId("");
  }

  async function createSet() {
    if (!newSetName.trim() || !newSetVersion.trim()) return;
    setBusy(true); setError("");
    try {
      const result = await api<CompetitorSet>(`/projects/${encodeURIComponent(projectId)}/competitor-sets`, {
        method: "POST",
        body: JSON.stringify({ name: newSetName.trim(), version: newSetVersion.trim() }),
      });
      setNotice(`竞品集合已创建为${formatToastCode(result.status)}（条目 = 当前已确认候选快照）。`);
      await load(loadSeq.current);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function activateSet(set: CompetitorSet) {
    setBusy(true); setError("");
    try {
      const result = await api<CompetitorSet>(`/competitor-sets/${encodeURIComponent(set.id)}/activate`, { method: "POST" });
      setNotice(`集合「${result.name} ${formatVersion(result.version)}」已启用（激活即冻结；如需修改请创建新版本）。`);
      await load(loadSeq.current);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function reanalyze(set: CompetitorSet) {
    setBusy(true); setError("");
    try {
      const result = await api<{ analysisVersion: string; evidenceEligible: number; reanalyzed: number; skippedExisting: number; competitorSet: { name: string; version: string } }>(
        `/projects/${encodeURIComponent(projectId)}/competitor-reanalysis`,
        { method: "POST", body: JSON.stringify({ competitorSetId: set.id }) },
      );
      setNotice(`重新分析完成：${result.reanalyzed} 条证据生成 ${result.analysisVersion}（可用证据 ${result.evidenceEligible}，已存在跳过 ${result.skippedExisting}）。0 次 DeepSeek 请求。`);
      await load(loadSeq.current);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const project = projects.find(item => item.id === projectId);
  const activeSet = [...sets].sort((a, b) => (b.activatedAt ?? "").localeCompare(a.activatedAt ?? "")).find(set => set.status === "ACTIVE");

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <Link href="/app" className="text-sm text-blue-700 hover:underline">← 返回工作台</Link>
          <h1 className="mt-3 text-2xl font-semibold">竞品分析（Competitor Discovery）</h1>
          <p className="mt-2 text-sm text-slate-500">
            仅从真实证据（REAL Evidence）生成候选竞品；被提及 ≠ 竞对 —— 竞争关系只能由人工评审确认。
            <span className="font-medium text-amber-700">样本量较小，仅作为竞品发现信号，不代表稳定行业结论。</span>
          </p>
        </header>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {notice && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</p>}

        {projects.length === 0 && <p role="status" className="text-sm text-slate-500">加载项目…</p>}

        {projects.length > 0 && (
          <>
            {/* 项目 + Run Discovery */}
            <section aria-labelledby="disc-heading" className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 id="disc-heading" className="mb-4 text-lg font-semibold">竞品发现（仅消费真实证据）</h2>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-64 flex-1">
                  <label htmlFor="project" className="mb-2 block text-sm font-medium">项目</label>
                  <select id="project" value={projectId} className="w-full rounded-lg border border-slate-300 p-2" onChange={event => setProjectId(event.target.value)}>
                    {projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </div>
                <div>
                  <button type="button" disabled={busy} onClick={() => void runDiscovery()} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50">
                    {busy ? "运行中…" : "开始发现"}
                  </button>
                </div>
              </div>
              {project && <p className="mt-3 text-xs text-slate-500">{project.name}：mock / demo / estimated 证据一律排除；当前可用真实证据 {sov?.pool?.eligibleEvidence ?? 0} 条会进入输入。</p>}
            </section>

            {/* Candidates */}
            <section aria-labelledby="cand-heading" className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 id="cand-heading" className="mb-1 text-lg font-semibold">候选竞品（{candidates.length}）</h2>
              <p className="mb-3 text-xs text-slate-500">状态「待审核」/ 类型「未分类」= 仅事实信号。确认为竞品时必须选择：直接竞品 / 相邻产品 / 替代方案。</p>
              {candidates.length === 0 && <p className="text-sm text-slate-400">{EMPTY_TEXT.candidates} —— 点击「开始发现」从真实证据提取（需先有真实模型服务监测结果）。</p>}
              <div className="space-y-3">
                {candidates.map(candidate => {
                  const detail = expanded[candidate.id];
                  return (
                    <article key={candidate.id} className={`rounded-xl border p-4 ${candidate.status === "REJECTED" ? "border-slate-200 bg-slate-50 opacity-70" : "border-slate-200 bg-white"}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => void toggleExpand(candidate)} className="text-left font-semibold text-blue-800 hover:underline">
                          {candidate.canonicalName}
                        </button>
                        <span className={badge(
                          candidate.status === "APPROVED" ? "bg-emerald-100 text-emerald-800"
                            : candidate.status === "REJECTED" ? "bg-slate-200 text-slate-600"
                              : "bg-amber-100 text-amber-800",
                          formatCandidateStatus(candidate.status),
                        )}>{formatCandidateStatus(candidate.status)}</span>
                        <span className={badge(
                          candidate.competitorType === "DIRECT" ? "bg-red-100 text-red-800"
                            : candidate.competitorType === "ADJACENT" ? "bg-orange-100 text-orange-800"
                              : candidate.competitorType === "SUBSTITUTE" ? "bg-purple-100 text-purple-800"
                                : candidate.competitorType === "NON_COMPETITOR" ? "bg-slate-200 text-slate-500"
                                  : "bg-slate-100 text-slate-500",
                          formatCompetitorType(candidate.competitorType),
                        )}>{formatCompetitorType(candidate.competitorType)}</span>
                        {candidate.status === "DISCOVERED" && (
                          <span className="text-xs text-amber-700">等待人工评审 · 不自动推断直接竞品</span>
                        )}
                      </div>
                      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600 sm:grid-cols-5">
                        <div><dt className="text-slate-400">{formatMetricName("evidenceCount")}</dt><dd className="mt-0.5 text-base font-semibold text-slate-900">{candidate.evidenceCount}</dd></div>
                        <div><dt className="text-slate-400">{formatMetricName("queryCount")}</dt><dd className="mt-0.5 text-base font-semibold text-slate-900">{candidate.queryCount}</dd></div>
                        <div><dt className="text-slate-400">提及次数</dt><dd className="mt-0.5 text-base font-semibold text-slate-900">{candidate.mentionCount}</dd></div>
                        <div><dt className="text-slate-400">{formatMetricName("recommendationCount")}</dt><dd className="mt-0.5 text-base font-semibold text-slate-900">{candidate.recommendationCount}</dd></div>
                        <div><dt className="text-slate-400">首/末见</dt><dd className="mt-0.5 text-slate-600">{new Date(candidate.firstSeenAt).toLocaleDateString()}<br />{new Date(candidate.lastSeenAt).toLocaleDateString()}</dd></div>
                      </dl>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        {candidate.exampleEvidence && (
                          <>
                            <span className="max-w-64 truncate rounded bg-slate-100 px-2 py-0.5">“{candidate.exampleEvidence.mentionText}”</span>
                            <span className="max-w-72 truncate">{candidate.exampleEvidence.queryText}</span>
                            <button type="button" className="text-blue-700 underline" onClick={() => setEvidenceRunId(candidate.exampleEvidence!.runId)}>查看原始证据</button>
                          </>
                        )}
                      </div>

                      {/* 评审 / 编辑控件 */}
                      {editId === candidate.id ? (
                        <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto]">
                          <label className="text-xs text-slate-600">
                            规范名（canonicalName）
                            <input value={editName} onChange={e => setEditName(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
                          </label>
                          <label className="text-xs text-slate-600">
                            别名（aliases，逗号分隔）
                            <input value={editAliases} onChange={e => setEditAliases(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
                          </label>
                          <label className="text-xs text-slate-600">
                            竞争类型
                            <select value={approveType} onChange={e => setApproveType(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1">
                              {COMPETITOR_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                          </label>
                          <div className="flex items-end gap-2 sm:col-span-3">
                            <button type="button" disabled={busy} onClick={() => void saveEdit(candidate)} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800">确认并保存</button>
                            <button type="button" onClick={() => setEditId("")} className={buttonClass}>取消</button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {candidate.status === "DISCOVERED" && (
                            <button type="button" disabled={busy} onClick={() => startEdit(candidate)} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800">确认为竞品…</button>
                          )}
                          {candidate.status === "APPROVED" && (
                            <>
                              <button type="button" disabled={busy} onClick={() => startEdit(candidate)} className={buttonClass}>编辑名称/别名</button>
                              <select value={candidate.competitorType} disabled={busy}
                                onChange={e => void approve(candidate, e.target.value)}
                                className="rounded border border-slate-300 px-2 py-1.5 text-xs">
                                {COMPETITOR_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                            </>
                          )}
                          {(candidate.status === "DISCOVERED" || candidate.status === "APPROVED") && (
                            <button type="button" disabled={busy} onClick={() => void reject(candidate)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50">排除</button>
                          )}
                          {candidate.status === "REJECTED" && (
                            <button type="button" disabled={busy} onClick={() => void approve(candidate, "DIRECT")} className={buttonClass}>重新评审并确认（直接竞品）</button>
                          )}
                        </div>
                      )}

                      {expandingId === candidate.id && <p className="mt-2 text-xs text-slate-400">加载证据链接…</p>}
                      {detail && (
                        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                          <table className="w-full text-left text-xs">
                            <thead className="border-b border-slate-200 text-slate-500">
                              <tr><th className="p-2">原始问题</th><th className="p-2">命中文本</th><th className="p-2">位置</th><th className="p-2">次数</th><th className="p-2">推荐信号</th><th className="p-2">原始证据</th></tr>
                            </thead>
                            <tbody>
                              {detail.evidenceLinks.map(link => (
                                <tr key={link.id} className="border-b border-slate-100">
                                  <td className="max-w-56 break-words p-2">{link.queryText}</td>
                                  <td className="max-w-64 break-words p-2 text-slate-600">“{link.mentionText}”</td>
                                  <td className="p-2">{link.mentionPosition}</td>
                                  <td className="p-2">{link.occurrenceCount}</td>
                                  <td className="p-2">{link.recommended ? "✓" : "—"}</td>
                                  <td className="p-2"><button type="button" className="text-blue-700 underline" onClick={() => setEvidenceRunId(link.runId)}>查看原始回答</button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>

            {/* Competitor Sets */}
            <section aria-labelledby="set-heading" className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 id="set-heading" className="mb-4 text-lg font-semibold">竞品集合（版本化）</h2>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                <label className="text-xs text-slate-600">
                  名称（name）
                  <input value={newSetName} onChange={e => setNewSetName(e.target.value)} placeholder="如：AcmeFlow 竞品集" className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
                </label>
                <label className="text-xs text-slate-600">
                  版本（version）
                  <input value={newSetVersion} onChange={e => setNewSetVersion(e.target.value)} className="mt-1 w-28 rounded border border-slate-300 px-2 py-1" />
                </label>
                <div className="flex items-end">
                  <button type="button" disabled={busy || !newSetName.trim() || !newSetVersion.trim()} onClick={() => void createSet()} className="rounded-lg bg-blue-700 px-4 py-1.5 text-sm text-white hover:bg-blue-800 disabled:opacity-50">
                    创建草稿
                  </button>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500">条目 = 创建瞬间全部已确认候选的快照（含类型/别名）。启用即冻结 —— 要换配置请创建新版本 v2。</p>

              <div className="mt-4 space-y-2">
                {sets.map(set => (
                  <div key={set.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{set.name}</span>
                      <span className={badge("bg-blue-100 text-blue-800", formatVersion(set.version))}>{formatVersion(set.version)}</span>
                      <span className={badge(set.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : set.status === "DRAFT" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500", formatSetStatus(set.status))}>{formatSetStatus(set.status)}</span>
                      <span className="text-xs text-slate-500">{set.entryCount} 个条目{set.activatedAt ? ` · 启用时间 ${new Date(set.activatedAt).toLocaleString()}` : ""}</span>
                      <span className="flex-1" />
                      {set.status === "DRAFT" && (
                        <button type="button" disabled={busy} onClick={() => void activateSet(set)} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs text-white hover:bg-emerald-800">启用</button>
                      )}
                      {set.status === "ACTIVE" && (
                        <>
                          <span className="text-xs text-emerald-700">已冻结（不可变）</span>
                          <button type="button" disabled={busy} onClick={() => void reanalyze(set)} className="rounded-lg bg-indigo-700 px-3 py-1.5 text-xs text-white hover:bg-indigo-800">重新分析真实证据</button>
                        </>
                      )}
                    </div>
                    <p className="mt-1 flex flex-wrap gap-1 text-xs text-slate-600">
                      {set.entries.map(entry => (
                        <span key={entry.id} className="rounded-full border border-slate-200 px-2 py-0.5">
                          {entry.canonicalName}
                          <span className="ml-1 text-slate-400">{formatCompetitorType(entry.competitorType)}</span>
                        </span>
                      ))}
                    </p>
                  </div>
                ))}
                {sets.length === 0 && <p className="text-xs text-slate-400">暂无竞品集合。请先确认候选竞品，再创建并启用。</p>}
              </div>
            </section>

            {/* Share of Voice */}
            <section aria-labelledby="sov-heading" className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 id="sov-heading" className="mb-1 text-lg font-semibold">AI 声量份额（Share of Voice）</h2>
              {sov?.status === "pending" && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {sov.reason === "no-active-competitor-set"
                    ? EMPTY_TEXT.activeSet + " —— AI 声量份额需要先人工评审并启用版本化竞品集合。"
                    : sov.reason === "not-reanalyzed"
                      ? "竞品集合已启用但尚未运行重新分析 —— 请点击上方「重新分析真实证据」。"
                      : "AI 声量份额暂不可用（未满足条件）。样本量较小，仅作为竞品发现信号，不代表稳定行业结论。"}
                </p>
              )}
              {sov?.status === "ready" && sov.competitorSet && (
                <div className="mt-2 space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={badge("bg-emerald-100 text-emerald-800", `竞品集合：${sov.competitorSet.name} ${formatVersion(sov.competitorSet.version)}`)}>竞品集合 {sov.competitorSet.name} {formatVersion(sov.competitorSet.version)}</span>
                    <span className={badge("bg-indigo-100 text-indigo-800", `分析版本 ${sov.analysisVersion}`)}>分析版本：{sov.analysisVersion}</span>
                    <span className={badge("bg-slate-100 text-slate-600", `真实证据 ${sov.pool?.eligibleEvidence ?? 0} 条`)}>真实证据 {sov.pool?.eligibleEvidence ?? 0} 条</span>
                  </div>
                  <p className="text-xs text-amber-700">样本量较小，仅作为竞品发现信号，不代表稳定行业结论。</p>
                  <div className="space-y-2">
                    {sov.competitors?.map(competitor => {
                      const share = competitor.shareOfVoice ?? 0;
                      return (
                        <div key={competitor.candidateId} className="flex items-center gap-3 text-sm">
                          <span className="w-36 shrink-0 font-medium">{competitor.canonicalName}</span>
                          <span className="w-20 shrink-0 text-xs text-slate-400">{formatCompetitorType(competitor.competitorType)}</span>
                          <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                            <div className="h-full rounded bg-blue-600" style={{ width: `${Math.round(share * 100)}%` }} />
                          </div>
                          <span className="w-24 shrink-0 text-right text-xs text-slate-500">
                            {competitor.mentionCount} 次 · {(share * 100).toFixed(1)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-slate-500">竞品集合：{sov.competitorSet.name} {formatVersion(sov.competitorSet.version)}；分析版本：{sov.analysisVersion}。未启用 / 未重新分析前不出正式 AI 声量份额。</p>
                </div>
              )}
              {!sov && <p className="text-sm text-slate-400">正在加载 AI 声量份额…</p>}
            </section>
          </>
        )}
      </div>
      {evidenceRunId && <EvidenceDialog key={evidenceRunId} runId={evidenceRunId} onClose={() => setEvidenceRunId(null)} />}
    </main>
  );
}
