import { Queue, type QueueOptions } from 'bullmq';
import { z } from 'zod';
import type { PrismaClient } from '@geo/database';
import { markRunQueued, recoverRun } from './state';

export * from './state';
export const QUEUE_NAME = 'monitor-runs';
export const JOB_NAME = 'execute-run';
export const MAX_RUN_ATTEMPTS = 3;

// Redis carries only an identifier. Tenant, query and engine data come from PostgreSQL.
export const runJobSchema = z.object({ runId: z.uuid() }).strict();
export const runResultSchema = z.object({
  provider: z.literal('mock'),
  text: z.string(),
  durationMs: z.number().finite().nonnegative(),
}).strict();
export type RunJob = z.infer<typeof runJobSchema>;
export type RunResult = z.infer<typeof runResultSchema>;

export function jobIdForRun(runId: string): string {
  return `run-${runJobSchema.parse({ runId }).runId}`;
}

export function queueOptions(role: 'producer' | 'worker' = 'producer'): QueueOptions {
  let redis: URL;
  let database: string;
  try {
    redis = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    if (!['redis:', 'rediss:'].includes(redis.protocol)) throw new Error();
    database = decodeURIComponent(new URL(process.env.DATABASE_URL ?? 'postgresql://localhost/geo_dev').pathname.slice(1));
    if (!/^[a-zA-Z0-9_-]+$/.test(database)) throw new Error();
    if (redis.pathname && redis.pathname !== '/' && !/^\/\d+$/.test(redis.pathname)) throw new Error();
  } catch {
    throw new Error('INVALID_QUEUE_CONFIGURATION');
  }
  return {
    prefix: `geo-${database}`,
    connection: {
      host: redis.hostname,
      port: Number(redis.port || 6379),
      username: redis.username ? decodeURIComponent(redis.username) : undefined,
      password: redis.password ? decodeURIComponent(redis.password) : undefined,
      db: Number(redis.pathname.slice(1) || 0),
      ...(redis.protocol === 'rediss:' ? { tls: {} } : {}),
      maxRetriesPerRequest: role === 'worker' ? null : 1,
      connectTimeout: 3000,
    },
  };
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
