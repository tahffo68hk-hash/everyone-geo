import { api } from "./api";

export interface AiResponseMeta<T = unknown> {
  content: string;
  data: T;
  provider: string;
  requestedProvider: "deepseek" | "qwen" | "mock" | "auto";
  model: string;
  requestedModel: string;
  actualModel: string | null;
  promptVersion: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCost: number | null;
  latencyMs: number;
  generationId?: string;
}

export interface AiProviderInfo {
  provider: string;
  configured: boolean;
  hasKey: boolean;
  enabled: boolean;
  realModeAllowed: boolean;
  availability: "available" | "not_checked" | "disabled" | "missing";
  lastErrorCode: string | null;
  defaultModel: string;
  baseUrl: string;
}

export interface AiStatusResponse {
  realProvidersEnabled: boolean;
  providers: AiProviderInfo[];
}

export interface AiGenerationRecord {
  id: string;
  feature: string;
  provider: string;
  model: string;
  promptVersion: string;
  status: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: string;
  latencyMs?: number;
  createdAt: string;
}

export interface BaseAiOptions {
  provider?: "deepseek" | "qwen" | "mock" | "auto";
  model?: string;
  temperature?: number;
  maxTokens?: number;
  idempotencyKey?: string;
  channel?: string;
  [key: string]: unknown;
}

// -------------------------------------------------------------
// Request & Response Contract Types
// -------------------------------------------------------------

// 1. Query Set
export interface GenerateQuerySetRequest extends BaseAiOptions {
  brandName?: string;
  productName?: string;
  category?: string;
  targetAudience?: string;
  competitors?: string[];
  scenarios?: string;
  businessDesc?: string;
  queryCount?: number;
}
export interface QuerySetResult {
  querySetName: string;
  description: string;
  queries: Array<{
    text: string;
    category: string;
    intent: string;
    queryType: string;
    rationale: string;
  }>;
}

// 2. Query Expansion
export interface ExpandQueriesRequest extends BaseAiOptions {
  querySetId?: string;
  existingQueries: string[];
  count?: number;
  focusAngle?: string;
}
export interface QueryExpansionResult {
  expandedQueries: Array<{
    text: string;
    category: string;
    intent: string;
    queryType: string;
    rationale: string;
  }>;
}

// 3. Query Rewrite
export interface RewriteQueryRequest extends BaseAiOptions {
  queryText?: string;
  mode?: "natural" | "decision" | "comparative" | "discovery";
}
export interface QueryRewriteResult {
  originalQuery: string;
  rewrittenQueries: Array<{
    text: string;
    explanation: string;
    targetIntent: string;
  }>;
}

// 4. Query Classify
export interface ClassifyQueryRequest extends BaseAiOptions {
  queryText?: string;
}
export interface QueryClassifyResult {
  intent: string;
  category: string;
  queryType: string;
  confidence: number;
  rationale: string;
}

// 5. GEO Topics Detection
export interface DetectGeoTopicsRequest extends BaseAiOptions {
  brandName?: string;
  productName?: string;
  category?: string;
  siteContent?: string;
  queryTexts?: string[];
  competitors?: string[];
}
export interface GeoTopicsResult {
  coreTopics: string[];
  geoTopics: Array<{
    name: string;
    description: string;
    userIntent: string;
    importance: string;
  }>;
  entities: Array<{
    name: string;
    type: string;
    aliases: string[];
  }>;
  comparisonDimensions: string[];
  decisionDimensions: string[];
}

// 6. GEO Keywords Extraction
export interface ExtractGeoKeywordsRequest extends BaseAiOptions {
  text?: string;
  topic?: string;
  count?: number;
}
export interface GeoKeywordsResult {
  keywords: Array<{
    keyword: string;
    type: string;
    intent: string;
    importance: string;
    reason: string;
    relatedQueries: string[];
  }>;
}

// 7. Keyword Gap Analysis
export interface AnalyzeKeywordGapRequest extends BaseAiOptions {
  projectQueries?: string[];
  competitorNames?: string[];
  evidenceNotes?: string[];
}
export interface KeywordGapResult {
  gaps: Array<{
    topic: string;
    entity: string;
    gapType: string;
    rationale: string;
    recommendedQueries: string[];
    suggestedContentType: string;
  }>;
  disclaimer: string;
}

// 8. Clustering
export interface ClusterAiItemsRequest extends BaseAiOptions {
  items?: string[];
  type?: "query" | "keyword" | "topic";
  clusterCount?: number;
}
export interface ClusteringResult {
  clusters: Array<{
    clusterName: string;
    intent: string;
    members: string[];
    recommendedUse: string;
  }>;
}

