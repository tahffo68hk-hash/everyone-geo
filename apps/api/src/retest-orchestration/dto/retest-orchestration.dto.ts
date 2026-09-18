import { IsArray, IsBoolean, IsEnum, IsOptional, IsString, IsUUID } from "class-validator";
import { RetrievalMode, SourceType } from "@geo/database";

export class CreateRetestRunDto {
  /** 可选：显式指定要重测的项目查询 ID 列表；若为空，将从 PublishedAsset 血缘中确定性推导 */
  @IsOptional()
  @IsArray()
  @IsUUID("4", { each: true })
  queryIds?: string[];

  /** 测试所用的 Provider，默认 'mock' */
  @IsOptional()
  @IsString()
  provider?: string;

  /** 测试引擎 ID（可选） */
  @IsOptional()
  @IsUUID("4")
  engineId?: string;

  /** 测试引擎 Key（可选，默认 'mock-default'） */
  @IsOptional()
  @IsString()
  engineKey?: string;

  /** 请求模型名称（可选） */
  @IsOptional()
  @IsString()
  requestedModel?: string;

  /** 检索模式（默认 api_plain） */
  @IsOptional()
  @IsEnum(RetrievalMode)
  retrievalMode?: RetrievalMode;

  /** 数据源类型（默认 mock） */
  @IsOptional()
  @IsEnum(SourceType)
  sourceType?: SourceType;

  /** 基线匹配策略，默认 'MOST_RECENT_BEFORE_PUBLICATION' */
  @IsOptional()
  @IsString()
  baselinePolicy?: string;

  /** 是否强制创建新 Run（若为 false 且已有进行中任务，将复用进行中任务） */
  @IsOptional()
  @IsBoolean()
  forceNew?: boolean;

  /** 是否在创建后立即自动同步执行（用于 e2e / 确定性测试，默认 true） */
  @IsOptional()
  @IsBoolean()
  autoExecute?: boolean;

  /** 模拟单项故障（QA / 测试专用，传入 queryId 触发失败） */
  @IsOptional()
  @IsString()
  simulateFailureQueryId?: string;
}

export interface RetestQuerySnapshotItem {
  id: string;
  text: string;
  category: string;
  intent: string;
  queryType: string;
  sanity: boolean;
}
