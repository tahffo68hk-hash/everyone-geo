import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export type AiProviderName =
  | "deepseek"
  | "qwen"
  | "doubao"
  | "kimi"
  | "zhipu"
  | "yuanbao"
  | "baidu"
  | "mock"
  | "auto";

export class BaseAiOptionsDto {
  @IsOptional()
  @IsIn(["deepseek", "qwen", "doubao", "kimi", "zhipu", "yuanbao", "baidu", "mock", "auto"])
  provider?: AiProviderName;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8192)
  maxTokens?: number;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

// B1. Query Set Generation
export class GenerateQuerySetDto extends BaseAiOptionsDto {
  @IsOptional()
  @IsString()
  brandName?: string;

  @IsOptional()
  @IsString()
  productName?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsOptional()
  @IsString()
  targetAudience?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  competitors?: string[];

  @IsOptional()
  @IsString()
  scenarios?: string;

  @IsOptional()
  @IsString()
  businessDesc?: string;

  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(30)
  queryCount?: number;
}

// B2. Query Expansion
export class ExpandQueriesDto extends BaseAiOptionsDto {
  @IsOptional()
  @IsString()
  querySetId?: string;

  @IsArray()
  @IsString({ each: true })
  existingQueries: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  count?: number;

  @IsOptional()
  @IsString()
  focusAngle?: string;
}

// B3. Query Rewrite
export class RewriteQueryDto extends BaseAiOptionsDto {
  @IsNotEmpty()
  @IsString()
  queryText: string;

  @IsOptional()
  @IsIn(["natural", "decision", "comparative", "discovery"])
  mode?: "natural" | "decision" | "comparative" | "discovery";
}

// B4. Query Classify
export class ClassifyQueryDto extends BaseAiOptionsDto {
  @IsNotEmpty()
  @IsString()
  queryText: string;
}

// C1. GEO Topics Detection
export class DetectGeoTopicsDto extends BaseAiOptionsDto {
  @IsOptional()
  @IsString()
  brandName?: string;

  @IsOptional()
  @IsString()
  productName?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  siteContent?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  queryTexts?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  competitors?: string[];
}

// C2. GEO Keyword Extraction
export class ExtractGeoKeywordsDto extends BaseAiOptionsDto {
  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  topic?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  count?: number;
}

// C3. Keyword / Topic Gap
export class AnalyzeKeywordGapDto extends BaseAiOptionsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  projectQueries?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  competitorNames?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceNotes?: string[];
}

// C4. Clustering
export class ClusterAiItemsDto extends BaseAiOptionsDto {
  @IsArray()
  @IsString({ each: true })
  items: string[];

  @IsOptional()
  @IsIn(["query", "keyword", "topic"])
  type?: "query" | "keyword" | "topic";

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(10)
  clusterCount?: number;
}

// D1. Diagnosis Explanation
export class ExplainDiagnosisDto extends BaseAiOptionsDto {
  @IsOptional()
  @IsString()
  diagnosisRunId?: string;

  @IsOptional()
  @IsString()
  diagnosisSummary?: string;

  @IsOptional()
  @IsArray()
  findings?: unknown[];

  @IsOptional()
  @IsArray()
  evidenceSnapshots?: unknown[];
}

// E1. Recommendation Draft
export class DraftRecommendationDto extends BaseAiOptionsDto {
  @IsOptional()
  @IsString()
  diagnosisId?: string;

  @IsOptional()
  @IsString()
  problemDescription?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetQueries?: string[];
}

// E2. Opportunity Draft
export class DraftOpportunityDto extends BaseAiOptionsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  diagnosisIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetQueries?: string[];
}

// F1. Strategy Draft
export class DraftStrategyDto extends BaseAiOptionsDto {
  @IsOptional()
  @IsString()
  objective?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetQueries?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  diagnosisSummaries?: string[];

  @IsOptional()
  @IsString()
  audience?: string;
}

// F2. Campaign Draft
export class DraftCampaignDto extends BaseAiOptionsDto {
  @IsOptional()
  @IsString()
  strategyId?: string;

  @IsOptional()
  @IsString()
  strategyObjective?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetQueries?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  channels?: string[];
}

// G1. Content Brief
export class GenerateContentBriefDto extends BaseAiOptionsDto {
  @IsArray()
  @IsString({ each: true })
  targetQueries: string[];

  @IsOptional()
  @IsString()
  topic?: string;

  @IsOptional()
  @IsString()
  audience?: string;

  @IsOptional()
  @IsString()
  brandContext?: string;
}

// G2. Content Titles
export class GenerateTitlesDto extends BaseAiOptionsDto {
  @IsNotEmpty()
  @IsString()
  topic: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetQueries?: string[];

  @IsOptional()
  @IsString()
  angle?: string;

  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(10)
  count?: number;
}

// G3. Content Outline
export class GenerateOutlineDto extends BaseAiOptionsDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetQueries?: string[];

  @IsOptional()
  @IsString()
  audience?: string;
}

