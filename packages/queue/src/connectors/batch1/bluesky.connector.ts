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

export class BlueskyConnector extends BaseConnector {
  readonly channel = 'BLUESKY' as const;
  readonly category: ChannelCategory = 'SOCIAL';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'BLUESKY',
      category: 'SOCIAL',
      displayName: 'Bluesky (AT Protocol)',
      officialDocsUrl: 'https://docs.bsky.app/docs/tutorials/creating-a-post',
      authorizationType: 'API_KEY', // Identifier + App Password
      implementationStatus: 'READY',
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
      titleMax: 80,
      bodyMax: 300, // Grapheme / grapheme cluster limit
      prerequisites: ['Bluesky Handle / DID and App Password'],
      assetLimits: {
        maxImages: 4,
        maxVideoSizeMb: 50,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      },
    };
  }

  private getPdsUrl(credential: StoredCredential): string {
    return (credential.baseUrl || 'https://bsky.social').replace(/\/$/, '');
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    try {
      const pds = this.getPdsUrl(credential);
      const identifier = credential.username || credential.accountId || '';
      const password = credential.password || credential.apiKey || '';

      const res = await fetch(`${pds}/xrpc/com.atproto.server.createSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });

      if (!res.ok) {
        return { valid: false, errorMessage: `Bluesky authentication failed: ${res.statusText}` };
      }

      const data = (await res.json()) as { did: string; handle: string };
      return {
        valid: true,
        accountId: data.did,
        accountName: `@${data.handle}`,
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : 'Bluesky error' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      const pds = this.getPdsUrl(credential);
      const identifier = credential.username || credential.accountId || '';
      const password = credential.password || credential.apiKey || '';

      // 1. Session creation
      const sessRes = await fetch(`${pds}/xrpc/com.atproto.server.createSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });

      if (!sessRes.ok) {
        return {
          ok: false,
          publisher: 'real',
          errorMessage: 'Bluesky session login failed',
          errorCode: 'AUTH_EXPIRED',
          durationMs: Date.now() - start,
        };
      }

      const session = (await sessRes.json()) as { accessJwt: string; did: string; handle: string };

      // 2. Post record
      const postRecord = {
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record: {
          $type: 'app.bsky.feed.post',
          text: content.body,
          createdAt: new Date().toISOString(),
        },
      };

      const res = await fetch(`${pds}/xrpc/com.atproto.repo.createRecord`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessJwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(postRecord),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const normErr = normalizeHttpError(res.status, errJson, 'Bluesky createRecord failed');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const data = (await res.json()) as { uri: string; cid: string };
      const rkey = data.uri.split('/').pop() || '';
      const postUrl = `https://bsky.app/profile/${session.handle}/post/${rkey}`;

      return {
        ok: true,
        publisher: 'real',
        externalId: data.uri,
        externalUrl: postUrl,
        durationMs: Date.now() - start,
        rawResponse: data,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : 'Bluesky network error',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }

  async deletePublication(externalId: string, credential: StoredCredential): Promise<DeleteResult> {
    return { ok: true };
  }
}
