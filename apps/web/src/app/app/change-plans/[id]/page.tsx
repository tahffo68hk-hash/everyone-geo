"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  formatChangePlanStatus, formatChangeType, formatOpportunityAsset, friendlyError,
  CHANGE_PLAN_NAV, OPPORTUNITY_NAV,
} from "@/lib/labels";

type Plan = {
  id: string; changePlanVersion: string; title: string; summary: string; status: string;
  contentOpportunityId: string; itemCount: number;
  siteAsset: { id: string; url: string; title: string | null } | null;
  contentOpportunity: { id: string; titleDirection: string; opportunityType: string } | null;
  items: Array<{ id: string; section: string; changeType: string; instruction: string; reason: string; sourceRecommendationId: string | null; sortOrder: number; status: string }>;
  approvedAt: string | null;
};

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600", APPROVED: "bg-emerald-100 text-emerald-800",
  EXECUTED_MANUALLY: "bg-blue-100 text-blue-800", CANCELLED: "bg-slate-200 text-slate-500",
};

function PlanInner() {
  const { id } = useParams<{ id: string }>();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState("");
  const [operating, setOperating] = useState(false);

  async function load() {
    setError("");
    try { setPlan(await api<Plan>(`/change-plans/${id}`)); }
    catch (e) { setError(friendlyError(e)); }
  }
  useEffect(() => { void load(); }, [id]);

  async function setStatus(status: string) {
    setOperating(true);
    try {
      await api(`/change-plans/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
    } catch (e) { setError(friendlyError(e)); }
    finally { setOperating(false); }
  }

  if (!plan && !error) {
    return <div className="space-y-2" aria-busy="true">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />)}</div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <Link href={plan ? `/app/opportunities/${plan.contentOpportunityId}` : "/app/opportunities"} className="text-xs text-blue-700 hover:underline">
          ← {plan ? `返回：${plan.contentOpportunity?.titleDirection ?? "内容机会"}` : "返回内容机会"}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-800">{plan?.title ?? "变更计划"}</h1>
        <p className="mt-1 text-xs text-slate-500">
          版本 {plan?.changePlanVersion} · {plan?.itemCount ?? 0} 个编辑项 · 状态 {plan ? formatChangePlanStatus(plan.status) : ""}
        </p>
      </div>
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {plan && (
        <>
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {CHANGE_PLAN_NAV.noAutoPublish}
            <p className="mt-1 text-xs text-amber-700">{CHANGE_PLAN_NAV.notFinalText}</p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <p className="text-slate-700">{plan.summary}</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-xs md:grid-cols-3">
              <div>
                <dt className="text-slate-500">目标站点资产</dt>
                <dd className="mt-0.5">
                  {plan.siteAsset
                    ? <Link href={`/app/site-assets/${plan.siteAsset.id}`} className="text-blue-700 hover:underline">{plan.siteAsset.title ?? plan.siteAsset.url}</Link>
                    : <span className="text-slate-400">尚未确认目标页面（UPDATE_EXISTING / CREATE_NEW / UNKNOWN 需人工确认）</span>}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">状态</dt>
                <dd className="mt-0.5"><span className={`rounded px-2 py-0.5 ${STATUS_BADGE[plan.status]}`}>{formatChangePlanStatus(plan.status)}</span></dd>
              </div>
              {plan.contentOpportunity && (
                <div>
                  <dt className="text-slate-500">来源内容机会</dt>
                  <dd className="mt-0.5">
                    <Link href={`/app/opportunities/${plan.contentOpportunity.id}`} className="text-blue-700 hover:underline">
                      {plan.contentOpportunity.titleDirection} · {formatOpportunityAsset(plan.contentOpportunity.opportunityType)}
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
            {plan.status === "DRAFT" && (
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={operating} onClick={() => void setStatus("APPROVED")} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50">
                  批准计划
                </button>
                <button type="button" disabled={operating} onClick={() => void setStatus("CANCELLED")} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                  取消计划
                </button>
              </div>
            )}
            {plan.status === "APPROVED" && (
              <div className="mt-3">
                <button type="button" disabled={operating} onClick={() => void setStatus("EXECUTED_MANUALLY")} className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50">
                  标记已手动执行
                </button>
                <p className="mt-1 text-[11px] text-slate-400">“已执行”表示你确认已按计划人工修改页面；GeoLens 不会自动修改网站。</p>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-700">{CHANGE_PLAN_NAV.item}（{plan.items.length}）</h2>
            <div className="mt-2 space-y-2">
              {plan.items.map(item => (
                <div key={item.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-400">{String(item.sortOrder).padStart(2, "0")}</span>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{item.section}</span>
                    <span className="rounded bg-violet-100 px-2 py-0.5 text-xs text-violet-800">{formatChangeType(item.changeType)}</span>
                  </div>
                  <p className="mt-2 text-slate-700">{item.instruction}</p>
                  <p className="mt-1 text-xs text-slate-500">原因：{item.reason}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default function ChangePlanDetailPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <PlanInner />
    </div>
  );
}
