"use client";

import { useEffect, useState } from "react";
import {
  formatAttributionStatus,
  formatBaselineStatus,
  formatConfounderCode,
  formatObservedChangeType,
  formatReasonCode,
  type QueryOutcomeRow,
} from "@/lib/outcome-api";

interface QueryOutcomeDrawerProps {
  row: QueryOutcomeRow | null;
  onClose: () => void;
}

export function QueryOutcomeDrawer({ row, onClose }: QueryOutcomeDrawerProps) {
  const [showBeforeRaw, setShowBeforeRaw] = useState(false);
  const [showAfterRaw, setShowAfterRaw] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!row) return null;

  const outcome = row.outcome;
  const attribution = row.attribution;
  const attrInfo = formatAttributionStatus(attribution?.status);
  const baseInfo = formatBaselineStatus(row.baselineStatus || outcome?.baselineCompatibility);
  const changeInfo = formatObservedChangeType(attribution?.observedChangeType);

  const beforeSnap = outcome?.beforeSnapshot ?? {};
  const afterSnap = outcome?.afterSnapshot ?? {};
  const deltaSnap = outcome?.deltaSnapshot ?? {};

  const isComparable =
    outcome?.comparisonStatus === "COMPARABLE" ||
    outcome?.comparisonStatus === "COMPARABLE_WITH_WARNING";

  const reasons = attribution?.reasons ?? [];
  const confounders = attribution?.confoundersSnapshot ?? {};
  const confounderList = Object.entries(confounders).filter(([, v]) => Boolean(v));

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-xs flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-3xl bg-white h-full shadow-2xl overflow-y-auto flex flex-col">
        {/* Drawer 顶栏 */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-6 py-4 backdrop-blur-xs">
          <div>
            <div className="flex items-center gap-2">
              <span className="status-badge status-active text-xs">
                评测问题明细
              </span>
              {row.queryType && (
                <span className="status-badge text-xs">
                  类型: {row.queryType}
                </span>
              )}
              {row.sanity && (
                <span className="status-badge status-warning text-xs">
                  基准问题
                </span>
              )}
            </div>
            <h2 id="drawer-title" className="mt-1.5 text-base sm:text-lg font-bold text-slate-900 leading-snug">
              {row.queryText}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
            aria-label="关闭抽屉"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-6 flex-1">
          {/* 1. 归因与可解释性卡片 */}
          <section className="surface p-5 space-y-4 bg-slate-50/50">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-900">关联推断结论：</span>
                <span className={`status-badge font-semibold ${attrInfo.badgeClass}`}>
                  {attrInfo.label}
                </span>
                <span className={`status-badge ${changeInfo.badgeClass}`}>
                  {changeInfo.label}
                </span>
              </div>
              <span className={`status-badge ${baseInfo.badgeClass}`}>
                条件: {baseInfo.label}
              </span>
            </div>

            {/* 严格中立的边界说明 */}
            <div className="surface p-3 text-xs text-slate-700 leading-relaxed border-teal-200/80 bg-teal-50/40">
              <strong className="text-teal-900">边界说明：</strong>“可能相关”表示当前测试证据在受控参数、时序先后及同类干预排查下支持存在关联，<strong>不代表严格因果关系</strong>。
            </div>

            {/* 依据与支持信号 */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">判定依据与支持信号</h4>
              {reasons.length > 0 ? (
                <ul className="mt-2 space-y-1.5 text-xs text-slate-700">
                  {reasons.map((r, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-emerald-600 font-bold">✓</span>
                      <span>{formatReasonCode(r)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-slate-500">暂无详细规则依据记录。</p>
              )}
            </div>

            {/* 混杂因素排查 */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">混杂因素排查</h4>
              {confounderList.length > 0 ? (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/80 p-3 space-y-1 text-xs text-amber-900">
                  <p className="font-semibold">检测到以下潜在混杂因素：</p>
                  <ul className="list-disc list-inside space-y-0.5 pl-1">
                    {confounderList.map(([k]) => (
                      <li key={k}>{formatConfounderCode(k)}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-1 text-xs text-slate-600">未发现当前系统能够识别的其他同 Query 发布干预。</p>
              )}
            </div>

            {/* 规则文本说明 */}
            {attribution?.explanation && (
              <div className="border-t border-slate-200/80 pt-3">
                <h4 className="text-xs font-semibold text-slate-500">规则引擎综合解释：</h4>
                <p className="mt-1 text-xs text-slate-700 leading-relaxed whitespace-pre-line">
                  {attribution.explanation}
                </p>
              </div>
            )}
          </section>

          {/* 2. Before / After 对比快照 */}
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Before（发布前）/ After（发布后）评测快照</h3>

            {!isComparable && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 leading-relaxed">
                <strong>提示：</strong>由于前后评测关键测试参数存在差异或缺少基线，直接差值比对已隐藏，请分别参考前后原始评测记录。
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Before 卡片 */}
              <div className="surface p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="font-semibold text-xs text-slate-700">Before（发布前基线）</span>
                  <span className="text-xs text-slate-400">
                    {beforeSnap.timestamp ? new Date(beforeSnap.timestamp).toLocaleString("zh-CN", { hour12: false }) : "无基线"}
                  </span>
                </div>
                {beforeSnap.timestamp ? (
                  <dl className="grid grid-cols-2 gap-x-2 gap-y-2 text-xs">
                    <div>
                      <dt className="text-slate-400">模型 / 引擎</dt>
                      <dd className="font-medium text-slate-800 mt-0.5">{beforeSnap.model || "默认模型"}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">检索模式</dt>
                      <dd className="font-medium text-slate-800 mt-0.5">{beforeSnap.retrievalMode || "纯API"}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">品牌提及</dt>
                      <dd className="font-medium text-slate-800 mt-0.5">
                        {beforeSnap.brandMention ? (
                          <span className="text-emerald-700 font-semibold">出现</span>
                        ) : (
                          <span className="text-slate-500">未出现</span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">引用数</dt>
                      <dd className="font-medium text-slate-800 mt-0.5">{beforeSnap.citationCount ?? 0}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">位置排名</dt>
                      <dd className="font-medium text-slate-800 mt-0.5">
                        {beforeSnap.position ? `#${beforeSnap.position}` : "无排名"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">推荐态度</dt>
                      <dd className="font-medium text-slate-800 mt-0.5">
                        {beforeSnap.recommendation ? "推荐" : "未推荐"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">情感倾向</dt>
                      <dd className="font-medium text-slate-800 mt-0.5">{beforeSnap.sentiment || "中性"}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">提及竞品</dt>
                      <dd className="font-medium text-slate-800 mt-0.5 truncate" title={Array.isArray(beforeSnap.competitors) ? beforeSnap.competitors.join(", ") : "无"}>
                        {Array.isArray(beforeSnap.competitors) && beforeSnap.competitors.length > 0
                          ? beforeSnap.competitors.join(", ")
                          : "无"}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-xs text-slate-400 py-4 text-center">缺少发布前基线证据记录</p>
                )}
              </div>

              {/* After 卡片 */}
              <div className="surface p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="font-semibold text-xs text-slate-700">After（发布后复测）</span>
                  <span className="text-xs text-slate-400">
                    {afterSnap.timestamp ? new Date(afterSnap.timestamp).toLocaleString("zh-CN", { hour12: false }) : "无结果"}
                  </span>
                </div>
                {afterSnap.timestamp ? (
                  <dl className="grid grid-cols-2 gap-x-2 gap-y-2 text-xs">
                    <div>
                      <dt className="text-slate-400">模型 / 引擎</dt>
                      <dd className="font-medium text-slate-800 mt-0.5">{afterSnap.model || "默认模型"}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">检索模式</dt>
                      <dd className="font-medium text-slate-800 mt-0.5">{afterSnap.retrievalMode || "纯API"}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">品牌提及</dt>
                      <dd className="font-medium text-slate-800 mt-0.5">
                        {afterSnap.brandMention ? (
                          <span className="text-emerald-700 font-semibold">出现</span>
                        ) : (
                          <span className="text-slate-500">未出现</span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">引用数</dt>
                      <dd className="font-medium text-slate-800 mt-0.5">{afterSnap.citationCount ?? 0}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">位置排名</dt>
                      <dd className="font-medium text-slate-800 mt-0.5">
                        {afterSnap.position ? `#${afterSnap.position}` : "无排名"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">推荐态度</dt>
                      <dd className="font-medium text-slate-800 mt-0.5">
                        {afterSnap.recommendation ? "推荐" : "未推荐"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">情感倾向</dt>
                      <dd className="font-medium text-slate-800 mt-0.5">{afterSnap.sentiment || "中性"}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">提及竞品</dt>
                      <dd className="font-medium text-slate-800 mt-0.5 truncate" title={Array.isArray(afterSnap.competitors) ? afterSnap.competitors.join(", ") : "无"}>
                        {Array.isArray(afterSnap.competitors) && afterSnap.competitors.length > 0
                          ? afterSnap.competitors.join(", ")
                          : "无"}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-xs text-slate-400 py-4 text-center">暂无有效复测结果</p>
                )}
              </div>
            </div>

            {/* 可比情况下的观察变化摘要 */}
            {isComparable && deltaSnap && Object.keys(deltaSnap).length > 0 && (
              <div className="surface p-3.5 space-y-1.5 text-xs text-slate-700 bg-slate-50/50">
                <span className="font-semibold text-slate-900">观测到的变化事实：</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 pt-1">
                  <div>
                    <span className="text-slate-400">品牌提及：</span>
                    <span className="font-medium">
                      {beforeSnap.brandMention ? "出现" : "未出现"} → {afterSnap.brandMention ? "出现" : "未出现"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">引用数：</span>
                    <span className="font-medium">
                      {beforeSnap.citationCount ?? 0} → {afterSnap.citationCount ?? 0}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">位次：</span>
                    <span className="font-medium">
                      {beforeSnap.position ? `#${beforeSnap.position}` : "无"} → {afterSnap.position ? `#${afterSnap.position}` : "无"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">推荐态度：</span>
                    <span className="font-medium">
                      {beforeSnap.recommendation ? "推荐" : "未推荐"} → {afterSnap.recommendation ? "推荐" : "未推荐"}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* 3. 原始证据透明抽屉 */}
          <section className="space-y-3 pt-1">
            <h3 className="text-sm font-bold text-slate-900">原始评测证据 (Evidence)</h3>

            {/* 发布前证据 */}
            <div className="surface">
              <button
                type="button"
                onClick={() => setShowBeforeRaw(!showBeforeRaw)}
                className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <span>查看发布前 Evidence 原始返回</span>
                <span>{showBeforeRaw ? "▲ 收起" : "▼ 展开"}</span>
              </button>
              {showBeforeRaw && (
                <div className="border-t border-slate-100 p-4 space-y-3 bg-slate-50/50">
                  {row.beforeEvidence ? (
                    <>
                      <div className="text-xs text-slate-500 flex flex-wrap gap-3">
                        <span>Provider: {row.beforeEvidence.provider}</span>
                        <span>引擎: {row.beforeEvidence.engineName}</span>
                        <span>模型: {row.beforeEvidence.model}</span>
                        <span>检索模式: {row.beforeEvidence.retrievalMode}</span>
                      </div>
                      <div>
                        <span className="text-xs font-semibold text-slate-600">评测 Prompt:</span>
                        <pre className="mt-1 rounded-md bg-white border border-slate-200 p-2 text-xs font-mono text-slate-800 whitespace-pre-wrap max-h-32 overflow-y-auto">
                          {row.beforeEvidence.rawPrompt}
                        </pre>
                      </div>
                      <div>
                        <span className="text-xs font-semibold text-slate-600">AI 回答全文:</span>
                        <pre className="mt-1 rounded-md bg-white border border-slate-200 p-2 text-xs font-mono text-slate-800 whitespace-pre-wrap max-h-48 overflow-y-auto">
                          {row.beforeEvidence.rawResponse}
                        </pre>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-slate-400">暂无发布前原始 Evidence 记录。</p>
                  )}
                </div>
              )}
            </div>

            {/* 发布后证据 */}
            <div className="surface">
              <button
                type="button"
                onClick={() => setShowAfterRaw(!showAfterRaw)}
                className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <span>查看发布后 Evidence 原始返回</span>
                <span>{showAfterRaw ? "▲ 收起" : "▼ 展开"}</span>
              </button>
              {showAfterRaw && (
                <div className="border-t border-slate-100 p-4 space-y-3 bg-slate-50/50">
                  {row.afterEvidence ? (
                    <>
                      <div className="text-xs text-slate-500 flex flex-wrap gap-3">
                        <span>Provider: {row.afterEvidence.provider}</span>
                        <span>引擎: {row.afterEvidence.engineName}</span>
                        <span>模型: {row.afterEvidence.model}</span>
                        <span>检索模式: {row.afterEvidence.retrievalMode}</span>
                      </div>
                      <div>
                        <span className="text-xs font-semibold text-slate-600">评测 Prompt:</span>
                        <pre className="mt-1 rounded-md bg-white border border-slate-200 p-2 text-xs font-mono text-slate-800 whitespace-pre-wrap max-h-32 overflow-y-auto">
                          {row.afterEvidence.rawPrompt}
                        </pre>
                      </div>
                      <div>
                        <span className="text-xs font-semibold text-slate-600">AI 回答全文:</span>
                        <pre className="mt-1 rounded-md bg-white border border-slate-200 p-2 text-xs font-mono text-slate-800 whitespace-pre-wrap max-h-48 overflow-y-auto">
                          {row.afterEvidence.rawResponse}
                        </pre>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-slate-400">暂无发布后原始 Evidence 记录。</p>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Drawer 底栏 */}
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-3 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="ui-button secondary text-xs"
          >
            关闭明细
          </button>
        </div>
      </div>
    </div>
  );
}
