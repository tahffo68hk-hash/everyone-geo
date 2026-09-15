import { BaseConnector } from '../base.connector';
import type {
  ChannelCapabilityDescriptor,
  ChannelCategory,
  ConnectionValidationResult,
  NormalizedPublishContent,
  PublishOptions,
  PublishResult,
  StoredCredential,
} from '../types';
import { normalizeHttpError } from '../errors';

export class ToutiaoConnector extends BaseConnector {
  readonly channel = 'TOUTIAO' as const;
  readonly category: ChannelCategory = 'LONG_FORM';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'TOUTIAO',
      category: 'LONG_FORM',
      displayName: '今日头条 (Toutiao)',
      officialDocsUrl: 'https://open.snssdk.com/',
      authorizationType: 'OAUTH2',
      implementationStatus: 'RESTRICTED',
      supportsText: true,
      supportsImages: true,
      supportsVideo: true,
      supportsCarousel: false,
      supportsScheduling: 'GEOLENS_SCHEDULING',
      supportsDelete: false,
      supportsEdit: false,
      supportsStatusQuery: true,
      supportsAnalytics: true,
      supportsWebhook: false,
      titleMax: 30,
      bodyMax: 10000,
      prerequisites: [
        '字节跳动开放平台企业开发者认证',
        '今日头条微头条/文章发布能力审批',
        '定向商务准入白名单',
      ],
      assetLimits: {
        maxImages: 9,
        maxVideoSizeMb: 1000,
        allowedMimeTypes: ['image/jpeg', 'image/png'],
      },
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    if (!credential.accessToken) return { valid: false, errorMessage: '缺少今日头条 Access Token' };
    return { valid: true, accountName: '今日头条账号' };
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      const payload = {
        title: content.title || '今日头条分享',
        content: content.body,
      };
      const res = await fetch(`https://open.snssdk.com/data/publish/article/?access_token=${credential.accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const normErr = normalizeHttpError(res.status, errJson, '今日头条发布失败');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }
      const data = (await res.json()) as { article_id?: string };
      const articleId = data.article_id || `tt_${Date.now()}`;
      return {
        ok: true,
        publisher: 'real',
        externalId: articleId,
        externalUrl: `https://www.toutiao.com/article/${articleId}`,
        durationMs: Date.now() - start,
        rawResponse: data,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : '今日头条网络异常',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }
}
