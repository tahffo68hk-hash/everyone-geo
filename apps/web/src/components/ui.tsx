import Link from "next/link";
import type { ReactNode } from "react";
import { formatStatus } from "@/lib/labels";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <header className="page-header"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>;
}
export function StatusBadge({ status }: { status: string }) {
  const good = ["SUCCEEDED", "EVALUATED", "ENABLED"].includes(status);
  const warning = ["PARTIAL", "AWAITING_MANUAL_INPUT", "READY_FOR_EVALUATION"].includes(status);
  const active = ["RUNNING", "QUEUED", "RETEST_RUNNING"].includes(status);
  const labels: Record<string, string> = { PENDING: "等待中", QUEUED: "排队中", RUNNING: "运行中", SUCCEEDED: "已完成", PARTIAL: "部分完成", FAILED: "失败", CANCELLED: "已取消", SKIPPED: "已跳过", AWAITING_MANUAL_INPUT: "等待人工录入", ENABLED: "已启用", DISABLED: "已停用" };
  const experiments: Record<string, string> = { PLANNED: "已规划", EXECUTION_RECORDED: "已记录执行", RETEST_READY: "待复测", RETEST_RUNNING: "复测中", READY_FOR_EVALUATION: "待评估", EVALUATED: "已评估" };
  return <span className={`status-badge ${good ? "status-success" : warning ? "status-warning" : status === "FAILED" ? "status-danger" : active ? "status-active" : ""}`}><span aria-hidden="true">●</span>{labels[status] ?? experiments[status] ?? formatStatus(status)}</span>;
}
export function EmptyState({ title, description, href, action }: { title: string; description: string; href?: string; action?: string }) {
  return <section className="empty-state"><span aria-hidden="true" className="empty-mark">◎</span><h2>{title}</h2><p>{description}</p>{href && action && <Link className="ui-button primary" href={href}>{action}</Link>}</section>;
}
export function ErrorState({ title = "无法加载此页面", error, retry }: { title?: string; error?: string; retry?: () => void }) {
  return <section role="alert" className="error-state"><strong>{title}</strong><p>请重试；若问题持续，请稍后再打开。</p>{retry && <button className="ui-button" onClick={retry}>重试</button>}{error && <details><summary>技术详情</summary><pre>{error}</pre></details>}</section>;
}
export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return <div role="status" aria-label="正在加载" className="loading-skeleton"><span className="sr-only">正在加载…</span>{Array.from({length:rows}, (_, i) => <div key={i} />)}</div>;
}
export function MetricCard({ label, value, note, href, onClick }: { label: string; value: ReactNode; note?: string; href?: string; onClick?: () => void }) {
  const inner = <><span className="metric-label">{label}</span><strong>{value}</strong><span className="metric-note">{note ?? "查看相关证据 →"}</span></>;
  return href ? <Link className="metric-card" href={href}>{inner}</Link> : onClick ? <button type="button" className="metric-card" onClick={onClick}>{inner}</button> : <div className="metric-card">{inner}</div>;
}
export function FilterBar({ children }: { children: ReactNode }) { return <div className="filter-bar">{children}</div>; }
export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total/pageSize));
  return <nav aria-label="分页" className="pagination"><span>共 {total} 条 · 第 {page} / {pages} 页</span><div><button className="ui-button" disabled={page <= 1} onClick={() => onChange(page-1)}>上一页</button><button className="ui-button" disabled={page >= pages} onClick={() => onChange(page+1)}>下一页</button></div></nav>;
}
