"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { friendlyError } from "@/lib/labels";
import {
  ACTIVITY_NAV, ACTIVITY_TYPE_OPTIONS, ACTIVITY_STATUS_OPTIONS, formatActivityType,
} from "@/lib/labels";
import {
  listActivity,
  getActivityActions,
  type ActivityItem,
  type ActivityType,
} from "@/lib/r2-api";
import { useProjectContext } from "@/components/project-context";
import { PageHeader, FilterBar, StatusBadge, EmptyState, ErrorState, LoadingSkeleton, Pagination } from "@/components/ui";

const PAGE_SIZE = 20;

const fmtTime = (iso: string): string =>
  new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });

function ActivityInner() {
  const { projectId } = useProjectContext();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [type, setType] = useState<ActivityType | "">("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError("");
    try {
      const data = await listActivity({
        projectId,
        page,
        pageSize: PAGE_SIZE,
        q: qApplied,
        type,
        status,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setLoading(false);
    }
  }, [projectId, page, qApplied, type, status]);

  useEffect(() => { void load(); }, [load]);

  function applyFilters(resetPage: boolean) {
    if (resetPage && page !== 1) setPage(1);
    setQApplied(q.trim());
  }

  if (!projectId) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={ACTIVITY_NAV.title}
        description={ACTIVITY_NAV.pageHint}
        actions={
          <button type="button" className="ui-button" onClick={() => void load()} disabled={loading}>
            {ACTIVITY_NAV.refresh}
          </button>
        }
      />

      <FilterBar>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") applyFilters(true); }}
          placeholder={ACTIVITY_NAV.searchPlaceholder}
          aria-label={ACTIVITY_NAV.search}
          style={{ minWidth: 220 }}
        />
        <button type="button" className="ui-button" onClick={() => applyFilters(true)} disabled={loading}>
          {ACTIVITY_NAV.search}
        </button>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <span>{ACTIVITY_NAV.type}</span>
          <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label={ACTIVITY_NAV.type} value={type} onChange={e => { setType(e.target.value as ActivityType | ""); setPage(1); }}>
            <option value="">{ACTIVITY_NAV.all}</option>
            {ACTIVITY_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <span>{ACTIVITY_NAV.status}</span>
          <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label={ACTIVITY_NAV.status} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
            <option value="">{ACTIVITY_NAV.all}</option>
            {ACTIVITY_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </FilterBar>

      {error ? (
        <ErrorState title={ACTIVITY_NAV.loadError} error={error} retry={() => void load()} />
      ) : loading ? (
        <LoadingSkeleton rows={6} />
      ) : items.length === 0 ? (
        <EmptyState title={ACTIVITY_NAV.emptyTitle} description={ACTIVITY_NAV.emptyHint} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <caption className="sr-only">任务中心列表</caption>
              <thead className="border-b border-slate-200 bg-slate-50/60 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3">{ACTIVITY_NAV.columns.task}</th>
                  <th className="px-4 py-3">{ACTIVITY_NAV.columns.project}</th>
                  <th className="px-4 py-3">{ACTIVITY_NAV.columns.suite}</th>
                  <th className="px-4 py-3">{ACTIVITY_NAV.columns.engine}</th>
                  <th className="px-4 py-3">{ACTIVITY_NAV.columns.status}</th>
                  <th className="px-4 py-3">{ACTIVITY_NAV.columns.progress}</th>
                  <th className="px-4 py-3">{ACTIVITY_NAV.columns.time}</th>
                  <th className="px-4 py-3">{ACTIVITY_NAV.columns.result}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map(item => (
                  <tr key={`${item.type}-${item.id}`} className="align-middle hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-medium text-slate-800">{formatActivityType(item.type)}</td>
                    <td className="px-4 py-3 text-slate-600">{item.projectName}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {item.suiteName ? (
                        <span>
                          {item.suiteName}
                          {item.suiteVersion ? <span className="ml-1 text-xs text-slate-400">{item.suiteVersion}</span> : null}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{item.engineLabel ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
                    <td className="px-4 py-3 text-slate-600">
                      {item.progress?.label ?? (item.completed != null && item.total != null ? `${item.completed} / ${item.total}` : <span className="text-slate-400">—</span>)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">{fmtTime(item.createdAt)}</td>
                    <td className="px-4 py-3">
                      {item.resultUrl && getActivityActions(item).length > 0 ? (
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          {getActivityActions(item).map(action => (
                            <Link key={action} href={item.resultUrl!} className="text-blue-700 hover:underline">
                              {action === "VIEW_RESULT" ? "查看结果" : "继续录入"} →
                            </Link>
                          ))}
                        </div>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={p => setPage(p)} />
        </>
      )}
    </div>
  );
}

export default function ActivityPage() {
  return <ActivityInner />;
}
