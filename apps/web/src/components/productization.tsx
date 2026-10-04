import Link from "next/link";
import type { ReactNode } from "react";
import type { ActionItem } from "@/lib/action-center";

export type SetupStep = {
  id: string;
  label: string;
  description: string;
  complete: boolean;
  href: string;
  action: string;
};

function priorityLabel(priority: ActionItem["priority"]): string {
  return priority === "high" ? "优先" : priority === "medium" ? "建议" : "可选";
}

export function ActionList({ items, title = "需要关注", empty = "当前没有需要立即处理的事项。" }: { items: ActionItem[]; title?: string; empty?: string }) {
  return (
    <section className="surface product-action-list" aria-labelledby="action-list-title">
      <div className="section-heading">
        <div>
          <h2 id="action-list-title">{title}</h2>
          <p className="mt-1 text-xs text-slate-500">从当前项目状态推导，不新增一套任务状态。</p>
        </div>
      </div>
      {items.length ? (
        <div className="divide-y divide-slate-100">
          {items.map((item) => (
            <Link key={item.id} href={item.href} className="product-action-row group">
              <span className={`product-action-priority priority-${item.priority}`}>{priorityLabel(item.priority)}</span>
              <span className="min-w-0 flex-1">
                <strong className="block text-sm text-slate-900 group-hover:text-teal-700">{item.title}</strong>
                <span className="mt-1 block text-xs leading-relaxed text-slate-500">{item.reason}</span>
                <span className="mt-1 block text-[11px] text-slate-400">来源：{item.source}</span>
              </span>
              <span aria-hidden="true" className="text-sm text-slate-400 group-hover:text-teal-700">→</span>
            </Link>
          ))}
        </div>
      ) : <p className="p-4 text-sm text-slate-500">{empty}</p>}
    </section>
  );
}

export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const completed = steps.filter((step) => step.complete).length;
  const next = steps.find((step) => !step.complete);
  if (!next) return null;
  return (
    <section className="surface setup-checklist" aria-labelledby="setup-checklist-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-teal-700">首次使用</p>
          <h2 id="setup-checklist-title" className="mt-1 text-base font-semibold text-slate-900">完成一次真实监测</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">按顺序完成下面几步，先得到一份可追溯的报告，再决定优化方向。</p>
        </div>
        <span className="text-xs font-medium text-slate-500">{completed} / {steps.length} 已完成</span>
      </div>
      <ol className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        {steps.map((step, index) => (
          <li key={step.id} className={`setup-step ${step.complete ? "is-complete" : step.id === next.id ? "is-next" : ""}`}>
            <span className="setup-step-index">{step.complete ? "✓" : index + 1}</span>
            <span className="min-w-0">
              <strong className="block text-xs text-slate-900">{step.label}</strong>
              <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">{step.description}</span>
              {!step.complete && <Link href={step.href} className="mt-2 inline-flex text-xs font-semibold text-teal-700 hover:underline">{step.action} →</Link>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function WorkflowRail({ steps, current }: { steps: Array<{ label: string; href?: string }>; current: string }) {
  return (
    <nav aria-label="工作流" className="workflow-rail">
      {steps.map((step, index) => <span key={step.label} className="contents">
        {step.href ? <Link href={step.href} className={step.label === current ? "is-current" : ""}>{step.label}</Link> : <span className={step.label === current ? "is-current" : ""}>{step.label}</span>}
        {index < steps.length - 1 && <span className="workflow-arrow" aria-hidden="true">→</span>}
      </span>)}
    </nav>
  );
}

export function FactInterpretation({ facts, interpretation, evidenceHref }: { facts: ReactNode; interpretation?: ReactNode; evidenceHref?: string }) {
  return (
    <section className="fact-interpretation" aria-label="事实与解读">
      <div><p className="fact-interpretation-label">观测事实</p><div className="mt-1 text-sm text-slate-800">{facts}</div></div>
      {interpretation && <div className="mt-3 border-t border-slate-200 pt-3"><p className="fact-interpretation-label">AI 解读</p><div className="mt-1 text-sm leading-relaxed text-slate-700">{interpretation}</div></div>}
      {evidenceHref && <Link href={evidenceHref} className="mt-3 inline-flex text-xs font-semibold text-teal-700 hover:underline">查看证据 →</Link>}
    </section>
  );
}
