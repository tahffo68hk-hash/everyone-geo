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

export class InstagramConnector extends BaseConnector {
  readonly channel = 'INSTAGRAM' as const;
  readonly category: ChannelCategory = 'SOCIAL';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'INSTAGRAM',
      category: 'SOCIAL',
      displayName: 'Instagram Professional',
      officialDocsUrl: 'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/content-publishing',
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
      bodyMax: 2200,
      prerequisites: [
        'Instagram Professional (Business/Creator) Account',
        'Connected Facebook Page',
        'Meta App Review for instagram_basic, instagram_content_publish',
      ],
      assetLimits: {
        maxImages: 10,
        maxVideoSizeMb: 1000,
        allowedMimeTypes: ['image/jpeg', 'video/mp4'],
      },
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    if (!credential.accessToken) return { valid: false, errorMessage: 'Missing Instagram User Access Token' };
    try {
      const igUserId = credential.accountId || 'me';
      const res = await fetch(`https://graph.facebook.com/v19.0/${igUserId}?fields=id,username,name&access_token=${credential.accessToken}`);
      if (!res.ok) return { valid: false, errorMessage: `Instagram auth failed: ${res.statusText}` };
      const data = (await res.json()) as { id: string; username: string };
      return {
        valid: true,
        accountId: data.id,
        accountName: `@${data.username}`,
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : 'Instagram error' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      const igUserId = credential.accountId || 'me';
      const token = credential.accessToken;
      const imageUrl = content.coverUrl || content.assets?.[0]?.url || 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809';

      let caption = content.body;
      if (content.tags && content.tags.length > 0) {
        caption += `\n\n${content.tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ')}`;
      }

      // Step 1: Create Container
      const containerParams = new URLSearchParams({
        image_url: imageUrl,
        caption,
        access_token: token || '',
      });

      const containerRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media`, {
        method: 'POST',
        body: containerParams,
      });

      if (!containerRes.ok) {
        const err = await containerRes.json().catch(() => ({}));
        const normErr = normalizeHttpError(containerRes.status, err, 'Instagram container creation failed');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const containerData = (await containerRes.json()) as { id: string };

      // Step 2: Publish Container
      const pubParams = new URLSearchParams({
        creation_id: containerData.id,
        access_token: token || '',
      });

      const pubRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media_publish`, {
        method: 'POST',
        body: pubParams,
      });

      if (!pubRes.ok) {
        const err = await pubRes.json().catch(() => ({}));
        const normErr = normalizeHttpError(pubRes.status, err, 'Instagram publish failed');
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
        externalUrl: `https://www.instagram.com/p/${pubData.id}/`,
        durationMs: Date.now() - start,
        rawResponse: pubData,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : 'Instagram network error',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }
}
