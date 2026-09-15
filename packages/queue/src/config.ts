import type { QueueOptions } from 'bullmq';

/**
 * Redis / BullMQ 连接配置（从 index.ts 抽出，供 monitor-runs 与 content-publications
 * 两类队列共用）。Redis carries only identifiers; tenant/query/content data live in PostgreSQL.
 */
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
