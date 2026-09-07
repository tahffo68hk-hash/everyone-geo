"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  formatQueryType, friendlyError, formatTargetEntityType, QUERY_WORKSPACE_NAV,
} from "@/lib/labels";

type Project = { id: string; name: string };
type TargetBrief = {
  brandId: string | null; canonicalName: string; entityType: string;
  productCategory: string | null; aliases: Array<{ alias: string; enabled: boolean }>;
};
type Suite = {
  id: string; name: string; version: string; description: string | null; status: string;
  queryCount: number; discoveryCount: number; sanityQueryCount: number; customCount: number;
  createdAt: string;
};

function QueriesInner() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [target, setTarget] = useState<TargetBrief | null>(null);
  const [suites, setSuites] = useState<Suite[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newSuite, setNewSuite] = useState({ name: "", version: "1" });

  useEffect(() => {
    api<{ projects: Project[] }>("/monitor-tasks/options")
      .then(d => { setProjects(d.projects); if (d.projects[0]) setProjectId(d.projects[0]!.id); })
      .catch(e => setError(friendlyError(e)));
  }, []);

  async function load() {
    if (!projectId) return;
    setError("");
    try {
      const [t, s] = await Promise.all([
        api<TargetBrief | null>(`/projects/${encodeURIComponent(projectId)}/target-profile`),
        api<Suite[]>(`/projects/${encodeURIComponent(projectId)}/benchmark-suites`),
      ]);
      setTarget(t); setSuites(s);
    } catch (e) { setError(friendlyError(e)); }
  }
  useEffect(() => { void load(); }, [projectId]);

  async function createSuite() {
    if (!newSuite.name.trim() || !projectId) return;
    setBusy(true); setError("");
    try {
      // 空壳 suite（后续在详情页添加问题）
      await api(`/projects/${encodeURIComponent(projectId)}/benchmark-suites`, {
        method: "POST",
        body: JSON.stringify({ name: newSuite.name.trim(), version: newSuite.version, queries: [] }),
      });
      setNewSuite({ name: "", version: "1" });
      await load();
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">{QUERY_WORKSPACE_NAV.title}</h1>
          <p className="mt-1 text-xs text-slate-500">{QUERY_WORKSPACE_NAV.pageHint}</p>
        </div>
        <select value={projectId} onChange={e => setProjectId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label="选择项目">
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {/* 监测对象状态 */}
      <section className={`rounded-xl border p-4 text-sm ${target?.brandId ? "border-emerald-200 bg-emerald-50/60 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
        {target?.brandId ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">监测对象：{target.canonicalName}</span>
            <span className="rounded bg-white/70 px-2 py-0.5 text-xs">{formatTargetEntityType(target.entityType)}</span>
            {target.productCategory && <span className="rounded bg-white/70 px-2 py-0.5 text-xs">产品类别：{target.productCategory}</span>}
            {target.aliases.filter(a => a.enabled).length > 0 && (
              <span className="text-xs text-emerald-700">别名：{target.aliases.filter(a => a.enabled).map(a => a.alias).join("、")}</span>
            )}
            <Link href="/app/target" className="ml-auto text-xs text-blue-700 hover:underline">修改监测对象 →</Link>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span>{QUERY_WORKSPACE_NAV.emptyHint}</span>
            <Link href="/app/target" className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">设置监测对象 →</Link>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input value={newSuite.name} onChange={e => setNewSuite({ ...newSuite, name: e.target.value })} placeholder="问题集名称，如：工具发现 / 购买推荐" className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-72" aria-label="问题集名称" />
          <input value={newSuite.version} onChange={e => setNewSuite({ ...newSuite, version: e.target.value })} placeholder="v1" className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label="版本" />
          <button type="button" onClick={() => void createSuite()} disabled={busy || !newSuite.name.trim()} className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-40">
            {QUERY_WORKSPACE_NAV.create}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">{QUERY_WORKSPACE_NAV.discoveryNote}</p>
      </section>

      {suites.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">{QUERY_WORKSPACE_NAV.emptyHint}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-3 py-2 font-medium">名称</th>
                <th className="px-3 py-2 font-medium">版本</th>
                <th className="px-3 py-2 font-medium">问题数</th>
                <th className="px-3 py-2 font-medium">自然发现</th>
                <th className="px-3 py-2 font-medium">品牌认知测试</th>
                <th className="px-3 py-2 font-medium">自定义</th>
                <th className="px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {suites.map(s => (
                <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-800">{s.name}</td>
                  <td className="px-3 py-2 text-slate-600">v{s.version}</td>
                  <td className="px-3 py-2">{s.queryCount}</td>
                  <td className="px-3 py-2 text-teal-700">{s.discoveryCount}</td>
                  <td className="px-3 py-2 text-amber-700">{s.sanityQueryCount}</td>
                  <td className="px-3 py-2">{s.customCount}</td>
                  <td className="px-3 py-2">
                    <Link href={`/app/queries/${s.id}`} className="rounded-lg bg-slate-800 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700">打开</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function QueriesPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <QueriesInner />
    </div>
  );
}
