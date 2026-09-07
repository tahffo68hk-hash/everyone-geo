"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { formatProjectStatus, formatRole } from "@/lib/labels";

type Member = {
  id: string;
  role: string;
  user: { id: string; email: string; name: string | null };
};

type Organization = {
  id: string;
  name: string;
  slug: string;
  role: string;
  _count: { projects: number; members: number };
};

type MeResponse = {
  user: {
    id: string;
    email: string;
    name: string | null;
  };
  organizations: Organization[];
};

type ProjectBrand = { id: string; name: string; entityType?: string | null; productCategory?: string | null; website?: string | null };
type LatestRun = { id: string; status: string; runType: string; createdAt: string };

/**
 * API 返回的原始 project。brands 为 optional relation：
 * 正常 contract 下 GET /organizations/:id 恒为数组（[] 或 [{...}]），
 * 但防御性起见允许缺失/空/null，统一在 normalizeProject 收敛为 []，
 * 页面渲染只用归一化后的值，杜绝 p.brands.length 这类 undefined 崩溃。
 */
type RawProject = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  brands?: Array<ProjectBrand> | null;
  _count?: { benchmarkSuites?: number };
  benchmarkRuns?: Array<LatestRun> | null;
};

type Project = Omit<RawProject, "brands" | "_count" | "benchmarkRuns"> & {
  brands: ProjectBrand[];
  suiteCount: number;
  latestRun: LatestRun | null;
};

function normalizeProject(p: RawProject): Project {
  return {
    ...p,
    brands: Array.isArray(p.brands) ? p.brands : [],
    suiteCount: p._count?.benchmarkSuites ?? 0,
    latestRun:
      Array.isArray(p.benchmarkRuns) && p.benchmarkRuns[0] ? p.benchmarkRuns[0] : null,
  };
}

/** BenchmarkRun 状态 → 中文（工作台卡片摘要）。 */
const RUN_STATUS_LABEL: Record<string, string> = {
  PENDING: "排队中", QUEUED: "排队中", RUNNING: "检测中",
  SUCCEEDED: "成功", PARTIAL: "部分成功", FAILED: "失败", CANCELLED: "已取消",
  AWAITING_MANUAL_INPUT: "待人工录入", SKIPPED: "已跳过",
};

