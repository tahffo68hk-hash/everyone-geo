"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useProjectContext } from "@/components/project-context";
import { PageHeader, MetricCard, StatusBadge, EmptyState, ErrorState, LoadingSkeleton } from "@/components/ui";

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

const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

export default function AppPage() {
  const { projectId, project, target, target: currentTarget, loading: contextLoading } = useProjectContext();
  const [reports, setReports] = useState<Report[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!projectId) return;
    const c = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      api<Report[]>(`/projects/${projectId}/reports`, { signal: c.signal }),
      api<{ items: Activity[] }>(`/activity?projectId=${projectId}&page=1&pageSize=5`, { signal: c.signal }),
    ])
      .then(([r, a]) => {
        setReports(r);
        setActivity(a.items);
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
          <div className="dashboard-note">
            <span className="status-badge status-active">
              <span aria-hidden="true">●</span>当前项目
            </span>
            <span>指标只来自已生成报告；没有竞品集合时，AI 声量份额显示“不适用”。</span>
          </div>

          <div className="metric-grid">
            <MetricCard
              label="AI 可见度"
              value={latest ? pct(latest.summary?.visibilityRate) : "—"}
              note={latest ? "最近报告 · 点击进入报告" : "完成一次检测后显示"}
              href={latest ? `/app/reports/${latest.id}` : undefined}
            />
            <MetricCard
              label="推荐率"
              value={latest ? pct(latest.summary?.recommendationRate) : "—"}
              note={latest ? "最近报告" : "完成一次检测后显示"}
              href={latest ? `/app/reports/${latest.id}` : undefined}
            />
            <MetricCard
              label="最近报告"
              value={latest ? "已生成" : "—"}
              note={latest ? new Date(latest.generatedAt).toLocaleDateString("zh-CN") : "尚无报告"}
              href="/app/reports"
            />
            <MetricCard
              label="待处理任务"
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

            <aside className="surface next-step">
              <h3>下一步建议</h3>
              <p>
                {!target && !currentTarget
                  ? "先设置监测对象，GeoLens 才能判断 AI 回答中的品牌提及。"
                  : !latest
                  ? "运行一次 AI 检测，获得第一份可追溯的报告。"
                  : "打开最近报告，查看哪些问题缺少品牌提及，再从优化入口开始行动。"}
              </p>
              <Link
                className="ui-button primary w-full text-center"
                href={
                  !target && !currentTarget
                    ? `/app/target?project=${projectId}`
                    : !latest
                    ? `/app/monitor?project=${projectId}`
                    : `/app/reports/${latest.id}`
                }
              >
                {!target && !currentTarget ? "设置监测对象" : !latest ? "运行 AI 检测" : "查看最近报告"}
              </Link>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
