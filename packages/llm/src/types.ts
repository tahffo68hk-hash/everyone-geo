/**
 * Provider-neutral types shared by every LLM provider implementation.
 *
 * Worker processors depend on this interface only; provider-specific HTTP
 * protocols stay inside packages/llm. Adding a new provider (M6: Qwen / Kimi /
 * ...) means implementing LLMProvider and registering it - no worker rewrite.
 */

/** Providers implemented today. Future providers extend this union. */
export type ProviderKind =
  | 'mock'
  | 'deepseek'
  | 'qwen'
  | 'doubao'
  | 'kimi'
  | 'zhipu'
  | 'yuanbao'
  | 'baidu';


/** Mirrors the Prisma SourceType enum values used by Evidence.sourceType. */
export type SourceTypeValue =
  | 'official_api'
  | 'browser'
  | 'third_party_api'
  | 'manual'
  | 'estimated'
  | 'mock';

/** Mirrors the Prisma RetrievalMode enum values used by Evidence.retrievalMode. */
export type RetrievalModeValue =
  | 'api_plain'
  | 'api_web_search'
  | 'official_web_ui'
  | 'browser_agent'
  | 'manual_verified'
  | 'unknown';

/** Structural entity snapshot (brand first, then competitors). Same shape as @geo/core Entity. */
export interface LlmEntity {
  id: string;
  canonicalName: string;
  aliases: string[];
  entityType: 'brand' | 'competitor';
}

export interface ProviderRequest {
  /** Raw user query text (Query.text snapshot). */
  queryText: string;
  engineKey: string;
  engineName: string;
  /** Engine.config JSON (provider-specific tuning, never secrets). */
  engineConfig: unknown;
  /**
   * M6C model identity: the resolved requested model handed over by the Worker
   * (single source of truth = enginePresentation). Providers fall back to their
   * own resolution when absent (direct unit usage). Never assume it equals the
   * model the provider reports back.
   */
  requestedModel?: string;
  /** Zero-based delivery attempt (claimRun increments before execute). */
  attempt: number;
  /** Abort budget for this single call. */
  timeoutMs: number;
  /** Brand + competitor snapshot; mock scenarios substitute these names. */
  entities?: LlmEntity[];
}

export interface ProviderUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface StructuredCitation {
  url: string;
  title?: string;
}

/**
 * Normalized result of one provider call. `content` is the model answer body
 * (persisted as Evidence.rawResponse); rawPrompt is the exact prompt text that
 * was sent. rawProviderPayload carries sanitized provider JSON - it never
 * contains Authorization headers or secrets.
 *
 * Model identity (M6C): requestedModel is the exact model string the provider
 * was asked to use (resolved from Engine config / env at call time);
 * responseModel is the model the provider actually declared in its response
 * (null when the provider does not report one). They are NOT assumed equal.
 *
 * `model` / `modelVersion` are LEGACY fields kept for backward compatibility:
 *   - model  = responseModel when the provider reported one, else requestedModel
 *   - modelVersion = provider-reported version/identity, else null
 * New code must prefer requestedModel / responseModel.
 */
export interface ProviderResponse {
  provider: ProviderKind;
  /** Evidence classification for this provider output (never mock for real calls). */
  sourceType: SourceTypeValue;
  retrievalMode: RetrievalModeValue;
  /** Model GeoLens requested from the provider (e.g. deepseek-chat). */
  requestedModel: string;
  /** Model the provider declared in its response (e.g. deepseek-v4-flash), else null. */
  responseModel: string | null;
  /** @deprecated legacy: responseModel ?? requestedModel. */
  model: string;
  /** @deprecated legacy: provider-reported version/identity, else null. */
  modelVersion: string | null;
  content: string;
  rawPrompt: string;
  rawProviderPayload?: unknown;
  usage?: ProviderUsage;
  structuredCitations?: StructuredCitation[];
  finishReason?: string | null;
  requestId?: string | null;
  durationMs: number;
}

export interface LLMProvider {
  readonly provider: ProviderKind;
  readonly sourceType: SourceTypeValue;
  readonly retrievalMode: RetrievalModeValue;
  execute(request: ProviderRequest): Promise<ProviderResponse>;
}
