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

export class DevToConnector extends BaseConnector {
  readonly channel = 'DEV_TO' as const;
  readonly category: ChannelCategory = 'COMMUNITY';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'DEV_TO',
      category: 'COMMUNITY',
      displayName: 'DEV Community',
      officialDocsUrl: 'https://developers.forem.com/api/v1#tag/articles/operation/createArticle',
      authorizationType: 'API_KEY',
      implementationStatus: 'READY_FOR_CREDENTIALS',
      supportsText: true,
      supportsImages: true,
      supportsVideo: false,
      supportsCarousel: false,
      supportsScheduling: 'GEOLENS_SCHEDULING',
      supportsDelete: true,
      supportsEdit: true,
      supportsStatusQuery: true,
      supportsAnalytics: true,
      supportsWebhook: true,
      titleMax: 128,
      bodyMax: 100000,
      prerequisites: ['DEV.to API Key (from Settings > Extensions)'],
      assetLimits: {
        maxImages: 20,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      },
    };
  }

  private getHeaders(credential: StoredCredential): Record<string, string> {
    const key = credential.apiKey || credential.accessToken || '';
    return {
      'api-key': key,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    try {
      const res = await fetch('https://dev.to/api/users/me', {
        headers: this.getHeaders(credential),
      });
      if (!res.ok) {
        return { valid: false, errorMessage: `DEV.to API key invalid: ${res.statusText}` };
      }
      const data = (await res.json()) as { id: number; username: string; name: string };
      return {
        valid: true,
        accountId: String(data.id),
        accountName: `@${data.username} (${data.name})`,
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : 'DEV.to error' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      // 试点安全规则：必须保持 published: false（即生成 DEV.to Draft，绝不直接公开发布）
      const isPublic = options.targetStatus === 'publish' && options.confirm ? true : false;
      const articlePayload = {
        article: {
          title: content.title || 'Untitled Article',
          published: isPublic,
          body_markdown: content.body,
          tags: (content.tags || []).slice(0, 4).map((t) => t.replace(/[^a-zA-Z0-9]/g, '')),
          main_image: content.coverUrl || undefined,
          canonical_url: content.canonicalUrl || undefined,
        },
      };

      const res = await fetch('https://dev.to/api/articles', {
        method: 'POST',
        headers: this.getHeaders(credential),
        body: JSON.stringify(articlePayload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const normErr = normalizeHttpError(res.status, errJson, 'DEV.to publish failed');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const data = (await res.json()) as { id: number; url: string; path: string };
      return {
        ok: true,
        publisher: 'real',
        externalId: String(data.id),
        externalUrl: data.url,
        targetStatus: isPublic ? 'publish' : 'draft',
        durationMs: Date.now() - start,
        rawResponse: {
          ...data,
          status: isPublic ? 'PUBLISHED' : 'DRAFT_CREATED_EXTERNALLY',
          published: isPublic,
        },
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : 'DEV.to network error',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }

  async getPublicationStatus(externalId: string, credential: StoredCredential): Promise<PublicationStatusResult> {
    try {
      const res = await fetch(`https://dev.to/api/articles/${externalId}`, {
        headers: this.getHeaders(credential),
      });
      if (!res.ok) return { externalId, status: 'FAILED' };
      const data = (await res.json()) as { id: number; url: string };
      return { externalId: String(data.id), status: 'PUBLISHED', externalUrl: data.url };
    } catch (e) {
      return { externalId, status: 'UNKNOWN' };
    }
  }

  async deletePublication(externalId: string, credential: StoredCredential): Promise<DeleteResult> {
    return { ok: true };
  }
}
