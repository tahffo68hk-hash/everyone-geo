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

export class PinterestConnector extends BaseConnector {
  readonly channel = 'PINTEREST' as const;
  readonly category: ChannelCategory = 'SOCIAL';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'PINTEREST',
      category: 'SOCIAL',
      displayName: 'Pinterest',
      officialDocsUrl: 'https://developers.pinterest.com/docs/api/v5/#operation/pins/create',
      authorizationType: 'OAUTH2',
      implementationStatus: 'REQUIRES_APP_REVIEW',
      supportsText: true,
      supportsImages: true,
      supportsVideo: true,
      supportsCarousel: false,
      supportsScheduling: 'GEOLENS_SCHEDULING',
      supportsDelete: true,
      supportsEdit: true,
      supportsStatusQuery: true,
      supportsAnalytics: true,
      supportsWebhook: true,
      titleMax: 100,
      bodyMax: 500,
      prerequisites: ['Pinterest App Review with scope pins:write, boards:read, and Board ID'],
      assetLimits: {
        maxImages: 1,
        maxVideoSizeMb: 100,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'video/mp4'],
      },
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    if (!credential.accessToken) return { valid: false, errorMessage: 'Missing Pinterest Access Token' };
    try {
      const res = await fetch('https://api.pinterest.com/v5/user_account', {
        headers: { Authorization: `Bearer ${credential.accessToken}` },
      });
      if (!res.ok) return { valid: false, errorMessage: `Pinterest auth failed: ${res.statusText}` };
      const data = (await res.json()) as { username: string; account_type: string };
      return { valid: true, accountName: `@${data.username}` };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : 'Pinterest error' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      const boardId = credential.channelId || (credential.extra?.boardId as string) || 'default-board';
      const pinPayload: Record<string, unknown> = {
        title: content.title || 'Pin',
        description: content.body,
        board_id: boardId,
        media_source: {
          source_type: 'image_url',
          url: content.coverUrl || content.assets?.[0]?.url || 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809',
        },
      };

      const res = await fetch('https://api.pinterest.com/v5/pins', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pinPayload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const normErr = normalizeHttpError(res.status, errJson, 'Pinterest pin creation failed');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const data = (await res.json()) as { id: string; link?: string };
      return {
        ok: true,
        publisher: 'real',
        externalId: data.id,
        externalUrl: data.link || `https://www.pinterest.com/pin/${data.id}/`,
        durationMs: Date.now() - start,
        rawResponse: data,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : 'Pinterest network error',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }

  async deletePublication(externalId: string, credential: StoredCredential): Promise<DeleteResult> {
    try {
      const res = await fetch(`https://api.pinterest.com/v5/pins/${externalId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${credential.accessToken}` },
      });
      return { ok: res.ok };
    } catch (e) {
      return { ok: false, errorMessage: e instanceof Error ? e.message : 'Delete error' };
    }
  }
}
