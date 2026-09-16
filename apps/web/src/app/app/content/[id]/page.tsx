"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useProjectContext } from "@/components/project-context";
import { EmptyState, ErrorState, LoadingSkeleton, StatusBadge } from "@/components/ui";
import { friendlyError } from "@/lib/labels";
import {
  createPublication,
  decideContentDraft,
  getContentDraft,
  listChannelCapabilities,
  listChannelConnections,
  listContentAudit,
  submitContentDraft,
  updateContentDraft,
  generatePlatformVariant,
  listPlatformVariants,
  rewritePlatformVariant,
  applyVariantToRevision,
  generateImageBriefs,
  listImageBriefs,
  listGenerationRuns,
  listVerifiedFacts,
  createVerifiedFact,
  extractClaims,
  safeRewrite,
  generateImagePreview,
  acceptImageAsset,
  listContentAssets,
  type Approval,
  type AuditEntry,
  type Capability,
  type Connection,
  type Decision,
  type Draft,
  type Publication,
  type PlatformType,
  type PlatformVariant,
  type ContentImageBriefRecord,
  type VerifiedFact,
  type ExtractedClaim,
  type ClaimCheckResult,
  type SafeRewriteResult,
  type GenerationRun,
  type ImagePreviewOutput,
  type Asset,
} from "@/lib/content-api";

const channelLabel: Record<string, string> = {
  XIAOHONGSHU: "小红书",
  DOUYIN: "抖音",
  WEIBO: "微博",
  WECHAT: "微信",
  BAIDU: "百度",
  OTHER: "其他",
};

const auditLabel: Record<string, string> = {
  DRAFT_CREATED: "创建草稿",
  DRAFT_UPDATED: "创建版本",
  SUBMITTED_FOR_REVIEW: "提交审核",
  APPROVED: "批准",
  REJECTED: "拒绝",
  CHANGES_REQUESTED: "要求修改",
  PUBLICATION_CREATED: "创建发布",
  PUBLISHED: "发布成功",
  FAILED: "发布失败",
  VARIANT_APPLIED: "应用平台版本",
};

const CN_PLATFORMS: { id: PlatformType; name: string; icon: string; desc: string; ratio: string }[] = [
  { id: "WECHAT_OFFICIAL_ACCOUNT", name: "微信公众号", icon: "💬", desc: "深度图文长文 · 完整论据拆解与深度版式", ratio: "900:383" },
  { id: "XIAOHONGSHU", name: "小红书", icon: "📕", desc: "图文种草笔记 · 视觉抓手、痛点痛击与干货打卡", ratio: "3:4" },
  { id: "WEIBO", name: "微博", icon: "🌐", desc: "短图文快讯 · 核心爆点、观点讨论与高传播力", ratio: "1:1" },
  { id: "DOUYIN", name: "抖音", icon: "🎵", desc: "60秒竖屏短视频脚本 · 黄金3秒抓手与分镜头", ratio: "9:16" },
  { id: "BILIBILI", name: "Bilibili (B站)", icon: "📺", desc: "长视频大纲与专栏 · 兼顾知识深度、弹幕梗与硬核参数", ratio: "16:9" },
];

const REWRITE_OPTIONS = [
  { mode: "FACT_SAFE", label: "事实安全纠偏", desc: "自动净化未验证或夸大声明，中立合规" },
  { mode: "MORE_NEUTRAL", label: "更加客观中立", desc: "弱化主观吹捧，平衡评价产品特性" },
  { mode: "REWRITE_EXPAND", label: "深度扩写", desc: "扩充细节案例与硬核论据" },
  { mode: "REWRITE_SHORTEN", label: "精简凝练", desc: "剔除冗余修饰，直击核心痛点" },
  { mode: "REWRITE_PROFESSIONAL", label: "提升专业度", desc: "强化客观数据与技术论证" },
  { mode: "REWRITE_CONVERSATIONAL", label: "更口语接地气", desc: "生动活泼，拉近受众距离" },
  { mode: "REWRITE_LOW_PROMO", label: "弱化营销感", desc: "以客观第三方测评视角呈现产品" },
  { mode: "REWRITE_STRONG_CTA", label: "强化行动号召", desc: "激发读者互动、点赞与留资" },
  { mode: "TUTORIAL", label: "实操步骤教程", desc: "保姆级分步骤操作说明与避坑指南" },
  { mode: "COMPARISON", label: "竞品对比评测", desc: "多维对照表与场景适配选购指南" },
  { mode: "FAQ", label: "常见问答结构", desc: "针对用户核心疑虑与高频问题答疑" },
];

const GENERATION_MODES = [
  { mode: "STANDARD", label: "标准平台适配", desc: "基于平台生态调性定向重构" },
  { mode: "REWRITE_STYLE_TUTORIAL", label: "实操步骤教程", desc: "结构化保姆级操作步骤" },
  { mode: "REWRITE_STYLE_RECOMMENDATION", label: "真诚种草测评", desc: "场景化体验与痛点解决" },
  { mode: "REWRITE_PROFESSIONAL", label: "技术深度评测", desc: "硬核参数解析与横向对照" },
];

const IMAGE_STYLES = [
  { style: "TECH", label: "科技未来感", desc: "数码光影、冷色调微距特写" },
  { style: "FRESH", label: "清新生活风", desc: "自然明亮光感、居家温馨氛围" },
  { style: "PROFESSIONAL", label: "严谨专业风", desc: "极简白底、数据标注与图表结构" },
  { style: "COMPARISON", label: "对比评测风", desc: "红蓝对比、参数对抗高反差构图" },
  { style: "TUTORIAL", label: "实操步骤风", desc: "编号指示、手部动作与细节放大" },
];

const RATIO_OPTIONS = [
  { ratio: "900:383", label: "900:383 (微信封面)" },
  { ratio: "3:4", label: "3:4 (小红书笔记)" },
  { ratio: "1:1", label: "1:1 (微博正方图)" },
  { ratio: "9:16", label: "9:16 (抖音竖屏)" },
  { ratio: "16:9", label: "16:9 (B站专栏)" },
];

const CLAIM_CATEGORY_LABELS: Record<string, string> = {
  NUMERICAL_SPEC: "数值规格",
  COMPARATIVE_RANKING: "排名对比",
  HEALTH_MEDICAL: "医疗健康",
  SUPERLATIVE: "极限绝对词",
  GENERAL: "一般断言",
};

const FACT_TYPE_LABELS: Record<string, string> = {
  SPEC: "数值规格 (SPEC)",
  FEATURE: "产品特性 (FEATURE)",
  CERTIFICATION: "资质认证 (CERTIFICATION)",
  PRICE: "价格方案 (PRICE)",
  COMPATIBILITY: "系统兼容 (COMPATIBILITY)",
};

type WorkbenchTab = "ai-gen" | "fact-check" | "image-gen" | "runs-history" | "draft-editor";

