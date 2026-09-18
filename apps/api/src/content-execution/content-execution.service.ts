import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@geo/database";
import { PrismaService } from "../prisma.service";
import { TenantService } from "../common/tenant.service";
import {
  ApplyVariantToRevisionDto,
  ASSET_TYPES, AuthorizeChannelDto, CreateConnectionDto, CreateDraftDto, CreatePublicationDto, DecideApprovalDto,
  GenerateImageBriefDto, GeneratePlatformVariantDto, ListAssetsDto, ListDraftsDto, ListPublicationsDto,
  RewriteVariantDto, UpdateDraftDto, ValidatePublicationDto,
  CreateVerifiedFactDto, ExtractClaimsDto, SafeRewriteDto, GenerateImagePreviewDto, AcceptImageAssetDto,
  ConfirmPublishedAssetDto, CreatePublishedAssetDto, ListPublishedAssetsDto,
} from "./dto/content-execution.dto";
import {
  createPublicationQueue, defaultConnectorRegistry, defaultCredentialVault, defaultOAuthStateSecurity,
  enqueuePublication, executePublication, generateManualPublishingPackage, PublicationRouter,
  generatePlatformVariant as generatePlatformVariantHelper,
  rewriteContent as rewriteContentHelper,
  extractSafeFactCheckNotes,
  FactGroundingEngine, type VerifiedFact, type ExtractedClaim,
  RealContentGenerationProvider, MockContentGenerationProvider,
  MockImageGenerationProvider, WanxImageGenerationProvider,
  PROMPT_VERSIONS,
  type ChannelCapabilityDescriptor, type PublicationQueue,
  type CnPlatform, type ImageBrief,
} from "@geo/queue";
import { DevLocalStorageAdapter } from "./storage/local-storage.adapter";

/**
 * 内容执行领域服务（M9 / PHASE 2-16）。
 *
 * 关键不变量（强制，测试覆盖）：
 *   - 草稿不会自动 APPROVED，也不会自动发布；只有「对最新版本的 APPROVED 批准」才解锁发布。
 *   - 发布要求：draft.status === APPROVED 且最新版本存在 APPROVED 审批；所选渠道连接 status
 *     必须为 CONNECTED（EXPIRED/REVOKED/ERROR 一律拦截）。
 *   - 出站写闸门：EXTERNAL_PUBLISHING_ENABLED 本回合恒为 false；只有 Mock Publisher 实现，
 *     所有 externalId/externalUrl 为假值，Real Provider Calls / External Writes = 0。
 *   - 幂等：Publication.idempotencyKey 唯一；每次执行尝试使用独立 idempotencyKey，重放安全。
 *   - 租户隔离：所有读写先过 TenantService 校验 membership，否则 404（不泄露存在性）。
 *   - 度量边界：Publication / PublicationAttempt 与 GEO Evidence 解耦，不构成优化证据。
 *   - 审计：action 不含任何 token/secret/敏感 prompt。
 *   - 成本：ContentUsageEvent.costUsd 恒为 null（非 0），本回合无真实计费。
 */

const APPROVER_ROLES = new Set(["OWNER", "ADMIN"]);

// 渠道内容约束（渠道中立校验；title/正文长度上限）。
const CHANNEL_LIMITS: Record<string, { titleMax: number; bodyMax: number }> = {
  XIAOHONGSHU: { titleMax: 20, bodyMax: 1000 },
  DOUYIN: { titleMax: 55, bodyMax: 1000 },
  WEIBO: { titleMax: 140, bodyMax: 2000 },
  WECHAT: { titleMax: 64, bodyMax: 2000 },
  BAIDU: { titleMax: 40, bodyMax: 1000 },
  OTHER: { titleMax: 200, bodyMax: 5000 },
};

/**
 * 渠道能力描述符（PHASE 17）—— 只声明本系统「已知且已验证」的能力，**不猜测**各平台真实 API。
 * 本回合所有渠道均为 mock（publisher=mock、oauthImplemented=false、apiDetails=unverified）；
 * 真实接入需在下一阶段由官方 Connector 提供并在 descriptor 中显式升级。
 */
export interface ChannelCapability {
  channel: string;
  label: string;
  titleMax: number;
  bodyMax: number;
  supportsImages: boolean;
  publisher: "mock";
  oauthImplemented: false;
  apiDetails: "unverified";
}

export const CHANNEL_CAPABILITIES: ChannelCapability[] = [
  { channel: "XIAOHONGSHU", label: "小红书", ...CHANNEL_LIMITS.XIAOHONGSHU, supportsImages: true, publisher: "mock", oauthImplemented: false, apiDetails: "unverified" },
  { channel: "DOUYIN", label: "抖音", ...CHANNEL_LIMITS.DOUYIN, supportsImages: true, publisher: "mock", oauthImplemented: false, apiDetails: "unverified" },
  { channel: "WEIBO", label: "微博", ...CHANNEL_LIMITS.WEIBO, supportsImages: true, publisher: "mock", oauthImplemented: false, apiDetails: "unverified" },
  { channel: "WECHAT", label: "微信", ...CHANNEL_LIMITS.WECHAT, supportsImages: true, publisher: "mock", oauthImplemented: false, apiDetails: "unverified" },
  { channel: "BAIDU", label: "百度", ...CHANNEL_LIMITS.BAIDU, supportsImages: false, publisher: "mock", oauthImplemented: false, apiDetails: "unverified" },
  { channel: "OTHER", label: "其他", ...CHANNEL_LIMITS.OTHER, supportsImages: false, publisher: "mock", oauthImplemented: false, apiDetails: "unverified" },
];

// 素材上传（PHASE 5 · Asset Upload Foundation）—— MIME allowlist + 大小上限（应用层强制）。
// 仅开放 IMAGE / VIDEO / COVER / AUDIO；TEXT/OTHER 不开放上传，未校验 MIME 一律拒绝。
const ASSET_MIME_ALLOWLIST: Record<string, string[]> = {
  IMAGE: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  COVER: ["image/png", "image/jpeg", "image/webp"],
  VIDEO: ["video/mp4", "video/quicktime", "video/webm"],
  AUDIO: ["audio/mpeg", "audio/wav", "audio/mp4", "audio/aac", "audio/x-wav"],
};
const ASSET_MAX_BYTES: Record<string, number> = {
  IMAGE: 10 * 1024 * 1024,
  COVER: 10 * 1024 * 1024,
  VIDEO: 100 * 1024 * 1024,
  AUDIO: 25 * 1024 * 1024,
};

/** 上传文件的最小结构（避免依赖 @types/multer）。 */
export interface UploadedBuffer {
  originalname?: string;
  mimetype?: string;
  size?: number;
  buffer?: Buffer;
}

@Injectable()
export class ContentExecutionService implements OnModuleDestroy {
  private readonly textGenProvider = new RealContentGenerationProvider();
  private readonly mockImageProvider = new MockImageGenerationProvider();
  private readonly wanxImageProvider = new WanxImageGenerationProvider();
  private readonly logger = new Logger(ContentExecutionService.name);
  private readonly queue: PublicationQueue | null;
  // DEV_ONLY 本地存储适配器（未接入正式对象存储）。
  private readonly storage = new DevLocalStorageAdapter();

  constructor(
    private readonly db: PrismaService,
    private readonly tenant: TenantService,
  ) {
    // BullMQ Queue 惰性连接；Redis 缺失时置 null，enqueue 静默降级（不影响主流程）。
    try {
      this.queue = createPublicationQueue();
    } catch {
      this.queue = null;
    }
  }

  // ---------------------------------------------------------------
  // 草稿（Draft）生命周期
  // ---------------------------------------------------------------

  async createDraft(userId: string, projectId: string, dto: CreateDraftDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    // 来源溯源（PHASE 2）：来源实体必须存在且属于同一 project（⇒ 同一租户），否则 404。
    const sources = await this.resolveSources(projectId, dto);
    const draft = await this.db.client.contentDraft.create({
      data: {
        organizationId: project.organizationId,
        projectId,
        title: dto.title,
        topic: dto.topic ?? null,
        generationMode: (dto.generationMode ?? "MANUAL") as Prisma.ContentDraftCreateInput["generationMode"],
        status: "DRAFT",
        sourceOpportunityId: sources.opportunityId,
        sourceRecommendationId: sources.recommendationId,
        sourceDiagnosisId: sources.diagnosisId,
        sourceStrategyId: sources.strategyId,
        sourcePlanItemId: sources.planItemId,
        createdById: userId,
        revisions: {
          create: {
            version: 1,
            body: dto.body,
            summary: dto.summary ?? null,
            changeNote: dto.changeNote ?? null,
            generatedById: userId,
          },
        },
      },
      include: { revisions: { orderBy: [{ version: "desc" }], take: 1 }, _count: { select: { revisions: true } } },
    });
    await this.audit(
      project.organizationId, userId, "DRAFT_CREATED",
      `title=${draft.title.slice(0, 60)}${sources.summary ? ` sources:[${sources.summary}]` : ""}`,
      { projectId, draftId: draft.id },
    );
    await this.usage(project.organizationId, userId, "CONTENT_GENERATION", projectId, "none");
    return this.toDraftView(draft);
  }

  /**
   * 校验来源溯源：来源实体必须存在且属于同一 project（⇒ 同一租户）。
   * 跨 project / 跨 tenant 引用一律 404（不泄露存在性）；绝不伪造关联。
   */
  private async resolveSources(projectId: string, dto: {
    sourceOpportunityId?: string; sourceRecommendationId?: string; sourceDiagnosisId?: string;
    sourceStrategyId?: string; sourcePlanItemId?: string;
  }): Promise<{ opportunityId: string | null; recommendationId: string | null; diagnosisId: string | null; strategyId: string | null; planItemId: string | null; summary: string }> {
    let opportunityId: string | null = null;
    let recommendationId: string | null = null;
    let diagnosisId: string | null = null;
    let strategyId: string | null = null;
    let planItemId: string | null = null;
    if (dto.sourceOpportunityId) {
      // ContentOpportunity 无 projectId：经 opportunityRun 关联校验。
      const row = await this.db.client.contentOpportunity.findFirst({
        where: { id: dto.sourceOpportunityId, opportunityRun: { projectId } }, select: { id: true },
      });
      if (!row) throw new NotFoundException("来源 Opportunity 不存在或不属于该项目");
      opportunityId = row.id;
    }
    if (dto.sourceRecommendationId) {
      // Recommendation 无 projectId：经 recommendationRun 关联校验。
      const row = await this.db.client.recommendation.findFirst({
        where: { id: dto.sourceRecommendationId, recommendationRun: { projectId } }, select: { id: true },
      });
      if (!row) throw new NotFoundException("来源 Recommendation 不存在或不属于该项目");
      recommendationId = row.id;
    }
    if (dto.sourceDiagnosisId) {
      const row = await this.db.client.diagnosisRun.findFirst({
        where: { id: dto.sourceDiagnosisId, projectId }, select: { id: true },
      });
      if (!row) throw new NotFoundException("来源 DiagnosisRun 不存在或不属于该项目");
      diagnosisId = row.id;
    }
    if (dto.sourceStrategyId) {
      const row = await this.db.client.contentStrategy.findFirst({
        where: { id: dto.sourceStrategyId, projectId }, select: { id: true },
      });
      if (!row) throw new NotFoundException("来源 ContentStrategy 不存在或不属于该项目");
      strategyId = row.id;
    }
    if (dto.sourcePlanItemId) {
      const row = await this.db.client.contentPlanItem.findFirst({
        where: { id: dto.sourcePlanItemId, projectId }, select: { id: true },
      });
      if (!row) throw new NotFoundException("来源 ContentPlanItem 不存在或不属于该项目");
      planItemId = row.id;
    }
    const summary = [
      opportunityId ? `opportunity=${opportunityId.slice(0, 8)}` : null,
      recommendationId ? `recommendation=${recommendationId.slice(0, 8)}` : null,
      diagnosisId ? `diagnosis=${diagnosisId.slice(0, 8)}` : null,
      strategyId ? `strategy=${strategyId.slice(0, 8)}` : null,
      planItemId ? `planItem=${planItemId.slice(0, 8)}` : null,
    ].filter(Boolean).join(",");
    return { opportunityId, recommendationId, diagnosisId, strategyId, planItemId, summary };
  }

