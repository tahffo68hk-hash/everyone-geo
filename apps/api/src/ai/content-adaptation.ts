import { createHash } from "node:crypto";
import { CHANNEL_CONTENT_LIMITS, type ChannelContentLimits } from "@geo/queue";

export const CONTENT_ADAPTATION_FEATURE = "content_channel_adaptation";

export const VIDEO_SCRIPT_CHANNELS = new Set(["DOUYIN", "WECHAT_CHANNELS", "BILIBILI"]);

export function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function adaptationIdempotencyKey(input: {
  promptVersion: string;
  revisionId: string;
  title: string;
  body: string;
  channels: string[];
  instructions?: string;
}): string {
  const canonical = JSON.stringify({
    promptVersion: input.promptVersion,
    revisionId: input.revisionId,
    title: input.title,
    body: input.body,
    channels: [...input.channels].sort(),
    instructions: (input.instructions || "").trim(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function knownAdaptationChannels(): string[] {
  return Object.keys(CHANNEL_CONTENT_LIMITS);
}

export function limitsForChannel(channel: string): ChannelContentLimits | null {
  return CHANNEL_CONTENT_LIMITS[channel as keyof typeof CHANNEL_CONTENT_LIMITS] ?? null;
}

export interface AdaptationChannelDraft {
  channel: string;
  title: string;
  body: string;
  hashtags: string[];
  videoScript: string | null;
  omittedClaims: string[];
  riskNotes: string[];
  adjustments: string[];
  status?: "SUCCESS" | "FAILED";
  error?: string | null;
  isComplete?: boolean;
  generationMode?: "REAL_LLM" | "MOCK" | "RULE_TRANSFORM" | "FAILED";
}

const UNSOURCED_RISK = /(\d+(?:\.\d+)?%|https?:\/\/\S+|\[\d+\])/g;
const PROMPT_LABEL_ECHOES: Array<{ label: string; pattern: RegExp }> = [
  { label: "补充说明", pattern: /补充说明[:：][^。\n]*。?/g },
  { label: "人工要求", pattern: /人工要求[:：][^。\n]*。?/g },
];

function stripPromptLabelEcho(body: string, sourceText: string, adjustments: string[]): string {
  let next = body;
  let removed = false;
  for (const rule of PROMPT_LABEL_ECHOES) {
    if (sourceText.includes(rule.label)) continue;
    const cleaned = next.replace(rule.pattern, "");
    if (cleaned !== next) {
      next = cleaned;
      removed = true;
    }
  }
  if (removed) adjustments.push("已去掉模型回写的提示词标签");
  return next.replace(/\s+/g, " ").trim();
}

/**
 * 把模型输出收进渠道限制。超长标题、正文和多余标签会被截断并记入 adjustments，
 * 不把截断伪装成模型原文。原文里没有的百分比、链接和文献编号记入 riskNotes，留给人工确认。
 */
export function constrainAdaptationChannel(
  raw: {
    channel: string;
    title?: string;
    body?: string;
    hashtags?: string[];
    videoScript?: string | null;
    omittedClaims?: string[];
  },
  sourceText: string,
  limits: ChannelContentLimits | null,
  requiresVideo: boolean,
): AdaptationChannelDraft {
  const adjustments: string[] = [];
  let title = (raw.title || "").trim();
  let body = stripPromptLabelEcho((raw.body || "").trim(), sourceText, adjustments);
  const seen = new Set<string>();
  let tags = (raw.hashtags || [])
    .map((tag) => tag.replace(/#/g, "").trim())
    .filter((tag) => {
      if (!tag || seen.has(tag)) return false;
      seen.add(tag);
      return true;
    });

  if (limits) {
    if (title.length > limits.title) {
      title = title.slice(0, limits.title);
      adjustments.push(`标题已截断至 ${limits.title} 字`);
    }
    if (limits.body !== null && body.length > limits.body) {
      body = body.slice(0, limits.body);
      adjustments.push(`正文已截断至 ${limits.body} 字`);
    }
    if (limits.maxTags !== null && tags.length > limits.maxTags) {
      tags = tags.slice(0, limits.maxTags);
      adjustments.push(`话题已保留前 ${limits.maxTags} 个`);
    }
  }

  let videoScript = raw.videoScript?.trim() || null;
  if (!requiresVideo && videoScript) {
    videoScript = null;
    adjustments.push("该渠道不使用视频脚本");
  }

  const riskNotes: string[] = [];
  const produced = `${title}\n${body}\n${videoScript || ""}`;
  for (const match of produced.matchAll(UNSOURCED_RISK)) {
    const token = match[1];
    if (!sourceText.includes(token)) {
      riskNotes.push(`结果包含原文中没有的「${token.slice(0, 80)}」，请人工核对后再确认`);
    }
  }

  const isLongArticle = raw.channel === "ZHIHU" || raw.channel === "WECHAT_OFFICIAL_ACCOUNT";
  let isComplete = true;
  if (isLongArticle && body.length < 150) {
    isComplete = false;
    adjustments.push("长文渠道正文字数偏少，建议检查完整性");
  }

  return {
    channel: raw.channel,
    title,
    body,
    hashtags: tags,
    videoScript,
    omittedClaims: (raw.omittedClaims || []).filter((item) => item.trim()).slice(0, 8),
    riskNotes: [...new Set(riskNotes)].slice(0, 8),
    adjustments,
    status: (raw as any).status || "SUCCESS",
    error: (raw as any).error || null,
    isComplete,
    generationMode: (raw as any).generationMode || "MOCK",
  };
}
