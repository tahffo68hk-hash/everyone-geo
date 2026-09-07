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

type Project = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  brands: Array<{ name: string }>;
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
    api<Organization & { projects: Project[] }>(
      `/organizations/${selectedOrg.id}`,
    )
      .then((data) => setProjects((data as { projects: Project[] }).projects))
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

      <div className="mb-6 flex flex-wrap gap-3">
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
            <h2 className="mb-4 text-sm font-semibold text-slate-700">
              项目（租户隔离验证）
            </h2>
            {projects.length === 0 ? (
              <p className="text-sm text-slate-400">该组织暂无项目。</p>
            ) : (
              <ul className="space-y-3">
                {projects.map((p) => (
                  <li
                    key={p.id}
                    className="rounded-xl border border-slate-200 p-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-900">
                        {p.name}
                      </span>
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
                      <p className="mt-1 text-sm text-slate-500">
                        {p.description}
                      </p>
                    )}
                    {p.brands.length > 0 && (
                      <p className="mt-2 text-xs text-slate-400">
                        品牌：{p.brands.map((b) => b.name).join("、")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
