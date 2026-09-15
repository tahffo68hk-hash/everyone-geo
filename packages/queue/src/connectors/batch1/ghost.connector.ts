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

export class GhostConnector extends BaseConnector {
  readonly channel = 'GHOST' as const;
  readonly category: ChannelCategory = 'OWNED_SITE';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'GHOST',
      category: 'OWNED_SITE',
      displayName: 'Ghost CMS',
      officialDocsUrl: 'https://ghost.org/docs/admin-api/',
      authorizationType: 'API_KEY', // Admin API key
      implementationStatus: 'READY',
      supportsText: true,
      supportsImages: true,
      supportsVideo: true,
      supportsCarousel: false,
      supportsScheduling: 'NATIVE_SCHEDULING',
      supportsDelete: true,
      supportsEdit: true,
      supportsStatusQuery: true,
      supportsAnalytics: false,
      supportsWebhook: true,
      titleMax: 255,
      bodyMax: 100000,
      prerequisites: ['Ghost Admin API Key (id:secret)'],
      assetLimits: {
        maxImages: 50,
        maxVideoSizeMb: 500,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      },
    };
  }

  private getBaseUrl(credential: StoredCredential): string {
    return (credential.baseUrl || 'https://example.ghost.io').replace(/\/$/, '');
  }

  private getAuthHeader(credential: StoredCredential): string {
    const token = credential.apiKey || credential.accessToken || 'mock-ghost-token';
    return `Ghost ${token}`;
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    try {
      const baseUrl = this.getBaseUrl(credential);
      const res = await fetch(`${baseUrl}/ghost/api/admin/site/`, {
        headers: { Authorization: this.getAuthHeader(credential), Accept: 'application/json' },
      });
      if (!res.ok) {
        return { valid: false, errorMessage: `Ghost auth failed: ${res.statusText}` };
      }
      const data = (await res.json()) as { site?: { title?: string; url?: string } };
      return {
        valid: true,
        accountName: data.site?.title || 'Ghost Publication',
        accountId: data.site?.url || baseUrl,
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : 'Failed to connect to Ghost' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      const baseUrl = this.getBaseUrl(credential);
      const postPayload = {
        posts: [
          {
            title: content.title || 'Untitled Post',
            html: `<p>${content.body.replace(/\n/g, '</p><p>')}</p>`,
            status: options.scheduledAt ? 'scheduled' : 'published',
            published_at: options.scheduledAt ? options.scheduledAt.toISOString() : undefined,
            feature_image: content.coverUrl || undefined,
            tags: content.tags || [],
          },
        ],
      };

      const res = await fetch(`${baseUrl}/ghost/api/admin/posts/?source=html`, {
        method: 'POST',
        headers: {
          Authorization: this.getAuthHeader(credential),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(postPayload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const normErr = normalizeHttpError(res.status, errJson, 'Ghost publish failed');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const data = (await res.json()) as { posts?: Array<{ id: string; url: string; status: string }> };
      const created = data.posts?.[0];
      return {
        ok: true,
        publisher: 'real',
        externalId: created?.id || `ghost_${Date.now()}`,
        externalUrl: created?.url,
        durationMs: Date.now() - start,
        rawResponse: created,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : 'Ghost network error',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }

  async getPublicationStatus(externalId: string, credential: StoredCredential): Promise<PublicationStatusResult> {
    try {
      const baseUrl = this.getBaseUrl(credential);
      const res = await fetch(`${baseUrl}/ghost/api/admin/posts/${externalId}/`, {
        headers: { Authorization: this.getAuthHeader(credential), Accept: 'application/json' },
      });
      if (!res.ok) {
        return { externalId, status: 'FAILED', errorMessage: `Status query returned ${res.status}` };
      }
      const data = (await res.json()) as { posts?: Array<{ id: string; url: string; status: string }> };
      const post = data.posts?.[0];
      return {
        externalId,
        status: post?.status === 'published' ? 'PUBLISHED' : 'PROCESSING',
        externalUrl: post?.url,
      };
    } catch (e) {
      return { externalId, status: 'UNKNOWN', errorMessage: e instanceof Error ? e.message : 'Query error' };
    }
  }

  async deletePublication(externalId: string, credential: StoredCredential): Promise<DeleteResult> {
    try {
      const baseUrl = this.getBaseUrl(credential);
      const res = await fetch(`${baseUrl}/ghost/api/admin/posts/${externalId}/`, {
        method: 'DELETE',
        headers: { Authorization: this.getAuthHeader(credential) },
      });
      return { ok: res.ok, errorMessage: res.ok ? undefined : `Delete returned ${res.status}` };
    } catch (e) {
      return { ok: false, errorMessage: e instanceof Error ? e.message : 'Delete error' };
    }
  }
}
