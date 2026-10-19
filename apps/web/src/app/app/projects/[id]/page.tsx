"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { QuickStartStage } from "@/lib/quick-start.types";

type ProjectOverview = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  industry: string | null;
  status: string;
  brands: Array<{ id: string; name: string; website: string | null; description: string | null }>;
  competitors: Array<{ id: string; name: string; website: string | null }>;
  querySets: Array<{
    id: string;
    name: string;
    description: string | null;
    queries: Array<{ id: string; text: string; type: string; source: string; status: string }>;
  }>;
};

type SessionSummary = {
  id: string;
  currentStep: QuickStartStage;
  updatedAt: string;
  project: { id: string; name: string };
  brand: { name: string };
  runs: Array<{ id: string; status: string; responseCount: number; isMock: boolean }>;
};

const sourceLabel: Record<string, string> = {
  AI_GENERATED: "AI 生成",
  MANUAL: "手动添加",
  IMPORTED: "导入",
};

export default function ProjectWorkbenchPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const [project, setProject] = useState<ProjectOverview | null>(null);
  const [latestSession, setLatestSession] = useState<SessionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [projectData, sessions] = await Promise.all([
        api<ProjectOverview>(`/projects/${projectId}`),
        api<SessionSummary[]>("/quick-start/sessions"),
      ]);
      setProject(projectData);
      setLatestSession(sessions.find((session) => session.project.id === projectId) ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载项目工作台失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  const queryCount = project?.querySets.reduce((sum, set) => sum + set.queries.length, 0) ?? 0;

  return (
    <main className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/app" className="text-xs font-medium text-blue-700 hover:text-blue-800">← 返回工作台</Link>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-blue-600">PROJECT WORKSPACE</p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{project?.name ?? "项目工作台"}</h1>
          <p className="mt-2 text-sm text-slate-500">品牌、竞品和快速开始问题都保存在这个正式项目中。</p>
        </div>
        <Link href={`/app/quick-start?projectId=${projectId}`} className="inline-flex min-h-10 items-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">继续 GEO 检测</Link>
      </div>

      {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><span>{error}</span><button onClick={() => void load()} className="font-semibold underline underline-offset-2">重试</button></div>}
      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">正在加载项目资料…</div>
      ) : project ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryTile label="行业" value={project.industry || "待补充"} />
            <SummaryTile label="品牌" value={`${project.brands.length} 个`} />
            <SummaryTile label="竞品" value={`${project.competitors.length} 个`} />
            <SummaryTile label="监测问题" value={`${queryCount} 条`} />
          </div>

          {latestSession && (
            <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-blue-100 bg-blue-50/70 p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">快速开始进度</p>
                <h2 className="mt-1.5 text-sm font-semibold text-slate-900">{latestSession.brand.name} · 最近更新 {new Date(latestSession.updatedAt).toLocaleDateString()}</h2>
                <p className="mt-1 text-xs text-slate-500">当前第 {stageNumber(latestSession.currentStep)} 步{latestSession.runs[0] ? ` · 最近检测 ${runLabel(latestSession.runs[0].status)}` : " · 尚未运行检测"}</p>
              </div>
              <Link href={`/app/quick-start?sessionId=${latestSession.id}`} className="inline-flex min-h-9 items-center rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700">继续快速开始 →</Link>
            </section>
          )}

          <div className="grid gap-5 xl:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div><h2 className="text-base font-semibold text-slate-900">品牌</h2><p className="mt-1 text-xs text-slate-500">当前项目中的正式品牌资料</p></div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">{project.brands.length}</span>
              </div>
              {project.brands.length ? <ul className="mt-4 space-y-2">{project.brands.map((brand) => <li key={brand.id} className="rounded-xl border border-slate-200 p-3.5"><p className="text-sm font-semibold text-slate-800">{brand.name}</p><p className="mt-1 break-all text-xs text-slate-500">{brand.website || "尚未填写官网"}</p></li>)}</ul> : <p className="mt-4 rounded-xl bg-slate-50 p-4 text-xs text-slate-500">尚未添加品牌资料。</p>}
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div><h2 className="text-base font-semibold text-slate-900">竞品</h2><p className="mt-1 text-xs text-slate-500">供 Query 和回答对比使用的项目资料</p></div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">{project.competitors.length}</span>
              </div>
              {project.competitors.length ? <ul className="mt-4 grid gap-2 sm:grid-cols-2">{project.competitors.map((competitor) => <li key={competitor.id} className="rounded-xl border border-slate-200 p-3.5"><p className="text-sm font-semibold text-slate-800">{competitor.name}</p><p className="mt-1 break-all text-xs text-slate-500">{competitor.website || "尚未填写官网"}</p></li>)}</ul> : <p className="mt-4 rounded-xl bg-slate-50 p-4 text-xs text-slate-500">暂无竞品，可在快速开始或项目设置中补充。</p>}
            </section>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><h2 className="text-base font-semibold text-slate-900">Query Set 与监测问题</h2><p className="mt-1 text-xs text-slate-500">快速开始确认的问题已写入正式 Query Set，可供后续监测使用。</p></div>
              <span className="text-xs text-slate-400">{queryCount} 条问题</span>
            </div>
            {project.querySets.length ? (
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                {project.querySets.map((set) => (
                  <article key={set.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-800">{set.name}</h3><span className="text-xs text-slate-400">{set.queries.length} 条</span></div>
                    {set.description && <p className="mt-1 text-xs text-slate-500">{set.description}</p>}
                    {set.queries.length ? <ul className="mt-3 divide-y divide-slate-100">{set.queries.map((query) => <li key={query.id} className="flex items-start justify-between gap-3 py-2.5 text-xs"><span className="leading-5 text-slate-700">{query.text}<span className="mt-1 block text-[10px] text-slate-400">{sourceLabel[query.source] ?? query.source} · {query.type}</span></span><span className={`shrink-0 rounded-full px-2 py-0.5 ${query.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{query.status === "ACTIVE" ? "启用" : "已归档"}</span></li>)}</ul> : <p className="mt-3 text-xs text-slate-400">该 Query Set 暂无问题。</p>}
                  </article>
                ))}
              </div>
            ) : <p className="mt-4 rounded-xl bg-slate-50 p-4 text-xs text-slate-500">暂无 Query Set。可从快速开始生成第一组监测问题。</p>}
          </section>
        </>
      ) : null}
    </main>
  );
}

function stageNumber(stage: string) {
  return ["BRAND", "QUESTIONS", "MONITOR", "REPORT", "CONTENT", "DISTRIBUTION"].indexOf(stage) + 1;
}

function runLabel(status: string) {
  return status === "COMPLETED" ? "已完成" : status === "RUNNING" ? "进行中" : status === "PARTIAL" ? "部分完成" : "执行失败";
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-400">{label}</p><p className="mt-2 break-words text-lg font-semibold text-slate-900">{value}</p></div>;
}
