import { resolve } from 'node:path';
import { config } from 'dotenv';

// Resolve relative to this file in both src and dist, never the caller's cwd.
// Keep workspace imports after dotenv so Prisma and Redis see the same environment.
config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const { startWorker } = require('./runtime') as typeof import('./runtime');
void startWorker().catch(() => {
  console.error(JSON.stringify({ component: 'worker', status: 'FAILED', error: 'WORKER_START_FAILED' }));
  process.exitCode = 1;
});
