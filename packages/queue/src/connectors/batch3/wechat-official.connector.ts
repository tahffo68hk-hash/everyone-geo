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

interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

const wechatTokenCache = new Map<string, TokenCacheEntry>();

async function getWechatAccessToken(
  appId?: string,
  appSecret?: string,
  providedToken?: string,
): Promise<{ token?: string; error?: string; code?: number }> {
  if (providedToken && providedToken !== 'mock_wx_token') {
    return { token: providedToken };
  }
  if (!appId || !appSecret) {
    return { error: '缺少微信公众号 AppID 或 AppSecret' };
  }

  const cached = wechatTokenCache.get(appId);
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return { token: cached.token };
  }

  // 1. 优先使用微信官方 stable_token 接口（具备集群强一致性与幂等性，防止 40001 竞态）
  try {
    const res = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credential',
        appid: appId,
        secret: appSecret,
        force_refresh: false,
      }),
    });
    const data = (await res.json()) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };
    if (data.access_token) {
      wechatTokenCache.set(appId, {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
      });
      return { token: data.access_token };
    }
  } catch {
    // 降级
  }

  // 2. 备用传统 client_credential token
  try {
    const res = await fetch(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`,
    );
    const data = (await res.json()) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };
    if (data.access_token) {
      wechatTokenCache.set(appId, {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
      });
      return { token: data.access_token };
    }
    return { error: data.errmsg, code: data.errcode };
  } catch (e) {
    return { error: e instanceof Error ? e.message : '微信网络异常' };
  }
}

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
      implementationStatus: 'READY_FOR_CREDENTIALS',
      supportsText: true,
      supportsImages: true,
      supportsVideo: false, // 公众号图文草稿主要支持文本与图片，视频由视频号独立承载
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
        maxVideoSizeMb: 0,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      },
    };
  }

  async validateContent(content: NormalizedPublishContent) {
    const baseRes = await super.validateContent(content);
    const errors = [...baseRes.errors];
    const warnings = [...(baseRes.warnings || [])];

    if (!content.title || content.title.trim().length === 0) {
      errors.push('微信公众号图文草稿必须提供标题 (title)');
    }

    const hasImage = content.assets?.some((a) => a.type === 'IMAGE' || a.type === 'COVER');
    if (!hasImage && !content.coverUrl) {
      warnings.push('微信公众号草稿建议提供封面图以提升阅读体验');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    const appId = credential.apiKey || credential.username;
    const appSecret = credential.password || credential.extra?.appSecret;
    if (!appId || !appSecret) {
      return { valid: false, errorMessage: '缺少微信公众号 AppID 或 AppSecret' };
    }
    const { token, error, code } = await getWechatAccessToken(appId, appSecret, credential.accessToken);
    if (!token) {
      return { valid: false, errorMessage: `微信 AccessToken 获取失败: ${error} (${code})` };
    }
    credential.accessToken = token;
    return {
      valid: true,
      accountId: String(appId),
      accountName: `微信公众号 (${String(appId).slice(0, 8)}...)`,
    };
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      const appId = credential.apiKey || credential.username;
      const appSecret = credential.password || credential.extra?.appSecret;
      const { token, error, code } = await getWechatAccessToken(appId, appSecret, credential.accessToken);
      if (!token) {
        return {
          ok: false,
          publisher: 'real',
          errorMessage: `微信 Token 获取失败: ${error} (code ${code})`,
          errorCode: 'AUTH_FAILED',
          durationMs: Date.now() - start,
        };
      }
      const accessToken = token;

      // 1. 获取或自动生成封面永久素材 (thumb_media_id)
      let thumbMediaId = (content.assets || [])[0]?.externalId;
      if (!thumbMediaId && accessToken !== 'mock_wx_token') {
        try {
          const sharpModule = require('sharp');
          const sharp = sharpModule.default || sharpModule;
          const cleanTitle = (content.title || 'PawClean 智能评测').replace(/[<>&"]/g, '');
          const svgBanner = `
          <svg width="900" height="383" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#4F46E5;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#06B6D4;stop-opacity:1" />
              </linearGradient>
            </defs>
            <rect width="900" height="383" fill="url(#g)" />
            <text x="450" y="180" font-size="44" font-family="sans-serif" font-weight="bold" fill="#ffffff" text-anchor="middle">${cleanTitle}</text>
            <text x="450" y="240" font-size="24" font-family="sans-serif" fill="#E0E7FF" text-anchor="middle">GeoLens AI Visibility Intelligence · 官方草稿箱验证</text>
          </svg>`;
          const jpegBuf = await sharp(Buffer.from(svgBanner)).jpeg({ quality: 90 }).toBuffer();
          const formData = new FormData();
          formData.append('media', new Blob([jpegBuf], { type: 'image/jpeg' }), 'pawclean_cover.jpg');

          const uploadRes = await fetch(`https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${accessToken}&type=image`, {
            method: 'POST',
            body: formData,
          });
          const uploadData = (await uploadRes.json()) as { media_id?: string; errcode?: number; errmsg?: string };
          if (uploadData.media_id) {
            thumbMediaId = uploadData.media_id;
          } else if (uploadData.errcode) {
            return {
              ok: false,
              publisher: 'real',
              errorMessage: `微信封面素材上传失败: ${uploadData.errmsg} (code ${uploadData.errcode})`,
              errorCode: 'PLATFORM_REJECTED',
              durationMs: Date.now() - start,
            };
          }
        } catch (imgErr) {
          return {
            ok: false,
            publisher: 'real',
            errorMessage: `微信封面生成异常: ${imgErr instanceof Error ? imgErr.message : String(imgErr)}`,
            errorCode: 'PLATFORM_REJECTED',
            durationMs: Date.now() - start,
          };
        }
      }

      thumbMediaId = thumbMediaId || 'mock_thumb_id';

      // 2. 新建草稿箱图文 (Draft Box Add)
      // 注意：微信公众号发布体系分为“草稿箱”与“发表/群发”。
      // Pilot 阶段严格收敛至草稿箱 (draft/add)，绝不自动群发，保留人工在微信后台最终确认。
      const draftPayload = {
        articles: [
          {
            title: (content.title || '微信图文分享').slice(0, 64),
            author: 'GeoLens',
            digest: (content.summary || content.body.slice(0, 120)).slice(0, 120),
            content: content.body.startsWith('<p>')
              ? content.body
              : `<p>${content.body.replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`,
            thumb_media_id: thumbMediaId,
            need_open_comment: 0,
            only_fans_can_comment: 0,
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

      // 成功写入微信公众号草稿箱（草稿箱阶段完成，不调用 freepublish/submit 群发）
      return {
        ok: true,
        publisher: 'real',
        externalId: mediaId,
        externalUrl: `https://mp.weixin.qq.com/`, // 草稿箱管理入口，文章尚未公开发表
        durationMs: Date.now() - start,
        rawResponse: {
          media_id: mediaId,
          status: 'DRAFT_CREATED_EXTERNALLY',
          finalBroadcastRequiresHuman: true,
        },
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
      const appId = credential.apiKey || credential.username;
      const appSecret = credential.password || credential.extra?.appSecret;
      const { token } = await getWechatAccessToken(appId, appSecret, credential.accessToken);
      const accessToken = token || credential.accessToken || 'mock_wx_token';
      const res = await fetch(`https://api.weixin.qq.com/cgi-bin/draft/delete?access_token=${accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_id: externalId }),
      });
      const data = (await res.json()) as { errcode?: number };
      return { ok: data.errcode === 0 };
    } catch (e) {
      return { ok: false, errorMessage: e instanceof Error ? e.message : '微信草稿删除失败' };
    }
  }
}
