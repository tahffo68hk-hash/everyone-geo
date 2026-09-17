import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@geo/database";
import { PrismaService } from "../prisma.service";
import { TenantService } from "../common/tenant.service";
import {
  ContentStrategyEngine,
  type StrategyEngineInput,
} from "./content-strategy-engine";
import {
  GenerateStrategyDto,
  UpdatePlanItemDto,
  CreateDraftFromPlanItemDto,
  ListStrategiesDto,
} from "./dto/content-strategy.dto";

const logger = new Logger("ContentStrategyService");

@Injectable()
export class ContentStrategyService {
  constructor(
    private readonly db: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  /**
   * 基于 Opportunity / Recommendation / Diagnosis 生成内容战略与生产计划
   */
  async generateStrategy(userId: string, projectId: string, dto: GenerateStrategyDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);

    const targetOppIds: string[] = [];
    if (Array.isArray(dto.opportunityIds) && dto.opportunityIds.length > 0) {
      targetOppIds.push(...dto.opportunityIds);
    } else if (dto.opportunityId) {
      targetOppIds.push(dto.opportunityId);
    }

    let opportunities: any[] = [];
    if (targetOppIds.length > 0) {
      opportunities = await this.db.client.contentOpportunity.findMany({
        where: {
          id: { in: targetOppIds },
          opportunityRun: { projectId },
        },
        include: {
          queries: { orderBy: { sortOrder: "asc" } },
          blocks: { orderBy: { sortOrder: "asc" } },
          recommendations: { include: { recommendation: true } },
        },
      });
      if (opportunities.length === 0) {
        throw new NotFoundException("来源 Opportunity 不存在或不属于该项目");
      }
    }

    let recommendation = null;
    let diagnosisRun = null;

    if (dto.recommendationId) {
      recommendation = await this.db.client.recommendation.findFirst({
        where: {
          id: dto.recommendationId,
          recommendationRun: { projectId },
        },
      });
      if (!recommendation) {
        throw new NotFoundException("来源 Recommendation 不存在或不属于该项目");
      }
    }

    if (dto.diagnosisRunId) {
      diagnosisRun = await this.db.client.diagnosisRun.findFirst({
        where: { id: dto.diagnosisRunId, projectId },
      });
      if (!diagnosisRun) {
        throw new NotFoundException("来源 DiagnosisRun 不存在或不属于该项目");
      }
    }

    // 读取该项目已核实的事实证据
    let facts: any[] = [];
    try {
      facts = await this.db.client.$queryRawUnsafe<any[]>(
        `SELECT claim, fact_type as "factType", status, source_ref as "sourceRef"
         FROM content_verified_facts
         WHERE project_id = $1::uuid AND status = 'VERIFIED'`,
        projectId,
      );
    } catch {
      facts = [];
    }

    // 读取该项目已上传的物料资产（如视频素材）
    let assets: any[] = [];
    try {
      const dbAssets = await this.db.client.contentAsset.findMany({
        where: { projectId },
        select: { id: true, type: true, storageKey: true },
      });
      assets = dbAssets.map((a) => ({
        id: a.id,
        assetType: a.type,
      }));
    } catch {
      assets = [];
    }

    const fullProject = await this.db.client.project.findUnique({ where: { id: projectId } });
    const projectName = fullProject?.name || "项目";
    const targetEntity = dto.targetEntity || (fullProject as any)?.targetEntity || projectName;

    const engineInput: StrategyEngineInput = {
      targetEntity,
      projectName,
      industry: (fullProject as any)?.industry || null,
      customGuidance: dto.customGuidance,
      opportunity: opportunities[0] || null,
      opportunities,
      recommendation,
      diagnosisRun,
      verifiedFacts: facts,
      availableAssets: assets,
      baselineMetrics: dto.baselineMetrics,
      targetMetrics: dto.targetMetrics,
    };

    const output = ContentStrategyEngine.generateStrategy(engineInput);
    const strategyTitle = dto.title || output.title;
    const primaryOppId = opportunities[0]?.id ?? dto.opportunityId ?? null;

    // 事务写入战略及计划项
    const strategy = await this.db.client.$transaction(async (tx) => {
      const strat = await tx.contentStrategy.create({
        data: {
          organizationId: project.organizationId,
          projectId,
          title: strategyTitle,
          sourceOpportunityId: primaryOppId,
          sourceRecommendationId: dto.recommendationId ?? null,
          sourceDiagnosisId: dto.diagnosisRunId ?? null,
          status: "ACTIVE",
          geoGap: output.geoGap,
          priorityQuestions: output.priorityQuestions as unknown as Prisma.InputJsonValue,
          targetAudience: output.targetAudience,
          perceptionGoal: output.perceptionGoal,
          keyThemes: output.keyThemes as unknown as Prisma.InputJsonValue,
          platformPriorities: output.platformPriorities as unknown as Prisma.InputJsonValue,
          contentFormats: output.contentFormats as unknown as Prisma.InputJsonValue,
          evidenceRequired: output.evidenceRequired as unknown as Prisma.InputJsonValue,
          validationMetrics: output.validationMetrics as unknown as Prisma.InputJsonValue,
          metadata: output.metadata ? (output.metadata as unknown as Prisma.InputJsonValue) : {},
          createdById: userId,
        },
      });

      const planItemsData = output.planItems.map((item) => ({
        strategyId: strat.id,
        organizationId: project.organizationId,
        projectId,
        title: item.title,
        platform: item.platform,
        format: item.format,
        objective: item.objective,
        geoTarget: item.geoTarget,
        targetQueries: item.targetQueries as unknown as Prisma.InputJsonValue,
        keyClaims: item.keyClaims as unknown as Prisma.InputJsonValue,
        status: item.status,
        sourceOpportunityId: item.metadata?.sourceOpportunityIds?.[0] ?? primaryOppId,
        sortOrder: item.sortOrder,
        metadata: item.metadata ? (item.metadata as unknown as Prisma.InputJsonValue) : {},
      }));

      await tx.contentPlanItem.createMany({
        data: planItemsData,
      });

      return tx.contentStrategy.findUniqueOrThrow({
        where: { id: strat.id },
        include: {
          planItems: { orderBy: { sortOrder: "asc" } },
        },
      });
    });

    logger.log(
      JSON.stringify({
        event: "strategy_generated",
        organizationId: project.organizationId,
        projectId,
        strategyId: strategy.id,
        planItemCount: strategy.planItems.length,
      }),
    );

    return strategy;
  }

