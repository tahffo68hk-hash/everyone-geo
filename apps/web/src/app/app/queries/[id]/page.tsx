"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import {
  formatQuerySource, formatQueryType, formatTargetCheck, formatVersion, friendlyError,
  MANUAL_NAV, QUERY_WORKSPACE_NAV, TARGET_NAV, QUERY_INTENT_LABEL,
} from "@/lib/labels";
import {
  clearProcessedSelection,
  formatPreflightCost,
  getPreflightBlockedReason,
  listProjectSuites,
  listQueries,
  loadRunPreflight,
  runQueryBatch,
  togglePageSelection,
  type BatchOperation,
  type ProjectSuiteOption,
  type QueryContaminationStatus,
  type QueryListItem,
  type QuerySemanticType,
  type QuerySort,
  type QueryStatusFilter,
  type RunPreflightResponse,
  type SortOrder,
} from "@/lib/r2-api";
import { ErrorState, LoadingSkeleton, Pagination } from "@/components/ui";

type Project = { id: string; name: string };
type TargetBrief = { canonicalName: string; productCategory: string | null };
type Suite = {
  id: string; projectId: string; name: string; version: string; description: string | null;
  queryCount: number; discoveryCount: number; sanityQueryCount: number; customCount: number;
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
  const [search, setSearch] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [typeFilter, setTypeFilter] = useState<QuerySemanticType | "">("");
  const [checkFilter, setCheckFilter] = useState<QueryContaminationStatus | "">("");
  const [statusFilter, setStatusFilter] = useState<QueryStatusFilter | "">("");
  const [sort, setSort] = useState<QuerySort>("createdAt");
  const [order, setOrder] = useState<SortOrder>("asc");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [queryItems, setQueryItems] = useState<QueryListItem[]>([]);
  const [queryTotal, setQueryTotal] = useState(0);
  const [queryLoading, setQueryLoading] = useState(true);
  const [queryError, setQueryError] = useState("");
  const [queryRevision, setQueryRevision] = useState(0);
  const [recycleBin, setRecycleBin] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveSuites, setMoveSuites] = useState<ProjectSuiteOption[]>([]);
  const [moveSuiteId, setMoveSuiteId] = useState("");
  const [moveLoading, setMoveLoading] = useState(false);
  const [moveError, setMoveError] = useState("");
  const resetFilters = () => { setSearch(""); setSearchApplied(""); setTypeFilter(""); setCheckFilter(""); setStatusFilter(""); setSort("createdAt"); setOrder("asc"); setPage(1); };

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
  const [preflight, setPreflight] = useState<RunPreflightResponse | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightError, setPreflightError] = useState("");
  // M8C-R0：人工 Web UI 检测
  const [manualOpen, setManualOpen] = useState(false);
  const [manualProduct, setManualProduct] = useState("qwen-web");
  const [manualRunType, setManualRunType] = useState<"demo" | "real">("demo");
  const [manualDisplayedModel, setManualDisplayedModel] = useState("");

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
        const defaultEngine = d.engines.find(e => e.provider === "mock") || d.engines[0];
        if (defaultEngine) setEngineId(defaultEngine.id);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!suiteProjectId) return;
    const controller = new AbortController();
    setQueryLoading(true);
    setQueryError("");
    listQueries(suiteProjectId, {
      suiteId: id,
      archived: recycleBin,
      q: searchApplied,
      status: statusFilter,
      type: typeFilter,
      contamination: checkFilter,
      sort,
      order,
      page,
      pageSize,
    }, controller.signal)
      .then(result => {
        if (result.items.length === 0 && result.total > 0 && page > 1) {
          setPage(page - 1);
          return;
        }
        setQueryItems(result.items);
        setQueryTotal(result.total);
      })
      .catch(cause => {
        if (!controller.signal.aborted) setQueryError(friendlyError(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setQueryLoading(false);
      });
    return () => controller.abort();
  }, [suiteProjectId, id, recycleBin, searchApplied, statusFilter, typeFilter, checkFilter, sort, order, page, queryRevision]);

  async function applyBatch(operation: BatchOperation, targetSuiteId?: string) {
    if (!suiteProjectId || selectedIds.size === 0) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await runQueryBatch(suiteProjectId, {
        operation,
        queryIds: [...selectedIds],
        ...(targetSuiteId ? { targetSuiteId } : {}),
      });
      setSelectedIds(current => clearProcessedSelection(current, result.queryIds));
      setNotice(`已${operation === "enable" ? "启用" : operation === "disable" ? "停用" : operation === "archive" ? "归档" : "移动"} ${result.affected} 条问题。`);
      setArchiveOpen(false); setMoveOpen(false);
      setQueryRevision(value => value + 1);
      await load();
    } catch (cause) {
      setError(friendlyError(cause));
    } finally { setBusy(false); }
  }

  async function openMoveDialog() {
    if (!suiteProjectId) return;
    setMoveOpen(true); setMoveLoading(true); setMoveError(""); setMoveSuiteId("");
    try {
      const suites = (await listProjectSuites(suiteProjectId)).filter(option => option.id !== id);
      setMoveSuites(suites);
      setMoveSuiteId(suites[0]?.id ?? "");
    } catch (cause) {
      setMoveError(friendlyError(cause));
    } finally { setMoveLoading(false); }
  }

  useEffect(() => {
    if (!runOpen || !suiteProjectId || !engineId) return;
    let active = true;
    setPreflightLoading(true); setPreflight(null); setPreflightError("");
    loadRunPreflight(suiteProjectId, { suiteId: id, engineIds: [engineId], runType })
      .then(result => { if (active) setPreflight(result); })
      .catch(cause => { if (active) setPreflightError(friendlyError(cause)); })
      .finally(() => { if (active) setPreflightLoading(false); });
    return () => { active = false; };
  }, [runOpen, suiteProjectId, id, engineId, runType]);

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
      setNotice(`已复制为 ${formatVersion(version)}（原问题集不变）。`);
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

  const effectiveType = (q: QueryListItem): QuerySemanticType => q.queryType ?? (q.sanity ? "BRANDED_SANITY" : "DISCOVERY");
  const pageIds = queryItems.map(query => query.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every(queryId => selectedIds.has(queryId));
  const preflightBlockedReason = preflight ? getPreflightBlockedReason(preflight) : null;

  if (!suite && !error) return <div className="space-y-2" aria-busy="true">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-8 animate-pulse rounded-lg bg-slate-100" />)}</div>;

  if (!suite) return <div role="alert" className="rounded-lg border border-rose-200 bg-white p-6"><h1 className="text-lg font-semibold text-slate-800">问题集加载失败</h1><p className="mt-2 text-sm text-rose-700">{error}</p><button type="button" onClick={() => void load()} className="mt-4 rounded-lg bg-teal-700 px-4 py-2 text-sm text-white">重试</button></div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/app/queries?project=${suiteProjectId}`} className="text-xs text-teal-700 hover:underline">← 返回问题集</Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-800">{suite?.name} <span className="text-slate-400">{formatVersion(suite?.version)}</span></h1>
          {suite && (
            <p className="mt-1 text-xs text-slate-500">
              {suite.queryCount} 个可用问题 · 自然发现 {suite.discoveryCount} · 品牌认知测试 {suite.sanityQueryCount} · 自定义 {suite.customCount}
              {target?.canonicalName ? <> · 监测对象：<span className="font-medium text-slate-700">{target.canonicalName}</span></> : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { setRecycleBin(value => !value); setSelectedIds(new Set()); setPage(1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            {recycleBin ? "返回当前问题" : "回收站"}
          </button>
          <button type="button" disabled={busy || (suite?.queryCount ?? 0) === 0 || !target?.canonicalName} onClick={() => { setManualProduct("qwen-web"); setManualRunType("real"); setManualDisplayedModel(""); setManualOpen(true); }} className="rounded-lg border border-teal-600 bg-white px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-40" title={MANUAL_NAV.entryHint}>
            {MANUAL_NAV.entry}
          </button>
          <button type="button" disabled={busy || (suite?.queryCount ?? 0) === 0 || !target?.canonicalName} onClick={() => setRunOpen(true)} className="ui-button primary compact disabled:opacity-40">
            {QUERY_WORKSPACE_NAV.runBenchmark}
          </button>
        </div>
      </div>

      {!target?.canonicalName && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">请先在「{TARGET_NAV.title}」页设置监测对象，才能开始检测。</p>}
      {error && <div role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}<button type="button" onClick={() => void load()} className="ml-3 underline">重新加载问题集</button></div>}
      {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}
      {recycleBin && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">回收站仅包含已归档问题。归档是软删除，历史 Run、Report 和 Evidence 保持不变。</p>}

      <section aria-label="问题列表" className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4">
          <input aria-label="搜索问题" placeholder="搜索问题内容" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { setSearchApplied(search.trim()); setPage(1); } }} className="min-w-48 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <button type="button" onClick={() => { setSearchApplied(search.trim()); setPage(1); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">搜索</button>
          <select aria-label="问题类型筛选" value={typeFilter} onChange={e => { setTypeFilter(e.target.value as QuerySemanticType | ""); setPage(1); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">全部类型</option>{["DISCOVERY", "BRANDED_SANITY", "CUSTOM"].map(v => <option key={v} value={v}>{formatQueryType(v)}</option>)}
          </select>
          <select aria-label="品牌检查筛选" value={checkFilter} onChange={e => { setCheckFilter(e.target.value as QueryContaminationStatus | ""); setPage(1); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">全部品牌检查</option>{["CLEAN", "TARGET_MENTIONED", "POSSIBLE_TARGET_MENTION"].map(v => <option key={v} value={v}>{formatTargetCheck(v)}</option>)}
          </select>
          <select aria-label="问题状态筛选" value={statusFilter} onChange={e => { setStatusFilter(e.target.value as QueryStatusFilter | ""); setPage(1); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">全部状态</option><option value="enabled">启用</option><option value="disabled">停用</option></select>
          <select aria-label="问题排序" value={sort} onChange={e => { setSort(e.target.value as QuerySort); setPage(1); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="createdAt">按创建时间</option><option value="queryText">按问题文字</option><option value="queryType">按问题类型</option><option value="status">按启用状态</option></select>
          <select aria-label="排序方向" value={order} onChange={e => { setOrder(e.target.value as SortOrder); setPage(1); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="asc">升序</option><option value="desc">降序</option></select>
          <button type="button" onClick={resetFilters} className="px-2 py-2 text-sm text-teal-700 hover:underline">重置</button>
        </div>
        {selectedIds.size > 0 && <div className="flex flex-wrap items-center gap-2 border-b border-teal-100 bg-teal-50 px-4 py-3 text-sm">
          <span className="font-medium text-teal-900">已选 {selectedIds.size} 条</span>
          {recycleBin ? (
            <button type="button" className="ui-button" disabled title="后端暂未提供恢复接口">恢复（后端待接入）</button>
          ) : (
            <>
              <button type="button" className="ui-button" disabled={busy} onClick={() => void applyBatch("enable")}>批量启用</button>
              <button type="button" className="ui-button" disabled={busy} onClick={() => void applyBatch("disable")}>批量停用</button>
              <button type="button" className="ui-button" disabled={busy} onClick={() => setArchiveOpen(true)}>归档</button>
              <button type="button" className="ui-button" disabled={busy} onClick={() => void openMoveDialog()}>移动到其他问题集</button>
            </>
          )}
          <button type="button" className="ml-auto text-teal-700 underline" onClick={() => setSelectedIds(new Set())}>清空选择</button>
        </div>}
        {queryError ? <div className="p-4"><ErrorState title="问题列表加载失败" error={queryError} retry={() => setQueryRevision(value => value + 1)} /></div> : queryLoading ? <div className="p-4"><LoadingSkeleton rows={6} /></div> : queryItems.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">{recycleBin ? "回收站暂无已归档问题。" : "当前筛选条件下暂无问题。"}</p> : <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>
              <th scope="col" className="w-12 px-4 py-3"><input type="checkbox" aria-label="选择当前页全部问题" checked={allPageSelected} onChange={event => setSelectedIds(current => togglePageSelection(current, pageIds, event.target.checked))} /></th>
              {["问题", "类型", "品牌检查", "来源", "状态"].map(label => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}
            </tr></thead>
            <tbody>
              {queryItems.map(q => <tr key={q.id} className="h-12 border-t border-slate-100 align-top hover:bg-slate-50/70">
                <td className="px-4 py-3"><input type="checkbox" aria-label={`选择问题：${q.queryText}`} checked={selectedIds.has(q.id)} onChange={event => setSelectedIds(current => togglePageSelection(current, [q.id], event.target.checked))} /></td>
                <td className="max-w-lg px-4 py-3"><div className="break-words text-slate-800">{q.queryText}</div><details className="mt-1 text-xs text-slate-500"><summary className="w-fit cursor-pointer hover:text-teal-700">问题详情</summary><div className="mt-2 space-y-1 break-all"><div>问题编号：{q.id}</div><div>分类：{q.category}</div><div>意图：{q.intent}</div><div>语言：{q.locale}</div><div>原始类型：{q.queryType ?? "未设置"}</div><div>原始来源：{q.source ?? "未设置"}</div></div></details></td>
                <td className="px-4 py-3"><span className={`inline-block whitespace-nowrap rounded px-2 py-1 text-xs ${TYPE_BADGE[effectiveType(q)] ?? "bg-slate-100 text-slate-600"}`}>{formatQueryType(effectiveType(q))}</span></td>
                <td className="max-w-64 px-4 py-3"><details className="text-xs"><summary className="cursor-pointer text-teal-700 underline decoration-dotted underline-offset-4">{q.contamination ? formatTargetCheck(q.contamination.status) : "未检查"}</summary><div className="mt-2 space-y-1 leading-5 text-slate-500"><p>{q.contamination?.status === "CLEAN" ? "按当前检查结果，问题没有包含目标品牌别名。" : q.contamination?.status === "TARGET_MENTIONED" ? "问题直接提及目标品牌，可能引导回答；这类问题不应作为自然发现问题。" : q.contamination?.status === "POSSIBLE_TARGET_MENTION" ? "链接中可能包含目标品牌，请检查问题原文。" : "尚无可解释的品牌检查结果。"}</p>{q.contamination?.matchedAlias && <p>匹配别名：{q.contamination.matchedAlias}</p>}<p>原始状态：{q.contamination?.status ?? "未检查"}</p></div></details></td>
                <td className="px-4 py-3 text-xs text-slate-600">{q.source ? formatQuerySource(q.source.toUpperCase()) : "—"}</td>
                <td className="px-4 py-3"><span className={`whitespace-nowrap rounded px-2 py-1 text-xs ${q.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{q.enabled ? "启用" : "停用"}</span></td>
              </tr>)}
              {queryItems.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-500">{suite.queryCount > 0 ? <>没有符合筛选条件的问题。<button type="button" onClick={resetFilters} className="ml-2 text-teal-700 underline">清除筛选</button></> : "还没有问题。展开下方「创建监测问题」或「批量导入」添加。"}</td></tr>}
            </tbody>
          </table>
        </div>}
        {!queryError && !queryLoading && <div className="border-t border-slate-200 px-4 py-3"><Pagination page={page} pageSize={pageSize} total={queryTotal} onChange={setPage} /></div>}
      </section>

      {/* 问题生成器 */}
      <details className="rounded-lg border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-base font-semibold text-slate-700">创建监测问题</summary>
        <p className="text-xs text-slate-500">{QUERY_WORKSPACE_NAV.builderNote}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <label className="block"><span className="text-[11px] text-slate-500">产品类别</span>
            <input value={bCategory} onChange={e => setBCategory(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" placeholder="如 CRM SaaS" aria-label="产品类别" />
          </label>
          <label className="block"><span className="text-[11px] text-slate-500">场景（逗号分隔）</span>
            <input value={bScenario} onChange={e => setBScenario(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" placeholder="如 销售团队选型,创业初期" aria-label="场景" />
          </label>
          <fieldset className="sm:col-span-3"><legend className="text-xs text-slate-500">希望了解什么（可多选）</legend><div className="mt-2 flex flex-wrap gap-4">{Object.entries(QUERY_INTENT_LABEL).map(([value, label]) => <label key={value} className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={split(bIntents).includes(value)} onChange={e => setBIntents(e.target.checked ? [...split(bIntents), value].join(",") : split(bIntents).filter(v => v !== value).join(","))} />{label}</label>)}</div></fieldset>
          <label className="block"><span className="text-[11px] text-slate-500">人群（可选）</span>
            <input value={bAudience} onChange={e => setBAudience(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" placeholder="如 小团队" aria-label="人群" />
          </label>
          <label className="block"><span className="text-[11px] text-slate-500">条件（可选）</span>
            <input value={bModifiers} onChange={e => setBModifiers(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" placeholder="如 免费,5000 元以内" aria-label="条件" />
          </label>
          <button type="button" onClick={() => void previewBuilder()} disabled={busy || !bCategory.trim() || split(bIntents).length === 0} className="self-end rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-40">预览问题</button>
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
      </details>

      {/* 批量导入 */}
      <details className="rounded-lg border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-base font-semibold text-slate-700">批量导入与版本操作</summary>
        <button type="button" onClick={() => void cloneSuite()} disabled={busy} className="my-3 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">{QUERY_WORKSPACE_NAV.cloneVersion}</button>
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
      </details>

      {archiveOpen && (
        <div role="dialog" aria-modal="true" aria-labelledby="archive-heading" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" onClick={() => setArchiveOpen(false)}>
          <div className="mt-20 w-full max-w-md rounded-lg bg-white p-6 shadow-sm" onClick={event => event.stopPropagation()}>
            <h2 id="archive-heading" className="text-lg font-semibold text-slate-900">归档所选问题</h2>
            <p className="mt-2 text-sm text-slate-600">将归档 {selectedIds.size} 条问题。归档只影响未来执行，不会修改历史运行、报告或 Evidence。</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="ui-button" onClick={() => setArchiveOpen(false)}>取消</button>
              <button type="button" disabled={busy} className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40" onClick={() => void applyBatch("archive")}>确认归档</button>
            </div>
          </div>
        </div>
      )}

      {moveOpen && (
        <div role="dialog" aria-modal="true" aria-labelledby="move-heading" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" onClick={() => setMoveOpen(false)}>
          <div className="mt-20 w-full max-w-md rounded-lg bg-white p-6 shadow-sm" onClick={event => event.stopPropagation()}>
            <h2 id="move-heading" className="text-lg font-semibold text-slate-900">移动到其他问题集</h2>
            <p className="mt-1 text-xs text-slate-500">只显示当前项目下的其他问题集。</p>
            {moveLoading ? <div className="mt-4"><LoadingSkeleton rows={3} /></div> : moveError ? <div className="mt-4"><ErrorState title="问题集加载失败" error={moveError} retry={() => void openMoveDialog()} /></div> : moveSuites.length === 0 ? <p className="mt-4 rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-600">当前项目没有其他可移动的问题集。</p> : <label className="mt-4 block text-sm text-slate-700">目标问题集
              <select value={moveSuiteId} onChange={event => setMoveSuiteId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2" aria-label="目标问题集">
                {moveSuites.map(option => <option key={option.id} value={option.id}>{option.name} {formatVersion(option.version)}</option>)}
              </select>
            </label>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="ui-button" onClick={() => setMoveOpen(false)}>取消</button>
              <button type="button" disabled={busy || moveLoading || !moveSuiteId} className="ui-button primary" onClick={() => void applyBatch("move", moveSuiteId)}>确认移动</button>
            </div>
          </div>
        </div>
      )}

      {/* 运行前确认 */}
      {runOpen && suite && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 overflow-y-auto" onClick={() => setRunOpen(false)}>
          <div className="w-full max-w-lg rounded-lg bg-white p-6 text-slate-900 shadow-sm" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">{QUERY_WORKSPACE_NAV.runPreflight}</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">监测对象</dt><dd className="font-medium">{target?.canonicalName ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">问题集</dt><dd className="font-medium">{suite.name} {formatVersion(suite.version)}</dd></div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">AI 模型</dt>
                <select value={engineId} onChange={e => setEngineId(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" aria-label="AI 模型">
                  {engines.map(en => <option key={en.id} value={en.id}>{en.name}（{en.provider}）{en.configured ? "" : " [未配置]"}</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">模式</dt>
                <select value={runType} onChange={e => setRunType(e.target.value as "demo" | "real")} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" aria-label="模式">
                  <option value="demo">开发模拟（离线测试，零费用）</option>
                  <option value="real">真实（调用真实 AI 模型，产生 API 费用）</option>
                </select>
              </div>
              <div className="flex justify-between"><dt className="text-slate-500">运行类型</dt><dd className="font-medium">{runType === "demo" ? "演示模拟" : "真实付费"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">问题数</dt><dd className="font-medium">{preflight?.queryCount ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">引擎数</dt><dd className="font-medium">{preflight?.engineCount ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">预计调用次数</dt><dd className="font-medium">{preflight?.estimatedCalls ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">预计费用</dt><dd className="font-medium">{preflight ? formatPreflightCost(preflight).replace("预计费用：", "") : "—"}</dd></div>
            </dl>
            <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${runType === "demo" ? "bg-teal-50 text-teal-800" : "bg-amber-50 text-amber-800"}`}>
              {runType === "demo" ? "演示运行使用本地 Mock，不会产生任何真实外部 API 调用或费用。" : "⚠️ 真实运行将向所选已启用 Provider 发起实际 API 请求并计费，请确认授权。"}
            </p>
            {preflightLoading && <div className="mt-3"><LoadingSkeleton rows={3} /></div>}
            {preflightError && <div className="mt-3"><ErrorState title="运行预检失败" error={preflightError} retry={() => { setRunOpen(false); queueMicrotask(() => setRunOpen(true)); }} /></div>}
            {preflightBlockedReason && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700">{preflightBlockedReason}</p>}
            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">{QUERY_WORKSPACE_NAV.preflightNote}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setRunOpen(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">取消</button>
              <button type="button" disabled={busy || !engineId || preflightLoading || !preflight || preflight.blocked} onClick={() => void startRun()} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-40">
                {runType === "real" ? "授权并开始真实 GEO 检测" : "开始 GEO 检测（模拟运行）"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 人工 Web UI 检测设置 */}
      {manualOpen && suite && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 overflow-y-auto" onClick={() => setManualOpen(false)}>
          <div className="w-full max-w-lg rounded-lg bg-white p-6 text-slate-900 shadow-sm" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">{MANUAL_NAV.entry}</h2>
            <p className="mt-1 text-xs text-slate-500">{MANUAL_NAV.entryHint}</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">监测对象</dt><dd className="font-medium">{target?.canonicalName ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">问题集</dt><dd className="font-medium">{suite.name} {formatVersion(suite.version)}</dd></div>
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
    <div className="w-full">
      <SuiteInner />
    </div>
  );
}
