import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import type { Entity } from '@geo/core';
import { analyzeEvidence, evidenceData, snapshotEntities } from './evidence';
import { mockResponse } from './mock-response';
import { UnrecoverableError, type Job } from 'bullmq';
import type { PrismaClient } from '@geo/database';
import {
  claimRun, settleRun, runJobSchema, runResultSchema, MAX_RUN_ATTEMPTS,
  type RunJob, type RunResult,
} from '@geo/queue';

const messages: Record<string, string> = {
  MOCK_FAILURE: 'Mock engine returned a simulated failure.',
  RUN_TIMEOUT: 'Execution exceeded its time limit.',
  INVALID_ENGINE_CONFIG: 'Engine configuration is invalid.',
  UNSUPPORTED_PROVIDER: 'Only the mock provider is supported.',
  WORKER_ERROR: 'Execution could not complete.',
  PERSISTENCE_FAILED: 'Execution state could not be saved.',
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

/** An abortable local simulator; no provider credentials or network requests are used. */
export async function executeMock(input: {
  queryText: string; engineKey: string; config: unknown; attempt: number; timeoutMs: number; entities?: Entity[];
}): Promise<RunResult> {
  const started = performance.now();
  const config = input.config;
  if (config === null || typeof config !== 'object' || Array.isArray(config)) throw new ExecutionError('INVALID_ENGINE_CONFIG');
  const { delayMs, failuresBeforeSuccess, permanentFailure } = config as Record<string, unknown>;
  if ((delayMs !== undefined && (typeof delayMs !== 'number' || !Number.isInteger(delayMs) || delayMs < 0 || delayMs > 5000))
    || (failuresBeforeSuccess !== undefined && (typeof failuresBeforeSuccess !== 'number' || !Number.isInteger(failuresBeforeSuccess) || failuresBeforeSuccess < 0 || failuresBeforeSuccess > 100))
    || (permanentFailure !== undefined && typeof permanentFailure !== 'boolean')) {
    throw new ExecutionError('INVALID_ENGINE_CONFIG');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    await delay((delayMs as number | undefined) ?? (300 + Math.floor(Math.random() * 701)), undefined, { signal: controller.signal });
  } catch {
    throw new ExecutionError('RUN_TIMEOUT');
  } finally {
    clearTimeout(timeout);
  }
  if (permanentFailure === true || input.attempt <= ((failuresBeforeSuccess as number | undefined) ?? 0)) {
    throw new ExecutionError('MOCK_FAILURE');
  }
  const scenario = (config as Record<string, unknown>).scenario;
  let text = `[mock:${input.engineKey}] ${input.queryText}`;
  if (scenario !== undefined) {
    try { text = mockResponse(String(scenario), input.entities ?? []); }
    catch { throw new ExecutionError('INVALID_ENGINE_CONFIG'); }
  }
  return runResultSchema.parse({
    provider: 'mock', text,
    durationMs: Math.round(performance.now() - started),
  });
}

export type LogRecord = {
  component: 'worker'; taskId?: string; runId?: string; queryId?: string; engineId?: string;
  jobId?: string; attempt?: number; duration?: number; status: string; error?: string;
};
export type WorkerLogger = (record: LogRecord) => void;
export const jsonLogger: WorkerLogger = record => console.log(JSON.stringify(record));

export function createRunProcessor(db: PrismaClient, options: { timeoutMs?: number; logger?: WorkerLogger } = {}) {
  const timeoutMs = options.timeoutMs ?? 3000;
  const logger = options.logger ?? jsonLogger;
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
    try {
      if (run.engine.provider !== 'mock') throw new ExecutionError('UNSUPPORTED_PROVIDER');
      entities = await snapshotEntities(db, run.query.projectId);
      result = await executeMock({
        queryText: run.query.text, engineKey: run.engine.key, config: run.engine.config,
        attempt: run.attempt, timeoutMs, entities,
      });
    } catch (error) {
      const code = error instanceof ExecutionError ? error.code : 'WORKER_ERROR';
      const status = run.attempt >= MAX_RUN_ATTEMPTS ? 'FAILED' : 'QUEUED';
      let saved: boolean;
      try { saved = await settleRun(db, run, { status, errorCode: code, errorMessage: messages[code] }); }
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
      await tx.evidence.create({ data: evidenceData(run, result.text, entities, result.durationMs) });
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
