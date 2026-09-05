import { Injectable } from "@nestjs/common";
import { prisma, PrismaClient } from "@geo/database";

/**
 * 数据库访问服务：统一暴露 @geo/database 托管的 PrismaClient 单例。
 * API 不直接 new PrismaClient，也不自行维护 schema（唯一事实来源在 packages/database）。
 */
@Injectable()
export class PrismaService {
  get client(): PrismaClient {
    return prisma;
  }
}
