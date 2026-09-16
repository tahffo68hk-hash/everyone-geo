import { api } from "./api";
import { contentApprovalRequest, contentDraftRequest } from "./content-contract";
export { contentApprovalRequest, contentDraftRequest } from "./content-contract";

export type DraftStatus = "DRAFT" | "READY_FOR_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "REJECTED" | "PUBLISHED" | "ARCHIVED";
export type GenerationMode = "MANUAL" | "AI_ASSISTED" | "AI_GENERATED";
export type Decision = "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
export type Channel = "XIAOHONGSHU" | "DOUYIN" | "WEIBO" | "WECHAT" | "BAIDU" | "OTHER";
export type ConnectionStatus = "CONNECTED" | "EXPIRED" | "REVOKED" | "ERROR";
export type PublicationStatus = "PENDING" | "QUEUED" | "PUBLISHING" | "PUBLISHED" | "FAILED" | "CANCELLED";

export interface Revision { id: string; draftId?: string; version: number; body?: string; summary: string | null; changeNote: string | null; generationMode?: GenerationMode; generatedById: string; createdAt: string; }
export interface Approval { id: string; decision: Decision; reviewerId: string; comment: string | null; revisionId: string; createdAt: string; }
export interface Draft { id: string; organizationId: string; projectId: string; title: string; topic: string | null; generationMode: GenerationMode; status: DraftStatus; sourceOpportunityId: string | null; sourceRecommendationId: string | null; sourceDiagnosisId: string | null; sourceStrategyId?: string | null; sourcePlanItemId?: string | null; createdById: string; createdAt: string; updatedAt: string; latestRevision: Revision | null; revisionCount: number; revisions?: Revision[]; approvals?: Approval[]; }
export interface Connection { id: string; channel: Channel; displayName: string; status: ConnectionStatus; lastVerifiedAt: string | null; createdAt: string; updatedAt: string; }
export interface Capability { channel: Channel; label: string; titleMax: number; bodyMax: number; supportsImages: boolean; publisher: "mock"; oauthImplemented: false; apiDetails: "unverified"; }
export interface PublicationAttempt { id: string; idempotencyKey: string; channel: Channel; attemptNo: number; status: PublicationStatus; publisher: string; externalId: string | null; externalUrl: string | null; errorMessage: string | null; durationMs: number | null; createdAt: string; }
export interface Publication { id: string; organizationId: string; projectId: string; draftId: string; revisionId: string; connectionId: string; channel: Channel; title: string | null; status: PublicationStatus; createdAt: string; updatedAt: string; attempts: PublicationAttempt[]; }
export interface PublicationListItem { id: string; draftId: string; revisionId: string; channel: Channel; status: PublicationStatus; accountConnection: { id: string; channel: Channel; displayName: string; status: ConnectionStatus }; createdAt: string; scheduledAt: string | null; publishedAt: string | null; externalUrl: string | null; externalId: string | null; publisher: string | null; isMock: boolean; }
export interface PublicationPage { page: number; pageSize: number; total: number; items: PublicationListItem[]; }
export interface Asset { id: string; projectId: string; draftId: string | null; type: "IMAGE" | "VIDEO" | "COVER" | "AUDIO"; mimeType: string; sizeBytes: number; checksum: string; storage: string; devOnly: boolean; ownerId: string; createdAt: string; updatedAt: string; }
export interface AuditEntry { id: string; action: string; actorId: string; detail: string | null; createdAt: string; }

