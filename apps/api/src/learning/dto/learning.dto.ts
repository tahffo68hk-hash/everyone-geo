import { IsOptional, IsString, IsUUID } from "class-validator";

export const DEFAULT_OBSERVATION_VERSION = "m11a-learning-observation-v1";

export type ObservationType =
  | "BRAND_MENTION_CHANGE"
  | "CITATION_CHANGE"
  | "POSITION_CHANGE"
  | "RECOMMENDATION_CHANGE"
  | "SENTIMENT_CHANGE"
  | "COMPETITOR_CHANGE"
  | "NO_OBSERVED_CHANGE"
  | "MEASUREMENT_LIMITATION"
  | "ATTRIBUTION_LIMITATION";

export type ObservationDirection =
  | "POSITIVE"
  | "NEGATIVE"
  | "NO_CHANGE"
  | "MIXED"
  | "UNKNOWN";

export class GenerateLearningObservationsDto {
  @IsOptional()
  @IsString()
  observationVersion?: string;

  @IsOptional()
  @IsUUID()
  outcomeAttributionId?: string;

  @IsOptional()
  @IsUUID()
  publishedAssetId?: string;
}

export class QueryLearningObservationsDto {
  @IsOptional()
  @IsString()
  observationType?: string;

  @IsOptional()
  @IsString()
  direction?: string;

  @IsOptional()
  @IsString()
  attributionStatus?: string;

  @IsOptional()
  @IsString()
  observationVersion?: string;
}

export interface LearningContextSnapshot {
  platform: string;
  verificationStatus: string;
  publishedAt: string | null;
  title: string;
  canonicalUrl: string | null;
  campaignId: string | null;
  campaignName: string | null;
  planItemId: string | null;
  planItemTitle: string | null;
  targetQueries: string[];
  queryTargetingStatus: string;
  queryId: string;
  queryText: string;
}

export interface LearningEvidenceSnapshot {
  baselineEvidenceId: string | null;
  retestEvidenceId: string | null;
  baselineCompatibility: string;
  comparisonStatus: string;
  deltaSummary: string;
  deltaSnapshot: any;
}

export interface LearningSignalsSnapshot {
  attributionStatus: string;
  observedChangeType: string;
  reasons: any;
  citationMatch: any;
  queryTargeting: any;
  assetVerification: any;
  temporalOrdering: any;
  confounders: any;
}

export interface LearningPatternSummary {
  aggregateKey: string;
  aggregateType: string;
  sampleCount: number;
  likelyRelatedCount: number;
  insufficientCount: number;
  confoundedCount: number;
  noChangeCount: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  supportingObservationIds: string[];
  attributionDistribution: Record<string, number>;
  summary: string;
}
