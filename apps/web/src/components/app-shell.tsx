"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useProjectContext } from "./project-context";
import { EmptyState, ErrorState, LoadingSkeleton } from "./ui";
import { api } from "@/lib/api";

const sections = [
  { label: "工作台", path: "/app", members: [] },
  { label: "监测", path: "/app/benchmark", members: ["benchmark", "monitor", "competitors", "manual-runs"] },
  { label: "问题集", path: "/app/queries", members: ["queries"] },
  { label: "任务中心", path: "/app/activity", members: ["activity"] },
  { label: "报告", path: "/app/reports", members: ["reports"] },
  { label: "优化", path: "/app/diagnosis", members: ["diagnosis", "recommendations", "opportunities", "content", "experiments", "site-assets", "change-plans"] },
  { label: "设置", path: "/app/target", members: ["target", "projects"] },
];

const optimization = [
  ["洞察", "diagnosis"],
  ["建议", "recommendations"],
  ["优化机会", "opportunities"],
  ["内容运营", "content"],
  ["效果验证", "content/verification"],
  ["实验与复测", "experiments"],
  ["站点资产", "site-assets"],
];

const monitoring = [
  ["问题集检测", "benchmark"],
  ["持续监测", "monitor"],
  ["竞品", "competitors"],
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const context = useProjectContext();

  const segments = pathname.split("/").filter(Boolean);
  const mainModule = segments[1] ?? "";
  const subSegment = segments[2] ?? "";
  const fullSubpath = segments.slice(1).join("/");

  const current = sections.find((s) => s.members.includes(mainModule)) ?? sections[0];
  const href = (path: string) =>
    context.projectId ? `${path}?project=${encodeURIComponent(context.projectId)}` : path;

  const subnav = current.label === "优化" ? optimization : current.label === "监测" ? monitoring : [];

  const isDetail =
    segments.length >= 3 &&
    !["new", "compare", "verification", "publications"].includes(subSegment);

  const subpageLabel =
    fullSubpath === "content/verification"
      ? "效果验证与归因"
      : subSegment === "new"
      ? "新建"
      : subSegment === "compare"
      ? "对比"
      : context.resourceName || (mainModule === "projects" ? "新建项目" : "详情");

  function isSubnavActive(targetPath: string): boolean {
    if (targetPath === fullSubpath) return true;
    if (targetPath === "content" && fullSubpath === "content") return true;
    if (targetPath === "content/verification" && fullSubpath.startsWith("content/verification")) return true;
    return mainModule === targetPath;
  }

  return (
    <div className="app-shell">
      <a href="#app-content" className="skip-link">
        跳到主要内容
      </a>
      <aside className="app-sidebar">
        <Link href={href("/app")} className="app-brand">
          <span className="brand-symbol" aria-hidden="true">G</span>
          GeoLens
        </Link>
        <nav aria-label="主导航">
          {sections.map((section) => (
            <Link
              key={section.path}
              href={href(section.path)}
              aria-current={current === section ? "page" : undefined}
            >
              {section.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="app-body">
        <header className="app-topbar">
          <div className="project-switch">
            <label htmlFor="global-project">当前项目</label>
            <div>
              <select
                id="global-project"
                value={context.projectId}
                disabled={context.loading || !context.projects.length}
                onChange={(e) => context.setProjectId(e.target.value)}
              >
                {!context.projects.length && <option value="">尚无项目</option>}
                {context.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Link
                className="new-project"
                href={`/app/projects/new?org=${context.me?.organizations[0]?.id ?? ""}`}
                aria-label="新建监测项目"
                title="新建监测项目"
              >
                <span aria-hidden="true">＋</span> 新建
              </Link>
            </div>
          </div>

          <div className="target-context">
            <span>监测对象</span>
            <strong>
              {context.loading
                ? "正在确认项目…"
                : context.target?.canonicalName ?? "尚未设置"}
            </strong>
          </div>

          <div className="user-context">
            <strong>{context.me?.user.name ?? "GeoLens"}</strong>
            <span>{context.me?.organizations.map((o) => o.name).join(" / ") ?? ""}</span>
          </div>

          <button
            type="button"
            className="logout-button"
            onClick={async () => {
              try {
                await api("/auth/logout", { method: "POST" });
                router.replace("/login");
              } catch {
                context.refresh();
              }
            }}
          >
            退出
          </button>
        </header>

        <div className="workspace-heading">
          <nav aria-label="面包屑" className="breadcrumb">
            <Link href={href("/app")}>{context.project?.name ?? "项目"}</Link>
            <span>/</span>
            <Link href={href(current.path)}>{current.label}</Link>
            {(isDetail || fullSubpath === "content/verification") && (
              <>
                <span>/</span>
                <span className="text-slate-700 font-medium">{subpageLabel}</span>
              </>
            )}
          </nav>

          {!!subnav.length && (
            <nav className="module-nav" aria-label={`${current.label}导航`}>
              {subnav.map(([label, path]) => (
                <Link
                  key={path}
                  href={href(`/app/${path}`)}
                  aria-current={isSubnavActive(path) ? "page" : undefined}
                >
                  {label}
                </Link>
              ))}
            </nav>
          )}
        </div>

        <div id="app-content" className="app-content" tabIndex={-1}>
          {context.loading ? (
            <LoadingSkeleton rows={6} />
          ) : context.error ? (
            <ErrorState
              title="无法确认当前项目"
              error={context.error}
              retry={context.refresh}
            />
          ) : !context.projectId && mainModule !== "projects" ? (
            <EmptyState
              title="还没有监测项目"
              description="创建项目后，监测 AI 是否提及品牌、分析竞品、发现内容缺口，并验证优化效果。"
              href={`/app/projects/new?org=${context.me?.organizations[0]?.id ?? ""}`}
              action="新建监测项目"
            />
          ) : (
            <div key={context.projectId}>{children}</div>
          )}
        </div>
      </div>
    </div>
  );
}
