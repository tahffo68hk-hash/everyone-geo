import { Body, ConflictException, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { TenantService } from "../common/tenant.service";
import { PrismaService } from "../prisma.service";
import { CreateProjectDto } from "./dto/create-project.dto";

/**
 * 组织与项目端点（多租户隔离）：
 * - GET  /organizations        —— 当前用户有 membership 的组织列表
 * - GET  /organizations/:id    —— 单组织详情（仅限自己所属；含工作台项目摘要）
 * - POST /organizations/:id/projects —— 在所属组织创建通用监测项目（无 Target 起步）
 * - GET  /projects/:id         —— 项目详情（仅限自己所属组织的项目）
 * 越权访问一律 404，不泄露资源存在性。
 */
@Controller()
export class OrganizationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  @Get("organizations")
  @UseGuards(AuthGuard)
  async listOrganizations(@CurrentUser() user?: JwtUserPayload) {
    return this.prisma.client.organization.findMany({
      where: { members: { some: { userId: user!.sub } } },
      include: { _count: { select: { projects: true, members: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * 新建通用监测项目（GeoLens 通用入口：任意品牌/产品/服务）。
   * - 只能在自己所属 Organization 创建（否则 404）。
   * - 只写 Project 标量；Brand/TargetEntityAlias/BenchmarkSuite 一律为空起步。
   * - 同名项目在同一组织内唯一（Prisma @@unique），冲突返回 409。
   */
  @Post("organizations/:id/projects")
  @HttpCode(201)
  @UseGuards(AuthGuard)
  async createProject(
    @CurrentUser() user?: JwtUserPayload,
    @Param("id") id?: string,
    @Body() dto?: CreateProjectDto,
  ) {
    await this.tenant.assertUserInOrganization(user!.sub, id!);
    try {
      return await this.prisma.client.project.create({
        data: {
          organizationId: id!,
          name: dto!.name.trim(),
          description: dto?.description?.trim() || null,
          industry: dto?.industry?.trim() || null,
          region: dto?.region?.trim() || null,
          targetAudience: dto?.targetAudience?.trim() || null,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") {
        throw new ConflictException("该组织下已存在同名项目，请换一个名称。");
      }
      throw e;
    }
  }

  @Get("organizations/:id")
  @UseGuards(AuthGuard)
  async getOrganization(
    @CurrentUser() user?: JwtUserPayload,
    @Param("id") id?: string,
  ) {
    await this.tenant.assertUserInOrganization(user!.sub, id!);
    return this.prisma.client.organization.findUnique({
      where: { id: id! },
      include: {
        members: {
          include: { user: { select: { id: true, email: true, name: true } } },
        },
        projects: {
          // 工作台项目卡片所需摘要：监测对象(brand) + 产品类别 + 问题集数 + 最近一次检测。
          include: {
            brands: {
              select: { id: true, name: true, entityType: true, productCategory: true, website: true },
              orderBy: { createdAt: "asc" as const },
            },
            _count: { select: { benchmarkSuites: true } },
            benchmarkRuns: {
              orderBy: { createdAt: "desc" as const },
              take: 1,
              select: { id: true, status: true, runType: true, createdAt: true },
            },
          },
          orderBy: { createdAt: "asc" as const },
        },
      },
    });
  }

  @Get("projects/:id")
  @UseGuards(AuthGuard)
  async getProject(
    @CurrentUser() user?: JwtUserPayload,
    @Param("id") id?: string,
  ) {
    const project = await this.tenant.assertUserInProject(user!.sub, id!);
    return this.prisma.client.project.findUnique({
      where: { id: project.id },
      include: {
        brands: true,
        competitors: true,
        querySets: { include: { queries: true } },
      },
    });
  }
}
