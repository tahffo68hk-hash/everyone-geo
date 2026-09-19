"use client";

import { useState } from "react";
import {
  formatPlatform,
  formatRetestStatus,
  formatVerificationStatus,
  type AssetOutcomeWorkspace,
  type QueryOutcomeRow,
} from "@/lib/outcome-api";
import { QueryOutcomeTable } from "./query-outcome-table";
import { QueryOutcomeDrawer } from "./query-outcome-drawer";

interface AssetOutcomeOverviewProps {
  workspace: AssetOutcomeWorkspace;
  onBack: () => void;
  onRerunRetest?: () => void;
  isRerunning?: boolean;
}

export function AssetOutcomeOverview({
  workspace,
  onBack,
  onRerunRetest,
  isRerunning,
}: AssetOutcomeOverviewProps) {
  const [selectedRow, setSelectedRow] = useState<QueryOutcomeRow | null>(null);

  const asset = workspace.asset;
  const activeRun = workspace.activeRetestRun;
  const vStatus = formatVerificationStatus(asset.verificationStatus);
  const rStatus = formatRetestStatus(activeRun?.status);

  const compSummary = activeRun?.comparabilitySummary;
  const obsSummary = activeRun?.observedChangesSummary;
  const attrSummary = activeRun?.attributionSummary;

  return (
    <div className="space-y-5">
      {/* 顶栏导航与标题 */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 pb-4">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-teal-700 transition"
          >
            ← 返回效果验证列表
          </button>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="status-badge">
              {formatPlatform(asset.platform)}
            </span>
            <span className={`status-badge ${vStatus.badgeClass}`}>
              {vStatus.label}
            </span>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">{asset.title}</h1>
          </div>
        </div>

        {onRerunRetest && (
          <button
            type="button"
            disabled={isRerunning}
            onClick={onRerunRetest}
            className="ui-button primary text-xs"
          >
            {isRerunning ? "正在执行复测评测…" : "重新执行 GEO 复测"}
          </button>
        )}
      </div>

      {/* 资产与复测配置概览卡片 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 资产基本信息 */}
        <section className="surface p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-2.5">
            落地资产基本信息
          </h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
            <div>
              <dt className="text-slate-400">所属战役</dt>
              <dd className="font-medium text-slate-800 mt-0.5">{asset.campaign?.name || "常规内容运营"}</dd>
            </div>
            <div>
              <dt className="text-slate-400">规划目标</dt>
              <dd className="font-medium text-slate-800 mt-0.5 truncate" title={asset.planItem?.title || "未关联"}>
                {asset.planItem?.title || "未关联"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">发布时间</dt>
              <dd className="font-medium text-slate-800 mt-0.5">
                {asset.publishedAt ? new Date(asset.publishedAt).toLocaleString("zh-CN", { hour12: false }) : "未知"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">落地链接</dt>
              <dd className="font-medium text-slate-800 mt-0.5 truncate">
                {asset.canonicalUrl ? (
                  <a
                    href={asset.canonicalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-teal-700 hover:underline inline-flex items-center gap-1"
                    title={asset.canonicalUrl}
                  >
                    查看落地外部链接 ↗
                  </a>
                ) : (
                  <span className="text-slate-400">无外部链接</span>
                )}
              </dd>
            </div>
            {asset.verificationNote && (
              <div className="col-span-2 pt-1 border-t border-slate-50">
                <dt className="text-slate-400">核验凭证说明</dt>
                <dd className="font-medium text-slate-800 mt-0.5">{asset.verificationNote}</dd>
              </div>
            )}
          </dl>
        </section>

        {/* 复测执行与环境参数 */}
        <section className="surface p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <h2 className="text-sm font-semibold text-slate-900">GEO 复测批次与配置</h2>
            {activeRun && (
              <span className={`status-badge ${rStatus.badgeClass}`}>
                第 {activeRun.sequence} 次复测 · {rStatus.label}
              </span>
            )}
          </div>
          {activeRun ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
              <div>
                <dt className="text-slate-400">测试 Provider 与引擎</dt>
                <dd className="font-medium text-slate-800 mt-0.5">
                  {activeRun.provider} · {activeRun.engineName || "默认引擎"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">评测模型</dt>
                <dd className="font-medium text-slate-800 mt-0.5">{activeRun.model || "默认模型"}</dd>
              </div>
              <div>
                <dt className="text-slate-400">检索模式</dt>
                <dd className="font-medium text-slate-800 mt-0.5">
                  {activeRun.retrievalMode === "api_plain" ? "纯API文本 (api_plain)" : activeRun.retrievalMode}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">复测完成时间</dt>
                <dd className="font-medium text-slate-800 mt-0.5">
                  {activeRun.completedAt
                    ? new Date(activeRun.completedAt).toLocaleString("zh-CN", { hour12: false })
                    : "正在执行…"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">评测问题规模</dt>
                <dd className="font-medium text-slate-800 mt-0.5">
                  {activeRun.completedItems} / {activeRun.totalItems} 项已完成
                </dd>
              </div>
            </dl>
          ) : (
            <div className="py-6 text-center text-xs text-slate-400">
              该资产尚未发起任何 GEO 复测任务。
            </div>
          )}
        </section>
      </div>

      {/* 核心指标卡片：4张精炼 Executive Cards */}
      {activeRun && (
        <>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {/* 1. 测试条件一致性 */}
            <div className="metric-card">
              <span className="metric-label">测试条件可比性</span>
              <strong className="text-teal-900">
                {compSummary?.comparableItems ?? 0}{" "}
                <span className="text-xs font-normal text-slate-500">
                  / {activeRun.totalItems} 项一致
                </span>
              </strong>
              <span className="metric-note">
                {compSummary?.warningItems ? `${compSummary.warningItems} 项有差异 · ` : ""}
                {compSummary?.incompatibleItems ? `${compSummary.incompatibleItems} 项不可比 · ` : ""}
                {compSummary?.missingBaselineItems ? `${compSummary.missingBaselineItems} 项缺基线` : "参数严格一致"}
              </span>
            </div>

            {/* 2. 品牌提及净增 */}
            <div className="metric-card">
              <span className="metric-label">品牌提及净增</span>
              <strong className={obsSummary?.mentionAbsentToPresent ? "text-emerald-700" : "text-slate-800"}>
                {obsSummary?.mentionAbsentToPresent ? `+${obsSummary.mentionAbsentToPresent}` : "0"}{" "}
                <span className="text-xs font-normal text-slate-500">个问题新提及</span>
              </strong>
              <span className="metric-note">
                从“未出现”转为“已提及”
              </span>
            </div>

            {/* 3. 引用净增与位次 */}
            <div className="metric-card">
              <span className="metric-label">引用净增总量</span>
              <strong className={obsSummary?.citationCountDeltaTotal ? "text-emerald-700" : "text-slate-800"}>
                {obsSummary?.citationCountDeltaTotal ? `+${obsSummary.citationCountDeltaTotal}` : "0"}{" "}
                <span className="text-xs font-normal text-slate-500">次净增引用</span>
              </strong>
              <span className="metric-note">
                {obsSummary?.positionImproved ? `${obsSummary.positionImproved} 个问题位次前移` : "位次保持平稳"}
              </span>
            </div>

            {/* 4. 关联倾向归因 */}
            <div className="metric-card">
              <span className="metric-label">推断关联倾向</span>
              <strong className={attrSummary?.likelyRelatedCount ? "text-emerald-700" : "text-slate-800"}>
                {attrSummary?.likelyRelatedCount ?? 0}{" "}
                <span className="text-xs font-normal text-slate-500">项可能相关</span>
              </strong>
              <span className="metric-note">
                {attrSummary?.confoundedCount ? `${attrSummary.confoundedCount} 项存在混杂 · ` : ""}
                {attrSummary?.noObservedChangeCount ? `${attrSummary.noObservedChangeCount} 项无变化` : "证据链完备"}
              </span>
            </div>
          </div>

          {/* 必须展示的归因边界说明 (B8 & Section 4) */}
          <div className="surface p-4 text-xs text-slate-700 leading-relaxed border-teal-200/70 bg-teal-50/40">
            <p className="font-semibold text-teal-900 flex items-center gap-1.5 mb-1">
              <span aria-hidden="true">ℹ</span> 归因分析边界与客观说明
            </p>
            <p>
              “可能相关”表示当前评测证据在可比测试参数、时序先后与同类排查下支持存在关联，<strong>不代表严格因果关系</strong>。GEO 引擎基于受控测试条件、落地资产直接引用、排期时序与混杂因素排查提供客观证据链。
            </p>
          </div>

          {/* Level 3: Query 维度评测对比与归因明细 */}
          <section className="space-y-3 pt-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  评测问题明细与逐项归因
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  点击任意问题行展开原始证据、受控参数对比与混杂排查抽屉
                </p>
              </div>
            </div>

            <QueryOutcomeTable
              rows={activeRun.queryRows}
              onSelectRow={(row) => setSelectedRow(row)}
            />
          </section>
        </>
      )}

      {/* 详细抽屉 */}
      <QueryOutcomeDrawer row={selectedRow} onClose={() => setSelectedRow(null)} />
    </div>
  );
}
