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

export class WeiboConnector extends BaseConnector {
  readonly channel = 'WEIBO' as const;
  readonly category: ChannelCategory = 'SOCIAL';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'WEIBO',
      category: 'SOCIAL',
      displayName: '新浪微博 (Weibo)',
      officialDocsUrl: 'https://open.weibo.com/wiki/Statuses/share',
      authorizationType: 'OAUTH2',
      implementationStatus: 'RESTRICTED',
      supportsText: true,
      supportsImages: true,
      supportsVideo: true,
      supportsCarousel: false,
      supportsScheduling: 'GEOLENS_SCHEDULING',
      supportsDelete: true,
      supportsEdit: false,
      supportsStatusQuery: true,
      supportsAnalytics: true,
      supportsWebhook: false,
      titleMax: 140,
      bodyMax: 2000,
      prerequisites: [
        '新浪微博开放平台企业认证',
        '第三方分享/发布高级接口审核 (statuses/share)',
        '域名安全备案与审核通过',
      ],
      assetLimits: {
        maxImages: 9,
        maxVideoSizeMb: 50,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif'],
      },
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    if (!credential.accessToken) return { valid: false, errorMessage: '缺少微博 OAuth access_token' };
    try {
      const res = await fetch(`https://api.weibo.com/2/users/show.json?access_token=${credential.accessToken}&uid=${credential.accountId || ''}`);
      if (!res.ok) return { valid: false, errorMessage: `微博授权校验失败: ${res.statusText}` };
      const data = (await res.json()) as { id?: number; screen_name?: string; error?: string };
      if (data.error) return { valid: false, errorMessage: `微博错误: ${data.error}` };
      return {
        valid: true,
        accountId: String(data.id || ''),
        accountName: data.screen_name ? `@${data.screen_name}` : '微博用户',
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : '微博校验异常' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      let statusText = content.body;
      if (content.title) {
        statusText = `【${content.title}】${content.body}`;
      }
      if (content.tags && content.tags.length > 0) {
        statusText += ` ${content.tags.map((t) => `#${t.replace(/#/g, '')}#`).join(' ')}`;
      }

      const formParams = new URLSearchParams({
        access_token: credential.accessToken || '',
        status: statusText,
      });

      const res = await fetch('https://api.weibo.com/2/statuses/share.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formParams,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const normErr = normalizeHttpError(res.status, errJson, '微博发博失败');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const data = (await res.json()) as { id?: number; idstr?: string; error?: string };
      if (data.error) {
        return {
          ok: false,
          publisher: 'real',
          errorMessage: `微博发布拒绝: ${data.error}`,
          errorCode: 'PLATFORM_REJECTED',
          durationMs: Date.now() - start,
        };
      }

      const weiboId = data.idstr || String(data.id || Date.now());
      return {
        ok: true,
        publisher: 'real',
        externalId: weiboId,
        externalUrl: `https://weibo.com/detail/${weiboId}`,
        durationMs: Date.now() - start,
        rawResponse: data,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : '微博网络请求异常',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }
}
