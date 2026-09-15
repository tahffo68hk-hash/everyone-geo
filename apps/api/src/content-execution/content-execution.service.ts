import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@geo/database";
import { PrismaService } from "../prisma.service";
import { TenantService } from "../common/tenant.service";
import {
  CreateConnectionDto, CreateDraftDto, CreatePublicationDto, DecideApprovalDto,
  ListDraftsDto, UpdateDraftDto,
} from "./dto/content-execution.dto";
import {
  createPublicationQueue, enqueuePublication, executePublication, type PublicationQueue,
} from "@geo/queue";

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

@Injectable()
export class ContentExecutionService implements OnModuleDestroy {
  private readonly logger = new Logger(ContentExecutionService.name);
  private readonly queue: PublicationQueue | null;

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
    const draft = await this.db.client.contentDraft.create({
      data: {
        organizationId: project.organizationId,
        projectId,
        title: dto.title,
        topic: dto.topic ?? null,
        generationMode: (dto.generationMode ?? "MANUAL") as Prisma.ContentDraftCreateInput["generationMode"],
        status: "DRAFT",
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
    await this.audit(project.organizationId, userId, "DRAFT_CREATED", `title=${draft.title.slice(0, 60)}`, {
      projectId, draftId: draft.id,
    });
    await this.usage(project.organizationId, userId, "CONTENT_GENERATION", projectId, "none");
    return this.toDraftView(draft);
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
      revisions: draft.revisions.map((r) => ({
        id: r.id, version: r.version, summary: r.summary, changeNote: r.changeNote,
        generatedById: r.generatedById, createdAt: r.createdAt,
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

    const idempotencyKey = randomUUID();
    const pub = await this.db.client.publication.create({
      data: {
        organizationId: draft.organizationId,
        projectId,
        draftId,
        revisionId: latest.id,
        connectionId: conn.id,
        channel: conn.channel,
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
    const revs = (d.revisions ?? []) as Array<{ id: string; version: number; summary: string | null; changeNote: string | null; generatedById: string; createdAt: Date }>;
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
      createdById: d.createdById,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      latestRevision: latest
        ? { id: latest.id, version: latest.version, summary: latest.summary, changeNote: latest.changeNote, generatedById: latest.generatedById, createdAt: latest.createdAt }
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
      include: { attempts: { orderBy: [{ attemptNo: "asc" }] } },
    });
    if (!pub) throw new NotFoundException("发布不存在");
    return {
      id: pub.id,
      organizationId: pub.organizationId,
      projectId: pub.projectId,
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
      })),
    };
  }
}
