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

export class DouyinConnector extends BaseConnector {
  readonly channel = 'DOUYIN' as const;
  readonly category: ChannelCategory = 'VIDEO';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'DOUYIN',
      category: 'VIDEO',
      displayName: '抖音 (Douyin)',
      officialDocsUrl: 'https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin-publish-ability-specification',
      authorizationType: 'OAUTH2',
      implementationStatus: 'RESTRICTED',
      supportsText: true,
      supportsImages: false, // 官方无服务端图文直发 API，仅支持客户端 SDK/H5
      supportsVideo: true,
      supportsCarousel: false,
      supportsScheduling: 'GEOLENS_SCHEDULING',
      supportsDelete: true,
      supportsEdit: false,
      supportsStatusQuery: true,
      supportsAnalytics: true,
      supportsWebhook: true,
      titleMax: 55,
      bodyMax: 1000,
      prerequisites: [
        '抖音开放平台企业开发者认证',
        '代替用户发布内容到抖音能力 (video.create.bind 实验室能力已于2024-07-20全面禁用，需平台特批直连资质)',
        '白名单与定向商务准入',
      ],
      assetLimits: {
        maxImages: 0,
        maxVideoSizeMb: 4000,
        allowedMimeTypes: ['video/mp4'],
      },
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    if (!credential.accessToken) return { valid: false, errorMessage: '缺少抖音 OAuth access_token' };
    try {
      const res = await fetch('https://open.douyin.com/oauth/userinfo/', {
        method: 'POST',
        headers: {
          'access-token': credential.accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ open_id: credential.accountId || '' }),
      });
      if (!res.ok) return { valid: false, errorMessage: `抖音授权校验失败: ${res.statusText}` };
      const data = (await res.json()) as { data?: { nickname?: string; open_id?: string; error_code?: number; description?: string } };
      if (data.data?.error_code && data.data.error_code !== 0) {
        return { valid: false, errorMessage: `抖音授权错误: ${data.data.description}` };
      }
      return {
        valid: true,
        accountId: data.data?.open_id,
        accountName: data.data?.nickname || '抖音创作者',
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : '抖音连接校验异常' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      const videoId = (content.assets || []).find((a) => a.type === 'VIDEO')?.externalId || 'mock_douyin_video_id';
      const openId = credential.accountId || '';

      const payload = {
        video_id: videoId,
        text: content.title ? `${content.title} ${content.body}` : content.body,
      };

      const res = await fetch(`https://open.douyin.com/api/douyin/v1/video/create_video/?open_id=${openId}`, {
        method: 'POST',
        headers: {
          'access-token': credential.accessToken || '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const normErr = normalizeHttpError(res.status, errJson, '抖音视频发布接口失败');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const data = (await res.json()) as { data?: { item_id: string; error_code: number; description?: string } };
      if (data.data?.error_code && data.data.error_code !== 0) {
        return {
          ok: false,
          publisher: 'real',
          errorMessage: `抖音发布拒绝: ${data.data.description} (code ${data.data.error_code})`,
          errorCode: 'PLATFORM_REJECTED',
          durationMs: Date.now() - start,
        };
      }

      const itemId = data.data?.item_id || `douyin_${Date.now()}`;
      return {
        ok: true,
        publisher: 'real',
        externalId: itemId,
        externalUrl: `https://www.douyin.com/video/${itemId}`,
        durationMs: Date.now() - start,
        rawResponse: data.data,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : '抖音网络请求异常',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }
}
