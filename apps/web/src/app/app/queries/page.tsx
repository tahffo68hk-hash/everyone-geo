"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useProjectContext } from "@/components/project-context";
import { api } from "@/lib/api";
import { PageHeader, LoadingSkeleton, EmptyState } from "@/components/ui";
import {
  formatVersion, friendlyError, formatTargetEntityType, QUERY_WORKSPACE_NAV,
} from "@/lib/labels";

type TargetBrief = {
  brandId: string | null; canonicalName: string; entityType: string;
  productCategory: string | null; aliases: Array<{ alias: string; enabled: boolean }>;
};
type Suite = {
  id: string; name: string; version: string; description: string | null; status: string;
  queryCount: number; discoveryCount: number; sanityQueryCount: number; customCount: number;
  createdAt: string;
};

export default function QueriesPage() {
  const { projectId, loading: projectLoading } = useProjectContext();
  const [target, setTarget] = useState<TargetBrief | null>(null);
  const [suites, setSuites] = useState<Suite[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newSuite, setNewSuite] = useState({ name: "", version: "1" });

  async function load(signal?: AbortSignal) {
    if (!projectId) return;
    setError("");
    try {
      const [t, s] = await Promise.all([
        api<TargetBrief | null>(`/projects/${encodeURIComponent(projectId)}/target-profile`, { signal }),
        api<Suite[]>(`/projects/${encodeURIComponent(projectId)}/benchmark-suites`, { signal }),
      ]);
      setTarget(t); setSuites(s);
    } catch (e) { if (!signal?.aborted) setError(friendlyError(e)); }
    finally { if (!signal?.aborted) setLoading(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function createSuite() {
    if (!newSuite.name.trim() || !projectId) return;
    setBusy(true); setError("");
    try {
      await api(`/projects/${encodeURIComponent(projectId)}/benchmark-suites`, {
        method: "POST",
        body: JSON.stringify({ name: newSuite.name.trim(), version: newSuite.version, queries: [] }),
      });
      setNewSuite({ name: "", version: "1" });
      await load();
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  if (projectLoading) return <LoadingSkeleton rows={6} />;
  if (!projectId) {
    return (
      <EmptyState
        title="请先选择监测项目"
        description="选择或创建项目后，方可管理该项目的问题集与评测场景。"
        href="/app/projects/new"
        action="新建监测项目"
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={QUERY_WORKSPACE_NAV.title}
        description={QUERY_WORKSPACE_NAV.pageHint}
      />

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

      {/* 监测对象状态 */}
      <section className={`rounded-2xl border p-4 text-xs shadow-xs ${target?.brandId ? "border-emerald-200 bg-emerald-50/50 text-emerald-950" : "border-amber-200 bg-amber-50/60 text-amber-950"}`}>
        {target?.brandId ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-bold">监测对象：{target.canonicalName}</span>
            <span className="rounded bg-white/80 px-2 py-0.5 font-medium">{formatTargetEntityType(target.entityType)}</span>
            {target.productCategory && <span className="rounded bg-white/80 px-2 py-0.5 font-medium">产品类别：{target.productCategory}</span>}
            {target.aliases.filter(a => a.enabled).length > 0 && (
              <span className="text-emerald-800">别名：{target.aliases.filter(a => a.enabled).map(a => a.alias).join("、")}</span>
            )}
            <Link href={`/app/target?project=${projectId}`} className="ml-auto text-teal-700 font-semibold hover:underline">
              修改监测对象 →
            </Link>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{QUERY_WORKSPACE_NAV.emptyHint}</span>
            <Link href={`/app/target?project=${projectId}`} className="rounded-lg bg-teal-700 px-3 py-1.5 font-semibold text-white hover:bg-teal-800">
              设置监测对象 →
            </Link>
          </div>
        )}
      </section>

      {/* 新建问题集 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <h2 className="text-sm font-bold text-slate-900 mb-3">新建基准测试问题集</h2>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={newSuite.name}
            onChange={e => setNewSuite({ ...newSuite, name: e.target.value })}
            placeholder="问题集名称，如：工具发现 / 购买推荐"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs w-72 focus:border-teal-600 focus:outline-hidden"
            aria-label="问题集名称"
          />
          <input
            value={newSuite.version}
            onChange={e => setNewSuite({ ...newSuite, version: e.target.value })}
            placeholder="版本，例如 1"
            className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-teal-600 focus:outline-hidden"
            aria-label="版本"
          />
          <button
            type="button"
            onClick={() => void createSuite()}
            disabled={busy || !newSuite.name.trim()}
            className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-40 shadow-xs"
          >
            {busy ? "创建中…" : QUERY_WORKSPACE_NAV.create}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">{QUERY_WORKSPACE_NAV.discoveryNote}</p>
      </section>

      {/* 问题集列表 */}
      {loading ? (
        <LoadingSkeleton rows={4} />
      ) : suites.length === 0 ? (
        <EmptyState
          title="暂无测试问题集"
          description={QUERY_WORKSPACE_NAV.emptyHint}
        />
      ) : (
        <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xs">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">基准问题集列表</caption>
            <thead className="border-b border-slate-200 bg-slate-50/80 text-slate-600 font-semibold">
              <tr>
                <th className="p-3">名称</th>
                <th className="p-3">版本</th>
                <th className="p-3">问题数</th>
                <th className="p-3">自然发现</th>
                <th className="p-3">品牌认知测试</th>
                <th className="p-3">自定义</th>
                <th className="p-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {suites.map(s => (
                <tr key={s.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="p-3 font-semibold text-slate-900">{s.name}</td>
                  <td className="p-3 font-mono text-slate-600">{formatVersion(s.version)}</td>
                  <td className="p-3 font-bold tabular-nums text-slate-900">{s.queryCount}</td>
                  <td className="p-3 font-medium tabular-nums text-teal-700">{s.discoveryCount}</td>
                  <td className="p-3 font-medium tabular-nums text-amber-700">{s.sanityQueryCount}</td>
                  <td className="p-3 font-medium tabular-nums text-slate-600">{s.customCount}</td>
                  <td className="p-3 text-right">
                    <Link
                      href={`/app/queries/${s.id}`}
                      className="rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1 text-xs font-semibold inline-block"
                    >
                      打开 →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
