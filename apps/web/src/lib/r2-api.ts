export type ActivityType = "MONITOR" | "BENCHMARK" | "MANUAL" | "EXPERIMENT" | "RETEST";

export type ActivityStatus =
  | "PENDING"
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "PARTIAL"
  | "FAILED"
  | "CANCELLED"
  | "AWAITING_MANUAL_INPUT"
  | "SKIPPED"
  | string;

export type ActivityAvailableAction = "CANCEL" | "RERUN" | "CONTINUE_INPUT";

export type ActivityItem = {
  id: string;
  type: ActivityType;
  projectId: string;
  projectName: string;
  suiteId?: string | null;
  suiteName?: string | null;
  suiteVersion?: string | null;
  engineLabel?: string | null;
  status: ActivityStatus;
  completed?: number | null;
  total?: number | null;
  progress?: { completed: number | null; total: number | null; label: string | null } | null;
  createdAt: string;
  completedAt?: string | null;
  startable?: boolean;
  resultUrl?: string | null;
  resultType?: string | null;
  resultId?: string | null;
  availableActions?: ActivityAvailableAction[] | null;
};

export type ActivityResponse = {
  items: ActivityItem[];
  page: number;
  pageSize: number;
  total: number;
};

export type ActivityFilters = {
  projectId: string;
  type?: ActivityType | "";
  status?: string;
  q?: string;
  page: number;
  pageSize: number;
};

export type QuerySemanticType = "DISCOVERY" | "BRANDED_SANITY" | "CUSTOM";
export type QueryContaminationStatus = "CLEAN" | "POSSIBLE_TARGET_MENTION" | "TARGET_MENTIONED";
export type QueryStatusFilter = "enabled" | "disabled";
export type QuerySort = "createdAt" | "queryText" | "queryType" | "status";
export type SortOrder = "asc" | "desc";

export type QueryListItem = {
  id: string;
  suiteId: string;
  suiteName: string;
  suiteVersion: string;
  queryText: string;
  category: string;
  intent: string;
  locale: string;
  enabled: boolean;
  archived: boolean;
  sanity: boolean;
  queryType: QuerySemanticType | null;
  source: string | null;
  contamination: { status: QueryContaminationStatus; matchedAlias?: string | null } | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type QueryListResponse = {
  items: QueryListItem[];
  page: number;
  pageSize: number;
  total: number;
};

export type QueryListFilters = {
  suiteId: string;
  q?: string;
  status?: QueryStatusFilter | "";
  type?: QuerySemanticType | "";
  contamination?: QueryContaminationStatus | "";
  sort?: QuerySort;
  order?: SortOrder;
  page: number;
  pageSize: number;
};

export type BatchOperation = "enable" | "disable" | "archive" | "move";

export type BatchOperationRequest = {
  operation: BatchOperation;
  queryIds: string[];
  targetSuiteId?: string;
};

export type BatchOperationResult = {
  operation: BatchOperation;
  affected: number;
  queryIds: string[];
  fromSuites?: string[];
  toSuiteId?: string;
  note?: string;
};

export type ProjectSuiteOption = {
  id: string;
  name: string;
  version: string;
};

export type RunType = "demo" | "real";

export type RunPreflightRequest = {
  suiteId: string;
  engineIds: string[];
  runType: RunType;
};

export type RunPreflight = {
  suiteId?: string;
  queryCount: number;
  engineCount: number;
  estimatedCalls: number;
  runType?: RunType;
  estimatedCost?: number | null;
  pricing?: number | null;
  currency?: string | null;
  providerDisabled?: boolean;
  providerUnavailable?: boolean;
  blocked?: boolean;
  blockedReason?: string | null;
  reason?: string | null;
  note?: string | null;
};

export const RUN_PREFLIGHT_PENDING_MESSAGE = "后端服务暂未提供当前问题集的运行预检能力";

export class BackendCapabilityPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendCapabilityPendingError";
  }
}

function appendDefined(params: URLSearchParams, key: string, value: string | number | undefined): void {
  if (value === undefined || value === "") return;
  params.set(key, String(value));
}

export function buildActivityPath(filters: ActivityFilters): string {
  const params = new URLSearchParams();
  appendDefined(params, "projectId", filters.projectId);
  appendDefined(params, "type", filters.type);
  appendDefined(params, "status", filters.status);
  appendDefined(params, "q", filters.q?.trim());
  appendDefined(params, "page", filters.page);
  appendDefined(params, "pageSize", filters.pageSize);
  return `/activity?${params.toString()}`;
}

