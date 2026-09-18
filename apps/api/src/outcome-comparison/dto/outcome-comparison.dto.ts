import { IsOptional, IsString } from "class-validator";

export class GenerateOutcomeComparisonsDto {
  @IsOptional()
  @IsString()
  comparisonVersion?: string;
}

export interface BrandMentionDelta {
  before: boolean;
  after: boolean;
  change: "ABSENT_TO_PRESENT" | "PRESENT_TO_ABSENT" | "REMAINED_PRESENT" | "REMAINED_ABSENT";
  changed: boolean;
}

export interface CitationDelta {
  beforePresent: boolean;
  afterPresent: boolean;
  beforeCount: number;
  afterCount: number;
  countDelta: number;
  change: "ABSENT_TO_PRESENT" | "PRESENT_TO_ABSENT" | "REMAINED_PRESENT" | "REMAINED_ABSENT";
  changed: boolean;
}

export interface PositionDelta {
  before: number | null;
  after: number | null;
  positionDelta: number | null;
  direction: "IMPROVED" | "DECLINED" | "UNCHANGED" | "UNKNOWN";
  changed: boolean;
}

export interface RecommendationDelta {
  before: boolean;
  after: boolean;
  change: "NOT_RECOMMENDED_TO_RECOMMENDED" | "RECOMMENDED_TO_NOT_RECOMMENDED" | "REMAINED_RECOMMENDED" | "REMAINED_NOT_RECOMMENDED";
  changed: boolean;
}

export interface SentimentDelta {
  before: string;
  after: string;
  changed: boolean;
}

export interface CompetitorPresenceDelta {
  before: string[];
  after: string[];
  added: string[];
  removed: string[];
  persisted: string[];
  changed: boolean;
}

export interface OutcomeDeltaSnapshot {
  brandMention: BrandMentionDelta;
  citation: CitationDelta;
  position: PositionDelta;
  recommendation: RecommendationDelta;
  sentiment: SentimentDelta;
  competitorPresence: CompetitorPresenceDelta;
}

export interface ObservedOutcomeSummary {
  totalItems: number;
  comparableItems: number;
  warningItems: number;
  incompatibleItems: number;
  missingBaselineItems: number;
  missingRetestItems: number;

  mentionAbsentToPresent: number;
  mentionPresentToAbsent: number;
  mentionRemainedPresent: number;
  mentionRemainedAbsent: number;

  citationAbsentToPresent: number;
  citationPresentToAbsent: number;
  citationCountDeltaTotal: number;

  recommendationPositiveChanges: number;
  recommendationNegativeChanges: number;

  positionImproved: number;
  positionDeclined: number;
  positionUnchanged: number;

  competitorsObservedChangeCount: number;
}
