import {
  BadRequestException,
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile,
  UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ContentExecutionService, type UploadedBuffer } from "./content-execution.service";
import {
  ApplyVariantToRevisionDto, AuthorizeChannelDto, CallbackQueryDto, CreateConnectionDto, CreateDraftDto, CreatePublicationDto, DecideApprovalDto,
  GenerateImageBriefDto, GeneratePlatformVariantDto, ListAssetsDto, ListDraftsDto, ListPublicationsDto,
  RewriteVariantDto, UpdateDraftDto, ValidatePublicationDto,
  CreateVerifiedFactDto, ExtractClaimsDto, SafeRewriteDto, GenerateImagePreviewDto, AcceptImageAssetDto,
  ConfirmPublishedAssetDto, CreatePublishedAssetDto, ListPublishedAssetsDto,
  AdaptChannelsDto, BatchDistributeDto, ConfirmManualPublishedDto,
} from "./dto/content-execution.dto";

/**
 * 内容执行领域 API（PHASE 14）—— 最小后端接口。
 *
 * 不含任何真实平台发布调用；发布走 Mock Publisher（PENDING → PUBLISHED/FAILED，假值 externalId）。
 * 所有 route 先过 AuthGuard，再由服务层 TenantService 做租户隔离校验。
 */
@Controller()
@UseGuards(AuthGuard)
export class ContentExecutionController {
  constructor(private readonly content: ContentExecutionService) {}

  // ---- 草稿 ----
  @Post("projects/:id/content-drafts")
  @HttpCode(201)
  createDraft(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CreateDraftDto) {
    return this.content.createDraft(u.sub, id, dto);
  }

  @Get("projects/:id/content-drafts")
  listDrafts(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Query() dto: ListDraftsDto) {
    return this.content.listDrafts(u.sub, id, dto);
  }

  @Get("content-drafts/:id")
  getDraft(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.content.getDraft(u.sub, id);
  }

  @Patch("content-drafts/:id")
  updateDraft(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateDraftDto) {
    return this.content.updateDraft(u.sub, id, dto);
  }

  @Post("content-drafts/:id/submit")
  @HttpCode(200)
  submit(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.content.submitForReview(u.sub, id);
  }

  @Post("content-drafts/:id/decide")
  @HttpCode(200)
  decide(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: DecideApprovalDto) {
    return this.content.decideApproval(u.sub, id, dto);
  }

  @Post("content-drafts/:id/archive")
  @HttpCode(200)
  archive(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.content.archiveDraft(u.sub, id);
  }

  @Get("content-drafts/:id/audit")
  audit(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.content.listAudit(u.sub, id);
  }

  /** 历史 Revision 正文（PHASE 3）：只读、immutable；跨 tenant/project 404。 */
  @Get("content-drafts/:id/revisions/:revisionId")
  getRevision(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("revisionId", ParseUUIDPipe) revisionId: string,
  ) {
    return this.content.getRevision(u.sub, id, revisionId);
  }

  // ---- 平台版本生成与图片 Brief ----
  @Post("content-drafts/:id/variants")
  @HttpCode(201)
  generatePlatformVariant(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GeneratePlatformVariantDto,
  ) {
    return this.content.generatePlatformVariant(u.sub, id, dto);
  }

  @Get("content-drafts/:id/variants")
  listPlatformVariants(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.content.listPlatformVariants(u.sub, id);
  }

  @Get("content-drafts/:id/variants/:variantId")
  getPlatformVariant(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("variantId", ParseUUIDPipe) variantId: string,
  ) {
    return this.content.getPlatformVariant(u.sub, id, variantId);
  }

  @Post("content-drafts/:id/variants/:variantId/rewrite")
  @HttpCode(201)
  rewritePlatformVariant(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("variantId", ParseUUIDPipe) variantId: string,
    @Body() dto: RewriteVariantDto,
  ) {
    return this.content.rewritePlatformVariant(u.sub, id, variantId, dto);
  }

  @Post("content-drafts/:id/variants/:variantId/apply")
  @HttpCode(200)
  applyVariantToRevision(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("variantId", ParseUUIDPipe) variantId: string,
    @Body() dto: ApplyVariantToRevisionDto,
  ) {
    return this.content.applyVariantToDraftRevision(u.sub, id, variantId, dto);
  }

  @Post("content-drafts/:id/image-briefs")
  @HttpCode(201)
  generateImageBriefs(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GenerateImageBriefDto,
  ) {
    return this.content.generateImageBriefs(u.sub, id, dto);
  }

  @Get("content-drafts/:id/image-briefs")
  listImageBriefs(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.content.listImageBriefs(u.sub, id);
  }
  // ---- V2: Generation Runs ----
  @Get("content-drafts/:id/generation-runs")
  listGenerationRuns(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.content.listGenerationRuns(u.sub, id);
  }

  @Get("content-drafts/:id/generation-runs/:runId")
  getGenerationRun(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("runId", ParseUUIDPipe) runId: string,
  ) {
    return this.content.getGenerationRun(u.sub, id, runId);
  }

