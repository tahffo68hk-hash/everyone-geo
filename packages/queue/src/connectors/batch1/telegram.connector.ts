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

export class TelegramConnector extends BaseConnector {
  readonly channel = 'TELEGRAM' as const;
  readonly category: ChannelCategory = 'MESSAGING';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'TELEGRAM',
      category: 'MESSAGING',
      displayName: 'Telegram Channel / Group',
      officialDocsUrl: 'https://core.telegram.org/bots/api#sendmessage',
      authorizationType: 'API_KEY', // Bot token + chat_id
      implementationStatus: 'READY',
      supportsText: true,
      supportsImages: true,
      supportsVideo: true,
      supportsCarousel: false,
      supportsScheduling: 'GEOLENS_SCHEDULING',
      supportsDelete: true,
      supportsEdit: true,
      supportsStatusQuery: false,
      supportsAnalytics: false,
      supportsWebhook: true,
      titleMax: 128,
      bodyMax: 4096, // Telegram message text limit
      prerequisites: ['Telegram Bot Token and Target Chat ID (@channel or -100xxx)'],
      assetLimits: {
        maxImages: 10,
        maxVideoSizeMb: 50,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'],
      },
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    try {
      const token = credential.apiKey || credential.accessToken;
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      if (!res.ok) {
        return { valid: false, errorMessage: `Telegram token invalid: ${res.statusText}` };
      }
      const data = (await res.json()) as { ok: boolean; result?: { id: number; username: string; first_name: string } };
      if (!data.ok || !data.result) {
        return { valid: false, errorMessage: 'Telegram getMe failed' };
      }
      return {
        valid: true,
        accountId: String(data.result.id),
        accountName: `@${data.result.username} (${data.result.first_name})`,
      };
    } catch (e) {
      return { valid: false, errorMessage: e instanceof Error ? e.message : 'Telegram error' };
    }
  }

  protected async doPublish(
    content: NormalizedPublishContent,
    credential: StoredCredential,
    options: PublishOptions,
  ): Promise<PublishResult> {
    const start = Date.now();
    try {
      const token = credential.apiKey || credential.accessToken;
      const chatId = credential.chatId || (credential.extra?.chatId as string) || '@geolens';

      let text = content.body;
      if (content.title) {
        text = `*${content.title}*\n\n${content.body}`;
      }
      if (content.tags && content.tags.length > 0) {
        text += `\n\n${content.tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ')}`;
      }

      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const normErr = normalizeHttpError(res.status, errJson, 'Telegram sendMessage failed');
        return {
          ok: false,
          publisher: 'real',
          errorMessage: normErr.safeMessage,
          errorCode: normErr.code,
          durationMs: Date.now() - start,
        };
      }

      const data = (await res.json()) as { ok: boolean; result?: { message_id: number; chat?: { username?: string; id?: number } } };
      const msgId = data.result?.message_id || Date.now();
      const channelUsername = data.result?.chat?.username;
      const externalUrl = channelUsername ? `https://t.me/${channelUsername}/${msgId}` : undefined;

      return {
        ok: true,
        publisher: 'real',
        externalId: String(msgId),
        externalUrl,
        durationMs: Date.now() - start,
        rawResponse: data.result,
      };
    } catch (e) {
      return {
        ok: false,
        publisher: 'real',
        errorMessage: e instanceof Error ? e.message : 'Telegram network error',
        errorCode: 'PLATFORM_UNAVAILABLE',
        durationMs: Date.now() - start,
      };
    }
  }

  async deletePublication(externalId: string, credential: StoredCredential): Promise<DeleteResult> {
    try {
      const token = credential.apiKey || credential.accessToken;
      const chatId = credential.chatId || (credential.extra?.chatId as string) || '@geolens';
      const res = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: Number(externalId) }),
      });
      return { ok: res.ok };
    } catch (e) {
      return { ok: false, errorMessage: e instanceof Error ? e.message : 'Delete error' };
    }
  }
}
