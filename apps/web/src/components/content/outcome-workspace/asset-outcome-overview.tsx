"use client";

import { useState } from "react";
import {
  formatAttributionStatus,
  formatBaselineStatus,
  formatPlatform,
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

  const compSummary = activeRun?.comparabilitySummary;
  const obsSummary = activeRun?.observedChangesSummary;
  const attrSummary = activeRun?.attributionSummary;

  return (
    <div className="space-y-6">
      {/* 顶栏返回与标题 */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-800 transition"
          >
            ← 返回效果验证列表
          </button>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700 border border-slate-200">
              {formatPlatform(asset.platform)}
            </span>
            <span className={`rounded-md px-2 py-0.5 text-xs border ${vStatus.badgeClass}`}>
              {vStatus.label}
            </span>
            <h1 className="text-xl font-bold text-slate-900">{asset.title}</h1>
          </div>
        </div>

        {onRerunRetest && (
          <button
            type="button"
            disabled={isRerunning}
            onClick={onRerunRetest}
            className="rounded-lg bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-800 disabled:opacity-50 transition"
          >
            {isRerunning ? "正在触发复测…" : "重新执行 GEO 复测"}
          </button>
        )}
      </div>

      {/* 资产与复测元信息概览卡片 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 资产基础档案 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 shadow-xs">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
            落地资产基本信息
          </h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div>
              <dt className="text-slate-400">所属战役</dt>
              <dd className="font-medium text-slate-800">{asset.campaign?.name || "常规内容"}</dd>
            </div>
            <div>
              <dt className="text-slate-400">规划目标</dt>
              <dd className="font-medium text-slate-800 truncate" title={asset.planItem?.title || "未关联"}>
                {asset.planItem?.title || "未关联"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">发布时间</dt>
              <dd className="font-medium text-slate-800">
                {asset.publishedAt ? new Date(asset.publishedAt).toLocaleString("zh-CN") : "未知"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">落地链接</dt>
              <dd className="font-medium text-slate-800 truncate">
                {asset.canonicalUrl ? (
                  <a
                    href={asset.canonicalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-700 hover:underline"
                    title={asset.canonicalUrl}
                  >
                    查看外部链接 ↗
                  </a>
                ) : (
                  <span className="text-slate-400">无链接</span>
                )}
              </dd>
            </div>
            {asset.verificationNote && (
              <div className="col-span-2">
                <dt className="text-slate-400">核验凭证说明</dt>
                <dd className="font-medium text-slate-800">{asset.verificationNote}</dd>
              </div>
            )}
          </dl>
        </section>

        {/* 复测执行与环境参数 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h2 className="text-sm font-bold text-slate-900">GEO 复测批次与配置</h2>
            {activeRun && (
              <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs text-blue-700 font-medium border border-blue-200">
                第 {activeRun.sequence} 次复测 · {activeRun.status}
              </span>
            )}
          </div>
          {activeRun ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="text-slate-400">Provider 与引擎</dt>
                <dd className="font-medium text-slate-800">
                  {activeRun.provider} · {activeRun.engineName || "默认引擎"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">测试模型</dt>
                <dd className="font-medium text-slate-800">{activeRun.model || "默认模型"}</dd>
              </div>
              <div>
                <dt className="text-slate-400">检索模式</dt>
                <dd className="font-medium text-slate-800">
                  {activeRun.retrievalMode === "api_plain" ? "纯API文本 (api_plain)" : activeRun.retrievalMode}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">测试完成时间</dt>
                <dd className="font-medium text-slate-800">
                  {activeRun.completedAt ? new Date(activeRun.completedAt).toLocaleString("zh-CN") : "执行中…"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">测试问题总数</dt>
                <dd className="font-medium text-slate-800">
                  {activeRun.completedItems} / {activeRun.totalItems} 项完成
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

      {/* 核心指标与统计摘要 (Level 2 Comparability, Observed, Attribution) */}
      {activeRun && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* 1. 测试条件可比性分布 (B6 Comparability) */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2 shadow-xs">
              <span className="text-xs font-bold text-slate-700">测试条件可比性分布</span>
              <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                <div className="rounded-lg bg-emerald-50/60 border border-emerald-200 p-2 text-center">
                  <span className="text-[11px] text-emerald-800">条件一致</span>
                  <p className="text-lg font-bold text-emerald-900">{compSummary?.comparableItems ?? 0}</p>
                </div>
                <div className="rounded-lg bg-amber-50/60 border border-amber-200 p-2 text-center">
                  <span className="text-[11px] text-amber-800">条件有差异</span>
                  <p className="text-lg font-bold text-amber-900">{compSummary?.warningItems ?? 0}</p>
                </div>
                <div className="rounded-lg bg-rose-50/60 border border-rose-200 p-2 text-center">
                  <span className="text-[11px] text-rose-800">不建议比较</span>
                  <p className="text-lg font-bold text-rose-900">{compSummary?.incompatibleItems ?? 0}</p>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-2 text-center">
                  <span className="text-[11px] text-slate-700">缺少基线</span>
                  <p className="text-lg font-bold text-slate-800">{compSummary?.missingBaselineItems ?? 0}</p>
                </div>
              </div>
            </div>

            {/* 2. 观测到的变化事实 (B6 Observed Changes) */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">观测事实汇总（非因果）</span>
                <span className="text-[11px] text-slate-400">差值事实</span>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-2 text-center">
                  <span className="text-[11px] text-slate-600">品牌提及新增</span>
                  <p className="text-lg font-bold text-slate-900">{obsSummary?.mentionAbsentToPresent ?? 0}</p>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-2 text-center">
                  <span className="text-[11px] text-slate-600">引用净增总量</span>
                  <p className="text-lg font-bold text-slate-900">
                    {obsSummary?.citationCountDeltaTotal ? `+${obsSummary.citationCountDeltaTotal}` : 0}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-2 text-center">
                  <span className="text-[11px] text-slate-600">推荐态度提升</span>
                  <p className="text-lg font-bold text-slate-900">{obsSummary?.recommendationPositiveChanges ?? 0}</p>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-2 text-center">
                  <span className="text-[11px] text-slate-600">排名位次提升</span>
                  <p className="text-lg font-bold text-slate-900">{obsSummary?.positionImproved ?? 0}</p>
                </div>
              </div>
            </div>

            {/* 3. 关联判断总体分布 (B7 Attribution Overview) */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2 shadow-xs">
              <span className="text-xs font-bold text-slate-700">关联推断分布（Attribution）</span>
              <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2 text-center">
                  <span className="text-[11px] text-emerald-800">可能相关</span>
                  <p className="text-lg font-bold text-emerald-900">{attrSummary?.likelyRelatedCount ?? 0}</p>
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-2 text-center">
                  <span className="text-[11px] text-slate-700">证据不足</span>
                  <p className="text-lg font-bold text-slate-800">{attrSummary?.insufficientEvidenceCount ?? 0}</p>
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 text-center">
                  <span className="text-[11px] text-amber-800">存在混杂因素</span>
                  <p className="text-lg font-bold text-amber-900">{attrSummary?.confoundedCount ?? 0}</p>
                </div>
                <div className="rounded-lg bg-sky-50 border border-sky-200 p-2 text-center">
                  <span className="text-[11px] text-sky-800">未观察到明显变化</span>
                  <p className="text-lg font-bold text-sky-900">{attrSummary?.noObservedChangeCount ?? 0}</p>
                </div>
              </div>
            </div>
          </div>

          {/* 必须展示的归因边界说明 (B8) */}
          <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-xs text-blue-900 leading-relaxed space-y-1">
            <p className="font-bold flex items-center gap-1.5">
              <span>ℹ</span> 归因分析边界与产品说明
            </p>
            <p>
              “可能相关”表示当前证据支持存在正向关联，<strong>不代表严格因果关系</strong>。GEO 引擎基于可比较测试条件、落地资产直接引用、时序先后及同类干预排查进行证据链综合判断。
            </p>
          </div>

          {/* Level 3: Query 维度评测对比与归因明细 */}
          <section className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">
                评测问题明细与逐项归因 (Query Outcome Detail)
              </h2>
              <span className="text-xs text-slate-500">点击任意问题行查看原始证据与前后对比抽屉</span>
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
