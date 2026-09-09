"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { friendlyError } from "@/lib/labels";
import {
  ACTIVITY_NAV, ACTIVITY_TYPE_OPTIONS, ACTIVITY_STATUS_OPTIONS, formatActivityType,
} from "@/lib/labels";
import { useProjectContext } from "@/components/project-context";
import { PageHeader, FilterBar, StatusBadge, EmptyState, ErrorState, LoadingSkeleton, Pagination } from "@/components/ui";

type ActivityItem = {
  id: string;
  type: string;
  projectId: string;
  projectName: string;
  suiteId: string | null;
  suiteName: string | null;
  suiteVersion: string | null;
  engineLabel: string | null;
  status: string;
  progress: { completed: number | null; total: number | null; label: string | null } | null;
  createdAt: string;
  completedAt: string | null;
  startable: boolean;
  resultUrl: string;
};
type ActivityResult = { items: ActivityItem[]; page: number; pageSize: number; total: number };

const PAGE_SIZE = 20;

const fmtTime = (iso: string): string =>
  new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });

/** 结果入口文案：按任务状态给出下一步动作动词，避免空泛的“查看”。 */
const resultLabel = (status: string): string => {
  if (status === "AWAITING_MANUAL_INPUT") return ACTIVITY_NAV.result.continueInput;
  if (status === "PARTIAL") return ACTIVITY_NAV.result.viewMissing;
  if (status === "SUCCEEDED" || status === "EVALUATED") return ACTIVITY_NAV.result.viewResult;
  return ACTIVITY_NAV.result.view;
};

function ActivityInner() {
  const { projectId } = useProjectContext();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        projectId,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (qApplied) params.set("q", qApplied);
      if (type) params.set("type", type);
      if (status) params.set("status", status);
      const data = await api<ActivityResult>(`/activity?${params.toString()}`);
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
          <button type="button" className="ui-button" onClick={() => { setQApplied(q.trim()); void load(); }} disabled={loading}>
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
          <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label={ACTIVITY_NAV.type} value={type} onChange={e => { setType(e.target.value); setPage(1); }}>
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
                    <td className="px-4 py-3 text-slate-600">{item.progress?.label ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">{fmtTime(item.createdAt)}</td>
                    <td className="px-4 py-3">
                      <Link href={item.resultUrl} className="text-blue-700 hover:underline">
                        {resultLabel(item.status)} →
                      </Link>
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
