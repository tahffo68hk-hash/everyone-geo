import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile,
  UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard, JwtUserPayload } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ContentExecutionService, type UploadedBuffer } from "./content-execution.service";
import {
  CreateConnectionDto, CreateDraftDto, CreatePublicationDto, DecideApprovalDto,
  ListAssetsDto, ListDraftsDto, ListPublicationsDto, UpdateDraftDto,
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

  /** 渠道能力描述符（PHASE 17）：不猜测真实 API，全部标注 mock/unverified。 */
  @Get("channels/capabilities")
  channelCapabilities() {
    return this.content.channelCapabilities();
  }

  // ---- 渠道账号连接（OAuth readiness，仅登记，不做真实 OAuth）----
  @Get("projects/:id/channel-connections")
  listConnections(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string) {
    return this.content.listConnections(u.sub, id);
  }

  @Post("projects/:id/channel-connections")
  @HttpCode(201)
  createConnection(@CurrentUser() u: JwtUserPayload, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CreateConnectionDto) {
    return this.content.createConnection(u.sub, id, dto);
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
}
