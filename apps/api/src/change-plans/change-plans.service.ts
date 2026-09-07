import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@geo/database";
import { CHANGE_PLAN_VERSION, blocksToChangeItems } from "@geo/core";
import { PrismaService } from "../prisma.service";

type JsonValue = Prisma.InputJsonValue;
const logger = new Logger("ChangePlansService");

/**
 * M8B — Optimization Change Plan（编辑说明，不是正文 / 不自动发布）。
 * 生成自 ContentOpportunity 的 blocks（title/purpose → section/instruction/reason），
 * 回链 source Recommendation / Finding（普通 uuid 归档）。状态只允许人工推进。
 */
@Injectable()
export class ChangePlansService {
  constructor(private readonly db: PrismaService) {}

  /** 为 ContentOpportunity 生成 Change Plan（幂等：同 opportunity 未取消的 DRAFT 优先复用）。 */
  async createFromOpportunity(userId: string, contentOpportunityId: string, opts: { siteAssetId?: string | null } = {}) {
    const opp = await this.db.client.contentOpportunity.findFirst({
      where: { id: contentOpportunityId, opportunityRun: { project: { organization: { members: { some: { userId } } } } } },
      include: {
        opportunityRun: { select: { projectId: true } },
        blocks: { orderBy: { sortOrder: "asc" } },
        recommendations: { select: { recommendationId: true } },
      },
    });
    if (!opp) throw new NotFoundException("内容机会不存在或无权访问");
    const projectId = opp.opportunityRun?.projectId;
    if (!projectId) throw new BadRequestException("内容机会缺失 projectId，无法创建变更计划。");
    if (opts.siteAssetId) {
      const asset = await this.db.client.siteAsset.findFirst({
        where: { id: opts.siteAssetId, site: { project: { organization: { members: { some: { userId } } } } } },
      });
      if (!asset) throw new NotFoundException("站点资产不存在或无权访问");
    }
    const existing = await this.db.client.optimizationChangePlan.findFirst({
      where: { contentOpportunityId: opp.id, status: { in: ["DRAFT", "APPROVED"] } },
      include: { items: { orderBy: { sortOrder: "asc" } }, siteAsset: true },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return this.presentPlan(existing, { reused: true });

    const blocks = opp.blocks;
    if (!blocks || blocks.length === 0) {
      throw new BadRequestException("内容机会没有建议结构块，无法生成变更计划。");
    }
    const items = blocksToChangeItems(blocks.map(b => ({ blockType: b.blockType, title: b.title, purpose: b.purpose, sortOrder: b.sortOrder })));
    const sourceRecIds = (opp.recommendations ?? []).map(r => r.recommendationId).slice(0, 5);

    const plan = await this.db.client.optimizationChangePlan.create({
      data: {
        projectId,
        contentOpportunityId: opp.id,
        siteAssetId: opts.siteAssetId ?? null,
        changePlanVersion: CHANGE_PLAN_VERSION,
        title: `${opp.titleDirection} — 变更计划`,
        summary:
          `本计划由内容机会确定性生成（${items.length} 个编辑说明项），用于指导人工执行；` +
          `GeoLens 不会自动修改或发布网站。内容须为真实可核验信息，禁止编造事实。`,
        status: "DRAFT",
        items: {
          create: items.map((item, index) => ({
            section: item.section, changeType: item.changeType,
            instruction: item.instruction, reason: item.reason, sortOrder: item.sortOrder,
            sourceRecommendationId: sourceRecIds[index % Math.max(sourceRecIds.length, 1)] ?? null,
          })),
        },
        metadata: { generatedBy: "m8-change-plan-v1", opportunityType: opp.opportunityType } as JsonValue,
      },
      include: { items: { orderBy: { sortOrder: "asc" } }, contentOpportunity: true },
    });
    logger.log(JSON.stringify({ event: "change_plan_created", changePlanId: plan.id, contentOpportunityId: opp.id, itemCount: items.length }));
    return this.presentPlan(plan);
  }

  async listByOpportunity(userId: string, contentOpportunityId: string) {
    const opp = await this.db.client.contentOpportunity.findFirst({
      where: { id: contentOpportunityId, opportunityRun: { project: { organization: { members: { some: { userId } } } } } },
    });
    if (!opp) throw new NotFoundException("内容机会不存在或无权访问");
    const rows = await this.db.client.optimizationChangePlan.findMany({
      where: { contentOpportunityId },
      include: { items: { orderBy: { sortOrder: "asc" } }, siteAsset: true },
      orderBy: { createdAt: "desc" },
    });
    return { contentOpportunityId, changePlans: rows.map(r => this.presentPlan(r)) };
  }

  async getPlan(userId: string, changePlanId: string) {
    const plan = await this.planForUser(userId, changePlanId);
    return this.presentPlan(plan, { includeContent: true });
  }

  async updateStatus(userId: string, changePlanId: string, status: string) {
    const plan = await this.planForUser(userId, changePlanId);
    if (!["DRAFT", "APPROVED", "EXECUTED_MANUALLY", "CANCELLED"].includes(status)) {
      throw new BadRequestException("status 只允许 DRAFT / APPROVED / EXECUTED_MANUALLY / CANCELLED。");
    }
    if (plan.status === "EXECUTED_MANUALLY" || plan.status === "CANCELLED") {
      throw new BadRequestException(`计划已 ${plan.status}，不能改变状态。`);
    }
    const updated = await this.db.client.optimizationChangePlan.update({
      where: { id: changePlanId },
      data: {
        status,
        approvedAt: status === "APPROVED" ? new Date() : null,
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    logger.log(JSON.stringify({ event: "change_plan_status", changePlanId, status }));
    return this.presentPlan(updated);
  }

  /** 人工勾选 item 执行状态（PENDING / DONE / SKIPPED）。 */
  async updateItemStatus(userId: string, changePlanId: string, itemId: string, status: string) {
    await this.planForUser(userId, changePlanId);
    if (!["PENDING", "DONE", "SKIPPED"].includes(status)) {
      throw new BadRequestException("item status 只允许 PENDING / DONE / SKIPPED。");
    }
    const item = await this.db.client.optimizationChangeItem.findFirst({
      where: { id: itemId, changePlanId },
    });
    if (!item) throw new NotFoundException("变更项不存在");
    const updated = await this.db.client.optimizationChangeItem.update({
      where: { id: itemId },
      data: { status },
    });
    return updated;
  }

  private async planForUser(userId: string, changePlanId: string) {
    const plan = await this.db.client.optimizationChangePlan.findFirst({
      where: { id: changePlanId, project: { organization: { members: { some: { userId } } } } },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        siteAsset: { include: { site: { select: { id: true, name: true, baseUrl: true } } } },
        contentOpportunity: { select: { id: true, titleDirection: true, opportunityType: true } },
      },
    });
    if (!plan) throw new NotFoundException("变更计划不存在或无权访问");
    return plan;
  }

  private presentPlan(plan: any, options: { includeContent?: boolean; reused?: boolean } = {}) {
    const items = (plan.items ?? []).map((i: any) => ({
      id: i.id, section: i.section, changeType: i.changeType,
      instruction: i.instruction, reason: i.reason,
      sourceRecommendationId: i.sourceRecommendationId, sourceFindingId: i.sourceFindingId,
      sortOrder: i.sortOrder, status: i.status,
    }));
    return {
      id: plan.id,
      projectId: plan.projectId,
      contentOpportunityId: plan.contentOpportunityId,
      siteAssetId: plan.siteAssetId,
      siteAsset: plan.siteAsset ? {
        id: plan.siteAsset.id, url: plan.siteAsset.url, canonicalUrl: plan.siteAsset.canonicalUrl,
        title: plan.siteAsset.title, assetType: plan.siteAsset.assetType,
        site: plan.siteAsset.site,
      } : null,
      changePlanVersion: plan.changePlanVersion,
      title: plan.title,
      summary: plan.summary,
      status: plan.status,
      approvedAt: plan.approvedAt,
      itemCount: items.length,
      items: options.includeContent || plan.items !== undefined ? items : undefined,
      contentOpportunity: plan.contentOpportunity ?? undefined,
      createdAt: plan.createdAt, updatedAt: plan.updatedAt,
      ...(options.reused ? { reused: true } : {}),
    };
  }
}
