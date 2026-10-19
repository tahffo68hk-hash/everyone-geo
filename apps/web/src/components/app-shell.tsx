"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { href: "/app", label: "工作台", shortLabel: "首页" },
  { href: "/app/quick-start", label: "快速开始", shortLabel: "快速开始" },
  { href: "/app/distribution", label: "发布工作台", shortLabel: "发布" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200/80 bg-white px-5 py-6 lg:flex">
        <Link href="/app" className="flex items-center gap-3 px-2">
          <span className="flex size-10 items-center justify-center rounded-xl bg-blue-600 text-lg font-semibold text-white shadow-sm shadow-blue-200">
            G
          </span>
          <span>
            <span className="block text-base font-semibold tracking-tight">GeoLens</span>
            <span className="block text-[11px] tracking-wide text-slate-400">AI VISIBILITY</span>
          </span>
        </Link>

        <div className="mt-10 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          工作空间
        </div>
        <nav className="mt-3 space-y-1.5" aria-label="主导航">
          {navigation.map((item) => {
            const active =
              item.href === "/app"
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                  active
                    ? "bg-blue-50 font-semibold text-blue-700"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <span className={`size-2 rounded-full ${active ? "bg-blue-600" : "bg-slate-300"}`} />
                {item.label}
                {item.href === "/app/quick-start" && (
                  <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    新手
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
          <p className="text-sm font-semibold text-slate-800">从一份简单检测开始</p>
          <p className="mt-1.5 text-xs leading-5 text-slate-500">
            使用 Mock 体验完整流程，真实模型调用会逐次确认。
          </p>
          <Link
            href="/app/quick-start"
            className="mt-3 inline-flex text-xs font-semibold text-blue-700 hover:text-blue-800"
          >
            开始快速检测 <span aria-hidden="true" className="ml-1">→</span>
          </Link>
        </div>
      </aside>

      <div className="lg:pl-64">
        <div className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <Link href="/app" className="flex items-center gap-2 font-semibold">
              <span className="flex size-8 items-center justify-center rounded-lg bg-blue-600 text-sm text-white">G</span>
              GeoLens
            </Link>
            <nav className="flex items-center gap-1" aria-label="主导航">
              {navigation.map((item) => {
                const active = item.href === "/app"
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-lg px-2.5 py-2 text-xs font-medium ${active ? "bg-blue-50 text-blue-700" : "text-slate-500"}`}
                  >
                    {item.shortLabel}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-9 lg:py-9">
          {pathname === "/app" && (
            <section className="mb-6 flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-700 to-indigo-700 px-5 py-5 text-white shadow-sm sm:px-7">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-100">快速开始 · 约 5 分钟</p>
                <h1 className="mt-1.5 text-lg font-semibold sm:text-xl">先看 AI 如何回答你的品牌</h1>
                <p className="mt-1.5 max-w-2xl text-xs leading-5 text-blue-100 sm:text-sm">输入品牌、确认监测问题，再把回答证据变成可复核的优化内容。</p>
              </div>
              <Link href="/app/quick-start" className="inline-flex min-h-10 items-center rounded-xl bg-white px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50">
                开始 GEO 检测 <span aria-hidden="true" className="ml-2">→</span>
              </Link>
            </section>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
