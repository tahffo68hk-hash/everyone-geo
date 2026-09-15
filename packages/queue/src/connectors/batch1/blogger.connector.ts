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

export class BloggerConnector extends BaseConnector {
  readonly channel = 'BLOGGER' as const;
  readonly category: ChannelCategory = 'LONG_FORM';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'BLOGGER',
      category: 'LONG_FORM',
      displayName: 'Google Blogger',
      officialDocsUrl: 'https://developers.google.com/blogger/docs/3.0/reference/posts',
      authorizationType: 'OAUTH2',
      implementationStatus: 'READY_FOR_CREDENTIALS',
      supportsText: true,
      supportsImages: true,
      supportsVideo: false,
      supportsCarousel: false,
      supportsScheduling: 'NATIVE_SCHEDULING',
      supportsDelete: true,
      supportsEdit: true,
      supportsStatusQuery: true,
      supportsAnalytics: false,
      supportsWebhook: false,
      titleMax: 255,
      bodyMax: 100000,
      prerequisites: ['Google OAuth2 Client ID/Secret with scope https://www.googleapis.com/auth/blogger', 'Blog ID'],
      assetLimits: {
        maxImages: 50,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif'],
      },
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    try {
      const blogId = credential.channelId || (credential.extra?.blogId as string) || 'default';
      const token = credential.accessToken || credential.apiKey;
      const res = await fetch(`https://www.googleapis.com/blogger/v3/blogs/${blogId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        return { valid: false, errorMessage: `Blogger validation failed: ${res.statusText}` };
      }
      const data = (await res.json()) as { id?: string; name?: string; url?: string };
      return {
        valid: true,
        accountId: data.id,
        accountName: data.name || 'Blogger Site',
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : 'Blogger error' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      const blogId = credential.channelId || (credential.extra?.blogId as string) || 'default';
      const token = credential.accessToken || credential.apiKey;

      const postBody: Record<string, unknown> = {
        kind: 'blogger#post',
        title: content.title || 'Untitled Post',
        content: `<p>${content.body.replace(/\n/g, '</p><p>')}</p>`,
        labels: content.tags || [],
      };

      if (options.scheduledAt) {
        postBody.published = options.scheduledAt.toISOString();
      }

      const res = await fetch(`https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(postBody),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const normErr = normalizeHttpError(res.status, errJson, 'Blogger publish failed');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const data = (await res.json()) as { id: string; url: string };
      return {
        ok: true,
        publisher: 'real',
        externalId: data.id,
        externalUrl: data.url,
        durationMs: Date.now() - start,
        rawResponse: data,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : 'Blogger network error',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }

  async getPublicationStatus(externalId: string, credential: StoredCredential): Promise<PublicationStatusResult> {
    try {
      const blogId = credential.channelId || (credential.extra?.blogId as string) || 'default';
      const token = credential.accessToken || credential.apiKey;
      const res = await fetch(`https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts/${externalId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        return { externalId, status: 'FAILED' };
      }
      const data = (await res.json()) as { url?: string; status?: string };
      return { externalId, status: 'PUBLISHED', externalUrl: data.url };
    } catch (e) {
      return { externalId, status: 'UNKNOWN' };
    }
  }

  async deletePublication(externalId: string, credential: StoredCredential): Promise<DeleteResult> {
    try {
      const blogId = credential.channelId || (credential.extra?.blogId as string) || 'default';
      const token = credential.accessToken || credential.apiKey;
      const res = await fetch(`https://www.googleapis.com/blogger/v3/blogs/${blogId}/posts/${externalId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      return { ok: res.ok };
    } catch (e) {
      return { ok: false, errorMessage: e instanceof Error ? e.message : 'Delete error' };
    }
  }
}
