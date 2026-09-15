import type { Channel } from '@geo/database';
import type {
  AssetUploadInput,
  AssetUploadResult,
  ChannelCapabilityDescriptor,
  ChannelCategory,
  ChannelConnector,
  ConnectionValidationResult,
  ContentValidationResult,
  DeleteResult,
  DistributionMetricsResult,
  NormalizedCredentialResult,
  NormalizedPublishContent,
  OAuthAuthorizationUrl,
  OAuthContext,
  PublicationStatusResult,
  PublishOptions,
  PublishResult,
  StoredCredential,
} from './types';

export abstract class BaseConnector implements ChannelConnector {
  abstract readonly channel: Channel;
  abstract readonly category: ChannelCategory;

  abstract getCapabilities(): ChannelCapabilityDescriptor;

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    if (!credential || (!credential.apiKey && !credential.accessToken && !credential.webhookUrl && !credential.password)) {
      return { valid: false, errorMessage: 'Missing credential tokens or credentials' };
    }
    return { valid: true, accountName: credential.username || credential.accountId || 'Connected Account' };
  }

  async validateContent(content: NormalizedPublishContent): Promise<ContentValidationResult> {
    const caps = this.getCapabilities();
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!content.body || content.body.trim().length === 0) {
      errors.push('Content body cannot be empty');
    } else if (content.body.length > caps.bodyMax) {
      errors.push(`Content body length (${content.body.length}) exceeds platform limit (${caps.bodyMax})`);
    }

    if (content.title && content.title.length > caps.titleMax) {
      errors.push(`Title length (${content.title.length}) exceeds platform limit (${caps.titleMax})`);
    }

    if (content.assets && content.assets.length > 0) {
      if (caps.assetLimits.maxImages && content.assets.filter(a => a.type === 'IMAGE').length > caps.assetLimits.maxImages) {
        errors.push(`Image count exceeds maximum allowed (${caps.assetLimits.maxImages})`);
      }
      if (caps.assetLimits.allowedMimeTypes) {
        for (const asset of content.assets) {
          if (!caps.assetLimits.allowedMimeTypes.includes(asset.mimeType)) {
            warnings.push(`Asset MIME type ${asset.mimeType} may not be natively supported by ${caps.displayName}`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  async publish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options?: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    const caps = this.getCapabilities();

    // 1. 内容校验
    const validation = await this.validateContent(content);
    if (!validation.valid) {
      return {
        ok: false,
        publisher: 'mock',
        errorMessage: validation.errors.join('; '),
        errorCode: 'CONTENT_INVALID',
        durationMs: Date.now() - start,
      };
    }

    // 2. dryRun 模式：只验证不发帖
    if (options?.dryRun) {
      return {
        ok: true,
        publisher: 'mock',
        externalId: `dryrun_${this.channel.toLowerCase()}_${Date.now()}`,
        durationMs: Date.now() - start,
      };
    }

    // 3. 出站安全闸门：EXTERNAL_PUBLISHING_ENABLED 为 false 时严格降级为安全 Mock
    if (process.env.EXTERNAL_PUBLISHING_ENABLED !== 'true') {
      const externalId = `mock_${this.channel.toLowerCase()}_${Date.now().toString(36)}`;
      const externalUrl = `https://mock.geo.local/${this.channel.toLowerCase()}/${externalId}`;
      return {
        ok: true,
        publisher: 'mock',
        externalId,
        externalUrl,
        durationMs: Date.now() - start,
      };
    }

    // 4. 真实外部调用
    return this.doPublish(content, credential, options);
  }

  /** 子类重写真实发布逻辑 */
  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    return {
      ok: true,
      publisher: 'real',
      externalId: `real_${this.channel.toLowerCase()}_${Date.now()}`,
      durationMs: Date.now() - start,
    };
  }

  async getPublicationStatus(
    externalId: string,
    credential: StoredCredential,
  ): Promise<PublicationStatusResult> {
    return {
      externalId,
      status: 'PUBLISHED',
    };
  }

  async deletePublication(
    externalId: string,
    credential: StoredCredential,
  ): Promise<DeleteResult> {
    return { ok: true };
  }

  async getAnalytics(
    externalId: string,
    credential: StoredCredential,
  ): Promise<DistributionMetricsResult> {
    return {
      externalId,
      metrics: {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        lastUpdatedAt: new Date(),
      },
    };
  }
}
