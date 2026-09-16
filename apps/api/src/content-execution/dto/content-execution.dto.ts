import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";
import { Type } from "class-transformer";

const GENERATION_MODES = ["MANUAL", "AI_ASSISTED", "AI_GENERATED"] as const;
const DRAFT_STATUSES = ["DRAFT", "READY_FOR_REVIEW", "CHANGES_REQUESTED", "APPROVED", "REJECTED", "PUBLISHED", "ARCHIVED"] as const;
export const CHANNELS = [
  "XIAOHONGSHU", "DOUYIN", "WEIBO", "WECHAT", "BAIDU", "OTHER",
  "WORDPRESS", "GHOST", "WEBFLOW", "BLOGGER", "DEV_TO", "MASTODON", "BLUESKY", "TELEGRAM", "DISCORD", "SLACK",
  "THREADS", "LINKEDIN", "PINTEREST", "X", "REDDIT", "GOOGLE_BUSINESS_PROFILE", "YOUTUBE",
  "BILIBILI", "WECHAT_OFFICIAL_ACCOUNT", "TOUTIAO", "XIGUA", "TIKTOK", "INSTAGRAM", "FACEBOOK",
  "BAIDU_SEARCH_SURFACE", "WECHAT_CHANNELS", "ZHIHU", "BAIJIAHAO", "KUAISHOU", "SUBSTACK", "MEDIUM"
] as const;
const DECISIONS = ["APPROVED", "REJECTED", "CHANGES_REQUESTED"] as const;
const PUBLICATION_STATUSES = ["PENDING", "QUEUED", "PUBLISHING", "PUBLISHED", "FAILED", "CANCELLED"] as const;
export const ASSET_TYPES = ["IMAGE", "VIDEO", "COVER", "AUDIO"] as const;

export class CreateDraftDto {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  topic?: string;

  @IsOptional()
  @IsIn(GENERATION_MODES as unknown as string[])
  generationMode?: string;

  /** 来源溯源（可空）：Opportunity / Recommendation / DiagnosisRun 的 id。仅接受同一 project 的来源。 */
  @IsOptional()
  @IsUUID()
  sourceOpportunityId?: string;

  @IsOptional()
  @IsUUID()
  sourceRecommendationId?: string;

  @IsOptional()
  @IsUUID()
  sourceDiagnosisId?: string;

  /** 首版内容主体（渠道中立，通常为 JSON 字符串或纯文本）。 */
  @IsString()
  @Length(1, 20000)
  body!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  summary?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  changeNote?: string;
}

export class UpdateDraftDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  topic?: string;

  @IsOptional()
  @IsIn(GENERATION_MODES as unknown as string[])
  generationMode?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20000)
  body?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  summary?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  changeNote?: string;
}

export class DecideApprovalDto {
  @IsIn(DECISIONS as unknown as string[])
  decision!: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  comment?: string;

  /** 缺省为最新版本；若提供且非最新版本，服务将拒绝。 */
  @IsOptional()
  @IsUUID()
  revisionId?: string;
}

export class CreateConnectionDto {
  @IsIn(CHANNELS as unknown as string[])
  channel!: string;

  @IsString()
  @Length(1, 80)
  displayName!: string;

  /** 不透明密钥库引用（非密钥本体）。留空表示「仅登记意图，尚未接入 OAuth」。 */
  @IsOptional()
  @IsString()
  @Length(1, 255)
  credentialRef?: string;
}

export class CreatePublicationDto {
  @IsUUID()
  connectionId!: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  title?: string;

  /** 渠道中立的序列化内容（JSON 字符串）。 */
  @IsString()
  @Length(1, 20000)
  payload!: string;
}

