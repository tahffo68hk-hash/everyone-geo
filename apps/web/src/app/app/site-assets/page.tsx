"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  formatAssetMappingType, formatOpportunityAsset, formatSiteAssetSource,
  formatSiteAssetStatus, formatSnapshotType, friendlyError, SITE_NAV,
} from "@/lib/labels";

type Project = { id: string; name: string };
type Site = { id: string; name: string; baseUrl: string; status: string; assetCount: number };
type Asset = {
  id: string; url: string; canonicalUrl: string; assetType: string | null; title: string | null;
  status: string; source: string; lastObservedAt: string | null; contentHash: string | null;
  snapshotCount: number | null; mappingCount: number | null;
};
type Mapping = {
  id: string; siteAssetId: string | null; mappingType: string; confirmedByUser: boolean;
  siteAsset: { id: string; url: string; title: string | null; assetType: string | null } | null;
};

function SiteAssetsInner() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [mappings, setMappings] = useState<Record<string, Mapping[]>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newSite, setNewSite] = useState({ name: "", baseUrl: "" });
  const [newAsset, setNewAsset] = useState({ url: "", title: "", assetType: "USE_CASE_PAGE" });

  useEffect(() => {
    api<{ projects: Project[] }>("/monitor-tasks/options")
      .then(data => {
        setProjects(data.projects);
        if (data.projects[0]) setProjectId(data.projects[0]!.id);
      })
      .catch(err => setError(friendlyError(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (projectId) loadSites(); }, [projectId]);

  async function loadSites() {
    setLoading(true); setError("");
    try {
      const rows = await api<Site[]>(`/projects/${encodeURIComponent(projectId)}/sites`);
      setSites(rows);
      if (rows[0]) { setSiteId(rows[0]!.id); }
      else { setSiteId(""); setAssets([]); setMappings({}); }
    } catch (e) { setError(friendlyError(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (siteId) loadAssets(); }, [siteId]);

  async function loadAssets() {
    setLoading(true); setError("");
    try {
      const rows = await api<{ assets: Asset[] }>(`/sites/${siteId}/assets`);
      setAssets(rows.assets);
      const m: Record<string, Mapping[]> = {};
      for (const a of rows.assets) {
        if (!a.mappingCount) { m[a.id] = []; continue; }
        const r = await api<{ mappings: Mapping[] }>(`/content-opportunities/${a.id}/asset-mappings`).catch(() => null);
        void r;
      }
      setMappings(m);
    } catch (e) { setError(friendlyError(e)); }
    finally { setLoading(false); }
  }

  async function createSite() {
    if (!newSite.name.trim() || !newSite.baseUrl.trim()) return;
    setBusy(true); setError("");
    try {
      await api(`/projects/${encodeURIComponent(projectId)}/sites`, {
        method: "POST",
        body: JSON.stringify({ name: newSite.name.trim(), baseUrl: newSite.baseUrl.trim() }),
      });
      setNewSite({ name: "", baseUrl: "" });
      await loadSites();
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  async function addAsset() {
    if (!newAsset.url.trim()) return;
    setBusy(true); setError("");
    try {
      const created = await api<{ id: string }>(`/sites/${siteId}/assets`, {
        method: "POST",
        body: JSON.stringify({ url: newAsset.url.trim(), title: newAsset.title.trim() || undefined, assetType: newAsset.assetType }),
      });
      setNewAsset({ url: "", title: "", assetType: "USE_CASE_PAGE" });
      if (created) await loadAssets();
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">{SITE_NAV.title}</h1>
          <p className="mt-1 text-xs text-slate-500">{SITE_NAV.urlSafeNote}</p>
        </div>
        <select
          value={projectId}
          onChange={e => { setProjectId(e.target.value); setSiteId(""); }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          aria-label="选择项目"
        >
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {/* 站点登记 */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={newSite.name} onChange={e => setNewSite({ ...newSite, name: e.target.value })}
            placeholder="站点名称（如：你的品牌官网）"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-56"
            aria-label="站点名称"
          />
          <input
            value={newSite.baseUrl} onChange={e => setNewSite({ ...newSite, baseUrl: e.target.value })}
            placeholder="https://example.com"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-72"
            aria-label="站点地址"
          />
          <button
            type="button" onClick={createSite} disabled={busy || !newSite.name || !newSite.baseUrl}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
          >
            {SITE_NAV.createSite}
          </button>
        </div>
        {sites.length === 0 && !loading && (
          <p className="mt-3 text-sm text-slate-500">{SITE_NAV.noSiteHint}</p>
        )}
        {sites.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {sites.map(s => (
              <button
                key={s.id} type="button"
                onClick={() => setSiteId(s.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${siteId === s.id ? "border-teal-700 bg-teal-50 text-teal-900" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}
              >
                {s.name}
                <span className="ml-1 text-xs text-slate-400">{s.assetCount} 页</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 资产表 */}
      {siteId && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2 pb-3">
            <input
              value={newAsset.url} onChange={e => setNewAsset({ ...newAsset, url: e.target.value })}
              placeholder="页面 URL（同一站点域名）"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm flex-1 min-w-64"
              aria-label="页面 URL"
            />
            <input
              value={newAsset.title} onChange={e => setNewAsset({ ...newAsset, title: e.target.value })}
              placeholder="标题（可选）"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-44"
              aria-label="标题"
            />
            <select
              value={newAsset.assetType} onChange={e => setNewAsset({ ...newAsset, assetType: e.target.value })}
              className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
              aria-label="资产类型"
            >
              <option value="USE_CASE_PAGE">用例页</option>
              <option value="PRODUCT_PAGE">产品页</option>
              <option value="FAQ_PAGE">FAQ</option>
              <option value="GUIDE">指南</option>
              <option value="COMPARISON_PAGE">对比页</option>
              <option value="DATA_REFERENCE">数据参考</option>
              <option value="OTHER">其他</option>
            </select>
            <button
              type="button" onClick={addAsset} disabled={busy || !newAsset.url.trim()}
              className="ui-button primary"
            >
              {SITE_NAV.addAsset}
            </button>
          </div>

          {loading ? (
            <div className="space-y-2" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : assets.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">{SITE_NAV.noAssetHint}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="px-3 py-2 font-medium">页面</th>
                    <th className="px-3 py-2 font-medium">资产类型</th>
                    <th className="px-3 py-2 font-medium">来源</th>
                    <th className="px-3 py-2 font-medium">状态</th>
                    <th className="px-3 py-2 font-medium">快照</th>
                    <th className="px-3 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map(a => (
                    <tr key={a.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <span className="block max-w-80 truncate font-medium text-slate-800">{a.title ?? a.canonicalUrl}</span>
                        <span className="block max-w-80 truncate text-xs text-blue-700">{a.canonicalUrl}</span>
                      </td>
                      <td className="px-3 py-2">{a.assetType ? formatOpportunityAsset(a.assetType) : "未知"}</td>
                      <td className="px-3 py-2">{formatSiteAssetSource(a.source)}</td>
                      <td className="px-3 py-2">{formatSiteAssetStatus(a.status)}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{a.snapshotCount ?? 0} 条</td>
                      <td className="px-3 py-2">
                        <Link href={`/app/site-assets/${a.id}`} className="text-xs text-blue-700 hover:underline">
                          查看详情
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default function SiteAssetsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <SiteAssetsInner />
    </div>
  );
}
