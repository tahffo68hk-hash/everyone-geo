"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  formatAliasType, formatTargetEntityType, friendlyError, TARGET_NAV,
} from "@/lib/labels";

type Project = { id: string; name: string };
type Alias = { id: string | null; alias: string; aliasType: string; enabled: boolean };
type Target = {
  projectId: string; brandId: string | null; canonicalName: string;
  entityType: string; productCategory: string | null; website: string | null;
  description: string | null; aliases: Alias[];
};

function TargetInner() {
  const params = useSearchParams();
  const projectParam = params.get("project");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [target, setTarget] = useState<Target | null>(null);
  const [form, setForm] = useState({ canonicalName: "", entityType: "PRODUCT", productCategory: "", website: "", description: "" });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolvedInfo, setResolvedInfo] = useState<{
    brandName?: string;
    fullName?: string;
    region?: string;
    industry?: string;
    aliases?: string[];
    competitors?: string[];
    coreKeywords?: string[];
    discoveryQueries?: Array<{ text: string; category: string; intent: string }>;
  } | null>(null);
  const [newAlias, setNewAlias] = useState({ alias: "", aliasType: "CUSTOM" });

  useEffect(() => {
    api<{ projects: Project[] }>("/monitor-tasks/options")
      .then(d => {
        setProjects(d.projects);
        const requested = projectParam ? d.projects.find(p => p.id === projectParam) : undefined;
        setProjectId((requested ?? d.projects[0])?.id ?? "");
      })
      .catch(e => setError(friendlyError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    if (!projectId) return;
    setError(""); setSaved("");
    try {
      const t = await api<Target | null>(`/projects/${encodeURIComponent(projectId)}/target-profile`);
      setTarget(t);
      setForm({
        canonicalName: t?.canonicalName ?? "", entityType: t?.entityType ?? "PRODUCT",
        productCategory: t?.productCategory ?? "", website: t?.website ?? "", description: t?.description ?? "",
      });
    } catch (e) { setError(friendlyError(e)); }
  }
  useEffect(() => { void load(); }, [projectId]);

  async function save() {
    setBusy(true); setError(""); setSaved("");
    try {
      const t = await api<Target>(`/projects/${encodeURIComponent(projectId)}/target-profile`, {
        method: "PUT",
        body: JSON.stringify({
          canonicalName: form.canonicalName.trim(), entityType: form.entityType,
          productCategory: form.productCategory.trim() || null,
          website: form.website.trim() || null, description: form.description.trim() || null,
        }),
      });
      setTarget(t); setSaved("已保存。只影响之后的新检测，历史结果不会重新计算。");
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  async function resolveBrand() {
    if (!projectId || !form.canonicalName.trim()) {
      setError("请先输入品牌/产品主名称，再执行智能解析");
      return;
    }
    setResolving(true);
    setError("");
    setSaved("");
    try {
      const res = await api<{
        data?: {
          brandName: string;
          fullName: string;
          region: string;
          industry: string;
          aliases: string[];
          competitors: string[];
          coreKeywords: string[];
          discoveryQueries: Array<{ text: string; category: string; intent: string }>;
        };
      }>(`/projects/${encodeURIComponent(projectId)}/ai/resolve-brand`, {
        method: "POST",
        body: JSON.stringify({ brandName: form.canonicalName.trim() }),
      });

      if (res && res.data) {
        const d = res.data;
        setResolvedInfo(d);
        setForm(prev => ({
          ...prev,
          canonicalName: d.brandName || prev.canonicalName,
          productCategory: d.industry || prev.productCategory,
          description: prev.description || (d.fullName ? `${d.fullName}${d.region ? ` (${d.region})` : ""}，主营领域：${d.industry || ""}` : prev.description),
        }));
        setSaved(`AI 智能解析成功：已补全企业全称与主营品类，识别出 ${d.competitors?.length || 0} 个同赛道竞品及 ${d.aliases?.length || 0} 个关联别名建议。`);
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setResolving(false);
    }
  }

  async function quickAddAlias(aliasText: string) {
    if (!projectId || !target?.brandId || !aliasText.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api(`/projects/${encodeURIComponent(projectId)}/target-aliases`, {
        method: "POST",
        body: JSON.stringify({ alias: aliasText.trim(), aliasType: "CUSTOM" }),
      });
      await load();
      setSaved(`已成功添加别名: ${aliasText}`);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function addAlias() {
    setBusy(true); setError("");
    try {
      await api(`/projects/${encodeURIComponent(projectId)}/target-aliases`, {
        method: "POST", body: JSON.stringify({ alias: newAlias.alias.trim(), aliasType: newAlias.aliasType }),
      });
      setNewAlias({ alias: "", aliasType: "CUSTOM" });
      await load();
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  async function toggleAlias(a: Alias, enabled: boolean) {
    if (!a.id) return;
    setBusy(true); setError("");
    try {
      await api(`/target-aliases/${a.id}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
      await load();
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }
  async function deleteAlias(a: Alias) {
    if (!a.id) return;
    setBusy(true); setError("");
    try {
      await api(`/target-aliases/${a.id}`, { method: "DELETE" });
      await load();
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">{TARGET_NAV.title}</h1>
          <p className="mt-1 text-xs text-slate-500">{TARGET_NAV.historyNote}</p>
        </div>
        <select value={projectId} onChange={e => setProjectId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label="选择项目">
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {saved && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{saved}</p>}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600">{TARGET_NAV.canonicalName}</span>
              <button
                type="button"
                onClick={() => void resolveBrand()}
                disabled={resolving || busy || !form.canonicalName.trim()}
                className="flex items-center gap-1 rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-40"
                title="利用大模型逆向解析企业全称、竞品与行业分类"
              >
                {resolving ? "✨ 解析中..." : "✨ AI 智能解析"}
              </button>
            </div>
            <input value={form.canonicalName} onChange={e => setForm({ ...form, canonicalName: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="如：AcmeFlow / CleanBot（虚构示例）" aria-label={TARGET_NAV.canonicalName} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">{TARGET_NAV.entityType}</span>
            <select value={form.entityType} onChange={e => setForm({ ...form, entityType: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label={TARGET_NAV.entityType}>
              {Object.entries({ BRAND: "品牌", PRODUCT: "产品", SERVICE: "服务", ORGANIZATION: "组织", OTHER: "其他" }).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-slate-600">{TARGET_NAV.productCategory}</span>
            <input value={form.productCategory} onChange={e => setForm({ ...form, productCategory: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="如：大学生创新创业 AI 工具 / CRM SaaS" aria-label={TARGET_NAV.productCategory} />
            <span className="text-[11px] text-slate-400">{TARGET_NAV.productCategoryHint}</span>
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs font-medium text-slate-600">{TARGET_NAV.website}</span>
            <input value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="https://…" aria-label={TARGET_NAV.website} />
          </label>
        </div>
        <button type="button" onClick={() => void save()} disabled={busy || !form.canonicalName.trim()} className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40">
          {TARGET_NAV.save}
        </button>
      </section>

      {resolvedInfo && (
        <section className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-indigo-900 flex items-center gap-1.5">
              <span>✨</span>
              <span>AI 品牌与竞品画像透视</span>
            </h2>
            <button
              type="button"
              onClick={() => setResolvedInfo(null)}
              className="text-xs text-indigo-600 hover:text-indigo-800"
            >
              收起
            </button>
          </div>
          <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
            <div>
              <span className="text-slate-500">企业全称:</span>{" "}
              <span className="font-medium text-slate-800">{resolvedInfo.fullName || "未识别"}</span>
            </div>
            <div>
              <span className="text-slate-500">主营赛道:</span>{" "}
              <span className="font-medium text-slate-800">{resolvedInfo.industry || "未识别"}</span>
            </div>
            {resolvedInfo.region && (
              <div>
                <span className="text-slate-500">属地:</span>{" "}
                <span className="font-medium text-slate-800">{resolvedInfo.region}</span>
              </div>
            )}
          </div>

          {resolvedInfo.competitors && resolvedInfo.competitors.length > 0 && (
            <div className="mt-3">
              <span className="text-xs font-semibold text-slate-700">同赛道竞品识别（对标矩阵）：</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {resolvedInfo.competitors.map((c, i) => (
                  <span key={i} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 shadow-sm">
                    ⚔️ {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {resolvedInfo.aliases && resolvedInfo.aliases.length > 0 && (
            <div className="mt-3">
              <span className="text-xs font-semibold text-slate-700">建议监测别名（点击一键加入）：</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {resolvedInfo.aliases.map((a, i) => {
                  const alreadyAdded = target?.aliases.some(ea => ea.alias.toLowerCase() === a.toLowerCase());
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={alreadyAdded || busy || !target?.brandId}
                      onClick={() => void quickAddAlias(a)}
                      className={`rounded-md border px-2 py-1 text-xs transition ${
                        alreadyAdded
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 cursor-default"
                          : "border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50"
                      }`}
                      title={alreadyAdded ? "已在监测列表中" : "点击添加到别名监测"}
                    >
                      {alreadyAdded ? "✓ " : "+ "}{a}
                    </button>
                  );
                })}
              </div>
              {!target?.brandId && (
                <p className="mt-1 text-[11px] text-amber-700">提示：请先保存上方品牌基本信息，即可直接点击一键添加别名。</p>
              )}
            </div>
          )}

          {resolvedInfo.discoveryQueries && resolvedInfo.discoveryQueries.length > 0 && (
            <div className="mt-3 border-t border-indigo-100 pt-3">
              <span className="text-xs font-semibold text-slate-700">Discovery 自然发现提问建议（无品牌词污染）：</span>
              <div className="mt-1.5 space-y-1">
                {resolvedInfo.discoveryQueries.slice(0, 3).map((q, i) => (
                  <div key={i} className="rounded bg-white/80 px-2.5 py-1.5 text-xs text-slate-700 border border-indigo-100 flex items-center justify-between">
                    <span>{q.text}</span>
                    <span className="text-[10px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">{q.category}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">{TARGET_NAV.aliases}</h2>
        <p className="mt-1 text-xs text-slate-500">{TARGET_NAV.aliasesHint}</p>
        {target?.aliases.length === 0 && <p className="mt-2 text-sm text-slate-400">{TARGET_NAV.noAlias}</p>}
        <ul className="mt-2 space-y-1">
          {target?.aliases.map(a => (
            <li key={a.id ?? `legacy-${a.alias}`} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
              <span>
                {a.alias}
                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{formatAliasType(a.aliasType)}</span>
                {!a.enabled && <span className="ml-2 text-xs text-rose-500">已停用</span>}
              </span>
              {a.id ? (
                <span className="flex gap-1">
                  <button type="button" onClick={() => void toggleAlias(a, !a.enabled)} className="text-xs text-blue-700 hover:underline">{a.enabled ? "停用" : "启用"}</button>
                  <button type="button" onClick={() => void deleteAlias(a)} className="text-xs text-rose-600 hover:underline">删除</button>
                </span>
              ) : <span className="text-[10px] text-slate-300">历史别名</span>}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={newAlias.alias} onChange={e => setNewAlias({ ...newAlias, alias: e.target.value })} placeholder="新别名，如 Acme Flow" className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-64" aria-label="新别名" />
          <select value={newAlias.aliasType} onChange={e => setNewAlias({ ...newAlias, aliasType: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-2 text-sm" aria-label={TARGET_NAV.aliasType}>
            {Object.entries({ OFFICIAL: "官方", PRODUCT: "产品名", ABBREVIATION: "缩写", LOCALIZED: "本地化", CUSTOM: "自定义" }).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button type="button" onClick={() => void addAlias()} disabled={busy || !newAlias.alias.trim() || !target?.brandId} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">
            {TARGET_NAV.addAlias}
          </button>
        </div>
      </section>

      {!target && (
        <section className="rounded-lg border border-dashed border-amber-300 bg-amber-50/60 p-4 text-sm text-amber-800">
          {TARGET_NAV.emptyHint}
        </section>
      )}
    </div>
  );
}

export default function TargetPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-3xl px-4 py-6"><p className="text-sm text-slate-500">正在加载监测对象…</p></div>}>
      <div className="mx-auto max-w-3xl px-4 py-6">
        <TargetInner />
      </div>
    </Suspense>
  );
}
