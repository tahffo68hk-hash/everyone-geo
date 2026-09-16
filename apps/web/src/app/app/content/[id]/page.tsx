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
  { mode: "REWRITE_EXPAND", label: "深度扩写", desc: "扩充细节案例与硬核论据" },
  { mode: "REWRITE_SHORTEN", label: "精简凝练", desc: "剔除冗余修饰，直击痛点" },
  { mode: "REWRITE_PROFESSIONAL", label: "提升专业度", desc: "强化客观数据与技术论证" },
  { mode: "REWRITE_CONVERSATIONAL", label: "更口语接地气", desc: "生动活泼，拉近受众距离" },
  { mode: "REWRITE_LOW_PROMO", label: "弱化营销感", desc: "以客观评测视角呈现产品" },
  { mode: "REWRITE_STRONG_CTA", label: "强化行动号召", desc: "激发读者互动、点赞与留资" },
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

export default function ContentDraftDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { projectId } = useProjectContext();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [caps, setCaps] = useState<Capability[]>([]);
  const [variants, setVariants] = useState<PlatformVariant[]>([]);
  const [imageBriefs, setImageBriefs] = useState<ContentImageBriefRecord[]>([]);

  const [selectedPlatform, setSelectedPlatform] = useState<PlatformType>("WECHAT_OFFICIAL_ACCOUNT");
  const [genMode, setGenMode] = useState("STANDARD");
  const [selectedRewriteMode, setSelectedRewriteMode] = useState("REWRITE_EXPAND");
  const [rewriteInstructions, setRewriteInstructions] = useState("");
  const [selectedImageStyle, setSelectedImageStyle] = useState("TECH");

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

      const [a, c, k, v, b] = await Promise.all([
        listContentAudit(id),
        listChannelConnections(d.projectId),
        listChannelCapabilities(),
        listPlatformVariants(id),
        listImageBriefs(id),
      ]);
      setAudit(a);
      setConnections(c);
      setCaps(k);
      setVariants(v);
      setImageBriefs(b);
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
      setSuccessMsg(`审核操作完成：${decision === "APPROVED" ? "已批准" : decision === "REJECTED" ? "已拒绝" : "已要求修改"}`);
    } catch (err) {
      setError(friendlyError(err));
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
      setSuccessMsg("已一键生成全部 5 大平台（公众号、小红书、微博、抖音、B站）适配版本！");
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
        style: selectedImageStyle,
        count: 2,
      });
      setImageBriefs((prev) => [
        ...briefs,
        ...prev.filter((b) => b.platform !== selectedPlatform || (currentPlatformVariant && b.variantId !== currentPlatformVariant.id)),
      ]);
      setSuccessMsg(`已成功为 ${CN_PLATFORMS.find((p) => p.id === selectedPlatform)?.name} 生成视觉封面与插图 Brief！`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setGeneratingBriefs(false);
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

        {/* 主体工作区 */}
        <section className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          {/* 左侧：国内平台生成增强 + 图片 Brief + 基础底稿 */}
          <div className="space-y-6">
            {/* 核心卡片：国内 5 大平台文案工作台 */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">国内平台文案工作台</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    针对微信公众号、小红书、微博、抖音、B站受众与排版规律专属适配，支持多次迭代与采纳。
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
              <div className="mt-5 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
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
                      {hasVariant && (
                        <span
                          className={`ml-1 h-2 w-2 rounded-full ${isSelected ? "bg-emerald-300" : "bg-emerald-500"}`}
                          title="已生成此平台版本"
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* 平台特性描述 */}
              <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3.5 py-2 text-xs text-slate-600">
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
                <div className="mt-5 space-y-5">
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
                        生成于：{new Date(currentPlatformVariant.createdAt).toLocaleString("zh-CN", { hour12: false })}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={generatingVariants}
                      onClick={() => void handleGeneratePlatform(selectedPlatform)}
                      className="text-xs text-blue-700 hover:underline"
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

                  {/* 智能改写与微调工具箱 */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                    <h4 className="text-xs font-bold text-slate-700">定向改写与语气调优</h4>
                    <p className="mt-0.5 text-xs text-slate-500">
                      针对当前版本进行专项润色，每次改写将安全留存，不破坏既有底稿。
                    </p>

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
                <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center">
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
                      {generatingVariants ? "正在定制生成中…" : `一键生成 ${CN_PLATFORMS.find((p) => p.id === selectedPlatform)?.name} 版本`}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 第二卡片：视觉封面与生图 Brief 工作台 */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">视觉生图与封面 Brief 工作台</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    根据平台规范自动提炼比例规格、风格提示词及文字排版建议，可一键复制或供生图模型消费。
                  </p>
                </div>
                <button
                  type="button"
                  disabled={generatingBriefs}
                  onClick={() => void handleGenerateImageBriefs()}
                  className="ui-button primary text-xs"
                >
                  {generatingBriefs ? "正在提炼 Brief…" : "一键生成视觉 Brief"}
                </button>
              </div>

              {/* 视觉风格选择 */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-500">推荐视觉风格：</span>
                {IMAGE_STYLES.map((st) => (
                  <button
                    key={st.style}
                    type="button"
                    onClick={() => setSelectedImageStyle(st.style)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                      selectedImageStyle === st.style
                        ? "bg-slate-800 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>

              {/* Brief 列表卡片 */}
              {currentPlatformBriefs.length > 0 ? (
                <div className="mt-5 space-y-4">
                  {currentPlatformBriefs.map((brief) => (
                    <div key={brief.id} className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                            {brief.assetType === "COVER_IMAGE" ? "封面首图" : "内容插图"}
                          </span>
                          <span className="text-sm font-bold text-slate-800">{brief.title}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
                          <span>比例：{brief.ratio}</span>
                          <span>·</span>
                          <span>风格：{brief.style}</span>
                        </div>
                      </div>

                      {/* 建议排版文字 */}
                      {brief.textOverlay && (
                        <div className="rounded-lg bg-amber-50/80 p-2.5 text-xs text-amber-950">
                          <span className="font-semibold">建议封面压字排版：</span>
                          <div className="mt-1 flex flex-wrap gap-2">
                            <span className="rounded bg-white px-2 py-0.5 border border-amber-200">
                              主标：{brief.textOverlay.mainTitle}
                            </span>
                            {brief.textOverlay.subtitle && (
                              <span className="rounded bg-white px-2 py-0.5 border border-amber-200">
                                副标：{brief.textOverlay.subtitle}
                              </span>
                            )}
                            {brief.textOverlay.badge && (
                              <span className="rounded bg-white px-2 py-0.5 border border-amber-200">
                                标贴：{brief.textOverlay.badge}
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 结构化生图 Prompt */}
                      <div>
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                          <span>生图提示词 (Prompt)</span>
                          <button
                            type="button"
                            onClick={() => void copyToClipboard(brief.prompt, brief.id)}
                            className="text-blue-700 hover:underline font-normal"
                          >
                            {copiedPromptId === brief.id ? "已复制提示词！" : "复制提示词"}
                          </button>
                        </div>
                        <pre className="mt-1 rounded-lg border border-slate-200 bg-white p-2.5 text-xs font-mono text-slate-800 whitespace-pre-wrap">
                          {brief.prompt}
                        </pre>
                      </div>

                      {/* 负向提示词 */}
                      {brief.negativePrompt && (
                        <div>
                          <div className="text-xs font-semibold text-slate-500">负向提示词 (Negative Prompt)</div>
                          <pre className="mt-1 rounded-lg border border-slate-200 bg-white p-2 text-xs font-mono text-slate-600 whitespace-pre-wrap">
                            {brief.negativePrompt}
                          </pre>
                        </div>
                      )}

                      {/* 真实性安全核查 */}
                      {brief.safeFactCheck && (
                        <div className="text-xs text-slate-500 italic">
                          <span>真实性审查：</span> {brief.safeFactCheck}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">
                  当前平台尚未生成生图 Brief。点击上方「一键生成视觉 Brief」按钮即可自动构建符合该平台比例规格的专业视觉方案。
                </div>
              )}
            </div>

            {/* 第三卡片：草稿基础底稿与手工保存 */}
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
          </div>

          {/* 右侧：审核流、Revision 历史、发布模拟与渠道连接 */}
          <div className="space-y-6">
            {/* 审核面板 */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
              <h2 className="text-base font-semibold text-slate-900">审批与流转</h2>
              <p className="mt-1 text-xs text-slate-500">
                审核针对当前最新版本；历史版本不可跨越审批。未通过审批的内容受保护，严禁对外发布。
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
                    className="w-full rounded-lg border border-slate-300 p-2 text-sm"
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
                <ol className="mt-3 space-y-2.5 max-h-96 overflow-auto pr-1">
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
                    <p className="text-xs text-amber-700">暂无可用账号连接；REVOKED / EXPIRED 连接不能用于发布。</p>
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
