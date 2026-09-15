import { UnrecoverableError, type Job } from 'bullmq';
import type { PrismaClient } from '@geo/database';
import { executePublication, publicationJobSchema, type PublicationJob } from '@geo/queue';

/**
 * 内容发布处理器（PHASE 15）。
 *
 * 消费 content-publications 队列；调用共享的 Mock 发布执行（@geo/queue.executePublication）。
 * - 本回合仅 Mock Publisher：不触达任何真实平台，Real Provider Calls / External Writes = 0。
 * - 幂等：executePublication 依据 idempotencyKey 去重；同键重放安全。
 * - 失败：抛出可重试错误交由 BullMQ 退避重试；无效 payload 视为不可重试。
 */
export function createPublicationProcessor(db: PrismaClient) {
  return async (job: Job<PublicationJob>): Promise<void> => {
    const payload = publicationJobSchema.safeParse(job.data);
    if (!payload.success) throw new UnrecoverableError('INVALID_JOB_PAYLOAD');
    try {
      await executePublication(db, payload.data.publicationId);
    } catch (error) {
      if (error instanceof Error && error.message === 'PUBLICATION_NOT_FOUND') {
        throw new UnrecoverableError('PUBLICATION_NOT_FOUND');
      }
      throw error; // 可重试
    }
  };
}
