/**
 * Server-side provider configuration.
 *
 * Secrets (DEEPSEEK_API_KEY) live only in environment variables. API / Web
 * layers read presence through these helpers and never receive the value.
 */

export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com';
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-chat';
export const DEFAULT_REAL_PROVIDER_TIMEOUT_MS = 60_000;
export const DEFAULT_REAL_PROVIDER_MAX_RUNS_PER_TASK = 3;

export interface RealProviderEnv {
  apiKey: string | null;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  realProvidersEnabled: boolean;
  realProviderMaxRunsPerTask: number;
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

/** Single source of truth for real-provider environment parsing. */
export function readRealProviderEnv(env: NodeJS.ProcessEnv = process.env): RealProviderEnv {
  return {
    apiKey: env.DEEPSEEK_API_KEY && env.DEEPSEEK_API_KEY.trim() !== '' ? env.DEEPSEEK_API_KEY.trim() : null,
    baseUrl: (env.DEEPSEEK_BASE_URL && env.DEEPSEEK_BASE_URL.trim() !== '' ? env.DEEPSEEK_BASE_URL.trim() : DEEPSEEK_DEFAULT_BASE_URL).replace(/\/+$/u, ''),
    model: env.DEEPSEEK_MODEL && env.DEEPSEEK_MODEL.trim() !== '' ? env.DEEPSEEK_MODEL.trim() : DEEPSEEK_DEFAULT_MODEL,
    timeoutMs: boundedInt(env.DEEPSEEK_TIMEOUT_MS, DEFAULT_REAL_PROVIDER_TIMEOUT_MS, 5000, 120_000),
    realProvidersEnabled: env.ENABLE_REAL_PROVIDERS === 'true',
    realProviderMaxRunsPerTask: boundedInt(env.REAL_PROVIDER_MAX_RUNS_PER_TASK, DEFAULT_REAL_PROVIDER_MAX_RUNS_PER_TASK, 1, 1000),
  };
}

/** Configuration completeness only - it never means the API is reachable. */
export function deepseekConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const cfg = readRealProviderEnv(env);
  return cfg.realProvidersEnabled && cfg.apiKey !== null;
}

export function realProvidersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return readRealProviderEnv(env).realProvidersEnabled;
}

export interface EnginePresentation {
  provider: string;
  sourceType: 'mock' | 'official_api' | null;
  model: string | null;
  configured: boolean;
}

/**
 * Presentation info for one Engine row used by GET /monitor-tasks/options.
 * Never exposes secrets; `configured` only means "configuration complete".
 */
export function enginePresentation(provider: string, engineConfig: unknown, env: NodeJS.ProcessEnv = process.env): EnginePresentation {
  if (provider === 'mock') {
    return { provider, sourceType: 'mock', model: 'geolens-mock', configured: true };
  }
  if (provider === 'deepseek') {
    const cfg = readRealProviderEnv(env);
    const config = engineConfig !== null && typeof engineConfig === 'object' && !Array.isArray(engineConfig) ? engineConfig as Record<string, unknown> : {};
    const model = typeof config.model === 'string' && config.model.trim() !== '' ? config.model.trim() : cfg.model;
    return { provider, sourceType: 'official_api', model, configured: deepseekConfigured(env) };
  }
  return { provider, sourceType: null, model: null, configured: false };
}
