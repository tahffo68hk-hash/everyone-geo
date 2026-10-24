import { BadRequestException } from "@nestjs/common";
import { ContentPlatform } from "./quick-start.constants";
import { parseJsonPayload } from "./quick-start.logic";

export type ContentQualityContext = {
  brandName: string;
  supportedFacts: string;
  hasEnterpriseDetails: boolean;
  opportunity: string;
};

export type GeneratedContent = {
  title: string;
  body: string;
  summary: string;
  hashtags: string[];
  videoScript: Record<string, unknown> | null;
  riskNotes: string[];
  metadata: Record<string, unknown>;
  qualityWarnings: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (isRecord(value)) return Object.values(value).flatMap(collectStrings);
  return [];
}

function isRawJsonOrProviderError(value: string) {
  const trimmed = value.trim();
  if (/^[{[]/u.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      // Ordinary prose may begin with a bracket; only reject parseable JSON here.
    }
  }
  return /^(?:(?:deepseek|provider|model)\s*)?(?:error\b|错误(?:[:：\s]|$)|请求失败|HTTP\s*\d{3}\b|\d{3}\s*(?:too many requests|rate limit)|rate limit\b|insufficient_quota\b|context_length_exceeded\b)/iu.test(trimmed);
}

export function cleanPublishText(value: string) {
  const unwrapped = value
    .replace(/```(?:[a-z0-9_-]+)?\s*([\s\S]*?)```/gi, "$1")
    .replace(/```(?:json|markdown|text)?\s*/gi, "")
    .replace(/^\s*好的[，,！!。 ]*/u, "");
  const lines = unwrapped.replace(/\r\n?/g, "\n").split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex >= 0) {
    const firstLine = lines[firstContentIndex].trim();
    const looksLikePreface = firstLine.length <= 160 &&
      /^(?:当然[，,。 ]*)?(?:(?:以下|下面)(?:是|为)|根据.{0,60}(?:要求|需求))/u.test(firstLine) &&
      /(?:生成|整理|撰写|文案|草稿|内容|供.{0,6}参考)/u.test(firstLine);
    if (looksLikePreface) lines.splice(firstContentIndex, 1);
  }
  return lines
    .map((line) => line
      .replace(/^([ \t]{0,3})#{1,6}(?:[ \t]+|$)/u, "$1")
      .replace(/\*\*([^\n]+?)\*\*/g, "$1")
      .replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/^\s*.*作为(?:一名|一个)?(?:AI|人工智能)语言模型.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanStructured(value: unknown): unknown {
  if (typeof value === "string") return cleanPublishText(value);
  if (Array.isArray(value)) return value.map(cleanStructured);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanStructured(item)]));
  }
  return value;
}

function normalizeHashtag(value: string) {
  const text = cleanPublishText(value).replace(/^#+/u, "").replace(/[\s,，]+/gu, "");
  return text ? `#${text}` : "";
}

function validatePlatformContent(
  platform: ContentPlatform,
  videoScript: Record<string, unknown> | null,
  hashtags: string[],
  body: string,
) {
  if (platform === "xiaohongshu" && (hashtags.length < 1 || hashtags.length > 12)) {
    throw new BadRequestException("小红书草稿需要包含 1 至 12 个话题标签");
  }
  if (platform === "douyin") {
    if (
      !videoScript ||
      typeof videoScript.voiceover !== "string" ||
      !videoScript.voiceover.trim() ||
      !Array.isArray(videoScript.shotSuggestions) ||
      videoScript.shotSuggestions.length < 2 ||
      videoScript.shotSuggestions.some((item) => typeof item !== "string")
    ) {
      throw new BadRequestException("抖音草稿需要完整口播文本和镜头建议");
    }
    if (videoScript.voiceover.trim() !== body.trim()) {
      throw new BadRequestException("抖音口播与正文必须保持一致");
    }
  }
  if (platform === "bilibili") {
    if (
      !videoScript ||
      typeof videoScript.opening !== "string" ||
      !videoScript.opening.trim() ||
      typeof videoScript.narration !== "string" ||
      !videoScript.narration.trim() ||
      typeof videoScript.ending !== "string" ||
      !videoScript.ending.trim() ||
      !Array.isArray(videoScript.outline) ||
      videoScript.outline.length < 2 ||
      videoScript.outline.some((item) =>
        !isRecord(item) ||
        typeof item.heading !== "string" ||
        !item.heading.trim() ||
        !Array.isArray(item.keyPoints) ||
        item.keyPoints.length === 0 ||
        item.keyPoints.some((point) => typeof point !== "string"),
      )
    ) {
      throw new BadRequestException("B站草稿需要包含完整讲解稿和至少两个视频章节");
    }
  }
}

function occurrenceCount(text: string, phrase: string) {
  if (!phrase.trim()) return 0;
  return text.split(phrase).length - 1;
}

function assessQuality(
  title: string,
  body: string,
  summary: string,
  videoScript: Record<string, unknown> | null,
  context: ContentQualityContext,
) {
  const warnings: string[] = [];
  const fullText = [title, summary, body, videoScript ? JSON.stringify(videoScript) : ""].join("\n");
  const boilerplate = [
    "随着科技的不断发展",
    "在当今竞争激烈的市场环境下",
    "值得注意的是",
    "综上所述",
    "总而言之",
    "赋能千行百业",
    "开启全新篇章",
  ].filter((phrase) => fullText.includes(phrase));
  if (boilerplate.length >= 2) warnings.push("正文出现多处常见套话，建议检查是否符合具体语境。");

  const paragraphs = body.split(/\n+/u).map((paragraph) => paragraph.replace(/[\s，。！？；：、,.!?;:]/gu, "").toLocaleLowerCase()).filter((paragraph) => paragraph.length >= 20);
  if (new Set(paragraphs).size !== paragraphs.length) warnings.push("正文存在重复段落，请人工去重。");

  if (context.brandName && occurrenceCount(body, context.brandName) > 4) {
    warnings.push("正文中品牌名称出现较多，请检查是否有关键词堆砌。");
  }
  if (context.opportunity && occurrenceCount(body, context.opportunity) > 2) {
    warnings.push("正文中目标问题关键词出现多次，请检查是否自然、必要。");
  }

  const supported = context.supportedFacts.normalize("NFKC").toLocaleLowerCase("zh-CN");
  const numericClaims = fullText.match(/\d+(?:[,.，]\d+)*(?:\s*(?:%|％|元|万元|万|家|人|年|个月|月|天|倍|项|个|台|位|分钟|小时|GB|TB|kg))/giu) ?? [];
  if (numericClaims.some((claim) => !supported.includes(claim.normalize("NFKC").toLocaleLowerCase("zh-CN")))) {
    warnings.push("正文含未在企业资料中找到依据的数字或价格表述，请人工核对。");
  }

  const claimPatterns = [
    /(?:获得|取得|通过).{0,12}(?:认证|资质|专利)/gu,
    /(?:保证|确保|承诺).{0,12}(?:效果|提升|增长|排名|收益)/gu,
    /(?:提升|增长|节省|降低).{0,8}\d/gu,
    /(?:行业|业内|市场|全球|世界|全国|中国|国内)(?:排名|市场)?(?:领先|第一(?:名)?|首位|顶尖)/gu,
    /(?:最佳|最好)(?:的)?(?:解决方案|产品|服务|平台|品牌|供应商|软件|方案)/gu,
    /(?:首创|首家|唯一(?:的)?(?:解决方案|产品|服务|平台|品牌|供应商|软件|方案))/gu,
  ];
  const unsupportedPromises = claimPatterns.some((pattern) =>
    Array.from(fullText.matchAll(pattern), (match) => match[0])
      .some((claim) => !supported.includes(claim.normalize("NFKC").toLocaleLowerCase("zh-CN"))),
  );
  if (unsupportedPromises) {
    warnings.push("正文含认证、资质、效果或收益承诺，也可能包含未经支持的领先/唯一性表述，请人工核对。");
  }

  if (!context.hasEnterpriseDetails) {
    warnings.push("企业资料不足，当前内容按通用行业草稿处理；请补充产品/服务、客户和使用场景后复核。");
  }

  if (/(?:^|\n)\s*#{1,6}\s|\*\*[^\n]+\*\*|```/u.test(fullText)) {
    warnings.push("正文仍含 Markdown 格式标记，请清理后再发布。");
  }
  return Array.from(new Set(warnings));
}

export function parseGeneratedContent(
  answer: string,
  platform: ContentPlatform,
  context: ContentQualityContext,
): GeneratedContent {
  const parsed = parseJsonPayload(answer);
  if (!isRecord(parsed)) throw new BadRequestException("内容生成结果格式无效");
  if (typeof parsed.title !== "string" || typeof parsed.body !== "string") {
    throw new BadRequestException("内容生成结果缺少有效标题或正文");
  }

  const title = cleanPublishText(parsed.title);
  const body = cleanPublishText(parsed.body);
  const summarySource = typeof parsed.summary === "string"
    ? parsed.summary
    : body.slice(0, 160);
  const summary = cleanPublishText(summarySource);
  const rawHashtags = Array.isArray(parsed.hashtags)
    ? parsed.hashtags.filter((item): item is string => typeof item === "string")
    : [];
  const hashtags = Array.from(new Set(rawHashtags.map(normalizeHashtag).filter(Boolean))).slice(0, 30);
  const rawRiskNotes = Array.isArray(parsed.riskNotes)
    ? parsed.riskNotes.filter((note): note is string => typeof note === "string")
    : [];
  const riskNotes = Array.from(new Set(rawRiskNotes.map((note) => cleanPublishText(note)).filter(Boolean))).slice(0, 20);
  if (!riskNotes.length) {
    riskNotes.push("模型未提供风险说明，发布前请人工核验产品事实、来源与适用边界。");
  }
  const metadata = isRecord(parsed.metadata) ? parsed.metadata : {};
  const rawVideoScript = parsed.videoScript ?? metadata.videoScript ?? null;
  const cleanVideoScript = cleanStructured(rawVideoScript);
  const videoScript = isRecord(cleanVideoScript) ? cleanVideoScript : null;

  if (!title || !body || !summary || title.length > 200 || body.length > 30000 || summary.length > 500) {
    throw new BadRequestException("内容需要包含有效标题、正文和摘要");
  }
  if (rawVideoScript !== null && rawVideoScript !== undefined && !videoScript) {
    throw new BadRequestException("视频脚本字段格式无效");
  }
  if ([title, body, summary, ...rawHashtags, ...hashtags, ...collectStrings(videoScript)].some(isRawJsonOrProviderError)) {
    throw new BadRequestException("内容字段包含原始 JSON 或模型错误信息，无法作为可发布草稿保存");
  }
  validatePlatformContent(platform, videoScript, hashtags, body);

  const qualityWarnings = assessQuality(title, body, summary, videoScript, context);
  const rawMetadata = cleanStructured(metadata) as Record<string, unknown>;
  return {
    title,
    body,
    summary,
    hashtags,
    videoScript,
    riskNotes,
    qualityWarnings,
    metadata: {
      ...rawMetadata,
      summary,
      videoScript,
      riskNotes,
      qualityWarnings,
    },
  };
}
