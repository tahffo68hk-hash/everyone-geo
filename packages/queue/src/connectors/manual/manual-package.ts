import type { Channel } from '@geo/database';
import type { NormalizedPublishContent } from '../types';

export interface ManualPublishingPackage {
  channel: Channel;
  title: string;
  body: string;
  hashtags: string[];
  coverUrl?: string | null;
  assetManifest: Array<{
    index: number;
    type: string;
    url: string;
    mimeType: string;
    sizeBytes?: number;
    notes?: string;
  }>;
  videoScript?: string | null;
  callToAction: string;
  checklist: string[];
  generatedAt: string;
}

export function generateManualPublishingPackage(
  channel: Channel,
  content: NormalizedPublishContent,
): ManualPublishingPackage {
  const tags = content.tags && content.tags.length > 0
    ? content.tags.map((t) => (t.startsWith('#') ? t : `#${t}`))
    : ['#AI', '#GEO', '#内容营销'];

  const title = content.title || (content.topic ? `${content.topic} 精选指南` : '精选分享');
  const body = content.body || '';

  const assets = (content.assets || []).map((a, idx) => ({
    index: idx + 1,
    type: a.type,
    url: a.url,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    notes: idx === 0 ? '主图/封面候选' : `附图/素材 ${idx + 1}`,
  }));

  let cta = '欢迎在评论区讨论交流，点赞收藏关注不迷路！';
  let checklist = [
    '登录对应平台官方创作者后台或移动客户端。',
    '按素材清单顺序上传图片或视频素材。',
    '复制上方标题填入平台标题栏。',
    '复制上方正文填入平台文本框，并在末尾附加推荐话题标签。',
    '预览排版效果，确认无误后点击发布或设为定时发布。',
  ];

  if (channel === 'XIAOHONGSHU') {
    cta = '欢迎在小红书关注我们，点赞收藏留爪，更多品牌攻略下期见！';
    checklist = [
      '打开小红书 App 或小红书网页端创作者中心 (creator.xiaohongshu.com)。',
      '点击【发布笔记】->【上传图文/视频】。',
      '首图设置封面，上传 1-9 张图片。',
      '填入标题（<=20字）与正文，添加小红书热门标签。',
      '确认合规后点击【发布】。',
    ];
  } else if (channel === 'WECHAT_CHANNELS') {
    cta = '点击右上角关注视频号，了解更多行业深度见解！';
    checklist = [
      '打开微信视频号助手 (channels.weixin.qq.com)。',
      '点击【发表动态】-> 上传视频或多图。',
      '填写动态描述，挂载公众号文章链接或位置定位。',
      '确认发布。',
    ];
  } else if (channel === 'ZHIHU') {
    cta = '感谢阅读！如果对你有启发，欢迎点赞、收藏并关注专栏。';
    checklist = [
      '登录知乎创作中心 (www.zhihu.com/creator)。',
      '选择【写文章】或在相关问题下【写回答】。',
      '粘贴正文，插入配图与排版。',
      '添加相关话题标签后发布。',
    ];
  }

  return {
    channel,
    title,
    body,
    hashtags: tags,
    coverUrl: content.coverUrl || (assets[0]?.url ?? null),
    assetManifest: assets,
    videoScript: content.metadata?.script ? String(content.metadata.script) : null,
    callToAction: cta,
    checklist,
    generatedAt: new Date().toISOString(),
  };
}
