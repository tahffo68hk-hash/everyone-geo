import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from "class-validator";
import { Type, Transform } from "class-transformer";

export const CAMPAIGN_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "ARCHIVED",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const PRODUCTION_STATUSES = [
  "PLANNED",
  "BLOCKED_FACTS",
  "BLOCKED_ASSETS",
  "READY",
  "IN_PROGRESS",
  "DRAFT_CREATED",
  "IN_REVIEW",
  "APPROVED",
  "READY_TO_PUBLISH",
  "DONE",
] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

export const BLOCK_REASONS = [
  "MISSING_REQUIRED_FACTS",
  "MISSING_VIDEO_ASSET",
  "MISSING_IMAGE_ASSET",
  "DRAFT_NOT_CREATED",
  "REVIEW_REQUIRED",
  "APPROVAL_REJECTED",
] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];

export class CreateContentCampaignDto {
  /** 关联的来源 M9A ContentStrategy ID */
  @IsUUID()
  strategyId!: string;

  /** 所属 Project ID (可选，若不传自动根据 Strategy 解析) */
  @IsOptional()
  @IsUUID()
  projectId?: string;

  /** Campaign 名称（缺省自动根据 Strategy 目标与日期生成） */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  /** Campaign 描述 */
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  /** 战役目标（缺省使用 Strategy 的 perceptionGoal） */
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  objective?: string;

  /** 主要解决的 GEO 缺口（缺省使用 Strategy 的 geoGap） */
  @IsOptional()
  @IsString()
  primaryGeoGap?: string;

  /** 战役开始日期 (ISO 字符串) */
  @IsOptional()
  @IsDateString()
  startDate?: string;

  /** 战役结束日期 (ISO 字符串) */
  @IsOptional()
  @IsDateString()
  endDate?: string;

  /** 时区（如 Asia/Shanghai，缺省默认项目时区或 Asia/Shanghai） */
  @IsOptional()
  @IsString()
  timezone?: string;

  /** 可选纳入该战役的 Plan Item IDs；缺省将该战略下的全部计划项纳入 */
  @IsOptional()
  @IsArray()
  @IsUUID("all", { each: true })
  planItemIds?: string[];
}

export class UpdateContentCampaignDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  objective?: string;

  @IsOptional()
  @IsString()
  primaryGeoGap?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsIn(CAMPAIGN_STATUSES)
  status?: CampaignStatus;
}

export class GenerateCalendarDto {
  /** 计划起始排期日期（缺省使用 Campaign.startDate） */
  @IsOptional()
  @IsDateString()
  startDate?: string;

  /** 计划截止排期日期（缺省使用 Campaign.endDate） */
  @IsOptional()
  @IsDateString()
  endDate?: string;

  /** 时区 */
  @IsOptional()
  @IsString()
  timezone?: string;

  /** 排期节奏：保守(默认工作日平摊)、均衡、紧凑 */
  @IsOptional()
  @IsIn(["CONSERVATIVE", "BALANCED", "ACCELERATED", "WORKDAYS_ONLY", "DAILY", "SPREAD"])
  pacing?: string;

  /** 排期策略别名 */
  @IsOptional()
  @IsString()
  pacingStrategy?: string;

  /** 单日最大排期条目数（默认 1 或 2） */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  maxItemsPerDay?: number;

  /** 可选仅对特定计划项生成排期 */
  @IsOptional()
  @IsArray()
  @IsUUID("all", { each: true })
  planItemIds?: string[];
}

export class UpdateScheduleItemDto {
  /** 计划生产/完成日期 (ISO 格式，如 2026-09-20 或完整 ISO) */
  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  /** 建议时间段 (如 "10:00") */
  @IsOptional()
  @IsString()
  scheduledTime?: string;

  /** 时区 */
  @IsOptional()
  @IsString()
  timezone?: string;

  /** 生产状态 */
  @IsOptional()
  @IsIn(PRODUCTION_STATUSES)
  productionStatus?: ProductionStatus;

  /** 阻断原因 */
  @IsOptional()
  @IsIn([...BLOCK_REASONS, null])
  blockReason?: BlockReason | null;

  /** 指派成员（必须属于该组织），可置 null */
  @IsOptional()
  @IsUUID()
  assignedToId?: string | null;

  /** 简单前置依赖排期项 ID，可置 null */
  @IsOptional()
  @IsUUID()
  dependsOnItemId?: string | null;
}

export class QueueQueryDto {
  /** 所属 Project ID */
  @IsOptional()
  @IsUUID()
  projectId?: string;

  /** 所属 Campaign ID */
  @IsOptional()
  @IsUUID()
  campaignId?: string;

  /** 过滤状态 */
  @IsOptional()
  @IsIn(PRODUCTION_STATUSES)
  status?: ProductionStatus;

  /** 过滤状态别名 */
  @IsOptional()
  @IsIn(PRODUCTION_STATUSES)
  productionStatus?: ProductionStatus;

  /** 过滤发布渠道平台 */
  @IsOptional()
  @IsString()
  platform?: string;

  /** 是否仅查看已逾期条目 */
  @IsOptional()
  @Transform(({ value }) => value === "true" || value === true)
  @IsBoolean()
  overdueOnly?: boolean;

  /** 过滤指派人 */
  @IsOptional()
  @IsUUID()
  assignedToId?: string;

  /** 排期范围起始 */
  @IsOptional()
  @IsDateString()
  startDate?: string;

  /** 排期范围截止 */
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
