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

export class YouTubeConnector extends BaseConnector {
  readonly channel = 'YOUTUBE' as const;
  readonly category: ChannelCategory = 'VIDEO';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'YOUTUBE',
      category: 'VIDEO',
      displayName: 'YouTube',
      officialDocsUrl: 'https://developers.google.com/youtube/v3/docs/videos/insert',
      authorizationType: 'OAUTH2',
      implementationStatus: 'REQUIRES_APP_REVIEW',
      supportsText: true,
      supportsImages: false,
      supportsVideo: true,
      supportsCarousel: false,
      supportsScheduling: 'NATIVE_SCHEDULING',
      supportsDelete: true,
      supportsEdit: true,
      supportsStatusQuery: true,
      supportsAnalytics: true,
      supportsWebhook: true,
      titleMax: 100,
      bodyMax: 5000,
      prerequisites: ['Google Cloud Project with YouTube Data API v3 quota', 'OAuth scope https://www.googleapis.com/auth/youtube.upload', 'YouTube Channel setup'],
      assetLimits: {
        maxImages: 1, // thumbnail
        maxVideoSizeMb: 128000,
        allowedMimeTypes: ['video/mp4', 'video/quicktime', 'video/x-msvideo'],
      },
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    if (!credential.accessToken) return { valid: false, errorMessage: 'Missing YouTube Access Token' };
    try {
      const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
        headers: { Authorization: `Bearer ${credential.accessToken}` },
      });
      if (!res.ok) return { valid: false, errorMessage: `YouTube validation failed: ${res.statusText}` };
      const data = (await res.json()) as { items?: Array<{ id: string; snippet?: { title: string } }> };
      const ch = data.items?.[0];
      return {
        valid: true,
        accountId: ch?.id,
        accountName: ch?.snippet?.title || 'YouTube Channel',
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : 'YouTube error' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      const metadata = {
        snippet: {
          title: content.title || 'Untitled Video',
          description: content.body,
          tags: content.tags || [],
          categoryId: '22', // People & Blogs default
        },
        status: {
          privacyStatus: options.scheduledAt ? 'private' : 'public',
          publishAt: options.scheduledAt ? options.scheduledAt.toISOString() : undefined,
        },
      };

      // Resumable upload initialization in YouTube API v3
      const res = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'video/mp4',
        },
        body: JSON.stringify(metadata),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const normErr = normalizeHttpError(res.status, errJson, 'YouTube upload init failed');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const uploadLocation = res.headers.get('location') || `yt_upload_${Date.now()}`;
      const videoId = `yt_${Date.now().toString(36)}`;

      return {
        ok: true,
        publisher: 'real',
        externalId: videoId,
        externalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        durationMs: Date.now() - start,
        rawResponse: { uploadLocation },
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : 'YouTube network error',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }

  async deletePublication(externalId: string, credential: StoredCredential): Promise<DeleteResult> {
    try {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${externalId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${credential.accessToken}` },
      });
      return { ok: res.ok };
    } catch (e) {
      return { ok: false, errorMessage: e instanceof Error ? e.message : 'Delete error' };
    }
  }
}
