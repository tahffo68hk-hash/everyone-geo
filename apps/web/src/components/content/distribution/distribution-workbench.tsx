"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getDistributionChannels,
  adaptContentForChannels,
  batchDistribute,
  confirmManualPublished,
  listProjectPublications,
  processPublicationRetry,
  channelLimitViolations,
  resolvePackageHashtags,
  adaptContentWithAi,
  getAiProviderStatus,
  type DistributionChannel,
  type AdaptedChannelContent,
  type PublicationListItem,
  type ManualPublishingPackage,
  type ChannelAdaptationResult,
} from "@/lib/distribution-api";
import { listContentDrafts, createContentDraft, type Draft } from "@/lib/content-api";
import { generateAiDraft, type AiResponseMeta, type ContentDraftResult } from "@/lib/ai-api";
import { api } from "@/lib/api";
import { StatusBadge, LoadingSkeleton, EmptyState } from "@/components/ui";
import { BrowserAssistedPanel } from "./browser-assisted-panel";

const VIDEO_SCRIPT_CHANNELS = new Set(["DOUYIN", "WECHAT_CHANNELS", "BILIBILI", "KUAISHOU"]);

const CHANNEL_PLATFORM_CONFIG: Record<
  string,
  {
    label: string;
    color: string;
    badgeBg: string;
    creatorUrl: string;
    icon: string;
    description: string;
    titleFieldGuide: string;
    bodyFieldGuide: string;
    tagsFieldGuide: string;
    guidelines: string[];
  }
> = {
  ZHIHU: {
    label: "知乎专栏",
    color: "sky",
    badgeBg: "bg-sky-50 text-sky-700 border-sky-200",
    creatorUrl: "https://zhuanlan.zhihu.com/write",
    icon: "📖",
    description: "知乎专栏与回答创作，适合深度科普、专业解答与行业评测。",
    titleFieldGuide: "文章标题（建议 15-40 字，突出专业结论或疑问）",
    bodyFieldGuide: "专栏正文（支持 Markdown / 富文本，建议带小标题与事实论据）",
    tagsFieldGuide: "话题标签（最多 5 个，在发布面板底部输入）",
    guidelines: [
      "知乎专栏文章发布要求账号完成实名认证。",
      "正文支持直接粘贴 Markdown 格式或带图富文本。",
      "添加与行业、专业高度契合的 3-5 个公共话题以提高流通权重与搜索收录。",
      "文章发布后会有 1-3 分钟系统审核，审核通过后进入公共推荐与搜索引擎索引。",
    ],
  },
  XIAOHONGSHU: {
    label: "小红书",
    color: "rose",
    badgeBg: "bg-rose-50 text-rose-700 border-rose-200",
    creatorUrl: "https://creator.xiaohongshu.com/publish/publish",
    icon: "📕",
    description: "小红书图文与笔记创作，适合生动种草、经验分享与实用指南。",
    titleFieldGuide: "笔记标题（20 字以内，吸引眼球，包含核心关键词）",
    bodyFieldGuide: "笔记正文（1000 字以内，段落短小，善用 Emoji 表情符号）",
    tagsFieldGuide: "笔记话题（以 # 开头，建议添加 3-8 个垂直热门话题）",
    guidelines: [
      "建议准备 1-9 张竖版图片（3:4 比例最佳），封面需有醒目大字或主视觉。",
      "正文避免出现纯外部导流违禁词（如淘宝链接、私人微信）。",
      "末尾带上针对性场景标签和专业领域话题。",
      "发布后可在创作者平台查看笔记审核状态与曝光数据。",
    ],
  },
  WECHAT_OFFICIAL_ACCOUNT: {
    label: "微信公众号",
    color: "emerald",
    badgeBg: "bg-emerald-50 text-emerald-700 border-emerald-200",
    creatorUrl: "https://mp.weixin.qq.com/",
    icon: "💬",
    description: "微信公众平台图文消息，权威发布与私域沉淀的核心阵地。",
    titleFieldGuide: "图文标题（64 字以内，建议 20-30 字，简洁有力）",
    bodyFieldGuide: "图文正文（排版精美，支持多图、样式排版与引用说明）",
    tagsFieldGuide: "文章标签与合集（最多 3 个）",
    guidelines: [
      "需在微信公众平台扫码登录管理员或运营者账号。",
      "封面图建议 2.35:1 横版或 1:1 方版比例，建议提前裁剪。",
      "支持正文插入多张高清图片与视频素材。",
      "建议先保存为草稿箱，发送手机端预览确认排版无误后再发布。",
    ],
  },
  BILIBILI: {
    label: "哔哩哔哩专栏",
    color: "pink",
    badgeBg: "bg-pink-50 text-pink-700 border-pink-200",
    creatorUrl: "https://member.bilibili.com/platform/upload/text/edit",
    icon: "📺",
    description: "B 站专栏文稿创作，适合长图文知识科普与青年圈层互动。",
    titleFieldGuide: "专栏标题（40 字以内）",
    bodyFieldGuide: "专栏正文（图文并茂，支持代码块与深度长文）",
    tagsFieldGuide: "投稿标签（最多可添加 12 个标签）",
    guidelines: [
      "专栏需要绑定实名认证的 B 站账号。",
      "配图建议 16:9 横版封面，正文支持高清插图。",
      "标签可选择对应分区热门标签（如：知识区、科普、大学专业、数码等）。",
      "提交后通常在 10 分钟内完成平台机器与人工审核。",
    ],
  },
  DOUYIN: {
    label: "抖音创作者平台",
    color: "slate",
    badgeBg: "bg-slate-900 text-white border-slate-700",
    creatorUrl: "https://creator.douyin.com/creator-micro/content/upload",
    icon: "🎵",
    description: "抖音图文与短视频创作，高爆发流量公域传播。",
    titleFieldGuide: "视频/图文文案（30-100 字，开头 2 句包含核心钩子）",
    bodyFieldGuide: "完整文案/分镜头脚本（分秒节拍与口播台词）",
    tagsFieldGuide: "关联挑战与话题（以 # 开头的话题词）",
    guidelines: [
      "支持图文或短视频发布，短视频需先在剪辑软件中完成渲染。",
      "文案前 2 行最关键，直接决定用户停留率与滑走率。",
      "关联同城地点或垂直话题挑战可获得初始公域流量倾斜。",
    ],
  },
  WEIBO: {
    label: "微博",
    color: "red",
    badgeBg: "bg-red-50 text-red-700 border-red-200",
    creatorUrl: "https://weibo.com/",
    icon: "🔴",
    description: "微博短博文与头条文章，热点发酵与舆论破圈枢纽。",
    titleFieldGuide: "头条文章标题 / 微博核心主句",
    bodyFieldGuide: "微博正文或头条长文（支持带图九宫格与超话绑定）",
    tagsFieldGuide: "微博双井号话题（如 #专业选择#）",
    guidelines: [
      "普通微博建议控制在 140 字左右，深度内容建议使用头条文章编辑器。",
      "配图建议九宫格或 1-4 张精选单图展示。",
      "带上 #话题# 并 @ 相关垂直蓝 V 或行业官微有助于二次转发扩散。",
    ],
  },
  WORDPRESS: {
    label: "WordPress / 企业 CMS",
    color: "blue",
    badgeBg: "bg-blue-50 text-blue-700 border-blue-200",
    creatorUrl: "/wp-admin",
    icon: "🌐",
    description: "独立站与官网博客，SEO 与事实沉淀的底座。",
    titleFieldGuide: "SEO 页面标题（建议包含核心关键词）",
    bodyFieldGuide: "HTML / 富文本正文（包含 H2/H3 结构与内链）",
    tagsFieldGuide: "分类与标签（以逗号分隔）",
    guidelines: [
      "可直接发布为正式文章或保留在草稿箱中由主编审核。",
      "设置永久链接 (Permalink) 为包含英文或拼音语义的规范 URL。",
      "配置清晰的 Meta Description 提升搜索引擎抓取收录率。",
    ],
  },
  WECHAT_CHANNELS: {
    label: "微信视频号",
    color: "amber",
    badgeBg: "bg-amber-50 text-amber-700 border-amber-200",
    creatorUrl: "https://channels.weixin.qq.com/",
    icon: "📹",
    description: "微信生态短视频与直播平台，社交链裂变传播。",
    titleFieldGuide: "视频描述文案（简短有力）",
    bodyFieldGuide: "脚本与口播旁白",
    tagsFieldGuide: "视频号话题（#话题）",
    guidelines: [
      "需在微信视频号助手扫码授权登录。",
      "建议视频时长在 15 秒到 3 分钟之间，分辨率 1080p 竖屏最佳。",
      "可在视频文案中挂载微信公众号图文扩展链接，实现公私域闭环。",
    ],
  },
  KUAISHOU: {
    label: "快手",
    color: "orange",
    badgeBg: "bg-orange-50 text-orange-700 border-orange-200",
    creatorUrl: "https://cp.kuaishou.com/article/publish/video",
    icon: "⚡",
    description: "快手创作者服务平台短视频发布，公域推荐与真实社区互动。",
    titleFieldGuide: "短视频标题（30 字以内，醒目吸引点击）",
    bodyFieldGuide: "视频描述与口播分镜脚本",
    tagsFieldGuide: "快手话题（以 # 开头）",
    guidelines: [
      "支持 1080p 竖屏短视频成片上传。",
      "标题建议 30 字以内，善用热门话题与接地气文案。",
      "受控 Chrome 辅助上传成片并填写描述，PREPARE_ONLY 停留在最终发布页供作者审核。",
    ],
  },
  BAIJIAHAO: {
    label: "百家号",
    color: "indigo",
    badgeBg: "bg-indigo-50 text-indigo-700 border-indigo-200",
    creatorUrl: "https://baijiahao.baidu.com/builder/rc/edit?type=news",
    icon: "🔍",
    description: "百度百家号文章与图文发布，百度搜索引擎收录与加权展示。",
    titleFieldGuide: "文章标题（64 字以内，建议 20-30 字，契合搜索意图）",
    bodyFieldGuide: "文章正文（图文富文本，支持多图与排版）",
    tagsFieldGuide: "分类与标签",
    guidelines: [
      "百度搜索生态首发加权与信息流分发。",
      "文章标题建议包含核心搜索关键词，正文层次分明。",
      "受控 Chrome 辅助自动填入并停留在发布前供作者审核。",
    ],
  },
  TOUTIAO: {
    label: "今日头条",
    color: "rose",
    badgeBg: "bg-rose-50 text-rose-700 border-rose-200",
    creatorUrl: "https://mp.toutiao.com/profile_v4/graphic/publish",
    icon: "📰",
    description: "今日头条号创作者平台，算法推荐与信息流强力分发。",
    titleFieldGuide: "头条标题（严控 30 字以内，信息量大、观点鲜明）",
    bodyFieldGuide: "头条文章正文（支持富文本排版与多张高清插图）",
    tagsFieldGuide: "头条话题与分类",
    guidelines: [
      "头条平台对标题长度有硬性限制，严格控制在 30 字以内。",
      "封面图支持单图、三图或无图模式，建议配合高清横图。",
      "受控 Chrome 自动填写正文与标题，并在【发布】按钮前停留等待人工确认。",
    ],
  },
};

