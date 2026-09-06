import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import type { Entity } from '@geo/core';
import { analyzeEvidence, evidenceData, snapshotEntities } from './evidence';
import { UnrecoverableError, type Job } from 'bullmq';
import type { PrismaClient } from '@geo/database';
import {
  claimRun, settleRun, runJobSchema, runResultSchema, MAX_RUN_ATTEMPTS,
  type RunJob, type RunResult,
} from '@geo/queue';
import {
  DeepSeekProvider, LLMProviderError, LLMProviderRegistry, MockProvider, QwenProvider,
  DEFAULT_REAL_PROVIDER_TIMEOUT_MS, enginePresentation,
  type LLMProvider, type ProviderErrorKind, type ProviderRequest, type ProviderResponse,
} from '@geo/llm';

const messages: Record<string, string> = {
  MOCK_FAILURE: 'Mock engine returned a simulated failure.',
  RUN_TIMEOUT: 'Execution exceeded its time limit.',
  INVALID_ENGINE_CONFIG: 'Engine configuration is invalid.',
  UNSUPPORTED_PROVIDER: 'Provider is not supported by this worker.',
  WORKER_ERROR: 'Execution could not complete.',
  PERSISTENCE_FAILED: 'Execution state could not be saved.',
  PROVIDER_CONFIG: 'Provider engine configuration is invalid.',
  PROVIDER_TIMEOUT: 'Provider request timed out.',
  PROVIDER_RATE_LIMIT: 'Provider rate limit reached; retry later.',
  PROVIDER_SERVER: 'Provider server error; retry later.',
  PROVIDER_NETWORK: 'Provider network error; retry later.',
  PROVIDER_AUTH: 'Provider authentication failed (API key rejected).',
  PROVIDER_BAD_REQUEST: 'Provider rejected the request as invalid.',
  PROVIDER_DISABLED: 'Real providers are disabled on this server.',
  PROVIDER_NOT_CONFIGURED: 'Provider is not configured (API key missing).',
  PROVIDER_EMPTY_RESPONSE: 'Provider returned an empty response.',
  PROVIDER_INVALID_RESPONSE: 'Provider returned a malformed response.',
};

export class ExecutionError extends Error {
  constructor(public readonly code: keyof typeof messages) { super(messages[code] ?? messages.WORKER_ERROR); }
}

export function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error('INVALID_WORKER_CONFIGURATION');
  return parsed;
}

/** Provider failure → Worker error code + retry decision. Workers own user messages. */
export function resolveProviderOutcome(isMock: boolean, kind: ProviderErrorKind): { code: string; retryable: boolean } {
  if (isMock) {
    // Preserve M3/M4 mock semantics (retryable until attempts are exhausted).
    switch (kind) {
      case 'mock_failure': return { code: 'MOCK_FAILURE', retryable: true };
      case 'timeout': return { code: 'RUN_TIMEOUT', retryable: true };
      default: return { code: 'INVALID_ENGINE_CONFIG', retryable: true };
    }
  }
  switch (kind) {
    case 'timeout': return { code: 'PROVIDER_TIMEOUT', retryable: true };
    case 'rate_limit': return { code: 'PROVIDER_RATE_LIMIT', retryable: true };
    case 'server': return { code: 'PROVIDER_SERVER', retryable: true };
    case 'network': return { code: 'PROVIDER_NETWORK', retryable: true };
    case 'auth': return { code: 'PROVIDER_AUTH', retryable: false };
    case 'bad_request': return { code: 'PROVIDER_BAD_REQUEST', retryable: false };
    case 'disabled': return { code: 'PROVIDER_DISABLED', retryable: false };
    case 'not_configured': return { code: 'PROVIDER_NOT_CONFIGURED', retryable: false };
    case 'empty_response': return { code: 'PROVIDER_EMPTY_RESPONSE', retryable: false };
    case 'invalid_response': return { code: 'PROVIDER_INVALID_RESPONSE', retryable: false };
    default: return { code: 'PROVIDER_CONFIG', retryable: false };
  }
}

/**
 * Legacy glue used by M3 worker integration tests: simulate one mock execution
 * and return the BullMQ RunResult shape. New code should go through the
 * provider registry (createRunProcessor), not this helper.
 */
export async function executeMock(input: {
  queryText: string; engineKey: string; config: unknown; attempt: number; timeoutMs: number; entities?: Entity[];
}): Promise<RunResult> {
  const mock = new MockProvider();
  let response: ProviderResponse;
  try {
    response = await mock.execute({
      queryText: input.queryText, engineKey: input.engineKey, engineName: input.engineKey,
      engineConfig: input.config, attempt: input.attempt, timeoutMs: input.timeoutMs,
      entities: input.entities as never,
    });
  } catch (error) {
    if (error instanceof LLMProviderError) {
      const outcome = resolveProviderOutcome(true, error.kind);
      throw new ExecutionError(outcome.code as keyof typeof messages);
    }
    throw error;
  }
  return runResultSchema.parse({
    provider: 'mock', text: response.content, durationMs: response.durationMs,
  });
}

