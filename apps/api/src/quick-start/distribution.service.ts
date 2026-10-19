import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { TenantService } from "../common/tenant.service";
import { PrismaService } from "../prisma.service";
import { CreateDistributionTasksDto } from "./dto/quick-start.dto";
import { CONTENT_PLATFORM_LABELS, ContentPlatform } from "./quick-start.constants";

@Injectable()
export class DistributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  async createTasks(contentId: string, userId: string, dto: CreateDistributionTasksDto) {
    const access = await this.prisma.client.contentAsset.findUnique({
      where: { id: contentId },
      select: { id: true, projectId: true, reportId: true, status: true },
    });
    if (!access) throw new NotFoundException("内容草稿不存在或无权访问");
    await this.tenant.assertUserInProject(userId, access.projectId);
    if (access.status !== "SAVED") {
      throw new BadRequestException("请先保存内容草稿，再创建分发任务");
    }

    const platforms = Array.from(new Set(dto.platforms));
    const tasks = await this.prisma.client.$transaction(
      platforms.map((platform) =>
        this.prisma.client.distributionTask.upsert({
          where: {
            contentAssetId_platform: {
              contentAssetId: contentId,
              platform,
            },
          },
          create: {
            projectId: access.projectId,
            contentAssetId: contentId,
            createdById: userId,
            platform,
            status: "NEEDS_HUMAN_REVIEW",
          },
          update: { status: "NEEDS_HUMAN_REVIEW" },
          include: { content: { select: { title: true, status: true, isMock: true, evidenceMock: true } } },
        }),
      ),
    );

    if (access.reportId) {
      const report = await this.prisma.client.geoReport.findUnique({
        where: { id: access.reportId },
        select: { run: { select: { sessionId: true } } },
      });
      if (report) {
        await this.prisma.client.quickStartSession.update({
          where: { id: report.run.sessionId },
          data: { currentStep: "DISTRIBUTION" },
        });
      }
    }
    return tasks.map((task) => ({
      ...task,
      platformLabel: CONTENT_PLATFORM_LABELS[task.platform as ContentPlatform],
      note: "已进入发布工作台，仍是内容草稿；此任务没有对外发布。",
    }));
  }

  async listTasks(userId: string, organizationId?: string) {
    if (organizationId) {
      await this.tenant.assertUserInOrganization(userId, organizationId);
    }
    const memberships = await this.prisma.client.organizationMember.findMany({
      where: { userId },
      select: { organizationId: true },
    });
    const organizationIds = organizationId
      ? [organizationId]
      : memberships.map((membership) => membership.organizationId);
    if (organizationIds.length === 0) return [];

    const tasks = await this.prisma.client.distributionTask.findMany({
      where: { project: { organizationId: { in: organizationIds } } },
      orderBy: { updatedAt: "desc" },
      include: {
        project: { select: { id: true, name: true } },
        content: {
          include: {
            brand: { select: { name: true } },
            generations: { orderBy: { createdAt: "desc" }, take: 1 },
            report: { select: { id: true, containsMockData: true } },
          },
        },
      },
    });
    return tasks.map((task) => ({
      ...task,
      platformLabel: CONTENT_PLATFORM_LABELS[task.platform as ContentPlatform],
      note: "内容草稿待人工复核；尚未公开发布。",
    }));
  }

  async getTask(taskId: string, userId: string) {
    const access = await this.prisma.client.distributionTask.findUnique({
      where: { id: taskId },
      select: { id: true, projectId: true },
    });
    if (!access) throw new NotFoundException("分发任务不存在或无权访问");
    await this.tenant.assertUserInProject(userId, access.projectId);

    const task = await this.prisma.client.distributionTask.findUnique({
      where: { id: taskId },
      include: {
        project: { select: { id: true, name: true } },
        content: {
          include: {
            brand: true,
            report: {
              include: {
                run: { include: { responses: { orderBy: { createdAt: "asc" } } } },
              },
            },
            generations: {
              orderBy: { createdAt: "desc" },
              include: {
                evidence: {
                  include: {
                    response: { select: { id: true, queryText: true, rawResponse: true, isMock: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!task) throw new NotFoundException("分发任务不存在或无权访问");
    return {
      ...task,
      platformLabel: CONTENT_PLATFORM_LABELS[task.platform as ContentPlatform],
      note: "内容草稿待人工复核；GeoLens 尚未执行或确认公开发布。",
    };
  }
}
