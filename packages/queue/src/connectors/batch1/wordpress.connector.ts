import { BaseConnector } from '../base.connector';
import type {
  AssetUploadInput,
  AssetUploadResult,
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

export class WordPressConnector extends BaseConnector {
  readonly channel = 'WORDPRESS' as const;
  readonly category: ChannelCategory = 'OWNED_SITE';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'WORDPRESS',
      category: 'OWNED_SITE',
      displayName: 'WordPress',
      officialDocsUrl: 'https://developer.wordpress.org/rest-api/reference/posts/',
      authorizationType: 'API_KEY', // Application Password or Bearer
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
      titleMax: 200,
      bodyMax: 100000,
      prerequisites: ['WordPress 5.6+ with Application Passwords enabled, or REST API auth plugin'],
      assetLimits: {
        maxImages: 50,
        maxVideoSizeMb: 500,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4'],
      },
    };
  }

  private getAuthHeader(credential: StoredCredential): string {
    if (credential.accessToken) {
      return `Bearer ${credential.accessToken}`;
    }
    if (credential.username && (credential.password || credential.apiKey)) {
      const secret = credential.password || credential.apiKey;
      return `Basic ${Buffer.from(`${credential.username}:${secret}`).toString('base64')}`;
    }
    throw new Error('MISSING_WORDPRESS_CREDENTIALS');
  }

  private getBaseUrl(credential: StoredCredential): string {
    const url = credential.baseUrl || 'https://example.com';
    return url.replace(/\/$/, '');
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    try {
      const baseUrl = this.getBaseUrl(credential);
      const auth = this.getAuthHeader(credential);
      const res = await fetch(`${baseUrl}/wp-json/wp/v2/users/me`, {
        headers: { Authorization: auth, Accept: 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { valid: false, errorMessage: `WordPress auth failed: ${res.statusText} (${JSON.stringify(err)})` };
      }
      const data = (await res.json()) as { id?: number; name?: string; slug?: string };
      return {
        valid: true,
        accountId: String(data.id || ''),
        accountName: data.name || data.slug || 'WordPress Admin',
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : 'Failed to connect to WordPress' };
    }
  }

  async uploadAsset(asset: AssetUploadInput, credential: StoredCredential): Promise<AssetUploadResult> {
    try {
      const baseUrl = this.getBaseUrl(credential);
      const auth = this.getAuthHeader(credential);

      const res = await fetch(`${baseUrl}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Disposition': `attachment; filename="${asset.filename}"`,
          'Content-Type': asset.mimeType,
        },
        body: new Uint8Array(asset.bytes),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { ok: false, externalMediaId: '', errorMessage: `Media upload failed: ${res.statusText} (${JSON.stringify(err)})` };
      }

      const data = (await res.json()) as { id: number; source_url: string };
      return {
        ok: true,
        externalMediaId: String(data.id),
        externalMediaUrl: data.source_url,
      };
    } catch (e) {
      return { ok: false, externalMediaId: '', errorMessage: e instanceof Error ? e.message : 'Media upload error' };
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
      const auth = this.getAuthHeader(credential);

      const postStatus = options?.targetStatus || (options?.scheduledAt ? 'future' : 'publish');
      const postData: Record<string, unknown> = {
        title: content.title || 'Untitled Post',
        content: content.body,
        status: postStatus,
      };

      if (options.scheduledAt) {
        postData.date = options.scheduledAt.toISOString();
      }

      if (content.summary) {
        postData.excerpt = content.summary;
      }

      const res = await fetch(`${baseUrl}/wp-json/wp/v2/posts`, {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(postData),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const normErr = normalizeHttpError(res.status, errJson, 'WordPress post creation failed');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const data = (await res.json()) as { id: number; link: string; status: string };
      return {
        ok: true,
        publisher: 'real',
        externalId: String(data.id),
        externalUrl: data.link,
        durationMs: Date.now() - start,
        rawResponse: { id: data.id, status: data.status, link: data.link },
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : 'WordPress network error',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }

  async getPublicationStatus(externalId: string, credential: StoredCredential): Promise<PublicationStatusResult> {
    try {
      const baseUrl = this.getBaseUrl(credential);
      const auth = this.getAuthHeader(credential);
      const res = await fetch(`${baseUrl}/wp-json/wp/v2/posts/${externalId}`, {
        headers: { Authorization: auth, Accept: 'application/json' },
      });
      if (!res.ok) {
        return { externalId, status: 'FAILED', errorMessage: `Status query returned ${res.status}` };
      }
      const data = (await res.json()) as { id: number; link: string; status: string };
      const statusMap: Record<string, 'PROCESSING' | 'PUBLISHED' | 'FAILED'> = {
        publish: 'PUBLISHED',
        future: 'PROCESSING',
        draft: 'PROCESSING',
        trash: 'FAILED',
      };
      return {
        externalId: String(data.id),
        status: statusMap[data.status] || 'PUBLISHED',
        externalUrl: data.link,
      };
    } catch (e) {
      return { externalId, status: 'UNKNOWN', errorMessage: e instanceof Error ? e.message : 'Query error' };
    }
  }

  async deletePublication(externalId: string, credential: StoredCredential): Promise<DeleteResult> {
    try {
      const baseUrl = this.getBaseUrl(credential);
      const auth = this.getAuthHeader(credential);
      const res = await fetch(`${baseUrl}/wp-json/wp/v2/posts/${externalId}?force=true`, {
        method: 'DELETE',
        headers: { Authorization: auth, Accept: 'application/json' },
      });
      return { ok: res.ok, errorMessage: res.ok ? undefined : `Delete returned ${res.status}` };
    } catch (e) {
      return { ok: false, errorMessage: e instanceof Error ? e.message : 'Delete error' };
    }
  }
}