/** PROVISIONAL CONTRACT: keep this route isolated from page components. */
export function buildQueryListPath(projectId: string, filters: QueryListFilters): string {
  const params = new URLSearchParams();
  appendDefined(params, "suiteId", filters.suiteId);
  appendDefined(params, "q", filters.q?.trim());
  appendDefined(params, "status", filters.status);
  appendDefined(params, "type", filters.type);
  appendDefined(params, "contamination", filters.contamination);
  appendDefined(params, "sort", filters.sort);
  appendDefined(params, "order", filters.order);
  appendDefined(params, "page", filters.page);
  appendDefined(params, "pageSize", filters.pageSize);
  return `/projects/${encodeURIComponent(projectId)}/queries?${params.toString()}`;
}

/** PROVISIONAL CONTRACT: keep this route and body isolated from page components. */
export function buildBatchRequest(
  projectId: string,
  input: BatchOperationRequest,
): { path: string; body: BatchOperationRequest } {
  return {
    path: `/projects/${encodeURIComponent(projectId)}/queries/batch`,
    body: {
      operation: input.operation,
      queryIds: [...input.queryIds],
      ...(input.targetSuiteId ? { targetSuiteId: input.targetSuiteId } : {}),
    },
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { api } = await import("@/lib/api");
  return api<T>(path, init);
}

export function listActivity(filters: ActivityFilters, signal?: AbortSignal): Promise<ActivityResponse> {
  return request<ActivityResponse>(buildActivityPath(filters), { signal });
}

export function getActivityActions(item: ActivityItem): ActivityAvailableAction[] {
  return item.availableActions ? [...item.availableActions] : [];
}

export function listQueries(projectId: string, filters: QueryListFilters, signal?: AbortSignal): Promise<QueryListResponse> {
  return request<QueryListResponse>(buildQueryListPath(projectId, filters), { signal });
}

export function runQueryBatch(projectId: string, input: BatchOperationRequest): Promise<BatchOperationResult> {
  const { path, body } = buildBatchRequest(projectId, input);
  return request<BatchOperationResult>(path, { method: "POST", body: JSON.stringify(body) });
}

export function listProjectSuites(projectId: string): Promise<ProjectSuiteOption[]> {
  return request<ProjectSuiteOption[]>(`/projects/${encodeURIComponent(projectId)}/benchmark-suites`);
}

/**
 * The observed endpoint is not suite-scoped yet. Do not call it with a guessed
 * compatibility payload; update only this adapter when the real contract lands.
 */
export async function loadRunPreflight(_projectId: string, _input: RunPreflightRequest): Promise<RunPreflight> {
  throw new BackendCapabilityPendingError(RUN_PREFLIGHT_PENDING_MESSAGE);
}

export function isBackendCapabilityPending(cause: unknown): cause is BackendCapabilityPendingError {
  return cause instanceof BackendCapabilityPendingError;
}

export function formatPreflightCost(preflight: RunPreflight): string {
  const amount = preflight.estimatedCost ?? preflight.pricing;
  if (amount === null || amount === undefined) return "预计费用：暂不可估算";
  return `预计费用：${preflight.currency ? `${preflight.currency} ` : ""}${amount}`;
}

export function getPreflightBlockedReason(preflight: RunPreflight): string | null {
  if (!preflight.blocked && !preflight.providerDisabled && !preflight.providerUnavailable) return null;
  if (preflight.blockedReason?.trim()) return preflight.blockedReason.trim();
  if (preflight.reason?.trim()) return preflight.reason.trim();
  if (preflight.providerDisabled) return "所选 Provider 未启用";
  if (preflight.providerUnavailable) return "所选 Provider 当前不可用";
  return "当前运行条件不允许提交";
}

export function togglePageSelection(
  selected: ReadonlySet<string>,
  pageIds: readonly string[],
  checked: boolean,
): Set<string> {
  const next = new Set(selected);
  pageIds.forEach(id => checked ? next.add(id) : next.delete(id));
  return next;
}

export function clearProcessedSelection(
  selected: ReadonlySet<string>,
  processedIds: readonly string[],
): Set<string> {
  const next = new Set(selected);
  processedIds.forEach(id => next.delete(id));
  return next;
}
