import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma.service";
import { TenantService } from "../common/tenant.service";
import { CreateRetestRunDto, RetestQuerySnapshotItem } from "./dto/retest-orchestration.dto";
import { RetrievalMode, SourceType, Prisma } from "@geo/database";
import { analyzeResponse, ANALYSIS_VERSION, type Entity } from "@geo/core";

@Injectable()
export class RetestOrchestrationService {
  private readonly logger = new Logger(RetestOrchestrationService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  /**
   * 冻结实体快照（Brand + Aliases + Competitors）
   */
  private async snapshotEntities(projectId: string): Promise<Entity[]> {
    const [brands, competitors] = await Promise.all([
      this.db.client.brand.findMany({
        where: { projectId },
        include: { aliasesDetailed: { where: { enabled: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      this.db.client.competitor.findMany({
        where: { projectId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    ]);

    return [
      ...brands.slice(0, 1).map((row) => ({
        id: row.id,
        canonicalName: row.name,
        aliases: [...new Set([...row.aliases, ...row.aliasesDetailed.map((a) => a.alias)])],
        entityType: "brand" as const,
      })),
      ...competitors.map((row) => ({
        id: row.id,
        canonicalName: row.name,
        aliases: row.aliases,
        entityType: "competitor" as const,
      })),
    ];
  }

  /**
   * 确定性推导 PublishedAsset 所属重测 Query 范围：
   * 1. 显式传参 queryIds：校验并使用
   * 2. PublishedAsset -> planItem -> targetQueries
   * 3. PublishedAsset -> campaign -> strategy -> priorityQuestions
   * 4. 严禁 LLM 随机、严禁全量项目盲测
   */
  private async deriveQueriesForAsset(asset: any, explicitQueryIds?: string[]) {
    if (explicitQueryIds && explicitQueryIds.length > 0) {
      const queries = await this.db.client.query.findMany({
        where: {
          id: { in: explicitQueryIds },
          projectId: asset.projectId,
        },
        include: { benchmarkQuery: true },
        orderBy: { createdAt: "asc" },
      });

      if (queries.length !== explicitQueryIds.length) {
        throw new BadRequestException("部分指定的 Query 不存在或不属于当前项目");
      }
      return queries;
    }

    // 尝试从 PlanItem.targetQueries 推导
    const planItem = asset.planItem;
    if (planItem && Array.isArray(planItem.targetQueries) && planItem.targetQueries.length > 0) {
      const targets = planItem.targetQueries as string[];
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const uuidTargets = targets.filter((t) => typeof t === "string" && uuidPattern.test(t));
      if (uuidTargets.length > 0) {
        const byId = await this.db.client.query.findMany({
          where: { id: { in: uuidTargets }, projectId: asset.projectId },
          include: { benchmarkQuery: true },
          orderBy: { createdAt: "asc" },
        });
        if (byId.length > 0) return byId;
      }

      const textTargets = targets.filter((t) => typeof t === "string" && !uuidPattern.test(t));
      if (textTargets.length > 0) {
        const byText = await this.db.client.query.findMany({
          where: { text: { in: textTargets }, projectId: asset.projectId },
          include: { benchmarkQuery: true },
          orderBy: { createdAt: "asc" },
        });
        if (byText.length > 0) return byText;
      }
    }

    // 尝试从 Strategy.priorityQuestions 推导
    const strategy = asset.campaign?.strategy;
    if (strategy && Array.isArray(strategy.priorityQuestions) && strategy.priorityQuestions.length > 0) {
      const questions = strategy.priorityQuestions as string[];
      const byQuestions = await this.db.client.query.findMany({
        where: { text: { in: questions }, projectId: asset.projectId },
        include: { benchmarkQuery: true },
        orderBy: { createdAt: "asc" },
      });
      if (byQuestions.length > 0) return byQuestions;
    }

    // 尝试按 geoTarget 或 title 关键词匹配
    if (planItem?.geoTarget) {
      const byGeo = await this.db.client.query.findMany({
        where: {
          projectId: asset.projectId,
          text: { contains: planItem.geoTarget },
        },
        include: { benchmarkQuery: true },
        orderBy: { createdAt: "asc" },
      });
      if (byGeo.length > 0) return byGeo;
    }

    throw new BadRequestException("无法从发布资产血缘中推导 Retest 查询，请明确指定 queryIds");
  }

  /**
   * 基线选择与兼容性判断（Selection & Compatibility Engine）
   * 严格时间分界：timestamp < publishedAt
   * 严格模式隔离：避免 api_plain vs official_web_ui 产生假对称
   */
  private async selectBaselineForQuery(
    queryId: string,
    projectId: string,
    publishedAt: Date,
    target: {
      provider: string;
      retrievalMode: RetrievalMode;
      sourceType: SourceType;
      model: string;
      requestedModel?: string;
    },
  ): Promise<{
    baselineEvidenceId: string | null;
    baselineStatus: "EXACT_MATCH" | "COMPARABLE_WITH_WARNING" | "INCOMPATIBLE" | "MISSING_BASELINE";
    baselineWarning: string | null;
  }> {
    // 找出所有在发布时间点之前的该 Query 历史证据
    const candidates = await this.db.client.evidence.findMany({
      where: {
        run: { queryId, query: { projectId } },
        createdAt: { lt: publishedAt },
      },
      orderBy: { createdAt: "desc" },
      include: { run: true },
    });

    if (candidates.length === 0) {
      return {
        baselineEvidenceId: null,
        baselineStatus: "MISSING_BASELINE",
        baselineWarning: "发布时间前无任何测量证据",
      };
    }

    // 1. 优先找完全匹配 (Exact Match)
    const exact = candidates.find(
      (c) =>
        c.provider === target.provider &&
        c.retrievalMode === target.retrievalMode &&
        c.sourceType === target.sourceType &&
        ((target.requestedModel && c.requestedModel === target.requestedModel) ||
          c.model === target.model),
    );
    if (exact) {
      return {
        baselineEvidenceId: exact.id,
        baselineStatus: "EXACT_MATCH",
        baselineWarning: null,
      };
    }

    // 取最近的一条候选做差异判定
    const recent = candidates[0];

    // 2. 检索模式存在重大差异（如 api_plain vs official_web_ui / api_web_search） -> INCOMPATIBLE
    if (recent.retrievalMode !== target.retrievalMode) {
      const warning = `检索模式不匹配（基线为 ${recent.retrievalMode}，重测为 ${target.retrievalMode}，两者不可直接对比）`;
      return {
        baselineEvidenceId: recent.id,
        baselineStatus: "INCOMPATIBLE",
        baselineWarning: warning,
      };
    }

    // 3. Provider 不一致 -> INCOMPATIBLE
    if (recent.provider !== target.provider) {
      const warning = `评测 Provider 不匹配（基线为 ${recent.provider}，重测为 ${target.provider}）`;
      return {
        baselineEvidenceId: recent.id,
        baselineStatus: "INCOMPATIBLE",
        baselineWarning: warning,
      };
    }

    // 4. 同 Provider、同检索模式，但模型名称/版本存在微小差异 -> COMPARABLE_WITH_WARNING
    const warning = `模型配置存在差异（基线模型为 ${recent.requestedModel || recent.model}，重测模型为 ${target.requestedModel || target.model}）`;
    return {
      baselineEvidenceId: recent.id,
      baselineStatus: "COMPARABLE_WITH_WARNING",
      baselineWarning: warning,
    };
  }

  /**
   * 创建并调度 PublishedAsset 的 Retest Run
   */
  async createRetestRun(userId: string, publishedAssetId: string, dto: CreateRetestRunDto) {
    const asset = await this.db.client.publishedAsset.findUnique({
      where: { id: publishedAssetId },
      include: {
        project: true,
        planItem: true,
        campaign: { include: { strategy: true } },
      },
    });

    if (!asset) {
      throw new NotFoundException("已发布资产不存在");
    }

    // 严格租户与项目隔离校验
    await this.tenant.assertUserInProject(userId, asset.projectId);

    // 幂等防护：若已有进行中的 RetestRun 且未声明 forceNew，复用现有 Run
    if (!dto.forceNew) {
      const activeRun = await this.db.client.retestRun.findFirst({
        where: {
          publishedAssetId,
          status: { in: ["PENDING", "QUEUED", "RUNNING"] },
        },
        include: { items: true },
      });
      if (activeRun) {
        return activeRun;
      }
    }

    // 确定性推导重测问题列表
    const queries = await this.deriveQueriesForAsset(asset, dto.queryIds);
    if (queries.length === 0) {
      throw new BadRequestException("重测问题集合为空");
    }

    // 确定运行配置（默认安全 Mock）
    const provider = dto.provider || "mock";
    if (provider !== "mock" && process.env.ENABLE_REAL_PROVIDERS !== "true") {
      throw new BadRequestException("真实 Provider 未启用，当前仅允许 mock 评测");
    }

    const engineKey = dto.engineKey || (provider === "mock" ? "mock-default" : provider);
    const engineName = provider === "mock" ? "Mock Engine" : `${provider} Engine`;
    const retrievalMode = dto.retrievalMode || RetrievalMode.api_plain;
    const sourceType = dto.sourceType || (provider === "mock" ? SourceType.mock : SourceType.official_api);
    const requestedModel = dto.requestedModel || (provider === "mock" ? "mock-model" : "deepseek-chat");
    const model = requestedModel;

    // 确保 Engine 存在
    const engine = await this.db.client.engine.upsert({
      where: { key: engineKey },
      update: {},
      create: {
        key: engineKey,
        name: engineName,
        provider,
        config: {},
        enabled: true,
      },
    });

    // 冻结 Query 语义快照
    const querySnapshot: RetestQuerySnapshotItem[] = queries.map((q) => {
      const isSanity = Boolean(q.benchmarkQuery?.sanity);
      const qType = q.benchmarkQuery?.queryType || (isSanity ? "BRANDED_SANITY" : "DISCOVERY");
      return {
        id: q.id,
        text: q.text,
        category: q.benchmarkQuery?.category || "custom",
        intent: q.benchmarkQuery?.intent || "",
        queryType: qType,
        sanity: isSanity,
      };
    });

    // 计算 sequence 递增
    const prevCount = await this.db.client.retestRun.count({
      where: { publishedAssetId },
    });
    const sequence = prevCount + 1;

    // 发布时间锚点（必须有明确基准时间，否则取创建时间）
    const publishedAt = asset.verifiedAt || asset.publishedAt || asset.createdAt;

    // 确定每条 Query 的基线选择与匹配兼容性
    const targetConfig = { provider, retrievalMode, sourceType, model, requestedModel };
    const queryBaselines = await Promise.all(
      queries.map(async (q) => {
        const baseline = await this.selectBaselineForQuery(q.id, asset.projectId, publishedAt, targetConfig);
        return { query: q, ...baseline };
      }),
    );

    // 冻结输入快照与基线元数据
    const inputSnapshot = {
      publishedAsset: {
        id: asset.id,
        platform: asset.platform,
        title: asset.title,
        canonicalUrl: asset.canonicalUrl,
        publishedAt: publishedAt.toISOString(),
      },
      configuration: {
        provider,
        engineKey,
        retrievalMode,
        sourceType,
        model,
      },
      queryCount: queries.length,
    };

    const baselineMetadata = {
      baselinePolicy: dto.baselinePolicy || "MOST_RECENT_BEFORE_PUBLICATION",
      totalQueries: queries.length,
      exactMatchCount: queryBaselines.filter((b) => b.baselineStatus === "EXACT_MATCH").length,
      warningCount: queryBaselines.filter((b) => b.baselineStatus === "COMPARABLE_WITH_WARNING").length,
      incompatibleCount: queryBaselines.filter((b) => b.baselineStatus === "INCOMPATIBLE").length,
      missingCount: queryBaselines.filter((b) => b.baselineStatus === "MISSING_BASELINE").length,
    };

    // 创建 RetestRun 与 RetestItems
    const retestRun = await this.db.client.$transaction(async (tx) => {
      const run = await tx.retestRun.create({
        data: {
          organizationId: asset.organizationId,
          projectId: asset.projectId,
          publishedAssetId: asset.id,
          sequence,
          status: "PENDING",
          querySnapshot: querySnapshot as unknown as Prisma.InputJsonValue,
          provider,
          engineId: engine.id,
          engineKey,
          engineName,
          requestedModel,
          model,
          retrievalMode,
          sourceType,
          baselinePolicy: dto.baselinePolicy || "MOST_RECENT_BEFORE_PUBLICATION",
          baselineMetadata: baselineMetadata as unknown as Prisma.InputJsonValue,
          inputSnapshot: inputSnapshot as unknown as Prisma.InputJsonValue,
          totalItems: queries.length,
          createdById: userId,
        },
      });

      await tx.retestItem.createMany({
        data: queryBaselines.map((qb) => {
          const isSanity = Boolean(qb.query.benchmarkQuery?.sanity);
          const qType = qb.query.benchmarkQuery?.queryType || (isSanity ? "BRANDED_SANITY" : "DISCOVERY");
          return {
            retestRunId: run.id,
            queryId: qb.query.id,
            queryText: qb.query.text,
            queryType: qType,
            sanity: isSanity,
            status: "PENDING",
            baselineEvidenceId: qb.baselineEvidenceId,
            baselineStatus: qb.baselineStatus,
            baselineWarning: qb.baselineWarning,
          };
        }),
      });

      return run;
    });

    // 若声明 autoExecute（默认 true），立即触发确定性执行
    if (dto.autoExecute !== false) {
      await this.executeRetestRunInternal(retestRun.id, dto.simulateFailureQueryId);
    }

    return this.getRetestRun(userId, retestRun.id);
  }

  /**
   * 面向用户触发的安全执行入口：在产生任何数据库副作用之前必须完成租户/项目鉴权
   */
  async executeRetestRunForUser(
    userId: string,
    retestRunId: string,
    simulateFailureQueryId?: string,
  ) {
    const run = await this.db.client.retestRun.findUnique({
      where: { id: retestRunId },
      select: { id: true, projectId: true },
    });

    if (!run) {
      throw new NotFoundException("重测任务不存在");
    }

    // 严防副作用前置：必须在任何 DB 修改前完成鉴权，未授权请求直接 404 且保证零副作用
    await this.tenant.assertUserInProject(userId, run.projectId);

    await this.executeRetestRunInternal(retestRunId, simulateFailureQueryId);
    return this.getRetestRun(userId, retestRunId);
  }

  /**
   * 兼容原有签名，供内部调度/系统任务调用
   */
  async executeRetestRun(retestRunId: string, simulateFailureQueryId?: string) {
    return this.executeRetestRunInternal(retestRunId, simulateFailureQueryId);
  }

  /**
   * 执行 Retest Run 内部核心逻辑，生成全新的 Evidence
   */
  async executeRetestRunInternal(retestRunId: string, simulateFailureQueryId?: string) {
    const retestRun = await this.db.client.retestRun.findUnique({
      where: { id: retestRunId },
      include: {
        items: true,
        project: true,
        publishedAsset: true,
      },
    });

    if (!retestRun) throw new NotFoundException("重测任务不存在");

    await this.db.client.retestRun.update({
      where: { id: retestRunId },
      data: { status: "RUNNING", startedAt: new Date() },
    });

    // 复用底层 MonitorTask 体系，形成完整 Run -> Evidence 链路
    const monitorTask = await this.db.client.monitorTask.create({
      data: {
        organizationId: retestRun.organizationId,
        projectId: retestRun.projectId,
        totalRuns: retestRun.items.length,
        status: "RUNNING",
        startedAt: new Date(),
        metadata: { retestRunId },
      },
    });

    // 冻结目标实体快照
    const entities = await this.snapshotEntities(retestRun.projectId);

    // 逐项执行每个 RetestItem
    for (const item of retestRun.items) {
      const itemStart = new Date();
      await this.db.client.retestItem.update({
        where: { id: item.id },
        data: { status: "RUNNING", startedAt: itemStart, attemptCount: { increment: 1 } },
      });

      // 故障注入测试分支
      if (simulateFailureQueryId && item.queryId === simulateFailureQueryId) {
        const run = await this.db.client.run.create({
          data: {
            monitorTaskId: monitorTask.id,
            queryId: item.queryId,
            engineId: retestRun.engineId!,
            status: "FAILED",
            attempt: 1,
            errorCode: "MOCK_SIMULATED_FAILURE",
            errorMessage: "QA simulated single query failure",
            startedAt: itemStart,
            completedAt: new Date(),
          },
        });

        await this.db.client.retestItem.update({
          where: { id: item.id },
          data: {
            runId: run.id,
            status: "FAILED",
            errorCode: "MOCK_SIMULATED_FAILURE",
            errorMessage: "QA simulated single query failure",
            completedAt: new Date(),
          },
        });
        continue;
      }

      // 成功执行分支
      const run = await this.db.client.run.create({
        data: {
          monitorTaskId: monitorTask.id,
          queryId: item.queryId,
          engineId: retestRun.engineId!,
          status: "SUCCEEDED",
          attempt: 1,
          startedAt: itemStart,
          completedAt: new Date(),
        },
      });

      // 构建确定性的全新 Mock AI 响应正文（包含实体提及与引用）
      const brandName = entities[0]?.canonicalName || "Brand";
      const rawPrompt = `Query: ${item.queryText}`;
      const rawResponse = `关于 ${item.queryText}，推荐了解 ${brandName}。该品牌在相关性能实测中表现优秀。参考来源: ${retestRun.publishedAsset.canonicalUrl || "https://example.com/asset"}`;

      // 创建全新的 Evidence（时间戳严格 >= publishedAt）
      const evidence = await this.db.client.evidence.create({
        data: {
          runId: run.id,
          queryText: item.queryText,
          rawPrompt,
          rawResponse,
          provider: retestRun.provider,
          engineKey: retestRun.engineKey,
          engineName: retestRun.engineName || "Mock Engine",
          requestedModel: retestRun.requestedModel,
          responseModel: retestRun.responseModel,
          model: retestRun.model,
          modelVersion: retestRun.modelVersion,
          retrievalMode: retestRun.retrievalMode,
          sourceType: retestRun.sourceType,
          metadata: {
            durationMs: 120,
            structuredCitations: retestRun.publishedAsset.canonicalUrl
              ? [{ url: retestRun.publishedAsset.canonicalUrl, title: retestRun.publishedAsset.title }]
              : [],
          },
          entitySnapshot: entities as unknown as Prisma.InputJsonValue,
          createdAt:
            new Date().getTime() >=
            (retestRun.publishedAsset.verifiedAt || retestRun.publishedAsset.publishedAt || retestRun.publishedAsset.createdAt).getTime()
              ? new Date()
              : new Date(
                  (retestRun.publishedAsset.verifiedAt || retestRun.publishedAsset.publishedAt || retestRun.publishedAsset.createdAt).getTime() + 1000,
                ),
        },
      });

      // 运行 analyzer 产生 Analysis / Mention / Citation
      const analysisResult = analyzeResponse({
        rawResponse,
        entities,
        structuredCitations: retestRun.publishedAsset.canonicalUrl
          ? [{ url: retestRun.publishedAsset.canonicalUrl, title: retestRun.publishedAsset.title }]
          : [],
      });

      await this.db.client.analysis.create({
        data: {
          evidenceId: evidence.id,
          analysisVersion: ANALYSIS_VERSION,
          brandMentioned: analysisResult.brandMentioned,
          mentionPosition: analysisResult.mentionPosition,
          recommended: analysisResult.recommended,
          sentiment: analysisResult.sentiment,
          mentions: { create: analysisResult.mentions },
          citations: { create: analysisResult.citations },
        },
      });

      await this.db.client.retestItem.update({
        where: { id: item.id },
        data: {
          runId: run.id,
          evidenceId: evidence.id,
          status: "SUCCEEDED",
          completedAt: new Date(),
        },
      });
    }

    // 汇总状态
    const finalItems = await this.db.client.retestItem.findMany({
      where: { retestRunId },
    });
    const completedItems = finalItems.filter((i) => i.status === "SUCCEEDED").length;
    const failedItems = finalItems.filter((i) => i.status === "FAILED").length;

    let finalStatus = "COMPLETED";
    if (failedItems > 0 && completedItems > 0) {
      finalStatus = "PARTIAL";
    } else if (failedItems > 0) {
      finalStatus = "FAILED";
    }

    await this.db.client.retestRun.update({
      where: { id: retestRunId },
      data: {
        status: finalStatus,
        completedItems,
        failedItems,
        completedAt: new Date(),
      },
    });

    await this.db.client.monitorTask.update({
      where: { id: monitorTask.id },
      data: {
        status: finalStatus === "COMPLETED" ? "SUCCEEDED" : finalStatus === "PARTIAL" ? "PARTIAL" : "FAILED",
        completedRuns: completedItems,
        failedRuns: failedItems,
        completedAt: new Date(),
      },
    });
  }

  /**
   * 读取 RetestRun 详情
   */
  async getRetestRun(userId: string, id: string) {
    const run = await this.db.client.retestRun.findUnique({
      where: { id },
      include: {
        publishedAsset: true,
        items: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!run) throw new NotFoundException("重测任务不存在");
    await this.tenant.assertUserInProject(userId, run.projectId);
    return run;
  }

  /**
   * 读取 RetestRun 下的所有 Items 与关联 Evidence
   */
  async getRetestItems(userId: string, retestRunId: string) {
    const run = await this.db.client.retestRun.findUnique({
      where: { id: retestRunId },
      select: { projectId: true },
    });
    if (!run) throw new NotFoundException("重测任务不存在");
    await this.tenant.assertUserInProject(userId, run.projectId);

    const items = await this.db.client.retestItem.findMany({
      where: { retestRunId },
      orderBy: { createdAt: "asc" },
    });

    // 丰富 evidence 信息
    const evidenceIds = items.map((i) => i.evidenceId).filter(Boolean) as string[];
    const baselineIds = items.map((i) => i.baselineEvidenceId).filter(Boolean) as string[];

    const allEvidences = await this.db.client.evidence.findMany({
      where: { id: { in: [...new Set([...evidenceIds, ...baselineIds])] } },
      include: {
        analyses: {
          include: { mentions: true, citations: true },
        },
      },
    });
    const evMap = new Map(allEvidences.map((e) => [e.id, e]));

    return items.map((item) => ({
      ...item,
      evidence: item.evidenceId ? evMap.get(item.evidenceId) || null : null,
      baselineEvidence: item.baselineEvidenceId ? evMap.get(item.baselineEvidenceId) || null : null,
    }));
  }

  /**
   * 查询 PublishedAsset 下的所有 Retest 历史
   */
  async listAssetRetests(userId: string, publishedAssetId: string) {
    const asset = await this.db.client.publishedAsset.findUnique({
      where: { id: publishedAssetId },
      select: { projectId: true },
    });
    if (!asset) throw new NotFoundException("已发布资产不存在");
    await this.tenant.assertUserInProject(userId, asset.projectId);

    return this.db.client.retestRun.findMany({
      where: { publishedAssetId },
      include: { items: true },
      orderBy: { sequence: "desc" },
    });
  }
}
