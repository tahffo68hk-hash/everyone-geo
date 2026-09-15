import type { Channel } from '@geo/database';
import type { ChannelCapabilityDescriptor, ChannelCategory, ChannelConnector } from '../types';
import { WordPressConnector } from '../batch1/wordpress.connector';
import { GhostConnector } from '../batch1/ghost.connector';
import { WebflowConnector } from '../batch1/webflow.connector';
import { BloggerConnector } from '../batch1/blogger.connector';
import { DevToConnector } from '../batch1/devto.connector';
import { MastodonConnector } from '../batch1/mastodon.connector';
import { BlueskyConnector } from '../batch1/bluesky.connector';
import { TelegramConnector } from '../batch1/telegram.connector';
import { DiscordConnector } from '../batch1/discord.connector';
import { SlackConnector } from '../batch1/slack.connector';
import { ThreadsConnector } from '../batch2/threads.connector';
import { LinkedInConnector } from '../batch2/linkedin.connector';
import { PinterestConnector } from '../batch2/pinterest.connector';
import { XConnector } from '../batch2/x.connector';
import { RedditConnector } from '../batch2/reddit.connector';
import { GoogleBusinessProfileConnector } from '../batch2/google-business.connector';
import { YouTubeConnector } from '../batch2/youtube.connector';
import { DouyinConnector } from '../batch3/douyin.connector';
import { BilibiliConnector } from '../batch3/bilibili.connector';
import { WeiboConnector } from '../batch3/weibo.connector';
import { WeChatOfficialAccountConnector } from '../batch3/wechat-official.connector';
import { ToutiaoConnector } from '../batch3/toutiao.connector';
import { XiguaConnector } from '../batch3/xigua.connector';
import { TikTokConnector } from '../batch3/tiktok.connector';
import { InstagramConnector } from '../batch3/instagram.connector';
import { FacebookConnector } from '../batch3/facebook.connector';
import { BaiduSearchSurfaceConnector } from '../search-surface/baidu-search.connector';
import { MANUAL_ONLY_CONFIGS, ManualOnlyConnector } from '../manual-only/manual-only.connector';

export class ConnectorRegistry {
  private readonly connectors = new Map<Channel, ChannelConnector>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    // 第一批 (优先完整实现)
    this.register(new WordPressConnector());
    this.register(new GhostConnector());
    this.register(new WebflowConnector());
    this.register(new BloggerConnector());
    this.register(new DevToConnector());
    this.register(new MastodonConnector());
    this.register(new BlueskyConnector());
    this.register(new TelegramConnector());
    this.register(new DiscordConnector());
    this.register(new SlackConnector());

    // 第二批
    this.register(new ThreadsConnector());
    this.register(new LinkedInConnector());
    this.register(new PinterestConnector());
    this.register(new XConnector());
    this.register(new RedditConnector());
    this.register(new GoogleBusinessProfileConnector());
    this.register(new YouTubeConnector());

    // 第三批 (国内 + 海外媒体)
    this.register(new DouyinConnector());
    this.register(new BilibiliConnector());
    this.register(new WeiboConnector());
    this.register(new WeChatOfficialAccountConnector());
    this.register(new ToutiaoConnector());
    this.register(new XiguaConnector());
    this.register(new TikTokConnector());
    this.register(new InstagramConnector());
    this.register(new FacebookConnector());

    // 独立 Search Surface
    this.register(new BaiduSearchSurfaceConnector());

    // 暂时禁止自动连接器 (MANUAL_ONLY)
    for (const config of MANUAL_ONLY_CONFIGS) {
      this.register(new ManualOnlyConnector(config));
    }

    // 兼容既有枚举别名
    const wechatMp = this.connectors.get('WECHAT_OFFICIAL_ACCOUNT');
    if (wechatMp) {
      this.connectors.set('WECHAT', wechatMp);
    }
    const baiduSearch = this.connectors.get('BAIDU_SEARCH_SURFACE');
    if (baiduSearch) {
      this.connectors.set('BAIDU', baiduSearch);
    }
  }

  register(connector: ChannelConnector): void {
    this.connectors.set(connector.channel, connector);
  }

  getConnector(channel: Channel): ChannelConnector | undefined {
    return this.connectors.get(channel);
  }

  hasConnector(channel: Channel): boolean {
    return this.connectors.has(channel);
  }

  listConnectors(): ChannelConnector[] {
    return Array.from(this.connectors.values());
  }

  listCapabilities(): ChannelCapabilityDescriptor[] {
    // 排除别名重复项，保持单一渠道源
    const seen = new Set<string>();
    const list: ChannelCapabilityDescriptor[] = [];
    for (const connector of this.connectors.values()) {
      if (!seen.has(connector.channel)) {
        seen.add(connector.channel);
        list.push(connector.getCapabilities());
      }
    }
    return list;
  }

  getCapabilities(channel: Channel): ChannelCapabilityDescriptor | undefined {
    return this.connectors.get(channel)?.getCapabilities();
  }

  listByCategory(category: ChannelCategory): ChannelCapabilityDescriptor[] {
    return this.listCapabilities().filter((c) => c.category === category);
  }
}

export const defaultConnectorRegistry = new ConnectorRegistry();
