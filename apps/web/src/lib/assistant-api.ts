/**
 * GeoLens 本地浏览器助手 (Selenium Local Assistant) 客户端库
 * 运行在用户前端，与本机 127.0.0.1:8765 上的受控助手安全通信
 */

export interface AssistantHealth {
  status: string;
  service: string;
  version: string;
  auth_enabled: boolean;
}

export interface AssistantChannelInfo {
  channel: string;
  is_fully_automated: boolean;
  capability: "AUTOFILL_AND_CONFIRM" | "FULL_AUTOMATION" | "MANUAL_FALLBACK";
  creator_url: string;
}

export interface AssistantStatus {
  channels: AssistantChannelInfo[];
  active_drivers_count: number;
  profiles_dir: string;
}

export interface ValidationDiff {
  passed: boolean;
  title_match: boolean;
  title_expected: string;
  title_actual: string;
  body_match: boolean;
  body_length_expected: number;
  body_length_actual: number;
  media_count_expected: number;
  media_count_actual: number;
  tags_match: boolean;
  tags_expected: string[];
  tags_actual: string[];
  discrepancies: string[];
}

export interface StepLogItem {
  step: string;
  name: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";
  message: string;
  timestamp: string;
  duration_ms?: number | null;
  data?: Record<string, unknown> | null;
}

export interface AssistantManualPackage {
  channel: string;
  title: string;
  body: string;
  hashtags: string[];
  media_items: Array<{
    index: number;
    type: string;
    url: string;
    local_path?: string | null;
    mime_type: string;
    notes?: string | null;
  }>;
  creator_url: string;
  checklist: string[];
  instructions: string;
  generated_at: string;
}

export interface TaskStatusResponse {
  task_id: string;
  channel: string;
  account_id: string;
  status:
    | "WAITING_FOR_LOGIN"
    | "PENDING_ACCOUNT_AUTH"
    | "READY"
    | "FILLING"
    | "FILLED"
    | "AWAITING_CONFIRMATION"
    | "SUBMITTED"
    | "PENDING_REVIEW"
    | "PUBLISHED"
    | "FAILED"
    | "MANUAL_REQUIRED";
  current_step: string | null;
  steps: StepLogItem[];
  validation: ValidationDiff | null;
  manual_package: AssistantManualPackage | null;
  error_message: string | null;
  is_paused: boolean;
  is_manual_takeover: boolean;
  browser_running: boolean;
  published_url: string | null;
  external_asset_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePublishTaskPayload {
  task_id: string;
  channel: string;
  account_id?: string;
  title: string;
  body: string;
  tags?: string[];
  media_items?: Array<{
    index: number;
    type: string;
    url: string;
    local_path?: string | null;
    mime_type?: string;
    notes?: string | null;
  }>;
  cover_url?: string | null;
  source_draft_id?: string | null;
  source_revision_id?: string | null;
  publication_id?: string | null;
  headless?: boolean;
}

export class BrowserAssistantClient {
  private baseUrl: string;
  private token: string | null;

