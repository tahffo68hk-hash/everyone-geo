"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  formatAssetMappingType, formatOpportunityAsset, formatSiteAssetSource,
  formatSnapshotType, friendlyError, SITE_NAV,
} from "@/lib/labels";

type AssetDetail = {
  id: string; url: string; canonicalUrl: string; assetType: string | null; title: string | null;
  status: string; source: string; lastObservedAt: string | null; contentHash: string | null;
  site: { id: string; name: string; baseUrl: string };
  recentSnapshots: Array<{ id: string; snapshotType: string; capturedAt: string; contentHash: string; textLength: number | null }>;
  mappedOpportunities: Array<{ mappingId: string; contentOpportunityId: string; titleDirection: string; mappingType: string; confirmedByUser: boolean }>;
};

function AssetInner() {
  const { id } = useParams<{ id: string }>();
  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState({ title: "", text: "", snapshotType: "BEFORE_CHANGE" });

  async function load() {
    setError("");
    try {
      const data = await api<AssetDetail>(`/site-assets/${id}`);
      setAsset(data);
      setManual({ ...manual, title: data.title ?? "" });
    } catch (e) { setError(friendlyError(e)); }
  }

  useEffect(() => { load().catch(() => undefined); /* eslint-disable-line */ }, [id]);

  async function capture(type: string) {
    setBusy(type); setError("");
    try {
      await api(`/site-assets/${id}/snapshots/capture?type=${type}`, { method: "POST" });
      await load();
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(null); }
  }

  async function submitManual() {
    setBusy("manual"); setError("");
    try {
      await api(`/site-assets/${id}/snapshots/manual`, {
        method: "POST",
        body: JSON.stringify({ snapshotType: manual.snapshotType, title: manual.title.trim() || undefined, text: manual.text }),
      });
      setManual(m => ({ ...m, text: "" }));
      await load();
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(null); }
  }

  if (!asset && !error) return <div className="space-y-2" aria-busy="true">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />)}</div>;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/app/site-assets" className="text-xs text-blue-700 hover:underline">← 返回站点资产</Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-800">{asset?.title ?? asset?.canonicalUrl ?? "站点资产"}</h1>
        <p className="mt-1 text-xs text-slate-500">{asset?.site.name} · {asset?.site.baseUrl}</p>
      </div>
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {asset && (
        <>
          <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div><dt className="text-xs text-slate-500">资产类型</dt><dd className="mt-0.5">{asset.assetType ? formatOpportunityAsset(asset.assetType) : "未知"}</dd></div>
              <div><dt className="text-xs text-slate-500">来源</dt><dd className="mt-0.5">{formatSiteAssetSource(asset.source)}</dd></div>
              <div><dt className="text-xs text-slate-500">状态</dt><dd className="mt-0.5">{asset.status}</dd></div>
              <div><dt className="text-xs text-slate-500">内容 Hash</dt><dd className="mt-0.5 font-mono text-xs">{asset.contentHash ?? "—"}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-blue-700 break-all">{asset.canonicalUrl}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={busy !== null} onClick={() => capture("BEFORE_CHANGE")} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-40">
                抓取并记录变更前（BEFORE）
              </button>
              <button type="button" disabled={busy !== null} onClick={() => capture("AFTER_CHANGE")} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-40">
                抓取并记录变更后（AFTER）
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">{SITE_NAV.urlSafeNote}</p>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-700">{SITE_NAV.manualSnapshot}</h2>
            <p className="mt-1 text-xs text-slate-500">{SITE_NAV.manualSnapshotHint}</p>
            <div className="mt-3 flex flex-wrap items-start gap-2">
              <select
                value={manual.snapshotType}
                onChange={e => setManual({ ...manual, snapshotType: e.target.value })}
                className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                aria-label="快照类型"
              >
                <option value="BEFORE_CHANGE">变更前（BEFORE_CHANGE）</option>
                <option value="AFTER_CHANGE">变更后（AFTER_CHANGE）</option>
                <option value="MANUAL_IMPORT">观察（MANUAL_IMPORT）</option>
              </select>
              <input
                value={manual.title} onChange={e => setManual({ ...manual, title: e.target.value })}
                placeholder="页面标题"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm w-56"
                aria-label="页面标题"
              />
              <textarea
                value={manual.text} onChange={e => setManual({ ...manual, text: e.target.value })}
                placeholder="页面关键文本（用于计算变更 hash）"
                className="min-h-16 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                aria-label="页面文本"
              />
              <button
                type="button" disabled={busy !== null || (!manual.title.trim() && !manual.text.trim())}
                onClick={submitManual}
                className="ui-button primary"
              >
                录入
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-700">快照历史</h2>
            {asset.recentSnapshots.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">暂无快照</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                      <th className="px-3 py-2 font-medium">类型</th>
                      <th className="px-3 py-2 font-medium">时间</th>
                      <th className="px-3 py-2 font-medium">Hash</th>
                      <th className="px-3 py-2 font-medium">文本长度</th>
                    </tr>
                  </thead>
                  <tbody>
                    {asset.recentSnapshots.map(s => (
                      <tr key={s.id} className="border-b border-slate-100">
                        <td className="px-3 py-2">{formatSnapshotType(s.snapshotType)}</td>
                        <td className="px-3 py-2 text-xs">{new Date(s.capturedAt).toLocaleString()}</td>
                        <td className="px-3 py-2 font-mono text-xs">{s.contentHash.slice(0, 16)}…</td>
                        <td className="px-3 py-2 text-xs">{s.textLength ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-700">关联内容机会</h2>
            {asset.mappedOpportunities.length === 0 ? (
              <p className="py-3 text-sm text-slate-500">尚未关联内容机会</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {asset.mappedOpportunities.map(m => (
                  <li key={m.mappingId} className="flex items-center justify-between gap-2 border-b border-slate-100 py-1.5">
                    <Link href={`/app/opportunities/${m.contentOpportunityId}`} className="text-blue-700 hover:underline">
                      {m.titleDirection}
                    </Link>
                    <span className="text-xs text-slate-500">{formatAssetMappingType(m.mappingType)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default function SiteAssetDetailPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <AssetInner />
    </div>
  );
}