export default function ContentDraftDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { projectId } = useProjectContext();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [caps, setCaps] = useState<Capability[]>([]);
  const [variants, setVariants] = useState<PlatformVariant[]>([]);
  const [imageBriefs, setImageBriefs] = useState<ContentImageBriefRecord[]>([]);
  const [draftAssets, setDraftAssets] = useState<Asset[]>([]);

  // V2 核心状态：工作台标签
  const [activeTab, setActiveTab] = useState<WorkbenchTab>("ai-gen");

  // V2 AI 生成状态
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformType>("WECHAT_OFFICIAL_ACCOUNT");
  const [genMode, setGenMode] = useState("STANDARD");
  const [selectedRewriteMode, setSelectedRewriteMode] = useState("FACT_SAFE");
  const [rewriteInstructions, setRewriteInstructions] = useState("");

  // V2 事实检查与声明守卫状态
  const [verifiedFacts, setVerifiedFacts] = useState<VerifiedFact[]>([]);
  const [claimCheckResult, setClaimCheckResult] = useState<ClaimCheckResult | null>(null);
  const [extractingClaims, setExtractingClaims] = useState(false);
  const [safeRewriting, setSafeRewriting] = useState(false);
  const [safeRewriteSummary, setSafeRewriteSummary] = useState<SafeRewriteResult | null>(null);
  const [newClaim, setNewClaim] = useState("");
  const [newFactType, setNewFactType] = useState("SPEC");
  const [newSourceRef, setNewSourceRef] = useState("");
  const [addingFact, setAddingFact] = useState(false);
  const [claimFilter, setClaimFilter] = useState<"ALL" | "UNVERIFIED" | "CONFLICTING" | "VERIFIED">("ALL");

  // V2 图片生成状态
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageRatio, setImageRatio] = useState("900:383");
  const [imageStyle, setImageStyle] = useState("TECH");
  const [imageMainTitle, setImageMainTitle] = useState("");
  const [imageSubtitle, setImageSubtitle] = useState("");
  const [imageBadge, setImageBadge] = useState("");
  const [imagePreview, setImagePreview] = useState<ImagePreviewOutput | null>(null);
  const [generatingPreview, setGeneratingPreview] = useState(false);
  const [acceptingAsset, setAcceptingAsset] = useState(false);
  const [acceptedAsset, setAcceptedAsset] = useState<Asset | null>(null);

  // V2 生成历史状态
  const [generationRuns, setGenerationRuns] = useState<GenerationRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  // 通用状态
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [generatingVariants, setGeneratingVariants] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [generatingBriefs, setGeneratingBriefs] = useState(false);

  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);

  const [comment, setComment] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [publication, setPublication] = useState<Publication | null>(null);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [body, setBody] = useState("");
  const [summary, setSummary] = useState("");

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const d = await getContentDraft(id);
      setDraft(d);
      setTitle(d.title);
      setTopic(d.topic ?? "");
      setSummary(d.latestRevision?.summary ?? "");
      setBody(d.latestRevision?.body ?? "");

      const [a, c, k, v, b, f, r, assetsPage] = await Promise.all([
        listContentAudit(id),
        listChannelConnections(d.projectId),
        listChannelCapabilities(),
        listPlatformVariants(id),
        listImageBriefs(id),
        listVerifiedFacts(id),
        listGenerationRuns(id),
        listContentAssets(d.projectId, 1, 50).catch(() => ({ items: [] as Asset[] })),
      ]);
      setAudit(a);
      setConnections(c);
      setCaps(k);
      setVariants(v);
      setImageBriefs(b);
      setVerifiedFacts(f);
      setGenerationRuns(r);
      setDraftAssets((assetsPage.items || []).filter((item) => item.draftId === id));
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [id]);

  const latest = draft?.latestRevision;
  const currentApproval = useMemo<Approval | null>(
    () => draft?.approvals?.find((a) => a.revisionId === latest?.id) ?? null,
    [draft, latest]
  );
  const connected = connections.filter((c) => c.status === "CONNECTED");
  const locked = draft?.status === "PUBLISHED" || draft?.status === "ARCHIVED";

  // 当前选中平台的最新版本
  const currentPlatformVariant = useMemo(() => {
    return variants.find((v) => v.platform === selectedPlatform) ?? null;
  }, [variants, selectedPlatform]);

  // 当前平台对应的生图 Brief 列表
  const currentPlatformBriefs = useMemo(() => {
    return imageBriefs.filter((b) => b.platform === selectedPlatform);
  }, [imageBriefs, selectedPlatform]);

  // 当切换选中平台时，同步默认生图比例
  useEffect(() => {
    const p = CN_PLATFORMS.find((item) => item.id === selectedPlatform);
    if (p) {
      setImageRatio(p.ratio);
    }
  }, [selectedPlatform]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      await updateContentDraft(id, { title, topic, body, summary, changeNote: "手动编辑保存" });
      await loadData();
      setSuccessMsg("草稿已成功保存为新版本。");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await submitContentDraft(id);
      await loadData();
      setSuccessMsg("已提交至审核流程。");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: Decision) {
    setBusy(true);
    setError("");
    try {
      await decideContentDraft(id, decision, comment, latest?.id);
      setComment("");
      await loadData();
      setSuccessMsg(
        `审核操作完成：${decision === "APPROVED" ? "已批准" : decision === "REJECTED" ? "已拒绝" : "已要求修改"}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("FACT_CHECK_REQUIRED")) {
        setError(
          "⚠️ 审批已被事实守卫拦截：草稿中包含未核验的数值、极限词或功效声明。请在「事实核查守卫」中完成安全改写或补充已核验事实后再批准！"
        );
        setActiveTab("fact-check");
      } else {
        setError(friendlyError(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!draft || !latest || !connectionId) return;
    setBusy(true);
    setError("");
    try {
      setPublication(
        await createPublication(draft.projectId, draft.id, {
          connectionId,
          title: draft.title,
          payload: JSON.stringify({ title: draft.title, body: latest.body, summary: latest.summary }),
        })
      );
      setSuccessMsg("已成功创建发布任务（模拟运行）。");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  // 1. 生成单平台版本
  async function handleGeneratePlatform(platform: PlatformType) {
    setGeneratingVariants(true);
    setError("");
    setSuccessMsg("");
    try {
      const v = await generatePlatformVariant(id, {
        platform,
        generationMode: genMode,
        sourceRevisionId: latest?.id,
      });
      setVariants((prev) => [v, ...prev.filter((item) => item.platform !== platform)]);
      setSelectedPlatform(platform);
      setSuccessMsg(`已成功生成 ${CN_PLATFORMS.find((p) => p.id === platform)?.name ?? platform} 版本文案！`);
      // 重新加载运行历史
      const runs = await listGenerationRuns(id);
      setGenerationRuns(runs);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setGeneratingVariants(false);
    }
  }

  // 2. 一键批量生成全部 5 大平台版本
  async function handleGenerateAllPlatforms() {
    setGeneratingVariants(true);
    setError("");
    setSuccessMsg("");
    try {
      const promises = CN_PLATFORMS.map((p) =>
        generatePlatformVariant(id, {
          platform: p.id,
          generationMode: genMode,
          sourceRevisionId: latest?.id,
        })
      );
      const results = await Promise.all(promises);
      setVariants(results);
      setSuccessMsg("已一键生成全部 5 大平台（微信公众号、小红书、微博、抖音、B站）适配版本！");
      const runs = await listGenerationRuns(id);
      setGenerationRuns(runs);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setGeneratingVariants(false);
    }
  }

  // 3. 基于当前版本改写
  async function handleRewriteVariant() {
    if (!currentPlatformVariant) return;
    setRewriting(true);
    setError("");
    setSuccessMsg("");
    try {
      const rewritten = await rewritePlatformVariant(id, currentPlatformVariant.id, {
        mode: selectedRewriteMode,
        instructions: rewriteInstructions,
      });
      setVariants((prev) => [rewritten, ...prev.filter((item) => item.id !== currentPlatformVariant.id)]);
      setRewriteInstructions("");
      setSuccessMsg(`改写成功！已更新当前 ${CN_PLATFORMS.find((p) => p.id === selectedPlatform)?.name} 版本。`);
      const runs = await listGenerationRuns(id);
      setGenerationRuns(runs);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setRewriting(false);
    }
  }

  // 4. 应用为草稿新版本
  async function handleApplyVariant() {
    if (!currentPlatformVariant) return;
    setApplying(true);
    setError("");
    setSuccessMsg("");
    try {
      const pName = CN_PLATFORMS.find((p) => p.id === selectedPlatform)?.name ?? selectedPlatform;
      await applyVariantToRevision(id, currentPlatformVariant.id, {
        changeNote: `应用 ${pName} 生成版本 (v${(latest?.version ?? 1) + 1})`,
      });
      await loadData();
      setSuccessMsg(`已将 ${pName} 版本成功应用为草稿的最新版本！您可以提交审核或继续润色。`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setApplying(false);
    }
  }

  // 5. 生成图片 Brief
  async function handleGenerateImageBriefs() {
    setGeneratingBriefs(true);
    setError("");
    setSuccessMsg("");
    try {
      const briefs = await generateImageBriefs(id, {
        platform: selectedPlatform,
        variantId: currentPlatformVariant?.id,
        style: imageStyle,
        count: 2,
      });
      setImageBriefs((prev) => [
        ...briefs,
        ...prev.filter(
          (b) => b.platform !== selectedPlatform || (currentPlatformVariant && b.variantId !== currentPlatformVariant.id)
        ),
      ]);
      setSuccessMsg(`已成功为 ${CN_PLATFORMS.find((p) => p.id === selectedPlatform)?.name} 提炼视觉 Brief 方案！`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setGeneratingBriefs(false);
    }
  }

  // 6. 事实检查与声明抽取
  async function handleExtractClaims() {
    setExtractingClaims(true);
    setError("");
    try {
      const res = await extractClaims(id, {
        variantId: currentPlatformVariant?.id,
      });
      setClaimCheckResult(res);
      setSafeRewriteSummary(null);
      if (res.blocking) {
        setError(
          `事实核验提示：检测到 ${res.unverifiedCount} 项未核验声明，已触发阻断。请点击「一键自动安全改写」或录入事实依据。${res.conflictingCount ? `（含 ${res.conflictingCount} 项冲突）` : ""}`
        );
      } else {
        setSuccessMsg("事实核验通过：当前内容所有核心声明均已核验或符合中立安全规范。");
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setExtractingClaims(false);
    }
  }

  // 7. 一键自动安全改写
  async function handleSafeRewrite() {
    setSafeRewriting(true);
    setError("");
    try {
      const res = await safeRewrite(id, {
        variantId: currentPlatformVariant?.id,
      });
      setSafeRewriteSummary(res);
      // 重新加载变体列表和运行记录
      const [updatedVariants, runs] = await Promise.all([listPlatformVariants(id), listGenerationRuns(id)]);
      setVariants(updatedVariants);
      setGenerationRuns(runs);

      // 重新执行声明抽取以验证阻断状态
      const recheck = await extractClaims(id, {
        variantId: currentPlatformVariant?.id,
      });
      setClaimCheckResult(recheck);
      setSuccessMsg("自动安全改写完成！已将未核验的极端词与具体参数转换为客观合规表达。");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSafeRewriting(false);
    }
  }

  // 8. 录入已知事实
  async function handleAddFact(e: React.FormEvent) {
    e.preventDefault();
    if (!newClaim.trim()) return;
    setAddingFact(true);
    setError("");
    try {
      const created = await createVerifiedFact(id, {
        claim: newClaim.trim(),
        factType: newFactType,
        sourceType: "USER_INPUT",
        sourceRef: newSourceRef.trim() || undefined,
      });
      setVerifiedFacts((prev) => [created, ...prev]);
      setNewClaim("");
      setNewSourceRef("");
      setSuccessMsg("已成功录入已核验事实！重新执行事实核查即可匹配此声明。");
      // 重新抽取以自动匹配
      void handleExtractClaims();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setAddingFact(false);
    }
  }

  // 9. 图片生成预览
  async function handleGenerateImagePreview() {
    if (!imagePrompt.trim()) {
      setError("请输入图片生成提示词。");
      return;
    }
    setGeneratingPreview(true);
    setError("");
    setImagePreview(null);
    setAcceptedAsset(null);
    try {
      const preview = await generateImagePreview(id, {
        prompt: imagePrompt.trim(),
        ratio: imageRatio,
        style: imageStyle,
        variantId: currentPlatformVariant?.id,
        textOverlay: imageMainTitle
          ? {
              mainTitle: imageMainTitle,
              subtitle: imageSubtitle || undefined,
              badge: imageBadge || undefined,
            }
          : undefined,
      });
      setImagePreview(preview);
      setSuccessMsg("视觉图片预览生成完成！");
      const runs = await listGenerationRuns(id);
      setGenerationRuns(runs);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setGeneratingPreview(false);
    }
  }

  // 10. 采纳为正式资产
  async function handleAcceptImageAsset() {
    if (!imagePreview) return;
    setAcceptingAsset(true);
    setError("");
    try {
      const asset = await acceptImageAsset(id, imagePreview.jobId, {
        prompt: imagePreview.sanitizedPrompt,
        ratio: imageRatio,
        imageUrl: imagePreview.imageUrl,
      });
      setAcceptedAsset(asset);
      setDraftAssets((prev) => [asset, ...prev]);
      setSuccessMsg(`已成功将图片采纳并归档入库为草稿资产（ID: ${asset.id.slice(0, 8)}…）！`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setAcceptingAsset(false);
    }
  }

  // 11. 刷新生成运行历史
  async function handleRefreshRuns() {
    setLoadingRuns(true);
    try {
      const runs = await listGenerationRuns(id);
      setGenerationRuns(runs);
      setSuccessMsg("已刷新生成运行记录。");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoadingRuns(false);
    }
  }

  // 复制 Prompt 到剪贴板
  async function copyToClipboard(text: string, idStr: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPromptId(idStr);
      setTimeout(() => setCopiedPromptId(null), 2500);
    } catch {
      // 忽略非安全上下文复制错误
    }
  }

  // 从 Brief 载入生图参数
  function loadBriefToStudio(brief: ContentImageBriefRecord) {
    setImagePrompt(brief.prompt);
    setImageRatio(brief.ratio);
    setImageStyle(brief.style);
    if (brief.textOverlay) {
      setImageMainTitle(brief.textOverlay.mainTitle || "");
      setImageSubtitle(brief.textOverlay.subtitle || "");
      setImageBadge(brief.textOverlay.badge || "");
    }
    setActiveTab("image-gen");
    setSuccessMsg(`已从「${brief.title}」载入提示词与比例配置。`);
  }

  // 过滤展示的声明
  const filteredClaims = useMemo(() => {
    if (!claimCheckResult?.claims) return [];
    if (claimFilter === "ALL") return claimCheckResult.claims;
    return claimCheckResult.claims.filter((c) => c.status === claimFilter);
  }, [claimCheckResult, claimFilter]);

  if (loading) {
    return (
      <main className="p-8">
        <LoadingSkeleton rows={8} />
      </main>
    );
  }

  if (error && !draft) {
    return (
      <main className="p-8">
        <ErrorState title="无法加载内容草稿" error={error} retry={() => void loadData()} />
      </main>
    );
  }

  if (!draft) {
    return (
      <main className="p-8">
        <EmptyState title="草稿不存在" description="请返回内容执行列表选择有效草稿。" href="/app/content" action="返回内容执行" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* 返回导航 */}
        <Link href="/app/content" className="inline-flex items-center text-sm font-medium text-blue-700 hover:underline">
          ← 返回内容执行列表
        </Link>

        {/* 顶部标题与元数据 */}
        <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">{draft.title}</h1>
                <StatusBadge status={draft.status} />
              </div>
              <p className="mt-2 text-sm text-slate-500">
                最新版本 {latest ? `v${latest.version}` : "—"} ·{" "}
                {draft.generationMode === "MANUAL" ? "人工创建" : draft.generationMode === "AI_ASSISTED" ? "AI 辅助" : "AI 生成"}
                {draft.topic && <span> · 主题：{draft.topic}</span>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={generatingVariants}
                onClick={() => void handleGenerateAllPlatforms()}
                className="ui-button primary font-medium"
              >
                {generatingVariants ? "正在批量生成…" : "一键生成 5 大平台版本"}
              </button>
            </div>
          </div>

          {/* 溯源链路 */}
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-xs">
            <span className="font-semibold text-slate-500">溯源依据：</span>
            {draft.sourceOpportunityId && (
              <Link href={`/app/opportunities/${draft.sourceOpportunityId}`} className="text-blue-700 hover:underline">
                查看来源机会 →
              </Link>
            )}
            {draft.sourceRecommendationId && (
              <Link href={`/app/recommendations/${draft.sourceRecommendationId}`} className="text-blue-700 hover:underline">
                查看来源建议 →
              </Link>
            )}
            {draft.sourceDiagnosisId && (
              <Link href={`/app/diagnosis/${draft.sourceDiagnosisId}`} className="text-blue-700 hover:underline">
                查看来源诊断 →
              </Link>
            )}
            {!draft.sourceOpportunityId && !draft.sourceRecommendationId && !draft.sourceDiagnosisId && (
              <span className="text-slate-400">未关联外部诊断或建议来源</span>
            )}
          </div>
        </header>

        {/* 提示消息 */}
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-xs">
            <strong>操作遇到问题：</strong> {error}
          </div>
        )}
        {successMsg && (
          <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 shadow-xs">
            {successMsg}
          </div>
        )}

        {/* 主体工作区：左侧 4 大工作台板块 + 底稿编辑；右侧 审批、版本、发布、连接 */}
        <section className="grid gap-6 lg:grid-cols-[1.65fr_1fr]">
          {/* 左侧主要区域 */}
          <div className="space-y-6">
            {/* 工作台 5 标签导航栏 */}
            <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-xs">
              <button
                type="button"
                onClick={() => setActiveTab("ai-gen")}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                  activeTab === "ai-gen" ? "bg-blue-700 text-white shadow-xs" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <span>✨</span>
                <span>AI 平台生成</span>
                <span
                  className={`rounded-full px-2 py-0.2 text-xs ${
                    activeTab === "ai-gen" ? "bg-blue-800 text-white" : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {variants.length}/5
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("fact-check")}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                  activeTab === "fact-check" ? "bg-blue-700 text-white shadow-xs" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <span>🛡️</span>
                <span>事实核查守卫</span>
                {claimCheckResult?.blocking && (
                  <span className="rounded-full bg-red-500 px-2 py-0.2 text-xs text-white">拦截中</span>
                )}
                {!claimCheckResult?.blocking && verifiedFacts.length > 0 && (
                  <span
                    className={`rounded-full px-2 py-0.2 text-xs ${
                      activeTab === "fact-check" ? "bg-blue-800 text-white" : "bg-slate-200 text-slate-700"
                    }`}
                  >
                    {verifiedFacts.length}事实
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("image-gen")}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                  activeTab === "image-gen" ? "bg-blue-700 text-white shadow-xs" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <span>🎨</span>
                <span>图片生成工坊</span>
                {draftAssets.length > 0 && (
                  <span
                    className={`rounded-full px-2 py-0.2 text-xs ${
                      activeTab === "image-gen" ? "bg-blue-800 text-white" : "bg-slate-200 text-slate-700"
                    }`}
                  >
                    {draftAssets.length}资产
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("runs-history")}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                  activeTab === "runs-history" ? "bg-blue-700 text-white shadow-xs" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <span>📜</span>
                <span>生成历史追溯</span>
                <span
                  className={`rounded-full px-2 py-0.2 text-xs ${
                    activeTab === "runs-history" ? "bg-blue-800 text-white" : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {generationRuns.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("draft-editor")}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                  activeTab === "draft-editor" ? "bg-blue-700 text-white shadow-xs" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <span>📝</span>
                <span>草稿底稿直接编辑</span>
              </button>
            </div>

            {/* 板块 1: AI 平台生成 */}
            {activeTab === "ai-gen" && (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">国内平台文案生成与适配</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      针对微信公众号、小红书、微博、抖音、B站受众与排版规律专属适配，支持多轮润色与采纳。
                    </p>
                  </div>
                  {currentPlatformVariant && (
                    <button
                      type="button"
                      disabled={applying || locked}
                      onClick={() => void handleApplyVariant()}
                      className="ui-button font-medium border-blue-600 bg-blue-50 text-blue-700 hover:bg-blue-100"
                    >
                      {applying ? "应用中…" : "采纳为此草稿新版本"}
                    </button>
                  )}
                </div>

                {/* 平台切换标签 */}
                <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
                  {CN_PLATFORMS.map((p) => {
                    const hasVariant = variants.some((v) => v.platform === p.id);
                    const isSelected = selectedPlatform === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedPlatform(p.id)}
                        className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition ${
                          isSelected
                            ? "bg-blue-700 text-white shadow-xs"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        <span>{p.icon}</span>
                        <span>{p.name}</span>
                        {hasVariant ? (
                          <span
                            className={`ml-1 h-2 w-2 rounded-full ${isSelected ? "bg-emerald-300" : "bg-emerald-500"}`}
                            title="已生成此平台版本"
                          />
                        ) : (
                          <span className="ml-1 h-1.5 w-1.5 rounded-full bg-slate-300" title="未生成" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* 平台特性描述 */}
                <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3.5 py-2 text-xs text-slate-600">
                  <span>
                    <strong>平台定位：</strong>
                    {CN_PLATFORMS.find((p) => p.id === selectedPlatform)?.desc}
                  </span>
                  <span className="font-mono text-slate-400">
                    封面规格 {CN_PLATFORMS.find((p) => p.id === selectedPlatform)?.ratio}
                  </span>
                </div>

                {/* 若当前平台已有版本 */}
                {currentPlatformVariant ? (
                  <div className="space-y-5">
                    {/* 版本元信息条 */}
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-blue-100 px-2 py-0.5 font-semibold text-blue-800">
                          {currentPlatformVariant.contentType}
                        </span>
                        <span className="rounded-md bg-slate-200 px-2 py-0.5 text-slate-700">
                          {currentPlatformVariant.generationMode}
                        </span>
                        <span className="text-slate-500">
                          生成时间：{new Date(currentPlatformVariant.createdAt).toLocaleString("zh-CN", { hour12: false })}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={generatingVariants}
                        onClick={() => void handleGeneratePlatform(selectedPlatform)}
                        className="text-xs text-blue-700 hover:underline font-medium"
                      >
                        {generatingVariants ? "重新生成中…" : "重新为此平台生成"}
                      </button>
                    </div>

                    {/* 标题与封面文案 */}
                    <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                      <div>
                        <span className="text-xs font-semibold text-slate-500">适配主标题</span>
                        <h3 className="mt-1 text-base font-bold text-slate-900">{currentPlatformVariant.title}</h3>
                      </div>

                      {currentPlatformVariant.coverText && (
                        <div className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
                          <span className="font-semibold">建议封面主大字：</span>
                          <span>{currentPlatformVariant.coverText}</span>
                        </div>
                      )}

                      {currentPlatformVariant.platformMetadata?.hook && (
                        <div className="rounded-lg bg-indigo-50 p-2.5 text-xs text-indigo-950">
                          <span className="font-semibold">开篇黄金抓手 (Hook)：</span>
                          <p className="mt-0.5">{currentPlatformVariant.platformMetadata.hook}</p>
                        </div>
                      )}

                      {currentPlatformVariant.platformMetadata?.coverSuggestions &&
                        currentPlatformVariant.platformMetadata.coverSuggestions.length > 0 && (
                          <div>
                            <span className="text-xs font-semibold text-slate-500">备选高点击标题方案：</span>
                            <ul className="mt-1 space-y-1 text-xs text-slate-700">
                              {currentPlatformVariant.platformMetadata.coverSuggestions.map((alt, idx) => (
                                <li key={idx} className="flex items-start gap-1.5">
                                  <span className="font-mono text-slate-400">方案{idx + 1}.</span>
                                  <span>{alt}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                    </div>

                    {/* 正文 / 脚本大纲展示 */}
                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between pb-2 border-b border-slate-100 text-xs">
                        <span className="font-semibold text-slate-600">正文内容与分段脚本</span>
                        {currentPlatformVariant.platformMetadata?.wordCountTarget && (
                          <span className="text-slate-400">
                            目标字数：{currentPlatformVariant.platformMetadata.wordCountTarget}
                          </span>
                        )}
                      </div>
                      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-800">
                        {currentPlatformVariant.body}
                      </pre>

                      {/* 行动号召 CTA */}
                      {currentPlatformVariant.platformMetadata?.cta && (
                        <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/50 p-2.5 text-xs text-blue-900">
                          <span className="font-semibold">结尾行动号召 (CTA)：</span>
                          <span>{currentPlatformVariant.platformMetadata.cta}</span>
                        </div>
                      )}

                      {/* 话题标签 */}
                      {currentPlatformVariant.tags && currentPlatformVariant.tags.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {currentPlatformVariant.tags.map((tag, idx) => (
                            <span
                              key={idx}
                              className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-blue-800"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 真实性核对与合规守卫提示 */}
                    {currentPlatformVariant.platformMetadata?.safeNotes &&
                      currentPlatformVariant.platformMetadata.safeNotes.length > 0 && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-900">
                          <div className="flex items-center gap-1.5 font-semibold">
                            <span>⚠️</span>
                            <span>事实准确性与平台合规审查提示</span>
                          </div>
                          <ul className="mt-2 space-y-1 list-disc list-inside">
                            {currentPlatformVariant.platformMetadata.safeNotes.map((note, idx) => (
                              <li key={idx}>{note}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                    {/* 智能改写与微调工具箱（11 种模式） */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-xs font-bold text-slate-700">定向改写与语气调优（支持 11 种模式）</h4>
                          <p className="mt-0.5 text-xs text-slate-500">
                            针对当前版本进行专项润色，自动生成不可篡改的 Generation Run 记录。
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {REWRITE_OPTIONS.map((opt) => (
                          <button
                            key={opt.mode}
                            type="button"
                            onClick={() => setSelectedRewriteMode(opt.mode)}
                            className={`rounded-lg border p-2 text-left transition ${
                              selectedRewriteMode === opt.mode
                                ? "border-blue-600 bg-blue-50 text-blue-900 shadow-2xs"
                                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                            }`}
                          >
                            <div className="text-xs font-bold">{opt.label}</div>
                            <div className="text-[11px] text-slate-500 leading-tight mt-0.5">{opt.desc}</div>
                          </button>
                        ))}
                      </div>

                      <div className="mt-3 flex gap-2">
                        <input
                          type="text"
                          placeholder="可输入具体改写说明（例如：重点突出夜间静音体验）"
                          value={rewriteInstructions}
                          onChange={(e) => setRewriteInstructions(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs placeholder:text-slate-400"
                        />
                        <button
                          type="button"
                          disabled={rewriting}
                          onClick={() => void handleRewriteVariant()}
                          className="ui-button primary shrink-0 text-xs px-4"
                        >
                          {rewriting ? "改写中…" : "立即执行改写"}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* 当前平台尚未生成版本时的引导卡片 */
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-2xl">
                      {CN_PLATFORMS.find((p) => p.id === selectedPlatform)?.icon}
                    </div>
                    <h3 className="mt-3 text-sm font-semibold text-slate-800">
                      尚未生成 {CN_PLATFORMS.find((p) => p.id === selectedPlatform)?.name} 版本文案
                    </h3>
                    <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
                      选择生成模式后，一键为该平台生成定制化的标题、正文结构、封面文案及标签。
                    </p>

                    <div className="mx-auto mt-4 flex max-w-sm flex-wrap justify-center gap-2">
                      {GENERATION_MODES.map((mode) => (
                        <button
                          key={mode.mode}
                          type="button"
                          onClick={() => setGenMode(mode.mode)}
                          className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                            genMode === mode.mode
                              ? "bg-blue-700 text-white shadow-2xs"
                              : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-100"
                          }`}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>

                    <div className="mt-5">
                      <button
                        type="button"
                        disabled={generatingVariants}
                        onClick={() => void handleGeneratePlatform(selectedPlatform)}
                        className="ui-button primary text-sm px-5 py-2 font-medium"
                      >
                        {generatingVariants
                          ? "正在定制生成中…"
                          : `一键生成 ${CN_PLATFORMS.find((p) => p.id === selectedPlatform)?.name} 版本`}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 板块 2: 事实检查与声明守卫 (Fact Check & Claim Guard) */}
            {activeTab === "fact-check" && (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">事实核查与声明守卫 (Fact Grounding)</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      自动提取正文中的参数、排名、极限词与功效断言，比对已知事实库，阻断未核验内容的审批发布。
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={extractingClaims}
                    onClick={() => void handleExtractClaims()}
                    className="ui-button primary text-xs"
                  >
                    {extractingClaims ? "正在抽取核对中…" : "一键抽取并核查当前文本声明"}
                  </button>
                </div>

                {/* 阻断状态横幅 */}
                {claimCheckResult?.blocking && (
                  <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-xs text-red-900 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold flex items-center gap-1.5 text-sm">
                        <span>⚠️</span>
                        <span>事实核查未通过：检测到未验证的核心事实声明（审批强制拦截中）</span>
                      </span>
                      <button
                        type="button"
                        disabled={safeRewriting}
                        onClick={() => void handleSafeRewrite()}
                        className="ui-button primary font-medium text-xs bg-red-700 hover:bg-red-800 text-white"
                      >
                        {safeRewriting ? "正在安全净化改写中…" : "一键自动安全改写"}
                      </button>
                    </div>
                    <p className="text-slate-700">
                      当前文本包含 <strong>{claimCheckResult.unverifiedCount}</strong> 项未验证断言（含{" "}
                      <strong>{claimCheckResult.conflictingCount}</strong> 项冲突）。根据规则，包含未核验参数、极限绝对词或医疗功效的内容禁止审批通过。
                    </p>
                  </div>
                )}

                {claimCheckResult && !claimCheckResult.blocking && (
                  <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-xs text-emerald-900">
                    <div className="flex items-center gap-2 font-bold text-sm">
                      <span>✅</span>
                      <span>事实核查全部通过</span>
                    </div>
                    <p className="mt-1 text-slate-700">
                      所有抽取的断言均已成功与已知事实库核验，或表述符合客观中立安全规范，允许提交审批与发布。
                    </p>
                  </div>
                )}

                {/* 安全改写成果提示 */}
                {safeRewriteSummary && (
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 text-xs text-indigo-950 space-y-2">
                    <div className="font-bold text-sm">安全改写已生效并留存运行快照</div>
                    <p className="text-slate-600">已对以下未验证断言执行中立化脱敏重构：</p>
                    <ul className="space-y-1 list-disc list-inside">
                      {safeRewriteSummary.changeSummary.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 抽取声明列表 */}
                {claimCheckResult?.claims && claimCheckResult.claims.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-slate-800">
                        抽取的断言清单 ({claimCheckResult.claims.length})
                      </h3>
                      <div className="flex gap-1 text-xs">
                        {(["ALL", "UNVERIFIED", "CONFLICTING", "VERIFIED"] as const).map((filter) => (
                          <button
                            key={filter}
                            type="button"
                            onClick={() => setClaimFilter(filter)}
                            className={`rounded px-2 py-0.5 transition ${
                              claimFilter === filter
                                ? "bg-slate-800 text-white font-medium"
                                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            }`}
                          >
                            {filter === "ALL"
                              ? "全部"
                              : filter === "UNVERIFIED"
                              ? "未验证"
                              : filter === "CONFLICTING"
                              ? "冲突"
                              : "已验证"}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2.5 max-h-72 overflow-auto pr-1">
                      {filteredClaims.map((c) => (
                        <div
                          key={c.id}
                          className={`rounded-xl border p-3 text-xs space-y-1.5 transition ${
                            c.status === "VERIFIED"
                              ? "border-emerald-200 bg-emerald-50/40"
                              : c.status === "CONFLICTING"
                              ? "border-red-300 bg-red-50/50"
                              : "border-amber-200 bg-amber-50/40"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="rounded bg-slate-200 px-1.5 py-0.2 font-mono text-[10px] text-slate-700">
                                {CLAIM_CATEGORY_LABELS[c.category] || c.category}
                              </span>
                              <span
                                className={`rounded px-1.5 py-0.2 text-[10px] font-bold ${
                                  c.status === "VERIFIED"
                                    ? "bg-emerald-200 text-emerald-800"
                                    : c.status === "CONFLICTING"
                                    ? "bg-red-200 text-red-800"
                                    : "bg-amber-200 text-amber-800"
                                }`}
                              >
                                {c.status === "VERIFIED" ? "已核验" : c.status === "CONFLICTING" ? "冲突违背" : "未经验证"}
                              </span>
                            </div>
                            <span className="text-[11px] text-slate-400">
                              置信度: {(c.confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div className="font-bold text-slate-900">{c.claim}</div>
                          {c.sourceSnippet && (
                            <div className="text-slate-500 italic">原文片段：“{c.sourceSnippet}”</div>
                          )}
                          {c.status === "UNVERIFIED" && (
                            <div className="pt-1 flex justify-end">
                              <button
                                type="button"
                                onClick={() => {
                                  setNewClaim(c.claim);
                                  setNewFactType(c.category === "NUMERICAL_SPEC" ? "SPEC" : "FEATURE");
                                }}
                                className="text-[11px] text-blue-700 hover:underline font-medium"
                              >
                                填入已知事实库登记 →
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 已知事实库维护 (Verified Facts) */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">草稿与项目已知事实库 (Verified Facts)</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      登记由产品说明书、检测报告或用户明确确认的客观事实，供 LLM 生成与合规审查时自动采纳为事实依据。
                    </p>
                  </div>

                  {/* 录入新事实表单 */}
                  <form onSubmit={handleAddFact} className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
                    <div className="text-xs font-semibold text-slate-700">录入新的核验事实</div>
                    <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
                      <input
                        type="text"
                        placeholder="客观事实声明（例如：工作噪音45分贝、电池容量5000mAh）"
                        value={newClaim}
                        onChange={(e) => setNewClaim(e.target.value)}
                        className="rounded-lg border border-slate-300 p-1.5 text-xs placeholder:text-slate-400"
                        required
                      />
                      <select
                        value={newFactType}
                        onChange={(e) => setNewFactType(e.target.value)}
                        className="rounded-lg border border-slate-300 p-1.5 text-xs"
                      >
                        {Object.entries(FACT_TYPE_LABELS).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="凭据来源（例如：国家质检报告编号 CNAS-2026 或官网规格页）"
                        value={newSourceRef}
                        onChange={(e) => setNewSourceRef(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 p-1.5 text-xs placeholder:text-slate-400"
                      />
                      <button
                        type="submit"
                        disabled={addingFact}
                        className="ui-button primary shrink-0 text-xs px-4"
                      >
                        {addingFact ? "登记中…" : "添加核验事实"}
                      </button>
                    </div>
                  </form>

                  {/* 已录入事实列表 */}
                  {verifiedFacts.length > 0 ? (
                    <div className="space-y-2 max-h-48 overflow-auto pr-1">
                      {verifiedFacts.map((fact) => (
                        <div
                          key={fact.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-2.5 text-xs"
                        >
                          <div>
                            <span className="rounded bg-blue-100 px-1.5 py-0.2 text-[10px] font-semibold text-blue-800 mr-2">
                              {FACT_TYPE_LABELS[fact.factType] || fact.factType}
                            </span>
                            <span className="font-medium text-slate-800">{fact.claim}</span>
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {fact.sourceRef ? `凭据: ${fact.sourceRef}` : "人工录入确认"}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center text-xs text-slate-400 py-3">
                      暂无登记的核验事实。录入后系统将自动放行匹配的事实断言。
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 板块 3: 图片生成工坊 (Image Generation & Assets) */}
            {activeTab === "image-gen" && (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">视觉设计与图片生成工坊</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      支持从平台 Brief 快速导入或自由配置提示词。通过合规安全审查后，一键生成预览并采纳为草稿资产。
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={generatingBriefs}
                    onClick={() => void handleGenerateImageBriefs()}
                    className="ui-button primary text-xs"
                  >
                    {generatingBriefs ? "正在提炼 Brief…" : "提炼当前平台视觉 Brief"}
                  </button>
                </div>

                {/* 从当前平台 Brief 快捷载入 */}
                {currentPlatformBriefs.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold text-slate-700">从推荐 Brief 方案载入参数：</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {currentPlatformBriefs.map((b) => (
                        <div
                          key={b.id}
                          className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-800">{b.title}</span>
                            <span className="rounded bg-slate-200 px-1.5 py-0.2 font-mono text-[10px]">
                              {b.ratio}
                            </span>
                          </div>
                          <p className="text-slate-600 line-clamp-2">{b.prompt}</p>
                          <button
                            type="button"
                            onClick={() => loadBriefToStudio(b)}
                            className="text-xs text-blue-700 hover:underline font-semibold"
                          >
                            载入此 Brief 到生图器 →
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 图片生成控制面板 */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-4">
                  <h3 className="text-xs font-bold text-slate-700">图片生成参数与提示词</h3>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">图片比例与平台适配</label>
                      <select
                        value={imageRatio}
                        onChange={(e) => setImageRatio(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs"
                      >
                        {RATIO_OPTIONS.map((ro) => (
                          <option key={ro.ratio} value={ro.ratio}>
                            {ro.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">视觉艺术风格</label>
                      <select
                        value={imageStyle}
                        onChange={(e) => setImageStyle(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs"
                      >
                        {IMAGE_STYLES.map((st) => (
                          <option key={st.style} value={st.style}>
                            {st.label} ({st.desc})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* 封面排版压字 */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      建议排版压字（可选，渲染至图片）
                    </label>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <input
                        type="text"
                        placeholder="主大字标题（例如：超薄机身）"
                        value={imageMainTitle}
                        onChange={(e) => setImageMainTitle(e.target.value)}
                        className="rounded-lg border border-slate-300 bg-white p-1.5 text-xs placeholder:text-slate-400"
                      />
                      <input
                        type="text"
                        placeholder="副标题说明（例如：深度静音降噪）"
                        value={imageSubtitle}
                        onChange={(e) => setImageSubtitle(e.target.value)}
                        className="rounded-lg border border-slate-300 bg-white p-1.5 text-xs placeholder:text-slate-400"
                      />
                      <input
                        type="text"
                        placeholder="角标/特性标贴（例如：官方实测）"
                        value={imageBadge}
                        onChange={(e) => setImageBadge(e.target.value)}
                        className="rounded-lg border border-slate-300 bg-white p-1.5 text-xs placeholder:text-slate-400"
                      />
                    </div>
                  </div>

                  {/* 提示词输入 */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">生图提示词 (Prompt)</label>
                    <textarea
                      rows={3}
                      placeholder="描述主体构图、光影材质与氛围细节（例如：现代极简桌面，高反光磨砂金属质感）"
                      value={imagePrompt}
                      onChange={(e) => setImagePrompt(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs font-mono placeholder:text-slate-400"
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={generatingPreview}
                      onClick={() => void handleGenerateImagePreview()}
                      className="ui-button primary text-xs px-5 py-2 font-medium"
                    >
                      {generatingPreview ? "正在生成预览中…" : "生成图片预览 (Image Preview)"}
                    </button>
                  </div>
                </div>

                {/* 生成预览展示与采纳操作 */}
                {imagePreview && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                          {imagePreview.status === "COMPLETED" ? "生成就绪" : imagePreview.status}
                        </span>
                        <span className="text-xs text-slate-500 font-mono">
                          {imagePreview.provider} · {imagePreview.model}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={acceptingAsset}
                        onClick={() => void handleAcceptImageAsset()}
                        className="ui-button primary text-xs px-4"
                      >
                        {acceptingAsset ? "入库中…" : "采纳为此草稿正式资产 (Accept Asset)"}
                      </button>
                    </div>

                    {/* 图片预览展示 */}
                    <div className="flex flex-col items-center justify-center rounded-xl bg-slate-900/5 p-4">
                      {imagePreview.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={imagePreview.imageUrl}
                          alt="AI 生成图片预览"
                          className="max-h-96 rounded-lg shadow-md object-contain"
                        />
                      ) : (
                        <div className="text-xs text-slate-400 py-8">图片预览已就绪</div>
                      )}
                    </div>

                    {/* 净化后的提示词与警告信息 */}
                    <div className="text-xs space-y-1.5 rounded-lg bg-slate-50 p-3">
                      <div className="font-semibold text-slate-700">实际生效的安全提示词：</div>
                      <p className="font-mono text-slate-600 text-[11px]">{imagePreview.sanitizedPrompt}</p>
                      {imagePreview.warnings && imagePreview.warnings.length > 0 && (
                        <div className="text-amber-800">
                          <strong>合规净化提示：</strong> {imagePreview.warnings.join("；")}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 采纳成功提示 */}
                {acceptedAsset && (
                  <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-xs text-emerald-900">
                    <div className="font-bold flex items-center gap-2 text-sm">
                      <span>🎉</span>
                      <span>资产成功入库！</span>
                    </div>
                    <p className="mt-1 text-slate-700">
                      已将当前视觉图片保存为草稿资产库封面 (COVER)，存储键：
                      <span className="font-mono text-slate-800">{acceptedAsset.storage}</span>，大小：
                      {(acceptedAsset.sizeBytes / 1024).toFixed(1)} KB。
                    </p>
                  </div>
                )}

                {/* 草稿资产库列表 */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-700">当前草稿关联的图片资产库 ({draftAssets.length})</h3>
                  </div>
                  {draftAssets.length > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      {draftAssets.map((asset) => (
                        <div
                          key={asset.id}
                          className="rounded-lg border border-slate-200 bg-white p-3 text-xs space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="rounded bg-blue-100 px-1.5 py-0.2 font-semibold text-blue-800">
                              {asset.type}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              {(asset.sizeBytes / 1024).toFixed(1)} KB
                            </span>
                          </div>
                          <div className="font-mono text-[10px] text-slate-500 truncate" title={asset.storage}>
                            存储: {asset.storage}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            创建时间：{new Date(asset.createdAt).toLocaleDateString("zh-CN")}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-xs text-slate-400 py-3">
                      草稿资产库暂无图片，点击上方「采纳为此草稿正式资产」即可沉淀入库。
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* 板块 4: 生成运行历史追溯 (Generation Runs) */}
            {activeTab === "runs-history" && (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">不可篡改生成记录 (Generation Runs)</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      全面追溯所有文本与图片模型调用的提示词版本、输入输出快照与 Token 计费。
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={loadingRuns}
                    onClick={() => void handleRefreshRuns()}
                    className="ui-button text-xs"
                  >
                    {loadingRuns ? "正在刷新…" : "刷新运行记录"}
                  </button>
                </div>

                {generationRuns.length > 0 ? (
                  <div className="space-y-3">
                    {generationRuns.map((run) => (
                      <div
                        key={run.id}
                        className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 text-xs space-y-2.5 transition hover:border-slate-300"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-800">#{run.id.slice(0, 8)}</span>
                            <span className="rounded bg-blue-100 px-2 py-0.5 font-semibold text-blue-800">
                              {run.platform}
                            </span>
                            <span className="rounded bg-slate-200 px-2 py-0.5 text-slate-700">
                              {run.generationMode}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 font-bold ${
                                run.status === "COMPLETED"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-red-100 text-red-800"
                              }`}
                            >
                              {run.status === "COMPLETED" ? "生成成功" : "执行失败"}
                            </span>
                          </div>
                          <span className="text-slate-400">
                            {new Date(run.createdAt).toLocaleString("zh-CN", { hour12: false })}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-slate-600 sm:grid-cols-4 pt-1 border-t border-slate-200/60">
                          <div>
                            <span className="text-slate-400">模型引擎：</span>
                            <span className="font-mono">{run.provider} / {run.model}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">提示词版本：</span>
                            <span className="font-mono">{run.promptVersion}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">Token 消耗：</span>
                            <span className="font-mono">入 {run.inputTokens ?? 0} / 出 {run.outputTokens ?? 0}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">核算费用：</span>
                            <span className="font-semibold text-slate-800">
                              {run.costUsd === null ? "免费 / Mock" : `$${run.costUsd}`}
                            </span>
                          </div>
                        </div>

                        {/* 查看快照展开 */}
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
                            className="text-blue-700 hover:underline text-xs font-semibold"
                          >
                            {expandedRunId === run.id ? "收起快照数据 ↑" : "查看输入与输出快照 ↓"}
                          </button>
                        </div>

                        {expandedRunId === run.id && (
                          <div className="mt-2 space-y-2 rounded-lg bg-slate-900 p-3 text-slate-200 font-mono text-[11px] overflow-auto max-h-80">
                            <div>
                              <div className="text-emerald-400 font-bold mb-1">输入快照 (Input Snapshot):</div>
                              <pre className="whitespace-pre-wrap">
                                {JSON.stringify(run.inputSnapshot, null, 2)}
                              </pre>
                            </div>
                            <div className="pt-2 border-t border-slate-700">
                              <div className="text-cyan-400 font-bold mb-1">输出快照 (Output Snapshot):</div>
                              <pre className="whitespace-pre-wrap">
                                {JSON.stringify(run.outputSnapshot, null, 2)}
                              </pre>
                            </div>
                            {run.errorMessage && (
                              <div className="pt-2 border-t border-slate-700 text-red-400">
                                <div className="font-bold mb-1">异常错误：</div>
                                <div>{run.errorMessage}</div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-xs text-slate-500">
                    暂无生成运行记录。发起文本生成、改写或生图后将在此处记录不可篡改的 Run 账本。
                  </div>
                )}
              </div>
            )}

            {/* 板块 5: 草稿基础底稿与手工保存 */}
            {activeTab === "draft-editor" && (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
                <h2 className="text-lg font-bold text-slate-900">草稿底稿直接编辑</h2>
                <p className="mt-1 text-xs text-slate-500">
                  保存会创建新的 Revision；历史版本只读。已批准后再次编辑会退回到草稿状态并需重新审核。
                </p>
                <label className="mt-4 block text-sm font-medium">
                  标题
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={locked}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
                  />
                </label>
                <label className="mt-3 block text-sm font-medium">
                  主题
                  <input
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    disabled={locked}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
                  />
                </label>
                <label className="mt-3 block text-sm font-medium">
                  正文 / 脚本 / 标签 / CTA
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    disabled={locked}
                    rows={8}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-mono text-sm"
                  />
                </label>
                <label className="mt-3 block text-sm font-medium">
                  摘要
                  <textarea
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    disabled={locked}
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || locked}
                  onClick={() => void save()}
                  className="ui-button primary mt-4 font-medium"
                >
                  {busy ? "保存中…" : "保存底稿为新版本"}
                </button>
              </div>
            )}
          </div>

          {/* 右侧：审核流、Revision 历史、发布模拟与渠道连接 */}
          <div className="space-y-6">
            {/* 审核面板 */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
              <h2 className="text-base font-semibold text-slate-900">审批与流转</h2>
              <p className="mt-1 text-xs text-slate-500">
                审核针对当前最新版本；未通过审批的内容受保护，严禁对外发布。
              </p>

              {["DRAFT", "CHANGES_REQUESTED", "REJECTED"].includes(draft.status) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void submit()}
                  className="ui-button primary mt-3 w-full font-medium"
                >
                  {busy ? "提交中…" : "提交当前版本审核"}
                </button>
              )}

              {draft.status === "READY_FOR_REVIEW" && (
                <div className="mt-3 space-y-3">
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    placeholder="输入审核评语（可选）"
                    className="w-full rounded-lg border border-slate-300 p-2 text-sm placeholder:text-slate-400"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void decide("APPROVED")}
                      className="ui-button primary flex-1 font-medium"
                    >
                      批准此版本
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void decide("CHANGES_REQUESTED")}
                      className="ui-button flex-1 font-medium"
                    >
                      要求修改
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void decide("REJECTED")}
                      className="ui-button flex-1 font-medium"
                    >
                      驳回
                    </button>
                  </div>
                </div>
              )}

              {currentApproval && (
                <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                  <span className="font-semibold">最近审批结论：</span>
                  {currentApproval.decision === "APPROVED"
                    ? "已批准"
                    : currentApproval.decision === "REJECTED"
                    ? "已驳回"
                    : "已要求修改"}{" "}
                  · {new Date(currentApproval.createdAt).toLocaleString("zh-CN", { hour12: false })}
                  <br />
                  <span className="text-slate-500">审批附言：</span>
                  {currentApproval.comment ?? "无附加附言"}
                </div>
              )}
            </div>

            {/* Revision 历史 */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">版本演进历史</h2>
                <span className="text-xs text-slate-400">共 {draft.revisions?.length ?? 0} 个版本</span>
              </div>
              {draft.revisions?.length ? (
                <ol className="mt-3 space-y-2.5 max-h-80 overflow-auto pr-1">
                  {draft.revisions.map((rev) => (
                    <li
                      key={rev.id}
                      className={`rounded-lg border p-3 text-sm transition ${
                        rev.id === latest?.id ? "border-blue-300 bg-blue-50/60" : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800">
                          v{rev.version} {rev.id === latest?.id && <span className="text-xs font-normal text-blue-700">(当前最新)</span>}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {new Date(rev.createdAt).toLocaleString("zh-CN", { hour12: false })}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">
                        {rev.changeNote ?? "常规更新"} ·{" "}
                        {rev.generationMode === "AI_GENERATED"
                          ? "AI 生成"
                          : rev.generationMode === "AI_ASSISTED"
                          ? "AI 辅助"
                          : "人工创建"}
                      </p>
                      {rev.body && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-blue-700 hover:underline">
                            查看该版本只读文本
                          </summary>
                          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-700">
                            {rev.body}
                          </pre>
                        </details>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-3 text-sm text-slate-500">暂无历史版本。</p>
              )}
            </div>

            {/* 发布（仅模拟沙箱） */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
              <h2 className="text-base font-semibold text-slate-900">模拟发布沙箱</h2>
              <p className="mt-1 text-xs text-slate-500">
                严格遵循审批闸门：仅允许已批准版本创建发布任务。当前为全隔离模拟状态。
              </p>
              {draft.status === "APPROVED" ? (
                <div className="mt-3 space-y-3">
                  <select
                    value={connectionId}
                    onChange={(e) => setConnectionId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 text-sm"
                  >
                    <option value="">选择已连接的渠道账号</option>
                    {connected.map((c) => (
                      <option key={c.id} value={c.id}>
                        {channelLabel[c.channel] ?? c.channel} · {c.displayName}
                      </option>
                    ))}
                  </select>
                  {connected.length === 0 && (
                    <p className="text-xs text-amber-700">暂无可用账号连接；不可用连接无法用于发布。</p>
                  )}
                  <button
                    type="button"
                    disabled={busy || !connectionId}
                    onClick={() => void publish()}
                    className="ui-button primary w-full font-medium"
                  >
                    创建模拟发布
                  </button>
                  <p className="text-xs text-slate-400">
                    真实平台外部写当前处于关闭状态 (EXTERNAL_PUBLISHING_ENABLED = false)，本轮执行 Mock 沙箱。
                  </p>
                  {publication && (
                    <Link
                      href={`/app/content/publications/${publication.id}`}
                      className="block text-sm text-blue-700 hover:underline"
                    >
                      查看模拟发布记录 →
                    </Link>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-500">
                  当前草稿尚未通过最终批准。请先在上方提交并由管理员审批通过后，方可创建发布任务。
                </p>
              )}
            </div>

            {/* 账号连接与渠道能力 */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
              <h2 className="text-base font-semibold text-slate-900">账号连接与就绪状态</h2>
              {connections.length ? (
                <ul className="mt-3 space-y-2">
                  {connections.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5 text-xs"
                    >
                      <span className="font-medium text-slate-800">
                        {channelLabel[c.channel] ?? c.channel} · {c.displayName}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                          c.status === "CONNECTED"
                            ? "bg-emerald-100 text-emerald-800"
                            : c.status === "EXPIRED"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {c.status === "CONNECTED" ? "已连接" : c.status === "EXPIRED" ? "已过期" : "不可用"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-slate-500">暂无已绑定的渠道账号。</p>
              )}
            </div>
          </div>
        </section>

        {/* 底部：操作审计记录 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">内容操作审计记录</h2>
            <span className="text-xs text-slate-400">完整时间轴审计记录</span>
          </div>
          {audit.length ? (
            <ol className="mt-4 space-y-3">
              {audit.map((item) => (
                <li key={item.id} className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600" />
                  <div>
                    <p className="font-medium text-slate-800">{auditLabel[item.action] ?? item.action}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })} · {item.detail ?? "系统记录"}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-xs text-slate-500">暂无操作记录。</p>
          )}
        </section>
      </div>
    </main>
  );
}
