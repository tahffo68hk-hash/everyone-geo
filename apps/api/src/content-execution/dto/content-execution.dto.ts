import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";
import { Type } from "class-transformer";

const GENERATION_MODES = ["MANUAL", "AI_ASSISTED", "AI_GENERATED"] as const;
const DRAFT_STATUSES = ["DRAFT", "READY_FOR_REVIEW", "CHANGES_REQUESTED", "APPROVED", "REJECTED", "PUBLISHED", "ARCHIVED"] as const;
const CHANNELS = ["XIAOHONGSHU", "DOUYIN", "WEIBO", "WECHAT", "BAIDU", "OTHER"] as const;
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
