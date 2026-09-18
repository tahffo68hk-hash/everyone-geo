"use client";

import { useMemo, useState } from "react";
import {
  formatPlatform,
  formatVerificationStatus,
  type VerificationAssetListItem,
} from "@/lib/outcome-api";

interface PublishedAssetsTableProps {
  assets: VerificationAssetListItem[];
  onSelectAsset: (assetId: string) => void;
  onTriggerRetest: (assetId: string) => void;
  isTriggering?: boolean;
}

export function PublishedAssetsTable({
  assets,
  onSelectAsset,
  onTriggerRetest,
  isTriggering,
}: PublishedAssetsTableProps) {
  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState("ALL");
  const [verificationFilter, setVerificationFilter] = useState("ALL");

  const filteredAssets = useMemo(() => {
    return assets.filter((item) => {
      if (search) {
        const text = `${item.title} ${item.campaign?.name ?? ""}`.toLowerCase();
        if (!text.includes(search.toLowerCase())) return false;
      }
      if (platformFilter !== "ALL" && item.platform !== platformFilter) {
        return false;
      }
      if (verificationFilter !== "ALL" && item.verificationStatus !== verificationFilter) {
        return false;
      }
      return true;
    });
  }, [assets, search, platformFilter, verificationFilter]);

  if (assets.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center shadow-xs">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-xl text-blue-600">
          📄
        </div>
        <h3 className="mt-3 text-sm font-semibold text-slate-900">项目暂无已发布落地资产</h3>
        <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
          请在内容生产流程中完成排期并模拟发布，确认落地资产后即可在此发起 GEO 复测并查看归因分析。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 搜索与过滤栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="搜索资产标题或所属战役…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-blue-500 min-w-56"
          />

          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:outline-hidden"
          >
            <option value="ALL">全部平台</option>
            <option value="WECHAT">微信公众号</option>
            <option value="XIAOHONGSHU">小红书</option>
            <option value="BILIBILI">Bilibili</option>
            <option value="DOUYIN">抖音</option>
            <option value="WEIBO">微博</option>
          </select>

          <select
            value={verificationFilter}
            onChange={(e) => setVerificationFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:outline-hidden"
          >
            <option value="ALL">全部核验状态</option>
            <option value="PLATFORM_CONFIRMED">平台已确认</option>
            <option value="MANUAL_VERIFIED">人工已核验</option>
            <option value="UNVERIFIED">未核验</option>
          </select>
        </div>

        <span className="text-slate-400">
          共 {filteredAssets.length} / {assets.length} 个已发布资产
        </span>
      </div>

      {/* 资产列表表格 */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
        <table className="w-full text-left text-xs text-slate-700 divide-y divide-slate-100">
          <thead className="bg-slate-50 font-semibold text-slate-600">
            <tr>
              <th className="px-4 py-3 min-w-52">发布内容标题</th>
              <th className="px-3 py-3 min-w-24">发布平台</th>
              <th className="px-3 py-3 min-w-28">核验状态</th>
              <th className="px-3 py-3 min-w-24">复测状态</th>
              <th className="px-3 py-3 min-w-28">最近复测时间</th>
              <th className="px-3 py-3 min-w-20">可比问题</th>
              <th className="px-3 py-3 min-w-20">观测变化</th>
              <th className="px-3 py-3 min-w-44">关联判断分布</th>
              <th className="px-3 py-3 text-right min-w-32">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredAssets.map((asset) => {
              const vStatus = formatVerificationStatus(asset.verificationStatus);
              const retest = asset.latestRetest;
              const dist = asset.attributionDistribution;

              return (
                <tr
                  key={asset.id}
                  onClick={() => onSelectAsset(asset.id)}
                  className="hover:bg-slate-50/80 cursor-pointer transition"
                >
                  {/* 标题 & 战役 */}
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900 line-clamp-1">{asset.title}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      战役: {asset.campaign?.name || "常规生产"} · 发布于{" "}
                      {asset.publishedAt ? new Date(asset.publishedAt).toLocaleDateString("zh-CN") : "-"}
                    </div>
                  </td>

                  {/* 平台 */}
                  <td className="px-3 py-3">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700 border border-slate-200">
                      {formatPlatform(asset.platform)}
                    </span>
                  </td>

                  {/* 核验状态 */}
                  <td className="px-3 py-3">
                    <span className={`inline-flex rounded px-2 py-0.5 text-[11px] font-medium border ${vStatus.badgeClass}`}>
                      {vStatus.label}
                    </span>
                  </td>

                  {/* 复测状态 */}
                  <td className="px-3 py-3">
                    {retest ? (
                      <span className="inline-flex rounded bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 border border-blue-200">
                        第 {retest.sequence} 次 · {retest.status}
                      </span>
                    ) : (
                      <span className="inline-flex rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 border border-slate-200">
                        未复测
                      </span>
                    )}
                  </td>

                  {/* 最近复测时间 */}
                  <td className="px-3 py-3 text-slate-500">
                    {retest?.completedAt ? new Date(retest.completedAt).toLocaleString("zh-CN") : retest ? "执行中…" : "-"}
                  </td>

                  {/* 可比问题数 */}
                  <td className="px-3 py-3 font-medium text-slate-800">
                    {retest ? `${asset.comparableQueryCount} 个` : "-"}
                  </td>

                  {/* 观测到变化问题数 */}
                  <td className="px-3 py-3 font-medium text-slate-800">
                    {retest ? `${asset.changedQueryCount} 个` : "-"}
                  </td>

                  {/* 关联判断分布 */}
                  <td className="px-3 py-3">
                    {retest && dist.total > 0 ? (
                      <div className="flex flex-wrap items-center gap-1 text-[10px]">
                        {dist.likelyRelated > 0 && (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800 border border-emerald-200">
                            相关 {dist.likelyRelated}
                          </span>
                        )}
                        {dist.insufficientEvidence > 0 && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700 border border-slate-200">
                            不足 {dist.insufficientEvidence}
                          </span>
                        )}
                        {dist.confounded > 0 && (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 border border-amber-200">
                            混杂 {dist.confounded}
                          </span>
                        )}
                        {dist.noObservedChange > 0 && (
                          <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-800 border border-sky-200">
                            无变化 {dist.noObservedChange}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>

                  {/* 操作 */}
                  <td className="px-3 py-3 text-right space-x-2">
                    {retest ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectAsset(asset.id);
                        }}
                        className="rounded-md bg-blue-50 px-2.5 py-1 text-blue-700 hover:bg-blue-100 font-medium transition"
                      >
                        效果详情
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isTriggering}
                        onClick={(e) => {
                          e.stopPropagation();
                          onTriggerRetest(asset.id);
                        }}
                        className="rounded-md bg-slate-900 px-2.5 py-1 text-white hover:bg-slate-800 disabled:opacity-50 font-medium transition"
                      >
                        发起复测
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
