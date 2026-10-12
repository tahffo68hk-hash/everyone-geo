import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { TenantService } from "../common/tenant.service";
import { AiGatewayService } from "./ai-gateway.service";
import { PROMPT_VERSIONS } from "./ai-prompt-registry";
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
    const project = await this.tenant.assertUserInProject(userId, projectId);
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
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: "query_set_generation",
      provider: dto.provider,
      model: dto.model,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.QUERY_SET_GENERATION,
      input: dto,
    });

    // 事实校验：严格确保 Discovery 类别的问题不包含本品品牌词（如指定了 brandName）
    if (dto.brandName && result.data?.queries) {
      const bLower = dto.brandName.toLowerCase();
      for (const q of result.data.queries) {
        if (q.queryType === "DISCOVERY" && q.text.toLowerCase().includes(bLower)) {
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
    return this.gateway.generateStructured<{
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
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      promptVersion: PROMPT_VERSIONS.CONTENT_DRAFT,
      input: dto,
    });
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

    const generated = await this.gateway.generateStructured<{ channels: Array<Record<string, unknown>> }>({
      organizationId: project.organizationId,
      projectId: project.id,
      userId,
      feature: CONTENT_ADAPTATION_FEATURE,
      entityType: "ContentDraft",
      entityId: draftId,
      provider: dto.provider || "mock",
      model: dto.model,
      temperature: dto.temperature ?? 0.2,
      maxTokens: dto.maxTokens,
      promptVersion,
      idempotencyKey: dto.force ? `${idempotencyKey}:${randomUUID()}` : idempotencyKey,
      input: {
        idempotencyKey,
        title: sourceTitle,
        body: sourceBody,
        summary: revision.summary,
        instructions: dto.instructions || "",
        channels: channels.map((channel) => ({
          channel,
          requiresVideo: VIDEO_SCRIPT_CHANNELS.has(channel),
          limits: limitsForChannel(channel),
        })),
      },
    });

    return this.presentAdaptation({
      draftId,
      revisionId: revision.id,
      promptVersion: generated.promptVersion,
      provider: generated.provider,
      model: generated.model,
      inputTokens: generated.inputTokens,
      outputTokens: generated.outputTokens,
      totalTokens: generated.totalTokens,
      estimatedCost: generated.estimatedCost,
      latencyMs: generated.latencyMs,
      generationId: generated.generationId ?? null,
      replayed: false,
      rawChannels: generated.data?.channels,
      requestedChannels: channels,
      sourceTitle,
      sourceBody,
      sourceText,
    });
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
        },
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
}