  // ---- V2: Verified Facts & Claim Guard ----
  @Get("content-drafts/:id/facts")
  listVerifiedFacts(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.content.listVerifiedFacts(u.sub, id);
  }

  @Post("content-drafts/:id/facts")
  @HttpCode(201)
  createVerifiedFact(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateVerifiedFactDto,
  ) {
    return this.content.createVerifiedFact(u.sub, id, dto);
  }

  @Post("content-drafts/:id/extract-claims")
  @HttpCode(200)
  extractClaims(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ExtractClaimsDto,
  ) {
    return this.content.extractClaims(u.sub, id, dto);
  }

  @Post("content-drafts/:id/safe-rewrite")
  @HttpCode(200)
  safeRewrite(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SafeRewriteDto,
  ) {
    return this.content.safeRewrite(u.sub, id, dto);
  }

  // ---- V2: Image Preview & Accept Asset ----
  @Post("content-drafts/:id/image-generation")
  @HttpCode(201)
  generateImagePreview(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: GenerateImagePreviewDto,
  ) {
    return this.content.generateImagePreview(u.sub, id, dto);
  }

  @Post("content-drafts/:id/image-generation/:jobId/accept")
  @HttpCode(201)
  acceptImageAsset(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("jobId") jobId: string,
    @Body() dto: AcceptImageAssetDto,
  ) {
    return this.content.acceptImageAsset(u.sub, id, { ...dto, jobId });
  }


  /** 渠道能力描述符（PHASE 17）：不猜测真实 API，全部标注 mock/unverified。 */
  @Get("channels/capabilities")
  channelCapabilities() {
    return this.content.channelCapabilities();
  }

  /** 全部渠道能力与分类列表 */
  @Get("channels")
  listChannels() {
    return this.content.listAllChannels();
  }

  /** 单个渠道能力详情 */
  @Get("channels/:channel/capabilities")
  getChannelCapability(@Param("channel") channel: string) {
    return this.content.getChannelCapability(channel.toUpperCase());
  }

  // ---- 渠道账号连接（OAuth & Credential Vault）----
  @Get("projects/:id/channel-connections")
  listConnections(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.content.listConnections(u.sub, id);
  }

  @Post("projects/:id/channel-connections")
  @HttpCode(201)
  createConnection(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CreateConnectionDto) {
    return this.content.createConnection(u.sub, id, dto);
  }

  @Post("connections/:channel/authorize")
  @HttpCode(200)
  authorizeChannel(
    @CurrentUser() u: JwtUserPayload,
    @Param("channel") channel: string,
    @Body() dto: AuthorizeChannelDto,
  ) {
    return this.content.authorizeChannel(u.sub, channel.toUpperCase(), dto);
  }

  @Get("connections/:channel/callback")
  handleOAuthCallback(
    @CurrentUser() u: JwtUserPayload,
    @Param("channel") channel: string,
    @Query() query: CallbackQueryDto,
  ) {
    return this.content.handleOAuthCallback(u.sub, channel.toUpperCase(), query.code, query.state);
  }

  @Delete("connections/:connectionId")
  @HttpCode(200)
  deleteConnection(
    @CurrentUser() u: JwtUserPayload,
    @Param("connectionId", ParseUUIDPipe) connectionId: string,
  ) {
    return this.content.deleteConnection(u.sub, connectionId);
  }

  // ---- 发布 ----
  @Post("projects/:id/content-drafts/:draftId/publications")
  @HttpCode(201)
  createPublication(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("draftId", ParseUUIDPipe) draftId: string,
    @Body() dto: CreatePublicationDto,
  ) {
    return this.content.createPublication(u.sub, id, draftId, dto);
  }

  @Get("publications/:id")
  getPublication(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.content.getPublication(u.sub, id);
  }

  @Get("publications/:id/status")
  getPublicationStatus(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.content.getPublication(u.sub, id);
  }

  @Post("publications/:id/validate")
  @HttpCode(200)
  validatePublication(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto?: ValidatePublicationDto,
  ) {
    return this.content.validatePublication(u.sub, id, dto);
  }

  @Post("publications/:id/publish")
  @HttpCode(200)
  publishPublication(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body?: { confirm?: boolean },
  ) {
    return this.content.publishPublication(u.sub, id, body);
  }

  @Get("publications/:id/manual-package")
  getManualPackage(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.content.getManualPublishingPackage(u.sub, id);
  }

  /** 算子触发：重跑一次发布尝试（幂等；用于失败重试 / 演示）。 */
  @Post("publications/:id/process")
  @HttpCode(200)
  processPublication(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.content.processPublication(u.sub, id);
  }

  /** 发布列表（PHASE 4）：project scoped + 分页 + status/channel 过滤。 */
  @Get("projects/:id/publications")
  listPublications(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Query() dto: ListPublicationsDto) {
    return this.content.listPublications(u.sub, id, dto);
  }

  // ---- 素材上传基础（PHASE 5，DEV_ONLY 本地存储适配器）----
  @Get("projects/:id/content-assets")
  listAssets(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Query() dto: ListAssetsDto) {
    return this.content.listAssets(u.sub, id, dto);
  }

