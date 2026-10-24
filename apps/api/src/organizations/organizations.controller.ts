import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { TenantService } from "../common/tenant.service";
import { PrismaService } from "../prisma.service";

/**
 * 组织与项目读端点（多租户隔离）：
 * - GET /organizations        —— 当前用户有 membership 的组织列表
 * - GET /organizations/:id    —— 单组织详情（仅限自己所属）
 * - GET /projects/:id         —— 项目详情（仅限自己所属组织的项目）
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
        projects: { orderBy: { createdAt: "asc" } },
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
