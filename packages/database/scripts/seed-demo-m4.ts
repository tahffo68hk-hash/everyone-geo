/**
 * M4 UI 演示辅助：向 geo_dev 增加 3 个带 scenario 的 mock 演示引擎。
 * - provider=mock，绝不伪装真实模型（sourceType=mock 由 worker evidence 强制）。
 * - 幂等 upsert：重复执行不产生重复 key。
 * 仅供本地开发演示（UI Evidence/Metrics 有真实分析结果可看）；不属于任何测试。
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  for (const [key, name, config] of [
    ['demo-first', 'Demo First Pick', { delayMs: 300, scenario: 'first' }],
    ['demo-second', 'Demo Second Pick', { delayMs: 400, scenario: 'second' }],
    ['demo-citation', 'Demo With Citation', { delayMs: 500, scenario: 'citation' }],
  ] as const) {
    await prisma.engine.upsert({ where: { key }, update: {}, create: { key, name, config: { ...config } } });
  }
  console.log('M4 demo engines ready (demo-first/demo-second/demo-citation)');
}
main().catch(() => { console.error('M4 demo engine seed failed'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
