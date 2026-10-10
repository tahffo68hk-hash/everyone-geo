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
      <div className="surface p-8 text-center bg-slate-50/50">
        <p className="text-sm font-medium text-slate-700">本次复测尚未配置或生成评测问题</p>
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
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:outline-hidden focus:border-teal-600"
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
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:outline-hidden focus:border-teal-600"
          >
            <option value="ALL">全部测试条件</option>
            <option value="COMPARABLE">条件一致</option>
            <option value="COMPARABLE_WITH_WARNING">可比较（存在差异）</option>
            <option value="INCOMPATIBLE">不建议直接比较</option>
            <option value="MISSING_BASELINE">缺少发布前基线</option>
          </select>
        </div>

        <span className="text-slate-400 text-xs">
          共 {filteredRows.length} / {rows.length} 个评测问题
        </span>
      </div>

      {/* 核心表格 */}
      <div className="surface table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th className="min-w-52">评测问题 (Query)</th>
              <th className="min-w-28">测试条件可比性</th>
              <th className="min-w-28">品牌提及 (前后)</th>
              <th className="min-w-24">引用数</th>
              <th className="min-w-24">位次变化</th>
              <th className="min-w-28">推荐态度</th>
              <th className="min-w-28">竞对动态</th>
              <th className="min-w-28">关联判断</th>
              <th className="text-right min-w-24 sticky-col-right">操作</th>
            </tr>
          </thead>
          <tbody>
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
                  className="cursor-pointer"
                >
                  {/* Query */}
                  <td>
                    <div className="font-semibold text-slate-900">{row.queryText}</div>
                    <small>
                      {row.queryType && <span>类型: {row.queryType} · </span>}
                      {row.sanity ? "基准校验问题" : "业务监测问题"}
                    </small>
                  </td>

                  {/* 可比性 */}
                  <td>
                    <span className={`status-badge ${baseInfo.badgeClass}`}>
                      {baseInfo.label}
                    </span>
                  </td>

                  {/* 品牌提及 (Before -> After) */}
                  <td>
                    {isComparable ? (
                      <span className="font-mono text-xs">
                        {before.brandMention === true ? "提及" : before.brandMention === false ? "未提" : "—"} →{" "}
                        <span className={after.brandMention === true ? "text-emerald-700 font-bold" : after.brandMention === false ? "text-slate-500" : "text-slate-400"}>
                          {after.brandMention === true ? "提及" : after.brandMention === false ? "未提" : "—"}
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs" title={outcome?.comparabilityWarning || "测试条件不一致，隐藏直接差值"}>不可比</span>
                    )}
                  </td>

                  {/* 引用数 */}
                  <td>
                    {isComparable ? (
                      <span className="font-mono text-xs">
                        {typeof before.citationCount === "number" ? before.citationCount : "—"} →{" "}
                        <span className={typeof after.citationCount === "number" && (before.citationCount === undefined || after.citationCount > before.citationCount) ? "text-emerald-700 font-bold" : ""}>
                          {typeof after.citationCount === "number" ? after.citationCount : "—"}
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
                  </td>

                  {/* 位次 */}
                  <td>
                    {isComparable ? (
                      <span className="font-mono text-xs">
                        {typeof before.position === "number" && before.position > 0 ? `#${before.position}` : before.position === null || before.position === 0 ? "未上榜" : "—"} →{" "}
                        <span className={
                          typeof after.position === "number" && after.position > 0 &&
                          (!before.position || before.position === 0 || after.position < before.position)
                            ? "text-emerald-700 font-bold"
                            : typeof after.position === "number" && typeof before.position === "number" && before.position > 0 && after.position > before.position
                            ? "text-amber-700"
                            : ""
                        }>
                          {typeof after.position === "number" && after.position > 0 ? `#${after.position}` : after.position === null || after.position === 0 ? "未上榜" : "—"}
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
                  </td>

                  {/* 推荐态度 */}
                  <td>
                    {isComparable ? (
                      <span className="text-xs">
                        {before.recommendation === true ? "推荐" : before.recommendation === false ? "未推荐" : "—"} →{" "}
                        <span className={after.recommendation === true ? "text-emerald-700 font-semibold" : after.recommendation === false ? "text-slate-500" : "text-slate-400"}>
                          {after.recommendation === true ? "推荐" : after.recommendation === false ? "未推荐" : "—"}
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
                  </td>

                  {/* 竞对动态 */}
                  <td className="max-w-40 truncate">
                    {outcome?.deltaSnapshot?.competitorPresence?.added?.length > 0 ? (
                      <span className="text-amber-800 font-medium text-xs">
                        新增: {outcome?.deltaSnapshot?.competitorPresence?.added?.join(", ")}
                      </span>
                    ) : outcome?.deltaSnapshot?.competitorPresence?.removed?.length > 0 ? (
                      <span className="text-slate-500 text-xs">
                        减少: {outcome?.deltaSnapshot?.competitorPresence?.removed?.join(", ")}
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs">保持稳定</span>
                    )}
                  </td>

                  {/* 关联判断 */}
                  <td>
                    <span className={`status-badge font-semibold ${attrInfo.badgeClass}`}>
                      {attrInfo.label}
                    </span>
                  </td>

                  {/* 操作 */}
                  <td className="text-right sticky-col-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectRow(row);
                      }}
                      className="ui-button secondary compact"
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
