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

export class LinkedInConnector extends BaseConnector {
  readonly channel = 'LINKEDIN' as const;
  readonly category: ChannelCategory = 'SOCIAL';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'LINKEDIN',
      category: 'SOCIAL',
      displayName: 'LinkedIn Member / Organization',
      officialDocsUrl: 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api',
      authorizationType: 'OAUTH2',
      implementationStatus: 'REQUIRES_APP_REVIEW',
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
      titleMax: 120,
      bodyMax: 3000,
      prerequisites: ['LinkedIn App Review with scope w_member_social or w_organization_social'],
      assetLimits: {
        maxImages: 9,
        maxVideoSizeMb: 200,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'video/mp4'],
      },
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    if (!credential.accessToken) {
      return { valid: false, errorMessage: 'Missing LinkedIn OAuth Access Token' };
    }
    try {
      const res = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${credential.accessToken}` },
      });
      if (!res.ok) {
        return { valid: false, errorMessage: `LinkedIn auth failed: ${res.statusText}` };
      }
      const data = (await res.json()) as { sub: string; name: string; email?: string };
      return {
        valid: true,
        accountId: `urn:li:person:${data.sub}`,
        accountName: data.name,
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : 'LinkedIn error' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      const authorUrn = credential.accountId || 'urn:li:person:me';
      const payload = {
        author: authorUrn,
        commentary: content.body,
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: 'PUBLISHED',
      };

      const res = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          'LinkedIn-Version': '202401',
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const normErr = normalizeHttpError(res.status, errJson, 'LinkedIn post failed');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const postId = res.headers.get('x-restli-id') || `urn:li:share:${Date.now()}`;
      return {
        ok: true,
        publisher: 'real',
        externalId: postId,
        externalUrl: `https://www.linkedin.com/feed/update/${postId}/`,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : 'LinkedIn network error',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }

  async deletePublication(externalId: string, credential: StoredCredential): Promise<DeleteResult> {
    try {
      const res = await fetch(`https://api.linkedin.com/rest/posts/${encodeURIComponent(externalId)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          'LinkedIn-Version': '202401',
          'X-Restli-Protocol-Version': '2.0.0',
        },
      });
      return { ok: res.ok };
    } catch (e) {
      return { ok: false, errorMessage: e instanceof Error ? e.message : 'Delete error' };
    }
  }
}
