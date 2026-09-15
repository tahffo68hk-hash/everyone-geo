import { Queue } from 'bullmq';
import { z } from 'zod';
import type { PrismaClient } from '@geo/database';
import { markRunQueued, recoverRun } from './state';
import { queueOptions } from './config';

export * from './state';
export * from './config';
export * from './publication';
export const QUEUE_NAME = 'monitor-runs';
export const JOB_NAME = 'execute-run';
export const MAX_RUN_ATTEMPTS = 3;

// Redis carries only an identifier. Tenant, query and engine data come from PostgreSQL.
export const runJobSchema = z.object({ runId: z.uuid() }).strict();
export const runResultSchema = z.object({
  provider: z.enum(['mock', 'deepseek', 'qwen']),
  text: z.string(),
  durationMs: z.number().finite().nonnegative(),
}).strict();
export type RunJob = z.infer<typeof runJobSchema>;
export type RunResult = z.infer<typeof runResultSchema>;

export function jobIdForRun(runId: string): string {
  return `run-${runJobSchema.parse({ runId }).runId}`;
}

export function createRunQueue(): Queue<RunJob, RunResult> {
  return new Queue<RunJob, RunResult>(QUEUE_NAME, queueOptions());
}

export type RunQueue = ReturnType<typeof createRunQueue>;

/** PostgreSQL is the durable outbox; deterministic job ids make replay safe. */
export async function dispatchPendingRuns(db: PrismaClient, queue: RunQueue, limit = 100): Promise<number> {
  const take = Math.max(1, Math.min(500, Math.floor(limit)));
  // Separate limits prevent an existing queued backlog hiding newly pending work.
  const rows = (await Promise.all(['PENDING', 'QUEUED'].map(status => db.run.findMany({
    where: { status: status as 'PENDING' | 'QUEUED' },
    select: { id: true, monitorTaskId: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take,
  })))).flat();
  for (const row of rows) {
    await queue.add(JOB_NAME, { runId: row.id }, {
      jobId: jobIdForRun(row.id), attempts: MAX_RUN_ATTEMPTS,
      backoff: { type: 'exponential', delay: 500 },
      // Keep terminal jobs for deduplication and recovery; prune older history eventually.
      removeOnComplete: { age: 86400, count: 10000 },
      removeOnFail: { age: 604800, count: 10000 },
    });
    await markRunQueued(db, row.id, row.monitorTaskId);
  }
  return rows.length;
}

/** Repair a lost Redis job or a terminal job whose worker could not persist its result. */
export async function reconcileRuns(db: PrismaClient, queue: RunQueue, limit = 100): Promise<number> {
  const rows = await db.run.findMany({
    where: { status: { in: ['RUNNING', 'QUEUED', 'PENDING'] } },
    select: { id: true, monitorTaskId: true, status: true, executionToken: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: Math.max(1, Math.min(500, Math.floor(limit))),
  });
  let recovered = 0;
  for (const row of rows) {
    const job = await queue.getJob(jobIdForRun(row.id));
    const state = job ? await job.getState() : 'unknown';
    if (state !== 'failed' && state !== 'completed' && state !== 'unknown') continue;
    if (job && (state === 'failed' || state === 'completed')) {
      // If another process activated it meanwhile, remove fails and leaves DB untouched.
      try { await job.remove(); } catch { continue; }
    }
    if (await recoverRun(db, row, MAX_RUN_ATTEMPTS)) recovered++;
  }
  return recovered;
}
