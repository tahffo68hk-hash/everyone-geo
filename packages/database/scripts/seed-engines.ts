// Adds only mock registry rows; never changes existing users/organizations/projects.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  for (const [key, name, config] of [
    ['mock-alpha', 'Mock Alpha', { delayMs: 350 }],
    ['mock-beta', 'Mock Beta', { delayMs: 500 }],
    ['mock-gamma', 'Mock Gamma', { delayMs: 650 }],
    ['mock-retry', 'Mock Retry', { delayMs: 350, failuresBeforeSuccess: 1 }],
    ['mock-failure', 'Mock Permanent Failure', { delayMs: 350, permanentFailure: true }],
    // M8C-R0：人工 Web UI 测量引擎（永不进入 worker registry，仅作 Run 归属与展示）
    ['manual-web-ui', '人工 Web UI', { manual: true }],
  ] as const) {
    await prisma.engine.upsert({ where: { key }, update: {}, create: { key, name, config: { ...config } } });
  }
  console.log('Mock engine registry ready');
}
main().catch(() => { console.error('Mock engine seed failed'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