// 9. Diagnosis Explanation
export interface ExplainDiagnosisRequest extends BaseAiOptions {
  diagnosisRunId?: string;
  diagnosisSummary?: string;
  findings?: unknown[];
  evidenceSnapshots?: unknown[];
}
export interface DiagnosisExplanationResult {
  summary: string;
  explanation: string;
  keyFindings: Array<{
    point: string;
    impact: string;
    reason: string;
  }>;
  supportingEvidenceIds: string[];
  limitations: string[];
}

// 10. Recommendation Draft
export interface DraftRecommendationRequest extends BaseAiOptions {
  diagnosisId?: string;
  problemDescription?: string;
  targetQueries?: string[];
}
export interface RecommendationDraftResult {
  title: string;
  problem: string;
  action: string;
  expectedObservableSignal: string;
  priorityRationale: string;
  dependencies: string[];
  risks: string[];
}

// 11. Opportunity Draft
export interface DraftOpportunityRequest extends BaseAiOptions {
  diagnosisIds?: string[];
  targetQueries?: string[];
}
export interface OpportunityDraftResult {
  title: string;
  objective: string;
  problemStatement: string;
  priorityQueries: string[];
  suggestedContentAngle: string;
  estimatedEffort: string;
}

// 12. Strategy Draft
export interface DraftStrategyRequest extends BaseAiOptions {
  objective?: string;
  targetQueries?: string[];
  diagnosisSummaries?: string[];
  audience?: string;
}
export interface StrategyDraftResult {
  objective: string;
  priorityQuestions: string[];
  targetAudiences: string[];
  contentDirections: Array<{
    name: string;
    description: string;
    targetChannels: string[];
  }>;
  successObservationPlan: string[];
  risks: string[];
}

// 13. Campaign Draft
export interface DraftCampaignRequest extends BaseAiOptions {
  strategyId?: string;
  strategyObjective?: string;
  targetQueries?: string[];
  channels?: string[];
}
export interface CampaignDraftResult {
  campaignName: string;
  objective: string;
  targetQueries: string[];
  contentPlan: Array<{
    title: string;
    format: string;
    targetChannel: string;
    scheduledWeek: string;
    keyAngle: string;
  }>;
  channelSuggestions: string[];
  milestones: Array<{
    milestone: string;
    targetDateHint: string;
  }>;
}

// 14. Content Brief
export interface GenerateContentBriefRequest extends BaseAiOptions {
  targetQueries?: string[];
  topic?: string;
  audience?: string;
  brandContext?: string;
}
export interface ContentBriefResult {
  titleIdeas: string[];
  contentObjective: string;
  targetAudience: string;
  questionsToAnswer: string[];
  keyEntities: string[];
  outline: string[];
  evidenceRequirements: string[];
  citationRequirements: string[];
  cta: string;
}

// 15. Content Titles
export interface GenerateTitlesRequest extends BaseAiOptions {
  topic?: string;
  title?: string;
  targetQueries?: string[];
  angle?: string;
  count?: number;
}
export interface ContentTitlesResult {
  titles: Array<{
    title: string;
    style: string;
    rationale: string;
  }>;
}

// 16. Content Outline
export interface GenerateOutlineRequest extends BaseAiOptions {
  title?: string;
  topic?: string;
  targetQueries?: string[];
  audience?: string;
}
export interface ContentOutlineResult {
  outline: Array<{
    section: string;
    subpoints: string[];
    intentToSatisfy: string;
  }>;
}

// 17. Content Draft
export interface GenerateDraftRequest extends BaseAiOptions {
  title?: string;
  topic?: string;
  brandName?: string;
  brandContext?: string;
  audience?: string;
  outline?: unknown[];
  targetQueries?: string[];
  brief?: string;
  channel?: string;
}
export interface ContentDraftResult {
  title: string;
  body: string;
  summary: string;
  tags: string[];
  faqSection?: Array<{
    question: string;
    answer: string;
  }>;
}

// 18. Content Rewrite
export interface RewriteContentRequest extends BaseAiOptions {
  content?: string;
  mode?: "professional" | "concise" | "ai_friendly" | "expand" | "shorten" | "comparison" | "faq";
  instructions?: string;
}
export interface ContentRewriteResult {
  originalContent: string;
  rewrittenContent: string;
  changeSummary: string;
  diffHighlights?: string[];
}

// 19. GEO Optimization
export interface OptimizeGeoContentRequest extends BaseAiOptions {
  content?: string;
  targetQueries?: string[];
}
export interface GeoOptimizationResult {
  missingQuestions: string[];
  missingEntities: string[];
  missingFacts: string[];
  structuralFeedback: string[];
  suggestedFaq: Array<{
    question: string;
    answer: string;
  }>;
  optimizedContent: string;
}

// 20. FAQ Generation
export interface GenerateFaqRequest extends BaseAiOptions {
  content?: string;
  topic?: string;
  targetQueries?: string[];
  count?: number;
}
export interface FaqResult {
  faqs: Array<{
    question: string;
    answer: string;
    userIntent: string;
  }>;
}

