"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";

type Report = {
  id?: string;
  shareToken?: string;
  suiteName: string;
  suiteVersion: string;
  runType: "DEMO" | "REAL";
  provider: string;
  engineName: string;
  requestedModel: string | null;
  responseModel: string | null;
  metricSource: "demo" | "real" | "mixed";
  analysisVersion: string;
  competitorSet: { id: string; name: string; version: string } | null;
  completion: {
    completedRuns: number;
    succeededRuns: number;
    failedRuns: number;
    analyzedRuns: number;
    partial: boolean;
  };
  generatedAt: string;
  metricsSnapshot: {
    metricVersion: string;
    plannedRuns: number | null;
    overall: {
      visibilityRate: number | null;
      recommendationRate: number | null;
      averageMentionPosition: number | null;
      shareOfVoice: number | null;
      citationCount: number;
      citationDomainCount: number;
      sentimentDistribution: Record<string, number>;
    };
    byCategory: Array<{
      category: string;
      queryEligibleCount: number;
      queryMentionedCount: number;
      metrics: {
        visibilityRate: number | null;
        recommendationRate: number | null;
      };
    }>;
    byQuery: Array<{
      queryText: string;
      category: string | null;
      sortOrder: number | null;
      status: string;
      analyzed: boolean;
      brandMentioned: boolean | null;
      recommended: boolean | null;
      mentionPosition: number | null;
      citationCount: number | null;
    }>;
    competitor: null | {
      status: string;
      competitors: Array<{
        canonicalName: string;
        competitorType: string;
        mentionCount: number;
        evidenceCount: number;
        shareOfVoice: number | null;
      }>;
      note: string;
    };
  };
};

const formatPct = (val: number | null | undefined) =>
  val == null ? "—" : `${(val * 100).toFixed(1)}%`;

