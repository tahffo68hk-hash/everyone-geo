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

export class FacebookConnector extends BaseConnector {
  readonly channel = 'FACEBOOK' as const;
  readonly category: ChannelCategory = 'SOCIAL';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'FACEBOOK',
      category: 'SOCIAL',
      displayName: 'Facebook Page',
      officialDocsUrl: 'https://developers.facebook.com/docs/graph-api/reference/page/feed',
      authorizationType: 'OAUTH2',
      implementationStatus: 'REQUIRES_APP_REVIEW',
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
      bodyMax: 10000,
      prerequisites: [
        'Meta App Review for pages_manage_posts, pages_read_engagement',
        'Page Access Token with Publishing permissions',
        'Page ID',
      ],
      assetLimits: {
        maxImages: 10,
        maxVideoSizeMb: 1000,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'video/mp4'],
      },
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    if (!credential.accessToken) return { valid: false, errorMessage: 'Missing Facebook Page Access Token' };
    try {
      const pageId = credential.channelId || (credential.extra?.pageId as string) || 'me';
      const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=id,name,link&access_token=${credential.accessToken}`);
      if (!res.ok) return { valid: false, errorMessage: `Facebook Page auth failed: ${res.statusText}` };
      const data = (await res.json()) as { id: string; name: string };
      return {
        valid: true,
        accountId: data.id,
        accountName: data.name,
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : 'Facebook error' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      const pageId = credential.channelId || (credential.extra?.pageId as string) || 'me';
      const params = new URLSearchParams({
        message: content.body,
        access_token: credential.accessToken || '',
      });

      if (content.canonicalUrl) {
        params.append('link', content.canonicalUrl);
      }

      if (options.scheduledAt) {
        params.append('published', 'false');
        params.append('scheduled_publish_time', String(Math.floor(options.scheduledAt.getTime() / 1000)));
      }

      const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
        method: 'POST',
        body: params,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const normErr = normalizeHttpError(res.status, errJson, 'Facebook page feed post failed');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const data = (await res.json()) as { id: string };
      return {
        ok: true,
        publisher: 'real',
        externalId: data.id,
        externalUrl: `https://facebook.com/${data.id}`,
        durationMs: Date.now() - start,
        rawResponse: data,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : 'Facebook network error',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }

  async deletePublication(externalId: string, credential: StoredCredential): Promise<DeleteResult> {
    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/${externalId}?access_token=${credential.accessToken}`, {
        method: 'DELETE',
      });
      return { ok: res.ok };
    } catch (e) {
      return { ok: false, errorMessage: e instanceof Error ? e.message : 'Delete error' };
    }
  }
}