export function DistributionWorkbench({ projectId }: { projectId: string }) {
  const searchParams = useSearchParams();
  const urlDraftId = searchParams?.get("draftId") || "";
  const urlChannel = searchParams?.get("channel") || "";

  // 渠道与草稿状态
  const [channels, setChannels] = useState<DistributionChannel[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string>(urlDraftId || "");
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // 创作入口状态：'MANUAL' (手工录入) | 'AI' (AI 智能生成) | 'EXISTING' (选择已有草稿)
  const [creationEntry, setCreationEntry] = useState<"MANUAL" | "AI" | "EXISTING">(
    urlDraftId ? "EXISTING" : "MANUAL",
  );

  // 入口 A：手工录入表单状态
  const [manualTitle, setManualTitle] = useState("");
  const [manualChannel, setManualChannel] = useState(urlChannel || "ZHIHU");
  const [manualTopic, setManualTopic] = useState("");
  const [manualBody, setManualBody] = useState("");
  const [manualTags, setManualTags] = useState("");
  const [manualSaving, setManualSaving] = useState(false);

  // 入口 B：AI 智能生成表单状态
  const [aiBrandName, setAiBrandName] = useState("");
  const [aiTopic, setAiTopic] = useState("");
  const [aiBrief, setAiBrief] = useState("");
  const [aiChannel, setAiChannel] = useState(urlChannel || "ZHIHU");
  const [aiTone, setAiTone] = useState("PROFESSIONAL");
  const [aiSelectedProvider, setAiSelectedProvider] = useState<"auto" | "deepseek" | "qwen" | "mock">("auto");
  const [aiSelectedDiagId, setAiSelectedDiagId] = useState<string>("");
  const [diagnosesList, setDiagnosesList] = useState<Array<{ id: string; name: string; findingCount: number }>>([]);
  const [aiDraftGenerating, setAiDraftGenerating] = useState(false);
  const [aiDraftResultMeta, setAiDraftResultMeta] = useState<AiResponseMeta<ContentDraftResult> | null>(null);
  const [aiGeneratedDraft, setAiGeneratedDraft] = useState<{
    title: string;
    body: string;
    summary: string;
    tags: string[];
  } | null>(null);
  const [aiAdopting, setAiAdopting] = useState(false);

  // 发布方式切换：'BROWSER_ASSISTED' (Selenium V2A) | 'MANUAL_GUIDE' (纯人工精准指引) | 'BATCH_MATRIX' (多渠道批量矩阵)
  const [publishingMode, setPublishingMode] = useState<"BROWSER_ASSISTED" | "MANUAL_GUIDE" | "BATCH_MATRIX">(
    "BROWSER_ASSISTED",
  );
  const [activeAssistedChannel, setActiveAssistedChannel] = useState<string>(urlChannel || "ZHIHU");
  const [activeManualChannel, setActiveManualChannel] = useState<string>(urlChannel || "ZHIHU");

  // 批量矩阵渠道选择
  const [channelSelections, setChannelSelections] = useState<
    Record<string, { selected: boolean; mode: "AUTO" | "MANUAL"; targetStatus?: "draft" | "publish" }>
  >({});

  // 渠道适配预览状态
  const [adapting, setAdapting] = useState(false);
  const [adaptedResults, setAdaptedResults] = useState<AdaptedChannelContent[]>([]);
  const [activePreviewChannel, setActivePreviewChannel] = useState<string>("");

  // 变体内容可编辑状态
  const [editedContent, setEditedContent] = useState<
    Record<string, { title: string; body: string; tags: string[] }>
  >({});
  const [aiRunning, setAiRunning] = useState(false);
  const [aiUseReal, setAiUseReal] = useState(false);
  const [realAiAvailable, setRealAiAvailable] = useState(false);
  const [aiResult, setAiResult] = useState<ChannelAdaptationResult | null>(null);
  const [aiDrafts, setAiDrafts] = useState<
    Record<string, { title: string; body: string; tags: string; videoScript: string }>
  >({});
  const [confirmedScripts, setConfirmedScripts] = useState<Record<string, string>>({});
  const [confirmedChannels, setConfirmedChannels] = useState<Record<string, boolean>>({});

  // 批量分发中
  const [distributing, setDistributing] = useState(false);
  const submissionKeyRef = useRef<string | null>(null);
  const submitLockRef = useRef(false);

  // 分发记录列表与分页
  const [publications, setPublications] = useState<PublicationListItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPubs, setTotalPubs] = useState(0);
  const [loadingPubs, setLoadingPubs] = useState(false);
  const pageSize = 10;

  // 人工发布回填 Modal
  const [confirmModalPub, setConfirmModalPub] = useState<PublicationListItem | null>(null);
  const [backfillUrl, setBackfillUrl] = useState("");
  const [backfillAssetId, setBackfillAssetId] = useState("");
  const [backfillPublishedAt, setBackfillPublishedAt] = useState("");
  const [backfillNote, setBackfillNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // 复制反馈
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  function toLocalDatetimeString(date: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    return `${y}-${m}-${d}T${hh}:${mm}`;
  }

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

        // 初始化渠道选择
        const initialSel: Record<string, { selected: boolean; mode: "AUTO" | "MANUAL"; targetStatus?: "draft" | "publish" }> = {};
        for (const ch of chList) {
          const canAuto = Boolean(ch.supportsAuto && ch.connected);
          initialSel[ch.channel] = {
            selected: ["ZHIHU", "XIAOHONGSHU", "WECHAT_OFFICIAL_ACCOUNT"].includes(ch.channel),
            mode: canAuto ? "AUTO" : "MANUAL",
            targetStatus: ch.autoCapability === "DRAFT_ONLY" ? "draft" : "publish",
          };
        }
        setChannelSelections(initialSel);

        // 如果 URL 指定了 draftId 则选定，否则选 APPROVED 或第一篇
        if (urlDraftId && drList.some((d) => d.id === urlDraftId)) {
          setSelectedDraftId(urlDraftId);
          setCreationEntry("EXISTING");
        } else if (drList.length > 0) {
          const approved = drList.find((d) => d.status === "APPROVED");
          setSelectedDraftId(approved ? approved.id : drList[0].id);
        }

        // 加载分发记录
        loadPublications(1);

        // 预加载诊断列表供 AI 入口挑选
        api<Array<{ diagnosis: { id: string; name?: string; summary?: any }; report?: { provider?: string } }>>(
          `/projects/${projectId}/diagnoses`,
        )
          .then((rows) => {
            if (Array.isArray(rows)) {
              setDiagnosesList(
                rows.map((r) => ({
                  id: r.diagnosis.id,
                  name: `诊断 #${r.diagnosis.id.slice(0, 8)} (${r.report?.provider || "GEO 评估"})`,
                  findingCount: r.diagnosis.summary?.findingCount || 0,
                })),
              );
            }
          })
          .catch(() => {});
      } catch (err: any) {
        setErrorMsg(err.message || "加载发布中心数据失败");
      } finally {
        setLoadingInitial(false);
      }
    }
    loadData();
  }, [projectId, urlDraftId]);

  async function loadPublications(page = 1) {
    setLoadingPubs(true);
    try {
      const res = await listProjectPublications(projectId, { page, pageSize });
      setPublications(res.items || []);
      setTotalPubs(res.total || 0);
      setCurrentPage(res.page || page);
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

  // 选中的批量渠道列表
  const selectedChannelsList = useMemo(() => {
    return Object.entries(channelSelections)
      .filter(([_, sel]) => sel.selected)
      .map(([ch]) => ch);
  }, [channelSelections]);

  useEffect(() => {
    submissionKeyRef.current = null;
  }, [selectedDraftId, channelSelections, editedContent]);

  const channelLimitsMap = useMemo(() => {
    return Object.fromEntries(channels.map((ch) => [ch.channel, ch.limits ?? null]));
  }, [channels]);

  const manualLimitViolations = useMemo(() => {
    return selectedChannelsList
      .filter((ch) => channelSelections[ch]?.mode === "MANUAL")
      .map((ch) => ({ channel: ch, violations: channelLimitViolations(channelLimitsMap[ch], editedContent[ch]) }))
      .filter((v) => v.violations.length > 0);
  }, [selectedChannelsList, channelSelections, channelLimitsMap, editedContent]);

  // 适配预览
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

  useEffect(() => {
    getAiProviderStatus()
      .then((status) => {
        const available = status.providers.some((item) => item.realModeAllowed);
        setRealAiAvailable(available);
      })
      .catch(() => setRealAiAvailable(false));
  }, []);

  async function handleAiAdapt(force = false) {
    if (!selectedDraftId || selectedChannelsList.length === 0 || aiRunning) return;
    setAiRunning(true);
    setErrorMsg(null);
    try {
      const res = await adaptContentWithAi(projectId, selectedDraftId, {
        channels: selectedChannelsList,
        provider: aiUseReal ? "auto" : "mock",
        force,
      });
      setAiResult(res);
      const draftsMap: Record<string, { title: string; body: string; tags: string; videoScript: string }> = {};
      for (const item of res.channels) {
        draftsMap[item.channel] = {
          title: item.title,
          body: item.body,
          tags: item.hashtags.join(" "),
          videoScript: item.videoScript || "",
        };
      }
      setAiDrafts(draftsMap);
      setActionSuccess(
        res.replayed
          ? "已复用相同原文的上次适配结果，未再次调用模型。确认前不会提交或发布。"
          : res.realAi
            ? "真实模型已生成渠道适配。请对照原文并确认，确认前不会提交或发布。"
            : "这是模拟适配，不是真实模型结果。请对照原文并确认，确认前不会提交或发布。",
      );
    } catch (err: any) {
      setErrorMsg(err.message || "AI 渠道适配失败");
    } finally {
      setAiRunning(false);
    }
  }

  function confirmAiDraft(channel: string) {
    const draft = aiDrafts[channel];
    if (!draft) return;
    const tags = draft.tags.split(/\s+/).map((tag) => tag.replace(/#/g, "").trim()).filter(Boolean);
    setEditedContent((prev) => ({
      ...prev,
      [channel]: { title: draft.title, body: draft.body, tags },
    }));
    setConfirmedScripts((prev) => ({ ...prev, [channel]: draft.videoScript }));
    setConfirmedChannels((prev) => ({ ...prev, [channel]: true }));
    setActionSuccess(`${CHANNEL_PLATFORM_CONFIG[channel]?.label || channel} 的适配稿已写入预览。仍需手动提交，不会自动发布。`);
  }

  useEffect(() => {
    if (selectedDraftId && selectedChannelsList.length > 0) {
      handleAdaptPreview();
    }
  }, [selectedDraftId]);

  function toggleChannel(channelKey: string) {
    setChannelSelections((prev) => {
      const curr = prev[channelKey] || { selected: false, mode: "MANUAL" };
      return {
        ...prev,
        [channelKey]: { ...curr, selected: !curr.selected },
      };
    });
  }

  function setChannelMode(channelKey: string, mode: "AUTO" | "MANUAL") {
    setChannelSelections((prev) => {
      const curr = prev[channelKey] || { selected: true, mode: "MANUAL" };
      return {
        ...prev,
        [channelKey]: { ...curr, mode },
      };
    });
  }

  function setChannelTargetStatus(channelKey: string, targetStatus: "draft" | "publish") {
    setChannelSelections((prev) => {
      const curr = prev[channelKey] || { selected: true, mode: "AUTO" };
      return {
        ...prev,
        [channelKey]: { ...curr, targetStatus },
      };
    });
  }

  function copyText(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopyFeedback(`${label} 已复制到剪贴板`);
    setTimeout(() => setCopyFeedback(null), 2500);
  }

  function downloadManualPackage(pkg: ManualPublishingPackage, chKey?: string) {
    const channel = chKey || pkg.channel;
    const currentEdit = editedContent[channel];
    const violations = channelLimitViolations(channelLimitsMap[channel], currentEdit);
    if (violations.length > 0) {
      setErrorMsg(`当前内容超出平台限制（${violations.join("，")}），请调整后再下载发布包`);
      return;
    }
    const title = currentEdit?.title ?? pkg.title;
    const body = currentEdit?.body ?? pkg.body;
    const exportPkg: ManualPublishingPackage = {
      ...pkg,
      title,
      body,
      hashtags: currentEdit ? resolvePackageHashtags(currentEdit.tags, body) : pkg.hashtags,
      videoScript: confirmedScripts[channel] !== undefined ? confirmedScripts[channel] || null : pkg.videoScript,
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportPkg, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `geolens_${channel.toLowerCase()}_manual_package.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setErrorMsg(null);
    setCopyFeedback("发布包已下载（包含最新编辑）");
    setTimeout(() => setCopyFeedback(null), 2500);
  }

  // --- 入口 A：提交手工录入草稿 ---
  async function handleCreateManualDraft(andPublishNow = false) {
    if (!manualTitle.trim()) {
      setErrorMsg("请填写内容标题");
      return;
    }
    if (!manualBody.trim()) {
      setErrorMsg("请填写正文内容");
      return;
    }
    setManualSaving(true);
    setErrorMsg(null);
    try {
      const tagsArray = manualTags
        .split(/[,，\s]+/)
        .map((t) => t.replace(/#/g, "").trim())
        .filter(Boolean);

      const created = await createContentDraft(projectId, {
        title: manualTitle.trim(),
        topic: manualTopic.trim() || undefined,
        body: manualBody.trim(),
        summary: tagsArray.join(" ") || undefined,
        generationMode: "MANUAL",
      });

      setDrafts((prev) => [created, ...prev]);
      setSelectedDraftId(created.id);
      setActiveAssistedChannel(manualChannel);
      setActiveManualChannel(manualChannel);

      if (andPublishNow) {
        setCreationEntry("EXISTING");
        setActionSuccess(`草稿「${created.title}」已保存，已为您自动进入发布模式。`);
      } else {
        setActionSuccess(`草稿「${created.title}」已成功保存至草稿箱。`);
      }
    } catch (err: any) {
      setErrorMsg(err.message || "创建草稿失败");
    } finally {
      setManualSaving(false);
    }
  }

  // --- 入口 B：触发 AI 生成内容 ---
  async function handleGenerateAiDraft() {
    if (!aiTopic.trim()) {
      setErrorMsg("请输入要生成的核心主题或要解决的低覆盖搜索词");
      return;
    }
    setAiDraftGenerating(true);
    setErrorMsg(null);
    setAiGeneratedDraft(null);
    try {
      const toneMap: Record<string, string> = {
        PROFESSIONAL: "专业严谨、客观中立的行业深度科普与测评视角",
        EXPERIENCE: "生动真实、亲历实测的使用体验与种草避坑视角",
        AUTHORITATIVE: "官方权威、体系完整的产品方案与白皮书指南视角",
        COMMERCIAL: "商业决策对比、选型矩阵与成本效益评估视角",
      };

      const res = await generateAiDraft(projectId, {
        title: aiTopic.trim(),
        channel: aiChannel,
        brandName: aiBrandName.trim() || undefined,
        brief: aiBrief.trim() || undefined,
        audience: toneMap[aiTone] || "专业深度视角",
        brandContext: aiBrief.trim() || "以客观真实、实事求是的业务与产品信息为核心，严禁凭空夸大。",
        provider: aiSelectedProvider,
      });

      if (!res.data?.body || res.data.body.trim().length < 20) {
        throw new Error("AI 生成未返回有效正文，请检查模型状态或稍后重试。");
      }

      setAiDraftResultMeta(res);
      setAiGeneratedDraft({
        title: res.data.title || aiTopic.trim(),
        body: res.data.body.trim(),
        summary: res.data.summary || "",
        tags: res.data.tags || [],
      });
      const isMock = res.provider === "mock" || res.requestedProvider === "mock";
      setActionSuccess(
        isMock
          ? "【演示模拟】已生成演示文章方案。正式使用请切换为真实模型。"
          : `✨ 真实 AI (${res.model || res.provider}) 已生成完整正文（共 ${res.data.body.length} 字）！请在下方核验并采纳。`,
      );
    } catch (err: any) {
      setErrorMsg(err.message || "AI 生成内容失败");
    } finally {
      setAiDraftGenerating(false);
    }
  }

  // --- 入口 B：采纳 AI 生成的内容并进入发布 ---
  async function handleAdoptAiDraft() {
    if (!aiGeneratedDraft) return;
    setAiAdopting(true);
    setErrorMsg(null);
    try {
      const created = await createContentDraft(projectId, {
        title: aiGeneratedDraft.title.trim(),
        topic: aiTopic.trim(),
        body: aiGeneratedDraft.body.trim(),
        summary: aiGeneratedDraft.summary || aiGeneratedDraft.tags.join(" "),
        generationMode: "AI_GENERATED",
        sourceDiagnosisId: aiSelectedDiagId || undefined,
      });

      const fullCreatedDraft: Draft = {
        ...created,
        title: created.title || aiGeneratedDraft.title.trim(),
        topic: created.topic || aiTopic.trim(),
        body: (created as any).body || aiGeneratedDraft.body.trim(),
        latestRevision: created.latestRevision || {
          id: (created as any).latestRevision?.id || `rev-${created.id}`,
          version: 1,
          body: aiGeneratedDraft.body.trim(),
          summary: aiGeneratedDraft.summary || "",
          changeNote: null,
          generatedById: "",
          createdAt: new Date().toISOString(),
        },
        revisions: (created as any).revisions?.length
          ? (created as any).revisions
          : [
              {
                id: (created as any).latestRevision?.id || `rev-${created.id}`,
                version: 1,
                body: aiGeneratedDraft.body.trim(),
                summary: aiGeneratedDraft.summary || "",
                changeNote: null,
                generatedById: "",
                createdAt: new Date().toISOString(),
              },
            ],
        tags: aiGeneratedDraft.tags || [],
      };

      setDrafts((prev) => [fullCreatedDraft, ...prev.filter((d) => d.id !== created.id)]);
      setSelectedDraftId(created.id);
      setActiveAssistedChannel(aiChannel);
      setActiveManualChannel(aiChannel);
      setPublishingMode("BROWSER_ASSISTED");
      setCreationEntry("EXISTING");
      setEditedContent((prev) => ({
        ...prev,
        [aiChannel]: {
          title: aiGeneratedDraft.title.trim(),
          body: aiGeneratedDraft.body.trim(),
          tags: aiGeneratedDraft.tags || [],
        },
      }));
      setActionSuccess(`已采纳 AI 方案并保存为草稿「${created.title}」，已无缝带入发布工作台！`);
    } catch (err: any) {
      setErrorMsg(err.message || "采纳 AI 方案失败");
    } finally {
      setAiAdopting(false);
    }
  }

  // 批量分发提交
  async function handleBatchDistribute() {
    if (!selectedDraftId || selectedChannelsList.length === 0) return;
    if (submitLockRef.current) return;
    if (manualLimitViolations.length > 0) {
      setErrorMsg(
        "以下人工渠道内容超出平台限制：" +
          manualLimitViolations
            .map((v) => `${CHANNEL_PLATFORM_CONFIG[v.channel]?.label || v.channel}（${v.violations.join("，")}）`)
            .join("；"),
      );
      return;
    }
    submitLockRef.current = true;
    if (!submissionKeyRef.current) {
      submissionKeyRef.current = `ui-${crypto.randomUUID()}`;
    }
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
          videoScript: confirmedScripts[ch] || undefined,
        };
      });

      const res = await batchDistribute(projectId, selectedDraftId, {
        items: itemsToSubmit,
        idempotencyKey: submissionKeyRef.current,
      });

      const replayedCount = res.items.filter((i) => i.replayed).length;
      setActionSuccess(
        replayedCount === res.items.length
          ? `该内容已提交过，已复用原有 ${res.items.length} 个分发任务，未重复创建。`
          : `已创建 ${res.items.length - replayedCount} 个渠道的分发任务${replayedCount > 0 ? `，${replayedCount} 个复用原任务` : ""}。`,
      );
      await loadPublications(1);
    } catch (err: any) {
      setErrorMsg(err.message || "批量分发失败");
    } finally {
      submitLockRef.current = false;
      setDistributing(false);
    }
  }

  // 纯人工模式下快速创建单渠道人工发布记录并打开回填
  async function handleCreateSingleManualTask(channelKey: string) {
    if (!selectedDraftId) {
      setErrorMsg("请先准备并选定一篇草稿后再创建发布任务");
      return;
    }
    try {
      const conf = CHANNEL_PLATFORM_CONFIG[channelKey];
      const res = await batchDistribute(projectId, selectedDraftId, {
        items: [
          {
            channel: channelKey,
            mode: "MANUAL",
            title: currentDraft?.title,
            body: currentDraft?.latestRevision?.body,
          },
        ],
      });
      await loadPublications(1);
      const createdItem = res.items[0];
      if (createdItem) {
        const pubItem: PublicationListItem = {
          id: createdItem.id,
          projectId,
          draftId: selectedDraftId,
          revisionId: res.revisionId,
          connectionId: "",
          channel: channelKey,
          title: createdItem.title,
          mode: "MANUAL",
          status: createdItem.status,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          publishedAt: null,
          attempts: [],
        };
        setConfirmModalPub(pubItem);
        setBackfillUrl("");
        setBackfillAssetId("");
        setBackfillPublishedAt(toLocalDatetimeString());
        setConfirmError(null);
      }
      setActionSuccess(`已为【${conf?.label || channelKey}】创建人工发布任务，请在平台发布完成后回填链接。`);
    } catch (err: any) {
      setErrorMsg(err.message || "创建人工发布任务失败");
    }
  }

  // 重试自动发布任务
  async function handleRetry(pubId: string) {
    setErrorMsg(null);
    try {
      await processPublicationRetry(pubId);
      setActionSuccess("已触发重试执行");
      await loadPublications(currentPage);
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
        actualPublishedAt: backfillPublishedAt.trim() ? new Date(backfillPublishedAt).toISOString() : undefined,
        verificationNote: backfillNote.trim() || undefined,
      });
      setConfirmModalPub(null);
      setBackfillUrl("");
      setBackfillAssetId("");
      setBackfillNote("");
      setActionSuccess("已成功确认人工发布！该内容已直接落成 PublishedAsset，并进入 GEO 效果闭环。");
      await loadPublications(currentPage);
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
    <div className="space-y-8">
      {/* 顶部全局提示 */}
      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50/90 p-4 text-xs text-rose-800 flex items-center justify-between shadow-xs animate-fade-in"
        >
          <div className="flex items-center gap-2">
            <span className="text-base">⚠️</span>
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-rose-500 hover:text-rose-800 font-bold text-sm">
            ×
          </button>
        </div>
      )}
      {actionSuccess && (
        <div
          role="status"
          className="rounded-xl border border-teal-200 bg-teal-50/90 p-4 text-xs text-teal-800 flex items-center justify-between shadow-xs animate-fade-in"
        >
          <div className="flex items-center gap-2">
            <span className="text-base">✅</span>
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-teal-500 hover:text-teal-800 font-bold text-sm">
            ×
          </button>
        </div>
      )}
      {copyFeedback && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-slate-900 px-4 py-2.5 text-xs text-white shadow-2xl flex items-center gap-2 border border-slate-700 animate-fade-in">
          <span>📋</span>
          <span>{copyFeedback}</span>
        </div>
      )}

      {/* ============================================================== */}
      {/* 步骤 1：准备分发内容（双创作入口 + 已有草稿库） */}
      {/* ============================================================== */}
      <section className="surface p-6 space-y-5 rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">
                1
              </span>
              <h2 className="text-base font-bold text-slate-900">准备发布内容</h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              支持直接手工录入内容、由 AI 根据 GEO 诊断事实自动生成，或直接从现有草稿箱挑选成稿。
            </p>
          </div>

          {/* 创作入口 Switcher */}
          <div className="flex rounded-xl bg-slate-100 p-1 border border-slate-200/70 text-xs font-medium">
            <button
              type="button"
              onClick={() => setCreationEntry("MANUAL")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition ${
                creationEntry === "MANUAL"
                  ? "bg-white text-slate-900 font-bold shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span>✍️</span>
              <span>手工录入</span>
            </button>
            <button
              type="button"
              onClick={() => setCreationEntry("AI")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition ${
                creationEntry === "AI"
                  ? "bg-white text-teal-700 font-bold shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span>✨</span>
              <span>AI 智能生成</span>
            </button>
            <button
              type="button"
              onClick={() => setCreationEntry("EXISTING")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition ${
                creationEntry === "EXISTING"
                  ? "bg-white text-slate-900 font-bold shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span>📁</span>
              <span>选择已有草稿</span>
              {drafts.length > 0 && (
                <span className="rounded-full bg-slate-200 px-1.5 py-0.2 text-[10px] text-slate-700">
                  {drafts.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* 入口 A：手工录入 */}
        {creationEntry === "MANUAL" && (
          <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/50 p-5">
            <div className="flex items-center justify-between border-b border-slate-200/60 pb-3">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-2">
                <span>✍️</span> 手工录入新内容
              </span>
              <span className="text-[11px] text-slate-500">将直接保存为规范版本并进入发布准备</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 block">
                  目标发布平台 <span className="text-rose-500">*</span>
                </label>
                <select
                  value={manualChannel}
                  onChange={(e) => setManualChannel(e.target.value)}
                  className="ui-input w-full text-xs"
                >
                  {Object.entries(CHANNEL_PLATFORM_CONFIG).map(([k, conf]) => (
                    <option key={k} value={k}>
                      {conf.icon} {conf.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2 space-y-1">
                <label className="text-xs font-semibold text-slate-700 block">
                  内容标题 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  maxLength={200}
                  placeholder="请输入标题，如：医学信息工程专业核心课程与就业前景全面解读"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  className="ui-input w-full text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <label className="font-semibold text-slate-700">
                  正文内容 <span className="text-rose-500">*</span>
                </label>
                <span className="text-[11px] text-slate-400">{manualBody.length} 字</span>
              </div>
              <textarea
                rows={7}
                maxLength={20000}
                placeholder="请输入详细正文。支持 Markdown 格式，支持段落与论据引用。"
                value={manualBody}
                onChange={(e) => setManualBody(e.target.value)}
                className="ui-input w-full text-xs font-mono leading-relaxed"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 block">主题类别 / 业务归属</label>
                <input
                  type="text"
                  placeholder="如：大学专业 / 医疗信息 / 学科选校"
                  value={manualTopic}
                  onChange={(e) => setManualTopic(e.target.value)}
                  className="ui-input w-full text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 block">标签 / 话题词</label>
                <input
                  type="text"
                  placeholder="多个标签用空格或逗号分隔，如：医学信息工程 高考志愿 就业前景"
                  value={manualTags}
                  onChange={(e) => setManualTags(e.target.value)}
                  className="ui-input w-full text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200/60">
              <button
                type="button"
                disabled={manualSaving}
                onClick={() => handleCreateManualDraft(false)}
                className="ui-button secondary text-xs"
              >
                💾 仅存为草稿
              </button>
              <button
                type="button"
                disabled={manualSaving}
                onClick={() => handleCreateManualDraft(true)}
                className="ui-button primary text-xs font-bold px-4"
              >
                {manualSaving ? "正在创建..." : "🚀 保存并立即进入发布 →"}
              </button>
            </div>
          </div>
        )}

        {/* 入口 B：AI 智能生成 */}
        {creationEntry === "AI" && (
          <div className="space-y-4 rounded-xl border border-teal-200 bg-teal-50/20 p-5">
            <div className="flex items-center justify-between border-b border-teal-100 pb-3">
              <span className="text-xs font-bold text-teal-900 flex items-center gap-2">
                <span>✨</span> AI 智能生成发布方案
              </span>
              <span className="text-[11px] text-teal-700">
                基于项目真实 GEO 诊断与事实依据，自动契合平台行文风格
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 block">
                  AI 生成引擎 <span className="text-rose-500">*</span>
                </label>
                <select
                  value={aiSelectedProvider}
                  onChange={(e) => setAiSelectedProvider(e.target.value as any)}
                  className="ui-input w-full text-xs bg-white font-medium"
                >
                  <option value="auto">自动选择已配置引擎 (Auto)</option>
                  <option value="deepseek">DeepSeek 官方模型 (真实 AI)</option>
                  <option value="qwen">通义千问 Qwen 官方模型 (真实 AI)</option>
                  <option value="mock">本地 Mock 演示 (模拟模式 · 无需密钥)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 block">
                  目标发布平台 <span className="text-rose-500">*</span>
                </label>
                <select
                  value={aiChannel}
                  onChange={(e) => setAiChannel(e.target.value)}
                  className="ui-input w-full text-xs bg-white"
                >
                  {Object.entries(CHANNEL_PLATFORM_CONFIG).map(([k, conf]) => (
                    <option key={k} value={k}>
                      {conf.icon} {conf.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 block">内容基调与视角</label>
                <select
                  value={aiTone}
                  onChange={(e) => setAiTone(e.target.value)}
                  className="ui-input w-full text-xs bg-white"
                >
                  <option value="PROFESSIONAL">专业深度科普（客观严谨、事实论证、技术架构）</option>
                  <option value="EXPERIENCE">真实体验种草（亲历实测、使用心得、实用避坑）</option>
                  <option value="AUTHORITATIVE">官方权威解答（产品全景、行业选型、白皮书指南）</option>
                  <option value="COMMERCIAL">商业决策对比（选型矩阵、成本效益、场景评估）</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 block">关联诊断（可选）</label>
                <select
                  value={aiSelectedDiagId}
                  onChange={(e) => setAiSelectedDiagId(e.target.value)}
                  className="ui-input w-full text-xs bg-white"
                >
                  <option value="">不关联特定诊断（自主输入诉求）</option>
                  {diagnosesList.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} · {d.findingCount} 条发现
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 block">
                  品牌 / 产品名称（可选）
                </label>
                <input
                  type="text"
                  maxLength={100}
                  placeholder="留空则自动继承项目监测品牌（例如：瑞幸咖啡）"
                  value={aiBrandName}
                  onChange={(e) => setAiBrandName(e.target.value)}
                  className="ui-input w-full text-xs bg-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 block">
                  补充撰写需求 / Brief（可选）
                </label>
                <input
                  type="text"
                  maxLength={300}
                  placeholder="例如：突出高性价比、生椰/拿铁经典款对比、早八人提神与自取便利性"
                  value={aiBrief}
                  onChange={(e) => setAiBrief(e.target.value)}
                  className="ui-input w-full text-xs bg-white"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 block">
                核心主题 / 目标解答的低覆盖搜索词 <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                maxLength={200}
                placeholder="例如：瑞幸咖啡适合哪些消费场景，以及如何根据不同需求选择咖啡产品"
                value={aiTopic}
                onChange={(e) => setAiTopic(e.target.value)}
                className="ui-input w-full text-xs bg-white"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-slate-500">
                {aiSelectedProvider === "mock"
                  ? "当前处于【本地 Mock 演示】模式，生成演示模拟正文；切换真实 AI 可调用真实外部大模型。"
                  : "调用项目 AI Gateway 请求真实大模型生成完整长文。生成后可直接编辑调整，确认前不会向任何外部平台发送。"}
              </span>
              <button
                type="button"
                disabled={aiDraftGenerating || !aiTopic.trim()}
                onClick={handleGenerateAiDraft}
                className="ui-button primary text-xs font-bold px-5 py-2"
              >
                {aiDraftGenerating ? "正在调用 AI 生成完整文章中..." : "✨ 立即生成完整文章"}
              </button>
            </div>

            {/* AI 生成预览与微调确认卡片 */}
            {aiGeneratedDraft && (
              <div className="mt-4 rounded-xl border border-teal-300 bg-white p-4 space-y-3.5 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-2">
                    {aiDraftResultMeta?.requestedProvider === "mock" || aiDraftResultMeta?.provider === "mock" ? (
                      <span className="rounded bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 border border-amber-200">
                        本地 Mock 演示模拟
                      </span>
                    ) : (
                      <span className="rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 border border-emerald-200">
                        真实 AI 模型 ({aiDraftResultMeta?.model || aiDraftResultMeta?.provider})
                      </span>
                    )}
                    <span className="text-xs font-bold text-slate-900">完整文章已生成（请核对并微调）</span>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    正文 {aiGeneratedDraft.body.length} 字 · 耗时 {aiDraftResultMeta?.latencyMs || 0}ms · 消耗 Token {aiDraftResultMeta?.totalTokens || "—"}
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">文章标题</label>
                    <input
                      type="text"
                      className="ui-input w-full text-xs font-semibold"
                      value={aiGeneratedDraft.title}
                      onChange={(e) =>
                        setAiGeneratedDraft((prev) => (prev ? { ...prev, title: e.target.value } : prev))
                      }
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-semibold text-slate-700">完整正文 (Markdown 格式)</label>
                      <span className="text-[11px] text-slate-400">当前正文共 {aiGeneratedDraft.body.length} 字</span>
                    </div>
                    <textarea
                      rows={14}
                      className="ui-input w-full text-xs font-mono leading-relaxed"
                      value={aiGeneratedDraft.body}
                      onChange={(e) =>
                        setAiGeneratedDraft((prev) => (prev ? { ...prev, body: e.target.value } : prev))
                      }
                    />
                  </div>

                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">推荐话题与标签</label>
                    <input
                      type="text"
                      className="ui-input w-full text-xs"
                      value={aiGeneratedDraft.tags.join(" ")}
                      onChange={(e) =>
                        setAiGeneratedDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                tags: e.target.value.split(/\s+/).map((t) => t.replace(/#/g, "")).filter(Boolean),
                              }
                            : prev,
                        )
                      }
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setAiGeneratedDraft(null)}
                    className="ui-button secondary text-xs"
                  >
                    放弃此方案
                  </button>
                  <button
                    type="button"
                    disabled={aiAdopting || !aiGeneratedDraft.body.trim()}
                    onClick={handleAdoptAiDraft}
                    className="ui-button primary text-xs font-bold px-4"
                  >
                    {aiAdopting ? "正在采纳..." : "✅ 采纳并立即进入发布 →"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 入口 C：选择已有草稿 */}
        {creationEntry === "EXISTING" && (
          <div className="space-y-4">
            {drafts.length === 0 ? (
              <EmptyState
                title="暂无可用草稿"
                description="当前项目尚未创建任何内容草稿，请切换至【手工录入】或【AI 智能生成】快速创建第一篇。"
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
                  <div className="md:col-span-2 rounded-xl bg-slate-50 border border-slate-200/80 p-4 space-y-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 text-sm">{currentDraft.title}</span>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={currentDraft.status} />
                        <span className="text-[11px] text-slate-500 font-mono">
                          v{currentDraft.latestRevision?.version || 1}
                        </span>
                      </div>
                    </div>
                    <p className="text-slate-600 line-clamp-2 leading-relaxed">
                      {currentDraft.latestRevision?.body || "（暂无正文）"}
                    </p>
                    <div className="flex items-center justify-between gap-3 text-[11px] text-slate-500 pt-2 border-t border-slate-200/60">
                      <span>主题：{currentDraft.topic || "综合分发"}</span>
                      <span>模式：{currentDraft.generationMode}</span>
                      <Link
                        href={`/app/content/${currentDraft.id}`}
                        className="text-teal-700 font-medium hover:underline ml-auto"
                      >
                        在全功能编辑器中查看 →
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ============================================================== */}
      {/* 步骤 2：选择发布方式与平台（本地自动化助手 vs 纯人工指引） */}
      {/* ============================================================== */}
      <section className="space-y-4">
        {/* 发布方式 Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
              2
            </span>
            <h2 className="text-base font-bold text-slate-900">选择发布方式与执行平台</h2>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPublishingMode("BROWSER_ASSISTED")}
              className={`flex items-center gap-1.5 py-2 px-4 rounded-xl text-xs font-bold transition border ${
                publishingMode === "BROWSER_ASSISTED"
                  ? "border-blue-600 bg-blue-50 text-blue-700 shadow-xs ring-1 ring-blue-500/20"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              <span>🌐</span>
              <span>浏览器辅助发布 (Selenium V2A)</span>
              <span className="text-[9px] bg-blue-200 text-blue-800 px-1.5 py-0.2 rounded-full font-bold">
                自动化
              </span>
            </button>

            <button
              type="button"
              onClick={() => setPublishingMode("MANUAL_GUIDE")}
              className={`flex items-center gap-1.5 py-2 px-4 rounded-xl text-xs font-bold transition border ${
                publishingMode === "MANUAL_GUIDE"
                  ? "border-teal-600 bg-teal-50 text-teal-800 shadow-xs ring-1 ring-teal-500/20"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              <span>🧭</span>
              <span>纯人工发布精准指引</span>
              <span className="text-[9px] bg-teal-200 text-teal-800 px-1.5 py-0.2 rounded-full font-bold">
                高合规
              </span>
            </button>

            <button
              type="button"
              onClick={() => setPublishingMode("BATCH_MATRIX")}
              className={`flex items-center gap-1.5 py-2 px-3 rounded-xl text-xs font-medium transition border ${
                publishingMode === "BATCH_MATRIX"
                  ? "border-indigo-600 bg-indigo-50 text-indigo-700 shadow-xs"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
              }`}
            >
              <span>📋</span>
              <span>多渠道批量矩阵 (V1)</span>
            </button>
          </div>
        </div>

        {/* 方式 1: 本地受控浏览器辅助发布 (Selenium V2A) */}
        {publishingMode === "BROWSER_ASSISTED" && (
          <BrowserAssistedPanel
            projectId={projectId}
            selectedDraft={currentDraft}
            channels={channels}
            activeChannelKey={activeAssistedChannel}
            onChannelSelect={setActiveAssistedChannel}
            onPublicationUpdated={() => loadPublications(1)}
          />
        )}

        {/* 方式 2: 纯人工发布精准指引 (Manual Publishing Guidance) */}
        {publishingMode === "MANUAL_GUIDE" && (
          <div className="surface p-6 space-y-6 rounded-2xl border border-slate-200/80 bg-white shadow-xs">
            {/* 平台选择 Pills */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">选择要发布的目标平台：</span>
                <span className="text-[11px] text-slate-400">
                  支持一键直达官方创作者页面、字段精准复制与事后回填落成 GEO 资产
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(CHANNEL_PLATFORM_CONFIG).map(([k, conf]) => {
                  const isCur = activeManualChannel === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setActiveManualChannel(k)}
                      className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition border ${
                        isCur
                          ? "border-teal-600 bg-teal-50 text-teal-900 shadow-xs ring-1 ring-teal-500/30"
                          : "border-slate-200 bg-slate-50/50 text-slate-600 hover:border-slate-300 hover:bg-slate-100"
                      }`}
                    >
                      <span className="text-sm">{conf.icon}</span>
                      <span>{conf.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 当前平台的指引主体卡片 */}
            {(() => {
              const conf = CHANNEL_PLATFORM_CONFIG[activeManualChannel] || CHANNEL_PLATFORM_CONFIG.ZHIHU;
              const draftTitle = currentDraft?.title || "（暂无标题）";
              const draftBody = currentDraft?.latestRevision?.body || "（暂无正文）";
              const draftTags = currentDraft?.topic
                ? [currentDraft.topic]
                : ["GEO优选", "事实证据"];

              return (
                <div className="space-y-5 rounded-xl border border-slate-200 bg-slate-50/40 p-5">
                  {/* 头部：平台名 + 创作者中心直达 */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl">{conf.icon}</span>
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">{conf.label} 创作者发布指引</h3>
                        <p className="text-xs text-slate-500">{conf.description}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <a
                        href={conf.creatorUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 shadow-sm flex items-center gap-1.5"
                      >
                        <span>打开 {conf.label} 创作页面</span>
                        <span>↗</span>
                      </a>
                    </div>
                  </div>

                  {/* 字段映射卡片流 */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* 字段 1：文章/笔记标题 */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-bold text-slate-800 flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-teal-500" />
                            【文章/笔记标题】对应字段
                          </span>
                          <span className="text-[11px] text-slate-400 font-mono">{draftTitle.length} 字</span>
                        </div>
                        <p className="text-[11px] text-slate-500 mb-2">{conf.titleFieldGuide}</p>
                        <div className="rounded-lg bg-slate-50 p-2.5 text-xs font-medium text-slate-800 border border-slate-100 select-all">
                          {draftTitle}
                        </div>
                      </div>
                      <div className="pt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => copyText(draftTitle, "标题")}
                          className="ui-button secondary text-xs py-1 px-3"
                        >
                          📄 一键复制标题
                        </button>
                      </div>
                    </div>

                    {/* 字段 2：标签/话题词 */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-bold text-slate-800 flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-blue-500" />
                            【话题 / 标签】对应字段
                          </span>
                          <span className="text-[11px] text-slate-400 font-mono">{draftTags.length} 个标签</span>
                        </div>
                        <p className="text-[11px] text-slate-500 mb-2">{conf.tagsFieldGuide}</p>
                        <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-slate-50 border border-slate-100 min-h-10 items-center">
                          {draftTags.map((t, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 border border-blue-200"
                            >
                              #{t}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="pt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => copyText(draftTags.map((t) => `#${t}`).join(" "), "话题标签")}
                          className="ui-button secondary text-xs py-1 px-3"
                        >
                          🏷️ 一键复制全部标签
                        </button>
                      </div>
                    </div>

                    {/* 字段 3：正文内容 */}
                    <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-4 space-y-2">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-bold text-slate-800 flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-emerald-500" />
                          【正文与排版】对应字段
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">{draftBody.length} 字</span>
                      </div>
                      <p className="text-[11px] text-slate-500">{conf.bodyFieldGuide}</p>
                      <div className="max-h-44 overflow-y-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700 border border-slate-100 font-mono whitespace-pre-wrap leading-relaxed select-all">
                        {draftBody}
                      </div>
                      <div className="pt-2 flex items-center justify-between">
                        <span className="text-[11px] text-slate-400">
                          可直接点击右侧按钮复制完整正文，然后粘贴至平台富文本框
                        </span>
                        <button
                          type="button"
                          onClick={() => copyText(draftBody, "正文内容")}
                          className="ui-button primary text-xs py-1.5 px-4 font-bold"
                        >
                          📝 一键复制完整正文
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 平台规则 Checklist & 闭环行动栏 */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-2">
                    <div className="lg:col-span-2 rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-2">
                      <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                        <span>🛡️</span> {conf.label} 平台合规与审核要点
                      </span>
                      <ul className="space-y-1.5 text-xs text-amber-800">
                        {conf.guidelines.map((rule, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="text-[11px] font-bold text-amber-600">·</span>
                            <span className="leading-relaxed">{rule}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 flex flex-col justify-between">
                      <div className="space-y-1">
                        <span className="text-xs font-bold text-slate-900 block">完成人工发布了吗？</span>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          在 {conf.label} 点击发布并获取公开链接后，请回填地址，系统将立即沉淀为 GEO
                          监测资产并进入定期效果再测。
                        </p>
                      </div>

                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => handleCreateSingleManualTask(activeManualChannel)}
                          className="w-full rounded-lg bg-teal-600 px-3 py-2 text-xs font-bold text-white hover:bg-teal-700 shadow-sm flex items-center justify-center gap-1.5"
                        >
                          <span>✨</span>
                          <span>已发布？回填公开落地链接</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const manualPkg: ManualPublishingPackage = {
                              channel: activeManualChannel,
                              title: draftTitle,
                              body: draftBody,
                              hashtags: draftTags,
                              checklist: conf.guidelines,
                              assetManifest: [],
                              videoScript: null,
                              callToAction: "欢迎在评论区或正文中留下您的见解或进行进一步咨询。",
                              generatedAt: new Date().toISOString(),
                            };
                            downloadManualPackage(manualPkg, activeManualChannel);
                          }}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-1"
                        >
                          <span>💾</span>
                          <span>下载发布包 JSON</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* 方式 3: 多渠道批量分发中心 (高级矩阵) */}
        {publishingMode === "BATCH_MATRIX" && (
          <div className="space-y-6">
            <section className="surface p-5 space-y-4 rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <span>🌐</span> 目标渠道矩阵勾选与模式设置
                  </h3>
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
                    description: ch.description,
                  };
                  const selection = channelSelections[ch.channel] || { selected: false, mode: "MANUAL" };
                  const isSelected = selection.selected;

                  return (
                    <div
                      key={ch.channel}
                      className={`rounded-xl border p-3.5 transition-all flex flex-col justify-between ${
                        isSelected
                          ? "border-teal-600 bg-teal-50/20 shadow-xs ring-1 ring-teal-500/30"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <div className="space-y-2.5">
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

                        <p className="text-[11px] text-slate-500 leading-normal line-clamp-2">
                          {ch.description}
                        </p>
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          {ch.supportsAuto && ch.connected ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setChannelMode(ch.channel, "AUTO")}
                                className={`text-[11px] px-2 py-0.5 rounded font-semibold ${
                                  selection.mode === "AUTO"
                                    ? "bg-teal-700 text-white"
                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                }`}
                              >
                                自动
                              </button>
                              <button
                                type="button"
                                onClick={() => setChannelMode(ch.channel, "MANUAL")}
                                className={`text-[11px] px-2 py-0.5 rounded font-semibold ${
                                  selection.mode === "MANUAL"
                                    ? "bg-slate-800 text-white"
                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                }`}
                              >
                                人工
                              </button>
                            </div>
                          ) : ch.supportsAuto && !ch.connected ? (
                            <span className="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                              未连接账号（仅人工）
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">仅支持人工辅助</span>
                          )}

                          {selection.mode === "AUTO" && ch.autoCapability !== "DRAFT_ONLY" && (
                            <select
                              value={selection.targetStatus || "publish"}
                              onChange={(e) =>
                                setChannelTargetStatus(ch.channel, e.target.value as "draft" | "publish")
                              }
                              className="text-[10px] bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5"
                            >
                              <option value="publish">直接发布</option>
                              <option value="draft">存草稿箱</option>
                            </select>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 多端变体预览与微调 */}
            {selectedChannelsList.length > 0 && (
              <section className="surface p-5 space-y-4 rounded-xl border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <span>🎨</span> 多端变体预览与排版微调
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      规则预览会立即填入编辑区。AI 适配需要单独生成，并在确认后才写入编辑区。
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                      <input
                        type="checkbox"
                        checked={aiUseReal}
                        disabled={!realAiAvailable || aiRunning}
                        onChange={(e) => setAiUseReal(e.target.checked)}
                      />
                      <span>{realAiAvailable ? "启用真实模型（产生 API 费用）" : "真实模型未配置（仅模拟）"}</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => handleAiAdapt(false)}
                      disabled={aiRunning}
                      className="ui-button primary text-xs py-1.5 px-3"
                    >
                      {aiRunning ? "正在生成渠道适配..." : aiUseReal ? "AI 生成（真实付费）" : "AI 生成（本地模拟）"}
                    </button>
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
                          {channelLimitsMap[activePreviewChannel] && (
                            <span
                              className={`text-[11px] ${
                                (editedContent[activePreviewChannel]?.title?.length || 0) >
                                channelLimitsMap[activePreviewChannel]!.title
                                  ? "text-rose-600 font-bold"
                                  : "text-slate-400"
                              }`}
                            >
                              {editedContent[activePreviewChannel]?.title?.length || 0}/
                              {channelLimitsMap[activePreviewChannel]!.title} 字
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
                        <div className="flex items-center justify-between text-xs">
                          <label className="font-semibold text-slate-700">正文与话题</label>
                        </div>
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
                          📝 复制正文
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3.5 bg-white p-4 rounded-xl border border-slate-200/80">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800">📋 人工发布包与素材清单</span>
                        {adaptedResults.find((r) => r.channel === activePreviewChannel)?.manualPackage && (
                          <button
                            type="button"
                            onClick={() =>
                              downloadManualPackage(
                                adaptedResults.find((r) => r.channel === activePreviewChannel)!.manualPackage,
                                activePreviewChannel,
                              )
                            }
                            className="text-xs text-teal-700 hover:underline font-semibold"
                          >
                            💾 下载发布包 JSON
                          </button>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                          操作指引
                        </span>
                        <ul className="space-y-1 text-xs text-slate-700">
                          {(
                            adaptedResults.find((r) => r.channel === activePreviewChannel)?.manualPackage?.checklist || [
                              "登录平台创作者中心。",
                              "复制左侧标题与正文至输入框。",
                              "预览无误后提交发布。",
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
                  <div className="text-xs text-slate-500 space-y-1">
                    <div>
                      将向 <strong className="text-slate-900">{selectedChannelsList.length}</strong> 个渠道提交任务。
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={distributing || selectedChannelsList.length === 0 || manualLimitViolations.length > 0}
                    onClick={handleBatchDistribute}
                    className="ui-button primary text-xs px-6 py-2.5 font-bold shadow-md"
                  >
                    {distributing ? "正在批量分发中..." : `🚀 一键批量分发 (${selectedChannelsList.length} 个渠道)`}
                  </button>
                </div>
              </section>
            )}
          </div>
        )}
      </section>

      {/* ============================================================== */}
      {/* 步骤 3：分发执行看板与真实落地资产 */}
      {/* ============================================================== */}
      <section className="surface p-6 space-y-4 rounded-2xl border border-slate-200/80 bg-white shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white">
                3
              </span>
              <h2 className="text-base font-bold text-slate-900">分发执行看板与真实落地资产</h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              监控已发布或人工待发布任务，回填真实公开链接后将落成 PublishedAsset，并进入 GEO 事实复测与归因闭环。
            </p>
          </div>
          <button
            type="button"
            onClick={() => loadPublications(currentPage)}
            disabled={loadingPubs}
            className="ui-button secondary text-xs"
          >
            {loadingPubs ? "刷新中..." : "🔄 刷新看板"}
          </button>
        </div>

        {publications.length === 0 ? (
          <EmptyState
            title="暂无分发任务记录"
            description="完成上方的发布步骤后，将在此处实时展示任务执行进度与落地资产证据。"
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
                  const isManualMode = pub.mode === "MANUAL" || pub.attempts?.some((a) => a.publisher === "manual_assisted");
                  const isMockRun = Boolean(pub.isMock || pub.attempts?.some((a: any) => a.isMock || a.metadata?.isMock));

                  return (
                    <tr key={pub.id} className="hover:bg-slate-50/50 transition">
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{conf.icon}</span>
                          <div>
                            <div className="font-semibold text-slate-900">{conf.label}</div>
                            <div className="text-[10px] flex items-center gap-1">
                              <span className={isManualMode ? "text-amber-700 font-medium" : "text-teal-700 font-medium"}>
                                {isManualMode ? "人工发布" : "自动发布"}
                              </span>
                              {isMockRun && (
                                <span className="text-[9px] px-1 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                                  (模拟)
                                </span>
                              )}
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
                            <span className="block text-[10px] text-blue-600 font-medium">
                              {isMockRun ? "[模拟草稿箱就绪]" : "[官方草稿箱就绪]"}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-3 max-w-xs">
                        {asset ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                              ✨ 已落地 GEO 资产
                            </span>
                            {asset.canonicalUrl && (
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
                        ) : isPublished ? (
                          <div className="text-[11px] text-slate-600">
                            {isMockRun ? "模拟回执，未生成真实公开资产" : "已发布至平台（未关联独立落地资产）"}
                          </div>
                        ) : isExternalDraft ? (
                          <div className="text-[11px] text-slate-600">
                            {isMockRun ? "已在模拟沙箱中存放至草稿箱" : "已安全存放至官方草稿箱"}
                          </div>
                        ) : isFailed ? (
                          <div className="text-[11px] text-rose-600 truncate" title={latestAttempt?.errorMessage || ""}>
                            {latestAttempt?.errorMessage || "发布遇到错误"}
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-400">
                            待前往平台发布并回填真实访问链接
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 text-slate-500 text-[11px]">
                        {new Date(pub.createdAt).toLocaleDateString()}
                      </td>

                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {!isPublished && (
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmModalPub(pub);
                                setBackfillUrl("");
                                setBackfillAssetId("");
                                setBackfillPublishedAt(toLocalDatetimeString());
                                setConfirmError(null);
                              }}
                              className="ui-button primary text-[11px] py-1 px-2.5 font-semibold"
                            >
                              回填确认
                            </button>
                          )}

                          {isFailed && (
                            <button
                              type="button"
                              onClick={() => handleRetry(pub.id)}
                              className="ui-button secondary text-[11px] py-1 px-2"
                            >
                              重试
                            </button>
                          )}

                          <a
                            href={conf.creatorUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="ui-button secondary text-[11px] py-1 px-2"
                            title="前往平台创作者后台"
                          >
                            直达 ↗
                          </a>

                          {isPublished && asset && (
                            <Link
                              href="/app/content/verification"
                              className="ui-button secondary text-[11px] py-1 px-2 text-teal-700 font-semibold"
                              title="前往 GEO 效果复测与归因工作台"
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

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <div>
                第 {currentPage} 页 / 共 {Math.max(1, Math.ceil(totalPubs / pageSize))} 页 (共 {totalPubs} 条记录)
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage <= 1 || loadingPubs}
                  onClick={() => loadPublications(currentPage - 1)}
                  className="ui-button secondary text-xs py-1 px-3 disabled:opacity-50"
                >
                  上一页
                </button>
                <button
                  type="button"
                  disabled={currentPage >= Math.ceil(totalPubs / pageSize) || loadingPubs}
                  onClick={() => loadPublications(currentPage + 1)}
                  className="ui-button secondary text-xs py-1 px-3 disabled:opacity-50"
                >
                  下一页
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 人工发布回填确认 Modal */}
      {confirmModalPub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="surface max-w-lg w-full p-6 space-y-4 rounded-2xl shadow-2xl animate-fade-in bg-white border border-slate-200">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  确认发布结果（落成 PublishedAsset 资产）
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
                  placeholder="如 https://zhuanlan.zhihu.com/p/... 或 https://www.xiaohongshu.com/explore/..."
                  className="ui-input w-full text-xs"
                  value={backfillUrl}
                  onChange={(e) => setBackfillUrl(e.target.value)}
                />
                <span className="text-[11px] text-slate-400">公开可访问的完整网址，用于 GEO 搜索引擎检索与事实复测。</span>
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
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-700 block">实际发布时间</label>
                  <button
                    type="button"
                    onClick={() => setBackfillPublishedAt("")}
                    className="text-[11px] text-slate-400 hover:text-slate-700 underline"
                  >
                    清空时间
                  </button>
                </div>
                <input
                  type="datetime-local"
                  className="ui-input w-full text-xs"
                  value={backfillPublishedAt}
                  onChange={(e) => setBackfillPublishedAt(e.target.value)}
                />
                <span className="text-[10px] text-slate-400">若不清空将作为 GEO 事实再测基准时间。</span>
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
