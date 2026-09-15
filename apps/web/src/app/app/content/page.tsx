"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useProjectContext } from "@/components/project-context";
import { EmptyState, ErrorState, LoadingSkeleton, StatusBadge } from "@/components/ui";
import { friendlyError, formatStatus } from "@/lib/labels";
import { listChannelCapabilities, listChannelConnections, listContentDrafts, type Capability, type Connection, type Draft, type DraftStatus } from "@/lib/content-api";

const statuses: Array<[DraftStatus | "", string]> = [["", "全部内容"], ["DRAFT", "草稿"], ["READY_FOR_REVIEW", "待审核"], ["CHANGES_REQUESTED", "需要修改"], ["APPROVED", "已批准"], ["PUBLISHED", "已发布"], ["ARCHIVED", "已归档"]];
const statusLabel: Record<string, string> = { DRAFT: "草稿", READY_FOR_REVIEW: "待审核", CHANGES_REQUESTED: "需要修改", APPROVED: "已批准", REJECTED: "已拒绝", PUBLISHED: "已发布", ARCHIVED: "已归档" };
const channelLabel: Record<string, string> = { XIAOHONGSHU: "小红书", DOUYIN: "抖音", WEIBO: "微博", WECHAT: "微信", BAIDU: "百度", OTHER: "其他" };

export default function ContentWorkspacePage() {
  const { projectId } = useProjectContext();
  const [rows, setRows] = useState<Draft[]>([]); const [status, setStatus] = useState<DraftStatus | "">("");
  const [caps, setCaps] = useState<Capability[]>([]); const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => { if (!projectId) return; setLoading(true); Promise.all([listContentDrafts(projectId, status || undefined), listChannelCapabilities(), listChannelConnections(projectId)]).then(([drafts, capabilities, links]) => { setRows(drafts); setCaps(capabilities); setConnections(links); }).catch(err => setError(friendlyError(err))).finally(() => setLoading(false)); }, [projectId, status]);
  const counts = useMemo(() => statuses.slice(1).map(([key, label]) => [label, rows.filter(r => r.status === key).length] as const), [rows]);
  if (loading) return <main className="min-h-screen bg-slate-50 p-4 sm:p-8"><LoadingSkeleton rows={7}/></main>;
  if (error) return <main className="min-h-screen bg-slate-50 p-4 sm:p-8"><ErrorState title="无法加载内容草稿" error={error}/></main>;
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><div className="mx-auto max-w-7xl space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold">内容执行</h1><p className="mt-2 text-sm text-slate-500">从优化机会出发，管理内容版本、审核与模拟发布。发布结果不等同于 GEO 提升。</p></div><Link href="/app/content/new" className="ui-button primary">创建内容草稿</Link></header>
    <section className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">内容草稿</p><p className="mt-1 text-2xl font-semibold">{rows.length}</p></div><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">已连接账号</p><p className="mt-1 text-2xl font-semibold">{connections.filter(c => c.status === "CONNECTED").length}</p></div><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">渠道能力</p><p className="mt-1 text-sm font-medium">{caps.length ? `${caps.length} 个渠道，均为模拟发布` : "能力信息待加载"}</p></div></section>
    <section className="flex flex-wrap gap-2">{statuses.map(([key, label]) => <button key={key} type="button" onClick={() => setStatus(key)} className={`rounded-lg px-3 py-1.5 text-xs ${status === key ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600"}`}>{label}{key && <span className="ml-1 opacity-70">{counts.find(c => c[0] === label)?.[1] ?? 0}</span>}</button>)}</section>
    {rows.length === 0 ? <EmptyState title={status ? `暂无${statusLabel[status] ?? "符合条件的"}内容` : "还没有内容草稿"} description="从优化机会创建草稿，或先创建一份人工内容草稿开始执行。" href="/app/content/new" action="创建内容草稿"/> : <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white"><table className="w-full min-w-[900px] border-collapse text-sm"><thead><tr className="border-b border-slate-200 bg-slate-100 text-left text-xs text-slate-500"><th className="px-4 py-3">标题</th><th className="px-4 py-3">渠道</th><th className="px-4 py-3">来源</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">最新版本</th><th className="px-4 py-3">更新时间</th><th className="px-4 py-3">操作</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50"><td className="px-4 py-3"><Link href={`/app/content/${row.id}`} className="font-medium text-blue-700 hover:underline">{row.title}</Link><p className="text-xs text-slate-400">{row.topic ?? "未设置主题"}</p></td><td className="px-4 py-3 text-slate-600">{row.topic?.match(/XIAOHONGSHU|DOUYIN|WEIBO|WECHAT|BAIDU|OTHER/)?.[0] ? channelLabel[row.topic] : "渠道中立"}</td><td className="px-4 py-3 text-slate-500">{row.topic?.includes("opportunity:") ? "优化机会" : "人工创建"}</td><td className="px-4 py-3"><StatusBadge status={row.status}/></td><td className="px-4 py-3 text-slate-600">{row.latestRevision ? `v${row.latestRevision.version}` : "—"}</td><td className="px-4 py-3 text-xs text-slate-500">{new Date(row.updatedAt).toLocaleString("zh-CN", { hour12: false })}</td><td className="px-4 py-3"><Link href={`/app/content/${row.id}`} className="text-xs text-blue-700 hover:underline">查看详情</Link></td></tr>)}</tbody></table></section>}
  </div></main>;
}