  /**
   * 获取项目下的战略列表
   */
  async listStrategies(userId: string, projectId: string, dto: ListStrategiesDto) {
    await this.tenant.assertUserInProject(userId, projectId);

    const where: Prisma.ContentStrategyWhereInput = { projectId };
    if (dto.status) where.status = dto.status;

    const rows = await this.db.client.contentStrategy.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: dto.limit ?? 50,
      skip: dto.offset ?? 0,
      include: {
        _count: { select: { planItems: true } },
      },
    });

    return {
      total: rows.length,
      strategies: rows.map((r) => ({
        ...r,
        planItemCount: r._count.planItems,
      })),
    };
  }

  /**
   * 获取单个战略详情（包含全部 9 维度分析与计划项）
   */
  async getStrategy(userId: string, strategyId: string) {
    const strategy = await this.db.client.contentStrategy.findUnique({
      where: { id: strategyId },
      include: {
        planItems: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!strategy) {
      throw new NotFoundException("内容战略不存在");
    }
    await this.tenant.assertUserInOrganization(userId, strategy.organizationId);

    return strategy;
  }

  /**
   * 更新计划项（如标题、状态、目标等）
   */
  async updatePlanItem(userId: string, strategyId: string, itemId: string, dto: UpdatePlanItemDto) {
    const strategy = await this.getStrategy(userId, strategyId);
    const item = await this.db.client.contentPlanItem.findFirst({
      where: { id: itemId, strategyId: strategy.id },
    });
    if (!item) {
      throw new NotFoundException("计划项不存在或不属于该战略");
    }

    const data: Prisma.ContentPlanItemUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.platform !== undefined) data.platform = dto.platform;
    if (dto.format !== undefined) data.format = dto.format;
    if (dto.objective !== undefined) data.objective = dto.objective;
    if (dto.geoTarget !== undefined) data.geoTarget = dto.geoTarget;
    if (dto.targetQueries !== undefined) data.targetQueries = dto.targetQueries as unknown as Prisma.InputJsonValue;
    if (dto.keyClaims !== undefined) data.keyClaims = dto.keyClaims as unknown as Prisma.InputJsonValue;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

    return this.db.client.contentPlanItem.update({
      where: { id: itemId },
      data,
    });
  }

  /**
   * 闭环转化：一键自 ContentPlanItem 派生 ContentDraft
   */
  async createDraftFromPlanItem(
    userId: string,
    strategyId: string,
    itemId: string,
    dto: CreateDraftFromPlanItemDto,
  ) {
    const strategy = await this.getStrategy(userId, strategyId);
    const item = await this.db.client.contentPlanItem.findFirst({
      where: { id: itemId, strategyId: strategy.id },
    });
    if (!item) {
      throw new NotFoundException("计划项不存在或不属于该战略");
    }

    // AG-M9A-05 & AG-M9A-06: 服务端准入安全阻断守卫 (Server-side guards)
    if (item.status === "FACT_INPUT_REQUIRED" && !dto.force) {
      const missingFacts = (item.metadata as any)?.missingFacts || [];
      throw new BadRequestException({
        error: "PLAN_FACT_INPUT_REQUIRED",
        message: "该计划项尚缺少关键核验事实依据，无法直接生成草稿，请先在知识库中补充事实依据",
        missingFacts,
      });
    }

    if (item.status === "ASSET_INPUT_REQUIRED" && !dto.force) {
      const missingAssets = (item.metadata as any)?.missingAssets || [];
      throw new BadRequestException({
        error: "PLAN_ASSET_INPUT_REQUIRED",
        message: "该计划项需要视频物料前置就绪，当前项目暂无可用视频资产",
        missingAssets,
      });
    }

    // AG-M9A-05 (Requirement 15): 重复 Draft 防护 - 默认幂等复用，除非要求 createNewRevision
    if (item.draftId) {
      const existingDraft = await this.db.client.contentDraft.findFirst({
        where: { id: item.draftId },
        include: {
          revisions: { orderBy: [{ version: "desc" }], take: 1 },
          _count: { select: { revisions: true } },
        },
      });
      if (existingDraft) {
        if (!dto.createNewRevision) {
          return {
            draft: this.toDraftView(existingDraft),
            planItem: item,
            reused: true,
          };
        } else {
          // 在已有草稿上增加新版本 Revision，防止创建孤儿/重复草稿
          const maxRev = await this.db.client.contentRevision.aggregate({
            where: { draftId: existingDraft.id },
            _max: { version: true },
          });
          const nextVer = (maxRev._max.version ?? 0) + 1;
          const generatedBody = dto.body || ContentStrategyEngine.generateDraftBody({
            title: item.title,
            platform: item.platform,
            format: item.format,
            objective: item.objective,
            geoTarget: item.geoTarget,
            targetQueries: Array.isArray(item.targetQueries) ? (item.targetQueries as string[]) : [],
            keyClaims: Array.isArray(item.keyClaims) ? (item.keyClaims as string[]) : [],
          });
          await this.db.client.contentRevision.create({
            data: {
              draftId: existingDraft.id,
              version: nextVer,
              body: generatedBody,
              summary: dto.summary ?? item.objective,
              changeNote: dto.changeNote ?? `自计划项重新派生新版本 v${nextVer}`,
              generatedById: userId,
            },
          });
          const updatedDraft = await this.db.client.contentDraft.findUniqueOrThrow({
            where: { id: existingDraft.id },
            include: {
              revisions: { orderBy: [{ version: "desc" }], take: 1 },
              _count: { select: { revisions: true } },
            },
          });
          return {
            draft: this.toDraftView(updatedDraft),
            planItem: item,
            reused: false,
          };
        }
      }
    }

    // 生成结构化首版草稿正文
    const generatedBody = dto.body || ContentStrategyEngine.generateDraftBody({
      title: item.title,
      platform: item.platform,
      format: item.format,
      objective: item.objective,
      geoTarget: item.geoTarget,
      targetQueries: Array.isArray(item.targetQueries) ? (item.targetQueries as string[]) : [],
      keyClaims: Array.isArray(item.keyClaims) ? (item.keyClaims as string[]) : [],
    });

    const draft = await this.db.client.$transaction(async (tx) => {
      const newDraft = await tx.contentDraft.create({
        data: {
          organizationId: strategy.organizationId,
          projectId: strategy.projectId,
          title: item.title,
          topic: `${item.format} · ${item.objective}`,
          generationMode: "AI_ASSISTED",
          status: "DRAFT",
          sourceOpportunityId: item.sourceOpportunityId ?? strategy.sourceOpportunityId,
          sourceRecommendationId: strategy.sourceRecommendationId,
          sourceDiagnosisId: strategy.sourceDiagnosisId,
          sourceStrategyId: strategy.id,
          sourcePlanItemId: item.id,
          createdById: userId,
          revisions: {
            create: {
              version: 1,
              body: generatedBody,
              summary: dto.summary ?? item.objective,
              changeNote: dto.changeNote ?? "自 GEO 内容计划一键生成",
              generatedById: userId,
            },
          },
        },
        include: {
          revisions: { orderBy: [{ version: "desc" }], take: 1 },
          _count: { select: { revisions: true } },
        },
      });

      // 更新计划项状态为 DRAFTED，并绑定 draftId
      await tx.contentPlanItem.update({
        where: { id: item.id },
        data: {
          status: "DRAFTED",
          draftId: newDraft.id,
        },
      });

      return newDraft;
    });

    const updatedItem = await this.db.client.contentPlanItem.findUniqueOrThrow({
      where: { id: item.id },
    });

    await this.audit(
      strategy.organizationId,
      userId,
      "DRAFT_CREATED",
      `fromPlanItem=${item.id}, strategy=${strategy.id}, draftTitle=${draft.title.slice(0, 50)}`,
      { projectId: strategy.projectId, draftId: draft.id },
    );

    return {
      draft: this.toDraftView(draft),
      planItem: updatedItem,
      reused: false,
    };
  }

  private async audit(
    organizationId: string,
    actorId: string,
    action: string,
    detail: string | null,
    refs?: { projectId?: string; draftId?: string },
  ) {
    await this.db.client.contentAuditLog.create({
      data: {
        organizationId,
        projectId: refs?.projectId ?? null,
        draftId: refs?.draftId ?? null,
        action: action as Prisma.ContentAuditLogCreateInput["action"],
        actorId,
        detail: detail ? detail.slice(0, 500) : null,
      },
    });
  }

  private toDraftView(
    d: Prisma.ContentDraftGetPayload<{ include: { revisions: true } }> & { _count?: { revisions: number } },
  ) {
    const revs = (d.revisions ?? []) as Array<{ id: string; version: number; body: string; summary: string | null; changeNote: string | null; generatedById: string; createdAt: Date }>;
    const latest = revs.length ? revs[0] : null;
    const revisionCount = typeof d._count?.revisions === "number" ? d._count.revisions : revs.length;
    return {
      id: d.id,
      organizationId: d.organizationId,
      projectId: d.projectId,
      title: d.title,
      topic: d.topic,
      generationMode: d.generationMode,
      status: d.status,
      sourceOpportunityId: d.sourceOpportunityId,
      sourceRecommendationId: d.sourceRecommendationId,
      sourceDiagnosisId: d.sourceDiagnosisId,
      sourceStrategyId: d.sourceStrategyId,
      sourcePlanItemId: d.sourcePlanItemId,
      createdById: d.createdById,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      latestRevision: latest
        ? { id: latest.id, version: latest.version, body: latest.body, summary: latest.summary, changeNote: latest.changeNote, generatedById: latest.generatedById, createdAt: latest.createdAt }
        : null,
      revisionCount,
    };
  }
}
