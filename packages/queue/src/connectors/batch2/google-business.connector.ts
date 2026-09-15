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

export class GoogleBusinessProfileConnector extends BaseConnector {
  readonly channel = 'GOOGLE_BUSINESS_PROFILE' as const;
  readonly category: ChannelCategory = 'LOCAL_BUSINESS';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'GOOGLE_BUSINESS_PROFILE',
      category: 'LOCAL_BUSINESS',
      displayName: 'Google Business Profile (Local Posts)',
      officialDocsUrl: 'https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts',
      authorizationType: 'OAUTH2',
      implementationStatus: 'REQUIRES_APP_REVIEW',
      supportsText: true,
      supportsImages: true,
      supportsVideo: false,
      supportsCarousel: false,
      supportsScheduling: 'GEOLENS_SCHEDULING',
      supportsDelete: true,
      supportsEdit: true,
      supportsStatusQuery: true,
      supportsAnalytics: true,
      supportsWebhook: true,
      titleMax: 80,
      bodyMax: 1500,
      prerequisites: ['Google Cloud Project with Business Profile API approval', 'OAuth scope https://www.googleapis.com/auth/business.manage', 'Verified Location ID'],
      assetLimits: {
        maxImages: 10,
        allowedMimeTypes: ['image/jpeg', 'image/png'],
      },
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    if (!credential.accessToken) return { valid: false, errorMessage: 'Missing Google OAuth Access Token' };
    try {
      const res = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
        headers: { Authorization: `Bearer ${credential.accessToken}` },
      });
      if (!res.ok) return { valid: false, errorMessage: `Google Business validation failed: ${res.statusText}` };
      const data = (await res.json()) as { accounts?: Array<{ name: string; accountName: string }> };
      const acc = data.accounts?.[0];
      return {
        valid: true,
        accountId: acc?.name,
        accountName: acc?.accountName || 'Google Business Profile Account',
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : 'Google Business error' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      const locationName = credential.channelId || (credential.extra?.locationName as string) || 'locations/default';
      const postPayload: Record<string, unknown> = {
        languageCode: 'zh-CN',
        summary: content.body,
        topicType: 'STANDARD',
      };

      if (content.coverUrl) {
        postPayload.media = [{ mediaFormat: 'PHOTO', sourceUrl: content.coverUrl }];
      }

      const res = await fetch(`https://mybusiness.googleapis.com/v4/${locationName}/localPosts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(postPayload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const normErr = normalizeHttpError(res.status, errJson, 'Google Local Post creation failed');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const data = (await res.json()) as { name: string; searchUrl?: string };
      return {
        ok: true,
        publisher: 'real',
        externalId: data.name,
        externalUrl: data.searchUrl,
        durationMs: Date.now() - start,
        rawResponse: data,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : 'Google network error',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }

  async deletePublication(externalId: string, credential: StoredCredential): Promise<DeleteResult> {
    try {
      const res = await fetch(`https://mybusiness.googleapis.com/v4/${externalId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${credential.accessToken}` },
      });
      return { ok: res.ok };
    } catch (e) {
      return { ok: false, errorMessage: e instanceof Error ? e.message : 'Delete error' };
    }
  }
}
