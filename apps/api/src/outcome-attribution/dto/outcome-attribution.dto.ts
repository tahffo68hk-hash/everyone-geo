import { IsOptional, IsString } from "class-validator";

export class GenerateAttributionDto {
  @IsOptional()
  @IsString()
  attributionVersion?: string;
}

export type AttributionStatus =
  | "LIKELY_RELATED"
  | "INSUFFICIENT_EVIDENCE"
  | "CONFOUNDED"
  | "NO_OBSERVED_CHANGE";

export type ObservedChangeType = "POSITIVE" | "NEGATIVE" | "MIXED" | "NEUTRAL" | "NO_CHANGE";

export type CitationMatchStatus =
  | "DIRECT_ASSET_CITATION"
  | "SAME_DOMAIN_OTHER_PAGE"
  | "NO_ASSET_CITATION"
  | "UNKNOWN";

export type QueryTargetingStatus = "EXPLICIT_TARGET" | "STRATEGY_TARGET" | "NOT_TARGETED" | "UNKNOWN";

export type TemporalOrderingStatus = "VALID_ORDER" | "INVALID_ORDER" | "UNKNOWN";

export interface SignalsSnapshot {
  baselineCompatibility: string;
  temporalOrdering: {
    status: TemporalOrderingStatus;
    baselineAt: string | null;
    publishedAt: string | null;
    retestAt: string | null;
  };
  assetVerification: {
    status: string;
    verified: boolean;
  };
  queryTargeting: {
    status: QueryTargetingStatus;
    matchedQueryId?: string;
    matchedQueryText?: string;
  };
  citationMatch: {
    status: CitationMatchStatus;
    assetCanonicalUrl?: string | null;
    matchedUrl?: string;
    domainMatched?: string;
  };
  observedChange: {
    hasChange: boolean;
    type: ObservedChangeType;
    details: any;
  };
}

export interface ConfoundersSnapshot {
  hasConfounders: boolean;
  multipleInterventions: {
    detected: boolean;
    confoundingAssetIds: string[];
  };
  modelChanged: boolean;
  retrievalModeChanged: boolean;
  providerChanged: boolean;
  sourceTypeChanged: boolean;
  unverifiedAsset: boolean;
  baselineWarning: boolean;
  list: string[];
}

export interface RunAttributionSummary {
  retestRunId: string;
  publishedAssetId: string;
  attributionVersion: string;
  totalOutcomes: number;
  likelyRelatedCount: number;
  insufficientEvidenceCount: number;
  confoundedCount: number;
  noObservedChangeCount: number;
  positiveObservedChangeCount: number;
  negativeObservedChangeCount: number;
  directAssetCitationCount: number;
}
