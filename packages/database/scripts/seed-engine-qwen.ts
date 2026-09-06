/**
 * M6D UI 演示辅助：向 geo_dev 注册 Qwen（通义千问）真实 Engine。
 * - provider=qwen，Engine.config 只含 model/temperature 等演示参数，绝不含 API Key。
 * - 是否可调用由服务端 env（ENABLE_REAL_PROVIDERS + QWEN_API_KEY）决定，
 *   本脚本只负责注册 Engine 行（幂等 upsert）。
 * - 未配置 env 时 UI 将显示「真实数据 · 未配置」，Mock / DeepSeek 引擎不受影响。
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  await prisma.engine.upsert({
    where: { key: "qwen-api" },
    update: {},
    create: { key: "qwen-api", name: "通义千问 Qwen API", provider: "qwen", config: { model: "qwen-plus", temperature: 0.2 } },
  });
  console.log("Qwen engine ready (qwen-api; real calls require server-side env + user approval)");
}
main().catch(() => { console.error("Qwen engine seed failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
