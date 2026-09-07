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

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">{TARGET_NAV.canonicalName}</span>
            <input value={form.canonicalName} onChange={e => setForm({ ...form, canonicalName: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="如：ProjectMentor / AcmeFlow" aria-label={TARGET_NAV.canonicalName} />
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

      <section className="rounded-xl border border-slate-200 bg-white p-4">
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
          <input value={newAlias.alias} onChange={e => setNewAlias({ ...newAlias, alias: e.target.value })} placeholder="新别名，如 Project Mentor" className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-64" aria-label="新别名" />
          <select value={newAlias.aliasType} onChange={e => setNewAlias({ ...newAlias, aliasType: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-2 text-sm" aria-label={TARGET_NAV.aliasType}>
            {Object.entries({ OFFICIAL: "官方", PRODUCT: "产品名", ABBREVIATION: "缩写", LOCALIZED: "本地化", CUSTOM: "自定义" }).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button type="button" onClick={() => void addAlias()} disabled={busy || !newAlias.alias.trim() || !target?.brandId} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">
            {TARGET_NAV.addAlias}
          </button>
        </div>
      </section>

      {!target && (
        <section className="rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-4 text-sm text-amber-800">
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