export type LogRecord = {
  component: 'worker'; taskId?: string; runId?: string; queryId?: string; engineId?: string;
  jobId?: string; attempt?: number; duration?: number; status: string; error?: string;
};
export type WorkerLogger = (record: LogRecord) => void;
export const jsonLogger: WorkerLogger = record => console.log(JSON.stringify(record));

/** Providers available to every worker: mock (local) + deepseek + qwen (real, guarded). */
export function createProviderRegistry(): LLMProviderRegistry {
  return new LLMProviderRegistry()
    .register(new MockProvider())
    .register(new DeepSeekProvider())
    .register(new QwenProvider());
}

export function createRunProcessor(db: PrismaClient, options: {
  timeoutMs?: number; realTimeoutMs?: number; logger?: WorkerLogger; registry?: LLMProviderRegistry;
} = {}) {
  const timeoutMs = options.timeoutMs ?? 3000;
  const realTimeoutMs = options.realTimeoutMs ?? DEFAULT_REAL_PROVIDER_TIMEOUT_MS;
  const logger = options.logger ?? jsonLogger;
  const registry = options.registry ?? createProviderRegistry();
  return async (job: Job<RunJob>): Promise<RunResult | undefined> => {
    const payload = runJobSchema.safeParse(job.data);
    if (!payload.success) throw new UnrecoverableError('INVALID_JOB_PAYLOAD');
    let run;
    try { run = await claimRun(db, payload.data.runId, MAX_RUN_ATTEMPTS); }
    catch { throw new Error('PERSISTENCE_FAILED'); }
    if (!run) return undefined; // Deleted or terminal run: replay is a no-op.
    const started = performance.now();
    const context = {
      component: 'worker' as const, taskId: run.monitorTaskId, runId: run.id,
      queryId: run.queryId, engineId: run.engineId, jobId: job.id, attempt: run.attempt,
    };
    logger({ ...context, duration: 0, status: 'RUNNING' });
    let result: RunResult;
    let entities: Entity[] = [];
    const provider = registry.resolve(run.engine.provider);
    const mock = run.engine.provider === 'mock';
    const request: ProviderRequest = {
      queryText: run.query.text,
      engineKey: run.engine.key,
      engineName: run.engine.name,
      engineConfig: run.engine.config,
      // M6C model identity：Worker 以 enginePresentation 单一解析 requestedModel 并传给
      // Provider —— 与最终 Evidence.requestedModel 保持同一来源，不靠 Provider 猜测。
      requestedModel: enginePresentation(run.engine.provider, run.engine.config).model ?? undefined,
      attempt: run.attempt,
      timeoutMs: mock ? timeoutMs : realTimeoutMs,
    };
    let response: ProviderResponse;
    try {
      if (!provider) throw new ExecutionError('UNSUPPORTED_PROVIDER');
      entities = await snapshotEntities(db, run.query.projectId);
      request.entities = entities as never;
      response = await provider.execute(request);
      result = runResultSchema.parse({
        provider: response.provider, text: response.content, durationMs: response.durationMs,
      });
    } catch (error) {
      let code: string; let retryable = true;
      if (error instanceof LLMProviderError) {
        const outcome = resolveProviderOutcome(mock, error.kind);
        code = outcome.code; retryable = outcome.retryable;
      } else if (error instanceof ExecutionError) {
        code = error.code;
        retryable = code !== 'UNSUPPORTED_PROVIDER'; // unknown provider never self-heals
      } else {
        code = 'WORKER_ERROR';
      }
      const status = (!retryable || run.attempt >= MAX_RUN_ATTEMPTS) ? 'FAILED' : 'QUEUED';
      let saved: boolean;
      try { saved = await settleRun(db, run, { status, errorCode: code, errorMessage: messages[code] ?? messages.WORKER_ERROR }); }
      catch {
        logger({ ...context, duration: Math.round(performance.now() - started), status: 'ERROR', error: 'PERSISTENCE_FAILED' });
        throw new Error('PERSISTENCE_FAILED');
      }
      logger({ ...context, duration: Math.round(performance.now() - started), status: saved ? status : 'STALE', error: code });
      if (!saved) return undefined;
      if (status === 'FAILED') throw new UnrecoverableError(code);
      throw new Error(code);
    }
    let saved: boolean;
    try { saved = await settleRun(db, run, { status: 'SUCCEEDED', result, persist: async tx => {
      await tx.evidence.create({ data: evidenceData(run, response, entities) });
    } }); }
    catch {
      logger({ ...context, duration: Math.round(performance.now() - started), status: 'ERROR', error: 'PERSISTENCE_FAILED' });
      throw new Error('PERSISTENCE_FAILED');
    }
    logger({ ...context, duration: Math.round(performance.now() - started), status: saved ? 'SUCCEEDED' : 'STALE' });
    if (saved) {
      // Analysis errors never roll back provider success or raw evidence.
      try {
        const evidence = await db.evidence.findUniqueOrThrow({ where: { runId: run.id } });
        const analyzed = await analyzeEvidence(db, evidence.id);
        logger({ ...context, duration: Math.round(performance.now() - started), status: analyzed ? 'ANALYZED' : 'ANALYSIS_FAILED' });
      } catch { logger({ ...context, status: 'ANALYSIS_PENDING', error: 'ANALYSIS_PERSISTENCE_FAILED' }); }
    }
    return saved ? result : undefined;
  };
}
