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

export class RedditConnector extends BaseConnector {
  readonly channel = 'REDDIT' as const;
  readonly category: ChannelCategory = 'COMMUNITY';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'REDDIT',
      category: 'COMMUNITY',
      displayName: 'Reddit Subreddit Post',
      officialDocsUrl: 'https://www.reddit.com/dev/api/#POST_api_submit',
      authorizationType: 'OAUTH2',
      implementationStatus: 'READY_FOR_CREDENTIALS',
      supportsText: true,
      supportsImages: true,
      supportsVideo: true,
      supportsCarousel: false,
      supportsScheduling: 'GEOLENS_SCHEDULING',
      supportsDelete: true,
      supportsEdit: true,
      supportsStatusQuery: true,
      supportsAnalytics: true,
      supportsWebhook: false,
      titleMax: 300,
      bodyMax: 40000,
      prerequisites: ['Reddit App (script/web) credentials with scope submit, identity, read', 'Target Subreddit (sr)'],
      assetLimits: {
        maxImages: 1,
        maxVideoSizeMb: 100,
        allowedMimeTypes: ['image/jpeg', 'image/png'],
      },
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    if (!credential.accessToken) return { valid: false, errorMessage: 'Missing Reddit Access Token' };
    try {
      const res = await fetch('https://oauth.reddit.com/api/v1/me', {
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          'User-Agent': 'GeoLens-Connector/1.0',
        },
      });
      if (!res.ok) return { valid: false, errorMessage: `Reddit auth failed: ${res.statusText}` };
      const data = (await res.json()) as { name: string; id: string };
      return { valid: true, accountId: data.id, accountName: `u/${data.name}` };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : 'Reddit error' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      const subreddit = credential.channelId || (credential.extra?.subreddit as string) || 'test';
      const formParams = new URLSearchParams({
        sr: subreddit.replace(/^r\//, ''),
        kind: 'self',
        title: content.title || 'Discussion',
        text: content.body,
        api_type: 'json',
      });

      const res = await fetch('https://oauth.reddit.com/api/submit', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          'User-Agent': 'GeoLens-Connector/1.0',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formParams,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const normErr = normalizeHttpError(res.status, errJson, 'Reddit submit failed');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const data = (await res.json()) as { json?: { data?: { url?: string; id?: string; name?: string }; errors?: unknown[] } };
      if (data.json?.errors && data.json.errors.length > 0) {
        return {
          ok: false,
          publisher: 'real',
          errorMessage: `Reddit submission rejected: ${JSON.stringify(data.json.errors)}`,
          errorCode: 'PLATFORM_REJECTED',
          durationMs: Date.now() - start,
        };
      }

      const postData = data.json?.data;
      return {
        ok: true,
        publisher: 'real',
        externalId: postData?.name || postData?.id || `t3_${Date.now()}`,
        externalUrl: postData?.url,
        durationMs: Date.now() - start,
        rawResponse: postData,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : 'Reddit network error',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }

  async deletePublication(externalId: string, credential: StoredCredential): Promise<DeleteResult> {
    try {
      const formParams = new URLSearchParams({ id: externalId });
      const res = await fetch('https://oauth.reddit.com/api/del', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          'User-Agent': 'GeoLens-Connector/1.0',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formParams,
      });
      return { ok: res.ok };
    } catch (e) {
      return { ok: false, errorMessage: e instanceof Error ? e.message : 'Delete error' };
    }
  }
}