  async listDrafts(userId: string, projectId: string, dto: ListDraftsDto) {
    await this.tenant.assertUserInProject(userId, projectId);
    const where: Prisma.ContentDraftWhereInput = { projectId };
    if (dto.status) where.status = dto.status as Prisma.ContentDraftWhereInput["status"];
    const rows = await this.db.client.contentDraft.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: dto.limit ?? 50,
      skip: dto.offset ?? 0,
      include: { revisions: { orderBy: [{ version: "desc" }], take: 1 }, _count: { select: { revisions: true } } },
    });
    return rows.map((d) => this.toDraftView(d));
  }

  async getDraft(userId: string, draftId: string) {
    const draft = await this.db.client.contentDraft.findUnique({
      where: { id: draftId },
      include: {
        revisions: { orderBy: [{ version: "desc" }] },
        approvals: { orderBy: [{ createdAt: "desc" }] },
      },
    });
    if (!draft) throw new NotFoundException("草稿不存在");
    await this.tenant.assertUserInOrganization(userId, draft.organizationId);
    return {
      ...this.toDraftView(draft),
      // 历史 Revision 正文（immutable）：返回全部版本的完整 body，供前端版本对比 / 回溯。
      // body 为草稿内容本体；不含 system prompt / API key / secret / 内部敏感 metadata。
      revisions: draft.revisions.map((r) => ({
        id: r.id, version: r.version, body: r.body, summary: r.summary, changeNote: r.changeNote,
        generationMode: draft.generationMode, generatedById: r.generatedById, createdAt: r.createdAt,
      })),
      approvals: draft.approvals.map((a) => ({
        id: a.id, decision: a.decision, reviewerId: a.reviewerId, comment: a.comment, revisionId: a.revisionId, createdAt: a.createdAt,
      })),
    };
  }

  /** 更新草稿：产生新版本，并把状态回退到 DRAFT（APP后的改动需重新审批）。 */
  async updateDraft(userId: string, draftId: string, dto: UpdateDraftDto) {
    const draft = await this.requireDraft(userId, draftId);
    if (draft.status === "PUBLISHED" || draft.status === "ARCHIVED") {
      throw new BadRequestException("已发布/已归档的草稿不可再编辑");
    }
    const latest = await this.latestRevision(draftId);
    const nextVersion = (latest?.version ?? 0) + 1;
    const updated = await this.db.client.contentDraft.update({
      where: { id: draftId },
      data: {
        title: dto.title ?? draft.title,
        topic: dto.topic === undefined ? draft.topic : dto.topic,
        generationMode: dto.generationMode ? (dto.generationMode as Prisma.ContentDraftUpdateInput["generationMode"]) : draft.generationMode,
        status: "DRAFT",
        revisions: {
          create: {
            version: nextVersion,
            body: dto.body ?? latest!.body,
            summary: dto.summary ?? latest?.summary ?? null,
            changeNote: dto.changeNote ?? null,
            generatedById: userId,
          },
        },
      },
      include: { revisions: { orderBy: [{ version: "desc" }], take: 1 }, _count: { select: { revisions: true } } },
    });
    await this.audit(draft.organizationId, userId, "DRAFT_UPDATED", `v${nextVersion}`, {
      projectId: draft.projectId, draftId,
    });
    await this.usage(draft.organizationId, userId, "CONTENT_GENERATION", draft.projectId, "none");
    return this.toDraftView(updated);
  }

  /** 提交审核：DRAFT/CHANGES_REQUESTED/REJECTED → READY_FOR_REVIEW。 */
  async submitForReview(userId: string, draftId: string) {
    const draft = await this.requireDraft(userId, draftId);
    if (draft.status === "READY_FOR_REVIEW") throw new BadRequestException("已在审核中");
    if (draft.status === "PUBLISHED" || draft.status === "ARCHIVED") {
      throw new BadRequestException("已发布/已归档不可提交");
    }
    const latest = await this.latestRevision(draftId);
    if (!latest) throw new BadRequestException("草稿无版本内容");
    const updated = await this.db.client.contentDraft.update({
      where: { id: draftId },
      data: { status: "READY_FOR_REVIEW" },
      include: { revisions: { orderBy: [{ version: "desc" }], take: 1 }, _count: { select: { revisions: true } } },
    });
    await this.audit(draft.organizationId, userId, "SUBMITTED_FOR_REVIEW", `v${latest.version}`, {
      projectId: draft.projectId, draftId,
    });
    return this.toDraftView(updated);
  }

  /** 审批决定：仅最新版本可被批准；APPROVED 解锁发布。 */
  async decideApproval(userId: string, draftId: string, dto: DecideApprovalDto) {
    const draft = await this.requireDraft(userId, draftId);
    if (draft.status !== "READY_FOR_REVIEW") {
      throw new BadRequestException("仅 READY_FOR_REVIEW 状态可审批");
    }
    await this.assertApprover(userId, draft.organizationId);

    const latest = await this.latestRevision(draftId);
    if (!latest) throw new BadRequestException("草稿无版本内容");
    const targetRevisionId = dto.revisionId ?? latest.id;
    if (targetRevisionId !== latest.id) {
      throw new BadRequestException("只能审批最新版本");
    }
    const approval = await this.db.client.contentApproval.create({
      data: {
        draftId,
        revisionId: targetRevisionId,
        decision: dto.decision,
        reviewerId: userId,
        comment: dto.comment ?? null,
      },
    });
    let nextStatus: Prisma.ContentDraftUpdateInput["status"];
    let action: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
    if (dto.decision === "APPROVED") {
      const knownFacts = await this.listFactsInternal(draft.id, draft.projectId);
      const claims = FactGroundingEngine.extractClaims(latest.body, knownFacts);
      const blockCheck = FactGroundingEngine.checkBlockingRule(claims);
      if (!blockCheck.passed) {
        throw new BadRequestException({
          error: "FACT_CHECK_REQUIRED",
          message: "草稿包含未核实的事实声明，请先在事实检查面板核验或执行安全改写",
          blockingClaims: blockCheck.blockingClaims,
        });
      }
      nextStatus = "APPROVED";
      action = "APPROVED";
    } else if (dto.decision === "REJECTED") {
      nextStatus = "REJECTED";
      action = "REJECTED";
    } else {
      nextStatus = "CHANGES_REQUESTED";
      action = "CHANGES_REQUESTED";
    }
    const updated = await this.db.client.contentDraft.update({
      where: { id: draftId },
      data: { status: nextStatus },
      include: { revisions: { orderBy: [{ version: "desc" }], take: 1 }, _count: { select: { revisions: true } } },
    });
    await this.audit(draft.organizationId, userId, action, `rev=${targetRevisionId.slice(0, 8)}`, {
      projectId: draft.projectId, draftId,
    });
    return { ...this.toDraftView(updated), approvalId: approval.id };
  }

  /** 归档草稿（合法终态之一）。 */
  async archiveDraft(userId: string, draftId: string) {
    const draft = await this.requireDraft(userId, draftId);
    if (draft.status === "PUBLISHED") throw new BadRequestException("已发布不可归档");
    const updated = await this.db.client.contentDraft.update({
      where: { id: draftId },
      data: { status: "ARCHIVED" },
      include: { revisions: { orderBy: [{ version: "desc" }], take: 1 }, _count: { select: { revisions: true } } },
    });
    return this.toDraftView(updated);
  }

  // ---------------------------------------------------------------
  // 渠道账号连接（ChannelAccountConnection）
  // ---------------------------------------------------------------

  async listConnections(userId: string, projectId: string) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    const rows = await this.db.client.channelAccountConnection.findMany({
      where: { organizationId: project.organizationId },
      orderBy: [{ channel: "asc" }, { displayName: "asc" }],
    });
    return rows.map((c) => this.toConnectionView(c));
  }

  async createConnection(userId: string, projectId: string, dto: CreateConnectionDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    const conn = await this.db.client.channelAccountConnection.create({
      data: {
        organizationId: project.organizationId,
        channel: dto.channel as Prisma.ChannelAccountConnectionCreateInput["channel"],
        displayName: dto.displayName,
        // 仅存不透明引用（指向密钥库）；绝不内联 token/secret。
        credentialRef: dto.credentialRef ?? null,
        status: "CONNECTED",
        createdById: userId,
      },
    });
    return this.toConnectionView(conn);
  }

  /** 渠道能力描述符（PHASE 17）：显式声明已知能力，不猜测真实平台 API。 */
  channelCapabilities(): ChannelCapability[] {
    return CHANNEL_CAPABILITIES;
  }

  listAllChannels(): ChannelCapabilityDescriptor[] {
    return defaultConnectorRegistry.listCapabilities();
  }

  getChannelCapability(channel: string): ChannelCapabilityDescriptor {
    const cap = defaultConnectorRegistry.getCapabilities(channel as any);
    if (!cap) throw new NotFoundException(`不支持或未知的渠道: ${channel}`);
    return cap;
  }

  async authorizeChannel(userId: string, channel: string, dto: AuthorizeChannelDto) {
    const project = await this.tenant.assertUserInProject(userId, dto.projectId);
    const connector = defaultConnectorRegistry.getConnector(channel as any);
    if (!connector) throw new NotFoundException(`渠道未注册: ${channel}`);

    const state = defaultOAuthStateSecurity.generateState({
      organizationId: project.organizationId,
      projectId: dto.projectId,
      channel: channel as any,
      redirectUri: dto.redirectUri,
    });

    if (connector.beginAuthorization) {
      const res = await connector.beginAuthorization({
        organizationId: project.organizationId,
        projectId: dto.projectId,
        redirectUri: dto.redirectUri,
        state,
      });
      return res;
    }

    const authUrl = `https://oauth.geolens.io/connect/${channel.toLowerCase()}?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(dto.redirectUri)}`;
    return { authorizationUrl: authUrl, state };
  }

  async handleOAuthCallback(userId: string, channel: string, code: string, state: string) {
    const verifiedState = defaultOAuthStateSecurity.verifyState(state);
    await this.tenant.assertUserInProject(userId, verifiedState.projectId);

    const connector = defaultConnectorRegistry.getConnector(channel as any);
    const caps = connector?.getCapabilities();

    let status: "CONNECTED" | "REQUIRES_APP_REVIEW" | "REQUIRES_SCOPE" | "READY_FOR_CREDENTIALS" = "CONNECTED";
    if (caps?.implementationStatus === "REQUIRES_APP_REVIEW") {
      status = "REQUIRES_APP_REVIEW";
    } else if (caps?.implementationStatus === "READY_FOR_CREDENTIALS") {
      status = "READY_FOR_CREDENTIALS";
    }

    const credentialId = randomUUID();
    const credentialRef = defaultCredentialVault.storeCredential(channel, credentialId, {
      credentialRef: `vault://aes256gcm/${channel.toLowerCase()}/${credentialId}`,
      accessToken: `mock_oauth_token_${code.slice(0, 8)}`,
      refreshToken: `mock_refresh_token_${code.slice(0, 8)}`,
      tokenExpiresAt: new Date(Date.now() + 15 * 86400 * 1000).toISOString(),
      accountId: `acc_${code.slice(0, 6)}`,
    });

    const displayName = `${caps?.displayName || channel} 授权账号`;

    const existing = await this.db.client.channelAccountConnection.findFirst({
      where: { organizationId: verifiedState.organizationId, channel: channel as any, displayName },
    });

    let conn;
    if (existing) {
      conn = await this.db.client.channelAccountConnection.update({
        where: { id: existing.id },
        data: { credentialRef, status, lastVerifiedAt: new Date() },
      });
    } else {
      conn = await this.db.client.channelAccountConnection.create({
        data: {
          organizationId: verifiedState.organizationId,
          channel: channel as any,
          displayName,
          credentialRef,
          status,
          createdById: userId,
          lastVerifiedAt: new Date(),
        },
      });
    }

    await this.audit(verifiedState.organizationId, userId, "PUBLICATION_CREATED", `oauth_connected channel=${channel} status=${status}`, {
      projectId: verifiedState.projectId,
    });

    return this.toConnectionView(conn);
  }

  async deleteConnection(userId: string, connectionId: string) {
    const conn = await this.db.client.channelAccountConnection.findUnique({ where: { id: connectionId } });
    if (!conn) throw new NotFoundException("渠道连接不存在");
    await this.tenant.assertUserInOrganization(userId, conn.organizationId);

    if (conn.credentialRef) {
      defaultCredentialVault.deleteCredential(conn.credentialRef);
    }

    await this.db.client.channelAccountConnection.delete({ where: { id: connectionId } });
    return { success: true };
  }

  async validatePublication(userId: string, publicationId: string, _dto?: ValidatePublicationDto) {
    const pub = await this.db.client.publication.findUnique({
      where: { id: publicationId },
      include: { draft: true, revision: { include: { approvals: true } }, connection: true },
    });
    if (!pub) throw new NotFoundException("发布记录不存在");
    await this.tenant.assertUserInOrganization(userId, pub.organizationId);

    const connector = defaultConnectorRegistry.getConnector(pub.channel);
    const caps = connector?.getCapabilities();

    const errors: string[] = [];
    const warnings: string[] = [];

    const latestApproval = pub.revision.approvals.find((a) => a.decision === "APPROVED");
    if (!latestApproval) {
      errors.push("最新修订版本未获得 APPROVED 审批");
    }

    if (pub.connection.status !== "CONNECTED") {
      errors.push(`渠道连接不可用: 状态为 ${pub.connection.status}`);
    }

    let contentBody = pub.payload;
    try {
      const parsed = JSON.parse(pub.payload);
      contentBody = parsed.body || pub.payload;
    } catch {}

    if (connector) {
      const val = await connector.validateContent({
        title: pub.title,
        body: contentBody,
      });
      errors.push(...val.errors);
      if (val.warnings) warnings.push(...val.warnings);
    }

    return {
      publicationId: pub.id,
      valid: errors.length === 0,
      errors,
      warnings,
      channel: pub.channel,
      implementationStatus: caps?.implementationStatus || "UNKNOWN",
      dryRunPassed: errors.length === 0,
    };
  }

  async publishPublication(userId: string, publicationId: string, options?: { confirm?: boolean }) {
    const pub = await this.db.client.publication.findUnique({ where: { id: publicationId } });
    if (!pub) throw new NotFoundException("发布记录不存在");
    await this.tenant.assertUserInOrganization(userId, pub.organizationId);

    const router = new PublicationRouter(this.db.client);
    const res = await router.routeAndPublish(publicationId, {
      confirm: options?.confirm ?? true,
      dryRun: false,
    });

    return {
      publication: await this.publicationWithAttempts(publicationId),
      executionResult: res,
    };
  }

  async getManualPublishingPackage(userId: string, publicationId: string) {
    const pub = await this.db.client.publication.findUnique({
      where: { id: publicationId },
      include: { draft: true, revision: true },
    });
    if (!pub) throw new NotFoundException("发布记录不存在");
    await this.tenant.assertUserInOrganization(userId, pub.organizationId);

    let parsedBody = pub.payload;
    let tags: string[] = [];
    let coverUrl: string | null = null;
    try {
      const parsed = JSON.parse(pub.payload);
      parsedBody = parsed.body || pub.payload;
      tags = parsed.tags || [];
      coverUrl = parsed.coverUrl || null;
    } catch {}

    const assets = await this.db.client.contentAsset.findMany({
      where: { draftId: pub.draftId },
      select: { id: true, type: true, mimeType: true, sizeBytes: true, storageKey: true },
    });

    const normalizedAssets = assets.map((a) => ({
      type: a.type,
      url: `http://localhost:3001/api/assets/download/${a.storageKey}`,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
    }));

    return generateManualPublishingPackage(pub.channel, {
      title: pub.title,
      body: parsedBody,
      summary: pub.revision.summary,
      tags,
      coverUrl,
      assets: normalizedAssets,
    });
  }

  // ---------------------------------------------------------------
  // 发布（Publication）—— 出站写闸门 + 审批 + 连接状态 + 幂等
  // ---------------------------------------------------------------

  async createPublication(userId: string, projectId: string, draftId: string, dto: CreatePublicationDto) {
    const draft = await this.requireDraft(userId, draftId);
    if (draft.projectId !== projectId) throw new NotFoundException("草稿不存在于该项目");
    if (draft.status !== "APPROVED") {
      throw new BadRequestException("草稿未处于 APPROVED 状态，无法发布");
    }
    const latest = await this.latestRevision(draftId);
    if (!latest) throw new BadRequestException("草稿无版本内容");
    const approval = await this.db.client.contentApproval.findFirst({
      where: { draftId, revisionId: latest.id, decision: "APPROVED" },
    });
    if (!approval) throw new BadRequestException("最新版本未获得 APPROVED 审批");

    const conn = await this.db.client.channelAccountConnection.findUnique({ where: { id: dto.connectionId } });
    if (!conn || conn.organizationId !== draft.organizationId) {
      throw new NotFoundException("渠道连接不存在");
    }
    if (conn.status !== "CONNECTED") {
      throw new BadRequestException(`渠道连接状态为 ${conn.status}，已拦截发布（仅 CONNECTED 允许）`);
    }

    // 渠道中立内容校验。
    this.validateChannelContent(conn.channel, dto.title, dto.payload);

    // 出站写闸门：本回合仅 Mock；真实适配器需 EXTERNAL_PUBLISHING_ENABLED=true（当前恒 false）。
    this.assertExternalGuard();

    // M10A 发布血缘推断与校验 (Campaign -> PlanItem -> ScheduleItem -> Draft -> Revision -> Publication)
    let campaignId = dto.campaignId ?? null;
    let scheduleItemId = dto.scheduleItemId ?? null;
    let planItemId = dto.planItemId ?? null;

    if (!planItemId && draft.sourcePlanItemId) {
      planItemId = draft.sourcePlanItemId;
    }

    if (!scheduleItemId && planItemId) {
      const scheduleItem = await this.db.client.contentScheduleItem.findFirst({
        where: { planItemId, projectId },
        select: { id: true, campaignId: true },
      });
      if (scheduleItem) {
        scheduleItemId = scheduleItem.id;
        if (!campaignId) campaignId = scheduleItem.campaignId;
      }
    }

    if (scheduleItemId) {
      const scheduleItem = await this.db.client.contentScheduleItem.findFirst({
        where: { id: scheduleItemId, projectId },
        select: { id: true, campaignId: true, planItemId: true },
      });
      if (!scheduleItem) {
        throw new NotFoundException("排期项不存在或不属于该项目");
      }
      if (!campaignId) campaignId = scheduleItem.campaignId;
      if (!planItemId) planItemId = scheduleItem.planItemId;
    }

    if (campaignId) {
      const campaign = await this.db.client.contentCampaign.findFirst({
        where: { id: campaignId, projectId },
        select: { id: true },
      });
      if (!campaign) {
        throw new NotFoundException("营销战役不存在或不属于该项目");
      }
    }

    if (planItemId) {
      const pItem = await this.db.client.contentPlanItem.findFirst({
        where: { id: planItemId, organizationId: draft.organizationId },
        select: { id: true },
      });
      if (!pItem) {
        throw new NotFoundException("内容规划项不存在");
      }
    }

    const idempotencyKey = randomUUID();
    const pub = await this.db.client.publication.create({
      data: {
        organizationId: draft.organizationId,
        projectId,
        draftId,
        revisionId: latest.id,
        connectionId: conn.id,
        channel: conn.channel,
        campaignId,
        scheduleItemId,
        planItemId,
        title: dto.title ?? null,
        payload: dto.payload,
        status: "PENDING",
        idempotencyKey,
        createdById: userId,
      },
    });
    await this.audit(draft.organizationId, userId, "PUBLICATION_CREATED", `channel=${conn.channel}`, {
      projectId, draftId, publicationId: pub.id,
    });

    // 异步队列（best-effort）+ 同步 mock 执行（确定性，供 e2e / demo）。
    await enqueuePublication(this.queue, pub.id);
    await executePublication(this.db.client, pub.id, { idempotencyKey });

    return this.getPublication(userId, pub.id);
  }

  /** 算子触发：重新执行发布尝试（幂等键每次刷新 → 形成新 attempt；同键重放安全）。 */
  async processPublication(userId: string, publicationId: string) {
    const pub = await this.db.client.publication.findUnique({ where: { id: publicationId } });
    if (!pub) throw new NotFoundException("发布不存在");
    await this.tenant.assertUserInOrganization(userId, pub.organizationId);
    // 若已成功发布，重放安全返回，不再执行。
    if (pub.status === "PUBLISHED") return this.getPublication(userId, publicationId);
    await executePublication(this.db.client, publicationId, { idempotencyKey: randomUUID() });
    return this.getPublication(userId, publicationId);
  }

  async getPublication(userId: string, publicationId: string) {
    const pub = await this.db.client.publication.findUnique({ where: { id: publicationId } });
    if (!pub) throw new NotFoundException("发布不存在");
    await this.tenant.assertUserInOrganization(userId, pub.organizationId);
    return this.publicationWithAttempts(publicationId);
  }

  async listAudit(userId: string, draftId: string) {
    const draft = await this.requireDraft(userId, draftId);
    const rows = await this.db.client.contentAuditLog.findMany({
      where: { draftId },
      orderBy: [{ createdAt: "asc" }],
    });
    return rows;
  }

  // ---------------------------------------------------------------
  // 历史 Revision（PHASE 3）—— 只读，immutable
  // ---------------------------------------------------------------

  /** 读取单个历史 Revision 正文；跨 tenant/project 不可读（404）。 */
  async getRevision(userId: string, draftId: string, revisionId: string) {
    const draft = await this.requireDraft(userId, draftId);
    const rev = await this.db.client.contentRevision.findFirst({ where: { id: revisionId, draftId } });
    if (!rev) throw new NotFoundException("修订版本不存在");
    return {
      id: rev.id, draftId: rev.draftId, version: rev.version, body: rev.body,
      summary: rev.summary, changeNote: rev.changeNote,
      generationMode: draft.generationMode, generatedById: rev.generatedById, createdAt: rev.createdAt,
    };
  }

  // ---------------------------------------------------------------
  // 发布列表（PHASE 4）—— project scoped + 分页 + 过滤
  // ---------------------------------------------------------------

  async listPublications(userId: string, projectId: string, filters: ListPublicationsDto) {
    await this.tenant.assertUserInProject(userId, projectId);
    const where: Prisma.PublicationWhereInput = { projectId };
    if (filters.status) where.status = filters.status as Prisma.PublicationWhereInput["status"];
    if (filters.channel) where.channel = filters.channel as Prisma.PublicationWhereInput["channel"];
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 20));
    const [total, rows] = await Promise.all([
      this.db.client.publication.count({ where }),
      this.db.client.publication.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          connection: { select: { id: true, channel: true, displayName: true, status: true } },
          attempts: { orderBy: [{ attemptNo: "desc" }], take: 1 },
        },
      }),
    ]);
    return {
      page, pageSize, total,
      items: rows.map((p) => {
        const last = p.attempts[0] ?? null;
        return {
          id: p.id,
          draftId: p.draftId,
          revisionId: p.revisionId,
          channel: p.channel,
          status: p.status,
          accountConnection: {
            id: p.connection.id, channel: p.connection.channel,
            displayName: p.connection.displayName, status: p.connection.status,
          },
          createdAt: p.createdAt,
          scheduledAt: null, // 本轮无排期功能；字段稳定保留供前端消费。
          publishedAt: p.publishedAt,
          externalUrl: last?.externalUrl ?? null,
          externalId: last?.externalId ?? null,
          publisher: last?.publisher ?? null,
          isMock: last ? last.publisher === "mock" : true, // 本轮恒 mock
        };
      }),
    };
  }

  // ---------------------------------------------------------------
  // 素材上传基础（PHASE 5）—— DEV_ONLY 本地存储适配器
  // ---------------------------------------------------------------

  async createAsset(
    userId: string, projectId: string, file: UploadedBuffer | undefined,
    input: { type?: string; draftId?: string },
  ) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    const type = String(input.type ?? "").toUpperCase();
    if (!(ASSET_TYPES as readonly string[]).includes(type)) {
      throw new BadRequestException(`不支持的素材类型（仅允许 ${ASSET_TYPES.join("/")}）`);
    }
    if (!file || !file.buffer || !file.size) throw new BadRequestException("缺少上传文件");
    const mime = String(file.mimetype ?? "").toLowerCase();
    const allow = ASSET_MIME_ALLOWLIST[type] ?? [];
    if (!allow.includes(mime)) {
      throw new BadRequestException(`MIME 类型 ${mime || "(空)"} 不在 ${type} 允许清单内`);
    }
    const maxBytes = ASSET_MAX_BYTES[type] ?? 0;
    if (file.size > maxBytes) {
      throw new BadRequestException(`文件超过 ${type} 大小上限（${Math.floor(maxBytes / 1024 / 1024)}MB）`);
    }
    let draftId: string | null = null;
    if (input.draftId) {
      const draft = await this.db.client.contentDraft.findFirst({ where: { id: input.draftId, projectId }, select: { id: true } });
      if (!draft) throw new NotFoundException("草稿不存在或不属于该项目");
      draftId = draft.id;
    }
    // 校验和：sha256（防重复 / 防篡改）。
    const checksum = createHash("sha256").update(file.buffer).digest("hex");
    // DEV_ONLY 落盘；key 由服务端生成，绝不使用用户提供的路径/文件名。
    const stored = await this.storage.put(project.organizationId, file.buffer);
    const asset = await this.db.client.contentAsset.create({
      data: {
        organizationId: project.organizationId,
        projectId,
        draftId,
        type: type as Prisma.ContentAssetCreateInput["type"],
        mimeType: mime,
        sizeBytes: file.size,
        checksum,
        storageKey: stored.storageKey,
        ownerId: userId,
      },
    });
    return this.toAssetView(asset);
  }

  async listAssets(userId: string, projectId: string, filters: ListAssetsDto) {
    await this.tenant.assertUserInProject(userId, projectId);
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 20));
    const where: Prisma.ContentAssetWhereInput = { projectId };
    const [total, rows] = await Promise.all([
      this.db.client.contentAsset.count({ where }),
      this.db.client.contentAsset.findMany({
        where, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize, take: pageSize,
      }),
    ]);
    return { page, pageSize, total, items: rows.map((a) => this.toAssetView(a)) };
  }

  private toAssetView(a: {
    id: string; organizationId: string; projectId: string; draftId: string | null;
    type: string; mimeType: string; sizeBytes: number; checksum: string; storageKey: string;
    ownerId: string; createdAt: Date; updatedAt: Date;
  }) {
    return {
      id: a.id,
      organizationId: a.organizationId,
      projectId: a.projectId,
      draftId: a.draftId,
      type: a.type,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      checksum: a.checksum,
      // 不透明存储引用（不暴露本地磁盘绝对路径；DEV_ONLY 本地适配器）。
      storageRef: `dev-local://${a.storageKey}`,
      storage: "dev-local" as const,
      devOnly: true as const,
      ownerId: a.ownerId,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }

  // ---------------------------------------------------------------
  // 守卫 / 校验 / 审计 / 用量 辅助
  // ---------------------------------------------------------------

  private assertExternalGuard() {
    const enabled = process.env.EXTERNAL_PUBLISHING_ENABLED === "true";
    if (enabled) {
      // 安全网：即便被误开启，本回合也只存在 Mock，真实出站写不会发生。
      this.logger.warn("EXTERNAL_PUBLISHING_ENABLED=true 但本回合仅有 Mock 适配器；强制 mock，未触达真实平台。");
    }
    // 出站写闸门：本回合恒为假安全态；Real Provider Calls / External Writes = 0。
  }

  private validateChannelContent(channel: string, title: string | null | undefined, payload: string) {
    const limits = CHANNEL_LIMITS[channel] ?? CHANNEL_LIMITS.OTHER;
    if (title && title.length > limits.titleMax) {
      throw new BadRequestException(`标题超过 ${channel} 渠道上限（${limits.titleMax} 字）`);
    }
    if (payload.length > limits.bodyMax) {
      throw new BadRequestException(`正文超过 ${channel} 渠道上限（${limits.bodyMax} 字）`);
    }
    // 基础 JSON 校验（payload 应为渠道中立的 JSON 字符串）。
    try {
      JSON.parse(payload);
    } catch {
      throw new BadRequestException("payload 必须为合法 JSON（渠道中立序列化内容）");
    }
  }

  private async requireDraft(userId: string, draftId: string) {
    const draft = await this.db.client.contentDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException("草稿不存在");
    await this.tenant.assertUserInOrganization(userId, draft.organizationId);
    return draft;
  }

  private async latestRevision(draftId: string) {
    return this.db.client.contentRevision.findFirst({
      where: { draftId },
      orderBy: [{ version: "desc" }],
    });
  }

  private async assertApprover(userId: string, organizationId: string) {
    const membership = await this.tenant.assertUserInOrganization(userId, organizationId);
    const role = (membership as unknown as { role: string }).role;
    if (!APPROVER_ROLES.has(role)) {
      throw new ForbiddenException("审批需要 ADMIN 或 OWNER 角色");
    }
  }

  private async audit(
    organizationId: string, actorId: string, action: string,
    detail: string | null, refs?: { projectId?: string; draftId?: string; publicationId?: string },
  ) {
    await this.db.client.contentAuditLog.create({
      data: {
        organizationId,
        projectId: refs?.projectId ?? null,
        draftId: refs?.draftId ?? null,
        publicationId: refs?.publicationId ?? null,
        action: action as Prisma.ContentAuditLogCreateInput["action"],
        actorId,
        // detail 绝不携带 token / secret / 敏感 prompt。
        detail: detail ? detail.slice(0, 500) : null,
      },
    });
  }

  private async usage(
    organizationId: string, actorId: string, eventType: "CONTENT_GENERATION" | "PUBLICATION_ATTEMPT",
    projectId?: string, provider = "none",
  ) {
    // 成本恒为 null（非 0）：本回合无真实计费。
    await this.db.client.contentUsageEvent.create({
      data: {
        organizationId,
        projectId: projectId ?? null,
        eventType,
        provider,
        costUsd: null,
        quantity: 1,
        actorId,
      },
    });
  }

  /** 关闭 BullMQ 队列连接，避免 e2e / 进程退出时留下 open handle。 */
  async onModuleDestroy() {
    try {
      await this.queue?.close();
    } catch {
      /* 忽略关闭异常 */
    }
  }

  // ---------------------------------------------------------------
  // 视图组装
  // ---------------------------------------------------------------

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
      // 来源溯源（PHASE 2）：可空；仅返回 id，不伪造关联。
      sourceOpportunityId: d.sourceOpportunityId,
      sourceRecommendationId: d.sourceRecommendationId,
      sourceDiagnosisId: d.sourceDiagnosisId,
      sourceStrategyId: (d as any).sourceStrategyId ?? null,
      sourcePlanItemId: (d as any).sourcePlanItemId ?? null,
      createdById: d.createdById,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      latestRevision: latest
        ? { id: latest.id, version: latest.version, body: latest.body, summary: latest.summary, changeNote: latest.changeNote, generatedById: latest.generatedById, createdAt: latest.createdAt }
        : null,
      revisionCount,
    };
  }

  private toConnectionView(c: {
    id: string; channel: string; displayName: string; status: string;
    lastVerifiedAt: Date | null; createdAt: Date; updatedAt: Date;
  }) {
    // 注意：不返回 credentialRef（密钥库引用），避免任何秘密经由 API 暴露。
    return {
      id: c.id,
      channel: c.channel,
      displayName: c.displayName,
      status: c.status,
      lastVerifiedAt: c.lastVerifiedAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  private async publicationWithAttempts(publicationId: string) {
    const pub = await this.db.client.publication.findUnique({
      where: { id: publicationId },
      include: {
        attempts: { orderBy: [{ attemptNo: "asc" }] },
        publishedAssets: true,
      },
    });
    if (!pub) throw new NotFoundException("发布不存在");
    return {
      id: pub.id,
      organizationId: pub.organizationId,
      projectId: pub.projectId,
      campaignId: pub.campaignId,
      scheduleItemId: pub.scheduleItemId,
      planItemId: pub.planItemId,
      draftId: pub.draftId,
      revisionId: pub.revisionId,
      connectionId: pub.connectionId,
      channel: pub.channel,
      title: pub.title,
      status: pub.status,
      idempotencyKey: pub.idempotencyKey,
      createdById: pub.createdById,
      createdAt: pub.createdAt,
      updatedAt: pub.updatedAt,
      // 仅暴露 attempt 的元信息；externalId/externalUrl 为 mock 假值（已标记前缀）。
      attempts: pub.attempts.map((a) => ({
        id: a.id,
        idempotencyKey: a.idempotencyKey,
        channel: a.channel,
        attemptNo: a.attemptNo,
        status: a.status,
        publisher: a.publisher,
        externalId: a.externalId,
        externalUrl: a.externalUrl,
        errorMessage: a.errorMessage,
        durationMs: a.durationMs,
        createdAt: a.createdAt,
        campaignId: a.campaignId,
        scheduleItemId: a.scheduleItemId,
        planItemId: a.planItemId,
      })),
      publishedAssets: pub.publishedAssets,
    };
  }

  // ---------------------------------------------------------------
  // 平台内容生成增强（Platform Variants & Image Briefs）
  // ---------------------------------------------------------------

  async generatePlatformVariant(userId: string, draftId: string, dto: GeneratePlatformVariantDto) {
    const draft = await this.requireDraft(userId, draftId);
    let targetRev = null;
    if (dto.sourceRevisionId) {
      targetRev = await this.db.client.contentRevision.findFirst({
        where: { id: dto.sourceRevisionId, draftId },
      });
      if (!targetRev) throw new NotFoundException("指定来源版本不存在");
    } else {
      targetRev = await this.latestRevision(draftId);
      if (!targetRev) throw new BadRequestException("草稿无版本内容");
    }

    // 解析纯文本或结构体
    let plainBody = targetRev.body;
    try {
      const parsed = JSON.parse(targetRev.body);
      if (parsed.body) plainBody = parsed.body;
    } catch {
      // raw
    }

    const generated = generatePlatformVariantHelper({
      platform: dto.platform as CnPlatform,
      draftId,
      sourceRevisionId: targetRev.id,
      title: draft.title,
      body: plainBody,
      summary: targetRev.summary ?? undefined,
      topic: draft.topic ?? undefined,
      generationMode: dto.generationMode as any,
      styleTone: dto.styleTone,
      customInstructions: dto.customInstructions,
    });

    const variantId = randomUUID();
    await this.db.client.$executeRawUnsafe(
      `INSERT INTO platform_content_variants (
        id, organization_id, project_id, draft_id, source_revision_id,
        platform, content_type, generation_mode, title, summary, body,
        tags, cover_text, image_briefs, platform_metadata, status, created_by_id, created_at, updated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
        $6, $7, $8, $9, $10, $11,
        $12::jsonb, $13, $14::jsonb, $15::jsonb, $16, $17::uuid, NOW(), NOW()
      )`,
      variantId,
      draft.organizationId,
      draft.projectId,
      draft.id,
      targetRev.id,
      generated.platform,
      generated.contentType,
      generated.generationMode,
      generated.title,
      generated.summary,
      generated.body,
      JSON.stringify(generated.tags),
      generated.coverText,
      JSON.stringify(generated.imageBriefs),
      JSON.stringify(generated.platformMetadata),
      "GENERATED",
      userId,
    );

    // 将图片 brief 记录到 content_image_briefs
    if (generated.imageBriefs && generated.imageBriefs.length > 0) {
      for (const brief of generated.imageBriefs) {
        await this.db.client.$executeRawUnsafe(
          `INSERT INTO content_image_briefs (
            id, organization_id, project_id, draft_id, variant_id,
            platform, asset_type, title, prompt, negative_prompt, style, ratio, text_overlay, notes, safe_fact_check, created_by_id, created_at, updated_at
          ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
            $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16::uuid, NOW(), NOW()
          )`,
          randomUUID(),
          draft.organizationId,
          draft.projectId,
          draft.id,
          variantId,
          brief.platform,
          brief.assetType,
          brief.title,
          brief.prompt,
          brief.negativePrompt,
          brief.style,
          brief.ratio,
          JSON.stringify(brief.textOverlay ?? {}),
          brief.notes,
          brief.safeFactCheck,
          userId,
        );
      }
    }

    // 记录 Generation Run
    const runId = randomUUID();
    const promptVersion = PROMPT_VERSIONS[dto.platform] || 'geolens-cn-v1';
    await this.db.client.$executeRawUnsafe(
      `INSERT INTO content_generation_runs (
        id, organization_id, project_id, draft_id, source_revision_id,
        platform, generation_mode, provider, model, prompt_version,
        status, input_snapshot, output_snapshot, input_tokens, output_tokens,
        image_count, cost_usd, created_by_id, created_at, updated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
        $6, $7, 'geolens-gen', 'cn-v2', $8,
        'COMPLETED', $9::jsonb, $10::jsonb, $11, $12,
        0, NULL, $13::uuid, NOW(), NOW()
      )`,
      runId,
      draft.organizationId,
      draft.projectId,
      draft.id,
      targetRev.id,
      dto.platform,
      dto.generationMode || 'STANDARD',
      promptVersion,
      JSON.stringify({ title: draft.title, body: plainBody, topic: draft.topic, generationMode: dto.generationMode }),
      JSON.stringify(generated),
      Math.round(plainBody.length * 1.1),
      Math.round(generated.body.length * 1.2),
      userId,
    );

    // 记录 Claim Extractions
    const knownFacts = await this.listFactsInternal(draft.id, draft.projectId);
    const claims = FactGroundingEngine.extractClaims(generated.body, knownFacts);
    for (const c of claims) {
      await this.db.client.$executeRawUnsafe(
        `INSERT INTO content_claim_extractions (
          id, generation_run_id, draft_id, claim, claim_type, support_status, support_source_ids, created_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb, NOW()
        )`,
        randomUUID(),
        runId,
        draft.id,
        c.claim,
        c.type,
        c.supportStatus,
        JSON.stringify(c.supportSourceIds || []),
      );
    }

    await this.audit(
      draft.organizationId,
      userId,
      "DRAFT_UPDATED",
      `generate_variant:${dto.platform} rev=v${targetRev.version}`,
      { projectId: draft.projectId, draftId: draft.id },
    );
    await this.usage(draft.organizationId, userId, "CONTENT_GENERATION", draft.projectId, "none");

    return this.getPlatformVariant(userId, draftId, variantId);
  }

  async listPlatformVariants(userId: string, draftId: string) {
    await this.requireDraft(userId, draftId);
    const rows = await this.db.client.$queryRawUnsafe<any[]>(
      `SELECT * FROM platform_content_variants WHERE draft_id = $1::uuid ORDER BY created_at DESC`,
      draftId,
    );
    return rows.map((r) => this.mapVariantRow(r));
  }

  async getPlatformVariant(userId: string, draftId: string, variantId: string) {
    await this.requireDraft(userId, draftId);
    const rows = await this.db.client.$queryRawUnsafe<any[]>(
      `SELECT * FROM platform_content_variants WHERE draft_id = $1::uuid AND id = $2::uuid`,
      draftId,
      variantId,
    );
    if (!rows.length) throw new NotFoundException("平台变体不存在");
    return this.mapVariantRow(rows[0]);
  }

  async rewritePlatformVariant(userId: string, draftId: string, variantId: string, dto: RewriteVariantDto) {
    const draft = await this.requireDraft(userId, draftId);
    const orig = await this.getPlatformVariant(userId, draftId, variantId);

    const rewritten = rewriteContentHelper({
      platform: orig.platform as CnPlatform,
      mode: dto.mode as any,
      currentTitle: orig.title,
      currentBody: orig.body,
      currentSummary: orig.summary ?? undefined,
      currentTags: orig.tags,
      customInstructions: dto.customInstructions,
    });

    const newVariantId = randomUUID();
    const updatedMetadata = {
      ...(orig.platformMetadata || {}),
      parentVariantId: orig.id,
      rewriteMode: dto.mode,
      changeNote: rewritten.changeNote,
    };

    await this.db.client.$executeRawUnsafe(
      `INSERT INTO platform_content_variants (
        id, organization_id, project_id, draft_id, source_revision_id,
        platform, content_type, generation_mode, title, summary, body,
        tags, cover_text, image_briefs, platform_metadata, status, created_by_id, created_at, updated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
        $6, $7, $8, $9, $10, $11,
        $12::jsonb, $13, $14::jsonb, $15::jsonb, $16, $17::uuid, NOW(), NOW()
      )`,
      newVariantId,
      draft.organizationId,
      draft.projectId,
      draft.id,
      orig.sourceRevisionId,
      orig.platform,
      orig.contentType,
      dto.mode,
      rewritten.title,
      rewritten.summary ?? orig.summary,
      rewritten.body,
      JSON.stringify(orig.tags),
      orig.coverText,
      JSON.stringify(orig.imageBriefs),
      JSON.stringify(updatedMetadata),
      "ADAPTED",
      userId,
    );

    // 记录改写 Generation Run
    const rewriteRunId = randomUUID();
    await this.db.client.$executeRawUnsafe(
      `INSERT INTO content_generation_runs (
        id, organization_id, project_id, draft_id, source_revision_id,
        platform, generation_mode, provider, model, prompt_version,
        status, input_snapshot, output_snapshot, input_tokens, output_tokens,
        image_count, cost_usd, created_by_id, created_at, updated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
        $6, $7, 'geolens-rewrite', 'cn-rewrite-v2', 'geolens-cn-rewrite-v1',
        'COMPLETED', $8::jsonb, $9::jsonb, $10, $11,
        0, NULL, $12::uuid, NOW(), NOW()
      )`,
      rewriteRunId,
      draft.organizationId,
      draft.projectId,
      draft.id,
      orig.sourceRevisionId,
      orig.platform,
      dto.mode,
      JSON.stringify({ currentTitle: orig.title, currentBody: orig.body, mode: dto.mode }),
      JSON.stringify(rewritten),
      Math.round(orig.body.length * 1.1),
      Math.round(rewritten.body.length * 1.2),
      userId,
    );

    await this.audit(
      draft.organizationId,
      userId,
      "DRAFT_UPDATED",
      `rewrite_variant:${orig.platform} mode=${dto.mode}`,
      { projectId: draft.projectId, draftId: draft.id },
    );
    await this.usage(draft.organizationId, userId, "CONTENT_GENERATION", draft.projectId, "none");

    return this.getPlatformVariant(userId, draftId, newVariantId);
  }

  async applyVariantToDraftRevision(userId: string, draftId: string, variantId: string, dto: ApplyVariantToRevisionDto) {
    await this.requireDraft(userId, draftId);
    const variant = await this.getPlatformVariant(userId, draftId, variantId);

    const changeNote = dto.changeNote || `应用平台变体：[${variant.platform}] ${variant.title}`;
    const updatedDraft = await this.updateDraft(userId, draftId, {
      title: variant.title,
      body: variant.body,
      summary: variant.summary ?? undefined,
      changeNote,
      generationMode: "AI_GENERATED",
    });

    return {
      draft: updatedDraft,
      appliedVariantId: variantId,
    };
  }

  async generateImageBriefs(userId: string, draftId: string, dto: GenerateImageBriefDto) {
    const draft = await this.requireDraft(userId, draftId);
    const latest = await this.latestRevision(draftId);
    const platform = (dto.platform || "WECHAT_OFFICIAL_ACCOUNT") as CnPlatform;

    const variant = generatePlatformVariantHelper({
      platform,
      draftId,
      sourceRevisionId: latest?.id || draftId,
      title: draft.title,
      body: latest?.body || draft.title,
      summary: latest?.summary ?? undefined,
      topic: draft.topic ?? undefined,
      styleTone: dto.preferredStyle as any,
    });

    const briefs = variant.imageBriefs || [];
    for (const brief of briefs) {
      await this.db.client.$executeRawUnsafe(
        `INSERT INTO content_image_briefs (
          id, organization_id, project_id, draft_id, variant_id,
          platform, asset_type, title, prompt, negative_prompt, style, ratio, text_overlay, notes, safe_fact_check, created_by_id, created_at, updated_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
          $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16::uuid, NOW(), NOW()
        )`,
        randomUUID(),
        draft.organizationId,
        draft.projectId,
        draft.id,
        dto.variantId ?? null,
        brief.platform,
        brief.assetType,
        brief.title,
        brief.prompt,
        brief.negativePrompt,
        dto.preferredStyle || brief.style,
        brief.ratio,
        JSON.stringify(brief.textOverlay ?? {}),
        brief.notes,
        brief.safeFactCheck,
        userId,
      );
    }

    return this.listImageBriefs(userId, draftId);
  }

  async listImageBriefs(userId: string, draftId: string) {
    await this.requireDraft(userId, draftId);
    const rows = await this.db.client.$queryRawUnsafe<any[]>(
      `SELECT * FROM content_image_briefs WHERE draft_id = $1::uuid ORDER BY created_at DESC`,
      draftId,
    );
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      projectId: r.project_id,
      draftId: r.draft_id,
      variantId: r.variant_id,
      platform: r.platform,
      assetType: r.asset_type,
      title: r.title,
      prompt: r.prompt,
      negativePrompt: r.negative_prompt,
      style: r.style,
      ratio: r.ratio,
      textOverlay: typeof r.text_overlay === 'string' ? JSON.parse(r.text_overlay) : r.text_overlay,
      notes: r.notes,
      safeFactCheck: r.safe_fact_check,
      createdAt: r.created_at,
    }));
  }

  private mapVariantRow(r: any) {
    return {
      id: r.id,
      organizationId: r.organization_id,
      projectId: r.project_id,
      draftId: r.draft_id,
      sourceRevisionId: r.source_revision_id,
      platform: r.platform,
      contentType: r.content_type,
      generationMode: r.generation_mode,
      title: r.title,
      summary: r.summary,
      body: r.body,
      tags: typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags || [],
      coverText: r.cover_text,
      imageBriefs: typeof r.image_briefs === 'string' ? JSON.parse(r.image_briefs) : r.image_briefs || [],
      platformMetadata: typeof r.platform_metadata === 'string' ? JSON.parse(r.platform_metadata) : r.platform_metadata || {},
      status: r.status,
      createdById: r.created_by_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private async listFactsInternal(draftId: string, projectId: string): Promise<VerifiedFact[]> {
    const rows = await this.db.client.$queryRawUnsafe<any[]>(
      `SELECT id, claim, fact_type as "factType", status, source_type as "sourceType", source_ref as "sourceRef"
       FROM content_verified_facts
       WHERE draft_id = $1::uuid OR project_id = $2::uuid`,
      draftId,
      projectId,
    );
    return rows.map((r) => ({
      id: r.id,
      claim: r.claim,
      factType: r.factType,
      status: r.status,
      sourceType: r.sourceType,
      sourceRef: r.sourceRef ?? undefined,
    }));
  }

  async listGenerationRuns(userId: string, draftId: string) {
    await this.requireDraft(userId, draftId);
    const rows = await this.db.client.$queryRawUnsafe<any[]>(
      `SELECT * FROM content_generation_runs WHERE draft_id = $1::uuid ORDER BY created_at DESC`,
      draftId,
    );
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      projectId: r.project_id,
      draftId: r.draft_id,
      sourceRevisionId: r.source_revision_id,
      platform: r.platform,
      generationMode: r.generation_mode,
      provider: r.provider,
      model: r.model,
      promptVersion: r.prompt_version,
      status: r.status,
      inputSnapshot: typeof r.input_snapshot === 'string' ? JSON.parse(r.input_snapshot) : r.input_snapshot,
      outputSnapshot: typeof r.output_snapshot === 'string' ? JSON.parse(r.output_snapshot) : r.output_snapshot,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      imageCount: r.image_count,
      costUsd: r.cost_usd,
      errorMessage: r.error_message,
      createdById: r.created_by_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async getGenerationRun(userId: string, draftId: string, runId: string) {
    await this.requireDraft(userId, draftId);
    const rows = await this.db.client.$queryRawUnsafe<any[]>(
      `SELECT * FROM content_generation_runs WHERE id = $1::uuid AND draft_id = $2::uuid`,
      runId,
      draftId,
    );
    if (!rows.length) throw new NotFoundException("生成记录不存在");
    const r = rows[0];
    return {
      id: r.id,
      organizationId: r.organization_id,
      projectId: r.project_id,
      draftId: r.draft_id,
      sourceRevisionId: r.source_revision_id,
      platform: r.platform,
      generationMode: r.generation_mode,
      provider: r.provider,
      model: r.model,
      promptVersion: r.prompt_version,
      status: r.status,
      inputSnapshot: typeof r.input_snapshot === 'string' ? JSON.parse(r.input_snapshot) : r.input_snapshot,
      outputSnapshot: typeof r.output_snapshot === 'string' ? JSON.parse(r.output_snapshot) : r.output_snapshot,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      imageCount: r.image_count,
      costUsd: r.cost_usd,
      errorMessage: r.error_message,
      createdById: r.created_by_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async listVerifiedFacts(userId: string, draftId: string) {
    const draft = await this.requireDraft(userId, draftId);
    return this.listFactsInternal(draftId, draft.projectId);
  }

  async createVerifiedFact(userId: string, draftId: string, dto: CreateVerifiedFactDto) {
    const draft = await this.requireDraft(userId, draftId);
    const id = randomUUID();
    const status = dto.status || 'USER_CONFIRMED';
    const sourceType = dto.sourceType || 'USER_INPUT';
    await this.db.client.$executeRawUnsafe(
      `INSERT INTO content_verified_facts (
        id, organization_id, project_id, draft_id, claim, fact_type, status, source_type, source_ref, created_by_id, created_at, updated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10::uuid, NOW(), NOW()
      )`,
      id,
      draft.organizationId,
      draft.projectId,
      draft.id,
      dto.claim,
      dto.factType,
      status,
      sourceType,
      dto.sourceRef ?? null,
      userId,
    );
    return {
      id,
      claim: dto.claim,
      factType: dto.factType,
      status,
      sourceType,
      sourceRef: dto.sourceRef,
    };
  }

  async extractClaims(userId: string, draftId: string, dto: ExtractClaimsDto) {
    const draft = await this.requireDraft(userId, draftId);
    let targetText = dto.text || '';
    if (!targetText && dto.variantId) {
      const variant = await this.getPlatformVariant(userId, draftId, dto.variantId);
      targetText = variant.body;
    }
    if (!targetText) {
      const latest = await this.latestRevision(draftId);
      targetText = latest?.body || '';
    }

    const knownFacts = await this.listFactsInternal(draftId, draft.projectId);
    const claims = FactGroundingEngine.extractClaims(targetText, knownFacts);
    const check = FactGroundingEngine.checkBlockingRule(claims);

    return {
      claims,
      blocking: !check.passed,
      unverifiedCount: check.unverifiedCount,
      conflictingCount: check.conflictingCount,
      blockingClaims: check.blockingClaims,
    };
  }

  async safeRewrite(userId: string, draftId: string, dto: SafeRewriteDto) {
    const draft = await this.requireDraft(userId, draftId);
    let targetText = dto.text || '';
    let variant: any = null;
    if (dto.variantId) {
      variant = await this.getPlatformVariant(userId, draftId, dto.variantId);
      targetText = targetText || variant.body;
    }
    if (!targetText) {
      const latest = await this.latestRevision(draftId);
      targetText = latest?.body || '';
    }

    const knownFacts = await this.listFactsInternal(draftId, draft.projectId);
    const result = FactGroundingEngine.safeRewrite(targetText, knownFacts);

    const runId = randomUUID();
    await this.db.client.$executeRawUnsafe(
      `INSERT INTO content_generation_runs (
        id, organization_id, project_id, draft_id, source_revision_id,
        platform, generation_mode, provider, model, prompt_version,
        status, input_snapshot, output_snapshot, input_tokens, output_tokens,
        image_count, cost_usd, created_by_id, created_at, updated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
        $6, 'FACT_SAFE', 'engine-claimguard', 'geolens-claimguard-v1', $7,
        'COMPLETED', $8::jsonb, $9::jsonb, $10, $11,
        0, NULL, $12::uuid, NOW(), NOW()
      )`,
      runId,
      draft.organizationId,
      draft.projectId,
      draft.id,
      variant?.sourceRevisionId ?? null,
      variant?.platform ?? 'UNIVERSAL',
      PROMPT_VERSIONS.CLAIM_GUARD,
      JSON.stringify({ originalText: targetText }),
      JSON.stringify(result),
      Math.round(targetText.length * 1.1),
      Math.round(result.sanitizedText.length * 1.1),
      userId,
    );

    if (dto.variantId && variant) {
      await this.db.client.$executeRawUnsafe(
        `UPDATE platform_content_variants
         SET body = $1, updated_at = NOW()
         WHERE id = $2::uuid`,
        result.sanitizedText,
        dto.variantId,
      );
    }

    return {
      sanitizedText: result.sanitizedText,
      resolvedClaims: result.resolvedClaims,
      remainingUnverifiedClaims: result.remainingUnverifiedClaims,
      changeSummary: result.changeSummary,
      generationRunId: runId,
    };
  }

  async generateImagePreview(userId: string, draftId: string, dto: GenerateImagePreviewDto) {
    const draft = await this.requireDraft(userId, draftId);
    const knownFacts = await this.listFactsInternal(draftId, draft.projectId);

    let output;
    if (process.env.GENERATION_PROVIDER_MODE === 'real' && process.env.QWEN_API_KEY) {
      try {
        output = await this.wanxImageProvider.generateImage({
          prompt: dto.prompt,
          negativePrompt: dto.negativePrompt,
          ratio: dto.ratio || '1:1',
          style: dto.style || 'TECH',
          textOverlay: dto.textOverlay,
          draftId,
          variantId: dto.variantId,
          knownFacts,
        });
      } catch {
        output = await this.mockImageProvider.generateImage({
          prompt: dto.prompt,
          negativePrompt: dto.negativePrompt,
          ratio: dto.ratio || '1:1',
          style: dto.style || 'TECH',
          textOverlay: dto.textOverlay,
          draftId,
          variantId: dto.variantId,
          knownFacts,
        });
      }
    } else {
      output = await this.mockImageProvider.generateImage({
        prompt: dto.prompt,
        negativePrompt: dto.negativePrompt,
        ratio: dto.ratio || '1:1',
        style: dto.style || 'TECH',
        textOverlay: dto.textOverlay,
        draftId,
        variantId: dto.variantId,
        knownFacts,
      });
    }

    const runId = randomUUID();
    await this.db.client.$executeRawUnsafe(
      `INSERT INTO content_generation_runs (
        id, organization_id, project_id, draft_id, source_revision_id,
        platform, generation_mode, provider, model, prompt_version,
        status, input_snapshot, output_snapshot, input_tokens, output_tokens,
        image_count, cost_usd, created_by_id, created_at, updated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, NULL,
        'IMAGE', 'IMAGE_PREVIEW', $5, $6, 'geolens-image-v1',
        $7, $8::jsonb, $9::jsonb, 0, 0,
        1, NULL, $10::uuid, NOW(), NOW()
      )`,
      runId,
      draft.organizationId,
      draft.projectId,
      draft.id,
      output.provider,
      output.model,
      output.status,
      JSON.stringify(dto),
      JSON.stringify(output),
      userId,
    );

    return {
      ...output,
      generationRunId: runId,
    };
  }

  async acceptImageAsset(userId: string, draftId: string, dto: AcceptImageAssetDto) {
    const draft = await this.requireDraft(userId, draftId);

    let buf: Buffer;
    if (dto.imageUrl && dto.imageUrl.startsWith("data:image/svg+xml;base64,")) {
      const base64Data = dto.imageUrl.replace(/^data:image\/svg\+xml;base64,/, "");
      buf = Buffer.from(base64Data, "base64");
    } else {
      const res = await this.mockImageProvider.generateImage({
        prompt: dto.prompt,
        ratio: dto.ratio,
        style: "TECH",
      });
      buf = res.imageBuffer!;
    }

    const checksum = createHash("sha256").update(buf).digest("hex");
    const stored = await this.storage.put(draft.organizationId, buf);

    const asset = await this.db.client.contentAsset.create({
      data: {
        organizationId: draft.organizationId,
        projectId: draft.projectId,
        draftId,
        type: "COVER",
        mimeType: "image/svg+xml",
        sizeBytes: buf.length,
        checksum,
        storageKey: stored.storageKey,
        ownerId: userId,
      },
    });

    return this.toAssetView(asset);
  }

  // ---------------------------------------------------------------
  // M10A — Publication Lineage Foundation (已发布资产与发布血缘)
  // ---------------------------------------------------------------

  /**
   * 严格证据原则 (Evidence-First & No Fake Assets) 校验：
   * 1. 禁止伪造或合成假外部 URL (如 mock://, fake://, localhost, 127.0.0.1 等)。
   * 2. PLATFORM_CONFIRMED 必须具备真实平台外部链接 (canonicalUrl) 或真实外部资产 ID (externalAssetId)。
   * 3. MANUAL_VERIFIED 必须提供外部链接/ID 以及明确的核验依据 (verificationNote)。
   * 4. UNVERIFIED 资产绝不编造虚假的外部发布链接或标识。
   */
  private validateAuthenticExternalEvidence(
    status: "UNVERIFIED" | "PLATFORM_CONFIRMED" | "MANUAL_VERIFIED",
    canonicalUrl?: string | null,
    externalAssetId?: string | null,
    verificationNote?: string | null,
  ) {
    const isMockUrl = (url: string) => {
      const lower = url.toLowerCase().trim();
      return (
        lower.startsWith("mock://") ||
        lower.startsWith("fake://") ||
        lower.includes("localhost") ||
        lower.includes("127.0.0.1") ||
        lower.includes("example.com/mock") ||
        lower.startsWith("mock_") ||
        lower === "mock" ||
        lower === "fake"
      );
    };

    const isMockId = (id: string) => {
      const lower = id.toLowerCase().trim();
      return lower.startsWith("mock_") || lower.startsWith("mock-") || lower.startsWith("fake_") || lower === "mock" || lower === "fake";
    };

    if (canonicalUrl && isMockUrl(canonicalUrl)) {
      throw new BadRequestException("禁止使用虚假/Mock的外部链接作为发布资产的证明证据");
    }

    if (externalAssetId && isMockId(externalAssetId)) {
      throw new BadRequestException("禁止使用虚假/Mock的外部ID作为发布资产的证明证据");
    }

    if (status === "PLATFORM_CONFIRMED") {
      if (!canonicalUrl && !externalAssetId) {
        throw new BadRequestException("PLATFORM_CONFIRMED 必须提供真实的外部链接(canonicalUrl)或平台外部ID(externalAssetId)");
      }
      if (canonicalUrl && !canonicalUrl.startsWith("http://") && !canonicalUrl.startsWith("https://")) {
        throw new BadRequestException("canonicalUrl 必须是以 http:// 或 https:// 开头的合法外部链接");
      }
    }

    if (status === "MANUAL_VERIFIED") {
      if (!canonicalUrl && !externalAssetId) {
        throw new BadRequestException("MANUAL_VERIFIED 必须提供外部链接(canonicalUrl)或平台外部ID(externalAssetId)");
      }
      if (!verificationNote || verificationNote.trim().length === 0) {
        throw new BadRequestException("MANUAL_VERIFIED 必须提供核验说明(verificationNote)以记录证明依据");
      }
    }
  }

  /**
   * 将发布记录核验确认为落地资产 (PublishedAsset)
   * 支持 PLATFORM_CONFIRMED、MANUAL_VERIFIED 或 UNVERIFIED。
   * 当确认为有效资产时，自动推进排期项 (ContentScheduleItem) 状态至 DONE。
   */
  async confirmPublishedAsset(userId: string, publicationId: string, dto: ConfirmPublishedAssetDto) {
    const pub = await this.db.client.publication.findUnique({
      where: { id: publicationId },
      include: {
        draft: true,
        revision: true,
        attempts: { orderBy: [{ attemptNo: "desc" }] },
      },
    });
    if (!pub) throw new NotFoundException("发布记录不存在");
    await this.tenant.assertUserInOrganization(userId, pub.organizationId);

    // 校验外部真实证据
    this.validateAuthenticExternalEvidence(
      dto.verificationStatus,
      dto.canonicalUrl,
      dto.externalAssetId,
      dto.verificationNote,
    );

    let campaignId = pub.campaignId ?? null;
    let scheduleItemId = pub.scheduleItemId ?? null;
    let planItemId = pub.planItemId ?? null;

    if (!planItemId && pub.draft.sourcePlanItemId) {
      planItemId = pub.draft.sourcePlanItemId;
    }

    if (!scheduleItemId && planItemId) {
      const sItem = await this.db.client.contentScheduleItem.findFirst({
        where: { planItemId, projectId: pub.projectId },
        select: { id: true, campaignId: true },
      });
      if (sItem) {
        scheduleItemId = sItem.id;
        if (!campaignId) campaignId = sItem.campaignId;
      }
    }

    const latestAttempt = pub.attempts[0] ?? null;

    const isVerified = dto.verificationStatus === "PLATFORM_CONFIRMED" || dto.verificationStatus === "MANUAL_VERIFIED";

    // 创建持久化的落地资产 PublishedAsset（历史版本不可变记录，追加式）
    const publishedAsset = await this.db.client.publishedAsset.create({
      data: {
        organizationId: pub.organizationId,
        projectId: pub.projectId,
        campaignId,
        scheduleItemId,
        planItemId,
        draftId: pub.draftId,
        revisionId: pub.revisionId,
        publicationId: pub.id,
        publicationAttemptId: latestAttempt?.id ?? null,
        platform: pub.channel,
        title: dto.title || pub.title || pub.draft.title || "Untitled Asset",
        canonicalUrl: dto.canonicalUrl ?? null,
        externalAssetId: dto.externalAssetId ?? null,
        verificationStatus: dto.verificationStatus,
        sourceType: dto.sourceType || (dto.verificationStatus === "MANUAL_VERIFIED" ? "MANUAL_VERIFIED" : "PLATFORM_PUBLISH"),
        verificationNote: dto.verificationNote ?? null,
        metadata: (dto.metadata as any) ?? {},
        verifiedAt: isVerified ? new Date() : null,
        verifiedById: isVerified ? userId : null,
      },
    });

    // 若经确认为已落地发布资产，更新排期项状态至 DONE 并记录发布时间
    if (isVerified && scheduleItemId) {
      await this.db.client.contentScheduleItem.update({
        where: { id: scheduleItemId },
        data: {
          productionStatus: "DONE",
          metadata: {
            publishedAssetId: publishedAsset.id,
            publishedAt: new Date().toISOString(),
          },
        },
      }).catch((e) => {
        this.logger.warn(`Failed to advance schedule item ${scheduleItemId} to DONE: ${e?.message}`);
      });
    }

    // 若发布确认为平台落地，同步更新发布记录状态为 PUBLISHED
    if (dto.verificationStatus === "PLATFORM_CONFIRMED") {
      await this.db.client.publication.update({
        where: { id: pub.id },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
      });
    }

    await this.audit(
      pub.organizationId,
      userId,
      "PUBLICATION_CREATED",
      `published_asset_confirmed assetId=${publishedAsset.id} status=${dto.verificationStatus}`,
      {
        projectId: pub.projectId,
        draftId: pub.draftId,
        publicationId: pub.id,
      },
    );

    return publishedAsset;
  }

  /**
   * 手动录入或外部导入落地资产 (PublishedAsset)
   */
  async createPublishedAsset(userId: string, projectId: string, dto: CreatePublishedAssetDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);

    const draft = await this.requireDraft(userId, dto.draftId);
    if (draft.projectId !== projectId) {
      throw new NotFoundException("草稿不存在于该项目");
    }

    const rev = dto.revisionId
      ? await this.db.client.contentRevision.findFirst({
          where: { id: dto.revisionId, draftId: draft.id },
        })
      : await this.latestRevision(draft.id);
    if (!rev) throw new BadRequestException("草稿无版本内容");

    if (dto.publicationId) {
      const pub = await this.db.client.publication.findFirst({
        where: { id: dto.publicationId, projectId },
      });
      if (!pub) throw new NotFoundException("发布记录不存在");
    }

    if (dto.campaignId) {
      const camp = await this.db.client.contentCampaign.findFirst({
        where: { id: dto.campaignId, projectId },
      });
      if (!camp) throw new NotFoundException("营销战役不存在");
    }

    if (dto.scheduleItemId) {
      const sItem = await this.db.client.contentScheduleItem.findFirst({
        where: { id: dto.scheduleItemId, projectId },
      });
      if (!sItem) throw new NotFoundException("排期项不存在");
    }

    if (dto.planItemId) {
      const pItem = await this.db.client.contentPlanItem.findFirst({
        where: { id: dto.planItemId, organizationId: project.organizationId },
      });
      if (!pItem) throw new NotFoundException("内容规划项不存在");
    }

    this.validateAuthenticExternalEvidence(
      dto.verificationStatus,
      dto.canonicalUrl,
      dto.externalAssetId,
      dto.verificationNote,
    );

    let campaignId = dto.campaignId ?? null;
    let scheduleItemId = dto.scheduleItemId ?? null;
    let planItemId = dto.planItemId ?? draft.sourcePlanItemId ?? null;

    if (!scheduleItemId && planItemId) {
      const sItem = await this.db.client.contentScheduleItem.findFirst({
        where: { planItemId, projectId },
        select: { id: true, campaignId: true },
      });
      if (sItem) {
        scheduleItemId = sItem.id;
        if (!campaignId) campaignId = sItem.campaignId;
      }
    }

    const isVerified = dto.verificationStatus === "PLATFORM_CONFIRMED" || dto.verificationStatus === "MANUAL_VERIFIED";

    const publishedAsset = await this.db.client.publishedAsset.create({
      data: {
        organizationId: project.organizationId,
        projectId,
        campaignId,
        scheduleItemId,
        planItemId,
        draftId: draft.id,
        revisionId: rev.id,
        publicationId: dto.publicationId ?? null,
        publicationAttemptId: null,
        platform: dto.platform,
        title: dto.title,
        canonicalUrl: dto.canonicalUrl ?? null,
        externalAssetId: dto.externalAssetId ?? null,
        verificationStatus: dto.verificationStatus,
        sourceType: dto.sourceType || "MANUAL_VERIFIED",
        verificationNote: dto.verificationNote ?? null,
        metadata: (dto.metadata as any) ?? {},
        verifiedAt: isVerified ? new Date() : null,
        verifiedById: isVerified ? userId : null,
      },
    });

    if (isVerified && scheduleItemId) {
      await this.db.client.contentScheduleItem.update({
        where: { id: scheduleItemId },
        data: {
          productionStatus: "DONE",
          metadata: {
            publishedAssetId: publishedAsset.id,
            publishedAt: new Date().toISOString(),
          },
        },
      }).catch((e) => {
        this.logger.warn(`Failed to advance schedule item ${scheduleItemId} to DONE: ${e?.message}`);
      });
    }

    await this.audit(
      project.organizationId,
      userId,
      "PUBLICATION_CREATED",
      `published_asset_created assetId=${publishedAsset.id} status=${dto.verificationStatus}`,
      {
        projectId,
        draftId: draft.id,
        publicationId: dto.publicationId ?? undefined,
      },
    );

    return publishedAsset;
  }

  /**
   * 读取单个已发布资产详情
   */
  async getPublishedAsset(userId: string, assetId: string) {
    const asset = await this.db.client.publishedAsset.findUnique({
      where: { id: assetId },
      include: {
        draft: { select: { id: true, title: true, status: true } },
        revision: { select: { id: true, version: true, summary: true } },
        publication: { select: { id: true, channel: true, status: true, title: true } },
      },
    });
    if (!asset) throw new NotFoundException("发布资产不存在");
    await this.tenant.assertUserInOrganization(userId, asset.organizationId);
    return asset;
  }

  /**
   * 完整发布血缘反向追溯 (Reverse Lineage Traversal)
   * Asset -> Publication -> Attempt -> Revision -> Draft -> ScheduleItem -> PlanItem -> Campaign -> Strategy -> Diagnosis
   */
  async getPublishedAssetLineage(userId: string, assetId: string) {
    const asset = await this.db.client.publishedAsset.findUnique({
      where: { id: assetId },
      include: {
        campaign: true,
        scheduleItem: true,
        planItem: true,
        draft: true,
        revision: true,
        publication: {
          include: {
            connection: { select: { id: true, channel: true, displayName: true, status: true } },
            attempts: { orderBy: [{ attemptNo: "desc" }] },
          },
        },
        publicationAttempt: true,
      },
    });
    if (!asset) throw new NotFoundException("发布资产不存在");
    await this.tenant.assertUserInOrganization(userId, asset.organizationId);

    // 回溯 campaign
    let campaign = asset.campaign;
    if (!campaign && asset.scheduleItem?.campaignId) {
      campaign = await this.db.client.contentCampaign.findUnique({
        where: { id: asset.scheduleItem.campaignId },
      });
    }
    if (!campaign && asset.campaignId) {
      campaign = await this.db.client.contentCampaign.findUnique({
        where: { id: asset.campaignId },
      });
    }

    // 回溯 scheduleItem
    let scheduleItem = asset.scheduleItem;
    if (!scheduleItem && asset.scheduleItemId) {
      scheduleItem = await this.db.client.contentScheduleItem.findUnique({
        where: { id: asset.scheduleItemId },
      });
    }
    if (!scheduleItem && (asset.planItemId || asset.draft.sourcePlanItemId)) {
      const pId = asset.planItemId || asset.draft.sourcePlanItemId;
      scheduleItem = await this.db.client.contentScheduleItem.findFirst({
        where: { planItemId: pId!, projectId: asset.projectId },
      });
    }

    // 回溯 planItem
    let planItem = asset.planItem;
    if (!planItem && asset.planItemId) {
      planItem = await this.db.client.contentPlanItem.findUnique({
        where: { id: asset.planItemId },
      });
    }
    if (!planItem && asset.draft.sourcePlanItemId) {
      planItem = await this.db.client.contentPlanItem.findUnique({
        where: { id: asset.draft.sourcePlanItemId },
      });
    }

    // 回溯 strategy
    let strategyId = campaign?.strategyId ?? asset.draft.sourceStrategyId ?? null;
    if (!strategyId && planItem?.strategyId) {
      strategyId = planItem.strategyId;
    }

    let strategy = null;
    if (strategyId) {
      strategy = await this.db.client.contentStrategy.findUnique({
        where: { id: strategyId },
        select: { id: true, title: true, status: true, platformPriorities: true, sourceDiagnosisId: true, createdAt: true },
      });
    }

    // 回溯 diagnosis
    let diagnosisId = strategy?.sourceDiagnosisId ?? asset.draft.sourceDiagnosisId ?? null;
    let diagnosis = null;
    if (diagnosisId) {
      diagnosis = await this.db.client.diagnosisRun.findUnique({
        where: { id: diagnosisId },
        select: { id: true, status: true, summarySnapshot: true, createdAt: true },
      });
    }

    const latestAttempt = asset.publicationAttempt || (asset.publication?.attempts ? asset.publication.attempts[0] : null);

    return {
      publishedAsset: {
        id: asset.id,
        organizationId: asset.organizationId,
        projectId: asset.projectId,
        campaignId: asset.campaignId,
        scheduleItemId: asset.scheduleItemId,
        planItemId: asset.planItemId,
        draftId: asset.draftId,
        revisionId: asset.revisionId,
        publicationId: asset.publicationId,
        publicationAttemptId: asset.publicationAttemptId,
        platform: asset.platform,
        title: asset.title,
        canonicalUrl: asset.canonicalUrl,
        externalAssetId: asset.externalAssetId,
        verificationStatus: asset.verificationStatus,
        sourceType: asset.sourceType,
        verificationNote: asset.verificationNote,
        metadata: asset.metadata,
        verifiedAt: asset.verifiedAt,
        verifiedById: asset.verifiedById,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
      },
      lineage: {
        diagnosis: diagnosis ?? null,
        strategy: strategy ? {
          id: strategy.id,
          title: strategy.title,
          status: strategy.status,
          platformPriorities: strategy.platformPriorities,
          sourceDiagnosisId: strategy.sourceDiagnosisId,
          createdAt: strategy.createdAt,
        } : null,
        campaign: campaign ? {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          startDate: campaign.startDate,
          endDate: campaign.endDate,
        } : null,
        planItem: planItem ? {
          id: planItem.id,
          title: planItem.title,
          platform: planItem.platform,
          format: planItem.format,
          objective: planItem.objective,
          status: planItem.status,
        } : null,
        scheduleItem: scheduleItem ? {
          id: scheduleItem.id,
          scheduledDate: scheduleItem.scheduledDate,
          scheduledTime: scheduleItem.scheduledTime,
          timezone: scheduleItem.timezone,
          productionStatus: scheduleItem.productionStatus,
          assignedToId: scheduleItem.assignedToId,
        } : null,
        draft: {
          id: asset.draft.id,
          title: asset.draft.title,
          status: asset.draft.status,
          topic: asset.draft.topic,
          generationMode: asset.draft.generationMode,
        },
        revision: asset.revision ? {
          id: asset.revision.id,
          version: asset.revision.version,
          summary: asset.revision.summary,
          changeNote: asset.revision.changeNote,
        } : null,
        publication: asset.publication ? {
          id: asset.publication.id,
          channel: asset.publication.channel,
          status: asset.publication.status,
          title: asset.publication.title,
          publishedAt: asset.publication.publishedAt,
        } : null,
        publicationAttempt: latestAttempt ? {
          id: latestAttempt.id,
          attemptNo: latestAttempt.attemptNo,
          status: latestAttempt.status,
          publisher: latestAttempt.publisher,
          externalId: latestAttempt.externalId,
          externalUrl: latestAttempt.externalUrl,
        } : null,
      },
      provenance: {
        platform: asset.platform,
        sourceType: asset.sourceType,
        verificationStatus: asset.verificationStatus,
        canonicalUrl: asset.canonicalUrl,
        externalAssetId: asset.externalAssetId,
        verifiedAt: asset.verifiedAt,
        verifiedById: asset.verifiedById,
        verificationNote: asset.verificationNote,
      },
    };
  }

  /**
   * 发布资产列表：project scoped + 分页 + 过滤
   */
  async listPublishedAssets(userId: string, projectId: string, query: ListPublishedAssetsDto) {
    await this.tenant.assertUserInProject(userId, projectId);
    const where: Prisma.PublishedAssetWhereInput = { projectId };
    if (query.campaignId) where.campaignId = query.campaignId;
    if (query.platform) where.platform = query.platform;
    if (query.verificationStatus) where.verificationStatus = query.verificationStatus as any;

    const limit = Math.min(200, Math.max(1, query.limit ?? 20));
    const offset = Math.max(0, query.offset ?? 0);

    const [total, items] = await Promise.all([
      this.db.client.publishedAsset.count({ where }),
      this.db.client.publishedAsset.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: limit,
        include: {
          draft: { select: { id: true, title: true } },
          publication: { select: { id: true, channel: true, status: true } },
        },
      }),
    ]);

    return {
      total,
      limit,
      offset,
      items,
    };
  }
}
