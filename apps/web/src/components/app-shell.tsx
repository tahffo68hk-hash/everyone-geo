"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, type ReactNode } from "react";
import { useProjectContext } from "./project-context";
import { EmptyState, ErrorState, LoadingSkeleton } from "./ui";
import { api } from "@/lib/api";

interface NavItem {
  label: string;
  path: string;
  icon: (props: { className?: string }) => ReactNode;
  badge?: string;
  exact?: boolean;
}

interface NavGroup {
  groupTitle: string;
  items: NavItem[];
}

// 现代商业级 SVG 图标
function IconDashboard({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </svg>
  );
}

function IconBenchmark({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  );
}

function IconQueries({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function IconMonitor({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function IconCompetitors({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="22" x2="18" y1="12" y2="12" />
      <line x1="6" x2="2" y1="12" y2="12" />
      <line x1="12" x2="12" y1="6" y2="2" />
      <line x1="12" x2="12" y1="22" y2="18" />
    </svg>
  );
}

function IconDiagnosis({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function IconLightbulb({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </svg>
  );
}

function IconSparkles({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
    </svg>
  );
}

function IconReports({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" x2="8" y1="13" y2="13" />
      <line x1="16" x2="8" y1="17" y2="17" />
      <line x1="10" x2="8" y1="9" y2="9" />
    </svg>
  );
}

function IconContent({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function IconNewContent({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12h8" />
      <path d="M12 8v8" />
    </svg>
  );
}

function IconSiteAssets({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" x2="22" y1="12" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function IconVerification({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function IconExperiments({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2v7.31L4.69 18.2A2 2 0 0 0 6.4 21h11.2a2 2 0 0 0 1.71-2.8L14 9.31V2" />
      <path d="M8.5 2h7" />
      <path d="M14 9.3h-4" />
    </svg>
  );
}

function IconTarget({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M3 12h3" />
      <path d="M18 12h3" />
      <path d="M12 3v3" />
      <path d="M12 18v3" />
    </svg>
  );
}

function IconActivity({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

const navGroups: NavGroup[] = [
  {
    groupTitle: "GEO 监测与洞察",
    items: [
      { label: "总览看板", path: "/app", icon: IconDashboard, exact: true },
      { label: "基准检测", path: "/app/benchmark", icon: IconBenchmark },
      { label: "问题集库", path: "/app/queries", icon: IconQueries },
      { label: "持续监测", path: "/app/monitor", icon: IconMonitor },
      { label: "竞品态势", path: "/app/competitors", icon: IconCompetitors },
    ],
  },
  {
    groupTitle: "AI 诊断与建议",
    items: [
      { label: "GEO 诊断", path: "/app/diagnosis", icon: IconDiagnosis },
      { label: "优化建议", path: "/app/recommendations", icon: IconLightbulb },
      { label: "内容机会", path: "/app/opportunities", icon: IconSparkles },
      { label: "分析报告", path: "/app/reports", icon: IconReports },
    ],
  },
  {
    groupTitle: "内容生产与分发",
    items: [
      { label: "内容工作台", path: "/app/content", icon: IconContent, exact: true },
      { label: "新建内容", path: "/app/content/new", icon: IconNewContent },
      { label: "站点资产", path: "/app/site-assets", icon: IconSiteAssets },
    ],
  },
  {
    groupTitle: "效果闭环与归因",
    items: [
      { label: "效果验证工作台", path: "/app/content/verification", icon: IconVerification, badge: "F1/F2" },
      { label: "复测实验", path: "/app/experiments", icon: IconExperiments },
    ],
  },
  {
    groupTitle: "系统配置与偏好",
    items: [
      { label: "监测对象", path: "/app/target", icon: IconTarget },
      { label: "任务中心", path: "/app/activity", icon: IconActivity },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const context = useProjectContext();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("geolens_sidebar_collapsed");
    if (saved === "true") setCollapsed(true);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("geolens_sidebar_collapsed", String(next));
      return next;
    });
  };

  const href = (path: string) =>
    context.projectId ? `${path}?project=${encodeURIComponent(context.projectId)}` : path;

  const segments = pathname.split("/").filter(Boolean);
  const mainModule = segments[1] ?? "";
  const subSegment = segments[2] ?? "";
  const fullSubpath = segments.slice(1).join("/");

  // 当前激活项判断
  function isItemActive(item: NavItem): boolean {
    if (item.exact) {
      if (item.path === "/app") return pathname === "/app";
      if (item.path === "/app/content") return pathname === "/app/content";
    }
    if (item.path === "/app/content/verification") {
      return pathname.startsWith("/app/content/verification");
    }
    return pathname.startsWith(item.path);
  }

  // 面包屑标题解析
  let currentTitle = "工作台";
  for (const group of navGroups) {
    for (const item of group.items) {
      if (isItemActive(item)) {
        currentTitle = item.label;
        break;
      }
    }
  }

  const isDetail =
    segments.length >= 3 &&
    !["new", "compare", "verification", "publications"].includes(subSegment);

  return (
    <div className="app-shell">
      <a href="#app-content" className="skip-link">
        跳到主要内容
      </a>

      {/* 商业级多层级分组侧边栏 */}
      <aside className={`app-sidebar ${collapsed ? "collapsed" : ""}`}>
        <Link href={href("/app")} className="app-brand" title="GeoLens 首页">
          <div className="brand-icon-box">G</div>
          {!collapsed && (
            <div className="brand-info">
              <div className="brand-title">
                GeoLens
                <span className="brand-tag">PRO</span>
              </div>
              <div className="brand-sub">AI 搜索可见度优化引擎</div>
            </div>
          )}
        </Link>

        <nav className="mt-4 flex-1 space-y-4" aria-label="系统功能导航">
          {navGroups.map((group) => (
            <div key={group.groupTitle} className="space-y-1">
              {!collapsed && (
                <div className="sidebar-group-title">
                  <span>{group.groupTitle}</span>
                </div>
              )}
              {group.items.map((item) => {
                const active = isItemActive(item);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.path}
                    href={href(item.path)}
                    className={`sidebar-nav-item ${active ? "active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                  >
                    <span className="sidebar-item-icon">
                      <Icon className="w-[18px] h-[18px]" />
                    </span>
                    {!collapsed && (
                      <>
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.badge && (
                          <span className="sidebar-item-badge">{item.badge}</span>
                        )}
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* 侧边栏底部状态与折叠切换 */}
        <div className="sidebar-foot">
          {!collapsed && (
            <div className="sidebar-status-pill">
              <span className="status-dot-pulse" aria-hidden="true" />
              <span className="font-medium text-slate-700">实时引擎就绪</span>
              <span className="ml-auto text-[10px] text-slate-400">v2.4</span>
            </div>
          )}

          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex items-center justify-center gap-2 w-full py-1.5 px-2 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
            title={collapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            <svg
              className={`w-4 h-4 transition-transform ${collapsed ? "rotate-180" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="11 17 6 12 11 7" />
              <polyline points="18 17 13 12 18 7" />
            </svg>
            {!collapsed && <span>收起侧栏</span>}
          </button>
        </div>
      </aside>

      {/* 主体区域 */}
      <div className={`app-body ${collapsed ? "collapsed" : ""}`}>
        {/* 全新半透明毛玻璃 Topbar */}
        <header className="app-topbar">
          <div className="topbar-left">
            {/* 项目切换器 */}
            <div className="project-switch-box">
              <span className="text-indigo-600 text-xs font-bold" aria-hidden="true">❖</span>
              <select
                id="global-project"
                value={context.projectId}
                disabled={context.loading || !context.projects.length}
                onChange={(e) => context.setProjectId(e.target.value)}
                aria-label="选择监测项目"
              >
                {!context.projects.length && <option value="">暂无项目</option>}
                {context.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <Link
              className="new-project-btn"
              href={`/app/projects/new?org=${context.me?.organizations[0]?.id ?? ""}`}
              title="新建监测项目"
            >
              <span className="font-bold">+</span> 新建项目
            </Link>

            {/* 当前目标品牌 Pill */}
            <div className="hidden md:flex items-center gap-2 pl-3 border-l border-slate-200">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                目标品牌
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                {context.loading ? "载入中…" : context.target?.canonicalName ?? "尚未配置"}
              </span>
            </div>
          </div>

          <div className="topbar-right">
            {/* 全局快捷搜索提示 */}
            <div className="hidden lg:flex items-center gap-2 text-xs text-slate-400 bg-slate-100/80 px-3 py-1.5 rounded-lg border border-slate-200/60">
              <IconQueries className="w-3.5 h-3.5 text-slate-400" />
              <span>快速搜索问题或任务</span>
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-white rounded border border-slate-200 text-slate-500 shadow-xs">
                ⌘K
              </kbd>
            </div>

            {/* 用户租户信息与退出 */}
            <div className="flex items-center gap-2 text-xs">
              <div className="w-7 h-7 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center text-xs shadow-xs">
                {(context.me?.user.name || "U")[0]?.toUpperCase()}
              </div>
              <div className="hidden sm:flex flex-col text-left">
                <span className="font-semibold text-slate-800 leading-tight">
                  {context.me?.user.name ?? "用户"}
                </span>
                <span className="text-[10px] text-slate-400 leading-tight">
                  {context.me?.organizations[0]?.name ?? "默认企业租户"}
                </span>
              </div>
            </div>

            <button
              type="button"
              className="text-xs text-slate-400 hover:text-rose-600 px-2 py-1 rounded transition"
              title="退出登录"
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
          </div>
        </header>

        {/* 动态面包屑与页面层级条 */}
        <div className="workspace-heading">
          <nav aria-label="面包屑" className="breadcrumb">
            <Link href={href("/app")} className="hover:text-indigo-600 font-medium">
              {context.project?.name ?? "项目"}
            </Link>
            <span className="text-slate-300">/</span>
            <span className="text-slate-800 font-semibold">{currentTitle}</span>
            {isDetail && (
              <>
                <span className="text-slate-300">/</span>
                <span className="text-slate-500">详情</span>
              </>
            )}
          </nav>
        </div>

        {/* 主内容区域 */}
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
