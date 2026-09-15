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

export class ThreadsConnector extends BaseConnector {
  readonly channel = 'THREADS' as const;
  readonly category: ChannelCategory = 'SOCIAL';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'THREADS',
      category: 'SOCIAL',
      displayName: 'Threads (Meta)',
      officialDocsUrl: 'https://developers.facebook.com/docs/threads/posts',
      authorizationType: 'OAUTH2',
      implementationStatus: 'REQUIRES_APP_REVIEW',
      supportsText: true,
      supportsImages: true,
      supportsVideo: true,
      supportsCarousel: true,
      supportsScheduling: 'GEOLENS_SCHEDULING',
      supportsDelete: false,
      supportsEdit: false,
      supportsStatusQuery: true,
      supportsAnalytics: true,
      supportsWebhook: true,
      titleMax: 100,
      bodyMax: 500,
      prerequisites: ['Meta App Review for threads_basic, threads_content_publish', 'Instagram Professional Account linked to Threads'],
      assetLimits: {
        maxImages: 10,
        maxVideoSizeMb: 1000,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime'],
      },
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    if (!credential.accessToken) {
      return { valid: false, errorMessage: 'Missing Threads User Access Token' };
    }
    try {
      const res = await fetch(`https://graph.threads.net/v1.0/me?fields=id,username,name&access_token=${credential.accessToken}`);
      if (!res.ok) {
        return { valid: false, errorMessage: `Threads token invalid: ${res.statusText}` };
      }
      const data = (await res.json()) as { id: string; username: string; name: string };
      return {
        valid: true,
        accountId: data.id,
        accountName: `@${data.username}`,
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : 'Threads error' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      const userId = credential.accountId || 'me';
      const token = credential.accessToken;

      // 1. Create Media Container
      const containerParams = new URLSearchParams({
        media_type: 'TEXT',
        text: content.body,
        access_token: token || '',
      });

      const containerRes = await fetch(`https://graph.threads.net/v1.0/${userId}/threads`, {
        method: 'POST',
        body: containerParams,
      });

      if (!containerRes.ok) {
        const err = await containerRes.json().catch(() => ({}));
        const normErr = normalizeHttpError(containerRes.status, err, 'Threads container creation failed');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const containerData = (await containerRes.json()) as { id: string };

      // 2. Publish Container
      const publishParams = new URLSearchParams({
        creation_id: containerData.id,
        access_token: token || '',
      });

      const pubRes = await fetch(`https://graph.threads.net/v1.0/${userId}/threads_publish`, {
        method: 'POST',
        body: publishParams,
      });

      if (!pubRes.ok) {
        const err = await pubRes.json().catch(() => ({}));
        const normErr = normalizeHttpError(pubRes.status, err, 'Threads publish failed');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const pubData = (await pubRes.json()) as { id: string };
      return {
        ok: true,
        publisher: 'real',
        externalId: pubData.id,
        externalUrl: `https://www.threads.net/post/${pubData.id}`,
        durationMs: Date.now() - start,
        rawResponse: pubData,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : 'Threads network error',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }
}
