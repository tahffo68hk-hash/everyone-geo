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

export class DiscordConnector extends BaseConnector {
  readonly channel = 'DISCORD' as const;
  readonly category: ChannelCategory = 'COMMUNITY';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'DISCORD',
      category: 'COMMUNITY',
      displayName: 'Discord Channel / Webhook',
      officialDocsUrl: 'https://discord.com/developers/docs/resources/webhook#execute-webhook',
      authorizationType: 'API_KEY', // Webhook URL or Bot token
      implementationStatus: 'READY',
      supportsText: true,
      supportsImages: true,
      supportsVideo: false,
      supportsCarousel: false,
      supportsScheduling: 'GEOLENS_SCHEDULING',
      supportsDelete: true,
      supportsEdit: true,
      supportsStatusQuery: false,
      supportsAnalytics: false,
      supportsWebhook: true,
      titleMax: 256,
      bodyMax: 2000, // Discord message content limit
      prerequisites: ['Discord Webhook URL or Bot Token with Send Messages permission'],
      assetLimits: {
        maxImages: 10,
        maxVideoSizeMb: 25,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      },
    };
  }

  private getWebhookUrl(credential: StoredCredential): string {
    return credential.webhookUrl || credential.apiKey || 'https://discord.com/api/webhooks/mock';
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    try {
      const url = this.getWebhookUrl(credential);
      const res = await fetch(url);
      if (!res.ok) {
        return { valid: false, errorMessage: `Discord webhook invalid: ${res.statusText}` };
      }
      const data = (await res.json()) as { id?: string; name?: string; channel_id?: string };
      return {
        valid: true,
        accountId: data.id || data.channel_id,
        accountName: data.name || 'Discord Webhook',
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : 'Discord error' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      const url = this.getWebhookUrl(credential);
      const embeds: Array<Record<string, unknown>> = [];

      if (content.title || content.coverUrl) {
        embeds.push({
          title: content.title || undefined,
          description: content.summary || undefined,
          image: content.coverUrl ? { url: content.coverUrl } : undefined,
          color: 0x5865f2,
        });
      }

      const payload = {
        content: content.body,
        embeds: embeds.length > 0 ? embeds : undefined,
      };

      const res = await fetch(`${url}?wait=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const normErr = normalizeHttpError(res.status, errJson, 'Discord publish failed');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const data = (await res.json()) as { id: string; channel_id: string };
      return {
        ok: true,
        publisher: 'real',
        externalId: data.id,
        durationMs: Date.now() - start,
        rawResponse: data,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : 'Discord network error',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }

  async deletePublication(externalId: string, credential: StoredCredential): Promise<DeleteResult> {
    try {
      const url = this.getWebhookUrl(credential);
      const res = await fetch(`${url}/messages/${externalId}`, { method: 'DELETE' });
      return { ok: res.ok };
    } catch (e) {
      return { ok: false, errorMessage: e instanceof Error ? e.message : 'Delete error' };
    }
  }
}
