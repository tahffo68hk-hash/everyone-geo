export function contentDraftRequest(projectId: string, draftId: string, operation: "update", body: unknown): { path: string; init: { method: "PATCH"; body: string } };
export function contentDraftRequest(projectId: string, draftId: string, operation: "submit" | "archive", body?: undefined): { path: string; init: { method: "POST" } };
export function contentDraftRequest(_projectId: string, draftId: string, operation: "update" | "submit" | "archive", body?: unknown) {
  if (operation === "update") return { path: `/content-drafts/${encodeURIComponent(draftId)}`, init: { method: "PATCH" as const, body: JSON.stringify(body ?? {}) } };
  return { path: `/content-drafts/${encodeURIComponent(draftId)}/${operation}`, init: { method: "POST" as const } };
}
export function contentApprovalRequest(draftId: string, decision: string, comment?: string, revisionId?: string) {
  return { path: `/content-drafts/${encodeURIComponent(draftId)}/decide`, init: { method: "POST" as const, body: JSON.stringify({ decision, ...(comment ? { comment } : {}), ...(revisionId ? { revisionId } : {}) }) } };
}
