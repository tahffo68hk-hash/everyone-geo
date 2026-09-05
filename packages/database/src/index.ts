import { PrismaClient } from "@prisma/client";

/**
 * GeoLens 全局 PrismaClient 单例。
 * api / worker 统一从 @geo/database 导入，避免每个模块各自 new 连接。
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // 开发环境打印 SQL（可通过 DEBUG 环境变量覆盖）
    log:
      process.env.DATABASE_LOG === "query"
        ? ["query", "info", "warn", "error"]
        : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";
export default prisma;
