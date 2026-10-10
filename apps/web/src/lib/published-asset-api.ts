/**
 * 发布资产 API 客户端。
 *
 * 与内容上传素材 Asset 无关；只封装现有 PublishedAsset Controller。
 * 生产写入口仍须等待 LOC-002 修复并经本地审查解锁。
 */
import { api } from "./api";

/** 当前 Confirm/Create DTO 接受的状态，而非服务端所有历史字符串的枚举。 */
export type PublishedAssetVerificationStatus =
  | "UNVERIFIED"
  | "PLATFORM_CONFIRMED"
  | "MANUAL_VERIFIED";

/** 对应 ConfirmPublishedAssetDto；当前 DTO 不接受 publishedAt。 */
export interface ConfirmPublishedAssetInput {
  verificationStatus: PublishedAssetVerificationStatus;
  canonicalUrl?: string;
  externalAssetId?: string;
  title?: string;
  sourceType?: string;
  verificationNote?: string;
  metadata?: Record<string, unknown>;
}

/** 对应 CreatePublishedAssetDto；项目标识必须与请求路径一致。 */
export interface CreatePublishedAssetInput {
  projectId: string;
  draftId: string;
  revisionId?: string;
  publicationId?: string;
  campaignId?: string;
  scheduleItemId?: string;
  planItemId?: string;
  platform: string;
  title: string;
  canonicalUrl?: string;
  externalAssetId?: string;
  verificationStatus: PublishedAssetVerificationStatus;
  sourceType?: string;
  verificationNote?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Prisma PublishedAsset 的标量 JSON 投影，不包含关联实体。
 * DateTime 经 JSON 序列化后为 ISO 字符串；metadata 的内部结构未知。
 * publishedAt 是数据库现存字段，不能据其存在推断平台确认的发布时间。
 */
export interface PublishedAssetRecord {
  id: string;
  organizationId: string;
  projectId: string;
  publicationId: string | null;
  publicationAttemptId: string | null;
  campaignId: string | null;
  scheduleItemId: string | null;
  planItemId: string | null;
  draftId: string;
  revisionId: string;
  platform: string;
  title: string;
  canonicalUrl: string | null;
  externalAssetId: string | null;
  verificationStatus: string;
  sourceType: string;
  verifiedAt: string | null;
  verifiedById: string | null;
  verificationNote: string | null;
  publishedAt: string;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}

/** lineage.publishedAsset 的显式投影不含 publishedAt。 */
export type LineagePublishedAsset = Omit<PublishedAssetRecord, "publishedAt">;

/** 完整匹配 getPublishedAsset 的三个 include 关系，不扩充写入 DTO。 */
export type PublishedAssetWithRelations = PublishedAssetRecord & {
  draft: { id: string; title: string; status: string };
  revision: { id: string; version: number; summary: string | null };
  publication: {
    id: string;
    channel: string;
    status: string;
    title: string | null;
  } | null;
};

/**
 * 仅描述当前 Service 的 getPublishedAssetLineage return 投影。
 * diagnosis 未在来源片段中展开，保留 unknown；所有未知 JSON 不推断其结构。
 */
export interface PublishedAssetLineage {
  publishedAsset: LineagePublishedAsset;
  lineage: {
    diagnosis: unknown | null;
    strategy: {
      id: string;
      title: string;
      status: string;
      platformPriorities: unknown;
      sourceDiagnosisId: string | null;
      createdAt: string;
    } | null;
    campaign: {
      id: string;
      name: string;
      status: string;
      startDate: string;
      endDate: string;
    } | null;
    planItem: {
      id: string;
      title: string;
      platform: string;
      format: string;
      objective: string;
      status: string;
    } | null;
    scheduleItem: {
      id: string;
      scheduledDate: string;
      scheduledTime: string | null;
      timezone: string;
      productionStatus: string;
      assignedToId: string | null;
    } | null;
    draft: {
      id: string;
      title: string;
      status: string;
      topic: string | null;
      generationMode: string;
    };
    revision: {
      id: string;
      version: number;
      summary: string | null;
      changeNote: string | null;
    } | null;
    publication: {
      id: string;
      channel: string;
      status: string;
      title: string | null;
      publishedAt: string | null;
    } | null;
    publicationAttempt: {
      id: string;
      attemptNo: number;
      status: string;
      publisher: string;
      externalId: string | null;
      externalUrl: string | null;
    } | null;
  };
  provenance: {
    platform: string;
    sourceType: string;
    verificationStatus: string;
    canonicalUrl: string | null;
    externalAssetId: string | null;
    verifiedAt: string | null;
    verifiedById: string | null;
    verificationNote: string | null;
  };
}

/**
 * 构建仅含当前 DTO 已定义字段的请求体：即使运行时入参携带额外
 * publishedAt 等属性，也不会发送给服务端或伪装塞入 metadata。
 */
function confirmBody(input: ConfirmPublishedAssetInput): string {
  const {
    verificationStatus,
    canonicalUrl,
    externalAssetId,
    title,
    sourceType,
    verificationNote,
    metadata,
  } = input;
  return JSON.stringify({
    verificationStatus,
    canonicalUrl,
    externalAssetId,
    title,
    sourceType,
    verificationNote,
    metadata,
  });
}

function createBody(input: CreatePublishedAssetInput): string {
  const {
    projectId,
    draftId,
    revisionId,
    publicationId,
    campaignId,
    scheduleItemId,
    planItemId,
    platform,
    title,
    canonicalUrl,
    externalAssetId,
    verificationStatus,
    sourceType,
    verificationNote,
    metadata,
  } = input;
  return JSON.stringify({
    projectId,
    draftId,
    revisionId,
    publicationId,
    campaignId,
    scheduleItemId,
    planItemId,
    platform,
    title,
    canonicalUrl,
    externalAssetId,
    verificationStatus,
    sourceType,
    verificationNote,
    metadata,
  });
}

export function confirmPublishedAsset(
  publicationId: string,
  input: ConfirmPublishedAssetInput,
): Promise<PublishedAssetRecord> {
  return api<PublishedAssetRecord>(
    `/publications/${encodeURIComponent(publicationId)}/confirm-asset`,
    { method: "POST", body: confirmBody(input) },
  );
}

export async function createPublishedAsset(
  projectId: string,
  input: CreatePublishedAssetInput,
): Promise<PublishedAssetRecord> {
  if (projectId !== input.projectId) {
    throw new Error("项目标识不一致");
  }
  return api<PublishedAssetRecord>(
    `/projects/${encodeURIComponent(projectId)}/published-assets`,
    { method: "POST", body: createBody(input) },
  );
}

export function getPublishedAsset(
  assetId: string,
): Promise<PublishedAssetWithRelations> {
  return api<PublishedAssetWithRelations>(
    `/published-assets/${encodeURIComponent(assetId)}`,
  );
}

export function getPublishedAssetLineage(
  assetId: string,
): Promise<PublishedAssetLineage> {
  return api<PublishedAssetLineage>(
    `/published-assets/${encodeURIComponent(assetId)}/lineage`,
  );
}