// 21. Fact Risk Scan
export interface ScanFactRiskRequest extends BaseAiOptions {
  content?: string;
}
export interface FactRiskResult {
  claims: Array<{
    claim: string;
    riskLevel: string;
    needsEvidence: boolean;
    reason: string;
  }>;
  overallRisk: string;
  suggestions: string[];
}

// 22. Competitor Candidates
export interface DetectCompetitorCandidatesRequest extends BaseAiOptions {
  contentOrEvidence?: string;
  brandName?: string;
}
export interface CompetitorCandidatesResult {
  competitors: Array<{
    name: string;
    domain?: string;
    reason: string;
    overlapScore?: number;
  }>;
}

// 23. Outcome Summary
export interface SummarizeOutcomeRequest extends BaseAiOptions {
  outcomeComparisonId?: string;
  baselineScore?: number;
  retestScore?: number;
  metricsDelta?: Record<string, unknown>;
  queryResults?: unknown[];
}
export interface OutcomeSummaryResult {
  summary: string;
  majorChanges: string[];
  observedTrends: string[];
  disclaimer: string;
}

// 24. Attribution Explanation
export interface ExplainAttributionRequest extends BaseAiOptions {
  outcomeAttributionId?: string;
  attributionStatus?: string;
  signals?: Record<string, unknown>;
  confounders?: unknown[];
  reasonCodes?: unknown[];
}
export interface AttributionExplanationResult {
  explanation: string;
  keyFactors: string[];
  confoundingNotes: string[];
  attributionStatusNotice: string;
}

// 25. Report Summary
export interface SummarizeReportRequest extends BaseAiOptions {
  reportId?: string;
  overallScore?: number;
  topPerformers?: unknown[];
  lagPerformers?: unknown[];
}
export interface ReportSummaryResult {
  executiveSummary: string;
  keyFindings: string[];
  evidenceLimitations: string[];
  recommendedNextSteps: string[];
}

// 26. Learning Summary
export interface SummarizeLearningRequest extends BaseAiOptions {
  learningAggregateId?: string;
  sampleCount?: number;
  positiveCount?: number;
  negativeCount?: number;
  distribution?: Record<string, unknown>;
  contextSnapshot?: Record<string, unknown>;
}
export interface LearningSummaryResult {
  patternExplanation: string;
  scopeOfApplicability: string[];
  limitations: string[];
  testableHypotheses: string[];
  singleSampleWarning?: string;
}

// 27. Learning Actions
export interface DraftLearningActionsRequest extends BaseAiOptions {
  learningAggregateId?: string;
  patternSummary?: string;
}
export interface LearningActionsResult {
  proposedActions: Array<{
    action: string;
    why: string;
    supportingPattern: string;
    risks: string;
    whatToMeasureNext: string;
  }>;
  disclaimer: string;
}

// -------------------------------------------------------------
// API SDK Functions
// -------------------------------------------------------------

export async function getAiStatus(): Promise<AiStatusResponse> {
  return api<AiStatusResponse>("/ai/status");
}

export async function listAiGenerations(projectId: string, limit = 20): Promise<AiGenerationRecord[]> {
  return api<AiGenerationRecord[]>(`/projects/${projectId}/ai/generations?limit=${limit}`);
}