export class GenerateDraftDto extends BaseAiOptionsDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  topic?: string;

  @IsOptional()
  @IsString()
  brandName?: string;

  @IsOptional()
  @IsString()
  brandContext?: string;

  @IsOptional()
  @IsString()
  audience?: string;

  @IsOptional()
  @IsArray()
  outline?: unknown[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetQueries?: string[];

  @IsOptional()
  @IsString()
  brief?: string;

  @IsOptional()
  @IsString()
  channel?: string;
}

// G5. Content Rewrite
export class RewriteContentDto extends BaseAiOptionsDto {
  @IsNotEmpty()
  @IsString()
  content: string;

  @IsOptional()
  @IsIn(["professional", "concise", "ai_friendly", "expand", "shorten", "comparison", "faq"])
  mode?: "professional" | "concise" | "ai_friendly" | "expand" | "shorten" | "comparison" | "faq";

  @IsOptional()
  @IsString()
  instructions?: string;
}

// G7. GEO Optimization
export class OptimizeGeoContentDto extends BaseAiOptionsDto {
  @IsNotEmpty()
  @IsString()
  content: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetQueries?: string[];
}

// G8. FAQ Generator
export class GenerateFaqDto extends BaseAiOptionsDto {
  @IsNotEmpty()
  @IsString()
  content: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetQueries?: string[];

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(10)
  count?: number;
}

// G10. Fact Risk Scan
export class ScanFactRiskDto extends BaseAiOptionsDto {
  @IsNotEmpty()
  @IsString()
  content: string;
}

// H. Competitor Candidates
export class DetectCompetitorCandidatesDto extends BaseAiOptionsDto {
  @IsOptional()
  @IsString()
  contentOrEvidence?: string;

  @IsOptional()
  @IsString()
  brandName?: string;
}

// I1. Outcome Summary
export class SummarizeOutcomeDto extends BaseAiOptionsDto {
  @IsOptional()
  @IsString()
  outcomeComparisonId?: string;

  @IsOptional()
  @IsNumber()
  baselineScore?: number;

  @IsOptional()
  @IsNumber()
  retestScore?: number;

  @IsOptional()
  @IsObject()
  metricsDelta?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  queryResults?: unknown[];
}

// I2. Attribution Explanation
export class ExplainAttributionDto extends BaseAiOptionsDto {
  @IsOptional()
  @IsString()
  outcomeAttributionId?: string;

  @IsNotEmpty()
  @IsString()
  attributionStatus: string;

  @IsOptional()
  @IsObject()
  signals?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  confounders?: unknown[];

  @IsOptional()
  @IsArray()
  reasonCodes?: unknown[];
}

// I3. Report Summary
export class SummarizeReportDto extends BaseAiOptionsDto {
  @IsOptional()
  @IsString()
  reportId?: string;

  @IsOptional()
  @IsNumber()
  overallScore?: number;

  @IsOptional()
  @IsArray()
  topPerformers?: unknown[];

  @IsOptional()
  @IsArray()
  lagPerformers?: unknown[];
}

// J1. Learning Summary
export class SummarizeLearningDto extends BaseAiOptionsDto {
  @IsOptional()
  @IsString()
  learningAggregateId?: string;

  @IsOptional()
  @IsInt()
  sampleCount?: number;

  @IsOptional()
  @IsInt()
  positiveCount?: number;

  @IsOptional()
  @IsInt()
  negativeCount?: number;

  @IsOptional()
  @IsObject()
  distribution?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  contextSnapshot?: Record<string, unknown>;
}

// J2. Learning Next Actions
export class DraftLearningActionsDto extends BaseAiOptionsDto {
  @IsOptional()
  @IsString()
  learningAggregateId?: string;

  @IsOptional()
  @IsString()
  patternSummary?: string;
}

// K1. Brand & Competitor Auto-Resolution (SOP Parity from Commercial GEO Systems)
export class ResolveBrandDto extends BaseAiOptionsDto {
  @IsString()
  @IsNotEmpty()
  brandName: string;

  @IsOptional()
  @IsString()
  industryHint?: string;

  @IsOptional()
  @IsString()
  regionHint?: string;
}

// L1. Video Script Generation (Short-video & Social Channels)
export class GenerateVideoScriptDto extends BaseAiOptionsDto {
  @IsString()
  @IsNotEmpty()
  topic: string;

  @IsOptional()
  @IsString()
  brandName?: string;

  @IsOptional()
  @IsString()
  targetAudience?: string;

  @IsOptional()
  @IsIn(["DOUYIN", "KUAISHOU", "WECHAT_CHANNELS", "XIAOHONGSHU"])
  platform?: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(180)
  targetDurationSeconds?: number;
}

/** 将已有草稿适配到选定渠道。默认应传 provider=mock；只有明确选择真实模型时才传 auto。 */
export class AdaptContentChannelsDto extends BaseAiOptionsDto {
  @IsOptional()
  @IsUUID()
  revisionId?: string;

  @IsArray()
  @IsString({ each: true })
  channels!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  instructions?: string;

  /** 为 true 时忽略相同原文的已有结果，重新调用模型。 */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

