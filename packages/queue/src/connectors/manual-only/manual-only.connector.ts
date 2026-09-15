import { BaseConnector } from '../base.connector';
import type { Channel } from '@geo/database';
import type {
  ChannelCapabilityDescriptor,
  ChannelCategory,
  ConnectionValidationResult,
  NormalizedPublishContent,
  PublishOptions,
  PublishResult,
  StoredCredential,
} from '../types';

export interface ManualOnlyChannelConfig {
  channel: Channel;
  category: ChannelCategory;
  displayName: string;
  officialDocsUrl: string;
  titleMax: number;
  bodyMax: number;
  reason: string;
}

export class ManualOnlyConnector extends BaseConnector {
  readonly channel: Channel;
  readonly category: ChannelCategory;
  private readonly config: ManualOnlyChannelConfig;

  constructor(config: ManualOnlyChannelConfig) {
    super();
    this.channel = config.channel;
    this.category = config.category;
    this.config = config;
  }

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: this.channel,
      category: this.category,
      displayName: this.config.displayName,
      officialDocsUrl: this.config.officialDocsUrl,
      authorizationType: 'NONE',
      implementationStatus: 'MANUAL_ONLY',
      supportsText: true,
      supportsImages: true,
      supportsVideo: true,
      supportsCarousel: false,
      supportsScheduling: 'NONE',
      supportsDelete: false,
      supportsEdit: false,
      supportsStatusQuery: false,
      supportsAnalytics: false,
      supportsWebhook: false,
      titleMax: this.config.titleMax,
      bodyMax: this.config.bodyMax,
      prerequisites: [
        '官方未开放第三方 SaaS 服务端自动发布 API',
        'GeoLens 严格遵守官方安全规范，禁止 Cookie/逆向/自动化脚本发帖',
        '请通过 GeoLens 生成【人工发布包】后复制至客户端手动发布',
      ],
      assetLimits: {},
    };
  }

  async validateConnection(): Promise<ConnectionValidationResult> {
    return {
      valid: true,
      accountName: `${this.config.displayName} (人工协同通道)`,
    };
  }

  protected async doPublish(
    _content: NormalizedPublishContent,
    _credential: StoredCredential,
    _options: PublishOptions,
  ): Promise<PublishResult> {
    return {
      ok: false,
      publisher: 'mock',
      errorMessage: `${this.config.displayName} 当前官方未开放第三方代发布 API。请在控制台获取【人工发布包】并手动发表。`,
      errorCode: 'PLATFORM_UNAVAILABLE',
      durationMs: 0,
    };
  }
}

export const MANUAL_ONLY_CONFIGS: ManualOnlyChannelConfig[] = [
  {
    channel: 'XIAOHONGSHU',
    category: 'SOCIAL',
    displayName: '小红书 (Xiaohongshu)',
    officialDocsUrl: 'https://open.xiaohongshu.com/',
    titleMax: 20,
    bodyMax: 1000,
    reason: '小红书开放平台仅面向电商（千帆/Ark）与商业投放（聚光/蒲公英），无面向第三方 SaaS 的服务端笔记直发 API。移动端仅提供唤起 App 的分享 SDK。',
  },
  {
    channel: 'WECHAT_CHANNELS',
    category: 'VIDEO',
    displayName: '微信视频号 (Channels)',
    officialDocsUrl: 'https://channels.weixin.qq.com/',
    titleMax: 100,
    bodyMax: 1000,
    reason: '微信视频号无开放的第三方云端内容自动发表 API。',
  },
  {
    channel: 'ZHIHU',
    category: 'COMMUNITY',
    displayName: '知乎 (Zhihu)',
    officialDocsUrl: 'https://www.zhihu.com/',
    titleMax: 100,
    bodyMax: 50000,
    reason: '知乎未向第三方通用开发者开放文章/回答自动发布 API。',
  },
  {
    channel: 'BAIJIAHAO',
    category: 'LONG_FORM',
    displayName: '百家号 (Baijiahao)',
    officialDocsUrl: 'https://baijiahao.baidu.com/',
    titleMax: 40,
    bodyMax: 20000,
    reason: '百家号第三方开放接口已收紧为定向合作，无公开 SaaS 发帖 API。',
  },
  {
    channel: 'KUAISHOU',
    category: 'VIDEO',
    displayName: '快手 (Kuaishou)',
    officialDocsUrl: 'https://open.kuaishou.com/',
    titleMax: 100,
    bodyMax: 1000,
    reason: '快手开放平台目前代发能力收拢，第三方通用直发受限。',
  },
  {
    channel: 'SUBSTACK',
    category: 'LONG_FORM',
    displayName: 'Substack',
    officialDocsUrl: 'https://substack.com/',
    titleMax: 150,
    bodyMax: 100000,
    reason: 'Substack 官方没有面向公众开发者的公开 REST Publishing API。',
  },
  {
    channel: 'MEDIUM',
    category: 'LONG_FORM',
    displayName: 'Medium',
    officialDocsUrl: 'https://github.com/Medium/medium-api-docs',
    titleMax: 100,
    bodyMax: 50000,
    reason: 'Medium 官方已弃用 integration token 自动申请流程，不再维护第三方发布 API。',
  },
];