export async function generateAiQuerySet(
  projectId: string,
  payload: GenerateQuerySetRequest,
): Promise<AiResponseMeta<QuerySetResult>> {
  return api(`/projects/${projectId}/ai/query-set`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function expandAiQueries(
  projectId: string,
  payload: ExpandQueriesRequest,
): Promise<AiResponseMeta<QueryExpansionResult>> {
  return api(`/projects/${projectId}/ai/query-expansion`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function rewriteAiQuery(
  projectId: string,
  payload: RewriteQueryRequest,
): Promise<AiResponseMeta<QueryRewriteResult>> {
  return api(`/projects/${projectId}/ai/query-rewrite`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function classifyAiQuery(
  projectId: string,
  payload: ClassifyQueryRequest,
): Promise<AiResponseMeta<QueryClassifyResult>> {
  return api(`/projects/${projectId}/ai/query-classify`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function detectAiGeoTopics(
  projectId: string,
  payload: DetectGeoTopicsRequest,
): Promise<AiResponseMeta<GeoTopicsResult>> {
  return api(`/projects/${projectId}/ai/geo-topics`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function extractAiGeoKeywords(
  projectId: string,
  payload: ExtractGeoKeywordsRequest,
): Promise<AiResponseMeta<GeoKeywordsResult>> {
  return api(`/projects/${projectId}/ai/geo-keywords`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function analyzeAiKeywordGap(
  projectId: string,
  payload: AnalyzeKeywordGapRequest,
): Promise<AiResponseMeta<KeywordGapResult>> {
  return api(`/projects/${projectId}/ai/keyword-gap`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function clusterAiItems(
  projectId: string,
  payload: ClusterAiItemsRequest,
): Promise<AiResponseMeta<ClusteringResult>> {
  return api(`/projects/${projectId}/ai/cluster`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function explainAiDiagnosis(
  projectId: string,
  payload: ExplainDiagnosisRequest,
): Promise<AiResponseMeta<DiagnosisExplanationResult>> {
  return api(`/projects/${projectId}/ai/diagnosis-explanation`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function draftAiRecommendation(
  projectId: string,
  payload: DraftRecommendationRequest,
): Promise<AiResponseMeta<RecommendationDraftResult>> {
  return api(`/projects/${projectId}/ai/recommendation-draft`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function draftAiOpportunity(
  projectId: string,
  payload: DraftOpportunityRequest,
): Promise<AiResponseMeta<OpportunityDraftResult>> {
  return api(`/projects/${projectId}/ai/opportunity-draft`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function draftAiStrategy(
  projectId: string,
  payload: DraftStrategyRequest,
): Promise<AiResponseMeta<StrategyDraftResult>> {
  return api(`/projects/${projectId}/ai/strategy-draft`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function draftAiCampaign(
  projectId: string,
  payload: DraftCampaignRequest,
): Promise<AiResponseMeta<CampaignDraftResult>> {
  return api(`/projects/${projectId}/ai/campaign-draft`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function generateAiContentBrief(
  projectId: string,
  payload: GenerateContentBriefRequest,
): Promise<AiResponseMeta<ContentBriefResult>> {
  return api(`/projects/${projectId}/ai/content-brief`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function generateAiTitles(
  projectId: string,
  payload: GenerateTitlesRequest,
): Promise<AiResponseMeta<ContentTitlesResult>> {
  return api(`/projects/${projectId}/ai/content-titles`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function generateAiOutline(
  projectId: string,
  payload: GenerateOutlineRequest,
): Promise<AiResponseMeta<ContentOutlineResult>> {
  return api(`/projects/${projectId}/ai/content-outline`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function generateAiDraft(
  projectId: string,
  payload: GenerateDraftRequest,
): Promise<AiResponseMeta<ContentDraftResult>> {
  return api(`/projects/${projectId}/ai/content-draft`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function rewriteAiContent(
  projectId: string,
  payload: RewriteContentRequest,
): Promise<AiResponseMeta<ContentRewriteResult>> {
  return api(`/projects/${projectId}/ai/content-rewrite`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function optimizeAiGeoContent(
  projectId: string,
  payload: OptimizeGeoContentRequest,
): Promise<AiResponseMeta<GeoOptimizationResult>> {
  return api(`/projects/${projectId}/ai/content-geo-opt`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export const optimizeGeoContent = optimizeAiGeoContent;

export async function generateAiFaq(
  projectId: string,
  payload: GenerateFaqRequest,
): Promise<AiResponseMeta<FaqResult>> {
  return api(`/projects/${projectId}/ai/content-faq`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function scanAiFactRisk(
  projectId: string,
  payload: ScanFactRiskRequest,
): Promise<AiResponseMeta<FactRiskResult>> {
  return api(`/projects/${projectId}/ai/fact-risk-scan`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function detectAiCompetitorCandidates(
  projectId: string,
  payload: DetectCompetitorCandidatesRequest,
): Promise<AiResponseMeta<CompetitorCandidatesResult>> {
  return api(`/projects/${projectId}/ai/competitor-candidates`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function summarizeAiOutcome(
  projectId: string,
  payload: SummarizeOutcomeRequest,
): Promise<AiResponseMeta<OutcomeSummaryResult>> {
  return api(`/projects/${projectId}/ai/outcome-summary`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function explainAiAttribution(
  projectId: string,
  payload: ExplainAttributionRequest,
): Promise<AiResponseMeta<AttributionExplanationResult>> {
  return api(`/projects/${projectId}/ai/attribution-explanation`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function summarizeAiReport(
  projectId: string,
  payload: SummarizeReportRequest,
): Promise<AiResponseMeta<ReportSummaryResult>> {
  return api(`/projects/${projectId}/ai/report-summary`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function summarizeAiLearning(
  projectId: string,
  payload: SummarizeLearningRequest,
): Promise<AiResponseMeta<LearningSummaryResult>> {
  return api(`/projects/${projectId}/ai/learning-summary`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function draftAiLearningActions(
  projectId: string,
  payload: DraftLearningActionsRequest,
): Promise<AiResponseMeta<LearningActionsResult>> {
  return api(`/projects/${projectId}/ai/learning-actions`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
