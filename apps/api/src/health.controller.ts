import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("health")
  health() {
    return { status: "ok" };
  }

  /** M2 数据库连通性检查（只读 count，不承载业务逻辑） */
  @Get("health/db")
  async healthDb() {
    try {
      const organizationCount = await this.prisma.client.organization.count();
      return { status: "ok", database: "connected", organizationCount };
    } catch (e) {
      return { status: "error", database: "unreachable", message: (e as Error).message };
    }
  }
}
