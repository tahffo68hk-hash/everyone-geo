import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { TenantService } from "../common/tenant.service";
import { AiGatewayService } from "./ai-gateway.service";
import { AI_PROMPTS, PROMPT_VERSIONS } from "./ai-prompt-registry";
import {
  AnalyzeKeywordGapDto,
  ClusterAiItemsDto,
  DetectCompetitorCandidatesDto,
  DetectGeoTopicsDto,
  DraftCampaignDto,
  DraftLearningActionsDto,
  DraftOpportunityDto,
  DraftRecommendationDto,
  DraftStrategyDto,
  ExpandQueriesDto,
  ExplainAttributionDto,
  ExplainDiagnosisDto,
  ExtractGeoKeywordsDto,
  GenerateContentBriefDto,
  GenerateDraftDto,
  GenerateFaqDto,
  GenerateOutlineDto,
  GenerateQuerySetDto,
  GenerateTitlesDto,
  OptimizeGeoContentDto,
  RewriteContentDto,
  RewriteQueryDto,
  ScanFactRiskDto,
  SummarizeLearningDto,
  SummarizeOutcomeDto,
  SummarizeReportDto,
  ResolveBrandDto,
  GenerateVideoScriptDto,
  AdaptContentChannelsDto,
  GenerateTagsDto,
} from "./dto/ai.dto";
import { randomUUID } from "node:crypto";
import {
  CONTENT_ADAPTATION_FEATURE,
  VIDEO_SCRIPT_CHANNELS,
  adaptationIdempotencyKey,
  constrainAdaptationChannel,
  knownAdaptationChannels,
  limitsForChannel,
  stripHtml,
} from "./content-adaptation";
import {
  ADAPTATION_MAX_OUTPUT_TOKENS,
  ADAPTATION_REAL_MODEL,
  type AdaptationBudget,
  adaptationBudgetAllowsCall,
  assessAdaptationBudget,
} from "./adaptation-budget";

/** 本进程真实适配请求次数。失败或超时也不回退，避免第二次付费请求。 */
let realAdaptationAttempts = 0;