export default function AppPage() {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "ready" | "anon">("loading");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    api<MeResponse>("/auth/me")
      .then((data) => {
        setMe(data);
        setState("ready");
        if (data.organizations.length > 0) setSelectedOrg(data.organizations[0]);
      })
      .catch(() => setState("anon"));
  }, []);

  useEffect(() => {
    if (state === "anon") router.replace("/login");
  }, [state, router]);

  useEffect(() => {
    if (!selectedOrg) return;
    api<Organization & { projects?: RawProject[] }>(
      `/organizations/${selectedOrg.id}`,
    )
      .then((data) =>
        setProjects((data.projects ?? []).map(normalizeProject)),
      )
      .catch(() => setProjects([]));
  }, [selectedOrg]);

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  }

  if (state === "loading" || state === "anon") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-400">加载中…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            工作台
          </h1>
          <p className="text-sm text-slate-500">
            {me?.user.name} &lt;{me?.user.email}&gt; · 当前身份已通过 HttpOnly
            Cookie 认证
          </p>
        </div>
        <button
          onClick={logout}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
        >
          退出登录
        </button>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          href={`/app/projects/new?org=${selectedOrg?.id ?? me?.organizations[0]?.id ?? ""}`}
          className="inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
        >
          + 新建监测项目
        </Link>
        <Link href="/app/monitor" className="inline-block rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">
          创建监测任务
        </Link>
        <Link href="/app/benchmark" className="inline-block rounded-lg border border-blue-700 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">
          GEO 基准测试
        </Link>
        <Link href="/app/competitors" className="inline-block rounded-lg border border-indigo-700 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50">
          竞品分析（竞品发现）
        </Link>
        <Link href="/app/reports" className="inline-block rounded-lg border border-teal-700 px-4 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50">
          GEO 基准测试报告
        </Link>
        <Link href="/app/diagnosis" className="inline-block rounded-lg border border-fuchsia-700 px-4 py-2 text-sm font-medium text-fuchsia-700 hover:bg-fuchsia-50">
          GEO 问题诊断
        </Link>
        <Link href="/app/recommendations" className="inline-block rounded-lg border border-orange-700 px-4 py-2 text-sm font-medium text-orange-700 hover:bg-orange-50">
          GEO 优化建议
        </Link>
        <Link href="/app/opportunities" className="inline-block rounded-lg border border-teal-700 px-4 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50">
          内容机会
        </Link>
        <Link href="/app/experiments" className="inline-block rounded-lg border border-cyan-700 px-4 py-2 text-sm font-medium text-cyan-700 hover:bg-cyan-50">
          优化实验
        </Link>
        <Link href="/app/site-assets" className="inline-block rounded-lg border border-violet-700 px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50">
          站点资产
        </Link>
        <Link href="/app/target" className="inline-block rounded-lg border border-emerald-700 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50">
          监测对象
        </Link>
        <Link href="/app/queries" className="inline-block rounded-lg border border-sky-700 px-4 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50">
          监测问题
        </Link>
      </div>

      {me && me.organizations.length === 0 ? (
        <p className="text-sm text-slate-500">你还没有加入任何组织。</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              我的组织
            </h2>
            <ul className="space-y-2">
              {me?.organizations.map((org) => (
                <li key={org.id}>
                  <button
                    onClick={() => setSelectedOrg(org)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                      selectedOrg?.id === org.id
                        ? "bg-blue-50 text-blue-700"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="block font-medium">{org.name}</span>
                    <span className="block text-xs text-slate-400">
                      {org.slug} · {org._count.projects} 个项目 · 角色
                      {formatRole(org.role)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-700">我的项目</h2>
              <Link href={`/app/projects/new?org=${selectedOrg?.id ?? me?.organizations[0]?.id ?? ""}`} className="text-xs font-medium text-blue-700 hover:underline">+ 新建监测项目</Link>
            </div>
            {projects.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
                <p className="text-sm font-medium text-slate-600">还没有监测项目</p>
                <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-slate-500">
                  创建一个品牌或产品，配置真实用户问题，GeoLens 会检测 AI 回答中是否自然提到你的品牌。
                </p>
                <Link
                  href={`/app/projects/new?org=${selectedOrg?.id ?? me?.organizations[0]?.id ?? ""}`}
                  className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  创建第一个监测项目
                </Link>
              </div>
            ) : (
              <ul className="space-y-3">
                {projects.map((p) => {
                  const brand = p.brands[0] ?? null;
                  const hasTarget = Boolean(brand?.name);
                  return (
                    <li key={p.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-slate-900">{p.name}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            p.status === "ACTIVE"
                              ? "bg-green-100 text-green-700"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {formatProjectStatus(p.status)}
                        </span>
                      </div>
                      {p.description && (
                        <p className="mt-1 text-sm text-slate-500">{p.description}</p>
                      )}
                      {hasTarget ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
                            监测对象：{brand!.name}
                          </span>
                          {brand!.productCategory && (
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                              产品类别：{brand!.productCategory}
                            </span>
                          )}
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                            {p.suiteCount} 个问题集
                          </span>
                          {p.latestRun && (
                            <span className="text-xs text-slate-500">
                              最近检测：{RUN_STATUS_LABEL[p.latestRun.status] ?? p.latestRun.status}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800">尚未设置监测对象</span>
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{p.suiteCount} 个问题集</span>
                          <Link href={`/app/target?project=${p.id}`} className="text-xs font-medium text-blue-700 hover:underline">继续设置 →</Link>
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap gap-3 text-xs">
                        <Link href={`/app/queries?project=${p.id}`} className="font-medium text-slate-700 hover:text-blue-700">问题集</Link>
                        <Link href={`/app/target?project=${p.id}`} className="font-medium text-slate-700 hover:text-blue-700">监测对象</Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