export default function PublicShareReportPage() {
  const params = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
    fetch(`${apiBase}/public/reports/${encodeURIComponent(params.id)}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("报告不存在或分享链接已失效");
        }
        return res.json();
      })
      .then((data) => {
        setReport(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "加载报告失败");
        setLoading(false);
      });
  }, [params.id]);

  function copyShareLink() {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-400 text-sm">正在加载 GEO 全景诊断数据…</p>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 text-slate-200 rounded-2xl p-8 max-w-md text-center border border-slate-700 space-y-4">
          <div className="w-12 h-12 bg-red-950 text-red-400 rounded-full flex items-center justify-center mx-auto text-xl font-bold">
            !
          </div>
          <h2 className="text-lg font-semibold">报告不可用</h2>
          <p className="text-sm text-slate-400">{error || "未找到对应的诊断报告。"}</p>
          <Link
            href="/"
            className="inline-block mt-4 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition"
          >
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  const overall = report.metricsSnapshot.overall;
  const visibilityRate = overall.visibilityRate ?? 0;
  const recommendationRate = overall.recommendationRate ?? 0;
  const avgPos = overall.averageMentionPosition;
  const competitors = report.metricsSnapshot.competitor?.competitors ?? [];

  // 计算综合健康指数 (0-100)
  const healthScore = Math.min(
    100,
    Math.max(
      0,
      Math.round(
        visibilityRate * 50 +
          recommendationRate * 30 +
          (avgPos && avgPos > 0 ? Math.max(0, 1 - (avgPos - 1) / 5) * 20 : 0)
      )
    )
  );

  const getGrade = (score: number) => {
    if (score >= 80) return { label: "行业领跑", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" };
    if (score >= 55) return { label: "良好受荐", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30" };
    if (score >= 35) return { label: "有待提升", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30" };
    return { label: "严重截流", color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/30" };
  };

  const grade = getGrade(healthScore);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased font-sans selection:bg-indigo-500 selection:text-white">
      {/* 顶部微渐变装饰背景 */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/20 via-slate-950 to-slate-950" />

      <main className="relative max-w-xl mx-auto px-4 py-6 pb-20 sm:pb-10 space-y-6">
        {/* 顶部导航与品牌标识 */}
        <header className="flex items-center justify-between pb-3 border-b border-slate-800/80">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20">
              G
            </div>
            <div>
              <span className="font-bold tracking-tight text-white text-base">GeoLens</span>
              <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                PRO 诊断
              </span>
            </div>
          </div>
          <button
            onClick={copyShareLink}
            className="flex items-center space-x-1.5 text-xs px-3 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition active:scale-95"
          >
            <span>{copied ? "已复制链接" : "分享报告"}</span>
          </button>
        </header>

        {/* 报告主标题卡片 */}
        <section className="bg-gradient-to-b from-slate-900 to-slate-900/80 rounded-2xl p-6 border border-slate-800 shadow-xl space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs uppercase tracking-wider text-slate-400 font-medium">
                AI 搜索可见度全景诊断
              </span>
              <h1 className="text-2xl font-bold mt-1 text-white tracking-tight">
                {report.suiteName}
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                生成时间：{new Date(report.generatedAt).toLocaleDateString()} · 评估引擎：{report.engineName}
              </p>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-semibold border ${grade.bg} ${grade.color} ${grade.border}`}>
              {grade.label}
            </div>
          </div>

          {/* 综合健康得分大卡片 */}
          <div className="bg-slate-950/60 rounded-xl p-5 border border-slate-800/60 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-400 mb-1">AI 可见度综合得分</div>
              <div className="flex items-baseline space-x-2">
                <span className="text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-slate-400">
                  {healthScore}
                </span>
                <span className="text-xs text-slate-500">/ 100 分</span>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                测试问题覆盖：{report.completion.analyzedRuns} 组有效意图提问
              </p>
            </div>

            {/* 评分圆环 */}
            <div className="relative w-20 h-20 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                <path
                  className="text-slate-800"
                  strokeWidth="3.5"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className="text-indigo-500 transition-all duration-1000 ease-out"
                  strokeDasharray={`${healthScore}, 100`}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <div className="absolute text-xs font-bold text-slate-300">
                {healthScore}%
              </div>
            </div>
          </div>

          {/* 主流大模型评测阵列 */}
          <div className="pt-2">
            <div className="text-[11px] font-medium text-slate-400 mb-2">主流 AI 模型基准评估矩阵</div>
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              {[
                { name: "DeepSeek", tag: "深度求索", active: report.provider === "deepseek" },
                { name: "豆包", tag: "字节跳动", active: report.provider === "doubao" },
                { name: "通义千问", tag: "阿里云", active: report.provider === "qwen" },
                { name: "Kimi", tag: "月之暗面", active: report.provider === "kimi" },
                { name: "元宝", tag: "腾讯混元", active: report.provider === "yuanbao" },
                { name: "文心一言", tag: "百度智能", active: report.provider === "baidu" },
                { name: "智谱清言", tag: "智谱AI", active: report.provider === "zhipu" },
                { name: "纳米AI", tag: "360智脑", active: false },
              ].map((m) => (
                <div
                  key={m.name}
                  className={`p-2 rounded-lg border text-[11px] ${
                    m.active
                      ? "bg-indigo-600/20 border-indigo-500 text-indigo-200 font-semibold shadow-sm"
                      : "bg-slate-950/40 border-slate-800 text-slate-400"
                  }`}
                >
                  <div className="truncate font-medium">{m.name}</div>
                  <div className="text-[9px] text-slate-500 scale-90 truncate">{m.tag}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 核心五大指标网格 */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-300 px-1">核心 GEO 科学量化指标</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-900/90 rounded-xl p-4 border border-slate-800 shadow-sm">
              <div className="text-xs text-slate-400">AI 自然可见度</div>
              <div className="text-2xl font-bold mt-1 text-white">{formatPct(visibilityRate)}</div>
              <div className="text-[11px] text-slate-500 mt-1">品牌在有效发现问题中的出现比例</div>
            </div>

            <div className="bg-slate-900/90 rounded-xl p-4 border border-slate-800 shadow-sm">
              <div className="text-xs text-slate-400">强推荐率 (Recommend)</div>
              <div className="text-2xl font-bold mt-1 text-white">{formatPct(recommendationRate)}</div>
              <div className="text-[11px] text-slate-500 mt-1">被 AI 首选或着重推荐的频次占比</div>
            </div>

            <div className="bg-slate-900/90 rounded-xl p-4 border border-slate-800 shadow-sm">
              <div className="text-xs text-slate-400">平均推荐位次</div>
              <div className="text-2xl font-bold mt-1 text-white">
                {avgPos ? `第 ${avgPos.toFixed(1)} 位` : "未入围"}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">AI 推荐列表中的名次排位</div>
            </div>

            <div className="bg-slate-900/90 rounded-xl p-4 border border-slate-800 shadow-sm">
              <div className="text-xs text-slate-400">权威引用源 (Citations)</div>
              <div className="text-2xl font-bold mt-1 text-white">{overall.citationCount} 条</div>
              <div className="text-[11px] text-slate-500 mt-1">
                覆盖 {overall.citationDomainCount} 个权威第三方独立域名
              </div>
            </div>
          </div>
        </section>

        {/* 竞品声量与同屏对抗态势 */}
        {competitors.length > 0 && (
          <section className="bg-slate-900/90 rounded-2xl p-5 border border-slate-800 space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">竞品声量份额对抗 (SoV)</h2>
                <p className="text-xs text-slate-400 mt-0.5">同赛道在 AI 回答中的被推荐截流比例</p>
              </div>
              <span className="text-xs text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                竞品态势
              </span>
            </div>

            <div className="space-y-3 pt-1">
              {competitors.map((comp) => {
                const sov = (comp.shareOfVoice ?? 0) * 100;
                return (
                  <div key={comp.canonicalName} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-slate-200">{comp.canonicalName}</span>
                      <span className="text-slate-400">
                        {comp.mentionCount} 次提及 · {sov.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                      <div
                        className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(5, sov))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 重点测试问题与命中详情 */}
        <section className="bg-slate-900/90 rounded-2xl p-5 border border-slate-800 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">自然发现问题评测样本 (Top Queries)</h2>
            <span className="text-xs text-slate-500">
              共 {report.metricsSnapshot.byQuery.length} 个问题
            </span>
          </div>

          <div className="space-y-2.5">
            {report.metricsSnapshot.byQuery.slice(0, 5).map((q, idx) => (
              <div
                key={idx}
                className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80 text-xs space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-slate-200 leading-snug">
                    {q.queryText}
                  </span>
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold ${
                      q.recommended
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                        : q.brandMentioned
                        ? "bg-blue-500/10 text-blue-400 border border-blue-500/30"
                        : "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                    }`}
                  >
                    {q.recommended ? "首选推荐" : q.brandMentioned ? "提及品牌" : "未提及"}
                  </span>
                </div>
                <div className="flex items-center space-x-3 text-[11px] text-slate-500">
                  <span>分类：{q.category || "自然选型"}</span>
                  {q.mentionPosition && <span>位次：第 {q.mentionPosition} 位</span>}
                  {q.citationCount ? <span>引用源：{q.citationCount} 个</span> : null}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* GEO 落地优化 SOP 建议看板 */}
        <section className="bg-gradient-to-b from-indigo-950/40 to-slate-900 rounded-2xl p-5 border border-indigo-500/20 space-y-4 shadow-sm">
          <div className="flex items-center space-x-2">
            <span className="text-lg">💡</span>
            <h2 className="text-sm font-semibold text-indigo-200">
              专家级 GEO 优化落地闭环建议 (SOP)
            </h2>
          </div>

          <div className="space-y-3 text-xs text-slate-300">
            <div className="p-3 bg-slate-950/60 rounded-xl border border-indigo-500/20">
              <div className="font-semibold text-indigo-300 mb-1">
                1. 官方网站权威语义加固 (Answer-First 改造)
              </div>
              <p className="text-slate-400 leading-relaxed">
                在企业官网核心落地页前 100 字内直接给出高意图问题的明确答案，嵌入 Schema 结构化
                FAQ 数据，便于 DeepSeek 与豆包蜘蛛高权重采纳。
              </p>
            </div>

            <div className="p-3 bg-slate-950/60 rounded-xl border border-indigo-500/20">
              <div className="font-semibold text-indigo-300 mb-1">
                2. 权威第三方媒体与行业背书矩阵发稿
              </div>
              <p className="text-slate-400 leading-relaxed">
                针对未提及或被竞品截流的问题，在百度百家号、知乎深度评测专栏、36氪/钛媒体等高权重引用源定向铺设客观中立的横评内容。
              </p>
            </div>

            <div className="p-3 bg-slate-950/60 rounded-xl border border-indigo-500/20">
              <div className="font-semibold text-indigo-300 mb-1">
                3. 闭环效果复测与归因对账
              </div>
              <p className="text-slate-400 leading-relaxed">
                内容分发 7-14 天后启动周期性复测实验，精准追踪品牌在 AI
                回答中的首次被引位次与 SoV 增量变化。
              </p>
            </div>
          </div>
        </section>

        {/* 底部业务转化与咨询行动栏 */}
        <footer className="text-center pt-2 pb-6 space-y-3">
          <div className="bg-slate-900 rounded-2xl p-5 border border-slate-800 space-y-3">
            <h3 className="font-semibold text-white text-sm">
              想要提升品牌在主流 AI 大模型中的搜索排名与推荐度？
            </h3>
            <p className="text-xs text-slate-400">
              联系我们的企业专属 GEO 增长专家，获取完整竞品截流深度拆解与定制优化方案。
            </p>
            <div className="pt-1 flex gap-2 justify-center">
              <button
                onClick={copyShareLink}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition"
              >
                {copied ? "已复制链接" : "复制报告链接"}
              </button>
              <Link
                href="/login"
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold shadow-lg shadow-indigo-500/20 transition"
              >
                进入 GeoLens 运营工作台
              </Link>
            </div>
          </div>

          <p className="text-[11px] text-slate-600">
            Powered by GeoLens · 企业级生成式引擎优化（GEO）智能监测与闭环归因平台
          </p>
        </footer>
      </main>

      {/* 移动端底部轻量浮动操作条 (仅在手机端视口显示) */}
      <div className="sm:hidden fixed bottom-0 inset-x-0 bg-slate-900/90 backdrop-blur-md border-t border-slate-800 p-3 flex items-center gap-2 z-50">
        <button
          onClick={copyShareLink}
          className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition active:scale-98"
        >
          {copied ? "✓ 已复制公开链接" : "复制分享链接"}
        </button>
        <Link
          href="/login"
          className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold text-center shadow-lg shadow-indigo-500/20 transition active:scale-98"
        >
          进入运营工作台
        </Link>
      </div>
    </div>
  );
}
