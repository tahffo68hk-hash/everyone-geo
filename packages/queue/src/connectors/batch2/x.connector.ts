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

export class XConnector extends BaseConnector {
  readonly channel = 'X' as const;
  readonly category: ChannelCategory = 'SOCIAL';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'X',
      category: 'SOCIAL',
      displayName: 'X (formerly Twitter)',
      officialDocsUrl: 'https://developer.x.com/en/docs/x-api/tweets/manage-tweets/api-reference/post-tweets',
      authorizationType: 'OAUTH2',
      implementationStatus: 'READY_FOR_CREDENTIALS',
      supportsText: true,
      supportsImages: true,
      supportsVideo: true,
      supportsCarousel: false,
      supportsScheduling: 'GEOLENS_SCHEDULING',
      supportsDelete: true,
      supportsEdit: false,
      supportsStatusQuery: true,
      supportsAnalytics: true,
      supportsWebhook: true,
      titleMax: 100,
      bodyMax: 280, // Standard tweet character limit
      prerequisites: ['X Developer App (Free/Basic/Pro tier) with tweet.read, tweet.write, users.read'],
      assetLimits: {
        maxImages: 4,
        maxVideoSizeMb: 512,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4'],
      },
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    if (!credential.accessToken) return { valid: false, errorMessage: 'Missing X OAuth2 Access Token' };
    try {
      const res = await fetch('https://api.twitter.com/2/users/me', {
        headers: { Authorization: `Bearer ${credential.accessToken}` },
      });
      if (!res.ok) return { valid: false, errorMessage: `X auth failed: ${res.statusText}` };
      const data = (await res.json()) as { data?: { id: string; name: string; username: string } };
      if (!data.data) return { valid: false, errorMessage: 'Failed to retrieve X user' };
      return {
        valid: true,
        accountId: data.data.id,
        accountName: `@${data.data.username} (${data.data.name})`,
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : 'X connection error' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      let text = content.body;
      if (content.tags && content.tags.length > 0) {
        text += `\n\n${content.tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ')}`;
      }

      const payload: Record<string, unknown> = { text };
      const mediaIds = (content.assets || []).map((a) => a.externalId).filter(Boolean);
      if (mediaIds.length > 0) {
        payload.media = { media_ids: mediaIds };
      }

      const res = await fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const normErr = normalizeHttpError(res.status, errJson, 'X Tweet publish failed');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const data = (await res.json()) as { data?: { id: string; text: string } };
      const tweetId = data.data?.id || `x_${Date.now()}`;
      return {
        ok: true,
        publisher: 'real',
        externalId: tweetId,
        externalUrl: `https://x.com/i/web/status/${tweetId}`,
        durationMs: Date.now() - start,
        rawResponse: data.data,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : 'X network error',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }

  async deletePublication(externalId: string, credential: StoredCredential): Promise<DeleteResult> {
    try {
      const res = await fetch(`https://api.twitter.com/2/tweets/${externalId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${credential.accessToken}` },
      });
      return { ok: res.ok };
    } catch (e) {
      return { ok: false, errorMessage: e instanceof Error ? e.message : 'Delete error' };
    }
  }
}
