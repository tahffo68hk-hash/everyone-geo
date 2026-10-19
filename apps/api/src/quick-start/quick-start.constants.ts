export const CONTENT_PLATFORMS = [
  "geo",
  "xiaohongshu",
  "douyin",
  "bilibili",
  "channels",
  "kuaishou",
  "weibo",
  "wechat",
  "zhihu",
  "toutiao",
] as const;

export type ContentPlatform = (typeof CONTENT_PLATFORMS)[number];

export const MIN_QUICK_START_QUESTIONS = 8;
export const MAX_QUICK_START_QUESTIONS = 12;

export const CONTENT_PLATFORM_LABELS: Record<ContentPlatform, string> = {
  geo: "官网 SEO/GEO",
  xiaohongshu: "小红书",
  douyin: "抖音",
  bilibili: "B站",
  channels: "微信视频号",
  kuaishou: "快手",
  weibo: "微博",
  wechat: "微信公众号",
  zhihu: "知乎",
  toutiao: "今日头条/百家号",
};
