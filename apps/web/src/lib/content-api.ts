import { api } from "./api";
import { contentApprovalRequest, contentDraftRequest } from "./content-contract";
export { contentApprovalRequest, contentDraftRequest } from "./content-contract";

export type DraftStatus = "DRAFT" | "READY_FOR_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "REJECTED" | "PUBLISHED" | "ARCHIVED";
export type GenerationMode = "MANUAL" | "AI_ASSISTED" | "AI_GENERATED";
export type Decision = "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
export type Channel = "XIAOHONGSHU" | "DOUYIN" | "WEIBO" | "WECHAT" | "BAIDU" | "OTHER";
export type ConnectionStatus = "CONNECTED" | "EXPIRED" | "REVOKED" | "ERROR";
export type PublicationStatus = "PENDING" | "QUEUED" | "PUBLISHING" | "PUBLISHED" | "FAILED" | "CANCELLED";

export interface Revision { id: string; version: number; body?: string; summary: string | null; changeNote: string | null; generatedById: string; createdAt: string; }
export interface Approval { id: string; decision: Decision; reviewerId: string; comment: string | null; revisionId: string; createdAt: string; }
export interface Draft { id: string; organizationId: string; projectId: string; title: string; topic: string | null; generationMode: GenerationMode; status: DraftStatus; createdById: string; createdAt: string; updatedAt: string; latestRevision: Revision | null; revisionCount: number; revisions?: Revision[]; approvals?: Approval[]; }
export interface Connection { id: string; channel: Channel; displayName: string; status: ConnectionStatus; lastVerifiedAt: string | null; createdAt: string; updatedAt: string; }
export interface Capability { channel: Channel; label: string; titleMax: number; bodyMax: number; supportsImages: boolean; publisher: "mock"; oauthImplemented: false; apiDetails: "unverified"; }
export interface PublicationAttempt { id: string; idempotencyKey: string; channel: Channel; attemptNo: number; status: PublicationStatus; publisher: string; externalId: string | null; externalUrl: string | null; errorMessage: string | null; durationMs: number | null; createdAt: string; }
export interface Publication { id: string; organizationId: string; projectId: string; draftId: string; revisionId: string; connectionId: string; channel: Channel; title: string | null; status: PublicationStatus; createdAt: string; updatedAt: string; attempts: PublicationAttempt[]; }
export interface AuditEntry { id: string; action: string; actorId: string; detail: string | null; createdAt: string; }

const encode = (id: string) => encodeURIComponent(id);
export const listContentDrafts = (projectId: string, status?: DraftStatus) => api<Draft[]>(`/projects/${encode(projectId)}/content-drafts${status ? `?status=${encode(status)}` : ""}`);
export const createContentDraft = (projectId: string, body: { title: string; topic?: string; generationMode?: GenerationMode; body: string; summary?: string; changeNote?: string }) => api<Draft>(`/projects/${encode(projectId)}/content-drafts`, { method: "POST", body: JSON.stringify(body) });
export const getContentDraft = (draftId: string) => api<Draft>(`/content-drafts/${encode(draftId)}`);
export const updateContentDraft = (draftId: string, body: { title?: string; topic?: string; generationMode?: GenerationMode; body?: string; summary?: string; changeNote?: string }) => api<Draft>(contentDraftRequest("", draftId, "update", body).path, contentDraftRequest("", draftId, "update", body).init);
export const submitContentDraft = (draftId: string) => api<Draft>(contentDraftRequest("", draftId, "submit").path, { method: "POST" });
export const decideContentDraft = (draftId: string, decision: Decision, comment?: string, revisionId?: string) => { const req = contentApprovalRequest(draftId, decision, comment, revisionId); return api<Draft & { approvalId: string }>(req.path, req.init); };
export const listContentAudit = (draftId: string) => api<AuditEntry[]>(`/content-drafts/${encode(draftId)}/audit`);
export const listChannelConnections = (projectId: string) => api<Connection[]>(`/projects/${encode(projectId)}/channel-connections`);
export const listChannelCapabilities = () => api<Capability[]>("/channels/capabilities");
export const createPublication = (projectId: string, draftId: string, body: { connectionId: string; title?: string; payload: string }) => api<Publication>(`/projects/${encode(projectId)}/content-drafts/${encode(draftId)}/publications`, { method: "POST", body: JSON.stringify(body) });
export const getPublication = (publicationId: string) => api<Publication>(`/publications/${encode(publicationId)}`);
export const processPublication = (publicationId: string) => api<Publication>(`/publications/${encode(publicationId)}/process`, { method: "POST" });
