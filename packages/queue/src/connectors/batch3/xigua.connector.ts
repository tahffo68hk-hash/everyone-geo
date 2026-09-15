import { BaseConnector } from '../base.connector';
import type {
  ChannelCapabilityDescriptor,
  ChannelCategory,
  ConnectionValidationResult,
  NormalizedPublishContent,
  PublishOptions,
  PublishResult,
  StoredCredential,
} from '../types';

export class XiguaConnector extends BaseConnector {
  readonly channel = 'XIGUA' as const;
  readonly category: ChannelCategory = 'VIDEO';

  getCapabilities(): ChannelCapabilityDescriptor {
    return {
      channel: 'XIGUA',
      category: 'VIDEO',
      displayName: '西瓜视频 (Xigua Video)',
      officialDocsUrl: 'https://open.douyin.com/',
      authorizationType: 'OAUTH2',
      implementationStatus: 'RESTRICTED',
      supportsText: true,
      supportsImages: true,
      supportsVideo: true,
      supportsCarousel: false,
      supportsScheduling: 'GEOLENS_SCHEDULING',
      supportsDelete: false,
      supportsEdit: false,
      supportsStatusQuery: true,
      supportsAnalytics: true,
      supportsWebhook: false,
      titleMax: 30,
      bodyMax: 1000,
      prerequisites: [
        '字节跳动开放平台企业开发者认证',
        '西瓜视频发布能力审批',
      ],
      assetLimits: {
        maxImages: 1,
        maxVideoSizeMb: 4000,
        allowedMimeTypes: ['video/mp4'],
      },
    };
  }

  async validateConnection(credential: StoredCredential): Promise<ConnectionValidationResult> {
    if (!credential.accessToken) return { valid: false, errorMessage: '缺少西瓜视频 Access Token' };
    return { valid: true, accountName: '西瓜视频创作者' };
  }
}
