"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  getDistributionChannels,
  adaptContentForChannels,
  batchDistribute,
  confirmManualPublished,
  listProjectPublications,
  processPublicationRetry,
  type DistributionChannel,
  type AdaptedChannelContent,
  type PublicationListItem,
  type ManualPublishingPackage,
} from "@/lib/distribution-api";
import { listContentDrafts, type Draft } from "@/lib/content-api";
import { StatusBadge, LoadingSkeleton, EmptyState } from "@/components/ui";

const CHANNEL_PLATFORM_CONFIG: Record<
  string,
  { label: string; color: string; badgeBg: string; creatorUrl: string; icon: string }
> = {
  WECHAT_OFFICIAL_ACCOUNT: {
    label: "微信公众号",
    color: "emerald",
    badgeBg: "bg-emerald-50 text-emerald-700 border-emerald-200",
    creatorUrl: "https://mp.weixin.qq.com/",
    icon: "💬",
  },
  WORDPRESS: {
    label: "WordPress / 企业 CMS",
    color: "blue",
    badgeBg: "bg-blue-50 text-blue-700 border-blue-200",
    creatorUrl: "/wp-admin",
    icon: "🌐",
  },
  XIAOHONGSHU: {
    label: "小红书",
    color: "rose",
    badgeBg: "bg-rose-50 text-rose-700 border-rose-200",
    creatorUrl: "https://creator.xiaohongshu.com/",
    icon: "📕",
  },
  ZHIHU: {
    label: "知乎",
    color: "sky",
    badgeBg: "bg-sky-50 text-sky-700 border-sky-200",
    creatorUrl: "https://www.zhihu.com/creator",
    icon: "📖",
  },
  DOUYIN: {
    label: "抖音",
    color: "slate",
    badgeBg: "bg-slate-900 text-white border-slate-700",
    creatorUrl: "https://creator.douyin.com/",
    icon: "🎵",
  },
  WECHAT_CHANNELS: {
    label: "微信视频号",
    color: "amber",
    badgeBg: "bg-amber-50 text-amber-700 border-amber-200",
    creatorUrl: "https://channels.weixin.qq.com/",
    icon: "📹",
  },
  WEIBO: {
    label: "微博",
    color: "red",
    badgeBg: "bg-red-50 text-red-700 border-red-200",
    creatorUrl: "https://weibo.com/",
    icon: "🔴",
  },
  BILIBILI: {
    label: "哔哩哔哩",
    color: "pink",
    badgeBg: "bg-pink-50 text-pink-700 border-pink-200",
    creatorUrl: "https://member.bilibili.com/",
    icon: "📺",
  },
};

