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

export class MastodonConnector extends BaseConnector {
  readonly channel = 'MASTODON' as const;
  readonly category: ChannelCategory = 'SOCIAL';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'MASTODON',
      category: 'SOCIAL',
      displayName: 'Mastodon / Fediverse',
      officialDocsUrl: 'https://docs.joinmastodon.org/methods/statuses/',
      authorizationType: 'API_KEY', // Access Token or OAuth2
      implementationStatus: 'READY',
      supportsText: true,
      supportsImages: true,
      supportsVideo: true,
      supportsCarousel: false,
      supportsScheduling: 'NATIVE_SCHEDULING',
      supportsDelete: true,
      supportsEdit: true,
      supportsStatusQuery: true,
      supportsAnalytics: true,
      supportsWebhook: true,
      titleMax: 100,
      bodyMax: 500, // Standard default instance limit
      prerequisites: ['Mastodon Instance URL and Access Token (read:accounts write:statuses)'],
      assetLimits: {
        maxImages: 4,
        maxVideoSizeMb: 40,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4'],
      },
    };
  }

  private getInstanceUrl(credential: StoredCredential): string {
    return (credential.baseUrl || 'https://mastodon.social').replace(/\/$/, '');
  }

  private getAuthHeader(credential: StoredCredential): string {
    const token = credential.accessToken || credential.apiKey || '';
    return `Bearer ${token}`;
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    try {
      const instance = this.getInstanceUrl(credential);
      const res = await fetch(`${instance}/api/v1/accounts/verify_credentials`, {
        headers: { Authorization: this.getAuthHeader(credential) },
      });
      if (!res.ok) {
        return { valid: false, errorMessage: `Mastodon verification failed: ${res.statusText}` };
      }
      const data = (await res.json()) as { id: string; username: string; display_name: string };
      return {
        valid: true,
        accountId: data.id,
        accountName: `@${data.username} (${data.display_name})`,
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : 'Mastodon error' };
    }
  }

  async uploadAsset(asset: AssetUploadInput, credential: StoredCredential): Promise<AssetUploadResult> {
    try {
      const instance = this.getInstanceUrl(credential);
      const formData = new FormData();
      formData.append('file', new Blob([new Uint8Array(asset.bytes)], { type: asset.mimeType }), asset.filename);

      const res = await fetch(`${instance}/api/v2/media`, {
        method: 'POST',
        headers: { Authorization: this.getAuthHeader(credential) },
        body: formData,
      });

      if (!res.ok) {
        return { ok: false, externalMediaId: '', errorMessage: `Media upload failed: ${res.statusText}` };
      }
      const data = (await res.json()) as { id: string; url?: string };
      return { ok: true, externalMediaId: data.id, externalMediaUrl: data.url };
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
      const instance = this.getInstanceUrl(credential);
      const payload: Record<string, unknown> = {
        status: content.body,
        visibility: 'unlisted', // 试点安全策略：使用 unlisted 避免污染公共时间线
        media_ids: (content.assets || []).map((a) => a.externalId).filter(Boolean),
      };

      if (options.scheduledAt) {
        payload.scheduled_at = options.scheduledAt.toISOString();
      }

      const res = await fetch(`${instance}/api/v1/statuses`, {
        method: 'POST',
        headers: {
          Authorization: this.getAuthHeader(credential),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const normErr = normalizeHttpError(res.status, errJson, 'Mastodon status publish failed');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const data = (await res.json()) as { id: string; url: string };
      return {
        ok: true,
        publisher: 'real',
        externalId: data.id,
        externalUrl: data.url,
        durationMs: Date.now() - start,
        rawResponse: data,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : 'Mastodon network error',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }

  async deletePublication(externalId: string, credential: StoredCredential): Promise<DeleteResult> {
    try {
      const instance = this.getInstanceUrl(credential);
      const res = await fetch(`${instance}/api/v1/statuses/${externalId}`, {
        method: 'DELETE',
        headers: { Authorization: this.getAuthHeader(credential) },
      });
      return { ok: res.ok };
    } catch (e) {
      return { ok: false, errorMessage: e instanceof Error ? e.message : 'Delete error' };
    }
  }
}
