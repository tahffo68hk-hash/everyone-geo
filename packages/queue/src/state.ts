import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient, RunStatus, TaskStatus } from '@geo/database';

const terminal = new Set<string>(['SUCCEEDED', 'FAILED', 'CANCELLED']);
export function isTerminalRun(status: string): boolean { return terminal.has(status); }

export function aggregateRunStatuses(statuses: readonly string[]): {
  status: TaskStatus; totalRuns: number; completedRuns: number; failedRuns: number;
} {
  const totalRuns = statuses.length;
  const completedRuns = statuses.filter(status => status === 'SUCCEEDED').length;
  const failedRuns = statuses.filter(status => status === 'FAILED').length;
  const cancelled = statuses.filter(status => status === 'CANCELLED').length;
  const done = completedRuns + failedRuns + cancelled;
  let status: TaskStatus;
  if (totalRuns > 0 && done === totalRuns) {
    status = completedRuns === totalRuns ? 'SUCCEEDED'
      : failedRuns === totalRuns ? 'FAILED'
      : cancelled === totalRuns ? 'CANCELLED' : 'PARTIAL';
  } else if (done > 0 || statuses.includes('RUNNING')) status = 'RUNNING';
  else if (statuses.includes('QUEUED')) status = 'QUEUED';
  else status = 'PENDING';
  return { status, totalRuns, completedRuns, failedRuns };
}

type Tx = Prisma.TransactionClient;
async function lockTask(tx: Tx, taskId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "MonitorTask" WHERE "id" = ${taskId}::uuid FOR UPDATE`;
  return rows.length > 0;
}

async function refreshTask(tx: Tx, taskId: string): Promise<void> {
  const rows = await tx.run.findMany({ where: { monitorTaskId: taskId }, select: { status: true } });
  const progress = aggregateRunStatuses(rows.map(row => row.status));
  const finished = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'PARTIAL'].includes(progress.status);
  await tx.monitorTask.update({ where: { id: taskId }, data: {
    ...progress, completedAt: finished ? new Date() : null,
  } });
}

export async function markRunQueued(db: PrismaClient, runId: string, taskId: string): Promise<void> {
  await db.$transaction(async tx => {
    if (!await lockTask(tx, taskId)) return;
    const changed = await tx.run.updateMany({ where: { id: runId, monitorTaskId: taskId, status: 'PENDING' }, data: { status: 'QUEUED' } });
    if (changed.count) await refreshTask(tx, taskId);
  });
}

/** Every delivery has a new fencing token: an old process can never commit after redelivery. */
export async function claimRun(db: PrismaClient, runId: string, maxAttempts = 3) {
  const initial = await db.run.findUnique({ where: { id: runId }, select: { monitorTaskId: true } });
  if (!initial) return null;
  return db.$transaction(async tx => {
    if (!await lockTask(tx, initial.monitorTaskId)) return null;
    const run = await tx.run.findUnique({ where: { id: runId }, include: { engine: true, query: true, monitorTask: true } });
    if (!run || isTerminalRun(run.status)) return null;
    if (run.attempt >= maxAttempts) {
      await tx.run.update({ where: { id: runId }, data: {
        status: 'FAILED', completedAt: new Date(), executionToken: null,
        errorCode: 'RETRY_EXHAUSTED', errorMessage: 'Maximum execution attempts reached.',
      } });
      await refreshTask(tx, initial.monitorTaskId);
      return null;
    }
    const startedAt = new Date();
    const executionToken = randomUUID();
    const claimed = await tx.run.update({ where: { id: runId }, data: {
      status: 'RUNNING', attempt: { increment: 1 }, executionToken, startedAt,
      completedAt: null, errorCode: null, errorMessage: null,
    }, include: { engine: true, query: true, monitorTask: true } });
    await tx.monitorTask.updateMany({ where: { id: run.monitorTaskId, startedAt: null }, data: { startedAt } });
    await refreshTask(tx, run.monitorTaskId);
    return claimed;
  });
}

export type ClaimedRun = NonNullable<Awaited<ReturnType<typeof claimRun>>>;

export function canSettleRun(run: { status: string; executionToken: string | null }, token: string): boolean {
  return run.status === 'RUNNING' && run.executionToken === token;
}

export async function settleRun(db: PrismaClient, run: Pick<ClaimedRun, 'id' | 'monitorTaskId' | 'executionToken'>, outcome: {
  status: 'SUCCEEDED' | 'FAILED' | 'QUEUED'; result?: Prisma.InputJsonValue; errorCode?: string; errorMessage?: string;
  persist?: (tx: Prisma.TransactionClient) => Promise<void>;
}): Promise<boolean> {
  if (!run.executionToken) return false;
  return db.$transaction(async tx => {
    if (!await lockTask(tx, run.monitorTaskId)) return false;
    const changed = await tx.run.updateMany({ where: {
      id: run.id, monitorTaskId: run.monitorTaskId, status: 'RUNNING', executionToken: run.executionToken,
    }, data: {
      status: outcome.status, executionToken: null,
      completedAt: outcome.status === 'QUEUED' ? null : new Date(),
      ...(outcome.result === undefined ? {} : { result: outcome.result }),
      errorCode: outcome.errorCode ?? null, errorMessage: outcome.errorMessage ?? null,
    } });
    if (changed.count) {
      if (outcome.persist) await outcome.persist(tx);
      await refreshTask(tx, run.monitorTaskId);
    }
    return changed.count === 1;
  });
}

export async function recoverRun(db: PrismaClient, snapshot: {
  id: string; monitorTaskId: string; status: RunStatus; executionToken: string | null;
}, maxAttempts = 3): Promise<boolean> {
  return db.$transaction(async tx => {
    if (!await lockTask(tx, snapshot.monitorTaskId)) return false;
    const current = await tx.run.findUnique({ where: { id: snapshot.id } });
    if (!current || isTerminalRun(current.status) || current.status !== snapshot.status || current.executionToken !== snapshot.executionToken) return false;
    if (current.status !== 'RUNNING' && current.attempt === 0) return false;
    const exhausted = current.attempt >= maxAttempts;
    await tx.run.update({ where: { id: current.id }, data: {
      status: exhausted ? 'FAILED' : 'QUEUED', executionToken: null,
      completedAt: exhausted ? new Date() : null,
      errorCode: exhausted ? 'RETRY_EXHAUSTED' : 'WORKER_INTERRUPTED',
      errorMessage: exhausted ? 'Maximum execution attempts reached.' : 'Execution interrupted; retry queued.',
    } });
    await refreshTask(tx, snapshot.monitorTaskId);
    return true;
  });
}
