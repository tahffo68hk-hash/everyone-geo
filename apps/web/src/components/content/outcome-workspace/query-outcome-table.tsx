"use client";

import { useMemo, useState } from "react";
import {
  formatAttributionStatus,
  formatBaselineStatus,
  type QueryOutcomeRow,
} from "@/lib/outcome-api";

interface QueryOutcomeTableProps {
  rows: QueryOutcomeRow[];
  onSelectRow: (row: QueryOutcomeRow) => void;
}

export function QueryOutcomeTable({ rows, onSelectRow }: QueryOutcomeTableProps) {
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterCompat, setFilterCompat] = useState<string>("ALL");

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (filterStatus !== "ALL" && r.attribution?.status !== filterStatus) {
        return false;
      }
      if (filterCompat !== "ALL") {
        const compat = r.outcome?.comparisonStatus || r.baselineStatus;
        if (compat !== filterCompat) return false;
      }
      return true;
    });
  }, [rows, filterStatus, filterCompat]);

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center bg-slate-50/50">
        <p className="text-sm font-medium text-slate-700">本次复测尚未配置或生成测试问题</p>
        <p className="mt-1 text-xs text-slate-500">
          当复测任务执行完毕后，相关 Query 将在此展示 Before / After 评测对比。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 筛选条 */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-500">快速筛选：</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 focus:outline-hidden"
          >
            <option value="ALL">全部关联结论</option>
            <option value="LIKELY_RELATED">可能相关</option>
            <option value="INSUFFICIENT_EVIDENCE">证据不足</option>
            <option value="CONFOUNDED">存在混杂因素</option>
            <option value="NO_OBSERVED_CHANGE">未观察到明显变化</option>
          </select>

          <select
            value={filterCompat}
            onChange={(e) => setFilterCompat(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 focus:outline-hidden"
          >
            <option value="ALL">全部测试条件</option>
            <option value="COMPARABLE">条件一致</option>
            <option value="COMPARABLE_WITH_WARNING">可比较（存在差异）</option>
            <option value="INCOMPATIBLE">不建议直接比较</option>
            <option value="MISSING_BASELINE">缺少发布前基线</option>
          </select>
        </div>

        <span className="text-slate-400">
          共 {filteredRows.length} / {rows.length} 个评测问题
        </span>
      </div>

      {/* 核心表格 (B9) */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
        <table className="w-full text-left text-xs text-slate-700 divide-y divide-slate-100">
          <thead className="bg-slate-50 font-semibold text-slate-600">
            <tr>
              <th className="px-4 py-3 min-w-48">评测问题 (Query)</th>
              <th className="px-3 py-3 min-w-28">测试条件可比性</th>
              <th className="px-3 py-3 min-w-24">品牌提及</th>
              <th className="px-3 py-3 min-w-20">引用数</th>
              <th className="px-3 py-3 min-w-20">位次</th>
              <th className="px-3 py-3 min-w-24">推荐态度</th>
              <th className="px-3 py-3 min-w-28">竞对动态</th>
              <th className="px-3 py-3 min-w-28">关联判断</th>
              <th className="px-3 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredRows.map((row) => {
              const outcome = row.outcome;
              const attribution = row.attribution;
              const attrInfo = formatAttributionStatus(attribution?.status);
              const baseInfo = formatBaselineStatus(row.baselineStatus || outcome?.baselineCompatibility);

              const before = outcome?.beforeSnapshot ?? {};
              const after = outcome?.afterSnapshot ?? {};

              const isComparable =
                outcome?.comparisonStatus === "COMPARABLE" ||
                outcome?.comparisonStatus === "COMPARABLE_WITH_WARNING";

              return (
                <tr
                  key={row.id}
                  onClick={() => onSelectRow(row)}
                  className="hover:bg-slate-50/80 cursor-pointer transition"
                >
                  {/* Query */}
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{row.queryText}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                      {row.queryType && <span>{row.queryType}</span>}
                      {row.sanity && <span>· 基准问题</span>}
                    </div>
                  </td>

                  {/* 可比性 */}
                  <td className="px-3 py-3">
                    <span className={`inline-flex rounded px-2 py-0.5 text-[11px] border font-medium ${baseInfo.badgeClass}`}>
                      {baseInfo.label}
                    </span>
                  </td>

                  {/* 品牌提及 (Before -> After) */}
                  <td className="px-3 py-3">
                    {isComparable ? (
                      <span className="font-mono">
                        {before.brandMention ? "提及" : "未提"} →{" "}
                        <span className={after.brandMention ? "text-emerald-700 font-bold" : "text-slate-500"}>
                          {after.brandMention ? "提及" : "未提"}
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-400">差值隐藏</span>
                    )}
                  </td>

                  {/* 引用数 */}
                  <td className="px-3 py-3">
                    {isComparable ? (
                      <span className="font-mono">
                        {before.citationCount ?? 0} →{" "}
                        <span className={after.citationCount > 0 ? "text-emerald-700 font-bold" : ""}>
                          {after.citationCount ?? 0}
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>

                  {/* 位次 */}
                  <td className="px-3 py-3">
                    {isComparable ? (
                      <span className="font-mono">
                        {before.position ? `#${before.position}` : "-"} →{" "}
                        <span className="font-bold">
                          {after.position ? `#${after.position}` : "-"}
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>

                  {/* 推荐态度 */}
                  <td className="px-3 py-3">
                    {isComparable ? (
                      <span>
                        {before.recommendation ? "推荐" : "未推荐"} →{" "}
                        <span className={after.recommendation ? "text-emerald-700 font-bold" : "text-slate-500"}>
                          {after.recommendation ? "推荐" : "未推荐"}
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>

                  {/* 竞对动态 */}
                  <td className="px-3 py-3 max-w-40 truncate">
                    {outcome?.deltaSnapshot?.competitorPresence?.added?.length > 0 ? (
                      <span className="text-blue-700 font-medium">
                        新增: {outcome?.deltaSnapshot?.competitorPresence?.added?.join(",")}
                      </span>
                    ) : outcome?.deltaSnapshot?.competitorPresence?.removed?.length > 0 ? (
                      <span className="text-slate-500">
                        减少: {outcome?.deltaSnapshot?.competitorPresence?.removed?.join(",")}
                      </span>
                    ) : (
                      <span className="text-slate-400">稳定</span>
                    )}
                  </td>

                  {/* 关联判断 */}
                  <td className="px-3 py-3">
                    <span className={`inline-flex rounded px-2 py-0.5 text-[11px] font-semibold border ${attrInfo.badgeClass}`}>
                      {attrInfo.label}
                    </span>
                  </td>

                  {/* 操作 */}
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectRow(row);
                      }}
                      className="rounded-md bg-slate-100 px-2.5 py-1 text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition"
                    >
                      查看明细
                    </button>
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
