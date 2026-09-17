import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { TenantService } from "../common/tenant.service";
import { ContentStrategyService } from "../content-strategy/content-strategy.service";
import {
  ContentCalendarEngine,
} from "./content-calendar-engine";
import {
  CreateContentCampaignDto,
  UpdateContentCampaignDto,
  GenerateCalendarDto,
  UpdateScheduleItemDto,
  QueueQueryDto,
  PRODUCTION_STATUSES,
  CAMPAIGN_STATUSES,
} from "./dto/content-campaign.dto";

const logger = new Logger("ContentCampaignService");

@Injectable()
export class ContentCampaignService {
  constructor(
    private readonly db: PrismaService,
    private readonly tenant: TenantService,
    private readonly strategyService: ContentStrategyService,
  ) {}

  /**
   * 记录审计日志 (兼容 ContentAuditAction 枚举约束)
   */
  private async audit(
    organizationId: string,
    actorId: string,
    action: string,
    details?: string,
    metadata: Record<string, any> = {},
  ) {
    try {
      const enumAction: "DRAFT_CREATED" | "DRAFT_UPDATED" =
        action === "CAMPAIGN_CREATED" || action === "PRODUCTION_STARTED" || action === "DRAFT_CREATED"
          ? "DRAFT_CREATED"
          : "DRAFT_UPDATED";

      await this.db.client.contentAuditLog.create({
        data: {
          organizationId,
          projectId: metadata.projectId ?? null,
          draftId: metadata.draftId ?? null,
          actorId,
          action: enumAction,
          detail: `[${action}] ${details || ""} ${Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : ""}`.slice(0, 1000),
        },
      });
    } catch (e: any) {
      logger.warn(`Campaign audit log failed: ${e?.message}`);
    }
  }

