import type { PrismaClient } from '@geo/database';
import { defaultConnectorRegistry, type ConnectorRegistry } from '../registry/connector-registry';
import { defaultCredentialVault, type CredentialVault } from '../vault/credential-vault';
import type { NormalizedPublishContent, PublishOptions, PublishResult, StoredCredential } from '../types';

export interface RoutePublicationOptions extends PublishOptions {
  confirm?: boolean;
}

export interface RoutePublicationResult {
  executed: boolean;
  status: string;
  result?: PublishResult;
  errorMessage?: string;
}

export class PublicationRouter {
  constructor(
    private readonly db: PrismaClient,
    private readonly registry: ConnectorRegistry = defaultConnectorRegistry,
    private readonly vault: CredentialVault = defaultCredentialVault,
  ) {}

  /**
   * 路由并执行一次发布（同步或 Worker 消费时调用）。
   * 严格实施全部 Publish Safety 闸门。
   */
  async routeAndPublish(
    publicationId: string,
    options: RoutePublicationOptions = {},
  ): Promise<RoutePublicationResult> {
    const pub = await this.db.publication.findUnique({
      where: { id: publicationId },
      include: {
        draft: true,
        revision: {
          include: {
            approvals: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
        connection: true,
      },
    });

    if (!pub) {
      throw new Error('PUBLICATION_NOT_FOUND');
    }

    // 1. 已处于成功发布状态，跳过
    if (pub.status === 'PUBLISHED') {
      return { executed: false, status: pub.status };
    }

    const idemKey = options.idempotencyKey ?? pub.idempotencyKey;

    // 2. 幂等安全检查与原子任务抢占 (Atomic Claim)
    // 在调用任何外部 Connector / 内容校验前先原子创建处于 PUBLISHING 的 Attempt
    let attempt;
    try {
      const attemptNo = (await this.db.publicationAttempt.count({ where: { publicationId: pub.id } })) + 1;
      attempt = await this.db.publicationAttempt.create({
        data: {
          publicationId: pub.id,
          idempotencyKey: idemKey,
          channel: pub.channel,
          attemptNo,
          status: 'PUBLISHING',
          publisher: 'mock',
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002' || err?.message?.includes('Unique constraint') || err?.message?.includes('UniqueConstraint')) {
        return { executed: false, status: pub.status };
      }
      throw err;
    }

    // 3. 审批闸门：关联 Revision 最新审批必须为 APPROVED
    const latestApproval = pub.revision.approvals[0];
    if (!latestApproval || latestApproval.decision !== 'APPROVED') {
      await this.db.publicationAttempt.update({
        where: { id: attempt.id },
        data: { status: 'FAILED', errorMessage: 'LATEST_REVISION_NOT_APPROVED' },
      });
      await this.db.publication.update({ where: { id: pub.id }, data: { status: 'FAILED' } });
      throw new Error('LATEST_REVISION_NOT_APPROVED');
    }

    // 4. 连接状态拦截：仅允许 CONNECTED，其它状态一律拒绝
    if (pub.connection.status !== 'CONNECTED') {
      await this.db.publicationAttempt.update({
        where: { id: attempt.id },
        data: { status: 'FAILED', errorMessage: `CONNECTION_STATUS_INVALID: ${pub.connection.status}` },
      });
      await this.db.publication.update({ where: { id: pub.id }, data: { status: 'FAILED' } });
      throw new Error(`CONNECTION_STATUS_INVALID: ${pub.connection.status}`);
    }

    // 5. 查找对应 Connector
    const connector = this.registry.getConnector(pub.channel);
    if (!connector) {
      await this.db.publicationAttempt.update({
        where: { id: attempt.id },
        data: { status: 'FAILED', errorMessage: `NO_CONNECTOR_REGISTERED_FOR_CHANNEL: ${pub.channel}` },
      });
      await this.db.publication.update({ where: { id: pub.id }, data: { status: 'FAILED' } });
      throw new Error(`NO_CONNECTOR_REGISTERED_FOR_CHANNEL: ${pub.channel}`);
    }

    // 6. 解析渠道中立的内容主体
    let normalizedContent: NormalizedPublishContent;
    try {
      const parsed = JSON.parse(pub.payload);
      normalizedContent = {
        title: pub.title || parsed.title,
        body: parsed.body || pub.payload,
        summary: parsed.summary,
        tags: parsed.tags,
        coverUrl: parsed.coverUrl,
        canonicalUrl: parsed.canonicalUrl,
        assets: parsed.assets,
      };
    } catch {
      normalizedContent = {
        title: pub.title,
        body: pub.payload,
      };
    }

    // 7. 内容合规性预检
    const validation = await connector.validateContent(normalizedContent);
    if (!validation.valid) {
      await this.db.publicationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'FAILED',
          publisher: 'mock',
          errorMessage: validation.errors.join('; '),
          durationMs: 0,
        },
      });
      await this.db.publication.update({
        where: { id: pub.id },
        data: { status: 'FAILED' },
      });
      return {
        executed: true,
        status: 'FAILED',
        errorMessage: validation.errors.join('; '),
      };
    }

    // 8. 获取凭证
    let credential: StoredCredential = { credentialRef: pub.connection.credentialRef || '' };
    if (pub.connection.credentialRef) {
      const decrypted = this.vault.getCredential(pub.connection.credentialRef);
      if (decrypted) {
        credential = decrypted;
      }
    }

    // 9. 更新状态为 PUBLISHING
    await this.db.publication.update({
      where: { id: pub.id },
      data: { status: 'PUBLISHING' },
    });

    // 10. 执行发布（受 BaseConnector 出站写闸门与 dryRun 保护）
    let result: PublishResult;
    try {
      result = await connector.publish(normalizedContent, credential, options);
    } catch (publishErr: any) {
      await this.db.publicationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'FAILED',
          errorMessage: publishErr?.message || String(publishErr),
        },
      });
      await this.db.publication.update({
        where: { id: pub.id },
        data: { status: 'FAILED' },
      });
      throw publishErr;
    }

    const isDraftExternally =
      result.ok &&
      (pub.channel === 'WECHAT_OFFICIAL_ACCOUNT' ||
        (pub.channel === 'DEV_TO' && options.targetStatus !== 'publish') ||
        options.targetStatus === 'draft' ||
        result.targetStatus === 'draft' ||
        (result.rawResponse as any)?.status === 'DRAFT_CREATED_EXTERNALLY');

    const newStatus: any = !result.ok
      ? 'FAILED'
      : isDraftExternally
        ? 'DRAFT_CREATED_EXTERNALLY'
        : 'PUBLISHED';

    await this.db.publicationAttempt.update({
      where: { id: attempt.id },
      data: {
        status: newStatus,
        publisher: result.publisher,
        externalId: result.externalId ?? null,
        externalUrl: result.externalUrl ?? null,
        errorMessage: result.errorMessage ?? null,
        durationMs: result.durationMs,
      },
    });

    await this.db.publication.update({
      where: { id: pub.id },
      data: {
        status: newStatus,
        publishedAt: isDraftExternally ? null : result.ok ? new Date() : null,
      },
    });

    if (result.ok && !isDraftExternally) {
      await this.db.contentDraft.update({
        where: { id: pub.draftId },
        data: { status: 'PUBLISHED' },
      });
    }

    // 11. 记录审计与用量（绝不暴露秘钥）
    const auditAction = !result.ok
      ? 'PUBLICATION_FAILED'
      : 'PUBLICATION_SUCCEEDED';

    await this.db.contentAuditLog.create({
      data: {
        organizationId: pub.organizationId,
        projectId: pub.projectId,
        draftId: pub.draftId,
        publicationId: pub.id,
        action: auditAction,
        actorId: pub.createdById,
        detail: `channel=${pub.channel} attemptNo=${attempt.attemptNo} publisher=${result.publisher} status=${newStatus}`,
      },
    });

    await this.db.contentUsageEvent.create({
      data: {
        organizationId: pub.organizationId,
        projectId: pub.projectId,
        eventType: 'PUBLICATION_ATTEMPT',
        provider: result.publisher,
        costUsd: null,
        quantity: 1,
        actorId: pub.createdById,
      },
    });

    return {
      executed: true,
      status: newStatus,
      result,
      errorMessage: result.errorMessage,
    };
  }
}
