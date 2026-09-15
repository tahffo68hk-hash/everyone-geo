import { Worker } from 'bullmq';
import { prisma } from '@geo/database';
import {
  createRunQueue, dispatchPendingRuns, reconcileRuns, queueOptions, QUEUE_NAME,
  createPublicationQueue, PUBLICATION_QUEUE, type RunJob, type RunResult, type PublicationJob,
} from '@geo/queue';
import { boundedInteger, createRunProcessor, jsonLogger } from './processor';
import { createPublicationProcessor } from './publication-processor';
import { recoverAnalyses } from './evidence';

export async function startWorker() {
  const concurrency = boundedInteger(process.env.WORKER_CONCURRENCY, 3, 1, 16);
  const timeoutMs = boundedInteger(process.env.WORKER_TIMEOUT_MS, 3000, 50, 60000);
  // Real providers (DeepSeek) need a longer request budget than mock delays.
  const realTimeoutMs = boundedInteger(process.env.REAL_PROVIDER_TIMEOUT_MS, 60000, 5000, 120000);
  const lockDuration = boundedInteger(process.env.WORKER_LOCK_DURATION_MS, 10000, 2000, 120000);
  const stalledInterval = boundedInteger(process.env.WORKER_STALLED_INTERVAL_MS, 5000, 1000, 60000);
  const queue = createRunQueue();
  queue.on('error', () => jsonLogger({ component: 'worker', status: 'ERROR', error: 'QUEUE_UNAVAILABLE' }));
  const worker = new Worker<RunJob, RunResult | undefined>(QUEUE_NAME, createRunProcessor(prisma, { timeoutMs, realTimeoutMs }), {
    ...queueOptions('worker'), concurrency, lockDuration, stalledInterval, maxStalledCount: 1,
  });
  worker.on('error', () => jsonLogger({ component: 'worker', status: 'ERROR', error: 'QUEUE_UNAVAILABLE' }));
  worker.on('failed', job => jsonLogger({
    component: 'worker', jobId: job?.id, status: 'JOB_FAILED', error: 'EXECUTION_FAILED',
  }));

  // 内容发布队列（PHASE 15）：仅 Mock Publisher；幂等由 executePublication 的 idempotencyKey 保证。
  const publicationQueue = createPublicationQueue();
  publicationQueue.on('error', () => jsonLogger({ component: 'worker', status: 'ERROR', error: 'PUBLICATION_QUEUE_UNAVAILABLE' }));
  const publicationWorker = new Worker<PublicationJob, void>(PUBLICATION_QUEUE, createPublicationProcessor(prisma), {
    ...queueOptions('worker'), concurrency: 1, lockDuration, stalledInterval, maxStalledCount: 1,
  });
  publicationWorker.on('error', () => jsonLogger({ component: 'worker', status: 'ERROR', error: 'PUBLICATION_QUEUE_UNAVAILABLE' }));
  publicationWorker.on('failed', job => jsonLogger({
    component: 'worker', jobId: job?.id, status: 'PUBLICATION_JOB_FAILED', error: 'PUBLICATION_FAILED',
  }));
  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  let maintenance: Promise<void> = Promise.resolve();
  const poll = () => {
    maintenance = (async () => {
      try {
        await reconcileRuns(prisma, queue);
        if (!stopping) await dispatchPendingRuns(prisma, queue);
        if (!stopping) await recoverAnalyses(prisma);
      } catch { jsonLogger({ component: 'worker', status: 'ERROR', error: 'DISPATCH_UNAVAILABLE' }); }
      finally { if (!stopping) timer = setTimeout(poll, 2000); }
    })();
  };
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing) return closing;
    stopping = true;
    if (timer) clearTimeout(timer);
    closing = (async () => {
      await maintenance;
      await worker.close(); // Wait for active bounded provider executions.
      await publicationWorker.close();
      await queue.close();
      await publicationQueue.close();
      await prisma.$disconnect();
      jsonLogger({ component: 'worker', status: 'STOPPED' });
    })();
    return closing;
  };
  const onSignal = () => { void close().catch(() => { process.exitCode = 1; }); };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
  poll();
  await worker.waitUntilReady();
  jsonLogger({ component: 'worker', status: 'READY' });
  return { worker, queue, publicationWorker, publicationQueue, close };
}
