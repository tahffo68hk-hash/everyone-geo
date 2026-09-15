import { Queue } from 'bullmq';
import { z } from 'zod';
import type { PrismaClient } from '@geo/database';
import { queueOptions } from './config';

/**
 * 内容发布队列 + Mock 发布适配器 + 发布执行（PHASE 15）—— 供 API 与 Worker 共用。
 *
 * 安全铁律：
 *   - 本模块只实现 Mock 发布（明显假值，不出站）；真实平台适配器需 EXTERNAL_PUBLISHING_ENABLED=true
 *     才可接入，本回合恒为 false → Real Provider Calls / External Writes = 0。
 *   - 幂等：PublicationAttempt.idempotencyKey 唯一；相同键重放直接跳过，不重复执行。
 *   - 失败可记录：FAILED 时写入 errorMessage，供重试/审计。
 *   - Publication 与 GEO Evidence 解耦，不构成优化证据。
 */

export const PUBLICATION_QUEUE = 'content-publications';
export const PUBLICATION_JOB = 'publish';

export const publicationJobSchema = z.object({ publicationId: z.uuid() }).strict();
export type PublicationJob = z.infer<typeof publicationJobSchema>;
export type PublicationQueue = Queue<PublicationJob>;

export function createPublicationQueue(): PublicationQueue {
  return new Queue<PublicationJob>(PUBLICATION_QUEUE, queueOptions('producer'));
}

/** best-effort 入队；Redis 不可用时返回 false 而不抛错（不影响 API 主流程）。 */
export async function enqueuePublication(
  queue: PublicationQueue | null,
  publicationId: string,
): Promise<boolean> {
  if (!queue) return false;
  try {
    await publicationJobSchema.parseAsync({ publicationId });
    await queue.add(
      PUBLICATION_JOB,
      { publicationId },
      {
        jobId: `pub-${publicationId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 500 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 604800, count: 1000 },
      },
    );
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Publisher Adapter 契约
// ---------------------------------------------------------------------------

export interface PublishRequest {
  publicationId: string;
  channel: string;
  title?: string | null;
  payload: string;
  idempotencyKey: string;
}

export interface PublishResult {
  ok: boolean;
  publisher: 'mock' | 'real';
  externalId?: string;
  externalUrl?: string;
  errorMessage?: string;
  durationMs: number;
}

export interface PublisherAdapter {
  publish(req: PublishRequest): Promise<PublishResult>;
}

/** Mock 适配器：绝不触达外部平台，externalId/externalUrl 为明显假值（mock_ 前缀）。 */
export class MockPublicationPublisher implements PublisherAdapter {
  async publish(req: PublishRequest): Promise<PublishResult> {
    const start = Date.now();
    const channel = String(req.channel ?? 'unknown').toLowerCase();
    const externalId = `mock_${channel}_${req.publicationId.replace(/-/g, '').slice(0, 12)}`;
    const externalUrl = `https://mock.geo.local/${channel}/${externalId}`;
    await new Promise<void>((r) => setTimeout(r, 5)); // 纯内存延迟，无网络
    return { ok: true, publisher: 'mock', externalId, externalUrl, durationMs: Date.now() - start };
  }
}

// ---------------------------------------------------------------------------
// 发布执行（API 同步路径 & Worker 异步路径共用）
// ---------------------------------------------------------------------------

export interface ExecutePublicationResult {
  executed: boolean;
  status: string;
}

/**
 * 执行一次发布尝试（幂等）。相同 idempotencyKey 已存在时直接跳过。
 * 返回 executed=false 表示「无需执行」（已发布 / 同键重放）。
 */
export async function executePublication(
  db: PrismaClient,
  publicationId: string,
  options: { idempotencyKey?: string } = {},
): Promise<ExecutePublicationResult> {
  const pub = await db.publication.findUnique({ where: { id: publicationId } });
  if (!pub) throw new Error('PUBLICATION_NOT_FOUND');
  if (pub.status === 'PUBLISHED') return { executed: false, status: pub.status };

  const idemKey = options.idempotencyKey ?? pub.idempotencyKey;
  const existing = await db.publicationAttempt.findUnique({ where: { idempotencyKey: idemKey } });
  if (existing) return { executed: false, status: pub.status };

  // 出站写闸门：本回合仅 Mock。
  const publisher = new MockPublicationPublisher();
  const result = await publisher.publish({
    publicationId: pub.id,
    channel: pub.channel,
    title: pub.title,
    payload: pub.payload,
    idempotencyKey: idemKey,
  });

  const attemptNo = (await db.publicationAttempt.count({ where: { publicationId: pub.id } })) + 1;
  await db.publicationAttempt.create({
    data: {
      publicationId: pub.id,
      idempotencyKey: idemKey,
      channel: pub.channel,
      attemptNo,
      status: result.ok ? 'PUBLISHED' : 'FAILED',
      publisher: result.publisher,
      externalId: result.externalId ?? null,
      externalUrl: result.externalUrl ?? null,
      errorMessage: result.errorMessage ?? null,
      durationMs: result.durationMs,
    },
  });

  const newStatus = result.ok ? 'PUBLISHED' : 'FAILED';
  await db.publication.update({ where: { id: pub.id }, data: { status: newStatus } });
  if (result.ok) {
    await db.contentDraft.update({ where: { id: pub.draftId }, data: { status: 'PUBLISHED' } });
  }
  // 审计不含 token/secret；用量成本恒为 null（非 0）。
  await db.contentAuditLog.create({
    data: {
      organizationId: pub.organizationId,
      projectId: pub.projectId,
      draftId: pub.draftId,
      publicationId: pub.id,
      action: result.ok ? 'PUBLICATION_SUCCEEDED' : 'PUBLICATION_FAILED',
      actorId: pub.createdById,
      detail: `channel=${pub.channel} attemptNo=${attemptNo} publisher=${result.publisher}`,
    },
  });
  await db.contentUsageEvent.create({
    data: {
      organizationId: pub.organizationId,
      projectId: pub.projectId,
      eventType: 'PUBLICATION_ATTEMPT',
      provider: result.publisher,
      costUsd: null,
      quantity: 1,
      actorId: pub.createdById,
    },
  });

  return { executed: true, status: newStatus };
}