@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly gateway: AiGatewayService,
  ) {}

  // ============================================================
  // 基础状态与审计
  // ============================================================

  getProviderStatus() {
    return this.gateway.getProviderStatus();
  }

  /**
   * AI 请求中携带的实体 ID 也必须属于当前项目。
   * 只校验 projectId 会允许攻击者把别的项目实体送进 Prompt 并消耗 Provider 额度。
   */
  private async assertAiEntityLineage(projectId: string, dto: Record<string, any>) {
    const checks: Promise<unknown>[] = [];
    const add = (id: unknown, lookup: () => Promise<unknown>) => {
      if (typeof id === "string" && id.trim()) checks.push(lookup());
    };

    add(dto.diagnosisRunId, () => this.prisma.client.diagnosisRun.findFirst({ where: { id: dto.diagnosisRunId, projectId }, select: { id: true } }));
    add(dto.diagnosisId, () => this.prisma.client.diagnosisRun.findFirst({ where: { id: dto.diagnosisId, projectId }, select: { id: true } }));
    add(dto.strategyId, () => this.prisma.client.contentStrategy.findFirst({ where: { id: dto.strategyId, projectId }, select: { id: true } }));
    add(dto.outcomeComparisonId, () => this.prisma.client.outcomeComparison.findFirst({ where: { id: dto.outcomeComparisonId, projectId }, select: { id: true } }));
    add(dto.outcomeAttributionId, () => this.prisma.client.outcomeAttribution.findFirst({ where: { id: dto.outcomeAttributionId, projectId }, select: { id: true } }));
    add(dto.reportId, () => this.prisma.client.benchmarkReport.findFirst({ where: { id: dto.reportId, projectId }, select: { id: true } }));
    add(dto.learningAggregateId, () => this.prisma.client.learningAggregate.findFirst({ where: { id: dto.learningAggregateId, projectId }, select: { id: true } }));

    if (Array.isArray(dto.diagnosisIds) && dto.diagnosisIds.length > 0) {
      const rows = await this.prisma.client.diagnosisRun.findMany({
        where: { id: { in: dto.diagnosisIds.filter((id: unknown): id is string => typeof id === "string") }, projectId },
        select: { id: true },
      });
      if (rows.length !== dto.diagnosisIds.length) {
        throw new NotFoundException("AI 输入实体不存在或不属于当前项目");
      }
    }

    if (checks.length > 0 && (await Promise.all(checks)).some((row) => !row)) {
      throw new NotFoundException("AI 输入实体不存在或不属于当前项目");
    }
  }

  async listGenerations(userId: string, projectId: string, limit = 50) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    return this.prisma.client.aiGeneration.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
      take: Math.min(100, Math.max(1, limit)),
    });
  }

  // ============================================================
  // B. 问题集 AI (Query AI)
  // ============================================================

  async generateQuerySet(userId: string, projectId: string, dto: GenerateQuerySetDto) {
    const userProject = await this.tenant.assertUserInProject(userId, projectId);
    const project = await this.prisma.client.project.findUnique({
      where: { id: userProject.id },
    });

    // 自动补齐缺失的项目与品牌上下文，确保 AI 获得完整行业、品类与业务背景
    let brandProfile: any = null;
    try {
      brandProfile = await this.prisma.client.brand.findFirst({
        where: { projectId: userProject.id },
      });
    } catch {
      // 容错：允许在无已存 target profile 时执行
    }

    let competitors: Array<{ name: string }> = [];
    try {
      competitors = await this.prisma.client.competitor.findMany({
        where: { projectId: userProject.id },
        select: { name: true },
      });
    } catch {
      // 容错
    }

    const resolvedBrandName = dto.brandName?.trim() || brandProfile?.name?.trim() || project?.name || "";
    const resolvedCategory = dto.category?.trim() || brandProfile?.productCategory?.trim() || project?.industry?.trim() || "";
    const resolvedIndustry = dto.industry?.trim() || project?.industry?.trim() || "";
    const resolvedEntityType = dto.entityType?.trim() || brandProfile?.entityType?.trim() || "BRAND";
    const resolvedAudience = dto.targetAudience?.trim() || project?.targetAudience?.trim() || "";
    const resolvedDesc = dto.businessDesc?.trim() || brandProfile?.description?.trim() || project?.description?.trim() || "";
    const resolvedCompetitors = (dto.competitors && dto.competitors.length > 0)
      ? dto.competitors
      : competitors.map((c) => c.name);

    const enrichedDto: GenerateQuerySetDto = {
      ...dto,
      brandName: resolvedBrandName,
      productName: dto.productName?.trim() || (brandProfile?.products?.[0] ?? ""),
      category: resolvedCategory,
      entityType: resolvedEntityType,
      industry: resolvedIndustry,
      targetAudience: resolvedAudience,
      businessDesc: resolvedDesc,
      competitors: resolvedCompetitors,
    };

    const result = await this.gateway.generateStructured<{
      querySetName: string;
      description: string;
      queries: Array<{
        text: string;
        category: string;
        intent: string;
        queryType: string;
        rationale: string;
      }>;
    }>({
      organizationId: userProject.organizationId,
      projectId: userProject.id,
      userId,
      feature: "query_set_generation",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.QUERY_SET_GENERATION,
      input: enrichedDto,
    });

    // 事实校验：严格确保 Discovery 类别的问题不包含本品品牌词或别名，但绝不能把品类/专业核心词作为违禁词
    if (result.data?.queries) {
      const forbiddenWords: string[] = [];
      if (resolvedBrandName) forbiddenWords.push(resolvedBrandName);

      if (brandProfile?.aliases) {
        for (const a of brandProfile.aliases) {
          if (typeof a === "string" && a.trim()) forbiddenWords.push(a.trim());
        }
      }

      // 提取主体/机构前缀（如"中南民族大学医学信息工程" -> "中南民族大学"）
      for (const w of [...forbiddenWords]) {
        const orgMatch = w.match(/^(.*?(?:大学|学院|学校|研究所|研究院|集团|科技|软件|电子))/);
        if (orgMatch && orgMatch[1] && orgMatch[1].length >= 3) {
          forbiddenWords.push(orgMatch[1]);
        }
      }

      // 明确品类/专业关键词白名单：品类词绝不能作为违禁词过滤
      const categoryKeywords = [
        resolvedCategory,
        project?.industry,
        brandProfile?.productCategory,
      ]
        .filter((c): c is string => typeof c === "string" && c.trim().length >= 2)
        .map((c) => c.trim().toLowerCase());

      // 若品牌名形如 "中南民族大学医学信息工程"，提取后半截专业名纳入品类白名单
      const compoundMatch = resolvedBrandName.match(/^(.*?(?:大学|学院|学校|研究所|研究院|集团|有限责任公司|有限公司))(.*)$/);
      if (compoundMatch && compoundMatch[2] && compoundMatch[2].trim().length >= 2) {
        categoryKeywords.push(compoundMatch[2].trim().toLowerCase());
      }

      const uniqueForbidden = Array.from(new Set(forbiddenWords.map((w) => w.trim().toLowerCase())))
        .filter((w) => {
          if (w.length < 2) return false;
          // 严禁将品类词/专业词列为违禁词
          if (categoryKeywords.some((cat) => cat === w || cat.includes(w))) {
            return false;
          }
          return true;
        });

      for (const q of result.data.queries) {
        const qLower = q.text.toLowerCase();
        const containsBrand = uniqueForbidden.some((w) => qLower.includes(w));
        if (containsBrand && q.queryType === "DISCOVERY") {
          // 自动纠偏为 BRANDED 类别，避免发现型问题出现品牌污染
          q.queryType = "BRANDED";
          q.category = "品牌基线";
        }
      }
    }

    return result;
  }

  async expandQueries(userId: string, projectId: string, dto: ExpandQueriesDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    return this.gateway.generateStructured<{
      expandedQueries: Array<{
        text: string;
        category: string;
        intent: string;
        queryType: string;
        rationale: string;
      }>;
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "query_expansion",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.QUERY_EXPANSION,
      input: dto,
    });
  }

  async rewriteQuery(userId: string, projectId: string, dto: RewriteQueryDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    return this.gateway.generateStructured<{
      originalQuery: string;
      rewrittenQueries: Array<{
        text: string;
        explanation: string;
        targetIntent: string;
      }>;
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "query_rewrite",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.QUERY_REWRITE,
      input: dto,
    });
  }

  async classifyQuery(userId: string, projectId: string, dto: { queryText: string }) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    return this.gateway.generateStructured<{
      intent: string;
      category: string;
      queryType: string;
      confidence: number;
      rationale: string;
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "query_classify",
      promptVersion: PROMPT_VERSIONS.QUERY_CLASSIFY,
      input: dto,
    });
  }

  // ============================================================
  // C. GEO 关键词与主题检测 (GEO Topic & Keyword Intelligence)
  // ============================================================

  async detectGeoTopics(userId: string, projectId: string, dto: DetectGeoTopicsDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    return this.gateway.generateStructured<{
      coreTopics: string[];
      geoTopics: Array<{
        name: string;
        description: string;
        userIntent: string;
        importance: string;
      }>;
      entities: Array<{
        name: string;
        type: string;
        aliases: string[];
      }>;
      comparisonDimensions: string[];
      decisionDimensions: string[];
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "geo_topic_detection",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.GEO_TOPIC_DETECTION,
      input: dto,
    });
  }

  async extractGeoKeywords(userId: string, projectId: string, dto: ExtractGeoKeywordsDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    return this.gateway.generateStructured<{
      keywords: Array<{
        keyword: string;
        type: string;
        intent: string;
        importance: string;
        reason: string;
        relatedQueries: string[];
      }>;
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "geo_keyword_extraction",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.GEO_KEYWORD_EXTRACTION,
      input: dto,
    });
  }

  async analyzeKeywordGap(userId: string, projectId: string, dto: AnalyzeKeywordGapDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    return this.gateway.generateStructured<{
      gaps: Array<{
        topic: string;
        entity: string;
        gapType: string;
        rationale: string;
        recommendedQueries: string[];
        suggestedContentType: string;
      }>;
      disclaimer: string;
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "geo_keyword_gap",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.GEO_KEYWORD_GAP,
      input: dto,
    });
  }

  async clusterAiItems(userId: string, projectId: string, dto: ClusterAiItemsDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    return this.gateway.generateStructured<{
      clusters: Array<{
        clusterName: string;
        intent: string;
        members: string[];
        recommendedUse: string;
      }>;
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "geo_clustering",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.GEO_CLUSTERING,
      input: dto,
    });
  }

  // ============================================================
  // D. 诊断 AI (Diagnosis AI)
  // ============================================================

  async explainDiagnosis(userId: string, projectId: string, dto: ExplainDiagnosisDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    await this.assertAiEntityLineage(project.id, dto);
    return this.gateway.generateStructured<{
      summary: string;
      explanation: string;
      keyFindings: Array<{
        point: string;
        impact: string;
        reason: string;
      }>;
      supportingEvidenceIds: string[];
      limitations: string[];
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "diagnosis_explanation",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.DIAGNOSIS_EXPLANATION,
      input: dto,
    });
  }

  // ============================================================
  // E. 优化建议与机会 AI (Recommendation / Opportunity AI)
  // ============================================================

  async draftRecommendation(userId: string, projectId: string, dto: DraftRecommendationDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    await this.assertAiEntityLineage(project.id, dto);
    return this.gateway.generateStructured<{
      title: string;
      problem: string;
      action: string;
      expectedObservableSignal: string;
      priorityRationale: string;
      dependencies: string[];
      risks: string[];
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "recommendation_draft",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.RECOMMENDATION_DRAFT,
      input: dto,
    });
  }

  async draftOpportunity(userId: string, projectId: string, dto: DraftOpportunityDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    await this.assertAiEntityLineage(project.id, dto);
    return this.gateway.generateStructured<{
      title: string;
      objective: string;
      problemStatement: string;
      priorityQueries: string[];
      suggestedContentAngle: string;
      estimatedEffort: string;
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "opportunity_draft",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.OPPORTUNITY_DRAFT,
      input: dto,
    });
  }

  // ============================================================
  // F. 战略与战役 AI (Strategy & Campaign AI)
  // ============================================================

  async draftStrategy(userId: string, projectId: string, dto: DraftStrategyDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    return this.gateway.generateStructured<{
      objective: string;
      priorityQuestions: string[];
      targetAudiences: string[];
      contentDirections: Array<{
        name: string;
        description: string;
        targetChannels: string[];
      }>;
      successObservationPlan: string[];
      risks: string[];
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "strategy_draft",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.STRATEGY_DRAFT,
      input: dto,
    });
  }

  async draftCampaign(userId: string, projectId: string, dto: DraftCampaignDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    await this.assertAiEntityLineage(project.id, dto);
    return this.gateway.generateStructured<{
      campaignName: string;
      objective: string;
      targetQueries: string[];
      contentPlan: Array<{
        title: string;
        format: string;
        targetChannel: string;
        scheduledWeek: string;
        keyAngle: string;
      }>;
      channelSuggestions: string[];
      milestones: Array<{
        milestone: string;
        targetDateHint: string;
      }>;
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "campaign_draft",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.CAMPAIGN_DRAFT,
      input: dto,
    });
  }

  // ============================================================
  // G. 内容生产与优化 AI (Content Production AI)
  // ============================================================

  async generateContentBrief(userId: string, projectId: string, dto: GenerateContentBriefDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    return this.gateway.generateStructured<{
      titleIdeas: string[];
      contentObjective: string;
      targetAudience: string;
      questionsToAnswer: string[];
      keyEntities: string[];
      outline: string[];
      evidenceRequirements: string[];
      citationRequirements: string[];
      cta: string;
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "content_brief",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.CONTENT_BRIEF,
      input: dto,
    });
  }

  async generateTitles(userId: string, projectId: string, dto: GenerateTitlesDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    return this.gateway.generateStructured<{
      titles: Array<{
        title: string;
        style: string;
        rationale: string;
      }>;
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "content_titles",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.CONTENT_TITLES,
      input: dto,
    });
  }

  async generateOutline(userId: string, projectId: string, dto: GenerateOutlineDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    return this.gateway.generateStructured<{
      outline: Array<{
        section: string;
        subpoints: string[];
        intentToSatisfy: string;
      }>;
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "content_outline",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.CONTENT_OUTLINE,
      input: dto,
    });
  }

  async generateDraft(userId: string, projectId: string, dto: GenerateDraftDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    const projectWithProfile = await this.prisma.client.project.findUnique({
      where: { id: projectId },
      include: {
        brands: { take: 1, orderBy: { createdAt: "asc" } },
      },
    });
    const defaultBrand = projectWithProfile?.brands?.[0];
    const enrichedInput = {
      ...dto,
      brandName: dto.brandName || defaultBrand?.name || projectWithProfile?.name,
      industry: defaultBrand?.productCategory || projectWithProfile?.industry || undefined,
      productCategory: defaultBrand?.productCategory || undefined,
      website: defaultBrand?.website || undefined,
      brandContext: dto.brandContext || defaultBrand?.description || projectWithProfile?.description || undefined,
    };

    const result = await this.gateway.generateStructured<{
      title: string;
      body: string;
      summary: string;
      tags: string[];
      faqSection?: Array<{ question: string; answer: string }>;
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "content_draft",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature ?? 0.7,
      maxTokens: dto.maxTokens ?? 4096,
      jsonObject: true,
      promptVersion: PROMPT_VERSIONS.CONTENT_DRAFT,
      input: enrichedInput,
    });

    if (dto.channel && dto.channel.toUpperCase().includes("XIAOHONGSHU") && result.data?.title) {
      if (result.data.title.length > 20) {
        result.data.title = result.data.title.slice(0, 20);
      }
    }
    return result;
  }

  async rewriteContent(userId: string, projectId: string, dto: RewriteContentDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    return this.gateway.generateStructured<{
      originalContent: string;
      rewrittenContent: string;
      changeSummary: string;
      diffHighlights?: string[];
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "content_rewrite",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.CONTENT_REWRITE,
      input: dto,
    });
  }

  async optimizeGeoContent(userId: string, projectId: string, dto: OptimizeGeoContentDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    return this.gateway.generateStructured<{
      missingQuestions: string[];
      missingEntities: string[];
      missingFacts: string[];
      structuralFeedback: string[];
      suggestedFaq: Array<{ question: string; answer: string }>;
      optimizedContent: string;
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "content_geo_opt",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.CONTENT_GEO_OPT,
      input: dto,
    });
  }

  async generateFaq(userId: string, projectId: string, dto: GenerateFaqDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    return this.gateway.generateStructured<{
      faqs: Array<{
        question: string;
        answer: string;
        userIntent: string;
      }>;
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "content_faq",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.CONTENT_FAQ,
      input: dto,
    });
  }

  async scanFactRisk(userId: string, projectId: string, dto: ScanFactRiskDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    return this.gateway.generateStructured<{
      claims: Array<{
        claim: string;
        riskLevel: string;
        needsEvidence: boolean;
        reason: string;
      }>;
      overallRisk: string;
      suggestions: string[];
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "fact_risk_scan",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.FACT_RISK_SCAN,
      input: dto,
    });
  }

  // ============================================================
  // H. 竞品与实体识别 (Competitor Candidates AI)
  // ============================================================

  async detectCompetitorCandidates(userId: string, projectId: string, dto: DetectCompetitorCandidatesDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    return this.gateway.generateStructured<{
      candidates: Array<{
        name: string;
        aliases: string[];
        category: string;
        reasonDetected: string;
      }>;
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "competitor_candidates",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.COMPETITOR_CANDIDATES,
      input: dto,
    });
  }

  // ============================================================
  // I. 效果验证与归因解读 (Outcome / Attribution / Report AI)
  // ============================================================

  async summarizeOutcome(userId: string, projectId: string, dto: SummarizeOutcomeDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    await this.assertAiEntityLineage(project.id, dto);
    return this.gateway.generateStructured<{
      summary: string;
      majorChanges: string[];
      observedTrends: string[];
      disclaimer: string;
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "outcome_summary",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.OUTCOME_SUMMARY,
      input: dto,
    });
  }

  async explainAttribution(userId: string, projectId: string, dto: ExplainAttributionDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    await this.assertAiEntityLineage(project.id, dto);
    return this.gateway.generateStructured<{
      explanation: string;
      keyFactors: string[];
      confoundingNotes: string[];
      attributionStatusNotice: string;
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "attribution_explanation",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.ATTRIBUTION_EXPLANATION,
      input: dto,
    });
  }

  async summarizeReport(userId: string, projectId: string, dto: SummarizeReportDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    await this.assertAiEntityLineage(project.id, dto);
    return this.gateway.generateStructured<{
      executiveSummary: string;
      keyFindings: string[];
      evidenceLimitations: string[];
      recommendedNextSteps: string[];
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "report_summary",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.REPORT_SUMMARY,
      input: dto,
    });
  }

  // ============================================================
  // J. 学习观察与行动建议 (Learning AI)
  // ============================================================

  async summarizeLearning(userId: string, projectId: string, dto: SummarizeLearningDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    await this.assertAiEntityLineage(project.id, dto);
    return this.gateway.generateStructured<{
      patternExplanation: string;
      scopeOfApplicability: string[];
      limitations: string[];
      testableHypotheses: string[];
      singleSampleWarning?: string;
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "learning_summary",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.LEARNING_SUMMARY,
      input: dto,
    });
  }

  async draftLearningActions(userId: string, projectId: string, dto: DraftLearningActionsDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    return this.gateway.generateStructured<{
      proposedActions: Array<{
        action: string;
        why: string;
        supportingPattern: string;
        risks: string;
        whatToMeasureNext: string;
      }>;
      disclaimer: string;
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "learning_actions",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.LEARNING_ACTIONS,
      input: dto,
    });
  }

  // ============================================================
  // K. 品牌与竞品智能解析 (Commercial SOP Parity)
  // ============================================================

  async resolveBrand(userId: string, projectId: string, dto: ResolveBrandDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    return this.gateway.generateStructured<{
      brandName: string;
      fullName: string;
      region: string;
      industry: string;
      aliases: string[];
      competitors: string[];
      coreKeywords: string[];
      discoveryQueries: Array<{
        text: string;
        category: string;
        intent: string;
      }>;
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "brand_resolution",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.BRAND_RESOLUTION,
      input: dto,
    });
  }

  // ============================================================
  // L. 视频脚本生成 (Video Script Generation)
  // ============================================================

  async generateVideoScript(userId: string, projectId: string, dto: GenerateVideoScriptDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    return this.gateway.generateStructured<{
      title: string;
      hook: string;
      scenes: Array<{
        sceneNumber: number;
        visual: string;
        narration: string;
        durationSeconds: number;
      }>;
      callToAction: string;
      tags: string[];
    }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "video_script",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.VIDEO_SCRIPT,
      input: dto,
    });
  }

  /**
   * 把已有草稿适配到选定渠道。相同原文默认复用已有生成，force 才再次调用模型。
   * 结果不会创建分发任务；调用方确认后才写入现有分发预览。
   */
  async adaptContentChannels(userId: string, projectId: string, draftId: string, dto: AdaptContentChannelsDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    const draft = await this.prisma.client.contentDraft.findFirst({
      where: { id: draftId, projectId },
    });
    if (!draft) throw new NotFoundException("草稿不存在");

    const revision = dto.revisionId
      ? await this.prisma.client.contentRevision.findFirst({ where: { id: dto.revisionId, draftId } })
      : await this.prisma.client.contentRevision.findFirst({
          where: { draftId },
          orderBy: { version: "desc" },
        });
    if (!revision) throw new NotFoundException("草稿版本不存在");

    const channels = [...new Set(dto.channels.map((item) => item.trim()).filter(Boolean))];
    if (!channels.length) throw new BadRequestException("至少选择一个渠道");
    const allowed = new Set(knownAdaptationChannels());
    const unknown = channels.filter((channel) => !allowed.has(channel));
    if (unknown.length) throw new BadRequestException(`不支持的渠道: ${unknown.join(", ")}`);

    const sourceTitle = draft.title;
    const sourceBody = stripHtml(revision.body);
    const sourceText = `${sourceTitle}\n${sourceBody}\n${revision.summary || ""}`;
    const promptVersion = PROMPT_VERSIONS.CONTENT_CHANNEL_ADAPTATION;
    const idempotencyKey = adaptationIdempotencyKey({
      promptVersion,
      revisionId: revision.id,
      title: sourceTitle,
      body: sourceBody,
      channels,
      instructions: dto.instructions,
    });

    if (!dto.force) {
      const replay = await this.findAdaptationReplay(project.organizationId, draftId, promptVersion, idempotencyKey);
      if (replay) {
        return this.presentAdaptation({
          draftId,
          revisionId: revision.id,
          promptVersion,
          provider: replay.provider,
          model: replay.model,
          inputTokens: replay.inputTokens,
          outputTokens: replay.outputTokens,
          totalTokens: replay.totalTokens,
          estimatedCost: replay.estimatedCost == null ? null : Number(replay.estimatedCost),
          latencyMs: replay.latencyMs ?? 0,
          generationId: replay.id,
          replayed: true,
          rawChannels: (replay.outputSnapshot as { channels?: unknown[] } | null)?.channels,
          requestedChannels: channels,
          sourceTitle,
          sourceBody,
          sourceText,
        });
      }
    }

    const requestedProvider = dto.provider || "mock";
    const useReal = requestedProvider !== "mock";

    const channelRawResults: Array<Record<string, unknown>> = [];
    let aggregatedInputTokens = 0;
    let aggregatedOutputTokens = 0;
    let aggregatedTotalTokens = 0;
    let aggregatedCost: number | null = null;
    let maxLatencyMs = 0;
    let lastGenerationId: string | null = null;
    let resolvedProvider = useReal ? "deepseek" : "mock";
    let resolvedModel = useReal ? ADAPTATION_REAL_MODEL : (dto.model || "mock-ai-engine");

    // 针对每个目标渠道独立执行适配与隔离生成，防止大长文 Token 溢出与全量失效
    for (const channel of channels) {
      const channelIdempotencyKey = adaptationIdempotencyKey({
        promptVersion,
        revisionId: revision.id,
        title: sourceTitle,
        body: sourceBody,
        channels: [channel],
        instructions: dto.instructions,
      });

      // 1. 检查单渠道 Replay 缓存
      if (!dto.force) {
        const replay = await this.findAdaptationReplay(project.organizationId, draftId, promptVersion, channelIdempotencyKey);
        if (replay) {
          const rawList = (replay.outputSnapshot as { channels?: unknown[] } | null)?.channels;
          if (Array.isArray(rawList) && rawList.length > 0) {
            channelRawResults.push({
              ...(rawList[0] as Record<string, unknown>),
              channel,
              status: "SUCCESS",
              generationMode: replay.provider === "mock" ? "MOCK" : "REAL_LLM",
            });
            continue;
          }
        }
      }

      // 2. 根据渠道形态定制单渠道 Token 预算
      let chMaxTokens = 1500;
      if (channel === "ZHIHU" || channel === "WECHAT_OFFICIAL_ACCOUNT") {
        chMaxTokens = 2500; // 长文渠道支持深度展开与完整小标题
      } else if (channel === "DOUYIN" || channel === "BILIBILI" || channel === "WECHAT_CHANNELS" || channel === "KUAISHOU") {
        chMaxTokens = 1800; // 视频渠道支持完整分镜头口播脚本
      } else if (channel === "XIAOHONGSHU") {
        chMaxTokens = 1200; // 精炼社交图文与表情段落
      } else if (channel === "WEIBO") {
        chMaxTokens = 800; // 微博精简短文
      }

      const singleGatewayInput = {
        idempotencyKey: channelIdempotencyKey,
        title: sourceTitle,
        body: sourceBody,
        summary: revision.summary,
        instructions: dto.instructions || "",
        perspective: dto.perspective || "THIRD_PERSON",
        tone: dto.tone || "PROFESSIONAL",
        contentType: dto.contentType || "AUTO",
        channels: [{
          channel,
          requiresVideo: VIDEO_SCRIPT_CHANNELS.has(channel),
          limits: limitsForChannel(channel),
        }],
      };

      // 3. 真实调用门禁校验
      if (useReal) {
        if (requestedProvider !== "auto" && requestedProvider !== "deepseek") {
          throw new BadRequestException("本次只允许 DeepSeek Flash。其他付费模型已拒绝，未发出请求。");
        }
        const promptDef = AI_PROMPTS[promptVersion];
        const chBudget = assessAdaptationBudget(promptDef.systemPrompt, promptDef.buildUserPrompt(singleGatewayInput));
        if (!adaptationBudgetAllowsCall(chBudget)) {
          throw new BadRequestException(
            `真实调用已拦截：渠道 ${channel} 最坏费用 $${chBudget.worstCaseUsd} 超过门禁 $${chBudget.ceilingUsd}。未发出请求。`,
          );
        }
        realAdaptationAttempts += 1;
        this.logger.log(
          `adaptation real gate channel=${channel} model=${ADAPTATION_REAL_MODEL} attempt=${realAdaptationAttempts}`,
        );
      }

      // 4. 执行单渠道独立生成与故障隔离
      try {
        const generated = await this.gateway.generateStructured<{ channels: Array<Record<string, unknown>> }>({
          organizationId: project.organizationId,
          projectId: project.id,
          userId,
          feature: CONTENT_ADAPTATION_FEATURE,
          entityType: "ContentDraft",
          entityId: draftId,
          provider: useReal ? "deepseek" : "mock",
          model: useReal ? ADAPTATION_REAL_MODEL : dto.model,
          temperature: dto.temperature ?? 0.2,
          maxTokens: useReal ? chMaxTokens : (dto.maxTokens || chMaxTokens),
          maxRetries: useReal ? 0 : undefined,
          disableRepair: useReal,
          thinking: useReal ? "disabled" : undefined,
          jsonObject: useReal,
          timeoutMs: useReal ? 60_000 : undefined,
          promptVersion,
          idempotencyKey: dto.force ? `${channelIdempotencyKey}:${randomUUID()}` : channelIdempotencyKey,
          input: singleGatewayInput,
        });

        resolvedProvider = generated.provider;
        resolvedModel = generated.actualModel || generated.model;
        if (generated.generationId) lastGenerationId = generated.generationId;
        if (generated.inputTokens) aggregatedInputTokens += generated.inputTokens;
        if (generated.outputTokens) aggregatedOutputTokens += generated.outputTokens;
        if (generated.totalTokens) aggregatedTotalTokens += generated.totalTokens;
        if (generated.estimatedCost != null) {
          aggregatedCost = Number(((aggregatedCost || 0) + generated.estimatedCost).toFixed(6));
        }
        if (generated.latencyMs > maxLatencyMs) maxLatencyMs = generated.latencyMs;

        const firstCh = generated.data?.channels?.[0];
        if (firstCh) {
          channelRawResults.push({
            ...firstCh,
            channel,
            status: "SUCCESS",
            generationMode: useReal ? "REAL_LLM" : "MOCK",
          });
        } else {
          channelRawResults.push({
            channel,
            title: sourceTitle,
            body: sourceBody,
            status: "SUCCESS",
            generationMode: "MOCK",
          });
        }
      } catch (chErr: any) {
        this.logger.error(`[AiService] Channel adaptation failed for ${channel}: ${chErr.message}`);
        channelRawResults.push({
          channel,
          title: sourceTitle,
          body: sourceBody,
          status: "FAILED",
          error: chErr.message || "该渠道大模型适配失败",
          generationMode: "FAILED",
          omittedClaims: [`该渠道大模型适配失败: ${chErr.message}`],
        });
      }
    }

    return {
      ...this.presentAdaptation({
        draftId,
        revisionId: revision.id,
        promptVersion,
        provider: resolvedProvider,
        model: resolvedModel,
        inputTokens: aggregatedInputTokens || null,
        outputTokens: aggregatedOutputTokens || null,
        totalTokens: aggregatedTotalTokens || null,
        estimatedCost: aggregatedCost,
        latencyMs: maxLatencyMs,
        generationId: lastGenerationId,
        replayed: false,
        rawChannels: channelRawResults,
        requestedChannels: channels,
        sourceTitle,
        sourceBody,
        sourceText,
      }),
      promptCacheHitTokens: null,
      promptCacheMissTokens: null,
      reasoningTokens: null,
      budget: null,
    };
  }

  private async findAdaptationReplay(organizationId: string, draftId: string, promptVersion: string, idempotencyKey: string) {
    const rows = await this.prisma.client.aiGeneration.findMany({
      where: {
        organizationId,
        feature: CONTENT_ADAPTATION_FEATURE,
        entityId: draftId,
        status: "SUCCESS",
        promptVersion,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return rows.find((row) => (row.inputSnapshot as { idempotencyKey?: string } | null)?.idempotencyKey === idempotencyKey) ?? null;
  }

  private presentAdaptation(input: {
    draftId: string;
    revisionId: string;
    promptVersion: string;
    provider: string;
    model: string;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    estimatedCost: number | null;
    latencyMs: number;
    generationId: string | null;
    replayed: boolean;
    rawChannels: unknown[] | undefined;
    requestedChannels: string[];
    sourceTitle: string;
    sourceBody: string;
    sourceText: string;
  }) {
    const byChannel = new Map<string, Record<string, unknown>>();
    for (const item of input.rawChannels || []) {
      if (item && typeof item === "object" && "channel" in item) {
        byChannel.set(String((item as { channel: unknown }).channel), item as Record<string, unknown>);
      }
    }
    const channels = input.requestedChannels.map((channel) => {
      const raw = byChannel.get(channel);
      return constrainAdaptationChannel(
        {
          channel,
          title: typeof raw?.title === "string" ? raw.title : input.sourceTitle,
          body: typeof raw?.body === "string" ? raw.body : input.sourceBody,
          hashtags: Array.isArray(raw?.hashtags) ? raw.hashtags.filter((tag): tag is string => typeof tag === "string") : [],
          videoScript: typeof raw?.videoScript === "string" ? raw.videoScript : null,
          omittedClaims: Array.isArray(raw?.omittedClaims)
            ? raw.omittedClaims.filter((item): item is string => typeof item === "string")
            : raw
              ? []
              : ["模型未返回该渠道，已回退为原文"],
          status: (raw?.status as any) || "SUCCESS",
          error: (raw?.error as any) || null,
          generationMode: (raw?.generationMode as any) || (input.provider === "mock" ? "MOCK" : "REAL_LLM"),
        } as any,
        input.sourceText,
        limitsForChannel(channel),
        VIDEO_SCRIPT_CHANNELS.has(channel),
      );
    });

    return {
      draftId: input.draftId,
      revisionId: input.revisionId,
      promptVersion: input.promptVersion,
      provider: input.provider,
      model: input.model,
      realAi: input.provider !== "mock",
      generationSource: input.provider === "mock" ? "mock" : "provider",
      replayed: input.replayed,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens: input.totalTokens,
      estimatedCost: input.estimatedCost,
      latencyMs: input.latencyMs,
      generationId: input.generationId,
      channels,
    };
  }

  /**
   * 基于产品内容与目标发布渠道生成平台适配话题标签
   */
  async generateContentTags(userId: string, projectId: string, dto: GenerateTagsDto) {
    await this.tenant.assertUserInProject(userId, projectId);

    const brand = dto.brandName?.trim() || "";
    const title = dto.title.trim();
    const body = (dto.body || "").trim();
    const channel = (dto.channel || "ZHIHU").toUpperCase();
    const provider = dto.provider || "mock";

    const channelTagMap: Record<string, string[]> = {
      XIAOHONGSHU: ["好物分享", "真实测评", "避坑指南", "职场日常", "自用好物", "效率神器", "干货分享"],
      ZHIHU: ["深度科普", "技术解析", "行业观察", "效率工具", "选型指南", "专业分析"],
      DOUYIN: ["短视频创作", "神器推荐", "实用技巧", "涨知识", "职场提效", "宝藏好物"],
      BILIBILI: ["知识分享", "深度测评", "科技数码", "一键三连", "干货总结", "硬核科普"],
      WEIBO: ["新鲜事", "行业动态", "好物种草", "数码科技", "生活日常"],
      WECHAT_OFFICIAL_ACCOUNT: ["深度好文", "技术白皮书", "数字化转型", "行业趋势", "方法论"],
    };

    const baseTags = channelTagMap[channel] || ["热点推荐", "实用指南", "行业观察", "深度干货"];

    const extracted: string[] = [];
    if (brand) extracted.push(brand);

    // 从标题和正文中抽取高频专有词
    const textSample = `${title} ${body.slice(0, 300)}`;
    const words = textSample
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2 && w.length <= 8 && !["适合", "哪些", "以及", "如何", "根据", "不同", "选择", "什么", "这个", "并且", "进行"].includes(w));

    for (const w of words) {
      if (!extracted.includes(w) && extracted.length < 5) {
        extracted.push(w);
      }
    }

    const combined = [...new Set([...extracted, ...baseTags])].slice(0, 8);

    return {
      channel,
      tags: combined,
      count: combined.length,
      provider,
    };
  }
}