export class ListDraftsDto {
  @IsOptional()
  @IsIn(DRAFT_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class ListPublicationsDto {
  @IsOptional()
  @IsIn(PUBLICATION_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsIn(CHANNELS as unknown as string[])
  channel?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

export class ListAssetsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

export class AuthorizeChannelDto {
  @IsUUID()
  projectId!: string;

  @IsString()
  @Length(1, 1000)
  redirectUri!: string;
}

export class CallbackQueryDto {
  @IsString()
  code!: string;

  @IsString()
  state!: string;
}

export class ValidatePublicationDto {
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export const CN_PLATFORMS = [
  'WECHAT_OFFICIAL_ACCOUNT',
  'XIAOHONGSHU',
  'WEIBO',
  'DOUYIN',
  'BILIBILI',
] as const;

export const REWRITE_MODES = [
  'REWRITE_EXPAND',
  'REWRITE_SHORTEN',
  'REWRITE_PROFESSIONAL',
  'REWRITE_CONVERSATIONAL',
  'REWRITE_LOW_PROMO',
  'REWRITE_STRONG_CTA',
  'REWRITE_STYLE_TUTORIAL',
  'REWRITE_STYLE_RECOMMENDATION',
  'EXPAND',
  'SHORTEN',
  'PROFESSIONAL',
  'CONVERSATIONAL',
  'LOW_PROMO',
  'STRONG_CTA',
  'FACT_SAFE',
  'MORE_NEUTRAL',
  'TUTORIAL',
  'COMPARISON',
  'FAQ',
] as const;

export class GeneratePlatformVariantDto {
  @IsIn(CN_PLATFORMS as unknown as string[])
  platform!: 'WECHAT_OFFICIAL_ACCOUNT' | 'XIAOHONGSHU' | 'WEIBO' | 'DOUYIN' | 'BILIBILI';

  @IsOptional()
  @IsUUID()
  sourceRevisionId?: string;

  @IsOptional()
  @IsString()
  generationMode?: string;

  @IsOptional()
  @IsString()
  styleTone?: 'PROFESSIONAL' | 'CONVERSATIONAL' | 'TECH' | 'LIFESTYLE' | 'TUTORIAL';

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  customInstructions?: string;
}

export class RewriteVariantDto {
  @IsIn(REWRITE_MODES as unknown as string[])
  mode!: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  customInstructions?: string;
}

export class ApplyVariantToRevisionDto {
  @IsOptional()
  @IsString()
  @Length(0, 500)
  changeNote?: string;
}

export class GenerateImageBriefDto {
  @IsOptional()
  @IsIn(CN_PLATFORMS as unknown as string[])
  platform?: 'WECHAT_OFFICIAL_ACCOUNT' | 'XIAOHONGSHU' | 'WEIBO' | 'DOUYIN' | 'BILIBILI';

  @IsOptional()
  @IsString()
  preferredStyle?: 'MINIMALIST' | 'TECH' | 'PROFESSIONAL' | 'FRESH' | 'COMPARISON' | 'TUTORIAL';

  @IsOptional()
  @IsUUID()
  variantId?: string;
}

export class CreateVerifiedFactDto {
  @IsString()
  @Length(1, 1000)
  claim!: string;

  @IsString()
  factType!: 'SPEC' | 'NUMERICAL' | 'FEATURE' | 'CERTIFICATION' | 'AWARD' | 'PRICE' | 'MEDICAL';

  @IsOptional()
  @IsIn(['VERIFIED', 'USER_CONFIRMED', 'UNVERIFIED', 'CONFLICTING'])
  status?: 'VERIFIED' | 'USER_CONFIRMED' | 'UNVERIFIED' | 'CONFLICTING';

  @IsOptional()
  @IsString()
  sourceType?: 'TARGET_ENTITY' | 'SITE_ASSET' | 'USER_INPUT' | 'EVIDENCE';

  @IsOptional()
  @IsString()
  sourceRef?: string;
}

export class ExtractClaimsDto {
  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;
}

export class SafeRewriteDto {
  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;
}

export class GenerateImagePreviewDto {
  @IsString()
  prompt!: string;

  @IsOptional()
  @IsString()
  negativePrompt?: string;

  @IsOptional()
  @IsString()
  ratio?: string;

  @IsOptional()
  @IsString()
  style?: string;

  @IsOptional()
  @IsUUID()
  variantId?: string;

  @IsOptional()
  textOverlay?: {
    mainTitle: string;
    subtitle?: string;
    badge?: string;
  };
}

export class AcceptImageAssetDto {
  @IsOptional()
  @IsString()
  jobId?: string;

  @IsString()
  prompt!: string;

  @IsString()
  ratio!: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsUUID()
  generationRunId?: string;
}

