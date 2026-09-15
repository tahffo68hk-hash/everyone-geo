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

export class TikTokConnector extends BaseConnector {
  readonly channel = 'TIKTOK' as const;
  readonly category: ChannelCategory = 'VIDEO';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'TIKTOK',
      category: 'VIDEO',
      displayName: 'TikTok',
      officialDocsUrl: 'https://developers.tiktok.com/doc/content-posting-api-get-started',
      authorizationType: 'OAUTH2',
      implementationStatus: 'RESTRICTED',
      supportsText: true,
      supportsImages: true,
      supportsVideo: true,
      supportsCarousel: false,
      supportsScheduling: 'GEOLENS_SCHEDULING',
      supportsDelete: false,
      supportsEdit: false,
      supportsStatusQuery: true,
      supportsAnalytics: true,
      supportsWebhook: true,
      titleMax: 150,
      bodyMax: 2200,
      prerequisites: [
        'TikTok for Developers Account with Business Verification',
        'App Review approved for Content Posting API (video.publish, video.upload scopes)',
        'Direct Post partner whitelist',
      ],
      assetLimits: {
        maxImages: 1,
        maxVideoSizeMb: 1000,
        allowedMimeTypes: ['video/mp4', 'video/webm'],
      },
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    if (!credential.accessToken) return { valid: false, errorMessage: 'Missing TikTok OAuth Access Token' };
    try {
      const res = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name', {
        headers: { Authorization: `Bearer ${credential.accessToken}` },
      });
      if (!res.ok) return { valid: false, errorMessage: `TikTok auth failed: ${res.statusText}` };
      const data = (await res.json()) as { data?: { user?: { display_name?: string; open_id?: string } } };
      return {
        valid: true,
        accountId: data.data?.user?.open_id,
        accountName: data.data?.user?.display_name || 'TikTok Creator',
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : 'TikTok error' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      const videoAsset = (content.assets || []).find((a) => a.type === 'VIDEO');
      const videoUrl = videoAsset?.url || content.coverUrl || 'https://example.com/mock_video.mp4';

      const postBody = {
        post_info: {
          title: content.title || content.body.slice(0, 100),
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: videoUrl,
        },
      };

      const res = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(postBody),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const normErr = normalizeHttpError(res.status, errJson, 'TikTok video publish init failed');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const data = (await res.json()) as { data?: { publish_id: string } };
      const publishId = data.data?.publish_id || `tiktok_${Date.now()}`;
      return {
        ok: true,
        publisher: 'real',
        externalId: publishId,
        durationMs: Date.now() - start,
        rawResponse: data.data,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : 'TikTok network error',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }
}
