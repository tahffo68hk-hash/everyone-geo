import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { AiService } from "./ai.service";
import {
  AnalyzeKeywordGapDto,
  ClassifyQueryDto,
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


@Controller()
@UseGuards(AuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * 查看 Provider 配置与连接状态
   * GET /ai/status
   */
  @Get("ai/status")
  getProviderStatus() {
    return this.aiService.getProviderStatus();
  }

  /**
   * 查看项目级 AI 生产与审计记录
   * GET /projects/:id/ai/generations
   */
  @Get("projects/:id/ai/generations")
  listGenerations(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Query("limit") limit?: string,
  ) {
    const lim = limit ? parseInt(limit, 10) : 50;
    return this.aiService.listGenerations(u.sub, id, lim);
  }

  // ============================================================
  // B. 问题集 AI (Query AI)
  // ============================================================

  @Post("projects/:id/ai/query-set")
  @HttpCode(200)
  generateQuerySet(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GenerateQuerySetDto,
  ) {
    return this.aiService.generateQuerySet(u.sub, id, dto);
  }

  @Post("projects/:id/ai/query-expansion")
  @HttpCode(200)
  expandQueries(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ExpandQueriesDto,
  ) {
    return this.aiService.expandQueries(u.sub, id, dto);
  }

  @Post("projects/:id/ai/query-rewrite")
  @HttpCode(200)
  rewriteQuery(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RewriteQueryDto,
  ) {
    return this.aiService.rewriteQuery(u.sub, id, dto);
  }

  @Post("projects/:id/ai/query-classify")
  @HttpCode(200)
  classifyQuery(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ClassifyQueryDto,
  ) {
    return this.aiService.classifyQuery(u.sub, id, dto);
  }

  // ============================================================
  // C. GEO 关键词与主题检测 (GEO Topic & Keyword Intelligence)
  // ============================================================

  @Post("projects/:id/ai/geo-topics")
  @HttpCode(200)
  detectGeoTopics(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DetectGeoTopicsDto,
  ) {
    return this.aiService.detectGeoTopics(u.sub, id, dto);
  }

  @Post("projects/:id/ai/geo-keywords")
  @HttpCode(200)
  extractGeoKeywords(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ExtractGeoKeywordsDto,
  ) {
    return this.aiService.extractGeoKeywords(u.sub, id, dto);
  }

  @Post("projects/:id/ai/keyword-gap")
  @HttpCode(200)
  analyzeKeywordGap(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AnalyzeKeywordGapDto,
  ) {
    return this.aiService.analyzeKeywordGap(u.sub, id, dto);
  }

  @Post("projects/:id/ai/cluster")
  @HttpCode(200)
  clusterAiItems(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ClusterAiItemsDto,
  ) {
    return this.aiService.clusterAiItems(u.sub, id, dto);
  }

  // ============================================================
  // D. 诊断 AI (Diagnosis AI)
  // ============================================================

  @Post("projects/:id/ai/diagnosis-explanation")
  @HttpCode(200)
  explainDiagnosis(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ExplainDiagnosisDto,
  ) {
    return this.aiService.explainDiagnosis(u.sub, id, dto);
  }

  // ============================================================
  // E. 建议与机会 AI (Recommendation / Opportunity AI)
  // ============================================================

  @Post("projects/:id/ai/recommendation-draft")
  @HttpCode(200)
  draftRecommendation(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DraftRecommendationDto,
  ) {
    return this.aiService.draftRecommendation(u.sub, id, dto);
  }

  @Post("projects/:id/ai/opportunity-draft")
  @HttpCode(200)
  draftOpportunity(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DraftOpportunityDto,
  ) {
    return this.aiService.draftOpportunity(u.sub, id, dto);
  }

  // ============================================================
  // F. 战略与战役 AI (Strategy & Campaign AI)
  // ============================================================

  @Post("projects/:id/ai/strategy-draft")
  @HttpCode(200)
  draftStrategy(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DraftStrategyDto,
  ) {
    return this.aiService.draftStrategy(u.sub, id, dto);
  }

  @Post("projects/:id/ai/campaign-draft")
  @HttpCode(200)
  draftCampaign(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DraftCampaignDto,
  ) {
    return this.aiService.draftCampaign(u.sub, id, dto);
  }

  // ============================================================
  // G. 内容生产与优化 AI (Content Production AI)
  // ============================================================

  @Post("projects/:id/ai/content-brief")
  @HttpCode(200)
  generateContentBrief(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GenerateContentBriefDto,
  ) {
    return this.aiService.generateContentBrief(u.sub, id, dto);
  }

  @Post("projects/:id/ai/content-titles")
  @HttpCode(200)
  generateTitles(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GenerateTitlesDto,
  ) {
    return this.aiService.generateTitles(u.sub, id, dto);
  }

  @Post("projects/:id/ai/content-outline")
  @HttpCode(200)
  generateOutline(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GenerateOutlineDto,
  ) {
    return this.aiService.generateOutline(u.sub, id, dto);
  }

  @Post("projects/:id/ai/content-draft")
  @HttpCode(200)
  generateDraft(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GenerateDraftDto,
  ) {
    return this.aiService.generateDraft(u.sub, id, dto);
  }

  @Post("projects/:id/ai/content-rewrite")
  @HttpCode(200)
  rewriteContent(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RewriteContentDto,
  ) {
    return this.aiService.rewriteContent(u.sub, id, dto);
  }

  @Post("projects/:id/ai/content-geo-opt")
  @HttpCode(200)
  optimizeGeoContent(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: OptimizeGeoContentDto,
  ) {
    return this.aiService.optimizeGeoContent(u.sub, id, dto);
  }

  @Post("projects/:id/ai/content-faq")
  @HttpCode(200)
  generateFaq(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GenerateFaqDto,
  ) {
    return this.aiService.generateFaq(u.sub, id, dto);
  }

  @Post("projects/:id/ai/fact-risk-scan")
  @HttpCode(200)
  scanFactRisk(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ScanFactRiskDto,
  ) {
    return this.aiService.scanFactRisk(u.sub, id, dto);
  }

  // ============================================================
  // H. 竞品与实体识别 (Competitor Candidates AI)
  // ============================================================

  @Post("projects/:id/ai/competitor-candidates")
  @HttpCode(200)
  detectCompetitorCandidates(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DetectCompetitorCandidatesDto,
  ) {
    return this.aiService.detectCompetitorCandidates(u.sub, id, dto);
  }

  // ============================================================
  // I. 效果验证与归因解读 (Outcome / Attribution / Report AI)
  // ============================================================

  @Post("projects/:id/ai/outcome-summary")
  @HttpCode(200)
  summarizeOutcome(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SummarizeOutcomeDto,
  ) {
    return this.aiService.summarizeOutcome(u.sub, id, dto);
  }

  @Post("projects/:id/ai/attribution-explanation")
  @HttpCode(200)
  explainAttribution(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ExplainAttributionDto,
  ) {
    return this.aiService.explainAttribution(u.sub, id, dto);
  }

  @Post("projects/:id/ai/report-summary")
  @HttpCode(200)
  summarizeReport(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SummarizeReportDto,
  ) {
    return this.aiService.summarizeReport(u.sub, id, dto);
  }

  // ============================================================
  // J. 学习观察与行动建议 (Learning AI)
  // ============================================================

  @Post("projects/:id/ai/learning-summary")
  @HttpCode(200)
  summarizeLearning(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SummarizeLearningDto,
  ) {
    return this.aiService.summarizeLearning(u.sub, id, dto);
  }

  @Post("projects/:id/ai/learning-actions")
  @HttpCode(200)
  draftLearningActions(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DraftLearningActionsDto,
  ) {
    return this.aiService.draftLearningActions(u.sub, id, dto);
  }

  // ============================================================
  // K. 品牌与竞品智能解析 (Commercial SOP Parity)
  // ============================================================

  @Post("projects/:id/ai/resolve-brand")
  @HttpCode(200)
  resolveBrand(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ResolveBrandDto,
  ) {
    return this.aiService.resolveBrand(u.sub, id, dto);
  }

  // ============================================================
  // L. 视频脚本生成 (Video Script AI)
  // ============================================================

  @Post("projects/:id/ai/video-script")
  @HttpCode(200)
  generateVideoScript(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GenerateVideoScriptDto,
  ) {
    return this.aiService.generateVideoScript(u.sub, id, dto);
  }

  /**
   * 按渠道适配已有草稿。默认由调用方指定 mock；确认前不创建分发任务。
   * POST /projects/:id/content-drafts/:draftId/ai/channel-adaptation
   */
  @Post("projects/:id/content-drafts/:draftId/ai/channel-adaptation")
  @HttpCode(200)
  adaptContentChannels(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("draftId", ParseUUIDPipe) draftId: string,
    @Body() dto: AdaptContentChannelsDto,
  ) {
    return this.aiService.adaptContentChannels(u.sub, id, draftId, dto);
  }
}

