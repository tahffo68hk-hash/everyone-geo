/**
 * M5 UI 演示辅助：向 geo_dev 注册 DeepSeek API 真实 Engine。
 * - provider=deepseek，Engine.config 只含 model/temperature 等演示参数，绝不含 API Key。
 * - 是否可调用由服务端 env（ENABLE_REAL_PROVIDERS + DEEPSEEK_API_KEY）决定，
 *   本脚本只负责注册 Engine 行（幂等 upsert）。
 * - 未配置 env 时 UI 将显示「REAL · 未配置」，Mock 引擎不受影响。
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  await prisma.engine.upsert({
    where: { key: "deepseek-api" },
    update: {},
    create: { key: "deepseek-api", name: "DeepSeek API", provider: "deepseek", config: { model: "deepseek-chat", temperature: 0.2 } },
  });
  console.log("DeepSeek API engine ready (deepseek-api; real calls require server-side env)");
}
main().catch(() => { console.error("DeepSeek engine seed failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
