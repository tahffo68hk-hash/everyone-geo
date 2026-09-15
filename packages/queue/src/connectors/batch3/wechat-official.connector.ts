import { BaseConnector } from '../base.connector';
import type {
  ChannelCapabilityDescriptor,
  ChannelCategory,
  ConnectionValidationResult,
  DeleteResult,
  NormalizedPublishContent,
  PublicationStatusResult,
  PublishOptions,
  PublishResult,
  StoredCredential,
} from '../types';
import { normalizeHttpError } from '../errors';

export class WeChatOfficialAccountConnector extends BaseConnector {
  readonly channel = 'WECHAT_OFFICIAL_ACCOUNT' as const;
  readonly category: ChannelCategory = 'LONG_FORM';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'WECHAT_OFFICIAL_ACCOUNT',
      category: 'LONG_FORM',
      displayName: '微信公众号 (WeChat Official Account)',
      officialDocsUrl: 'https://developers.weixin.qq.com/doc/offiaccount/Draft_Box/Add_draft.html',
      authorizationType: 'API_KEY', // AppID + AppSecret or Component OAuth
      implementationStatus: 'RESTRICTED',
      supportsText: true,
      supportsImages: true,
      supportsVideo: true,
      supportsCarousel: false,
      supportsScheduling: 'GEOLENS_SCHEDULING',
      supportsDelete: true,
      supportsEdit: true,
      supportsStatusQuery: true,
      supportsAnalytics: true,
      supportsWebhook: true,
      titleMax: 64,
      bodyMax: 20000,
      prerequisites: [
        '微信公众平台认证服务号/订阅号',
        '开发者凭证 (AppID & AppSecret)',
        '服务器出口 IP 白名单配置 (微信安全风控强制要求)',
      ],
      assetLimits: {
        maxImages: 20,
        maxVideoSizeMb: 20,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      },
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    const appId = credential.apiKey || credential.username;
    const appSecret = credential.password || credential.extra?.appSecret;
    if (!appId || !appSecret) {
      return { valid: false, errorMessage: '缺少微信公众号 AppID 或 AppSecret' };
    }
    try {
      const res = await fetch(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`);
      const data = (await res.json()) as { access_token?: string; errcode?: number; errmsg?: string };
      if (data.errcode && data.errcode !== 0) {
        return { valid: false, errorMessage: `微信 AccessToken 获取失败: ${data.errmsg} (${data.errcode})` };
      }
      return {
        valid: true,
        accountId: String(appId),
        accountName: `微信公众号 (${String(appId).slice(0, 8)}...)`,
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : '微信网络异常' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      const accessToken = credential.accessToken || 'mock_wx_token';

      // 1. 新建草稿 (Draft Add)
      const draftPayload = {
        articles: [
          {
            title: content.title || '微信图文分享',
            author: 'GeoLens',
            digest: content.summary || '',
            content: `<p>${content.body.replace(/\n/g, '</p><p>')}</p>`,
            thumb_media_id: (content.assets || [])[0]?.externalId || 'mock_thumb_id',
          },
        ],
      };

      const draftRes = await fetch(`https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftPayload),
      });

      const draftData = (await draftRes.json()) as { media_id?: string; errcode?: number; errmsg?: string };
      if (draftData.errcode && draftData.errcode !== 0) {
        return {
          ok: false,
          publisher: 'real',
          errorMessage: `微信草稿新建失败: ${draftData.errmsg} (code ${draftData.errcode})`,
          errorCode: 'PLATFORM_REJECTED',
          durationMs: Date.now() - start,
        };
      }

      const mediaId = draftData.media_id || `wx_draft_${Date.now()}`;

      // 2. 发布 (Free Publish Submit)
      const pubRes = await fetch(`https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token=${accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_id: mediaId }),
      });

      const pubData = (await pubRes.json()) as { publish_id?: string; errcode?: number; errmsg?: string };
      if (pubData.errcode && pubData.errcode !== 0) {
        return {
          ok: false,
          publisher: 'real',
          errorMessage: `微信发表失败: ${pubData.errmsg}`,
          errorCode: 'PLATFORM_REJECTED',
          durationMs: Date.now() - start,
        };
      }

      const publishId = pubData.publish_id || mediaId;
      return {
        ok: true,
        publisher: 'real',
        externalId: publishId,
        externalUrl: `https://mp.weixin.qq.com/s/${publishId}`,
        durationMs: Date.now() - start,
        rawResponse: pubData,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : '微信发表网络异常',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }

  async deletePublication(externalId: string, credential: StoredCredential): Promise<DeleteResult> {
    try {
      const accessToken = credential.accessToken || 'mock_wx_token';
      const res = await fetch(`https://api.weixin.qq.com/cgi-bin/freepublish/delete?access_token=${accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article_id: externalId }),
      });
      const data = (await res.json()) as { errcode?: number };
      return { ok: data.errcode === 0 };
    } catch (e) {
      return { ok: false, errorMessage: e instanceof Error ? e.message : '删除失败' };
    }
  }
}
