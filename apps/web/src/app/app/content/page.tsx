"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, Suspense } from "react";
import { useProjectContext } from "@/components/project-context";
import { EmptyState, LoadingSkeleton, StatusBadge, PageHeader } from "@/components/ui";
import { friendlyError } from "@/lib/labels";
import {
  listContentDrafts,
  listPublications,
  listContentStrategies,
  type Draft,
  type DraftStatus,
  type PublicationListItem,
  type PublicationStatus,
  type ContentStrategy,
} from "@/lib/content-api";
import { api } from "@/lib/api";
import { confirmManualPublished } from "@/lib/distribution-api";

type PublishedAsset = {
  id: string;
  projectId: string;
  platform: string;
  canonicalUrl: string | null;
  externalAssetId: string | null;
  actualPublishedAt: string | null;
  verificationStatus: string;
  createdAt: string;
  draft?: { id: string; title: string };
  publication?: { id: string; channel: string; status: string };
};

const CHANNEL_LABELS: Record<string, { label: string; badge: string }> = {
  ZHIHU: { label: "知乎", badge: "bg-sky-100 text-sky-800 border-sky-300" },
  XIAOHONGSHU: { label: "小红书", badge: "bg-rose-100 text-rose-800 border-rose-300" },
  WECHAT_OFFICIAL_ACCOUNT: { label: "微信公众号", badge: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  WECHAT: { label: "微信公众号", badge: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  BILIBILI: { label: "哔哩哔哩", badge: "bg-pink-100 text-pink-800 border-pink-300" },
  DOUYIN: { label: "抖音", badge: "bg-slate-800 text-white border-slate-700" },
  WEIBO: { label: "微博", badge: "bg-amber-100 text-amber-800 border-amber-300" },
  WORDPRESS: { label: "WordPress", badge: "bg-blue-100 text-blue-800 border-blue-300" },
};

function ContentManagementInner() {
  const router = useRouter();
  const { projectId: contextProjectId, project } = useProjectContext();
  const searchParams = useSearchParams();
  const queryProjectId = searchParams.get("project") || "";
  const projectId = queryProjectId || contextProjectId;

  // 4 个主要视图 Tab: drafts (待发布内容/草稿), schemes (诊断生成方案), publications (进行中的发布任务), assets (已发布资产)
  const tabParam = searchParams.get("tab") as "drafts" | "schemes" | "publications" | "assets" | null;
  const [activeTab, setActiveTab] = useState<"drafts" | "schemes" | "publications" | "assets">(
    tabParam && ["drafts", "schemes", "publications", "assets"].includes(tabParam) ? tabParam : "drafts",
  );

  // 数据列表状态
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [strategies, setStrategies] = useState<ContentStrategy[]>([]);
  const [publications, setPublications] = useState<PublicationListItem[]>([]);
  const [publishedAssets, setPublishedAssets] = useState<PublishedAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // 筛选过滤
  const [draftStatusFilter, setDraftStatusFilter] = useState<DraftStatus | "">("");
  const [draftSearch, setDraftSearch] = useState("");
  const [pubStatusFilter, setPubStatusFilter] = useState<PublicationStatus | "">("");
  const [assetStatusFilter, setAssetStatusFilter] = useState<string>("");

  // 人工发布回填 Modal
  const [backfillModalPub, setBackfillModalPub] = useState<PublicationListItem | null>(null);
  const [backfillUrl, setBackfillUrl] = useState("");
  const [backfillAssetId, setBackfillAssetId] = useState("");
  const [backfillNote, setBackfillNote] = useState("");
  const [backfilling, setBackfilling] = useState(false);
  const [backfillError, setBackfillError] = useState<string | null>(null);

  // 加载项目全部内容管理资产
  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    setError("");
    Promise.all([
      listContentDrafts(projectId).catch(() => [] as Draft[]),
      listContentStrategies(projectId)
        .then((res) => (Array.isArray(res) ? res : res.strategies || []))
        .catch(() => [] as ContentStrategy[]),
      listPublications(projectId, { pageSize: 100 }).catch(() => ({ items: [] as PublicationListItem[], total: 0 })),
      api<{ items: PublishedAsset[] }>(`/projects/${encodeURIComponent(projectId)}/published-assets`).catch(
        () => ({ items: [] as PublishedAsset[] }),
      ),
    ])
      .then(([draftRows, stratRows, pubPage, assetRes]) => {
        setDrafts(draftRows);
        setStrategies(stratRows);
        setPublications(pubPage.items);
        setPublishedAssets(assetRes.items || []);
      })
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setLoading(false));
  }, [projectId]);

  // 过滤后的草稿
  const filteredDrafts = useMemo(() => {
    return drafts.filter((d) => {
      const matchStatus = !draftStatusFilter || d.status === draftStatusFilter;
      const q = draftSearch.trim().toLowerCase();
      const matchSearch = !q || d.title.toLowerCase().includes(q) || (d.topic || "").toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [drafts, draftStatusFilter, draftSearch]);

  // 过滤后的发布任务
  const filteredPubs = useMemo(() => {
    return publications.filter((p) => {
      return !pubStatusFilter || p.status === pubStatusFilter;
    });
  }, [publications, pubStatusFilter]);

  // 过滤后的已发布资产
  const filteredAssets = useMemo(() => {
    return publishedAssets.filter((a) => {
      return !assetStatusFilter || a.verificationStatus === assetStatusFilter;
    });
  }, [publishedAssets, assetStatusFilter]);

  // 提交人工回填
  async function handleConfirmBackfill() {
    if (!backfillModalPub) return;
    if (!backfillUrl.trim() && !backfillAssetId.trim()) {
      setBackfillError("请至少填写真实公开链接或平台内容 ID！");
      return;
    }
    setBackfilling(true);
    setBackfillError(null);
    try {
      await confirmManualPublished(backfillModalPub.id, {
        canonicalUrl: backfillUrl.trim() || undefined,
        externalAssetId: backfillAssetId.trim() || undefined,
        verificationNote: backfillNote.trim() || undefined,
      });
      setNotice("已成功确认人工发布！资产已记录并直接接入 GEO 效果闭环。");
      setBackfillModalPub(null);
      setBackfillUrl("");
      setBackfillAssetId("");
      setBackfillNote("");

      // 刷新列表
      if (projectId) {
        const [pubPage, assetRes] = await Promise.all([
          listPublications(projectId, { pageSize: 100 }),
          api<{ items: PublishedAsset[] }>(`/projects/${encodeURIComponent(projectId)}/published-assets`),
        ]);
        setPublications(pubPage.items);
        setPublishedAssets(assetRes.items || []);
      }
    } catch (err: any) {
      setBackfillError(err.message || "确认回填失败");
    } finally {
      setBackfilling(false);
    }
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title="内容管理"
        description={`全周期管控诊断内容方案、待发布草稿、多平台发布任务与已沉淀资产。当前项目：${project?.name ?? "未指定"}`}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/app/content/new?project=${encodeURIComponent(projectId)}`}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition shadow-sm"
            >
              + 手工新建草稿
            </Link>
            <Link
              href={`/app/content/distribution?project=${encodeURIComponent(projectId)}`}
              className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 transition shadow-sm flex items-center gap-1.5"
            >
              <span>前往内容发布 →</span>
            </Link>
          </div>
        }
      />

      {error && (
        <div role="alert" className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-xs text-rose-800">
          {error}
        </div>
      )}

      {notice && (
        <div role="status" className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs text-emerald-800 flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} className="text-emerald-600 hover:text-emerald-800 font-bold">×</button>
        </div>
      )}

      {/* 4 个核心职责 Tab 导航 */}
      <div className="flex border-b border-slate-200 gap-1 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab("drafts")}
          className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeTab === "drafts"
              ? "border-blue-600 text-blue-600 bg-blue-50/40"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <span>📝 待发布内容（草稿）</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
            {drafts.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("schemes")}
          className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeTab === "schemes"
              ? "border-blue-600 text-blue-600 bg-blue-50/40"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <span>✨ 诊断生成方案</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
            {strategies.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("publications")}
          className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeTab === "publications"
              ? "border-blue-600 text-blue-600 bg-blue-50/40"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <span>🚀 进行中的发布任务</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
            {publications.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("assets")}
          className={`flex items-center gap-2 py-3 px-4 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
            activeTab === "assets"
              ? "border-blue-600 text-blue-600 bg-blue-50/40"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <span>🏛️ 已发布资产沉淀</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
            {publishedAssets.length}
          </span>
        </button>
      </div>

      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : (
        <>
          {/* TAB 1: 待发布内容（草稿） */}
          {activeTab === "drafts" && (
            <div className="surface p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={draftSearch}
                    onChange={(e) => setDraftSearch(e.target.value)}
                    placeholder="搜索标题或主题…"
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs w-56 focus:outline-none focus:ring-1 focus:ring-blue-600"
                  />
                  <select
                    value={draftStatusFilter}
                    onChange={(e) => setDraftStatusFilter(e.target.value as any)}
                    className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700"
                  >
                    <option value="">全部状态</option>
                    <option value="DRAFT">草稿</option>
                    <option value="READY_FOR_REVIEW">待审核</option>
                    <option value="APPROVED">已批准</option>
                    <option value="PUBLISHED">已发布</option>
                    <option value="ARCHIVED">已归档</option>
                  </select>
                </div>

                <Link
                  href={`/app/content/new?project=${encodeURIComponent(projectId)}`}
                  className="text-xs font-semibold text-blue-700 hover:underline"
                >
                  + 新建草稿
                </Link>
              </div>

              {filteredDrafts.length === 0 ? (
                <EmptyState
                  title="暂无待发布草稿"
                  description="您可以直接新建草稿，或通过「GEO 诊断」根据发现的搜索差距一键生成针对性方案。"
                  href={`/app/content/distribution?project=${encodeURIComponent(projectId)}`}
                  action="前往内容发布"
                />
              ) : (
                <div className="table-scroll overflow-x-auto">
                  <table className="data-table w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="p-3">标题与主题</th>
                        <th className="p-3">来源归因</th>
                        <th className="p-3">生产方式</th>
                        <th className="p-3">状态</th>
                        <th className="p-3">创建时间</th>
                        <th className="p-3 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDrafts.map((d) => (
                        <tr key={d.id} className="border-b border-slate-100 hover:bg-slate-50/60 transition">
                          <td className="p-3 max-w-xs">
                            <div className="font-semibold text-slate-900 truncate" title={d.title}>
                              {d.title}
                            </div>
                            {d.topic && (
                              <div className="text-[11px] text-slate-500 truncate mt-0.5">
                                对应搜索提问：{d.topic}
                              </div>
                            )}
                          </td>
                          <td className="p-3">
                            {d.sourceDiagnosisId ? (
                              <Link
                                href={`/app/diagnosis/${d.sourceDiagnosisId}`}
                                className="inline-flex items-center gap-1 rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 border border-indigo-200 hover:underline"
                              >
                                🎯 来自 GEO 诊断
                              </Link>
                            ) : d.sourceRecommendationId ? (
                              <span className="rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 border border-amber-200">
                                💡 来自优化建议
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[11px]">手动创建</span>
                            )}
                          </td>
                          <td className="p-3">
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                              {d.generationMode === "AI_GENERATED"
                                ? "AI 智能生成"
                                : d.generationMode === "AI_ASSISTED"
                                ? "AI 辅助"
                                : "手工撰写"}
                            </span>
                          </td>
                          <td className="p-3">
                            <StatusBadge status={d.status} />
                          </td>
                          <td className="p-3 text-slate-400 text-[11px]">
                            {new Date(d.createdAt).toLocaleDateString("zh-CN")}
                          </td>
                          <td className="p-3 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-2">
                              <Link
                                href={`/app/content/${d.id}`}
                                className="text-xs text-slate-600 hover:text-slate-900 font-medium"
                              >
                                编辑
                              </Link>
                              <Link
                                href={`/app/content/distribution?project=${encodeURIComponent(projectId)}&draftId=${d.id}`}
                                className="rounded-lg bg-blue-700 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-800 shadow-sm"
                              >
                                前往发布 →
                              </Link>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: 诊断生成方案 */}
          {activeTab === "schemes" && (
            <div className="surface p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">GEO 诊断转化与内容策略方案</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    基于各轮诊断发现的品牌缺位、竞品截流与权威信源缺失点生成的针对性内容方案。
                  </p>
                </div>
                <Link
                  href={`/app/diagnosis?project=${encodeURIComponent(projectId)}`}
                  className="text-xs font-semibold text-blue-700 hover:underline"
                >
                  查看全部诊断发现 →
                </Link>
              </div>

              {strategies.length === 0 ? (
                <EmptyState
                  title="暂无诊断生成方案"
                  description="在「GEO 诊断」详情页点击「✨ 根据诊断生成内容方案」，系统将提取低可见问题并自动规划多平台发布方案。"
                  href={`/app/diagnosis?project=${encodeURIComponent(projectId)}`}
                  action="前往 GEO 诊断"
                />
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {strategies.map((strat) => (
                    <div
                      key={strat.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 transition flex flex-col justify-between"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="rounded bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                            诊断转化策略
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {new Date(strat.createdAt).toLocaleDateString("zh-CN")}
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-slate-900">{strat.title}</h4>
                        <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                          目标：{strat.perceptionGoal || (strat as any).objective || "提升品牌权威与事实收录"}
                        </p>
                        {strat.priorityQuestions && strat.priorityQuestions.length > 0 && (
                          <div className="text-[11px] text-slate-500">
                            <span className="font-semibold text-slate-700">重点问题：</span>
                            {strat.priorityQuestions.slice(0, 2).map((q) => (typeof q === "string" ? q : q.question)).join(" · ")}
                          </div>
                        )}
                      </div>

                      <div className="pt-3 border-t border-slate-100 mt-3 flex items-center justify-between">
                        <span className="text-[11px] text-slate-400">
                          {strat.platformPriorities?.length || (strat as any).contentDirections?.length || 0} 个渠道规划
                        </span>
                        <Link
                          href={`/app/content/distribution?project=${encodeURIComponent(projectId)}&strategyId=${strat.id}`}
                          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 shadow-sm"
                        >
                          一键带入发布 →
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: 进行中的发布任务 */}
          {activeTab === "publications" && (
            <div className="surface p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <select
                    value={pubStatusFilter}
                    onChange={(e) => setPubStatusFilter(e.target.value as any)}
                    className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700"
                  >
                    <option value="">全部发布状态</option>
                    <option value="PENDING">等待中</option>
                    <option value="QUEUED">排队中</option>
                    <option value="PUBLISHING">发布中</option>
                    <option value="PUBLISHED">已发布</option>
                    <option value="FAILED">失败</option>
                  </select>
                </div>
                <Link
                  href={`/app/content/distribution?project=${encodeURIComponent(projectId)}`}
                  className="text-xs font-semibold text-blue-700 hover:underline"
                >
                  前往发布工作台 →
                </Link>
              </div>

              {filteredPubs.length === 0 ? (
                <EmptyState
                  title="暂无发布任务"
                  description="在发布工作台中选择草稿与平台后发起分发，任务状态将在此集中追踪。"
                  href={`/app/content/distribution?project=${encodeURIComponent(projectId)}`}
                  action="前往发起发布"
                />
              ) : (
                <div className="table-scroll overflow-x-auto">
                  <table className="data-table w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="p-3">发布平台</th>
                        <th className="p-3">对应内容</th>
                        <th className="p-3">执行方式</th>
                        <th className="p-3">状态</th>
                        <th className="p-3">创建时间</th>
                        <th className="p-3 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPubs.map((pub) => {
                        const ch = CHANNEL_LABELS[pub.channel] || { label: pub.channel, badge: "bg-slate-100 text-slate-700" };
                        return (
                          <tr key={pub.id} className="border-b border-slate-100 hover:bg-slate-50/60 transition">
                            <td className="p-3">
                              <span className={`inline-block rounded border px-2 py-0.5 text-[11px] font-semibold ${ch.badge}`}>
                                {ch.label}
                              </span>
                            </td>
                            <td className="p-3 max-w-xs">
                              <div className="font-semibold text-slate-900 truncate">
                                草稿 ID: {pub.draftId.slice(0, 8)}…
                              </div>
                              {pub.externalUrl && (
                                <a
                                  href={pub.externalUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[11px] text-blue-700 hover:underline truncate block"
                                >
                                  {pub.externalUrl} ↗
                                </a>
                              )}
                            </td>
                            <td className="p-3">
                              <span className="text-slate-600 font-mono text-[11px]">
                                {pub.publisher === "selenium_assistant"
                                  ? "本地受控浏览器 (Selenium)"
                                  : pub.isMock
                                  ? "仿真测试"
                                  : "人工发布"}
                              </span>
                            </td>
                            <td className="p-3">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                  pub.status === "PUBLISHED"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : pub.status === "FAILED"
                                    ? "bg-rose-100 text-rose-800"
                                    : pub.status === "PUBLISHING"
                                    ? "bg-sky-100 text-sky-800"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {pub.status}
                              </span>
                            </td>
                            <td className="p-3 text-slate-400 text-[11px]">
                              {new Date(pub.createdAt).toLocaleString("zh-CN")}
                            </td>
                            <td className="p-3 text-right whitespace-nowrap">
                              {pub.status !== "PUBLISHED" ? (
                                <button
                                  type="button"
                                  onClick={() => setBackfillModalPub(pub)}
                                  className="rounded bg-slate-900 px-2.5 py-1 text-xs text-white hover:bg-slate-800 font-medium"
                                >
                                  回填发布链接
                                </button>
                              ) : (
                                <span className="text-emerald-700 font-semibold text-xs">✓ 已落成资产</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: 已发布资产沉淀 */}
          {activeTab === "assets" && (
            <div className="surface p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <select
                    value={assetStatusFilter}
                    onChange={(e) => setAssetStatusFilter(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700"
                  >
                    <option value="">全部核验状态</option>
                    <option value="VERIFIED">已核验通过</option>
                    <option value="PENDING">待核验</option>
                    <option value="FAILED">核验异常</option>
                  </select>
                </div>

                <Link
                  href={`/app/content/verification?project=${encodeURIComponent(projectId)}`}
                  className="rounded-lg bg-teal-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 shadow-sm"
                >
                  前往 GEO 效果复测与归因 →
                </Link>
              </div>

              {filteredAssets.length === 0 ? (
                <EmptyState
                  title="暂无已发布资产"
                  description="在多平台完成内容发布并回填公开链接后，资产将沉淀在此并自动关联到复测实验池。"
                  href={`/app/content/distribution?project=${encodeURIComponent(projectId)}`}
                  action="前往发布内容"
                />
              ) : (
                <div className="table-scroll overflow-x-auto">
                  <table className="data-table w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="p-3">平台渠道</th>
                        <th className="p-3">公开落地链接 (URL)</th>
                        <th className="p-3">核验状态</th>
                        <th className="p-3">发布时间</th>
                        <th className="p-3 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAssets.map((asset) => {
                        const ch = CHANNEL_LABELS[asset.platform] || { label: asset.platform, badge: "bg-slate-100 text-slate-700" };
                        return (
                          <tr key={asset.id} className="border-b border-slate-100 hover:bg-slate-50/60 transition">
                            <td className="p-3">
                              <span className={`inline-block rounded border px-2 py-0.5 text-[11px] font-semibold ${ch.badge}`}>
                                {ch.label}
                              </span>
                            </td>
                            <td className="p-3 max-w-sm">
                              {asset.canonicalUrl ? (
                                <a
                                  href={asset.canonicalUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-700 font-mono text-xs hover:underline truncate block"
                                  title={asset.canonicalUrl}
                                >
                                  {asset.canonicalUrl} ↗
                                </a>
                              ) : (
                                <span className="text-slate-400 font-mono text-[11px]">ID: {asset.externalAssetId || "未提供链接"}</span>
                              )}
                            </td>
                            <td className="p-3">
                              <span
                                className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                                  asset.verificationStatus === "VERIFIED"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {asset.verificationStatus === "VERIFIED" ? "已核验可信" : "待抓取复测"}
                              </span>
                            </td>
                            <td className="p-3 text-slate-400 text-[11px]">
                              {asset.actualPublishedAt
                                ? new Date(asset.actualPublishedAt).toLocaleDateString("zh-CN")
                                : new Date(asset.createdAt).toLocaleDateString("zh-CN")}
                            </td>
                            <td className="p-3 text-right whitespace-nowrap">
                              <Link
                                href={`/app/content/verification?project=${encodeURIComponent(projectId)}`}
                                className="rounded bg-teal-600 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-700 shadow-sm"
                              >
                                效果复测 →
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* 人工发布回填 Modal */}
      {backfillModalPub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">回填公开发布落地结果</h3>
              <button
                type="button"
                onClick={() => setBackfillModalPub(null)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg"
              >
                ×
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              请填写您在目标平台完成发布后的公开链接或平台内容 ID，确认后将自动沉淀为 PublishedAsset 并接入 GEO 效果闭环。
            </p>

            {backfillError && (
              <div className="p-3 bg-rose-50 text-rose-700 rounded-lg text-xs border border-rose-200">
                {backfillError}
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  公开发布链接 (URL) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="url"
                  value={backfillUrl}
                  onChange={(e) => setBackfillUrl(e.target.value)}
                  placeholder="https://zhuanlan.zhihu.com/p/... 或对应平台落地页"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-blue-600 font-mono"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  平台内容/文章 ID (可选)
                </label>
                <input
                  type="text"
                  value={backfillAssetId}
                  onChange={(e) => setBackfillAssetId(e.target.value)}
                  placeholder="例如: 9823101"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-blue-600 font-mono"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  核验说明 (可选)
                </label>
                <textarea
                  value={backfillNote}
                  onChange={(e) => setBackfillNote(e.target.value)}
                  rows={2}
                  placeholder="如：已发布并通过平台审核，公开可访问。"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setBackfillModalPub(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={backfilling || (!backfillUrl.trim() && !backfillAssetId.trim())}
                onClick={() => void handleConfirmBackfill()}
                className="px-4 py-2 rounded-lg bg-blue-700 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50 transition"
              >
                {backfilling ? "正在回填…" : "确认并落成资产"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function ContentManagementPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-slate-400">正在加载内容管理…</div>}>
      <ContentManagementInner />
    </Suspense>
  );
}