  /**
   * 创建营销战役 (Campaign) 并根据 Strategy 下的 PlanItems 自动实例化排期项
   */
  async createCampaign(userId: string, projectId: string | undefined, dto: CreateContentCampaignDto) {
    let targetProjectId = projectId || dto.projectId;
    if (!targetProjectId) {
      const strategySnapshot = await this.db.client.contentStrategy.findUnique({
        where: { id: dto.strategyId },
        select: { projectId: true },
      });
      if (!strategySnapshot) {
        throw new NotFoundException("来源 Strategy 不存在");
      }
      targetProjectId = strategySnapshot.projectId;
    }

    const project = await this.tenant.assertUserInProject(userId, targetProjectId);

    const strategy = await this.db.client.contentStrategy.findFirst({
      where: { id: dto.strategyId, projectId: targetProjectId },
      include: {
        planItems: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!strategy) {
      throw new NotFoundException("来源 Strategy 不存在或不属于该项目");
    }

    if (!strategy.planItems || strategy.planItems.length === 0) {
      throw new BadRequestException("来源 Strategy 尚无内容计划项，请先生成计划项");
    }

    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();
    const endDate = dto.endDate
      ? new Date(dto.endDate)
      : new Date(startDate.getTime() + 14 * 24 * 3600 * 1000);

    if (endDate.getTime() < startDate.getTime()) {
      throw new BadRequestException("战役结束时间不能早于开始时间");
    }

    const name = dto.name?.trim() || `${strategy.title || "GEO 优化"} 营销战役`;
    const objective = dto.objective?.trim() || strategy.perceptionGoal || strategy.targetAudience || "GEO 品牌可见度与推荐率提升";
    const primaryGeoGap = dto.primaryGeoGap?.trim() || strategy.geoGap || "GEO Visibility Gap";

    // 1. 创建 Campaign 主表记录
    const campaign = await this.db.client.contentCampaign.create({
      data: {
        organizationId: project.organizationId,
        projectId: targetProjectId,
        name,
        description: dto.description?.trim() || null,
        strategyId: strategy.id,
        objective,
        primaryGeoGap,
        startDate,
        endDate,
        status: "ACTIVE",
        createdById: userId,
        metadata: {
          strategyTitle: strategy.title,
          planItemCount: strategy.planItems.length,
        },
      },
    });

    // 2. 基于 PlanItems 计算初始时间线与依赖排期
    const timeline = ContentCalendarEngine.generateScheduleTimeline(
      strategy.planItems,
      {
        startDate,
        pacingStrategy: "WORKDAYS_ONLY",
        maxItemsPerDay: 2,
        timezone: dto.timezone || "Asia/Shanghai",
      },
    );

    // 3. 批量插入排期项 (第一遍按序插入，第二遍更新依赖关联)
    const planItemToScheduleItemMap = new Map<string, string>();

    for (const item of timeline) {
      const scheduleItem = await this.db.client.contentScheduleItem.create({
        data: {
          organizationId: project.organizationId,
          projectId: targetProjectId,
          campaignId: campaign.id,
          planItemId: item.planItemId,
          scheduledDate: item.scheduledDate,
          scheduledTime: item.scheduledTime,
          timezone: item.timezone,
          productionStatus: item.productionStatus,
          blockReason: item.blockReason,
          metadata: {
            platform: item.planItem?.platform,
            format: item.planItem?.format,
            title: item.planItem?.title,
          },
        },
      });
      planItemToScheduleItemMap.set(item.planItemId, scheduleItem.id);
    }

    // 更新依赖关系
    for (const item of timeline) {
      if (item.dependsOnPlanItemId) {
        const scheduleItemId = planItemToScheduleItemMap.get(item.planItemId);
        const dependsOnScheduleItemId = planItemToScheduleItemMap.get(item.dependsOnPlanItemId);
        if (scheduleItemId && dependsOnScheduleItemId) {
          await this.db.client.contentScheduleItem.update({
            where: { id: scheduleItemId },
            data: { dependsOnItemId: dependsOnScheduleItemId },
          });
        }
      }
    }

    await this.audit(
      project.organizationId,
      userId,
      "CAMPAIGN_CREATED",
      `campaign=${campaign.id}, name=${campaign.name}, itemsCount=${timeline.length}`,
      { projectId: targetProjectId, strategyId: strategy.id, campaignId: campaign.id },
    );

    return this.getCampaignById(userId, campaign.id);
  }

  /**
   * 获取战役列表 (带进度统计)
   */
  async listCampaigns(userId: string, projectId: string) {
    await this.tenant.assertUserInProject(userId, projectId);

    const campaigns = await this.db.client.contentCampaign.findMany({
      where: { projectId },
      include: {
        strategy: {
          select: {
            id: true,
            title: true,
            sourceOpportunityId: true,
            sourceRecommendationId: true,
            sourceDiagnosisId: true,
          },
        },
        scheduleItems: {
          select: {
            id: true,
            scheduledDate: true,
            productionStatus: true,
            timezone: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return campaigns.map((c) => {
      const progress = ContentCalendarEngine.calculateCampaignProgress(c.scheduleItems);
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        status: c.status,
        objective: c.objective,
        primaryGeoGap: c.primaryGeoGap,
        startDate: c.startDate,
        endDate: c.endDate,
        strategyId: c.strategyId,
        strategyName: c.strategy?.title,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        lineage: {
          strategyId: c.strategyId,
          opportunityId: c.strategy?.sourceOpportunityId ?? null,
          recommendationId: c.strategy?.sourceRecommendationId ?? null,
          diagnosisId: c.strategy?.sourceDiagnosisId ?? null,
        },
        progress,
      };
    });
  }

  /**
   * 获取战役详情 (含完整血缘、进度与排期项)
   */
  async getCampaignById(userId: string, campaignId: string) {
    const campaign = await this.db.client.contentCampaign.findFirst({
      where: { id: campaignId },
      include: {
        strategy: {
          select: {
            id: true,
            title: true,
            sourceOpportunityId: true,
            sourceRecommendationId: true,
            sourceDiagnosisId: true,
            targetAudience: true,
            perceptionGoal: true,
            geoGap: true,
          },
        },
        scheduleItems: {
          include: {
            planItem: true,
            dependsOn: {
              select: {
                id: true,
                scheduledDate: true,
                productionStatus: true,
                planItem: {
                  select: { title: true, platform: true },
                },
              },
            },
          },
          orderBy: [{ scheduledDate: "asc" }, { createdAt: "asc" }],
        },
      },
    });

    if (!campaign) {
      throw new NotFoundException("营销战役不存在");
    }

    await this.tenant.assertUserInProject(userId, campaign.projectId);

    const progress = ContentCalendarEngine.calculateCampaignProgress(campaign.scheduleItems);

    const scheduleItems = campaign.scheduleItems.map((item) => {
      const isOverdue = ContentCalendarEngine.isItemOverdue(item.scheduledDate, item.timezone);
      const nextAction = ContentCalendarEngine.calculateNextAction(
        item.productionStatus,
        item.planItem,
        isOverdue,
      );
      return {
        id: item.id,
        campaignId: item.campaignId,
        planItemId: item.planItemId,
        scheduledDate: item.scheduledDate,
        scheduledTime: item.scheduledTime,
        timezone: item.timezone,
        productionStatus: item.productionStatus,
        blockReason: item.blockReason,
        assignedToId: item.assignedToId,
        dependsOnItemId: item.dependsOnItemId,
        dependsOn: item.dependsOn,
        isOverdue,
        nextAction,
        planItem: {
          id: item.planItem.id,
          title: item.planItem.title,
          platform: item.planItem.platform,
          format: item.planItem.format,
          pillar: (item.planItem.metadata as any)?.pillar ?? null,
          objective: item.planItem.objective,
          geoTarget: item.planItem.geoTarget,
          targetQueries: item.planItem.targetQueries,
          keyClaims: item.planItem.keyClaims,
          status: item.planItem.status,
          draftId: item.planItem.draftId,
          metadata: item.planItem.metadata,
        },
        metadata: item.metadata,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    });

    return {
      id: campaign.id,
      organizationId: campaign.organizationId,
      projectId: campaign.projectId,
      name: campaign.name,
      description: campaign.description,
      status: campaign.status,
      objective: campaign.objective,
      primaryGeoGap: campaign.primaryGeoGap,
      startDate: campaign.startDate,
      endDate: campaign.endDate,
      strategyId: campaign.strategyId,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
      lineage: {
        strategyId: campaign.strategyId,
        strategyName: campaign.strategy?.title,
        opportunityId: campaign.strategy?.sourceOpportunityId ?? null,
        recommendationId: campaign.strategy?.sourceRecommendationId ?? null,
        diagnosisId: campaign.strategy?.sourceDiagnosisId ?? null,
      },
      progress,
      scheduleItems,
    };
  }

  /**
   * 更新战役信息
   */
  async updateCampaign(userId: string, campaignId: string, dto: UpdateContentCampaignDto) {
    const campaign = await this.db.client.contentCampaign.findFirst({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException("营销战役不存在");
    }

    await this.tenant.assertUserInProject(userId, campaign.projectId);

    if (dto.status && !CAMPAIGN_STATUSES.includes(dto.status as any)) {
      throw new BadRequestException(`非法战役状态: ${dto.status}`);
    }

    const startDate = dto.startDate ? new Date(dto.startDate) : campaign.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : campaign.endDate;

    if (endDate.getTime() < startDate.getTime()) {
      throw new BadRequestException("战役结束时间不能早于开始时间");
    }

    const updated = await this.db.client.contentCampaign.update({
      where: { id: campaignId },
      data: {
        name: dto.name?.trim() ?? campaign.name,
        description: dto.description !== undefined ? dto.description?.trim() || null : campaign.description,
        objective: dto.objective?.trim() ?? campaign.objective,
        primaryGeoGap: dto.primaryGeoGap?.trim() ?? campaign.primaryGeoGap,
        startDate,
        endDate,
        status: dto.status ?? campaign.status,
      },
    });

    const action = dto.status && dto.status !== campaign.status ? "CAMPAIGN_STATUS_CHANGED" : "CAMPAIGN_UPDATED";
    await this.audit(
      campaign.organizationId,
      userId,
      action,
      `campaign=${campaignId}, name=${updated.name}, status=${updated.status}`,
      { projectId: campaign.projectId, campaignId },
    );

    return this.getCampaignById(userId, campaignId);
  }

  /**
   * 重新规划 / 生成排期时间表 (Calendar Generation)
   */
  async generateCalendar(userId: string, campaignId: string, dto: GenerateCalendarDto) {
    const campaign = await this.db.client.contentCampaign.findFirst({
      where: { id: campaignId },
      include: {
        strategy: {
          include: {
            planItems: { orderBy: { sortOrder: "asc" } },
          },
        },
      },
    });
    if (!campaign) {
      throw new NotFoundException("营销战役不存在");
    }

    await this.tenant.assertUserInProject(userId, campaign.projectId);

    const planItems = campaign.strategy?.planItems || [];
    if (planItems.length === 0) {
      throw new BadRequestException("战役关联的战略中无可用计划项");
    }

    const startDate = dto.startDate ? new Date(dto.startDate) : campaign.startDate;
    const pacingStrategy = dto.pacingStrategy || dto.pacing || "WORKDAYS_ONLY";
    const maxItemsPerDay = dto.maxItemsPerDay || 2;
    const timezone = dto.timezone || "Asia/Shanghai";

    const timeline = ContentCalendarEngine.generateScheduleTimeline(planItems, {
      startDate,
      pacingStrategy,
      maxItemsPerDay,
      timezone,
    });

    // 查找已有排期项
    const existingScheduleItems = await this.db.client.contentScheduleItem.findMany({
      where: { campaignId },
    });

    const existingMap = new Map<string, typeof existingScheduleItems[0]>();
    for (const item of existingScheduleItems) {
      existingMap.set(item.planItemId, item);
    }

    const planItemToScheduleItemMap = new Map<string, string>();

    // 事务批量更新/创建
    await this.db.client.$transaction(async (tx) => {
      for (const item of timeline) {
        const existing = existingMap.get(item.planItemId);
        if (existing) {
          // 保留已有的 assign 与已进阶生产状态
          const shouldPreserveStatus = [
            "DRAFT_CREATED",
            "IN_REVIEW",
            "APPROVED",
            "READY_TO_PUBLISH",
            "DONE",
          ].includes(existing.productionStatus);

          const updated = await tx.contentScheduleItem.update({
            where: { id: existing.id },
            data: {
              scheduledDate: item.scheduledDate,
              scheduledTime: item.scheduledTime,
              timezone: item.timezone,
              productionStatus: shouldPreserveStatus ? existing.productionStatus : item.productionStatus,
              blockReason: shouldPreserveStatus ? existing.blockReason : item.blockReason,
            },
          });
          planItemToScheduleItemMap.set(item.planItemId, updated.id);
        } else {
          const created = await tx.contentScheduleItem.create({
            data: {
              organizationId: campaign.organizationId,
              projectId: campaign.projectId,
              campaignId: campaign.id,
              planItemId: item.planItemId,
              scheduledDate: item.scheduledDate,
              scheduledTime: item.scheduledTime,
              timezone: item.timezone,
              productionStatus: item.productionStatus,
              blockReason: item.blockReason,
              metadata: {
                platform: item.planItem?.platform,
                format: item.planItem?.format,
                title: item.planItem?.title,
              },
            },
          });
          planItemToScheduleItemMap.set(item.planItemId, created.id);
        }
      }

      // 第二遍绑定依赖项
      for (const item of timeline) {
        if (item.dependsOnPlanItemId) {
          const scheduleItemId = planItemToScheduleItemMap.get(item.planItemId);
          const dependsOnScheduleItemId = planItemToScheduleItemMap.get(item.dependsOnPlanItemId);
          if (scheduleItemId && dependsOnScheduleItemId) {
            await tx.contentScheduleItem.update({
              where: { id: scheduleItemId },
              data: { dependsOnItemId: dependsOnScheduleItemId },
            });
          }
        }
      }
    });

    await this.audit(
      campaign.organizationId,
      userId,
      "CALENDAR_GENERATED",
      `campaign=${campaignId}, pacing=${pacingStrategy}, startDate=${startDate.toISOString()}`,
      { projectId: campaign.projectId, campaignId },
    );

    return this.getCampaignById(userId, campaignId);
  }

  /**
   * 获取日历视图数据
   */
  async getCalendar(userId: string, campaignId: string, timezone?: string) {
    const campaign = await this.getCampaignById(userId, campaignId);
    const tz = timezone || "Asia/Shanghai";

    // 按日期将排期项分组
    const byDate: Record<string, any[]> = {};

    for (const item of campaign.scheduleItems) {
      const dateStr = item.scheduledDate instanceof Date
        ? item.scheduledDate.toISOString().slice(0, 10)
        : String(item.scheduledDate).slice(0, 10);

      if (!byDate[dateStr]) {
        byDate[dateStr] = [];
      }
      byDate[dateStr].push(item);
    }

    return {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        startDate: campaign.startDate,
        endDate: campaign.endDate,
        status: campaign.status,
        lineage: campaign.lineage,
        progress: campaign.progress,
      },
      timezone: tz,
      items: campaign.scheduleItems,
      byDate,
    };
  }

  /**
   * 更新排期项 (日期、负责人、状态、依赖等)
   */
  async updateScheduleItem(userId: string, itemId: string, dto: UpdateScheduleItemDto) {
    const item = await this.db.client.contentScheduleItem.findFirst({
      where: { id: itemId },
      include: {
        campaign: true,
        planItem: true,
      },
    });

    if (!item) {
      throw new NotFoundException("排期项不存在");
    }

    await this.tenant.assertUserInProject(userId, item.projectId);

    // 校验负责人是否属于当前组织
    if (dto.assignedToId) {
      const membership = await this.db.client.organizationMember.findUnique({
        where: {
          userId_organizationId: {
            organizationId: item.organizationId,
            userId: dto.assignedToId,
          },
        },
      });
      if (!membership) {
        throw new BadRequestException("指派人员不是当前组织成员");
      }
    }

    // 校验生产状态合法性
    if (dto.productionStatus && !PRODUCTION_STATUSES.includes(dto.productionStatus as any)) {
      throw new BadRequestException(`非法生产状态: ${dto.productionStatus}`);
    }

    // 校验依赖项必须存在且不能依赖自身
    if (dto.dependsOnItemId) {
      if (dto.dependsOnItemId === itemId) {
        throw new BadRequestException("排期项不能依赖自身");
      }
      const depItem = await this.db.client.contentScheduleItem.findFirst({
        where: { id: dto.dependsOnItemId, campaignId: item.campaignId },
      });
      if (!depItem) {
        throw new BadRequestException("依赖的排期项不存在或不属于同一战役");
      }
    }

    const scheduledDate = dto.scheduledDate ? new Date(dto.scheduledDate) : item.scheduledDate;

    const updated = await this.db.client.contentScheduleItem.update({
      where: { id: itemId },
      data: {
        scheduledDate,
        scheduledTime: dto.scheduledTime !== undefined ? dto.scheduledTime : item.scheduledTime,
        timezone: dto.timezone ?? item.timezone,
        productionStatus: dto.productionStatus ?? item.productionStatus,
        blockReason: dto.blockReason !== undefined ? dto.blockReason : item.blockReason,
        assignedToId: dto.assignedToId !== undefined ? dto.assignedToId : item.assignedToId,
        dependsOnItemId: dto.dependsOnItemId !== undefined ? dto.dependsOnItemId : item.dependsOnItemId,
      },
      include: {
        planItem: true,
        dependsOn: {
          select: {
            id: true,
            scheduledDate: true,
            productionStatus: true,
            planItem: { select: { title: true, platform: true } },
          },
        },
      },
    });

    let auditAction = "SCHEDULE_ITEM_UPDATED";
    if (dto.assignedToId && dto.assignedToId !== item.assignedToId) {
      auditAction = "ASSIGNMENT_CHANGED";
    } else if (dto.scheduledDate && new Date(dto.scheduledDate).getTime() !== item.scheduledDate.getTime()) {
      auditAction = "SCHEDULE_CHANGED";
    }

    await this.audit(
      item.organizationId,
      userId,
      auditAction,
      `itemId=${itemId}, status=${updated.productionStatus}, assignedTo=${updated.assignedToId}`,
      { projectId: item.projectId, campaignId: item.campaignId, itemId },
    );

    const isOverdue = ContentCalendarEngine.isItemOverdue(updated.scheduledDate, updated.timezone);
    const nextAction = ContentCalendarEngine.calculateNextAction(
      updated.productionStatus,
      updated.planItem,
      isOverdue,
    );

    return {
      ...updated,
      isOverdue,
      nextAction,
    };
  }

  /**
   * 生产执行队列 (Production Queue)
   * 确定性多维排序，可解释性优先
   */
  async getProductionQueue(userId: string, projectId: string, query: QueueQueryDto) {
    await this.tenant.assertUserInProject(userId, projectId);

    const where: any = { projectId };

    if (query.campaignId) {
      where.campaignId = query.campaignId;
    }
    const targetStatus = query.productionStatus || query.status;
    if (targetStatus) {
      where.productionStatus = targetStatus;
    }
    if (query.assignedToId) {
      where.assignedToId = query.assignedToId;
    }
    if (query.platform) {
      where.planItem = { platform: query.platform };
    }

    const items = await this.db.client.contentScheduleItem.findMany({
      where,
      include: {
        planItem: true,
        campaign: {
          select: {
            id: true,
            name: true,
            status: true,
            strategyId: true,
          },
        },
        dependsOn: {
          select: {
            id: true,
            scheduledDate: true,
            productionStatus: true,
            planItem: { select: { title: true, platform: true } },
          },
        },
      },
    });

    // 计算 isOverdue 与 nextAction
    const mapped = items.map((item) => {
      const isOverdue = ContentCalendarEngine.isItemOverdue(item.scheduledDate, item.timezone);
      const nextAction = ContentCalendarEngine.calculateNextAction(
        item.productionStatus,
        item.planItem,
        isOverdue,
      );
      return {
        id: item.id,
        campaignId: item.campaignId,
        campaignName: item.campaign?.name,
        campaignStatus: item.campaign?.status,
        strategyId: item.campaign?.strategyId,
        planItemId: item.planItemId,
        scheduledDate: item.scheduledDate,
        scheduledTime: item.scheduledTime,
        timezone: item.timezone,
        productionStatus: item.productionStatus,
        blockReason: item.blockReason,
        assignedToId: item.assignedToId,
        dependsOnItemId: item.dependsOnItemId,
        dependsOn: item.dependsOn,
        isOverdue,
        nextAction,
        planItem: {
          id: item.planItem.id,
          title: item.planItem.title,
          platform: item.planItem.platform,
          format: item.planItem.format,
          pillar: (item.planItem.metadata as any)?.pillar ?? null,
          objective: item.planItem.objective,
          geoTarget: item.planItem.geoTarget,
          targetQueries: item.planItem.targetQueries,
          keyClaims: item.planItem.keyClaims,
          status: item.planItem.status,
          draftId: item.planItem.draftId,
          metadata: item.planItem.metadata,
        },
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    });

    // 过滤 overdueOnly
    const filtered = query.overdueOnly ? mapped.filter((i) => i.isOverdue) : mapped;

    // 确定性排序 (逾期排前 -> 排期升序 -> 平台优先级 -> 状态就绪 -> 创建时间)
    filtered.sort(ContentCalendarEngine.compareQueueItems);

    // 汇总队列指标
    const summary = {
      total: items.length,
      overdueCount: mapped.filter((i) => i.isOverdue).length,
      blockedCount: mapped.filter((i) => i.productionStatus === "BLOCKED_FACTS" || i.productionStatus === "BLOCKED_ASSETS").length,
      readyCount: mapped.filter((i) => i.productionStatus === "READY").length,
      inProgressCount: mapped.filter((i) => ["IN_PROGRESS", "DRAFT_CREATED", "IN_REVIEW"].includes(i.productionStatus)).length,
      doneCount: mapped.filter((i) => ["APPROVED", "READY_TO_PUBLISH", "DONE"].includes(i.productionStatus)).length,
    };

    return {
      summary,
      items: filtered,
    };
  }

  /**
   * 从排期项触发生产 (Start Production -> Draft -> AI Content Engine V2)
   * 严格继承 M9A 事实与物料准入阻断守卫
   */
  async startProduction(userId: string, itemId: string) {
    const item = await this.db.client.contentScheduleItem.findFirst({
      where: { id: itemId },
      include: {
        planItem: true,
        campaign: true,
      },
    });

    if (!item) {
      throw new NotFoundException("排期项不存在");
    }

    await this.tenant.assertUserInProject(userId, item.projectId);

    // 1. 服务端准入安全阻断守卫 (Server-side Blocking Guards)
    if (
      item.productionStatus === "BLOCKED_FACTS" ||
      item.planItem.status === "FACT_INPUT_REQUIRED"
    ) {
      const missingFacts = (item.planItem.metadata as any)?.missingFacts || [];
      throw new BadRequestException({
        error: "PLAN_FACT_INPUT_REQUIRED",
        message: "该排期项缺少事实依据，无法直接开始生产，请先在知识库中补充事实依据",
        missingFacts,
      });
    }

    if (
      item.productionStatus === "BLOCKED_ASSETS" ||
      item.planItem.status === "ASSET_INPUT_REQUIRED"
    ) {
      const missingAssets = (item.planItem.metadata as any)?.missingAssets || [];
      throw new BadRequestException({
        error: "PLAN_ASSET_INPUT_REQUIRED",
        message: "该排期项缺少视频物料，无法直接开始生产，请先上传视频资产",
        missingAssets,
      });
    }

    // 2. 委托已冻结的 ContentStrategyService.createDraftFromPlanItem 进行幂等草稿创建
    const draftResult = await this.strategyService.createDraftFromPlanItem(
      userId,
      item.campaign.strategyId,
      item.planItemId,
      { force: false },
    );

    // 3. 更新排期项状态为 DRAFT_CREATED
    const updatedScheduleItem = await this.db.client.contentScheduleItem.update({
      where: { id: itemId },
      data: {
        productionStatus: "DRAFT_CREATED",
        metadata: {
          ...(typeof item.metadata === "object" && item.metadata !== null ? item.metadata : {}),
          draftId: draftResult.draft.id,
          reused: draftResult.reused ?? false,
          startedProductionAt: new Date().toISOString(),
          startedProductionBy: userId,
        },
      },
      include: {
        planItem: true,
      },
    });

    await this.audit(
      item.organizationId,
      userId,
      "PRODUCTION_STARTED",
      `itemId=${itemId}, draftId=${draftResult.draft.id}, reused=${draftResult.reused ?? false}`,
      {
        projectId: item.projectId,
        campaignId: item.campaignId,
        itemId,
        draftId: draftResult.draft.id,
      },
    );

    const isOverdue = ContentCalendarEngine.isItemOverdue(
      updatedScheduleItem.scheduledDate,
      updatedScheduleItem.timezone,
    );
    const nextAction = ContentCalendarEngine.calculateNextAction(
      updatedScheduleItem.productionStatus,
      updatedScheduleItem.planItem,
      isOverdue,
    );

    return {
      scheduleItem: {
        ...updatedScheduleItem,
        isOverdue,
        nextAction,
      },
      draft: draftResult.draft,
      reused: draftResult.reused ?? false,
    };
  }
}
