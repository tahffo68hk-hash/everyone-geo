import Link from "next/link";
import type { ReactNode } from "react";
import { formatStatus } from "@/lib/labels";

export function PageHeader({
  title,
  description,
  actions,
  badge,
  backHref,
  backLabel = "返回",
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  badge?: ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <header className="page-header">
      <div>
        {backHref && (
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-teal-700 transition mb-2"
          >
            ← {backLabel}
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{title}</h1>
          {badge}
        </div>
        {description && <p className="mt-1 text-xs sm:text-sm text-slate-500 max-w-3xl leading-relaxed">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const good = ["SUCCEEDED", "EVALUATED", "ENABLED", "PUBLISHED", "COMPLETED", "EXACT_MATCH"].includes(status);
  const warning = ["PARTIAL", "AWAITING_MANUAL_INPUT", "READY_FOR_EVALUATION", "COMPARABLE_WITH_WARNING", "CONFOUNDED"].includes(status);
  const active = ["RUNNING", "QUEUED", "RETEST_RUNNING"].includes(status);
  const danger = ["FAILED", "INCOMPATIBLE", "MISSING_BASELINE"].includes(status);

  const labels: Record<string, string> = {
    PENDING: "等待中",
    QUEUED: "排队中",
    RUNNING: "运行中",
    SUCCEEDED: "已完成",
    COMPLETED: "已完成",
    PARTIAL: "部分完成",
    FAILED: "失败",
    CANCELLED: "已取消",
    SKIPPED: "已跳过",
    AWAITING_MANUAL_INPUT: "等待人工录入",
    ENABLED: "已启用",
    DISABLED: "已停用",
    PUBLISHED: "已发布",
    DRAFT: "草稿",
    SCHEDULED: "已排期",
    PRODUCING: "生产中",
    REVIEWING: "审核中",
  };

  const experiments: Record<string, string> = {
    PLANNED: "已规划",
    EXECUTION_RECORDED: "已记录执行",
    RETEST_READY: "待复测",
    RETEST_RUNNING: "复测中",
    READY_FOR_EVALUATION: "待评估",
    EVALUATED: "已评估",
  };

  const displayText = labels[status] ?? experiments[status] ?? formatStatus(status);

  return (
    <span
      className={`status-badge ${
        good
          ? "status-success"
          : warning
          ? "status-warning"
          : danger
          ? "status-danger"
          : active
          ? "status-active"
          : ""
      }`}
    >
      {displayText}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  href,
  action,
}: {
  title: string;
  description: string;
  href?: string;
  action?: string;
}) {
  return (
    <section className="empty-state">
      <h2>{title}</h2>
      <p>{description}</p>
      {href && action && (
        <Link className="ui-button primary" href={href}>
          {action}
        </Link>
      )}
    </section>
  );
}

export function ErrorState({
  title = "无法加载此页面",
  error,
  retry,
}: {
  title?: string;
  error?: string;
  retry?: () => void;
}) {
  return (
    <section role="alert" className="error-state">
      <strong className="block text-sm font-semibold">{title}</strong>
      <p className="mt-1 text-xs text-slate-500">请尝试刷新重试；若问题持续，请稍后再试。</p>
      {retry && (
        <button type="button" className="ui-button secondary text-xs mt-2" onClick={retry}>
          重新尝试
        </button>
      )}
      {error && (
        <details className="mt-3 text-xs">
          <summary className="text-slate-400 cursor-pointer hover:text-slate-600">技术详情</summary>
          <pre>{error}</pre>
        </details>
      )}
    </section>
  );
}

export function LoadingSkeleton({
  rows = 4,
  variant = "table",
}: {
  rows?: number;
  variant?: "table" | "card" | "detail";
}) {
  if (variant === "card") {
    return (
      <div role="status" aria-label="正在加载" className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <span className="sr-only">正在加载…</span>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="surface p-5 skeleton-shimmer space-y-3">
            <div className="h-4 w-1/3 bg-slate-200/70 rounded" />
            <div className="h-7 w-1/2 bg-slate-200/80 rounded" />
            <div className="h-3 w-3/4 bg-slate-200/50 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div role="status" aria-label="正在加载" className="loading-skeleton">
      <span className="sr-only">正在加载…</span>
      <div className="skeleton-shimmer h-8 w-1/4 mb-4 rounded" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-shimmer" />
      ))}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  note,
  href,
  onClick,
}: {
  label: string;
  value: ReactNode;
  note?: string;
  href?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <span className="metric-note">{note ?? "查看明细 →"}</span>
    </>
  );

  return href ? (
    <Link className="metric-card" href={href}>
      {inner}
    </Link>
  ) : onClick ? (
    <button type="button" className="metric-card" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="metric-card">{inner}</div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="filter-bar">{children}</div>;
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label="分页" className="pagination">
      <span>
        共 {total} 条 · 第 {page} / {pages} 页
      </span>
      <div>
        <button
          type="button"
          className="ui-button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          上一页
        </button>
        <button
          type="button"
          className="ui-button"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          下一页
        </button>
      </div>
    </nav>
  );
}
