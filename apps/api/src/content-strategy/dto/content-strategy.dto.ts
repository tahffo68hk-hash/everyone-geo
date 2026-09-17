import { IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";
import { Type } from "class-transformer";

export const STRATEGY_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const PLAN_ITEM_STATUSES = [
  "PLANNED",
  "FACT_INPUT_REQUIRED",
  "ASSET_INPUT_REQUIRED",
  "READY",
  "DRAFTED",
  "IN_PRODUCTION",
  "COMPLETED",
  "DISMISSED",
] as const;

export class GenerateStrategyDto {
  /** 可选支持批量关联的 Opportunity IDs（用于多 Opportunity 语义聚类） */
  @IsOptional()
  @IsArray()
  @IsUUID("all", { each: true })
  opportunityIds?: string[];

  /** 可选关联的 Opportunity ID（向后兼容） */
  @IsOptional()
  @IsUUID()
  opportunityId?: string;

  /** 可选关联的 Recommendation ID */
  @IsOptional()
  @IsUUID()
  recommendationId?: string;

  /** 可选关联的 DiagnosisRun ID */
  @IsOptional()
  @IsUUID()
  diagnosisRunId?: string;

  /** 自定义战略标题（缺省自动根据输入机会生成） */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  /** 用户补充指导或业务重点 */
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  customGuidance?: string;

  /** 自定义目标实体/品牌（缺省使用 Project targetEntity） */
  @IsOptional()
  @IsString()
  @Length(1, 100)
  targetEntity?: string;

  /** 可选基线度量数据（用于校准数值 KPI） */
  @IsOptional()
  baselineMetrics?: Record<string, any>;

  /** 可选目标度量配置 */
  @IsOptional()
  targetMetrics?: Record<string, any>;
}

export class UpdatePlanItemDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  platform?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  format?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  objective?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  geoTarget?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetQueries?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keyClaims?: string[];

  @IsOptional()
  @IsIn(PLAN_ITEM_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  @Type(() => Number)
  sortOrder?: number;
}

export class CreateDraftFromPlanItemDto {
  /** 自定义草稿主体覆盖（缺省由战略与计划自动生成结构化大纲与事实） */
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

  /** 若已存在草稿，是否允许创建新版本（默认直接幂等复用已有草稿） */
  @IsOptional()
  createNewRevision?: boolean;

  /** 是否强制跳过非阻塞警告 */
  @IsOptional()
  force?: boolean;
}

export class ListStrategiesDto {
  @IsOptional()
  @IsIn(STRATEGY_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 50;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  offset?: number = 0;
}
