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

export class SlackConnector extends BaseConnector {
  readonly channel = 'SLACK' as const;
  readonly category: ChannelCategory = 'MESSAGING';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'SLACK',
      category: 'MESSAGING',
      displayName: 'Slack Channel / Incoming Webhook',
      officialDocsUrl: 'https://api.slack.com/methods/chat.postMessage',
      authorizationType: 'API_KEY', // Bot Token (xoxb-...) or Incoming Webhook
      implementationStatus: 'READY',
      supportsText: true,
      supportsImages: true,
      supportsVideo: false,
      supportsCarousel: false,
      supportsScheduling: 'NATIVE_SCHEDULING', // chat.scheduleMessage
      supportsDelete: true,
      supportsEdit: true,
      supportsStatusQuery: false,
      supportsAnalytics: false,
      supportsWebhook: true,
      titleMax: 150,
      bodyMax: 4000,
      prerequisites: ['Slack Bot Token (chat:write) or Incoming Webhook URL'],
      assetLimits: {
        maxImages: 10,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif'],
      },
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    try {
      if (credential.webhookUrl) {
        return { valid: true, accountName: 'Slack Webhook' };
      }
      const token = credential.apiKey || credential.accessToken;
      const res = await fetch('https://slack.com/api/auth.test', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as { ok: boolean; team?: string; user?: string; error?: string };
      if (!data.ok) {
        return { valid: false, errorMessage: `Slack auth failed: ${data.error}` };
      }
      return {
        valid: true,
        accountId: data.user,
        accountName: `${data.team} (@${data.user})`,
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : 'Slack error' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      if (credential.webhookUrl) {
        const text = content.title ? `*${content.title}*\n${content.body}` : content.body;
        const res = await fetch(credential.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          return {
            ok: false,
            publisher: 'real',
            errorMessage: `Slack webhook failed: ${res.statusText}`,
            errorCode: 'PLATFORM_REJECTED',
            durationMs: Date.now() - start,
          };
        }
        return {
          ok: true,
          publisher: 'real',
          externalId: `slack_webhook_${Date.now()}`,
          durationMs: Date.now() - start,
        };
      }

      const token = credential.apiKey || credential.accessToken;
      const channel = credential.channelId || (credential.extra?.channelId as string) || '#general';
      const endpoint = options.scheduledAt
        ? 'https://slack.com/api/chat.scheduleMessage'
        : 'https://slack.com/api/chat.postMessage';

      const payload: Record<string, unknown> = {
        channel,
        text: content.title ? `*${content.title}*\n${content.body}` : content.body,
      };

      if (options.scheduledAt) {
        payload.post_at = Math.floor(options.scheduledAt.getTime() / 1000);
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as { ok: boolean; ts?: string; channel?: string; error?: string };
      if (!data.ok) {
        return {
          ok: false,
          publisher: 'real',
          errorMessage: `Slack API error: ${data.error}`,
          errorCode: 'PLATFORM_REJECTED',
          durationMs: Date.now() - start,
        };
      }

      return {
        ok: true,
        publisher: 'real',
        externalId: data.ts || `slack_${Date.now()}`,
        durationMs: Date.now() - start,
        rawResponse: data,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : 'Slack network error',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }

  async deletePublication(externalId: string, credential: StoredCredential): Promise<DeleteResult> {
    try {
      const token = credential.apiKey || credential.accessToken;
      const channel = credential.channelId || (credential.extra?.channelId as string) || '#general';
      const res = await fetch('https://slack.com/api/chat.delete', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, ts: externalId }),
      });
      const data = (await res.json()) as { ok: boolean };
      return { ok: data.ok };
    } catch (e) {
      return { ok: false, errorMessage: e instanceof Error ? e.message : 'Delete error' };
    }
  }
}
