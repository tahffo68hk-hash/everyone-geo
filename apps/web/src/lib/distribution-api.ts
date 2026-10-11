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
  autoCapability: "DIRECT_PUBLISH" | "DRAFT_ONLY" | "MANUAL_ONLY";
  requiresVideo: boolean;
  description: string;
  tips: string;
  connected: boolean;
  connectionId: string | null;
  connectionName: string | null;
}

export interface ManualPublishingPackage {
  channel: string;
  title: string;
  body: string;
  hashtags: string[];
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
  mode: "AUTO" | "MANUAL";
  title?: string;
  body?: string;
  tags?: string[];
  coverUrl?: string;
  targetStatus?: "draft" | "publish";
}

export interface DistributionResultItem {
  id: string;
  channel: string;
  mode: "AUTO" | "MANUAL";
  title: string;
  status: string;
  publishedAt?: string | null;
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
  status: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
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
  payload: { revisionId?: string; autoApprove?: boolean; items: DistributionBatchItem[] },
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
  },
): Promise<ConfirmManualPublishedResponse> {
  return api<ConfirmManualPublishedResponse>(`/publications/${publicationId}/confirm-manual-published`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listProjectPublications(
  projectId: string,
  query?: { limit?: number; offset?: number; channel?: string; status?: string },
): Promise<{ items: PublicationListItem[]; total: number }> {
  const sp = new URLSearchParams();
  if (query?.limit) sp.set("limit", String(query.limit));
  if (query?.offset) sp.set("offset", String(query.offset));
  if (query?.channel) sp.set("channel", query.channel);
  if (query?.status) sp.set("status", query.status);
  const qStr = sp.toString() ? `?${sp.toString()}` : "";
  return api<{ items: PublicationListItem[]; total: number }>(`/projects/${projectId}/publications${qStr}`);
}

export async function getPublicationManualPackage(publicationId: string): Promise<ManualPublishingPackage> {
  return api<ManualPublishingPackage>(`/publications/${publicationId}/manual-package`);
}

export async function processPublicationRetry(publicationId: string): Promise<any> {
  return api<any>(`/publications/${publicationId}/process`, {
    method: "POST",
  });
}
