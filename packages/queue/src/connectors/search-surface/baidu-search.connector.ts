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

export class BaiduSearchSurfaceConnector extends BaseConnector {
  readonly channel = 'BAIDU_SEARCH_SURFACE' as const;
  readonly category: ChannelCategory = 'SEARCH_SURFACE';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'BAIDU_SEARCH_SURFACE',
      category: 'SEARCH_SURFACE',
      displayName: '百度搜索资源推送 (Baidu Search Surface)',
      officialDocsUrl: 'https://ziyuan.baidu.com/college/courseinfo?id=267&page=2#h2_article_title14',
      authorizationType: 'API_KEY', // Site + Token
      implementationStatus: 'READY_FOR_CREDENTIALS',
      supportsText: true,
      supportsImages: false,
      supportsVideo: false,
      supportsCarousel: false,
      supportsScheduling: 'GEOLENS_SCHEDULING',
      supportsDelete: false,
      supportsEdit: false,
      supportsStatusQuery: true,
      supportsAnalytics: true,
      supportsWebhook: false,
      titleMax: 200,
      bodyMax: 10000,
      prerequisites: [
        '百度搜索资源平台验证站点 (ziyuan.baidu.com)',
        '普通收录 API 准入 Token',
        '推送目标域名一致性校验',
      ],
      assetLimits: {},
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    const site = credential.baseUrl || (credential.extra?.site as string);
    const token = credential.apiKey || credential.accessToken;
    if (!site || !token) {
      return { valid: false, errorMessage: '缺少百度搜索资源站点 (site) 或收录 Token' };
    }
    return {
      valid: true,
      accountId: site,
      accountName: `百度收录站点 (${site})`,
    };
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      const site = credential.baseUrl || (credential.extra?.site as string) || 'https://example.com';
      const token = credential.apiKey || credential.accessToken || '';
      const urlToPush = content.canonicalUrl || (content.metadata?.targetUrl as string) || site;

      const res = await fetch(`http://data.zz.baidu.com/urls?site=${encodeURIComponent(site)}&token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: urlToPush,
      });

      const data = (await res.json()) as { success?: number; remain?: number; not_same_site?: string[]; not_valid?: string[]; message?: string; error?: number };
      if (!res.ok || data.error) {
        return {
          ok: false,
          publisher: 'real',
          errorMessage: `百度收录推送失败: ${data.message || res.statusText}`,
          errorCode: 'PLATFORM_REJECTED',
          durationMs: Date.now() - start,
        };
      }

      return {
        ok: true,
        publisher: 'real',
        externalId: `baidu_push_${Date.now()}`,
        externalUrl: urlToPush,
        durationMs: Date.now() - start,
        rawResponse: data,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : '百度推送网络异常',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }
}