  /** 最小安全上传：multipart 字段 type(IMAGE/VIDEO/COVER/AUDIO) + file；可选 draftId。 */
  @Post("projects/:id/content-assets")
  @HttpCode(201)
  @UseInterceptors(FileInterceptor("file"))
  createAsset(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedBuffer | undefined,
    @Body() body: { type?: string; draftId?: string },
  ) {
    return this.content.createAsset(u.sub, id, file, { type: body?.type, draftId: body?.draftId });
  }

  /** 素材下载/读取（真实可访问，按 storageKey 返回带正确 Content-Type 的流） */
  @Get(["assets/download/:orgId/:filename", "api/assets/download/:orgId/:filename"])
  async downloadAsset(
    @Param("orgId") orgId: string,
    @Param("filename") filename: string,
    @Res() res: any,
  ) {
    const asset = await this.content.downloadAsset(orgId, filename);
    res.setHeader("Content-Type", asset.mimeType);
    res.setHeader("Content-Length", String(asset.sizeBytes));
    res.send(asset.buffer);
  }

  // ---- M10A 发布资产与血缘 (Published Asset & Lineage) ----

  /**
   * 将发布记录确认为落地资产 (PublishedAsset)
   * POST /publications/:id/confirm-asset 或 POST /api/content/publications/:id/confirm-asset
   */
  @Post(["publications/:id/confirm-asset", "api/content/publications/:id/confirm-asset"])
  @HttpCode(201)
  confirmPublishedAsset(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ConfirmPublishedAssetDto,
  ) {
    return this.content.confirmPublishedAsset(u.sub, id, dto);
  }

  /**
   * 手动录入/导入已发布资产
   * POST /projects/:id/published-assets 或 POST /api/content/published-assets
   */
  @Post(["projects/:id/published-assets", "api/content/published-assets", "content/published-assets"])
  @HttpCode(201)
  createPublishedAsset(
    @CurrentUser() u: JwtUserPayload,
    @Param("id") paramProjectId: string | undefined,
    @Body() dto: CreatePublishedAssetDto,
  ) {
    const projectId = paramProjectId || dto.projectId;
    if (!projectId) {
      throw new BadRequestException("缺少 projectId 参数");
    }
    return this.content.createPublishedAsset(u.sub, projectId, dto);
  }

  /**
   * 读取单个已发布资产
   * GET /published-assets/:id 或 GET /api/content/published-assets/:id
   */
  @Get(["published-assets/:id", "api/content/published-assets/:id", "content/published-assets/:id"])
  getPublishedAsset(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.content.getPublishedAsset(u.sub, id);
  }

  /**
   * 完整发布血缘反向追溯
   * GET /published-assets/:id/lineage 或 GET /api/content/published-assets/:id/lineage
   */
  @Get(["published-assets/:id/lineage", "api/content/published-assets/:id/lineage", "content/published-assets/:id/lineage"])
  getPublishedAssetLineage(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.content.getPublishedAssetLineage(u.sub, id);
  }

  /**
   * 项目下的已发布资产列表
   * GET /projects/:id/published-assets 或 GET /api/content/published-assets?projectId=...
   */
  @Get(["projects/:id/published-assets", "api/content/published-assets", "content/published-assets"])
  listPublishedAssets(
    @CurrentUser() u: JwtUserPayload,
    @Param("id") paramProjectId: string | undefined,
    @Query() dto: ListPublishedAssetsDto,
  ) {
    const projectId = paramProjectId || dto.projectId;
    if (!projectId) {
      throw new BadRequestException("缺少 projectId 参数");
    }
    return this.content.listPublishedAssets(u.sub, projectId, dto);
  }

  // ---- 多平台内容分发中心 (Multi-Platform Distribution Center) ----

  /** 获取支持的渠道矩阵与连接状态 */
  @Get("projects/:id/distribution/channels")
  getDistributionChannels(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.content.getDistributionChannels(u.sub, id);
  }

  /** 多渠道适配预览与人工发布包生成 */
  @Post("projects/:id/content-drafts/:draftId/distribution/adapt")
  @HttpCode(200)
  adaptContentForChannels(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("draftId", ParseUUIDPipe) draftId: string,
    @Body() dto: AdaptChannelsDto,
  ) {
    return this.content.adaptContentForChannels(u.sub, id, draftId, dto);
  }

  /** 一键多渠道分发任务批量创建与触发（自动发布 + 人工辅助发布） */
  @Post("projects/:id/content-drafts/:draftId/distribution/batch")
  @HttpCode(201)
  batchDistribute(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("draftId", ParseUUIDPipe) draftId: string,
    @Body() dto: BatchDistributeDto,
  ) {
    return this.content.batchDistribute(u.sub, id, draftId, dto);
  }

  /** 人工发布回填确认 (回填真实链接/ID/发布时间，直接落成 PublishedAsset) */
  @Post(["publications/:id/confirm-manual-published", "api/content/publications/:id/confirm-manual-published"])
  @HttpCode(200)
  confirmManualPublished(
    @CurrentUser() u: JwtUserPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ConfirmManualPublishedDto,
  ) {
    return this.content.confirmManualPublished(u.sub, id, dto);
  }
}

