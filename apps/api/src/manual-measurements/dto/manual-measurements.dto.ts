import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength,
} from "class-validator";

/**
 * M8C-R0 Manual Verified Measurement。
 * 所有人工录入只允许原始观测事实（Query/Raw Response/产品/检索确认/时间/可见引用），
 * 分析字段（targetMentioned/recommended/mentionPosition/competitors/sentiment）由
 * analyzeEvidence 自动生成，客户端一律不得提交。
 */

export const MANUAL_MEASUREMENT_PRODUCTS = ["qwen-web", "deepseek-web", "custom-web"] as const;
export type ManualMeasurementProduct = (typeof MANUAL_MEASUREMENT_PRODUCTS)[number];

export class CreateManualBenchmarkDto {
  /** demo = 演示数据（metadata.demo=true，不伪装真实测量）；real = 用户真实人工 Web UI 测量 */
  @IsIn(["demo", "real"])
  runType: "demo" | "real" = "real";

  @IsIn(MANUAL_MEASUREMENT_PRODUCTS as unknown as string[])
  measurementProduct: ManualMeasurementProduct = "qwen-web";

  /** AI Web UI 显示的具体模型名（可选；无法确认时不填，绝不猜测） */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayedModel?: string;

  /** 选择要人工执行的查询 id；默认 = suite 内全部 enabled 且 projectQueryId 存在的 queries */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  queryIds?: string[];
}

export class SubmitManualEvidenceDto {
  /** 完整粘贴原回答（非摘要）。空回答拒绝。 */
  @IsString()
  @MinLength(1)
  @MaxLength(100_000)
  rawResponse: string;

  @IsIn(MANUAL_MEASUREMENT_PRODUCTS as unknown as string[])
  measurementProduct: ManualMeasurementProduct = "qwen-web";

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayedModel?: string;

  /** 是否确认本次回答使用了网页/联网检索 */
  @IsBoolean()
  retrievalConfirmed: boolean;

  /** 确认依据：界面显示联网搜索 / 显示网页来源 / 显示引用链接 / 其他（多选或文本） */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  verificationSignals?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  verificationNotes?: string;

  /** AI Web UI 显示的引用 URL（可选）；Analysis 仍自行做 citation 规范化 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  citations?: string[];

  /** 实际回答获得时间（ISO）；缺省取当前时间 */
  @IsOptional()
  @IsString()
  observedAt?: string;
}

export class SkipManualRunDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class ManualQuerySelectionDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  queryIds?: string[];
}
