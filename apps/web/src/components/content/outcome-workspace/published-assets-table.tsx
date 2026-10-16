"use client";

import { useMemo, useState } from "react";
import {
  formatAssetPublicationTime,
  formatPlatform,
  formatRetestStatus,
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
      <div className="surface p-12 text-center">
        <span className="empty-mark" aria-hidden="true">
          📄
        </span>
        <h3 className="mt-2 text-base font-semibold text-slate-900">暂无已确认公开发布的内容</h3>
        <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
          在多平台完成内容真实发布并核验公开落地链接后，系统将自动汇总落地资产，并在此支持 GEO 复测与客观归因分析。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      {/* 搜索与过滤栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="搜索资产标题或所属战役…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-teal-600 min-w-64"
          />

          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:outline-hidden focus:border-teal-600"
          >
            <option value="ALL">全部发布渠道</option>
            <option value="WECHAT">微信公众号</option>
            <option value="XIAOHONGSHU">小红书</option>
            <option value="BILIBILI">Bilibili</option>
            <option value="DOUYIN">抖音</option>
            <option value="WEIBO">微博</option>
          </select>

          <select
            value={verificationFilter}
            onChange={(e) => setVerificationFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:outline-hidden focus:border-teal-600"
          >
            <option value="ALL">全部核验状态</option>
            <option value="PLATFORM_CONFIRMED">平台已确认</option>
            <option value="MANUAL_VERIFIED">人工已核验</option>
            <option value="UNVERIFIED">未核验</option>
          </select>
        </div>

        <span className="text-slate-400 text-xs">
          共 {filteredAssets.length} / {assets.length} 个落地资产
        </span>
      </div>

      {/* 资产列表表格 */}
      <div className="surface table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th className="min-w-60">发布内容标题与所属战役</th>
              <th className="min-w-24">发布渠道</th>
              <th className="min-w-28">落地核验</th>
              <th className="min-w-32">GEO 复测状态</th>
              <th className="min-w-36">最近复测时间</th>
              <th className="min-w-28">可比评测 / 观测变化</th>
              <th className="min-w-44">关联判断分布</th>
              <th className="text-right min-w-24 sticky-col-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredAssets.map((asset) => {
              const vStatus = formatVerificationStatus(asset.verificationStatus);
              const retest = asset.latestRetest;
              const rStatus = formatRetestStatus(retest?.status);
              const dist = asset.attributionDistribution;

              return (
                <tr
                  key={asset.id}
                  onClick={() => onSelectAsset(asset.id)}
                  className="cursor-pointer"
                >
                  {/* 标题 & 战役 */}
                  <td>
                    <div className="font-semibold text-slate-900 line-clamp-1">{asset.title}</div>
                    <small>
                      战役: {asset.campaign?.name || "常规生产"} · {formatAssetPublicationTime(asset)}
                    </small>
                  </td>

                  {/* 平台 */}
                  <td>
                    <span className="status-badge">
                      {formatPlatform(asset.platform)}
                    </span>
                  </td>

                  {/* 核验状态 */}
                  <td>
                    <span className={`status-badge ${vStatus.badgeClass}`}>
                      {vStatus.label}
                    </span>
                  </td>

                  {/* 复测状态 */}
                  <td>
                    {retest ? (
                      <span className={`status-badge ${rStatus.badgeClass}`}>
                        第 {retest.sequence} 次 · {rStatus.label}
                      </span>
                    ) : (
                      <span className="status-badge text-slate-400">
                        待复测
                      </span>
                    )}
                  </td>

                  {/* 最近复测时间 */}
                  <td className="text-xs text-slate-500">
                    {retest?.completedAt
                      ? new Date(retest.completedAt).toLocaleString("zh-CN", { hour12: false })
                      : retest
                      ? "评测执行中…"
                      : "—"}
                  </td>

                  {/* 可比评测数与变化 */}
                  <td>
                    {retest ? (
                      <span className="font-medium text-slate-800 text-xs">
                        {asset.comparableQueryCount} 可比 <span className="text-slate-300">/</span>{" "}
                        <span className={asset.changedQueryCount > 0 ? "text-teal-700 font-semibold" : "text-slate-600"}>
                          {asset.changedQueryCount} 变化
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>

                  {/* 关联判断分布 */}
                  <td>
                    {retest && dist.total > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        {dist.likelyRelated > 0 && (
                          <span className="status-badge status-success">
                            可能相关 {dist.likelyRelated}
                          </span>
                        )}
                        {dist.insufficientEvidence > 0 && (
                          <span className="status-badge">
                            证据不足 {dist.insufficientEvidence}
                          </span>
                        )}
                        {dist.confounded > 0 && (
                          <span className="status-badge status-warning">
                            存在混杂 {dist.confounded}
                          </span>
                        )}
                        {dist.noObservedChange > 0 && (
                          <span className="status-badge text-slate-600">
                            无变化 {dist.noObservedChange}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
                  </td>

                  {/* 操作 (Sticky) */}
                  <td className="text-right sticky-col-right">
                    {retest ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectAsset(asset.id);
                        }}
                        className="ui-button secondary compact"
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
                        className="ui-button primary text-xs py-1 px-2.5"
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
