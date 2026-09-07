"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import {
  formatQuerySource, formatQueryType, formatTargetCheck, friendlyError,
  MANUAL_NAV, QUERY_WORKSPACE_NAV, TARGET_NAV,
} from "@/lib/labels";

type Project = { id: string; name: string };
type TargetBrief = { canonicalName: string; productCategory: string | null };
type Suite = {
  id: string; projectId: string; name: string; version: string; description: string | null;
  queryCount: number; discoveryCount: number; sanityQueryCount: number; customCount: number;
  queries: Array<{
    id: string; queryText: string; category: string; intent: string; enabled: boolean;
    queryType: string | null; source: string | null; locale: string;
    contamination: { status: string; matchedAlias: string | null } | null;
  }>;
};
type Engine = { id: string; key: string; name: string; provider: string; configured: boolean };
type PreviewRow = { text: string; category: string; intent: string; queryType: string; targetCheck: string; matchedAlias: string | null };

const TYPE_BADGE: Record<string, string> = {
  DISCOVERY: "bg-teal-100 text-teal-800", BRANDED_SANITY: "bg-amber-100 text-amber-800", CUSTOM: "bg-slate-100 text-slate-600",
};

function SuiteInner() {
  const { id } = useParams<{ id: string }>();
  const [suite, setSuite] = useState<Suite | null>(null);
  const [suiteProjectId, setSuiteProjectId] = useState("");
  const [target, setTarget] = useState<TargetBrief | null>(null);
  const [engines, setEngines] = useState<Engine[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  // 生成器输入
  const [bCategory, setBCategory] = useState("");
  const [bScenario, setBScenario] = useState("");
  const [bIntents, setBIntents] = useState("RECOMMEND,HOW_TO");
  const [bAudience, setBAudience] = useState("");
  const [bModifiers, setBModifiers] = useState("");
  const [builderRows, setBuilderRows] = useState<PreviewRow[]>([]);
  const [builderMeta, setBuilderMeta] = useState<{ estimated: number; targetContaminated: number } | null>(null);

  // 导入
  const [importText, setImportText] = useState("");
  const [importRows, setImportRows] = useState<PreviewRow[]>([]);

  // 运行前确认
  const [runOpen, setRunOpen] = useState(false);
  const [engineId, setEngineId] = useState("");
  const [runType, setRunType] = useState<"demo" | "real">("demo");
  // M8C-R0：人工 Web UI 检测
  const [manualOpen, setManualOpen] = useState(false);
  const [manualProduct, setManualProduct] = useState("qwen-web");
  const [manualRunType, setManualRunType] = useState<"demo" | "real">("real");
  const [manualDisplayedModel, setManualDisplayedModel] = useState("");
  const [manualTarget, setManualTarget] = useState<TargetBrief | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const s = await api<Suite>(`/benchmark-suites/${id}`);
      setSuite(s);
      setSuiteProjectId(s.projectId ?? "");
    } catch (e) { setError(friendlyError(e)); }
  }, [id]);

  // Target 一律按「本问题集所属项目」读取，保证多项目隔离下上下文不错配。
  useEffect(() => {
    if (!suiteProjectId) return;
    api<TargetBrief | null>(`/projects/${encodeURIComponent(suiteProjectId)}/target-profile`)
      .then(t => {
        setTarget(t);
        if (t?.productCategory) setBCategory(prev => prev || t.productCategory!);
      })
      .catch(() => undefined);
  }, [suiteProjectId]);

  useEffect(() => {
    void load();
    api<{ projects: Project[]; engines: Engine[] }>("/monitor-tasks/options")
      .then(d => {
        setEngines(d.engines);
        const mock = d.engines.find(e => e.provider === "mock");
        if (mock) setEngineId(mock.id);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const split = (s: string) => s.split(/[,，\n]/).map(x => x.trim()).filter(Boolean);

  async function previewBuilder() {
    if (!suiteProjectId) return;
    setBusy(true); setError("");
    try {
      const r = await api<{ estimated: number; targetContaminated: number; rows: PreviewRow[] }>(
        `/projects/${encodeURIComponent(suiteProjectId)}/query-builder/preview`,
        { method: "POST", body: JSON.stringify({ category: bCategory, scenario: split(bScenario), intents: split(bIntents), audience: split(bAudience), modifiers: split(bModifiers) }) },
      );
      setBuilderMeta({ estimated: r.estimated, targetContaminated: r.targetContaminated });
      setBuilderRows(r.rows);
      setNotice(`生成器预览 ${r.rows.length} 条（无副作用）；含目标 ${r.targetContaminated} 条会转建议品牌认知测试。`);
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  async function saveBuilderRows() {
    const clean = builderRows.filter(r => r.targetCheck !== "TARGET_MENTIONED");
    if (clean.length === 0) { setError("没有可保存为自然发现的问题（全部含目标品牌）。"); return; }
    setBusy(true); setError("");
    try {
      const r = await api<{ added: number }>(`/benchmark-suites/${id}/queries/batch`, {
        method: "POST",
        body: JSON.stringify({ rows: clean.map(row => ({ text: row.text, category: "builder", intent: row.intent, queryType: "DISCOVERY" })) }),
      });
      setNotice(`已保存 ${r.added} 条自然发现问题。`);
      setBuilderRows([]); setBuilderMeta(null);
      await load();
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  async function previewImport() {
    if (!suiteProjectId) return;
    const lines = importText.split("\n").filter(l => l.trim());
    if (lines.length === 0) return;
    setBusy(true); setError("");
    try {
      const pid = suiteProjectId;
      const r = await api<{ rows: PreviewRow[] }>(`/projects/${encodeURIComponent(pid)}/queries/import-preview`, {
        method: "POST", body: JSON.stringify({ lines }),
      });
      setImportRows(r.rows);
      setNotice(`导入预览 ${r.rows.length} 条（无副作用）；含目标的默认建议品牌认知测试。`);
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  async function saveImportRows() {
    setBusy(true); setError("");
    try {
      const r = await api<{ added: number }>(`/benchmark-suites/${id}/queries/batch`, {
        method: "POST",
        body: JSON.stringify({ rows: importRows.map(row => ({ text: row.text, category: "import", intent: "批量导入", queryType: row.targetCheck === "TARGET_MENTIONED" ? "BRANDED_SANITY" : "DISCOVERY" })) }),
      });
      setNotice(`已保存 ${r.added} 条（含目标问题按品牌认知测试保存）。`);
      setImportRows([]); setImportText("");
      await load();
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  async function cloneSuite() {
    const version = window.prompt("复制为新版本（如 2）：", "2");
    if (!version) return;
    setBusy(true); setError("");
    try {
      const r = await api<{ clonedId: string }>(`/benchmark-suites/${id}/clone`, { method: "POST", body: JSON.stringify({ version: version.trim() }) });
      setNotice(`已复制为 v${version}（原问题集不变）。`);
      window.location.href = `/app/queries/${r.clonedId}`;
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  async function startRun() {
    setBusy(true); setError("");
    try {
      const r = await api<{ id: string }>(`/benchmark-suites/${id}/runs`, { method: "POST", body: JSON.stringify({ engineId, runType }) });
      setRunOpen(false);
      setNotice(`检测已启动（${runType === "real" ? "真实" : "演示"}）。`);
      window.location.href = `/app/benchmark?run=${r.id}`;
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  async function createManualRun() {
    setBusy(true); setError("");
    try {
      const r = await api<{ id: string }>(`/benchmark-suites/${id}/manual-runs`, {
        method: "POST",
        body: JSON.stringify({
          runType: manualRunType,
          measurementProduct: manualProduct,
          ...(manualDisplayedModel.trim() ? { displayedModel: manualDisplayedModel.trim() } : {}),
        }),
      });
      setManualOpen(false);
      window.location.href = `/app/manual-runs/${r.id}`;
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  const effectiveType = (q: Suite["queries"][number]) => q.queryType ?? (q.enabled && q.category !== "sanity-control" ? "DISCOVERY" : "CUSTOM");

  if (!suite && !error) return <div className="space-y-2" aria-busy="true">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-8 animate-pulse rounded-lg bg-slate-100" />)}</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/app/queries?project=${suiteProjectId}`} className="text-xs text-blue-700 hover:underline">← 返回问题集</Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-800">{suite?.name} <span className="text-slate-400">v{suite?.version}</span></h1>
          {suite && (
            <p className="mt-1 text-xs text-slate-500">
              {suite.queryCount} 个可用问题 · 自然发现 {suite.discoveryCount} · 品牌认知测试 {suite.sanityQueryCount} · 自定义 {suite.customCount}
              {target?.canonicalName ? <> · 监测对象：<span className="font-medium text-slate-700">{target.canonicalName}</span></> : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void cloneSuite()} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">{QUERY_WORKSPACE_NAV.cloneVersion}</button>
          <button type="button" disabled={busy || (suite?.queryCount ?? 0) === 0 || !target?.canonicalName} onClick={() => { setManualProduct("qwen-web"); setManualRunType("real"); setManualDisplayedModel(""); setManualOpen(true); }} className="rounded-lg border border-teal-600 bg-white px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-40" title={MANUAL_NAV.entryHint}>
            {MANUAL_NAV.entry}
          </button>
          <button type="button" disabled={busy || (suite?.queryCount ?? 0) === 0 || !target?.canonicalName} onClick={() => setRunOpen(true)} className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-40">
            {QUERY_WORKSPACE_NAV.runBenchmark}
          </button>
        </div>
      </div>

      {!target?.canonicalName && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">请先在「{TARGET_NAV.title}」页设置监测对象，才能开始检测。</p>}
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}

      {/* 问题生成器 */}
      <section className="rounded-xl border border-violet-200 bg-violet-50/30 p-4">
        <h2 className="text-sm font-semibold text-slate-700">{QUERY_WORKSPACE_NAV.queryBuilder}</h2>
        <p className="text-xs text-slate-500">{QUERY_WORKSPACE_NAV.builderNote}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <label className="block"><span className="text-[11px] text-slate-500">产品类别</span>
            <input value={bCategory} onChange={e => setBCategory(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" placeholder="如 CRM SaaS" aria-label="产品类别" />
          </label>
          <label className="block"><span className="text-[11px] text-slate-500">场景（逗号分隔）</span>
            <input value={bScenario} onChange={e => setBScenario(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" placeholder="如 销售团队选型,创业初期" aria-label="场景" />
          </label>
          <label className="block"><span className="text-[11px] text-slate-500">意图（逗号分隔）</span>
            <input value={bIntents} onChange={e => setBIntents(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" aria-label="意图" />
          </label>
          <label className="block"><span className="text-[11px] text-slate-500">人群（可选）</span>
            <input value={bAudience} onChange={e => setBAudience(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" placeholder="如 小团队" aria-label="人群" />
          </label>
          <label className="block"><span className="text-[11px] text-slate-500">条件（可选）</span>
            <input value={bModifiers} onChange={e => setBModifiers(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" placeholder="如 免费,5000 元以内" aria-label="条件" />
          </label>
          <button type="button" onClick={() => void previewBuilder()} disabled={busy || !bCategory.trim()} className="self-end rounded-lg bg-violet-800 px-3 py-2 text-sm font-medium text-white hover:bg-violet-900 disabled:opacity-40">预览问题</button>
        </div>
        {builderMeta && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>预计生成 {builderMeta.estimated} 条</span>
            {builderMeta.targetContaminated > 0 && <span className="text-amber-700">含目标品牌 {builderMeta.targetContaminated} 条（不会保存为自然发现）</span>}
            <button type="button" disabled={busy} onClick={() => void saveBuilderRows()} className="rounded-lg bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-40">保存为自然发现问题</button>
          </div>
        )}
        {builderRows.length > 0 && (
          <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 text-xs">
            {builderRows.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-2 border-b border-slate-100 py-1 last:border-0">
                <span className="min-w-0 flex-1 truncate text-slate-700">{r.text}</span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${TYPE_BADGE[r.queryType] ?? ""}`}>{formatQueryType(r.queryType)}</span>
                <span className="shrink-0 text-[10px] text-slate-400">{r.targetCheck === "TARGET_MENTIONED" ? "含目标" : "清洁"}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 批量导入 */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">{QUERY_WORKSPACE_NAV.importText}</h2>
        <p className="text-xs text-slate-500">{QUERY_WORKSPACE_NAV.importNote}</p>
        <textarea value={importText} onChange={e => setImportText(e.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder={"每行一个问题，例如：\n适合小型销售团队的 CRM 有哪些？\n销售团队怎么选 CRM？"} aria-label="批量导入文本" />
        <div className="mt-2 flex items-center gap-2">
          <button type="button" onClick={() => void previewImport()} disabled={busy || !importText.trim()} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40">预览导入</button>
          {importRows.length > 0 && (
            <>
              <button type="button" disabled={busy} onClick={() => void saveImportRows()} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-40">保存全部（含目标按品牌认知测试）</button>
              <span className="text-xs text-slate-500">{importRows.length} 条</span>
            </>
          )}
        </div>
        {importRows.length > 0 && (
          <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
            {importRows.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-2 py-0.5">
                <span className="min-w-0 flex-1 truncate text-slate-700">{r.text}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] ${TYPE_BADGE[r.queryType] ?? ""}`}>{formatQueryType(r.queryType)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Query 表格 */}
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="px-3 py-2 font-medium">{QUERY_WORKSPACE_NAV.tableColumns.query}</th>
              <th className="px-3 py-2 font-medium">{QUERY_WORKSPACE_NAV.tableColumns.type}</th>
              <th className="px-3 py-2 font-medium">{QUERY_WORKSPACE_NAV.tableColumns.category}</th>
              <th className="px-3 py-2 font-medium">{QUERY_WORKSPACE_NAV.tableColumns.targetCheck}</th>
              <th className="px-3 py-2 font-medium">{QUERY_WORKSPACE_NAV.tableColumns.source}</th>
              <th className="px-3 py-2 font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {suite?.queries.map(q => (
              <tr key={q.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="max-w-md px-3 py-2"><span className="line-clamp-2 break-words text-slate-800">“{q.queryText}”</span></td>
                <td className="px-3 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${TYPE_BADGE[effectiveType(q)] ?? ""}`}>{formatQueryType(effectiveType(q))}</span>
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">{q.category}</td>
                <td className="px-3 py-2">
                  <span className="text-xs">{q.contamination ? formatTargetCheck(q.contamination.status) : "—"}</span>
                </td>
                <td className="px-3 py-2 text-xs">{q.source ? formatQuerySource(q.source) : "—"}</td>
                <td className="px-3 py-2 text-xs">{q.enabled ? <span className="text-emerald-700">启用</span> : <span className="text-slate-400">停用</span>}</td>
              </tr>
            ))}
            {(suite?.queries.length ?? 0) === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-400">还没有问题 —— 使用上方生成器或批量导入添加。</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* 运行前确认 */}
      {runOpen && suite && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 overflow-y-auto" onClick={() => setRunOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 text-slate-900 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">{QUERY_WORKSPACE_NAV.runPreflight}</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">监测对象</dt><dd className="font-medium">{target?.canonicalName ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">问题集</dt><dd className="font-medium">{suite.name} v{suite.version}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">自然发现 / 品牌认知</dt><dd className="font-medium">{suite.discoveryCount} / {suite.sanityQueryCount}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">可用问题</dt><dd className="font-medium">{suite.queryCount}</dd></div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">AI 模型</dt>
                <select value={engineId} onChange={e => setEngineId(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" aria-label="AI 模型">
                  {engines.map(en => <option key={en.id} value={en.id}>{en.name}（{en.provider}）{en.configured ? "" : " [未配置]"}</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">模式</dt>
                <select value={runType} onChange={e => setRunType(e.target.value as "demo" | "real")} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" aria-label="模式">
                  <option value="demo">演示（0 调用）</option>
                  <option value="real">真实</option>
                </select>
              </div>
            </dl>
            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">{QUERY_WORKSPACE_NAV.preflightNote}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setRunOpen(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">取消</button>
              <button type="button" disabled={busy || !engineId} onClick={() => void startRun()} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-40">开始 GEO 检测</button>
            </div>
          </div>
        </div>
      )}

      {/* 人工 Web UI 检测设置 */}
      {manualOpen && suite && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 overflow-y-auto" onClick={() => setManualOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 text-slate-900 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">{MANUAL_NAV.entry}</h2>
            <p className="mt-1 text-xs text-slate-500">{MANUAL_NAV.entryHint}</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">监测对象</dt><dd className="font-medium">{target?.canonicalName ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">问题集</dt><dd className="font-medium">{suite.name} v{suite.version}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">自然发现 / 品牌认知</dt><dd className="font-medium">{suite.discoveryCount} / {suite.sanityQueryCount}</dd></div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">{MANUAL_NAV.product}</dt>
                <select value={manualProduct} onChange={e => setManualProduct(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" aria-label="AI 产品">
                  {Object.entries(MANUAL_NAV.products).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <label className="flex items-center justify-between gap-2">
                <span className="text-slate-500">{MANUAL_NAV.displayedModel}</span>
                <input value={manualDisplayedModel} onChange={e => setManualDisplayedModel(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" placeholder="如 Qwen3-Web" aria-label="界面显示模型" />
              </label>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">{MANUAL_NAV.runType}</dt>
                <select value={manualRunType} onChange={e => setManualRunType(e.target.value as "demo" | "real")} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" aria-label="数据性质">
                  <option value="real">{MANUAL_NAV.realType}</option>
                  <option value="demo">{MANUAL_NAV.demoType}（0 调用）</option>
                </select>
              </div>
            </dl>
            <p className="mt-3 rounded-lg bg-teal-50 px-3 py-2 text-[11px] text-teal-800">{MANUAL_NAV.aiRunVsManual}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setManualOpen(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">取消</button>
              <button type="button" disabled={busy} onClick={() => void createManualRun()} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-40">{MANUAL_NAV.createManual}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function QuerySuiteDetailPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <SuiteInner />
    </div>
  );
}
