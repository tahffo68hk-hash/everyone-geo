import type { Channel } from '@geo/database';
import type { NormalizedPublishContent } from '../types';

export interface ChannelContentVariant {
  channel: Channel;
  sourceDraftId?: string;
  sourceRevisionId?: string;
  title: string;
  body: string;
  summary?: string;
  tags?: string[];
  coverUrl?: string;
  requiresVideo: boolean;
  channelSpecificPayload: Record<string, unknown>;
}

export function isChannelVideoRequired(channel: Channel): boolean {
  return channel === 'BILIBILI' || channel === 'YOUTUBE' || channel === 'DOUYIN' || channel === 'XIGUA' || channel === 'TIKTOK';
}

/**
 * 渠道专属内容变体转换器（PHASE 11 · Content Transform & Lineage Tracking）。
 * 
 * 将同一份 GEO 优化稿件根据目标平台特性转换为合规的渠道发布负载，
 * 并严格保留 sourceDraftId 与 sourceRevisionId 的溯源链条。
 */
export function transformContentForChannel(
  content: NormalizedPublishContent,
  channel: Channel,
  lineage?: { sourceDraftId?: string; sourceRevisionId?: string },
): ChannelContentVariant {
  const sourceDraftId = lineage?.sourceDraftId;
  const sourceRevisionId = lineage?.sourceRevisionId;
  const tags = content.tags || [];
  const coverUrl = content.coverUrl || undefined;

  switch (channel) {
    case 'WECHAT_OFFICIAL_ACCOUNT': {
      // 微信公众号：长文排版与摘要草稿
      const title = (content.title || '微信图文分享').slice(0, 64);
      const summary = (content.summary || content.body.slice(0, 120)).slice(0, 120);
      const htmlBody = content.body.startsWith('<p>')
        ? content.body
        : '<p>' + content.body.replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br/>') + '</p>';
      const thumbMediaId = content.assets?.find((a) => a.type === 'IMAGE' || a.type === 'COVER')?.externalId || 'default_thumb_id';

      return {
        channel,
        sourceDraftId,
        sourceRevisionId,
        title,
        body: htmlBody,
        summary,
        tags,
        coverUrl,
        requiresVideo: false,
        channelSpecificPayload: {
          articles: [
            {
              title,
              author: 'GeoLens',
              digest: summary,
              content: htmlBody,
              thumb_media_id: thumbMediaId,
            },
          ],
        },
      };
    }

    case 'WEIBO': {
      // 微博：短文本格式（标题加粗括号、话题标签前缀、控制在2000字内）
      const tagStr = tags.length > 0 ? tags.map((t) => '#' + t.replace(/#/g, '') + '#').join(' ') : '';
      let statusText = '';
      if (content.title) {
        statusText += '【' + content.title + '】';
      }
      statusText += content.body;
      if (tagStr) {
        statusText += ' ' + tagStr;
      }
      const trimmedStatus = statusText.slice(0, 2000);
      const images = (content.assets || [])
        .filter((a) => a.type === 'IMAGE' || a.type === 'COVER')
        .slice(0, 9);

      return {
        channel,
        sourceDraftId,
        sourceRevisionId,
        title: (content.title || '').slice(0, 140),
        body: trimmedStatus,
        summary: content.summary || undefined,
        tags,
        coverUrl,
        requiresVideo: false,
        channelSpecificPayload: {
          status: trimmedStatus,
          imageCount: images.length,
          images: images.map((img) => ({ url: img.url, externalId: img.externalId })),
        },
      };
    }

    case 'BILIBILI': {
      // Bilibili：视频投稿稿件元数据
      const title = (content.title || '精彩视频分享').slice(0, 80);
      const desc = content.body.slice(0, 2000);
      const tagStr = tags.slice(0, 12).join(',');

      return {
        channel,
        sourceDraftId,
        sourceRevisionId,
        title,
        body: desc,
        summary: content.summary || undefined,
        tags,
        coverUrl,
        requiresVideo: true,
        channelSpecificPayload: {
          title,
          desc,
          tag: tagStr,
          tid: 174, // 知识/生活分区
          cover: coverUrl,
        },
      };
    }

    case 'YOUTUBE': {
      // YouTube：视频上传 Snippet 与私有状态保护
      const title = (content.title || 'Untitled Video').slice(0, 100);
      const description = content.body.slice(0, 5000);

      return {
        channel,
        sourceDraftId,
        sourceRevisionId,
        title,
        body: description,
        summary: content.summary || undefined,
        tags,
        coverUrl,
        requiresVideo: true,
        channelSpecificPayload: {
          snippet: {
            title,
            description,
            tags: tags.slice(0, 30),
            categoryId: '22',
          },
          status: {
            privacyStatus: 'private', // 必须强制 private
          },
        },
      };
    }

    case 'DOUYIN': {
      // 抖音：短视频文案与封面
      const title = (content.title || '').slice(0, 55);
      const caption = (content.title ? content.title + ' ' + content.body : content.body).slice(0, 1000);

      return {
        channel,
        sourceDraftId,
        sourceRevisionId,
        title,
        body: caption,
        summary: content.summary || undefined,
        tags,
        coverUrl,
        requiresVideo: true,
        channelSpecificPayload: {
          text: caption,
          coverUrl,
        },
      };
    }

    case 'TELEGRAM': {
      // Telegram: Markdown 短消息（标题加粗、标签、控制在 4096 字符）
      let text = content.body;
      if (content.title) {
        text = '*' + content.title + '*\n\n' + content.body;
      }
      if (tags.length > 0) {
        text += '\n\n' + tags.map((t) => (t.startsWith('#') ? t : '#' + t)).join(' ');
      }
      const trimmed = text.slice(0, 4096);
      return {
        channel,
        sourceDraftId,
        sourceRevisionId,
        title: (content.title || '').slice(0, 128),
        body: trimmed,
        summary: content.summary || undefined,
        tags,
        coverUrl,
        requiresVideo: false,
        channelSpecificPayload: {
          text: trimmed,
          parse_mode: 'Markdown',
        },
      };
    }

    case 'DISCORD': {
      // Discord: Webhook 消息与富文本 Embeds
      const embeds: Array<Record<string, unknown>> = [];
      if (content.title || coverUrl || content.summary) {
        embeds.push({
          title: (content.title || '').slice(0, 256) || undefined,
          description: (content.summary || content.body.slice(0, 250)) || undefined,
          image: coverUrl ? { url: coverUrl } : undefined,
          color: 0x5865f2,
        });
      }
      const trimmedBody = content.body.slice(0, 2000);
      return {
        channel,
        sourceDraftId,
        sourceRevisionId,
        title: (content.title || '').slice(0, 256),
        body: trimmedBody,
        summary: content.summary || undefined,
        tags,
        coverUrl,
        requiresVideo: false,
        channelSpecificPayload: {
          content: trimmedBody,
          embeds: embeds.length > 0 ? embeds : undefined,
        },
      };
    }

    case 'SLACK': {
      // Slack: Block/Message 纯文本（标题加粗、控制在 4000 字符）
      const text = content.title ? '*' + content.title + '*\n' + content.body : content.body;
      const trimmed = text.slice(0, 4000);
      return {
        channel,
        sourceDraftId,
        sourceRevisionId,
        title: (content.title || '').slice(0, 150),
        body: trimmed,
        summary: content.summary || undefined,
        tags,
        coverUrl,
        requiresVideo: false,
        channelSpecificPayload: {
          text: trimmed,
        },
      };
    }

    case 'MASTODON': {
      // Mastodon: 联邦宇宙嘟文（默认 unlisted 避免污染公共主线、控制在 500 字符）
      const text = (content.title ? content.title + '\n\n' + content.body : content.body).slice(0, 500);
      return {
        channel,
        sourceDraftId,
        sourceRevisionId,
        title: (content.title || '').slice(0, 100),
        body: text,
        summary: content.summary || undefined,
        tags,
        coverUrl,
        requiresVideo: false,
        channelSpecificPayload: {
          status: text,
          visibility: 'unlisted',
        },
      };
    }

    case 'BLUESKY': {
      // Bluesky: AT Protocol 帖子（控制在 300 字符内）
      const text = content.body.slice(0, 300);
      return {
        channel,
        sourceDraftId,
        sourceRevisionId,
        title: (content.title || '').slice(0, 80),
        body: text,
        summary: content.summary || undefined,
        tags,
        coverUrl,
        requiresVideo: false,
        channelSpecificPayload: {
          text,
        },
      };
    }

    case 'DEV_TO': {
      // DEV.to: 开发者长文 Markdown（强制 published: false 保持 Draft 隔离）
      const title = (content.title || 'Untitled Article').slice(0, 128);
      const cleanTags = tags.slice(0, 4).map((t) => t.replace(/[^a-zA-Z0-9]/g, '')).filter(Boolean);
      return {
        channel,
        sourceDraftId,
        sourceRevisionId,
        title,
        body: content.body,
        summary: content.summary || undefined,
        tags: cleanTags,
        coverUrl,
        requiresVideo: false,
        channelSpecificPayload: {
          article: {
            title,
            body_markdown: content.body,
            published: false, // 严格保持草稿
            tags: cleanTags,
            main_image: coverUrl,
            canonical_url: content.canonicalUrl || undefined,
          },
        },
      };
    }

    case 'THREADS': {
      // Threads: 社交短帖（控制在 500 字符）
      const text = content.body.slice(0, 500);
      return {
        channel,
        sourceDraftId,
        sourceRevisionId,
        title: (content.title || '').slice(0, 100),
        body: text,
        summary: content.summary || undefined,
        tags,
        coverUrl,
        requiresVideo: false,
        channelSpecificPayload: {
          text,
        },
      };
    }

    case 'LINKEDIN': {
      // LinkedIn: 职场专业动态（控制在 3000 字符）
      const text = (content.title ? content.title + '\n\n' + content.body : content.body).slice(0, 3000);
      return {
        channel,
        sourceDraftId,
        sourceRevisionId,
        title: (content.title || '').slice(0, 120),
        body: text,
        summary: content.summary || undefined,
        tags,
        coverUrl,
        requiresVideo: false,
        channelSpecificPayload: {
          text,
        },
      };
    }

    default: {
      return {
        channel,
        sourceDraftId,
        sourceRevisionId,
        title: content.title || '',
        body: content.body,
        summary: content.summary || undefined,
        tags,
        coverUrl,
        requiresVideo: isChannelVideoRequired(channel),
        channelSpecificPayload: {
          title: content.title,
          body: content.body,
        },
      };
    }
  }
}