const encode = (id: string) => encodeURIComponent(id);
export const listContentDrafts = (projectId: string, status?: DraftStatus) => api<Draft[]>(`/projects/${encode(projectId)}/content-drafts${status ? `?status=${encode(status)}` : ""}`);
export const createContentDraft = (projectId: string, body: { title: string; topic?: string; generationMode?: GenerationMode; sourceOpportunityId?: string; sourceRecommendationId?: string; sourceDiagnosisId?: string; body: string; summary?: string; changeNote?: string }) => api<Draft>(`/projects/${encode(projectId)}/content-drafts`, { method: "POST", body: JSON.stringify(body) });
export const getContentDraft = (draftId: string) => api<Draft>(`/content-drafts/${encode(draftId)}`);
export const getContentRevision = (draftId: string, revisionId: string) => api<Revision>(`/content-drafts/${encode(draftId)}/revisions/${encode(revisionId)}`);
export const updateContentDraft = (draftId: string, body: { title?: string; topic?: string; generationMode?: GenerationMode; body?: string; summary?: string; changeNote?: string }) => api<Draft>(contentDraftRequest("", draftId, "update", body).path, contentDraftRequest("", draftId, "update", body).init);
export const submitContentDraft = (draftId: string) => api<Draft>(contentDraftRequest("", draftId, "submit").path, { method: "POST" });
export const decideContentDraft = (draftId: string, decision: Decision, comment?: string, revisionId?: string) => { const req = contentApprovalRequest(draftId, decision, comment, revisionId); return api<Draft & { approvalId: string }>(req.path, req.init); };
export const listContentAudit = (draftId: string) => api<AuditEntry[]>(`/content-drafts/${encode(draftId)}/audit`);
export const listChannelConnections = (projectId: string) => api<Connection[]>(`/projects/${encode(projectId)}/channel-connections`);
export const listChannelCapabilities = () => api<Capability[]>("/channels/capabilities");
export const listPublications = (projectId: string, filters: { page?: number; pageSize?: number; status?: PublicationStatus; channel?: Channel } = {}) => { const q = new URLSearchParams(); if (filters.page) q.set("page", String(filters.page)); if (filters.pageSize) q.set("pageSize", String(filters.pageSize)); if (filters.status) q.set("status", filters.status); if (filters.channel) q.set("channel", filters.channel); return api<PublicationPage>(`/projects/${encode(projectId)}/publications${q.toString() ? `?${q}` : ""}`); };
export const listContentAssets = (projectId: string, page = 1, pageSize = 20) => api<{ page: number; pageSize: number; total: number; items: Asset[] }>(`/projects/${encode(projectId)}/content-assets?page=${page}&pageSize=${pageSize}`);
export async function uploadContentAsset(projectId: string, input: { type: Asset["type"]; file: File; draftId?: string }) { const form = new FormData(); form.append("type", input.type); if (input.draftId) form.append("draftId", input.draftId); form.append("file", input.file); return api<Asset>(`/projects/${encode(projectId)}/content-assets`, { method: "POST", body: form }); }
export const createPublication = (projectId: string, draftId: string, body: { connectionId: string; title?: string; payload: string }) => api<Publication>(`/projects/${encode(projectId)}/content-drafts/${encode(draftId)}/publications`, { method: "POST", body: JSON.stringify(body) });
export const getPublication = (publicationId: string) => api<Publication>(`/publications/${encode(publicationId)}`);
export const processPublication = (publicationId: string) => api<Publication>(`/publications/${encode(publicationId)}/process`, { method: "POST" });

export type PlatformType = "WECHAT_OFFICIAL_ACCOUNT" | "XIAOHONGSHU" | "WEIBO" | "DOUYIN" | "BILIBILI";

export interface TextOverlayInfo {
  mainTitle: string;
  subtitle?: string;
  badge?: string;
}

export interface ImageBriefItem {
  assetType: string;
  title: string;
  prompt: string;
  negativePrompt?: string;
  style: string;
  ratio: string;
  textOverlay?: TextOverlayInfo;
  notes?: string;
}

export interface PlatformMetadata {
  tone?: string;
  outline?: string[];
  subheadings?: string[];
  hook?: string;
  cta?: string;
  wordCountTarget?: string;
  safeNotes?: string[];
  coverSuggestions?: string[];
  [key: string]: unknown;
}