  constructor(baseUrl = "http://127.0.0.1:8765", token: string | null = null) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, "");
  }

  getBaseUrl() {
    return this.baseUrl;
  }

  getToken() {
    return this.token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> || {}),
    };

    if (this.token) {
      headers["X-Assistant-Token"] = this.token;
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const detail = errBody.detail || errBody.message || `助手接口调用失败 (${res.status})`;
      throw new Error(detail);
    }

    return res.json() as Promise<T>;
  }

  async checkHealth(): Promise<AssistantHealth> {
    const url = `${this.baseUrl}/api/health`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`无法连接本地浏览器助手 (${res.status})`);
    return res.json();
  }

  async getAuthInfo(): Promise<{ token: string; allowed_origins: string[] }> {
    return this.request("/api/auth-info");
  }

  async getStatus(): Promise<AssistantStatus> {
    return this.request("/api/status");
  }

  async launchBrowser(channel: string, accountId = "default", headless = false) {
    return this.request<{ success: boolean; channel: string; profile_path: string; message: string }>(
      "/api/browser/launch",
      {
        method: "POST",
        body: JSON.stringify({ channel, account_id: accountId, headless }),
      }
    );
  }

  async closeBrowser(channel: string, accountId = "default") {
    return this.request<{ success: boolean; closed: boolean }>("/api/browser/close", {
      method: "POST",
      body: JSON.stringify({ channel, account_id: accountId }),
    });
  }

  async openLoginPage(channel: string, accountId = "default") {
    return this.request<{
      success: boolean;
      channel: string;
      account_id: string;
      message: string;
      current_url?: string;
    }>("/api/browser/open-login", {
      method: "POST",
      body: JSON.stringify({ channel, account_id: accountId }),
    });
  }

  async checkLogin(channel: string, accountId = "default") {
    return this.request<{
      channel: string;
      is_logged_in: boolean;
      message: string;
      extra?: Record<string, unknown>;
    }>("/api/browser/check-login", {
      method: "POST",
      body: JSON.stringify({ channel, account_id: accountId }),
    });
  }

  async clearProfile(channel: string, accountId = "default") {
    return this.request<{ success: boolean; message: string }>("/api/browser/clear-profile", {
      method: "POST",
      body: JSON.stringify({ channel, account_id: accountId }),
    });
  }

  async startTask(payload: CreatePublishTaskPayload): Promise<TaskStatusResponse> {
    return this.request<TaskStatusResponse>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getTask(taskId: string): Promise<TaskStatusResponse> {
    return this.request<TaskStatusResponse>(`/api/tasks/${taskId}`);
  }

  async pauseTask(taskId: string) {
    return this.request<{ success: boolean; message: string }>(`/api/tasks/${taskId}/pause`, {
      method: "POST",
    });
  }

  async resumeTask(taskId: string) {
    return this.request<{ success: boolean; message: string }>(`/api/tasks/${taskId}/resume`, {
      method: "POST",
    });
  }

  async cancelTask(taskId: string) {
    return this.request<{ success: boolean; message: string }>(`/api/tasks/${taskId}/cancel`, {
      method: "POST",
    });
  }

  async manualTakeover(taskId: string) {
    return this.request<{
      success: boolean;
      message: string;
      manual_package: AssistantManualPackage | null;
    }>(`/api/tasks/${taskId}/takeover`, {
      method: "POST",
    });
  }

  async confirmPublish(taskId: string, payload: {
    canonicalUrl?: string;
    externalAssetId?: string;
    actualPublishedAt?: string;
    verificationNote?: string;
    status?: string;
  }) {
    return this.request<{
      success: boolean;
      status: string;
      message: string;
      published_url: string | null;
      external_asset_id: string | null;
    }>(`/api/tasks/${taskId}/confirm`, {
      method: "POST",
      body: JSON.stringify({
        canonical_url: payload.canonicalUrl,
        external_asset_id: payload.externalAssetId,
        actual_published_at: payload.actualPublishedAt,
        verification_note: payload.verificationNote,
        status: payload.status || "PUBLISHED",
      }),
    });
  }

  async simulateConfirm(taskId: string) {
    return this.request<{
      success: boolean;
      status: string;
      published_url: string;
      external_asset_id: string;
    }>(`/api/tasks/${taskId}/simulate-confirm`, {
      method: "POST",
    });
  }

  async downloadTaskPackageZip(taskId: string): Promise<Blob> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers["X-Assistant-Token"] = this.token;
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    const res = await fetch(`${this.baseUrl}/api/tasks/${taskId}/download-package`, {
      headers,
    });
    if (!res.ok) throw new Error("下载发布包失败");
    return res.blob();
  }

  async exportPackageZip(payload: {
    channel: string;
    title: string;
    body: string;
    tags: string[];
    media_items?: any[];
  }): Promise<Blob> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.token) {
      headers["X-Assistant-Token"] = this.token;
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    const res = await fetch(`${this.baseUrl}/api/package/export-zip`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("导出人工发布包失败");
    return res.blob();
  }
}

export const assistantClient = new BrowserAssistantClient();
