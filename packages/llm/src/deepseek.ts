import { performance } from 'node:perf_hooks';
import {
  ProviderAuthError, ProviderBadRequestError, ProviderDisabledError,
  ProviderEmptyResponseError, ProviderInvalidResponseError, ProviderNetworkError,
  ProviderNotConfiguredError, ProviderRateLimitError, ProviderServerError,
  ProviderTimeoutError,
} from './errors';
import { readRealProviderEnv } from './config';
import type { LLMProvider, ProviderRequest, ProviderResponse, ProviderUsage } from './types';

/**
 * DeepSeek official Chat Completions API provider (OpenAI-compatible shape).
 *
 * - HTTP only: standard fetch + AbortController timeout (no heavy SDK).
 * - Never retries internally; classifies errors for the Worker retry policy.
 * - Secret handling: the API key is read from the environment for the request
 *   and is never part of any returned payload, error message or metadata.
 * - Evidence classification: sourceType=official_api, retrievalMode=api_plain
 *   (this is the DeepSeek API, NOT a web-search product).
 */

/** Minimal fetch shape so unit tests can inject a transport without real HTTP. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}
export type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}) => Promise<FetchResponseLike>;

export interface DeepSeekProviderOptions {
  fetch?: FetchLike;
  env?: NodeJS.ProcessEnv;
}

interface DeepSeekRequestOptions {
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

function readConfig(config: unknown): DeepSeekRequestOptions {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return {};
  const row = config as Record<string, unknown>;
  const options: DeepSeekRequestOptions = {};
  if (typeof row.model === 'string' && row.model.trim() !== '') options.model = row.model;
  if (typeof row.systemPrompt === 'string' && row.systemPrompt.trim() !== '') options.systemPrompt = row.systemPrompt;
  if (typeof row.temperature === 'number' && Number.isFinite(row.temperature) && row.temperature >= 0 && row.temperature <= 2) options.temperature = row.temperature;
  if (typeof row.maxTokens === 'number' && Number.isInteger(row.maxTokens) && row.maxTokens >= 1 && row.maxTokens <= 32_768) options.maxTokens = row.maxTokens;
  return options;
}

async function defaultFetch(url: string, init: Parameters<typeof fetch>[1]): Promise<FetchResponseLike> {
  return fetch(url, init);
}

export class DeepSeekProvider implements LLMProvider {
  readonly provider = 'deepseek' as const;
  readonly sourceType = 'official_api' as const;
  readonly retrievalMode = 'api_plain' as const;
  private readonly fetchImpl: FetchLike;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: DeepSeekProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? (defaultFetch as FetchLike);
    this.env = options.env ?? process.env;
  }

  async execute(request: ProviderRequest): Promise<ProviderResponse> {
    const started = performance.now();
    const cfg = readRealProviderEnv(this.env);
    // Cost-safety gate: real calls are disabled unless explicitly enabled.
    if (!cfg.realProvidersEnabled) throw new ProviderDisabledError();
    if (cfg.apiKey === null) throw new ProviderNotConfiguredError();
    const options = readConfig(request.engineConfig);
    const model = options.model ?? cfg.model;
    const timeoutMs = Math.max(1000, Math.min(120_000, request.timeoutMs || cfg.timeoutMs));
    const messages = options.systemPrompt
      ? [{ role: 'system', content: options.systemPrompt }, { role: 'user', content: request.queryText }]
      : [{ role: 'user', content: request.queryText }];
    const rawPrompt = JSON.stringify({ model, messages });
    const body: Record<string, unknown> = { model, messages, stream: false };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: FetchResponseLike;
    try {
      response = await this.fetchImpl(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error)) throw new ProviderTimeoutError();
      throw new ProviderNetworkError();
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text().catch(() => '');
    if (!response.ok) {
      switch (response.status) {
        case 401: case 403: throw new ProviderAuthError(response.status);
        case 429: throw new ProviderRateLimitError(response.status);
        default:
          if (response.status >= 500) throw new ProviderServerError(response.status);
          throw new ProviderBadRequestError(response.status);
      }
    }
    const payload = parsePayload(text);
    const mapped = mapCompletion(payload);
    return {
      provider: 'deepseek', sourceType: this.sourceType, retrievalMode: this.retrievalMode,
      model: mapped.model ?? model,
      modelVersion: mapped.model ?? null,
      content: mapped.content,
      rawPrompt,
      rawProviderPayload: mapped.payload,
      usage: mapped.usage,
      finishReason: mapped.finishReason,
      requestId: mapped.requestId,
      durationMs: Math.round(performance.now() - started),
    };
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function parsePayload(text: string): unknown {
  if (text.trim() === '') throw new ProviderEmptyResponseError();
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderInvalidResponseError();
  }
}

function mapCompletion(raw: unknown): {
  model: string | null; content: string; finishReason: string | null;
  requestId: string | null; usage?: ProviderUsage; payload: Record<string, unknown>;
} {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ProviderInvalidResponseError();
  const payload = raw as Record<string, unknown>;
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) throw new ProviderInvalidResponseError();
  const first = choices[0];
  const message = first !== null && typeof first === 'object' && !Array.isArray(first)
    ? (first as Record<string, unknown>).message : undefined;
  const content = message !== null && typeof message === 'object' && !Array.isArray(message)
    ? (message as Record<string, unknown>).content : undefined;
  if (typeof content !== 'string' || content.trim() === '') throw new ProviderEmptyResponseError();
  const model = typeof payload.model === 'string' && payload.model.trim() !== '' ? payload.model : null;
  const requestId = typeof payload.id === 'string' && payload.id.trim() !== '' ? payload.id : null;
  const finishReason = typeof (first as Record<string, unknown>).finish_reason === 'string'
    ? ((first as Record<string, unknown>).finish_reason as string) : null;
  const usageRaw = payload.usage;
  let usage: ProviderUsage | undefined;
  if (usageRaw !== null && typeof usageRaw === 'object' && !Array.isArray(usageRaw)) {
    const u = usageRaw as Record<string, unknown>;
    const toNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
    const promptTokens = toNumber(u.prompt_tokens);
    const completionTokens = toNumber(u.completion_tokens);
    const totalTokens = toNumber(u.total_tokens);
    if (promptTokens !== undefined && completionTokens !== undefined && totalTokens !== undefined) {
      usage = { promptTokens, completionTokens, totalTokens };
    }
  }
  // Faithful provider payload minus the answer body (already persisted as
  // rawResponse) and minus anything secret (headers never enter this object).
  const sanitized: Record<string, unknown> = {
    id: requestId ?? undefined,
    object: typeof payload.object === 'string' ? payload.object : undefined,
    created: typeof payload.created === 'number' ? payload.created : undefined,
    model: model ?? undefined,
    system_fingerprint: typeof payload.system_fingerprint === 'string' ? payload.system_fingerprint : undefined,
    choices: choices.slice(0, 1).map(choice => ({
      index: (choice as Record<string, unknown>).index ?? undefined,
      finish_reason: (choice as Record<string, unknown>).finish_reason ?? undefined,
      message: { role: (message as Record<string, unknown>).role ?? undefined },
    })),
    usage: usageRaw !== null && typeof usageRaw === 'object' && !Array.isArray(usageRaw) ? usageRaw : undefined,
  };
  for (const key of Object.keys(sanitized)) if (sanitized[key] === undefined) delete sanitized[key];
  return { model, content, finishReason, requestId, usage, payload: sanitized };
}
