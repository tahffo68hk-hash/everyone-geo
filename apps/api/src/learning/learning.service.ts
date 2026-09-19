import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { TenantService } from "../common/tenant.service";
import {
  DEFAULT_OBSERVATION_VERSION,
  GenerateLearningObservationsDto,
  LearningContextSnapshot,
  LearningEvidenceSnapshot,
  LearningPatternSummary,
  LearningSignalsSnapshot,
  ObservationDirection,
  ObservationType,
  QueryLearningObservationsDto,
} from "./dto/learning.dto";

@Injectable()
export class LearningService {
  private readonly logger = new Logger(LearningService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  /**
   * 为某次 OutcomeComparison (与关联的 OutcomeAttribution) 生成确定性的事实型学习观察 (LearningObservation)
   * POST /outcomes/:id/learning-observations
   * 严格先授权再产生任何数据库写入与副作用
   */
  async generateOutcomeObservations(
    userId: string,
    outcomeComparisonId: string,
    dto?: GenerateLearningObservationsDto,
  ) {
    // 1. 查找 OutcomeComparison 及其全链路关联
    const outcome = await this.db.client.outcomeComparison.findUnique({
      where: { id: outcomeComparisonId },
      include: {
        publishedAsset: {
          include: {
            campaign: true,
            planItem: true,
          },
        },
        retestRun: true,
        retestItem: true,
        attributions: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!outcome) {
      throw new NotFoundException("对比结果不存在");
    }

    // 严格 Service-level 权限拦截（发生于任何计算与写库之前，零副作用防御）
    await this.tenant.assertUserInProject(userId, outcome.projectId);

    // 2. 跨实体 Lineage 注入校验
    if (dto?.publishedAssetId && dto.publishedAssetId !== outcome.publishedAssetId) {
      throw new BadRequestException("传入的落地资产 ID 与对比结果不匹配");
    }

    // 3. 解析对应的 OutcomeAttribution
    let attribution: (typeof outcome.attributions)[0] | null =
      outcome.attributions.find((a) =>
        dto?.outcomeAttributionId ? a.id === dto.outcomeAttributionId : true,
      ) ?? null;

    if (dto?.outcomeAttributionId && !attribution) {
      throw new BadRequestException("传入的归因 ID 与对比结果不匹配");
    }

    if (!attribution) {
      attribution = await this.db.client.outcomeAttribution.findFirst({
        where: { outcomeComparisonId: outcome.id },
        orderBy: { createdAt: "desc" },
      });
    }

    if (!attribution) {
      throw new BadRequestException("该对比结果尚未生成归因分析，请先完成归因评估");
    }

    // 4. 版本与快照提取
    const version = dto?.observationVersion?.trim() || DEFAULT_OBSERVATION_VERSION;
    const publishedAsset = outcome.publishedAsset;
    const delta = (outcome.deltaSnapshot as any) || {};
    const signals = (attribution.signalsSnapshot as any) || {};
    const confounders = (attribution.confoundersSnapshot as any) || {};

    const contextSnapshot: LearningContextSnapshot = {
      platform: publishedAsset.platform,
      verificationStatus: publishedAsset.verificationStatus,
      publishedAt: publishedAsset.publishedAt
        ? new Date(publishedAsset.publishedAt).toISOString()
        : null,
      title: publishedAsset.title,
      canonicalUrl: publishedAsset.canonicalUrl,
      campaignId: publishedAsset.campaignId,
      campaignName: publishedAsset.campaign?.name ?? null,
      planItemId: publishedAsset.planItemId,
      planItemTitle: publishedAsset.planItem?.title ?? null,
      targetQueries: (publishedAsset.planItem?.targetQueries as string[]) || [],
      queryTargetingStatus: signals.queryTargeting?.status ?? "UNKNOWN",
      queryId: outcome.queryId,
      queryText: outcome.queryText,
    };

    const evidenceSnapshot: LearningEvidenceSnapshot = {
      baselineEvidenceId: outcome.baselineEvidenceId,
      retestEvidenceId: outcome.retestEvidenceId,
      baselineCompatibility: outcome.baselineCompatibility,
      comparisonStatus: outcome.comparisonStatus,
      deltaSummary: outcome.summary,
      deltaSnapshot: outcome.deltaSnapshot,
    };

    const signalsSnapshot: LearningSignalsSnapshot = {
      attributionStatus: attribution.status,
      observedChangeType: attribution.observedChangeType,
      reasons: attribution.reasons,
      citationMatch: signals.citationMatch || {},
      queryTargeting: signals.queryTargeting || {},
      assetVerification: signals.assetVerification || {},
      temporalOrdering: signals.temporalOrdering || {},
      confounders,
    };

    // 5. 确定性推导事实型观察候选集 (Candidate Learning Observations)
    const candidates: Array<{
      type: ObservationType;
      direction: ObservationDirection;
      summary: string;
    }> = [];

    // 5.1 度量质量局限 (Measurement Limitations)
    if (outcome.comparisonStatus === "MISSING_BASELINE") {
      candidates.push({
        type: "MEASUREMENT_LIMITATION",
        direction: "UNKNOWN",
        summary: "该查询在发布前缺少有效基线评测凭证，无法进行发布前后的变化对比与因果关联推断。",
      });
    } else if (outcome.comparisonStatus === "INCOMPATIBLE") {
      candidates.push({
        type: "MEASUREMENT_LIMITATION",
        direction: "UNKNOWN",
        summary: `该查询基线与重测环境配置不匹配（${outcome.baselineCompatibility}），已阻断对比计算以防产生误导性推断。`,
      });
    } else if (outcome.comparisonStatus === "MISSING_RETEST_EVIDENCE") {
      candidates.push({
        type: "MEASUREMENT_LIMITATION",
        direction: "UNKNOWN",
        summary: "该查询重测任务未生成有效凭证或执行未成功，无法进行指标对比与归因评估。",
      });
    }

    // 5.2 归因局限与混杂因素 (Attribution Limitations)
    if (attribution.status === "CONFOUNDED") {
      const confounderDesc = confounders.multipleInterventions?.detected
        ? `监测时间窗口内存在 ${confounders.multipleInterventions.confoundingAssetIds?.length || 1} 篇其他落地资产并发发布`
        : confounders.modelChanged
        ? "基线与重测之间的模型版本发生变更"
        : confounders.retrievalModeChanged
        ? "基线与重测的检索模式发生变更"
        : "存在已知评测混杂因素干扰";
      candidates.push({
        type: "ATTRIBUTION_LIMITATION",
        direction: (attribution.observedChangeType as ObservationDirection) || "UNKNOWN",
        summary: `虽然观测到了指标变化，但${confounderDesc}，无法将变化独立归因于当前落地资产。`,
      });
    } else if (
      attribution.status === "INSUFFICIENT_EVIDENCE" &&
      (outcome.comparisonStatus === "COMPARABLE" ||
        outcome.comparisonStatus === "COMPARABLE_WITH_WARNING")
    ) {
      if (signals.citationMatch?.status === "SAME_DOMAIN_OTHER_PAGE") {
        candidates.push({
          type: "ATTRIBUTION_LIMITATION",
          direction: (attribution.observedChangeType as ObservationDirection) || "UNKNOWN",
          summary: "AI 回答引用了该品牌的同域名其他页面，但未直接引用本次核验发布的具体落地资产 URL，关联证据不足。",
        });
      } else if (signals.citationMatch?.status === "NO_ASSET_CITATION" || !signals.citationMatch?.matchedUrl) {
        candidates.push({
          type: "ATTRIBUTION_LIMITATION",
          direction: (attribution.observedChangeType as ObservationDirection) || "UNKNOWN",
          summary: "AI 回答中未直接引用本次发布的落地资产链接，缺乏直接关联证据，无法判定为可能相关。",
        });
      }
    }

    // 5.3 细分指标变化观察 (Metric Observations - 仅在可比状态下提取)
    if (
      outcome.comparisonStatus === "COMPARABLE" ||
      outcome.comparisonStatus === "COMPARABLE_WITH_WARNING"
    ) {
      // 品牌提及变动
      if (delta.brandMention?.changed) {
        if (delta.brandMention.change === "ABSENT_TO_PRESENT") {
          candidates.push({
            type: "BRAND_MENTION_CHANGE",
            direction: "POSITIVE",
            summary: `发布后该查询由“未提及品牌”转变为“提及品牌”；评测条件${outcome.baselineCompatibility === "EXACT_MATCH" ? "严格一致" : "兼容"}${
              attribution.status === "LIKELY_RELATED"
                ? "，且回答直接引用了落地资产，判定为可能相关"
                : "，但当前关联证据不足"
            }。`,
          });
        } else if (delta.brandMention.change === "PRESENT_TO_ABSENT") {
          candidates.push({
            type: "BRAND_MENTION_CHANGE",
            direction: "NEGATIVE",
            summary: "发布后该查询由“提及品牌”转变为“未提及品牌”，品牌提及率发生下滑。",
          });
        }
      }

      // 引用变动
      if (delta.citation?.changed) {
        const countDelta = delta.citation.countDelta || 0;
        if (countDelta > 0 || delta.citation.change === "ABSENT_TO_PRESENT") {
          const isDirect = signals.citationMatch?.status === "DIRECT_ASSET_CITATION";
          candidates.push({
            type: "CITATION_CHANGE",
            direction: "POSITIVE",
            summary: `发布后该查询引用数量增加 ${countDelta > 0 ? countDelta : 1} 条${
              isDirect ? "，且 AI 回答直接引用了本次核验发布的落地资产 URL" : ""
            }。`,
          });
        } else if (countDelta < 0 || delta.citation.change === "PRESENT_TO_ABSENT") {
          candidates.push({
            type: "CITATION_CHANGE",
            direction: "NEGATIVE",
            summary: `发布后该查询引用数量减少 ${Math.abs(countDelta)} 条。`,
          });
        }
      }

      // 排名/位次变动 (1 优于 3)
      if (delta.position?.changed) {
        if (delta.position.direction === "IMPROVED") {
          candidates.push({
            type: "POSITION_CHANGE",
            direction: "POSITIVE",
            summary: `发布后品牌在回答中的提及位次提升（由第 ${delta.position.before ?? "未上榜"} 位提升至第 ${delta.position.after} 位）。`,
          });
        } else if (delta.position.direction === "DECLINED") {
          candidates.push({
            type: "POSITION_CHANGE",
            direction: "NEGATIVE",
            summary: `发布后品牌在回答中的提及位次下降（由第 ${delta.position.before} 位降至第 ${delta.position.after ?? "未上榜"} 位）。`,
          });
        }
      }

      // 推荐变动
      if (delta.recommendation?.changed) {
        if (delta.recommendation.change === "NOT_RECOMMENDED_TO_RECOMMENDED") {
          candidates.push({
            type: "RECOMMENDATION_CHANGE",
            direction: "POSITIVE",
            summary: "发布后 AI 回答对该品牌的推荐倾向由“未推荐”转变为“推荐”。",
          });
        } else if (delta.recommendation.change === "RECOMMENDED_TO_NOT_RECOMMENDED") {
          candidates.push({
            type: "RECOMMENDATION_CHANGE",
            direction: "NEGATIVE",
            summary: "发布后 AI 回答对该品牌的推荐倾向由“推荐”转变为“未推荐”。",
          });
        }
      }

      // 情感变动
      if (delta.sentiment?.changed) {
        if (delta.sentiment.after === "positive") {
          candidates.push({
            type: "SENTIMENT_CHANGE",
            direction: "POSITIVE",
            summary: `发布后该查询的情感倾向由 ${delta.sentiment.before || "neutral"} 改善为 positive。`,
          });
        } else if (delta.sentiment.after === "negative") {
          candidates.push({
            type: "SENTIMENT_CHANGE",
            direction: "NEGATIVE",
            summary: `发布后该查询的情感倾向由 ${delta.sentiment.before || "neutral"} 恶化为 negative。`,
          });
        }
      }

      // 竞品格局变动 (记录格局变迁，不主观断言成败)
      if (delta.competitorPresence?.changed) {
        const added = delta.competitorPresence.added || [];
        const removed = delta.competitorPresence.removed || [];
        candidates.push({
          type: "COMPETITOR_CHANGE",
          direction: "MIXED",
          summary: `发布后该查询的竞品提及格局发生变动（新增提及：${added.join(", ") || "无"}；移出提及：${removed.join(", ") || "无"}）。`,
        });
      }

      // 无观测变化 (保持中立事实记录，绝非失败)
      if (
        attribution.status === "NO_OBSERVED_CHANGE" ||
        (candidates.length === 0 && !signals.observedChange?.hasChange)
      ) {
        candidates.push({
          type: "NO_OBSERVED_CHANGE",
          direction: "NO_CHANGE",
          summary: "发布前后该查询在品牌提及、引用、排位与推荐维度均未观察到显著变化，表现保持稳定。",
        });
      }
    }

    // 6. 幂等持久化 (Deterministic Upsert on Unique Key)
    const createdObservations = [];
    for (const cand of candidates) {
      const row = await this.db.client.learningObservation.upsert({
        where: {
          outcomeAttributionId_observationType_observationVersion: {
            outcomeAttributionId: attribution.id,
            observationType: cand.type,
            observationVersion: version,
          },
        },
        update: {
          direction: cand.direction,
          attributionStatus: attribution.status,
          baselineCompatibility: outcome.baselineCompatibility,
          signalsSnapshot: signalsSnapshot as any,
          evidenceSnapshot: evidenceSnapshot as any,
          contextSnapshot: contextSnapshot as any,
          summary: cand.summary,
        },
        create: {
          organizationId: outcome.organizationId,
          projectId: outcome.projectId,
          publishedAssetId: outcome.publishedAssetId,
          retestRunId: outcome.retestRunId,
          retestItemId: outcome.retestItemId,
          outcomeComparisonId: outcome.id,
          outcomeAttributionId: attribution.id,
          queryId: outcome.queryId,
          queryText: outcome.queryText,
          observationVersion: version,
          observationType: cand.type,
          direction: cand.direction,
          attributionStatus: attribution.status,
          baselineCompatibility: outcome.baselineCompatibility,
          signalsSnapshot: signalsSnapshot as any,
          evidenceSnapshot: evidenceSnapshot as any,
          contextSnapshot: contextSnapshot as any,
          summary: cand.summary,
          metadata: {},
          createdById: userId,
        },
      });
      createdObservations.push(row);
    }

    return {
      outcomeComparisonId: outcome.id,
      outcomeAttributionId: attribution.id,
      observationVersion: version,
      count: createdObservations.length,
      items: createdObservations,
    };
  }

  /**
   * 查询某条 OutcomeComparison 的所有 LearningObservation
   * GET /outcomes/:id/learning-observations
   */
  async getOutcomeObservations(userId: string, outcomeComparisonId: string) {
    const outcome = await this.db.client.outcomeComparison.findUnique({
      where: { id: outcomeComparisonId },
      select: { id: true, projectId: true },
    });
    if (!outcome) {
      throw new NotFoundException("对比结果不存在");
    }
    await this.tenant.assertUserInProject(userId, outcome.projectId);

    const items = await this.db.client.learningObservation.findMany({
      where: { outcomeComparisonId },
      orderBy: { createdAt: "asc" },
    });

    return {
      outcomeComparisonId,
      count: items.length,
      items,
    };
  }

  /**
   * 查询某篇 PublishedAsset 的所有 LearningObservation
   * GET /published-assets/:id/learning-observations
   */
  async listAssetObservations(userId: string, publishedAssetId: string) {
    const asset = await this.db.client.publishedAsset.findUnique({
      where: { id: publishedAssetId },
      select: { id: true, projectId: true },
    });
    if (!asset) {
      throw new NotFoundException("落地资产不存在");
    }
    await this.tenant.assertUserInProject(userId, asset.projectId);

    const items = await this.db.client.learningObservation.findMany({
      where: { publishedAssetId },
      orderBy: { createdAt: "desc" },
    });

    return {
      publishedAssetId,
      count: items.length,
      items,
    };
  }

  /**
   * 查询项目下所有的 LearningObservation（支持按类型、方向、归因状态过滤）
   * GET /projects/:id/learning-observations
   */
  async listProjectObservations(
    userId: string,
    projectId: string,
    query?: QueryLearningObservationsDto,
  ) {
    await this.tenant.assertUserInProject(userId, projectId);

    const where: any = { projectId };
    if (query?.observationType) where.observationType = query.observationType;
    if (query?.direction) where.direction = query.direction;
    if (query?.attributionStatus) where.attributionStatus = query.attributionStatus;
    if (query?.observationVersion) where.observationVersion = query.observationVersion;

    const items = await this.db.client.learningObservation.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return {
      projectId,
      count: items.length,
      items,
    };
  }

  /**
   * 项目级学习摘要与模式聚合分析
   * GET /projects/:id/learning-summary
   * 严格遵循样本门槛原则（sampleCount >= 3 方可形成 Pattern，禁止单样本虚构规律，禁止百分比置信度）
   */
  async getProjectLearningSummary(userId: string, projectId: string, version?: string) {
    await this.tenant.assertUserInProject(userId, projectId);

    const targetVersion = version?.trim() || DEFAULT_OBSERVATION_VERSION;
    const observations = await this.db.client.learningObservation.findMany({
      where: { projectId, observationVersion: targetVersion },
      orderBy: { createdAt: "asc" },
    });

    const project = await this.db.client.project.findUnique({
      where: { id: projectId },
      select: { organizationId: true },
    });

    const byDirection = {
      positive: 0,
      negative: 0,
      noChange: 0,
      mixed: 0,
      unknown: 0,
    };

    const byAttribution = {
      likelyRelated: 0,
      insufficientEvidence: 0,
      confounded: 0,
      noObservedChange: 0,
    };

    const byObservationType: Record<string, number> = {};
    const limitations = {
      measurementLimitations: 0,
      attributionLimitations: 0,
    };

    const queryGrouping: Record<
      string,
      {
        queryId: string;
        queryText: string;
        observations: typeof observations;
      }
    > = {};

    for (const obs of observations) {
      // 方向分布
      if (obs.direction === "POSITIVE") byDirection.positive++;
      else if (obs.direction === "NEGATIVE") byDirection.negative++;
      else if (obs.direction === "NO_CHANGE") byDirection.noChange++;
      else if (obs.direction === "MIXED") byDirection.mixed++;
      else byDirection.unknown++;

      // 归因分布
      if (obs.attributionStatus === "LIKELY_RELATED") byAttribution.likelyRelated++;
      else if (obs.attributionStatus === "INSUFFICIENT_EVIDENCE") byAttribution.insufficientEvidence++;
      else if (obs.attributionStatus === "CONFOUNDED") byAttribution.confounded++;
      else if (obs.attributionStatus === "NO_OBSERVED_CHANGE") byAttribution.noObservedChange++;

      // 观察类型计数
      byObservationType[obs.observationType] = (byObservationType[obs.observationType] || 0) + 1;

      // 局限统计
      if (obs.observationType === "MEASUREMENT_LIMITATION") {
        limitations.measurementLimitations++;
      } else if (obs.observationType === "ATTRIBUTION_LIMITATION") {
        limitations.attributionLimitations++;
      }

      // Query 分组
      if (!queryGrouping[obs.queryId]) {
        queryGrouping[obs.queryId] = {
          queryId: obs.queryId,
          queryText: obs.queryText,
          observations: [],
        };
      }
      queryGrouping[obs.queryId].observations.push(obs);
    }

    // 7. 跨样本模式聚合 (Pattern Recognition with Sample Threshold >= 3)
    const patterns: LearningPatternSummary[] = [];

    for (const [queryId, group] of Object.entries(queryGrouping)) {
      // 进一步按观察类型细分
      const typeGroups: Record<string, typeof observations> = {};
      for (const obs of group.observations) {
        if (!typeGroups[obs.observationType]) {
          typeGroups[obs.observationType] = [];
        }
        typeGroups[obs.observationType].push(obs);
      }

      for (const [obsType, obsList] of Object.entries(typeGroups)) {
        // 关键边界约束：最低样本数必须 >= 3，禁止单样本升级为模式规律
        if (obsList.length < 3) {
          continue;
        }

        const attrDist: Record<string, number> = {};
        let likelyRelatedCount = 0;
        let insufficientCount = 0;
        let confoundedCount = 0;
        let noChangeCount = 0;
        let positiveCount = 0;
        let negativeCount = 0;
        let neutralCount = 0;

        for (const o of obsList) {
          attrDist[o.attributionStatus] = (attrDist[o.attributionStatus] || 0) + 1;
          if (o.attributionStatus === "LIKELY_RELATED") likelyRelatedCount++;
          else if (o.attributionStatus === "INSUFFICIENT_EVIDENCE") insufficientCount++;
          else if (o.attributionStatus === "CONFOUNDED") confoundedCount++;
          else if (o.attributionStatus === "NO_OBSERVED_CHANGE") noChangeCount++;

          if (o.direction === "POSITIVE") positiveCount++;
          else if (o.direction === "NEGATIVE") negativeCount++;
          else neutralCount++;
        }

        const aggregateKey = `query_pattern:${queryId}:${obsType}`;
        const summary = `在查询“${group.queryText}”关于 ${obsType} 的 ${obsList.length} 次独立评测样本中，存在重复观测模式（其中可能相关 ${likelyRelatedCount} 次，存在混杂 ${confoundedCount} 次，证据不足 ${insufficientCount} 次）。`;

        const patternData: LearningPatternSummary = {
          aggregateKey,
          aggregateType: "QUERY_OBSERVATION_PATTERN",
          sampleCount: obsList.length,
          likelyRelatedCount,
          insufficientCount,
          confoundedCount,
          noChangeCount,
          positiveCount,
          negativeCount,
          neutralCount,
          supportingObservationIds: obsList.map((o) => o.id),
          attributionDistribution: attrDist,
          summary,
        };

        patterns.push(patternData);

        // 异步持久化到 learning_aggregates 表供审计追踪
        if (project?.organizationId) {
          await this.db.client.learningAggregate.upsert({
            where: {
              projectId_aggregateKey: {
                projectId,
                aggregateKey,
              },
            },
            update: {
              sampleCount: obsList.length,
              likelyRelatedCount,
              insufficientCount,
              confoundedCount,
              noChangeCount,
              positiveCount,
              negativeCount,
              neutralCount,
              supportingObservationIds: obsList.map((o) => o.id) as any,
              attributionDistribution: attrDist as any,
              summary,
            },
            create: {
              organizationId: project.organizationId,
              projectId,
              aggregateKey,
              aggregateType: "QUERY_OBSERVATION_PATTERN",
              sampleCount: obsList.length,
              likelyRelatedCount,
              insufficientCount,
              confoundedCount,
              noChangeCount,
              positiveCount,
              negativeCount,
              neutralCount,
              supportingObservationIds: obsList.map((o) => o.id) as any,
              attributionDistribution: attrDist as any,
              summary,
            },
          });
        }
      }
    }

    return {
      projectId,
      totalObservations: observations.length,
      byDirection,
      byAttribution,
      byObservationType,
      limitations,
      patterns,
    };
  }
}