export function DistributionWorkbench({ projectId }: { projectId: string }) {
  // 渠道与草稿状态
  const [channels, setChannels] = useState<DistributionChannel[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string>("");
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // 渠道多选与模式选择：channelKey -> { selected: boolean; mode: 'AUTO' | 'MANUAL'; targetStatus?: 'draft' | 'publish' }
  const [channelSelections, setChannelSelections] = useState<
    Record<string, { selected: boolean; mode: "AUTO" | "MANUAL"; targetStatus?: "draft" | "publish" }>
  >({});

  // 渠道适配预览状态
  const [adapting, setAdapting] = useState(false);
  const [adaptedResults, setAdaptedResults] = useState<AdaptedChannelContent[]>([]);
  const [activePreviewChannel, setActivePreviewChannel] = useState<string>("");

  // 变体内容可编辑状态 (channel -> { title, body, tags })
  const [editedContent, setEditedContent] = useState<
    Record<string, { title: string; body: string; tags: string[] }>
  >({});

  // 批量分发触发中
  const [distributing, setDistributing] = useState(false);

  // 分发记录列表
  const [publications, setPublications] = useState<PublicationListItem[]>([]);
  const [loadingPubs, setLoadingPubs] = useState(false);

  // 人工发布回填 Modal
  const [confirmModalPub, setConfirmModalPub] = useState<PublicationListItem | null>(null);
  const [backfillUrl, setBackfillUrl] = useState("");
  const [backfillAssetId, setBackfillAssetId] = useState("");
  const [backfillPublishedAt, setBackfillPublishedAt] = useState(new Date().toISOString().slice(0, 16));
  const [backfillNote, setBackfillNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // 查看人工发布包详情 Modal
  const [packageModalContent, setPackageModalContent] = useState<ManualPublishingPackage | null>(null);

  // 复制反馈
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // 初始化加载
  useEffect(() => {
    if (!projectId) return;
    async function loadData() {
      setLoadingInitial(true);
      setErrorMsg(null);
      try {
        const [chList, drList] = await Promise.all([
          getDistributionChannels(projectId),
          listContentDrafts(projectId),
        ]);
        setChannels(chList);
        setDrafts(drList);

        // 默认初始化渠道选择字典
        const initialSel: Record<string, { selected: boolean; mode: "AUTO" | "MANUAL"; targetStatus?: "draft" | "publish" }> = {};
        for (const ch of chList) {
          initialSel[ch.channel] = {
            selected: ["XIAOHONGSHU", "WECHAT_OFFICIAL_ACCOUNT", "ZHIHU", "WORDPRESS"].includes(ch.channel),
            mode: ch.supportsAuto ? "AUTO" : "MANUAL",
            targetStatus: ch.autoCapability === "DRAFT_ONLY" ? "draft" : "publish",
          };
        }
        setChannelSelections(initialSel);

        // 优先选中 APPROVED 的草稿，若无则选第一个
        const approved = drList.find((d) => d.status === "APPROVED");
        const defaultDraft = approved || drList[0];
        if (defaultDraft) {
          setSelectedDraftId(defaultDraft.id);
        }

        // 加载现有分发列表
        loadPublications();
      } catch (err: any) {
        setErrorMsg(err.message || "加载多平台分发中心数据失败");
      } finally {
        setLoadingInitial(false);
      }
    }
    loadData();
  }, [projectId]);

  async function loadPublications() {
    setLoadingPubs(true);
    try {
      const res = await listProjectPublications(projectId, { limit: 50 });
      setPublications(res.items);
    } catch {
      // ignore
    } finally {
      setLoadingPubs(false);
    }
  }

  // 当前选中草稿
  const currentDraft = useMemo(() => {
    return drafts.find((d) => d.id === selectedDraftId) || null;
  }, [drafts, selectedDraftId]);

  // 选中的渠道列表
  const selectedChannelsList = useMemo(() => {
    return Object.entries(channelSelections)
      .filter(([_, sel]) => sel.selected)
      .map(([ch]) => ch);
  }, [channelSelections]);

  // 当草稿改变或点击重新适配时，自动拉取渠道变体与人工发布包
  async function handleAdaptPreview() {
    if (!selectedDraftId || !projectId || selectedChannelsList.length === 0) return;
    setAdapting(true);
    setErrorMsg(null);
    try {
      const res = await adaptContentForChannels(projectId, selectedDraftId, {
        channels: selectedChannelsList,
      });
      setAdaptedResults(res.channels);
      if (res.channels.length > 0 && (!activePreviewChannel || !selectedChannelsList.includes(activePreviewChannel))) {
        setActivePreviewChannel(res.channels[0].channel);
      }

      // 初始化编辑字段
      const edits: Record<string, { title: string; body: string; tags: string[] }> = {};
      for (const item of res.channels) {
        edits[item.channel] = {
          title: item.title,
          body: item.body,
          tags: item.tags || [],
        };
      }
      setEditedContent(edits);
    } catch (err: any) {
      setErrorMsg(err.message || "渠道内容适配失败");
    } finally {
      setAdapting(false);
    }
  }

  // 草稿切换时自动触发展开预览
  useEffect(() => {
    if (selectedDraftId && selectedChannelsList.length > 0) {
      handleAdaptPreview();
    }
  }, [selectedDraftId]);

  // 切换渠道勾选
  function toggleChannel(channelKey: string) {
    setChannelSelections((prev) => {
      const curr = prev[channelKey] || { selected: false, mode: "MANUAL" };
      return {
        ...prev,
        [channelKey]: { ...curr, selected: !curr.selected },
      };
    });
  }

  // 切换单渠道模式 (AUTO / MANUAL)
  function setChannelMode(channelKey: string, mode: "AUTO" | "MANUAL") {
    setChannelSelections((prev) => {
      const curr = prev[channelKey] || { selected: true, mode: "MANUAL" };
      return {
        ...prev,
        [channelKey]: { ...curr, mode },
      };
    });
  }

  // 复制文本辅助
  function copyText(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopyFeedback(`${label} 已复制`);
    setTimeout(() => setCopyFeedback(null), 2500);
  }

  // 下载人工发布包 (JSON)
  function downloadManualPackage(pkg: ManualPublishingPackage) {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(pkg, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `geolens_${pkg.channel.toLowerCase()}_manual_package.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setCopyFeedback("发布包已下载");
    setTimeout(() => setCopyFeedback(null), 2500);
  }

  // 触发一键批量分发
  async function handleBatchDistribute() {
    if (!selectedDraftId || selectedChannelsList.length === 0) return;
    setDistributing(true);
    setErrorMsg(null);
    setActionSuccess(null);
    try {
      const itemsToSubmit = selectedChannelsList.map((ch) => {
        const sel = channelSelections[ch];
        const edit = editedContent[ch];
        return {
          channel: ch,
          mode: sel.mode,
          title: edit?.title,
          body: edit?.body,
          tags: edit?.tags,
          targetStatus: sel.targetStatus || "draft",
        };
      });

      const res = await batchDistribute(projectId, selectedDraftId, {
        items: itemsToSubmit,
        autoApprove: true,
      });

      setActionSuccess(`已成功触发 ${res.items.length} 个渠道的分发任务！`);
      await loadPublications();
    } catch (err: any) {
      setErrorMsg(err.message || "批量分发失败");
    } finally {
      setDistributing(false);
    }
  }

  // 重试自动发布任务
  async function handleRetry(pubId: string) {
    setErrorMsg(null);
    try {
      await processPublicationRetry(pubId);
      setActionSuccess("已触发重试执行");
      await loadPublications();
    } catch (err: any) {
      setErrorMsg(err.message || "重试失败");
    }
  }

  // 提交人工发布回填确认
  async function handleSubmitBackfill() {
    if (!confirmModalPub) return;
    if (!backfillUrl && !backfillAssetId) {
      setConfirmError("请至少填写真实公开链接或平台内容 ID！");
      return;
    }
    setConfirming(true);
    setConfirmError(null);
    try {
      await confirmManualPublished(confirmModalPub.id, {
        canonicalUrl: backfillUrl.trim() || undefined,
        externalAssetId: backfillAssetId.trim() || undefined,
        actualPublishedAt: backfillPublishedAt ? new Date(backfillPublishedAt).toISOString() : new Date().toISOString(),
        verificationNote: backfillNote.trim() || undefined,
      });
      setConfirmModalPub(null);
      setBackfillUrl("");
      setBackfillAssetId("");
      setBackfillNote("");
      setActionSuccess("已成功确认人工发布！该内容已直接落成 PublishedAsset，并进入 GEO 效果闭环。");
      await loadPublications();
    } catch (err: any) {
      setConfirmError(err.message || "确认失败");
    } finally {
      setConfirming(false);
    }
  }

  if (loadingInitial) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton rows={8} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 顶部广播与提示 */}
      {errorMsg && (
        <div role="alert" className="surface p-4 text-xs text-rose-800 border-rose-200 bg-rose-50/80 flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-rose-500 hover:text-rose-800">×</button>
        </div>
      )}
      {actionSuccess && (
        <div role="status" className="surface p-4 text-xs text-teal-800 border-teal-200 bg-teal-50/80 flex items-center justify-between">
          <span>{actionSuccess}</span>
          <button onClick={() => setActionSuccess(null)} className="text-teal-500 hover:text-teal-800">×</button>
        </div>
      )}
      {copyFeedback && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg bg-slate-900 px-4 py-2.5 text-xs text-white shadow-xl animate-fade-in flex items-center gap-2">
          <span>✅</span> {copyFeedback}
        </div>
      )}

      {/* 第一部分：待分发内容与草稿选择 */}
      <section className="surface p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>🚀</span> 步骤 1：选择分发源草稿
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              支持一键将经过 GEO 事实核验与优化的成稿同时推送到多个公开与自媒体渠道。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/app/content/new" className="text-xs text-teal-700 hover:underline">
              + 新建草稿
            </Link>
          </div>
        </div>

        {drafts.length === 0 ? (
          <EmptyState
            title="暂无可用草稿"
            description="请先在内容工作台生成或撰写一份草稿后再进行多平台分发。"
            href="/app/content/new"
            action="创建首篇草稿"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
            <div className="md:col-span-1 space-y-2">
              <label className="text-xs font-semibold text-slate-700 block">选择目标草稿</label>
              <select
                className="ui-input w-full text-xs"
                value={selectedDraftId}
                onChange={(e) => setSelectedDraftId(e.target.value)}
              >
                {drafts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.status === "APPROVED" ? "✅ " : "📝 "} {d.title} (v{d.latestRevision?.version || 1})
                  </option>
                ))}
              </select>
            </div>

            {currentDraft && (
              <div className="md:col-span-2 rounded-lg bg-slate-50 border border-slate-200/80 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800">{currentDraft.title}</span>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={currentDraft.status} />
                    <span className="text-[11px] text-slate-500">
                      版本 v{currentDraft.latestRevision?.version || 1}
                    </span>
                  </div>
                </div>
                <p className="text-slate-600 line-clamp-2 leading-relaxed">
                  {currentDraft.latestRevision?.body || "（暂无正文）"}
                </p>
                <div className="flex items-center gap-3 text-[11px] text-slate-500 pt-1 border-t border-slate-200/60">
                  <span>主题：{currentDraft.topic || "综合营销"}</span>
                  <span>生成模式：{currentDraft.generationMode}</span>
                  <Link
                    href={`/app/content/${currentDraft.id}`}
                    className="text-teal-700 font-medium hover:underline ml-auto"
                  >
                    在编辑器中查看全文 →
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 第二部分：目标渠道矩阵选择 (双模式支持) */}
      <section className="surface p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>🌐</span> 步骤 2：选择目标渠道与分发模式
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              同时支持【官方 API 授权自动同步】与【多端人工辅助分发】，随心勾选多个平台同时执行。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              已选 <strong className="text-teal-700 font-bold">{selectedChannelsList.length}</strong> 个渠道
            </span>
            <button
              type="button"
              onClick={handleAdaptPreview}
              disabled={adapting || selectedChannelsList.length === 0}
              className="ui-button secondary text-xs"
            >
              {adapting ? "正在适配..." : "🔄 重新生成各端变体预览"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {channels.map((ch) => {
            const conf = CHANNEL_PLATFORM_CONFIG[ch.channel] || {
              label: ch.name,
              color: "slate",
              badgeBg: "bg-slate-100 text-slate-700",
              creatorUrl: "#",
              icon: "📌",
            };
            const selection = channelSelections[ch.channel] || { selected: false, mode: "MANUAL" };
            const isSelected = selection.selected;

            return (
              <div
                key={ch.channel}
                className={`rounded-xl border p-3.5 transition-all flex flex-col justify-between ${
                  isSelected
                    ? "border-teal-600 bg-teal-50/20 shadow-sm ring-1 ring-teal-500/30"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="space-y-2.5">
                  {/* 头部：复选框 + 图标 + 平台名称 */}
                  <div className="flex items-start justify-between gap-2">
                    <label className="flex items-center gap-2 cursor-pointer flex-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleChannel(ch.channel)}
                        className="rounded border-slate-300 text-teal-700 focus:ring-teal-500 w-4 h-4 cursor-pointer"
                      />
                      <span className="text-lg leading-none">{conf.icon}</span>
                      <span className="font-semibold text-xs text-slate-900 truncate">{conf.label}</span>
                    </label>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                      {ch.category}
                    </span>
                  </div>

                  {/* 能力徽章 */}
                  <div className="flex flex-wrap gap-1">
                    {ch.supportsAuto ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                        ⚡ 官方自动同步
                        {ch.autoCapability === "DRAFT_ONLY" ? " (草稿箱)" : ""}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                        📋 人工辅助发布包
                      </span>
                    )}
                    {ch.requiresVideo && (
                      <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">
                        🎬 视频类
                      </span>
                    )}
                  </div>

                  {/* 描述与提示 */}
                  <p className="text-[11px] text-slate-500 leading-normal line-clamp-2">
                    {ch.description}
                  </p>
                </div>

                {/* 底部模式选择切换 */}
                <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                  {ch.supportsAuto ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setChannelMode(ch.channel, "AUTO")}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                          selection.mode === "AUTO"
                            ? "bg-teal-700 text-white shadow-xs"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        自动模式
                      </button>
                      <button
                        type="button"
                        onClick={() => setChannelMode(ch.channel, "MANUAL")}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                          selection.mode === "MANUAL"
                            ? "bg-teal-700 text-white shadow-xs"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        人工模式
                      </button>
                    </div>
                  ) : (
                    <span className="text-[11px] text-slate-400">已启用标准化人工发布包</span>
                  )}

                  <a
                    href={conf.creatorUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-slate-500 hover:text-teal-700 flex items-center gap-0.5"
                    title="直达创作者后台"
                  >
                    后台 ↗
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 第三部分：多端变体排版预览与微调 */}
      {selectedChannelsList.length > 0 && (
        <section className="surface p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span>🎨</span> 步骤 3：多端变体预览与排版微调
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                针对小红书字数限制、微信图文排版、知乎 Markdown、短视频口播脚本进行了自动合规转换。
              </p>
            </div>
          </div>

          {/* 渠道标签切换 */}
          <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2">
            {selectedChannelsList.map((chKey) => {
              const conf = CHANNEL_PLATFORM_CONFIG[chKey] || { label: chKey, icon: "📌" };
              const isCurrent = activePreviewChannel === chKey;
              return (
                <button
                  key={chKey}
                  type="button"
                  onClick={() => setActivePreviewChannel(chKey)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                    isCurrent
                      ? "bg-slate-900 text-white shadow-xs"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  <span>{conf.icon}</span>
                  <span>{conf.label}</span>
                </button>
              );
            })}
          </div>

          {/* 当前选中的渠道预览与微调内容 */}
          {activePreviewChannel && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 pt-2">
              {/* 左侧：变体编辑与标题/正文 */}
              <div className="space-y-3.5 bg-slate-50/50 p-4 rounded-xl border border-slate-200/80">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800">
                    {CHANNEL_PLATFORM_CONFIG[activePreviewChannel]?.label} 专属文案
                  </span>
                  <span className="text-[11px] text-slate-500">
                    分发模式：{channelSelections[activePreviewChannel]?.mode === "AUTO" ? "⚡ 自动同步" : "📋 人工辅助"}
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <label className="font-semibold text-slate-700">标题</label>
                    {activePreviewChannel === "XIAOHONGSHU" && (
                      <span className={`text-[11px] ${
                        (editedContent[activePreviewChannel]?.title?.length || 0) > 20 ? "text-rose-600 font-bold" : "text-slate-400"
                      }`}>
                        {editedContent[activePreviewChannel]?.title?.length || 0}/20 字
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    className="ui-input w-full text-xs"
                    value={editedContent[activePreviewChannel]?.title || ""}
                    onChange={(e) =>
                      setEditedContent((prev) => ({
                        ...prev,
                        [activePreviewChannel]: {
                          ...prev[activePreviewChannel],
                          title: e.target.value,
                        },
                      }))
                    }
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700 block">正文与话题</label>
                  <textarea
                    rows={8}
                    className="ui-input w-full text-xs font-mono leading-relaxed"
                    value={editedContent[activePreviewChannel]?.body || ""}
                    onChange={(e) =>
                      setEditedContent((prev) => ({
                        ...prev,
                        [activePreviewChannel]: {
                          ...prev[activePreviewChannel],
                          body: e.target.value,
                        },
                      }))
                    }
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => copyText(editedContent[activePreviewChannel]?.title || "", "标题")}
                    className="ui-button secondary text-xs py-1"
                  >
                    📄 复制标题
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText(editedContent[activePreviewChannel]?.body || "", "正文")}
                    className="ui-button secondary text-xs py-1"
                  >
                    📝 复制正文与标签
                  </button>
                </div>
              </div>

              {/* 右侧：人工发布包指引清单与素材 */}
              <div className="space-y-3.5 bg-white p-4 rounded-xl border border-slate-200/80">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800">
                    📋 发布指引与素材包清单
                  </span>
                  {adaptedResults.find((r) => r.channel === activePreviewChannel)?.manualPackage && (
                    <button
                      type="button"
                      onClick={() =>
                        downloadManualPackage(
                          adaptedResults.find((r) => r.channel === activePreviewChannel)!.manualPackage
                        )
                      }
                      className="text-xs text-teal-700 hover:underline font-semibold"
                    >
                      💾 下载发布包 JSON
                    </button>
                  )}
                </div>

                {/* 平台专属 Checklist */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                    操作流程指引 (Checklist)
                  </span>
                  <ul className="space-y-1 text-xs text-slate-700">
                    {(
                      adaptedResults.find((r) => r.channel === activePreviewChannel)?.manualPackage?.checklist || [
                        "登录对应平台创作者中心。",
                        "复制左侧标题与正文至输入框。",
                        "预览并确认无误后点击发布。",
                      ]
                    ).map((step, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="flex-shrink-0 w-4 h-4 rounded-full bg-slate-100 text-slate-700 text-[10px] flex items-center justify-center font-bold">
                          {idx + 1}
                        </span>
                        <span className="leading-relaxed">{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* 素材列表预览 */}
                <div className="space-y-1.5 pt-2 border-t border-slate-100">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                    关联素材与资产清单
                  </span>
                  {adaptedResults.find((r) => r.channel === activePreviewChannel)?.manualPackage?.assetManifest?.length ? (
                    <div className="space-y-1 text-xs">
                      {adaptedResults
                        .find((r) => r.channel === activePreviewChannel)!
                        .manualPackage.assetManifest.map((asset) => (
                          <div
                            key={asset.index}
                            className="flex items-center justify-between rounded bg-slate-50 px-2.5 py-1.5 border border-slate-100"
                          >
                            <span className="font-medium text-slate-700">{asset.notes} ({asset.type})</span>
                            <a
                              href={asset.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-teal-700 hover:underline"
                            >
                              查看素材 ↗
                            </a>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">当前草稿未挂载独立图像或视频素材文件。</p>
                  )}
                </div>

                {/* 创作者后台直达 */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-slate-500">直达平台发布后台：</span>
                  <a
                    href={CHANNEL_PLATFORM_CONFIG[activePreviewChannel]?.creatorUrl || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="ui-button secondary text-xs py-1"
                  >
                    打开 {CHANNEL_PLATFORM_CONFIG[activePreviewChannel]?.label} 后台 ↗
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* 底部一键批量分发按钮 */}
          <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
            <div className="text-xs text-slate-500">
              将同时向 <strong className="text-slate-900">{selectedChannelsList.length}</strong> 个渠道提交分发任务。自动模式将同步至平台/草稿箱，人工模式将生成待发布清单。
            </div>
            <button
              type="button"
              disabled={distributing || selectedChannelsList.length === 0}
              onClick={handleBatchDistribute}
              className="ui-button primary text-xs px-6 py-2.5 font-bold shadow-md"
            >
              {distributing ? "正在批量分发中..." : `🚀 一键批量分发 (${selectedChannelsList.length} 个渠道)`}
            </button>
          </div>
        </section>
      )}

      {/* 第四部分：分发任务监控与人工发布结果回填 */}
      <section className="surface p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>📊</span> 分发执行看板与真实落地资产
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              监控已创建的分发任务状态，人工发布完成后回填公开链接，直接生成 PublishedAsset 沉淀为 GEO 证据资产。
            </p>
          </div>
          <button
            type="button"
            onClick={loadPublications}
            disabled={loadingPubs}
            className="ui-button secondary text-xs"
          >
            {loadingPubs ? "刷新中..." : "🔄 刷新记录"}
          </button>
        </div>

        {publications.length === 0 ? (
          <EmptyState
            title="暂无分发任务记录"
            description="完成上方的步骤 1-3 并点击【一键批量分发】后，将在此处实时展示各渠道状态。"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 font-semibold bg-slate-50/50">
                  <th className="py-2.5 px-3">目标渠道</th>
                  <th className="py-2.5 px-3">标题</th>
                  <th className="py-2.5 px-3">状态</th>
                  <th className="py-2.5 px-3">执行结果 / 资产证据</th>
                  <th className="py-2.5 px-3">创建时间</th>
                  <th className="py-2.5 px-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {publications.map((pub) => {
                  const conf = CHANNEL_PLATFORM_CONFIG[pub.channel] || {
                    label: pub.channel,
                    icon: "📌",
                    creatorUrl: "#",
                  };
                  const isPublished = pub.status === "PUBLISHED";
                  const isExternalDraft = pub.status === "DRAFT_CREATED_EXTERNALLY";
                  const isFailed = pub.status === "FAILED";
                  const latestAttempt = pub.attempts?.[pub.attempts.length - 1];
                  const asset = pub.publishedAssets?.[0];

                  return (
                    <tr key={pub.id} className="hover:bg-slate-50/50 transition">
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{conf.icon}</span>
                          <div>
                            <div className="font-semibold text-slate-900">{conf.label}</div>
                            <div className="text-[10px] text-slate-400">
                              {pub.attempts?.some((a) => a.publisher === "manual_assisted") ? "人工辅助" : "自动发布"}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3 max-w-xs">
                        <div className="font-medium text-slate-800 truncate" title={pub.title || ""}>
                          {pub.title || "（未命名标题）"}
                        </div>
                        <div className="text-[11px] text-slate-400">ID: {pub.id.slice(0, 8)}</div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="space-y-1">
                          <StatusBadge status={pub.status} />
                          {isExternalDraft && (
                            <span className="block text-[10px] text-blue-600 font-medium">草稿箱就绪</span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-3 max-w-xs">
                        {isPublished ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                              ✨ 已落地 GEO 资产
                            </span>
                            {asset?.canonicalUrl && (
                              <a
                                href={asset.canonicalUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="block text-[11px] text-teal-700 hover:underline truncate"
                                title={asset.canonicalUrl}
                              >
                                {asset.canonicalUrl}
                              </a>
                            )}
                          </div>
                        ) : isExternalDraft ? (
                          <div className="text-[11px] text-slate-600">
                            已安全存放至官方草稿箱，绝不私自群发
                          </div>
                        ) : isFailed ? (
                          <div className="text-[11px] text-rose-600 truncate" title={latestAttempt?.errorMessage || ""}>
                            {latestAttempt?.errorMessage || "发布遇到错误"}
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-400">
                            待人工前往平台发布并回填公开地址
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 text-slate-500 text-[11px]">
                        {new Date(pub.createdAt).toLocaleDateString()}
                      </td>

                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* 人工发布回填按钮 */}
                          {!isPublished && (
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmModalPub(pub);
                                setBackfillUrl("");
                                setBackfillAssetId("");
                                setConfirmError(null);
                              }}
                              className="ui-button primary text-[11px] py-1 px-2.5 font-semibold"
                            >
                              回填结果确认
                            </button>
                          )}

                          {/* 失败重试 */}
                          {isFailed && (
                            <button
                              type="button"
                              onClick={() => handleRetry(pub.id)}
                              className="ui-button secondary text-[11px] py-1 px-2"
                            >
                              重试
                            </button>
                          )}

                          {/* 直达官方平台 */}
                          <a
                            href={conf.creatorUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="ui-button secondary text-[11px] py-1 px-2"
                            title="前往对应平台创作者中心"
                          >
                            直达 ↗
                          </a>

                          {/* 已发布则提供进入 GEO 验证工作台的闭环跳转 */}
                          {isPublished && (
                            <Link
                              href="/app/content/verification"
                              className="ui-button secondary text-[11px] py-1 px-2 text-teal-700 font-semibold"
                              title="前往效果验证工作台查看 Retest 归因"
                            >
                              GEO 验证 ↗
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 人工发布回填确认 Modal */}
      {confirmModalPub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="surface max-w-lg w-full p-6 space-y-4 rounded-xl shadow-2xl animate-fade-in bg-white">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  确认人工发布结果（落成 PublishedAsset）
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  目标渠道：{CHANNEL_PLATFORM_CONFIG[confirmModalPub.channel]?.label || confirmModalPub.channel}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmModalPub(null)}
                className="text-slate-400 hover:text-slate-700 text-lg leading-none"
              >
                ×
              </button>
            </div>

            {confirmError && (
              <div role="alert" className="p-3 rounded-lg text-xs text-rose-800 bg-rose-50 border border-rose-200">
                {confirmError}
              </div>
            )}

            <div className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700 block">
                  真实公开访问链接 (canonicalUrl) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="url"
                  placeholder="如 https://www.xiaohongshu.com/explore/... 或 https://zhuanlan.zhihu.com/p/..."
                  className="ui-input w-full text-xs"
                  value={backfillUrl}
                  onChange={(e) => setBackfillUrl(e.target.value)}
                />
                <span className="text-[11px] text-slate-400">公开可访问的完整网址，用于 GEO 搜索引擎再测检索。</span>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700 block">平台文章/笔记 ID (externalAssetId)</label>
                <input
                  type="text"
                  placeholder="如平台专属数字或字符串 ID（可选）"
                  className="ui-input w-full text-xs"
                  value={backfillAssetId}
                  onChange={(e) => setBackfillAssetId(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700 block">实际发布时间</label>
                <input
                  type="datetime-local"
                  className="ui-input w-full text-xs"
                  value={backfillPublishedAt}
                  onChange={(e) => setBackfillPublishedAt(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700 block">核验与发布备注 (可选)</label>
                <input
                  type="text"
                  placeholder="如：已通过平台审核并进入官方推荐池"
                  className="ui-input w-full text-xs"
                  value={backfillNote}
                  onChange={(e) => setBackfillNote(e.target.value)}
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmModalPub(null)}
                className="ui-button secondary text-xs"
              >
                取消
              </button>
              <button
                type="button"
                disabled={confirming}
                onClick={handleSubmitBackfill}
                className="ui-button primary text-xs font-bold px-4"
              >
                {confirming ? "正在确认中..." : "确认并落成资产"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
