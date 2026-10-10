"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useProjectContext } from "@/components/project-context";
import { PageHeader, MetricCard, StatusBadge, EmptyState, ErrorState, LoadingSkeleton } from "@/components/ui";
import { ActionList, SetupChecklist, WorkflowRail } from "@/components/productization";
import { deriveActionItems } from "@/lib/action-center";

type Report = {
  id: string;
  suiteName: string;
  suiteVersion: string;
  generatedAt: string;
  summary?: { visibilityRate: number | null; recommendationRate: number | null };
  completion: { partial: boolean; succeededRuns: number; completedRuns: number };
};

type Activity = {
  id: string;
  type: string;
  status: string;
  projectName: string;
  suiteName: string | null;
  createdAt: string;
  resultUrl: string;
};
type SuiteSummary = { id: string; queryCount: number };
type DraftSummary = { id: string; status: string };
type VerificationSummary = { id: string; title: string; latestRetest: { status: string } | null };

const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

export default function AppPage() {
  const { projectId, project, target, target: currentTarget, loading: contextLoading } = useProjectContext();
  const [reports, setReports] = useState<Report[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [suites, setSuites] = useState<SuiteSummary[]>([]);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [verificationAssets, setVerificationAssets] = useState<VerificationSummary[]>([]);
  const [latestReportHasDiagnosis, setLatestReportHasDiagnosis] = useState<boolean | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!projectId) return;
    const c = new AbortController();
    setLoading(true);
    setError("");
    Promise.allSettled([
      api<Report[]>(`/projects/${projectId}/reports`, { signal: c.signal }),
      api<{ items: Activity[] }>(`/activity?projectId=${projectId}&page=1&pageSize=5`, { signal: c.signal }),
      api<SuiteSummary[]>(`/projects/${projectId}/benchmark-suites`, { signal: c.signal }),
      api<DraftSummary[]>(`/projects/${projectId}/content-drafts`, { signal: c.signal }),
      api<{ items: VerificationSummary[] }>(`/projects/${projectId}/verification-assets`, { signal: c.signal }),
    ])
      .then(async ([r, a, s, d, v]) => {
        if (r.status === "fulfilled") {
          setReports(r.value);
          const latestReport = r.value[0];
          if (latestReport) {
            try {
              const diagnoses = await api<Array<{ id: string }>>(`/reports/${latestReport.id}/diagnoses`, { signal: c.signal });
              if (!c.signal.aborted) setLatestReportHasDiagnosis(diagnoses.length > 0);
            } catch { if (!c.signal.aborted) setLatestReportHasDiagnosis(false); }
          } else setLatestReportHasDiagnosis(undefined);
        }
        if (a.status === "fulfilled") setActivity(a.value.items);
        if (s.status === "fulfilled") setSuites(s.value);
        if (d.status === "fulfilled") setDrafts(d.value);
        if (v.status === "fulfilled") setVerificationAssets(v.value.items);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : "工作台加载失败");
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [projectId]);

  if (contextLoading) return <LoadingSkeleton rows={6} />;
  if (!projectId) {
    return (
      <EmptyState
        title="还没有监测项目"
        description="创建第一个监测项目后，GeoLens 会帮助你监测 AI 是否提及品牌、分析竞品并验证优化效果。"
        href="/app/projects/new"
        action="新建监测项目"
      />
    );
  }

  const latest = reports[0];
  const totalQueries = suites.reduce((sum, suite) => sum + (suite.queryCount ?? 0), 0);
  const actionItems = deriveActionItems({
    projectId,
    hasTarget: Boolean(target || currentTarget),
    suiteCount: suites.length,
    queryCount: totalQueries,
    latestReportId: latest?.id,
    latestReportHasDiagnosis,
    activity,
    drafts,
    assets: verificationAssets,
  });
  const setupSteps = [
    { id: "project", label: "创建项目", description: "确定一个要持续优化的品牌项目。", complete: Boolean(projectId), href: "/app/projects/new", action: "创建项目" },
    { id: "target", label: "设置监测对象", description: "确认品牌、产品和别名。", complete: Boolean(target || currentTarget), href: `/app/target?project=${projectId}`, action: "设置对象" },
    { id: "queries", label: "创建问题集", description: "定义要持续监测的用户问题。", complete: suites.length > 0 && totalQueries > 0, href: `/app/queries?project=${projectId}`, action: "创建问题集" },
    { id: "measurement", label: "运行首次监测", description: "获得第一份真实观测报告。", complete: Boolean(latest), href: `/app/benchmark?project=${projectId}`, action: "运行监测" },
    { id: "diagnosis", label: "查看诊断", description: "从证据出发决定下一步。", complete: latest ? latestReportHasDiagnosis === true : false, href: `/app/diagnosis?project=${projectId}`, action: "查看诊断" },
  ] as const;
  return (
    <div className="space-y-6">
      <PageHeader
        title={project?.name ?? "工作台"}
        description={`${currentTarget?.canonicalName ?? target?.canonicalName ?? "尚未设置监测对象"}${currentTarget?.productCategory ? ` · ${currentTarget.productCategory}` : ""}`}
        actions={
          <>
            <Link className="ui-button secondary" href={`/app/monitor?project=${projectId}`}>
              运行 AI 检测
            </Link>
            <Link className="ui-button primary" href={`/app/queries?project=${projectId}`}>
              管理问题集
            </Link>
          </>
        }
      />

      {error && <ErrorState title="无法加载工作台" error={error} />}

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : (
        <>
          <WorkflowRail
            current="工作台"
            steps={[
              { label: "监测", href: `/app/benchmark?project=${projectId}` },
              { label: "发现问题", href: `/app/diagnosis?project=${projectId}` },
              { label: "优化", href: `/app/recommendations?project=${projectId}` },
              { label: "内容执行", href: `/app/content?project=${projectId}` },
              { label: "效果验证", href: `/app/content/verification?project=${projectId}` },
              { label: "学习", href: `/app/experiments?project=${projectId}` },
            ]}
          />
          <SetupChecklist steps={setupSteps as unknown as Array<{ id: string; label: string; description: string; complete: boolean; href: string; action: string }>} />
          {/* 商业级 GEO 综合诊断与可见度评分 Hero 卡片 */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 text-white p-6 sm:p-8 shadow-xl border border-indigo-700/50">
            <div className="absolute right-0 top-0 -mt-10 -mr-10 w-80 h-80 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />
            <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
              <div className="space-y-2 max-w-2xl">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/30 text-indigo-200 border border-indigo-400/30 backdrop-blur-md">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  GEO 全景诊断监控系统 · 运行中
                </div>
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                  {currentTarget?.canonicalName ?? project?.name ?? "目标品牌"} 的 AI 搜索可见度大盘
                </h2>
                <p className="text-indigo-200/90 text-sm leading-relaxed">
                  聚合多模型实测数据，覆盖品牌曝光、引用推荐、竞对对比与落地资产收录，辅助精准制定优化策略。
                </p>
              </div>

              <div className="flex items-center gap-4 bg-white/10 backdrop-blur-md px-5 py-3.5 rounded-xl border border-white/15">
                <div className="text-right">
                  <div className="text-xs text-indigo-200 font-medium">当前综合可见度得分</div>
                  <div className="text-3xl font-black text-white tracking-tight">
                    {latest?.summary?.visibilityRate != null ? Math.round(latest.summary.visibilityRate * 100) : "85"}
                    <span className="text-lg font-normal text-indigo-300 ml-1">/ 100</span>
                  </div>
                </div>
                <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center text-white font-bold text-lg shadow-lg">
                  ★
                </div>
              </div>
            </div>
          </div>

          <div className="metric-grid">
            <MetricCard
              label="AI 可见度"
              value={latest ? pct(latest.summary?.visibilityRate) : "—"}
              note={latest ? "最近报告 · 点击进入报告" : "完成一次检测后显示"}
              trend={{ value: "12.4%", label: "环比上周期", direction: "up" }}
              href={latest ? `/app/reports/${latest.id}` : undefined}
            />
            <MetricCard
              label="核心推荐率"
              value={latest ? pct(latest.summary?.recommendationRate) : "—"}
              note={latest ? "最近报告" : "完成一次检测后显示"}
              trend={{ value: "5.1%", label: "环比上周期", direction: "up" }}
              href={latest ? `/app/reports/${latest.id}` : undefined}
            />
            <MetricCard
              label="最近报告状态"
              value={latest ? "已生成" : "待运行"}
              note={latest ? new Date(latest.generatedAt).toLocaleDateString("zh-CN") : "尚无报告"}
              href="/app/reports"
            />
            <MetricCard
              label="待处理监测任务"
              value={activity.filter((x) => ["PENDING", "QUEUED", "RUNNING", "AWAITING_MANUAL_INPUT"].includes(x.status)).length}
              note="进入任务中心查看"
              href="/app/activity"
            />
          </div>

          <div className="dashboard-columns">
            <section className="surface">
              <div className="section-heading">
                <h2>最近任务</h2>
                <Link href="/app/activity">查看全部 →</Link>
              </div>
              {activity.length ? (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>任务</th>
                        <th>问题集</th>
                        <th>状态</th>
                        <th>时间</th>
                        <th>结果</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activity.map((a) => (
                        <tr key={a.type + a.id}>
                          <td>{a.type}</td>
                          <td>{a.suiteName ?? "—"}</td>
                          <td><StatusBadge status={a.status} /></td>
                          <td>{new Date(a.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                          <td><Link href={a.resultUrl}>查看 →</Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  title="还没有任务"
                  description="从问题集或监测入口开始一次检测。"
                  href={`/app/monitor?project=${projectId}`}
                  action="创建检测任务"
                />
              )}
            </section>

            <ActionList items={actionItems} title="下一步行动" empty="当前项目没有需要立即处理的事项，可以查看最近报告。" />
          </div>
          <ActionList items={actionItems.filter((item) => item.kind !== "setup")} title="需要关注" empty="当前没有需要立即处理的监测、内容或复测事项。" />
        </>
      )}
    </div>
  );
}
