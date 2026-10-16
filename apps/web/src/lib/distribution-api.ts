/**
 * 多平台内容分发中心 API 客户端
 * 统一连接官方授权自动发布、多端人工辅助分发包导出与真实已发布回填
 */
import { api } from "./api";

export interface DistributionChannel {
  channel: string;
  name: string;
  category: string;
  supportsAuto: boolean;
  supportsManual: boolean;
  supportsBrowserAssistant?: boolean;
  browserAssistantCapability?: "AUTOFILL_AND_CONFIRM" | "FULL_AUTOMATION" | "MANUAL_FALLBACK";
  autoCapability: "DIRECT_PUBLISH" | "DRAFT_ONLY" | "MANUAL_ONLY";
  requiresVideo: boolean;
  description: string;
  tips: string;
  limits: ChannelContentLimits | null;
  connected: boolean;
  connectionId: string | null;
  connectionName: string | null;
}

export interface ChannelContentLimits {
  title: number;
  body: number | null;
  maxTags: number | null;
}

/** 与服务端 validateChannelContentLimits 同一规则：人工渠道超限时服务端拒绝提交。 */
export function channelLimitViolations(
  limits: ChannelContentLimits | null | undefined,
  content: { title?: string; body?: string; tags?: string[] } | undefined,
): string[] {
  if (!limits || !content) return [];
  const violations: string[] = [];
  const titleLength = (content.title || "").length;
  const bodyLength = (content.body || "").length;
  const tagCount = (content.tags || []).map((t) => t.replace(/#/g, "").trim()).filter(Boolean).length;
  if (titleLength > limits.title) violations.push(`标题 ${titleLength}/${limits.title} 字`);
  if (limits.body !== null && bodyLength > limits.body) violations.push(`正文 ${bodyLength}/${limits.body} 字`);
  if (limits.maxTags !== null && tagCount > limits.maxTags) violations.push(`话题 ${tagCount}/${limits.maxTags} 个`);
  return violations;
}

/** 与服务端发布包一致：未单独维护标签时，导出正文中实际使用的 #话题。 */
export function resolvePackageHashtags(tags: string[] | undefined, body: string): string[] {
  const explicit = (tags || []).map((t) => t.replace(/#/g, "").trim()).filter(Boolean);
  const source = explicit.length > 0 ? explicit : Array.from(body.matchAll(/#([^\s#]+)#?/g), (m) => m[1].replace(/#/g, "").trim());
  return Array.from(new Set(source.filter(Boolean))).map((t) => `#${t}`);
}

export interface ManualPublishingPackage {
  channel: string;
  title: string;
  body: string;
  hashtags: string[];
  tags?: string[];
  coverUrl?: string | null;
  assetManifest: Array<{
    index: number;
    type: string;
    url: string;
    mimeType: string;
    sizeBytes?: number;
    notes?: string;
  }>;
  videoScript?: string | null;
  callToAction: string;
  checklist: string[];
  generatedAt: string;
}

export interface AdaptedChannelContent {
  channel: string;
  title: string;
  body: string;
  summary?: string;
  tags?: string[];
  coverUrl?: string | null;
  requiresVideo: boolean;
  channelSpecificPayload: Record<string, unknown>;
  manualPackage: ManualPublishingPackage;
}

export interface DistributionAdaptResult {
  draftId: string;
  revisionId: string;
  channels: AdaptedChannelContent[];
}

export interface DistributionBatchItem {
  channel: string;
  mode: "AUTO" | "MANUAL" | "SELENIUM_ASSISTED";
  title?: string;
  body?: string;
  tags?: string[];
  coverUrl?: string;
  targetStatus?: "draft" | "publish";
  videoScript?: string;
}

export interface ChannelAdaptationDraft {
  channel: string;
  title: string;
  body: string;
  hashtags: string[];
  videoScript: string | null;
  omittedClaims: string[];
  riskNotes: string[];
  adjustments: string[];
}

export interface ChannelAdaptationResult {
  draftId: string;
  revisionId: string;
  promptVersion: string;
  provider: string;
  model: string;
  realAi: boolean;
  generationSource: "mock" | "provider";
  replayed: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCost: number | null;
  latencyMs: number;
  generationId: string | null;
  channels: ChannelAdaptationDraft[];
}

export async function adaptContentWithAi(
  projectId: string,
  draftId: string,
  payload: { channels: string[]; revisionId?: string; instructions?: string; force?: boolean; provider?: "mock" | "auto" },
): Promise<ChannelAdaptationResult> {
  return api<ChannelAdaptationResult>(`/projects/${projectId}/content-drafts/${draftId}/ai/channel-adaptation`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getAiProviderStatus(): Promise<{
  realProvidersEnabled: boolean;
  providers: Array<{ provider: string; enabled: boolean; realModeAllowed: boolean }>;
}> {
  return api(`/ai/status`);
}

export interface DistributionResultItem {
  id: string;
  channel: string;
  mode: "AUTO" | "MANUAL";
  title: string;
  status: string;
  publishedAt?: string | null;
  replayed?: boolean;
  manualPackage?: ManualPublishingPackage;
  attempts?: Array<{
    id: string;
    status: string;
    publisher: string;
    externalId?: string | null;
    externalUrl?: string | null;
    errorMessage?: string | null;
    createdAt: string;
  }>;
}

export interface DistributionBatchResponse {
  draftId: string;
  revisionId: string;
  items: DistributionResultItem[];
}

export interface ConfirmManualPublishedResponse {
  publication: any;
  publishedAsset: {
    id: string;
    platform: string;
    title: string;
    canonicalUrl: string | null;
    externalAssetId: string | null;
    verificationStatus: string;
    actualPublishedAt: string | null;
    draftId: string;
    revisionId: string;
  };
}

export interface PublicationListItem {
  id: string;
  projectId: string;
  draftId: string;
  revisionId: string;
  connectionId: string;
  channel: string;
  title: string | null;
  mode?: string;
  isMock?: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  externalUrl?: string | null;
  externalId?: string | null;
  publisher?: string | null;
  accountConnection?: {
    id: string;
    channel: string;
    displayName: string;
    status: string;
  };
  attempts: Array<{
    id: string;
    attemptNo: number;
    status: string;
    publisher: string;
    externalId: string | null;
    externalUrl: string | null;
    errorMessage: string | null;
    createdAt: string;
  }>;
  publishedAssets?: Array<{
    id: string;
    canonicalUrl: string | null;
    externalAssetId?: string | null;
    verificationStatus: string;
    actualPublishedAt: string | null;
  }>;
}

export async function getDistributionChannels(projectId: string): Promise<DistributionChannel[]> {
  return api<DistributionChannel[]>(`/projects/${projectId}/distribution/channels`);
}

export async function adaptContentForChannels(
  projectId: string,
  draftId: string,
  payload: { revisionId?: string; channels: string[] },
): Promise<DistributionAdaptResult> {
  return api<DistributionAdaptResult>(`/projects/${projectId}/content-drafts/${draftId}/distribution/adapt`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function batchDistribute(
  projectId: string,
  draftId: string,
  payload: { revisionId?: string; autoApprove?: boolean; idempotencyKey?: string; items: DistributionBatchItem[] },
): Promise<DistributionBatchResponse> {
  return api<DistributionBatchResponse>(`/projects/${projectId}/content-drafts/${draftId}/distribution/batch`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function confirmManualPublished(
  publicationId: string,
  payload: {
    canonicalUrl?: string;
    externalAssetId?: string;
    actualPublishedAt?: string;
    verificationNote?: string;
    title?: string;
    idempotencyKey?: string;
  },
): Promise<ConfirmManualPublishedResponse> {
  return api<ConfirmManualPublishedResponse>(`/publications/${publicationId}/confirm-manual-published`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listProjectPublications(
  projectId: string,
  query?: { page?: number; pageSize?: number; limit?: number; offset?: number; channel?: string; status?: string },
): Promise<{ items: PublicationListItem[]; total: number; page?: number; pageSize?: number }> {
  const sp = new URLSearchParams();
  if (query?.page) sp.set("page", String(query.page));
  if (query?.pageSize) sp.set("pageSize", String(query.pageSize));
  if (query?.limit) sp.set("limit", String(query.limit));
  if (query?.offset) sp.set("offset", String(query.offset));
  if (query?.channel) sp.set("channel", query.channel);
  if (query?.status) sp.set("status", query.status);
  const qStr = sp.toString() ? `?${sp.toString()}` : "";
  return api<{ items: PublicationListItem[]; total: number; page?: number; pageSize?: number }>(`/projects/${projectId}/publications${qStr}`);
}

export async function getPublicationManualPackage(publicationId: string): Promise<ManualPublishingPackage> {
  return api<ManualPublishingPackage>(`/publications/${publicationId}/manual-package`);
}

export async function processPublicationRetry(publicationId: string): Promise<any> {
  return api<any>(`/publications/${publicationId}/process`, {
    method: "POST",
  });
}

export async function getAssistantPairingInfo(): Promise<{
  configured: boolean;
  port: number;
  token: string | null;
  url: string;
}> {
  return api(`/distribution/assistant-pairing`);
}