export interface PlatformVariant {
  id: string;
  organizationId: string;
  projectId: string;
  draftId: string;
  sourceRevisionId: string;
  platform: PlatformType;
  contentType: string;
  generationMode: string;
  title: string;
  summary: string | null;
  body: string;
  tags: string[];
  coverText: string | null;
  imageBriefs: ImageBriefItem[];
  platformMetadata: PlatformMetadata;
  status: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentImageBriefRecord {
  id: string;
  organizationId: string;
  projectId: string;
  draftId: string;
  variantId: string | null;
  platform: PlatformType;
  assetType: string;
  title: string;
  prompt: string;
  negativePrompt: string | null;
  style: string;
  ratio: string;
  textOverlay: TextOverlayInfo | null;
  notes: string | null;
  safeFactCheck: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export const generatePlatformVariant = (draftId: string, body: { platform: PlatformType; generationMode?: string; sourceRevisionId?: string }) =>
  api<PlatformVariant>(`/content-drafts/${encode(draftId)}/variants`, { method: "POST", body: JSON.stringify(body) });

export const listPlatformVariants = (draftId: string) =>
  api<PlatformVariant[]>(`/content-drafts/${encode(draftId)}/variants`);

export const getPlatformVariant = (draftId: string, variantId: string) =>
  api<PlatformVariant>(`/content-drafts/${encode(draftId)}/variants/${encode(variantId)}`);

export const rewritePlatformVariant = (draftId: string, variantId: string, body: { mode: string; instructions?: string }) =>
  api<PlatformVariant>(`/content-drafts/${encode(draftId)}/variants/${encode(variantId)}/rewrite`, { method: "POST", body: JSON.stringify(body) });

export const applyVariantToRevision = (draftId: string, variantId: string, body?: { changeNote?: string }) =>
  api<{ draft: Draft; revision: Revision }>(`/content-drafts/${encode(draftId)}/variants/${encode(variantId)}/apply`, { method: "POST", body: JSON.stringify(body ?? {}) });

export const generateImageBriefs = (draftId: string, body: { platform: PlatformType; variantId?: string; style?: string; count?: number }) =>
  api<ContentImageBriefRecord[]>(`/content-drafts/${encode(draftId)}/image-briefs`, { method: "POST", body: JSON.stringify(body) });

export const listImageBriefs = (draftId: string) =>
  api<ContentImageBriefRecord[]>(`/content-drafts/${encode(draftId)}/image-briefs`);

// ---- V2 Content Engine Types & APIs ----

export interface VerifiedFact {
  id: string;
  claim: string;
  factType: string;
  status: string;
  sourceType: string;
  sourceRef?: string;
}

export interface ExtractedClaim {
  id: string;
  claim: string;
  category: "NUMERICAL_SPEC" | "COMPARATIVE_RANKING" | "HEALTH_MEDICAL" | "SUPERLATIVE" | "GENERAL";
  status: "VERIFIED" | "UNVERIFIED" | "CONFLICTING";
  sourceSnippet?: string;
  confidence: number;
  matchedFactId?: string;
}

export interface ClaimCheckResult {
  claims: ExtractedClaim[];
  blocking: boolean;
  unverifiedCount: number;
  conflictingCount: number;
  blockingClaims: ExtractedClaim[];
}

export interface SafeRewriteResult {
  sanitizedText: string;
  resolvedClaims: string[];
  remainingUnverifiedClaims: string[];
  changeSummary: string[];
  generationRunId: string;
}

export interface GenerationRun {
  id: string;
  organizationId: string;
  projectId: string;
  draftId: string;
  sourceRevisionId: string | null;
  platform: string;
  generationMode: string;
  provider: string;
  model: string;
  promptVersion: string;
  status: string;
  inputSnapshot: any;
  outputSnapshot: any;
  inputTokens: number | null;
  outputTokens: number | null;
  imageCount: number | null;
  costUsd: number | null;
  errorMessage: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImagePreviewOutput {
  jobId: string;
  provider: string;
  model: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  imageUrl?: string;
  sanitizedPrompt: string;
  warnings?: string[];
  generationRunId: string;
}

export const listGenerationRuns = (draftId: string) =>
  api<GenerationRun[]>(`/content-drafts/${encode(draftId)}/generation-runs`);

export const getGenerationRun = (draftId: string, runId: string) =>
  api<GenerationRun>(`/content-drafts/${encode(draftId)}/generation-runs/${encode(runId)}`);

export const listVerifiedFacts = (draftId: string) =>
  api<VerifiedFact[]>(`/content-drafts/${encode(draftId)}/facts`);

export const createVerifiedFact = (
  draftId: string,
  body: { claim: string; factType: string; status?: string; sourceType?: string; sourceRef?: string }
) => api<VerifiedFact>(`/content-drafts/${encode(draftId)}/facts`, { method: "POST", body: JSON.stringify(body) });

export const extractClaims = (draftId: string, body: { text?: string; variantId?: string } = {}) =>
  api<ClaimCheckResult>(`/content-drafts/${encode(draftId)}/extract-claims`, { method: "POST", body: JSON.stringify(body) });

export const safeRewrite = (draftId: string, body: { text?: string; variantId?: string } = {}) =>
  api<SafeRewriteResult>(`/content-drafts/${encode(draftId)}/safe-rewrite`, { method: "POST", body: JSON.stringify(body) });

export const generateImagePreview = (
  draftId: string,
  body: { prompt: string; ratio?: string; style?: string; variantId?: string; textOverlay?: TextOverlayInfo; negativePrompt?: string }
) => api<ImagePreviewOutput>(`/content-drafts/${encode(draftId)}/image-generation`, { method: "POST", body: JSON.stringify(body) });

export const acceptImageAsset = (
  draftId: string,
  jobId: string,
  body: { prompt: string; ratio: string; imageUrl?: string }
) => api<Asset>(`/content-drafts/${encode(draftId)}/image-generation/${encode(jobId)}/accept`, { method: "POST", body: JSON.stringify(body) });

// ============================================================
// M9A - Content Strategy & Planning Types & APIs
// ============================================================

export interface StrategicPriorityQuestion {
  question: string;
  intent: string;
  urgency: "P0" | "P1" | "P2";
  targetEngines: string[];
  rationale: string;
}

export interface StrategicKeyTheme {
  theme: string;
  focus: string;
  outlinePoints: string[];
}

export interface StrategicPlatformPriority {
  platform: string;
  platformLabel: string;
  priority: number;
  role: string;
  rationale: string;
  shareOfVoiceTarget: string;
}

export interface StrategicContentFormat {
  platform: string;
  format: string;
  recommendedLength: string;
  structuralTemplate: string;
  tone: string;
}

export interface StrategicEvidenceItem {
  claim: string;
  evidenceType: string;
  verified: boolean;
  sourceRef?: string;
}

export interface StrategicValidationMetric {
  metric: string;
  target: string;
  evaluationMethod: string;
  timeframe: string;
}

export interface ContentPlanItem {
  id: string;
  strategyId: string;
  organizationId: string;
  projectId: string;
  title: string;
  platform: string;
  format: string;
  objective: string;
  geoTarget: string;
  targetQueries: string[];
  keyClaims: string[];
  status: "PLANNED" | "DRAFTED" | "IN_PRODUCTION" | "COMPLETED" | "DISMISSED";
  draftId: string | null;
  sourceOpportunityId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContentStrategy {
  id: string;
  organizationId: string;
  projectId: string;
  title: string;
  sourceOpportunityId: string | null;
  sourceRecommendationId: string | null;
  sourceDiagnosisId: string | null;
  status: string;
  geoGap: string;
  priorityQuestions: StrategicPriorityQuestion[];
  targetAudience: string;
  perceptionGoal: string;
  keyThemes: StrategicKeyTheme[];
  platformPriorities: StrategicPlatformPriority[];
  contentFormats: StrategicContentFormat[];
  evidenceRequired: StrategicEvidenceItem[];
  validationMetrics: StrategicValidationMetric[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  planItems?: ContentPlanItem[];
  planItemCount?: number;
}

export const generateContentStrategy = (
  projectId: string,
  body: {
    opportunityId?: string;
    recommendationId?: string;
    diagnosisRunId?: string;
    title?: string;
    customGuidance?: string;
    targetEntity?: string;
  }
) => api<ContentStrategy>(`/projects/${encode(projectId)}/content-strategies/generate`, {
  method: "POST",
  body: JSON.stringify(body),
});

export const listContentStrategies = (projectId: string) =>
  api<{ total: number; strategies: ContentStrategy[] }>(`/projects/${encode(projectId)}/content-strategies`);

export const getContentStrategy = (strategyId: string) =>
  api<ContentStrategy>(`/content-strategies/${encode(strategyId)}`);

export const updateContentPlanItem = (
  strategyId: string,
  itemId: string,
  body: Partial<ContentPlanItem>
) => api<ContentPlanItem>(`/content-strategies/${encode(strategyId)}/plan-items/${encode(itemId)}`, {
  method: "PATCH",
  body: JSON.stringify(body),
});

export const createDraftFromPlanItem = (
  strategyId: string,
  itemId: string,
  body: { body?: string; summary?: string; changeNote?: string } = {}
) => api<{ draft: Draft; planItem: ContentPlanItem; reused: boolean }>(
  `/content-strategies/${encode(strategyId)}/plan-items/${encode(itemId)}/create-draft`,
  { method: "POST", body: JSON.stringify(body) }
);



