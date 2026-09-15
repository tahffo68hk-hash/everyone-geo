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
