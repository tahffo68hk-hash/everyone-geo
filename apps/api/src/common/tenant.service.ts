import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

/**
 * 多租户访问控制（TENANT-001）——
 * 数据访问前必须校验当前用户与目标组织/项目存在有效 membership，否则 404（不泄露存在性）。
 */
@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  /** 校验 userId 属于 organizationId；返回成员关系，不存在时抛 404。 */
  async assertUserInOrganization(userId: string, organizationId: string) {
    const membership = await this.prisma.client.organizationMember.findUnique({
      where: {
        userId_organizationId: { userId, organizationId },
      },
    });
    if (!membership) {
      throw new NotFoundException("组织不存在或无权访问");
    }
    return membership;
  }

  /** 校验 userId 对该 project 所属组织有 membership；返回 project 关键信息。 */
  async assertUserInProject(userId: string, projectId: string) {
    const project = await this.prisma.client.project.findUnique({
      where: { id: projectId },
      select: { id: true, organizationId: true },
    });
    if (!project) {
      throw new NotFoundException("项目不存在");
    }
    await this.assertUserInOrganization(userId, project.organizationId);
    return project;
  }
}
