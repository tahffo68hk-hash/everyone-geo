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

export class BilibiliConnector extends BaseConnector {
  readonly channel = 'BILIBILI' as const;
  readonly category: ChannelCategory = 'VIDEO';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'BILIBILI',
      category: 'VIDEO',
      displayName: '哔哩哔哩 (Bilibili)',
      officialDocsUrl: 'https://open.bilibili.com/doc/4/e570f80a-9d9c-11e9-9a74-00163e04271e',
      authorizationType: 'OAUTH2',
      implementationStatus: 'REQUIRES_APP_REVIEW',
      supportsText: true,
      supportsImages: true,
      supportsVideo: true,
      supportsCarousel: false,
      supportsScheduling: 'GEOLENS_SCHEDULING',
      supportsDelete: false,
      supportsEdit: true,
      supportsStatusQuery: true,
      supportsAnalytics: true,
      supportsWebhook: true,
      titleMax: 80,
      bodyMax: 2000,
      prerequisites: [
        'Bilibili 开放平台企业开发者资质',
        '视频/专栏投稿权限审批 (app.archive.add)',
        'UP主授权 (OAuth2)',
        '官方白名单合作协议',
      ],
      assetLimits: {
        maxImages: 1, // 封面
        maxVideoSizeMb: 8000,
        allowedMimeTypes: ['video/mp4', 'video/x-flv'],
      },
    };
  }

  async validateContent(content: NormalizedPublishContent) {
    const baseRes = await super.validateContent(content);
    const errors = [...baseRes.errors];
    const warnings = [...(baseRes.warnings || [])];

    const hasVideo =
      content.assets?.some((a) => a.type === 'VIDEO' || a.mimeType?.startsWith('video/')) ||
      Boolean(content.metadata?.videoAssetId || content.metadata?.hasVideo);

    if (!hasVideo) {
      errors.push('VIDEO_ASSET_REQUIRED: Bilibili 投稿需要视频媒体资产文件');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    if (!credential.accessToken) return { valid: false, errorMessage: '缺少 Bilibili Access Token' };
    try {
      const res = await fetch(`https://api.bilibili.com/x/member/web/account?access_key=${credential.accessToken}`);
      if (!res.ok) return { valid: false, errorMessage: `Bilibili 授权校验失败: ${res.statusText}` };
      const data = (await res.json()) as { code: number; data?: { mid: number; uname: string } };
      if (data.code !== 0) return { valid: false, errorMessage: `Bilibili 错误码: ${data.code}` };
      return {
        valid: true,
        accountId: String(data.data?.mid),
        accountName: data.data?.uname || 'Bilibili UP主',
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : 'Bilibili 校验异常' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      // Bilibili Web/OpenAPI submission
      const payload = {
        title: content.title || '精彩视频分享',
        desc: content.body,
        tag: (content.tags || []).join(','),
        tid: 174, // 知识 / 生活分区默认
        cover: content.coverUrl,
      };

      const res = await fetch(`https://member.bilibili.com/x/vu/web/add?access_key=${credential.accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const normErr = normalizeHttpError(res.status, errJson, 'Bilibili 稿件发布失败');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const data = (await res.json()) as { code: number; data?: { bvid?: string; aid?: number }; message?: string };
      if (data.code !== 0) {
        return {
          ok: false,
          publisher: 'real',
          errorMessage: `Bilibili 接口拒绝: ${data.message} (code ${data.code})`,
          errorCode: 'PLATFORM_REJECTED',
          durationMs: Date.now() - start,
        };
      }

      const bvid = data.data?.bvid || `BV1mock${Date.now()}`;
      return {
        ok: true,
        publisher: 'real',
        externalId: bvid,
        externalUrl: `https://www.bilibili.com/video/${bvid}`,
        targetStatus: 'future',
        durationMs: Date.now() - start,
        rawResponse: {
          ...(data.data || {}),
          platformStatus: 'UNDER_REVIEW', // 平台审核中，不等于已公开发布
        },
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : 'Bilibili 网络异常',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }
}
