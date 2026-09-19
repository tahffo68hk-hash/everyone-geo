import { api } from "./api";

export interface AiResponseMeta<T = any> {
  content: string;
  data: T;
  provider: string;
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

// 基础状态与审计
export async function getAiStatus(): Promise<AiStatusResponse> {
  return api<AiStatusResponse>("/ai/status");
}

export async function listAiGenerations(projectId: string, limit = 20): Promise<AiGenerationRecord[]> {
  return api<AiGenerationRecord[]>(`/projects/${projectId}/ai/generations?limit=${limit}`);
}

// B. Query AI
export async function generateAiQuerySet(projectId: string, payload: any): Promise<AiResponseMeta<{
  querySetName: string;
  description: string;
  queries: Array<{ text: string; category: string; intent: string; queryType: string; rationale: string }>;
}>> {
  return api(`/projects/${projectId}/ai/query-set`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function expandAiQueries(projectId: string, payload: any): Promise<AiResponseMeta<{
  expandedQueries: Array<{ text: string; category: string; intent: string; queryType: string; rationale: string }>;
}>> {
  return api(`/projects/${projectId}/ai/query-expansion`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function rewriteAiQuery(projectId: string, payload: any): Promise<AiResponseMeta<{
  originalQuery: string;
  rewrittenQueries: Array<{ text: string; explanation: string; targetIntent: string }>;
}>> {
  return api(`/projects/${projectId}/ai/query-rewrite`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function classifyAiQuery(projectId: string, payload: any): Promise<AiResponseMeta<{
  intent: string;
  category: string;
  queryType: string;
  confidence: number;
  rationale: string;
}>> {
  return api(`/projects/${projectId}/ai/query-classify`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// C. GEO Intelligence
export async function detectAiGeoTopics(projectId: string, payload: any): Promise<AiResponseMeta<{
  coreTopics: string[];
  geoTopics: Array<{ name: string; description: string; userIntent: string; importance: string }>;
  entities: Array<{ name: string; type: string; aliases: string[] }>;
  comparisonDimensions: string[];
  decisionDimensions: string[];
}>> {
  return api(`/projects/${projectId}/ai/geo-topics`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function extractAiGeoKeywords(projectId: string, payload: any): Promise<AiResponseMeta<{
  keywords: Array<{ keyword: string; type: string; intent: string; importance: string; reason: string; relatedQueries: string[] }>;
}>> {
  return api(`/projects/${projectId}/ai/geo-keywords`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function analyzeAiKeywordGap(projectId: string, payload: any): Promise<AiResponseMeta<{
  gaps: Array<{ topic: string; entity: string; gapType: string; rationale: string; recommendedQueries: string[]; suggestedContentType: string }>;
  disclaimer: string;
}>> {
  return api(`/projects/${projectId}/ai/keyword-gap`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function clusterAiItems(projectId: string, payload: any): Promise<AiResponseMeta<{
  clusters: Array<{ clusterName: string; intent: string; members: string[]; recommendedUse: string }>;
}>> {
  return api(`/projects/${projectId}/ai/cluster`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// D & E. Diagnosis & Recommendation
export async function explainAiDiagnosis(projectId: string, payload: any): Promise<AiResponseMeta<{
  summary: string;
  explanation: string;
  keyFindings: Array<{ point: string; impact: string; reason: string }>;
  supportingEvidenceIds: string[];
  limitations: string[];
}>> {
  return api(`/projects/${projectId}/ai/diagnosis-explanation`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function draftAiRecommendation(projectId: string, payload: any): Promise<AiResponseMeta<{
  title: string;
  problem: string;
  action: string;
  expectedObservableSignal: string;
  priorityRationale: string;
  dependencies: string[];
  risks: string[];
}>> {
  return api(`/projects/${projectId}/ai/recommendation-draft`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function draftAiOpportunity(projectId: string, payload: any): Promise<AiResponseMeta<{
  title: string;
  objective: string;
  problemStatement: string;
  priorityQueries: string[];
  suggestedContentAngle: string;
  estimatedEffort: string;
}>> {
  return api(`/projects/${projectId}/ai/opportunity-draft`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// F. Strategy & Campaign
export async function draftAiStrategy(projectId: string, payload: any): Promise<AiResponseMeta<{
  objective: string;
  priorityQuestions: string[];
  targetAudiences: string[];
  contentDirections: Array<{ name: string; description: string; targetChannels: string[] }>;
  successObservationPlan: string[];
  risks: string[];
}>> {
  return api(`/projects/${projectId}/ai/strategy-draft`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function draftAiCampaign(projectId: string, payload: any): Promise<AiResponseMeta<{
  campaignName: string;
  objective: string;
  targetQueries: string[];
  contentPlan: Array<{ title: string; format: string; targetChannel: string; scheduledWeek: string; keyAngle: string }>;
  channelSuggestions: string[];
  milestones: Array<{ milestone: string; targetDateHint: string }>;
}>> {
  return api(`/projects/${projectId}/ai/campaign-draft`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// G. Content Production
export async function generateAiContentBrief(projectId: string, payload: any): Promise<AiResponseMeta<{
  titleIdeas: string[];
  contentObjective: string;
  targetAudience: string;
  questionsToAnswer: string[];
  keyEntities: string[];
  outline: string[];
  evidenceRequirements: string[];
  citationRequirements: string[];
  cta: string;
}>> {
  return api(`/projects/${projectId}/ai/content-brief`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function generateAiTitles(projectId: string, payload: any): Promise<AiResponseMeta<{
  titles: Array<{ title: string; style: string; rationale: string }>;
}>> {
  return api(`/projects/${projectId}/ai/content-titles`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function generateAiOutline(projectId: string, payload: any): Promise<AiResponseMeta<{
  outline: Array<{ section: string; subpoints: string[]; intentToSatisfy: string }>;
}>> {
  return api(`/projects/${projectId}/ai/content-outline`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function generateAiDraft(projectId: string, payload: any): Promise<AiResponseMeta<{
  title: string;
  body: string;
  summary: string;
  tags: string[];
  faqSection?: Array<{ question: string; answer: string }>;
}>> {
  return api(`/projects/${projectId}/ai/content-draft`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function rewriteAiContent(projectId: string, payload: any): Promise<AiResponseMeta<{
  originalContent: string;
  rewrittenContent: string;
  changeSummary: string;
  diffHighlights?: string[];
}>> {
  return api(`/projects/${projectId}/ai/content-rewrite`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function optimizeAiGeoContent(projectId: string, payload: any): Promise<AiResponseMeta<{
  missingQuestions: string[];
  missingEntities: string[];
  missingFacts: string[];
  structuralFeedback: string[];
  suggestedFaq: Array<{ question: string; answer: string }>;
  optimizedContent: string;
}>> {
  return api(`/projects/${projectId}/ai/content-geo-opt`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function generateAiFaq(projectId: string, payload: any): Promise<AiResponseMeta<{
  faqs: Array<{ question: string; answer: string; userIntent: string }>;
}>> {
  return api(`/projects/${projectId}/ai/content-faq`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function scanAiFactRisk(projectId: string, payload: any): Promise<AiResponseMeta<{
  claims: Array<{ claim: string; riskLevel: string; needsEvidence: boolean; reason: string }>;
  overallRisk: string;
  suggestions: string[];
}>> {
  return api(`/projects/${projectId}/ai/fact-risk-scan`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// I. Outcome, Attribution & Report
export async function summarizeAiOutcome(projectId: string, payload: any): Promise<AiResponseMeta<{
  summary: string;
  majorChanges: string[];
  observedTrends: string[];
  disclaimer: string;
}>> {
  return api(`/projects/${projectId}/ai/outcome-summary`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function explainAiAttribution(projectId: string, payload: any): Promise<AiResponseMeta<{
  explanation: string;
  keyFactors: string[];
  confoundingNotes: string[];
  attributionStatusNotice: string;
}>> {
  return api(`/projects/${projectId}/ai/attribution-explanation`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function summarizeAiReport(projectId: string, payload: any): Promise<AiResponseMeta<{
  executiveSummary: string;
  keyFindings: string[];
  evidenceLimitations: string[];
  recommendedNextSteps: string[];
}>> {
  return api(`/projects/${projectId}/ai/report-summary`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// J. Learning
export async function summarizeAiLearning(projectId: string, payload: any): Promise<AiResponseMeta<{
  patternExplanation: string;
  scopeOfApplicability: string[];
  limitations: string[];
  testableHypotheses: string[];
  singleSampleWarning?: string;
}>> {
  return api(`/projects/${projectId}/ai/learning-summary`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function draftAiLearningActions(projectId: string, payload: any): Promise<AiResponseMeta<{
  proposedActions: Array<{ action: string; why: string; supportingPattern: string; risks: string; whatToMeasureNext: string }>;
  disclaimer: string;
}>> {
  return api(`/projects/${projectId}/ai/learning-actions`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
