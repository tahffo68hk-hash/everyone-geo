/**
 * GeoLens 平台内容能力与规则配置中心 (Channel Rules & Capabilities Ledger)
 * 严格依据各平台官方规则与实际创作页面建立，杜绝虚假硬编码
 * 统一处理：发布形式、字数统计规则、特殊符号转换、Markdown清洗、标签语法与合规校验
 */

export type ContentFormatType = "ARTICLE" | "IMAGE_TEXT" | "VIDEO_SCRIPT";
export type AutomationCapability = "BROWSER_ASSISTED" | "OFFICIAL_API" | "MANUAL_PACKAGE";
export type TagFormat = "HASH" | "DOUBLE_HASH" | "BARE";

export interface ChannelRuleSpec {
  id: string;
  name: string;
  category: "社交图文" | "深度问答" | "短视频/直播" | "中长视频" | "私域生态" | "媒体资讯" | "官方站点" | "本地仿真";
  icon: string;
  color: string;
  badgeBg: string;
  supportedFormats: ContentFormatType[];
  primaryFormat: ContentFormatType;
  titleLimit: {
    min: number;
    max: number;
    countMode: "CHAR" | "BYTE";
    label: string;
  };
  bodyLimit: {
    min: number;
    max: number;
    supportsMarkdown: boolean;
    label: string;
  };
  tagsLimit: {
    max: number;
    format: TagFormat;
    label: string;
  };
  mediaSpecs: {
    minImages: number;
    maxImages: number;
    imageRatio: string;
    imageFormats: string[];
    maxImageBytes: number;
    videoRequired: boolean;
    videoFormats?: string[];
    maxVideoBytes?: number;
    videoRatio?: string;
    coverRequired: boolean;
  };
  automationCapability: AutomationCapability;
  supportsScheduled: boolean;
  officialApiAvailable: boolean;
  browserAssistedAvailable: boolean;
  mustRequireHumanConfirm: boolean;
  creatorUrl: string;
  creationTypeLabel: string;
  verifiedDate: string;
  description: string;
  tips: string;
}

export const CHANNEL_SPECS: Record<string, ChannelRuleSpec> = {
  XIAOHONGSHU: {
    id: "XIAOHONGSHU",
    name: "小红书",
    category: "社交图文",
    icon: "📕",
    color: "rose",
    badgeBg: "bg-rose-50 text-rose-700 border-rose-200",
    supportedFormats: ["IMAGE_TEXT", "VIDEO_SCRIPT"],
    primaryFormat: "IMAGE_TEXT",
    titleLimit: {
      min: 1,
      max: 20,
      countMode: "CHAR",
      label: "笔记标题（严格限制 20 字以内，不得换行）",
    },
    bodyLimit: {
      min: 10,
      max: 1000,
      supportsMarkdown: false,
      label: "笔记正文（1000 字以内，纯文本排版，保留 Emoji 与空行段落）",
    },
    tagsLimit: {
      max: 10,
      format: "HASH",
      label: "话题标签（最多 10 个，格式如 #话题名）",
    },
    mediaSpecs: {
      minImages: 1,
      maxImages: 9,
      imageRatio: "3:4 或 1:1",
      imageFormats: ["jpg", "jpeg", "png", "webp"],
      maxImageBytes: 10 * 1024 * 1024,
      videoRequired: false,
      videoFormats: ["mp4", "mov"],
      maxVideoBytes: 1024 * 1024 * 1024,
      videoRatio: "3:4 或 9:16",
      coverRequired: true,
    },
    automationCapability: "BROWSER_ASSISTED",
    supportsScheduled: true,
    officialApiAvailable: false,
    browserAssistedAvailable: true,
    mustRequireHumanConfirm: true,
    creatorUrl: "https://creator.xiaohongshu.com/publish/publish?source=official",
    creationTypeLabel: "上传图文",
    verifiedDate: "2026-10",
    description: "生活生活种草与实用经验笔记，需要 1-9 张图与精炼标题，受控浏览器辅助填表 (PREPARE_ONLY)。",
    tips: "小红书硬性限制标题 <= 20 字符。不支持 Markdown 语法，正文建议使用短段落与表情符号分段。",
  },
  ZHIHU: {
    id: "ZHIHU",
    name: "知乎",
    category: "深度问答",
    icon: "📖",
    color: "sky",
    badgeBg: "bg-sky-50 text-sky-700 border-sky-200",
    supportedFormats: ["ARTICLE"],
    primaryFormat: "ARTICLE",
    titleLimit: {
      min: 2,
      max: 100,
      countMode: "CHAR",
      label: "专栏标题（100 字以内，突出论题与核心论点）",
    },
    bodyLimit: {
      min: 50,
      max: 50000,
      supportsMarkdown: true,
      label: "专栏正文（支持完整 Markdown 语法、二级标题、代码块与事实论据）",
    },
    tagsLimit: {
      max: 5,
      format: "BARE",
      label: "专栏话题（最多 5 个，输入纯话题名称，不加 #）",
    },
    mediaSpecs: {
      minImages: 0,
      maxImages: 20,
      imageRatio: "16:9 横版封面或正文配图",
      imageFormats: ["jpg", "jpeg", "png", "webp"],
      maxImageBytes: 10 * 1024 * 1024,
      videoRequired: false,
      coverRequired: false,
    },
    automationCapability: "BROWSER_ASSISTED",
    supportsScheduled: false,
    officialApiAvailable: false,
    browserAssistedAvailable: true,
    mustRequireHumanConfirm: true,
    creatorUrl: "https://zhuanlan.zhihu.com/write",
    creationTypeLabel: "写文章",
    verifiedDate: "2026-10",
    description: "专业深度长文与问答专栏，支持 Markdown 原生排版，受控 Chrome 辅助进入专栏编辑器。",
    tips: "知乎专栏支持完整 Markdown，话题在文末输入无须 # 号前缀。",
  },
  WECHAT_OFFICIAL_ACCOUNT: {
    id: "WECHAT_OFFICIAL_ACCOUNT",
    name: "微信公众号",
    category: "私域生态",
    icon: "💬",
    color: "emerald",
    badgeBg: "bg-emerald-50 text-emerald-700 border-emerald-200",
    supportedFormats: ["ARTICLE"],
    primaryFormat: "ARTICLE",
    titleLimit: {
      min: 1,
      max: 64,
      countMode: "CHAR",
      label: "图文标题（64 字以内，建议 20-35 字有力表达）",
    },
    bodyLimit: {
      min: 50,
      max: 20000,
      supportsMarkdown: false,
      label: "图文正文（富文本 HTML 排版，保留分段与小标题）",
    },
    tagsLimit: {
      max: 3,
      format: "BARE",
      label: "合集与标签（最多 3 个）",
    },
    mediaSpecs: {
      minImages: 1,
      maxImages: 30,
      imageRatio: "2.35:1 封面大图 (900:383) 或 1:1 次图",
      imageFormats: ["jpg", "jpeg", "png"],
      maxImageBytes: 10 * 1024 * 1024,
      videoRequired: false,
      coverRequired: true,
    },
    automationCapability: "OFFICIAL_API",
    supportsScheduled: true,
    officialApiAvailable: true,
    browserAssistedAvailable: true,
    mustRequireHumanConfirm: true,
    creatorUrl: "https://mp.weixin.qq.com/",
    creationTypeLabel: "新建图文消息",
    verifiedDate: "2026-10",
    description: "微信公众平台图文消息。提供【草稿箱】API 隔离同步与本地受控浏览器辅助，杜绝越权群发。",
    tips: "内容自动入库微信【草稿箱】，需管理员扫码预览后在微信公众后台决定最终发布。",
  },
  BILIBILI: {
    id: "BILIBILI",
    name: "哔哩哔哩 (B站)",
    category: "中长视频",
    icon: "📺",
    color: "pink",
    badgeBg: "bg-pink-50 text-pink-700 border-pink-200",
    supportedFormats: ["VIDEO_SCRIPT", "ARTICLE"],
    primaryFormat: "VIDEO_SCRIPT",
    titleLimit: {
      min: 1,
      max: 80,
      countMode: "CHAR",
      label: "稿件标题（80 字以内）",
    },
    bodyLimit: {
      min: 1,
      max: 2000,
      supportsMarkdown: false,
      label: "稿件简介/视频说明（2000 字以内）",
    },
    tagsLimit: {
      max: 12,
      format: "BARE",
      label: "投稿标签（最多 12 个，按回车添加）",
    },
    mediaSpecs: {
      minImages: 1,
      maxImages: 1,
      imageRatio: "16:9 横版封面 (建议 1146:717)",
      imageFormats: ["jpg", "jpeg", "png"],
      maxImageBytes: 5 * 1024 * 1024,
      videoRequired: true,
      videoFormats: ["mp4", "mov", "webm", "flv"],
      maxVideoBytes: 4 * 1024 * 1024 * 1024,
      videoRatio: "16:9 或 9:16",
      coverRequired: true,
    },
    automationCapability: "BROWSER_ASSISTED",
    supportsScheduled: true,
    officialApiAvailable: false,
    browserAssistedAvailable: true,
    mustRequireHumanConfirm: true,
    creatorUrl: "https://member.bilibili.com/platform/upload/video/frame",
    creationTypeLabel: "视频投稿",
    verifiedDate: "2026-10",
    description: "B站创作中心视频投稿与专栏长文，自动清除草稿恢复浮层，PREPARE_ONLY 停留在投稿确认前。",
    tips: "视频渠道需提供成片 mp4 或由系统调起本地仿真投稿，简介支持章节与时间轴标注。",
  },
  DOUYIN: {
    id: "DOUYIN",
    name: "抖音创作者平台",
    category: "短视频/直播",
    icon: "🎵",
    color: "slate",
    badgeBg: "bg-slate-900 text-white border-slate-700",
    supportedFormats: ["VIDEO_SCRIPT", "IMAGE_TEXT"],
    primaryFormat: "VIDEO_SCRIPT",
    titleLimit: {
      min: 1,
      max: 55,
      countMode: "CHAR",
      label: "作品标题/文案（55 字以内，含话题）",
    },
    bodyLimit: {
      min: 1,
      max: 1000,
      supportsMarkdown: false,
      label: "分镜脚本与口播台词（1000 字以内）",
    },
    tagsLimit: {
      max: 5,
      format: "HASH",
      label: "热门话题（以 # 开头，最多 5 个）",
    },
    mediaSpecs: {
      minImages: 1,
      maxImages: 12,
      imageRatio: "9:16 竖版 (短剧/图文)",
      imageFormats: ["jpg", "jpeg", "png"],
      maxImageBytes: 10 * 1024 * 1024,
      videoRequired: true,
      videoFormats: ["mp4", "mov"],
      maxVideoBytes: 2 * 1024 * 1024 * 1024,
      videoRatio: "9:16 竖版",
      coverRequired: true,
    },
    automationCapability: "BROWSER_ASSISTED",
    supportsScheduled: true,
    officialApiAvailable: false,
    browserAssistedAvailable: true,
    mustRequireHumanConfirm: true,
    creatorUrl: "https://creator.douyin.com/creator-micro/content/upload",
    creationTypeLabel: "发布视频",
    verifiedDate: "2026-10",
    description: "抖音创作者服务平台短视频与图文，支持视频上传、文案、封面与合集配置。",
    tips: "抖音标题与正文常合并为一段文案，文案中嵌入 #话题 标签，视频前 3 秒建议添加强悬念 Hook。",
  },
  WECHAT_CHANNELS: {
    id: "WECHAT_CHANNELS",
    name: "微信视频号",
    category: "短视频/直播",
    icon: "📹",
    color: "orange",
    badgeBg: "bg-orange-50 text-orange-700 border-orange-200",
    supportedFormats: ["VIDEO_SCRIPT"],
    primaryFormat: "VIDEO_SCRIPT",
    titleLimit: {
      min: 1,
      max: 1000,
      countMode: "CHAR",
      label: "动态描述文案（含 #话题 与公众号链接）",
    },
    bodyLimit: {
      min: 1,
      max: 1000,
      supportsMarkdown: false,
      label: "视频脚本与字幕口播（1000 字以内）",
    },
    tagsLimit: {
      max: 10,
      format: "HASH",
      label: "视频号话题（以 # 开头）",
    },
    mediaSpecs: {
      minImages: 0,
      maxImages: 1,
      imageRatio: "6:7 或 16:9",
      imageFormats: ["jpg", "jpeg", "png"],
      maxImageBytes: 5 * 1024 * 1024,
      videoRequired: true,
      videoFormats: ["mp4", "mov"],
      maxVideoBytes: 1024 * 1024 * 1024,
      videoRatio: "6:7 或 9:16",
      coverRequired: true,
    },
    automationCapability: "BROWSER_ASSISTED",
    supportsScheduled: false,
    officialApiAvailable: false,
    browserAssistedAvailable: true,
    mustRequireHumanConfirm: true,
    creatorUrl: "https://channels.weixin.qq.com/platform/post/create",
    creationTypeLabel: "发表动态",
    verifiedDate: "2026-10",
    description: "微信视频号助手视频发布，支持文案挂载公众号文章链接沉淀私域。",
    tips: "文案末尾可插入微信公众号同名文章链接，实现公私域联动转转化。",
  },
  WEIBO: {
    id: "WEIBO",
    name: "微博",
    category: "社交图文",
    icon: "🔴",
    color: "red",
    badgeBg: "bg-red-50 text-red-700 border-red-200",
    supportedFormats: ["IMAGE_TEXT", "ARTICLE"],
    primaryFormat: "IMAGE_TEXT",
    titleLimit: {
      min: 1,
      max: 140,
      countMode: "CHAR",
      label: "微博文案（常规 140 字，会员支持长微博）",
    },
    bodyLimit: {
      min: 1,
      max: 2000,
      supportsMarkdown: false,
      label: "微博正文（含双井号话题 #话题#）",
    },
    tagsLimit: {
      max: 5,
      format: "DOUBLE_HASH",
      label: "微博双井号话题（如 #核心话题#）",
    },
    mediaSpecs: {
      minImages: 0,
      maxImages: 9,
      imageRatio: "1:1 或 16:9",
      imageFormats: ["jpg", "jpeg", "png", "gif"],
      maxImageBytes: 5 * 1024 * 1024,
      videoRequired: false,
      coverRequired: false,
    },
    automationCapability: "BROWSER_ASSISTED",
    supportsScheduled: true,
    officialApiAvailable: false,
    browserAssistedAvailable: true,
    mustRequireHumanConfirm: true,
    creatorUrl: "https://weibo.com/",
    creationTypeLabel: "发微博",
    verifiedDate: "2026-10",
    description: "微博公域快讯与热门话题扩散，支持 9 宫格图片与双井号话题。",
    tips: "微博话题需用前后双井号包裹（例如 #瑞幸生椰拿铁#），建议在文末附带互动福利提问。",
  },
  KUAISHOU: {
    id: "KUAISHOU",
    name: "快手",
    category: "短视频/直播",
    icon: "⚡",
    color: "amber",
    badgeBg: "bg-amber-50 text-amber-700 border-amber-200",
    supportedFormats: ["VIDEO_SCRIPT"],
    primaryFormat: "VIDEO_SCRIPT",
    titleLimit: {
      min: 1,
      max: 500,
      countMode: "CHAR",
      label: "作品文案描述（500 字以内）",
    },
    bodyLimit: {
      min: 1,
      max: 500,
      supportsMarkdown: false,
      label: "短视频台词口播（500 字以内）",
    },
    tagsLimit: {
      max: 5,
      format: "HASH",
      label: "快手话题（以 # 开头）",
    },
    mediaSpecs: {
      minImages: 0,
      maxImages: 1,
      imageRatio: "9:16 竖版",
      imageFormats: ["jpg", "jpeg", "png"],
      maxImageBytes: 5 * 1024 * 1024,
      videoRequired: true,
      videoFormats: ["mp4", "mov"],
      maxVideoBytes: 1024 * 1024 * 1024,
      videoRatio: "9:16 竖版",
      coverRequired: true,
    },
    automationCapability: "BROWSER_ASSISTED",
    supportsScheduled: false,
    officialApiAvailable: false,
    browserAssistedAvailable: true,
    mustRequireHumanConfirm: true,
    creatorUrl: "https://cp.kuaishou.com/article/publish/video",
    creationTypeLabel: "发布视频",
    verifiedDate: "2026-10",
    description: "快手创作者服务平台短视频上传与文案填充，PREPARE_ONLY 停留在最终发布前。",
    tips: "强调亲和力与口语化表达，贴近真实生活场景。",
  },
  TOUTIAO: {
    id: "TOUTIAO",
    name: "今日头条",
    category: "媒体资讯",
    icon: "📰",
    color: "red",
    badgeBg: "bg-red-50 text-red-700 border-red-200",
    supportedFormats: ["ARTICLE", "IMAGE_TEXT"],
    primaryFormat: "ARTICLE",
    titleLimit: {
      min: 5,
      max: 30,
      countMode: "CHAR",
      label: "文章标题（5-30 字，严谨客观，避免标题党）",
    },
    bodyLimit: {
      min: 100,
      max: 10000,
      supportsMarkdown: false,
      label: "头条文章正文（图文资讯，清晰小标题与事实数据）",
    },
    tagsLimit: {
      max: 5,
      format: "HASH",
      label: "相关话题与领域分类",
    },
    mediaSpecs: {
      minImages: 1,
      maxImages: 20,
      imageRatio: "16:9 横版",
      imageFormats: ["jpg", "jpeg", "png"],
      maxImageBytes: 10 * 1024 * 1024,
      videoRequired: false,
      coverRequired: true,
    },
    automationCapability: "BROWSER_ASSISTED",
    supportsScheduled: true,
    officialApiAvailable: false,
    browserAssistedAvailable: true,
    mustRequireHumanConfirm: true,
    creatorUrl: "https://mp.toutiao.com/profile_v4/graphic/publish",
    creationTypeLabel: "写文章",
    verifiedDate: "2026-10",
    description: "今日头条创作者服务平台图文文章，强调信息增量与客观深度。",
    tips: "标题避免过度夸张；正文突出段落层次，多图佐证更易通过审核与获得推荐。",
  },
  BAIJIAHAO: {
    id: "BAIJIAHAO",
    name: "百家号",
    category: "媒体资讯",
    icon: "🔍",
    color: "blue",
    badgeBg: "bg-blue-50 text-blue-700 border-blue-200",
    supportedFormats: ["ARTICLE"],
    primaryFormat: "ARTICLE",
    titleLimit: {
      min: 5,
      max: 30,
      countMode: "CHAR",
      label: "文章标题（5-30 字，适配百度搜索与资讯流）",
    },
    bodyLimit: {
      min: 100,
      max: 10000,
      supportsMarkdown: false,
      label: "百家号正文（百度 SEO 友好型长文排版）",
    },
    tagsLimit: {
      max: 5,
      format: "BARE",
      label: "分类标签（最多 5 个）",
    },
    mediaSpecs: {
      minImages: 1,
      maxImages: 15,
      imageRatio: "16:9 横版三图或单图",
      imageFormats: ["jpg", "jpeg", "png"],
      maxImageBytes: 10 * 1024 * 1024,
      videoRequired: false,
      coverRequired: true,
    },
    automationCapability: "BROWSER_ASSISTED",
    supportsScheduled: true,
    officialApiAvailable: false,
    browserAssistedAvailable: true,
    mustRequireHumanConfirm: true,
    creatorUrl: "https://baijiahao.baidu.com/builder/rc/edit?type=news",
    creationTypeLabel: "发图文",
    verifiedDate: "2026-10",
    description: "百度百家号图文创作，享受百度搜索引擎收录加权与 AI 摘要收录。",
    tips: "核心搜索关键词前置在标题与首段，文末保留权威论证与事实来源。",
  },
  WORDPRESS: {
    id: "WORDPRESS",
    name: "WordPress / 企业 CMS",
    category: "官方站点",
    icon: "🌐",
    color: "indigo",
    badgeBg: "bg-indigo-50 text-indigo-700 border-indigo-200",
    supportedFormats: ["ARTICLE"],
    primaryFormat: "ARTICLE",
    titleLimit: {
      min: 1,
      max: 200,
      countMode: "CHAR",
      label: "文章标题（200 字以内，SEO 友好型）",
    },
    bodyLimit: {
      min: 1,
      max: 100000,
      supportsMarkdown: true,
      label: "文章正文（支持 HTML / Markdown 原生语法、特色图片与自定义摘要）",
    },
    tagsLimit: {
      max: 10,
      format: "BARE",
      label: "文章标签（以英文逗号分隔）",
    },
    mediaSpecs: {
      minImages: 0,
      maxImages: 50,
      imageRatio: "自由比例，支持特色图片 (Featured Image)",
      imageFormats: ["jpg", "jpeg", "png", "webp", "svg"],
      maxImageBytes: 25 * 1024 * 1024,
      videoRequired: false,
      coverRequired: false,
    },
    automationCapability: "OFFICIAL_API",
    supportsScheduled: true,
    officialApiAvailable: true,
    browserAssistedAvailable: false,
    mustRequireHumanConfirm: true,
    creatorUrl: "/wp-admin/post-new.php",
    creationTypeLabel: "写文章",
    verifiedDate: "2026-10",
    description: "通过官方 REST API 直接发布至企业独立站或存为草稿，沉淀为可信 GEO 落地资产。",
    tips: "支持草稿 (draft) 与公开 (publish) 两种模式，自动转化 HTML 排版与特色分类图。",
  },
  SIMULATION: {
    id: "SIMULATION",
    name: "本地仿真创作台 (测试沙箱)",
    category: "本地仿真",
    icon: "🧪",
    color: "purple",
    badgeBg: "bg-purple-50 text-purple-700 border-purple-200",
    supportedFormats: ["IMAGE_TEXT", "ARTICLE", "VIDEO_SCRIPT"],
    primaryFormat: "IMAGE_TEXT",
    titleLimit: {
      min: 1,
      max: 100,
      countMode: "CHAR",
      label: "仿真标题（支持完整输入测试）",
    },
    bodyLimit: {
      min: 1,
      max: 10000,
      supportsMarkdown: true,
      label: "仿真正文（支持富文本/Markdown 测试）",
    },
    tagsLimit: {
      max: 10,
      format: "HASH",
      label: "测试话题标签",
    },
    mediaSpecs: {
      minImages: 0,
      maxImages: 9,
      imageRatio: "自由测试比例",
      imageFormats: ["jpg", "jpeg", "png", "webp"],
      maxImageBytes: 10 * 1024 * 1024,
      videoRequired: false,
      videoFormats: ["mp4"],
      maxVideoBytes: 100 * 1024 * 1024,
      coverRequired: false,
    },
    automationCapability: "BROWSER_ASSISTED",
    supportsScheduled: true,
    officialApiAvailable: false,
    browserAssistedAvailable: true,
    mustRequireHumanConfirm: true,
    creatorUrl: "http://127.0.0.1:18765/static/simulation-editor.html",
    creationTypeLabel: "仿真图文创作",
    verifiedDate: "2026-10",
    description: "本地零网络依赖的受控 Chrome 仿真沙箱，完整演练 15 步状态机与表单回填。",
    tips: "用于离线验收、快速验证与无风险演示，绝不向任何外部互联网发送请求。",
  },
};

/**
 * 文本清洗与特殊符号规范化工具函数
 */

/** 规范化标题：移除换行符、首尾空白，安全截断到目标渠道字数上限 */
export function normalizeTitleForChannel(title: string, channelId: string): string {
  const spec = CHANNEL_SPECS[channelId.toUpperCase()] || CHANNEL_SPECS.SIMULATION;
  // 标题绝对不允许换行
  let clean = (title || "").replace(/[\r\n\t]+/g, " ").trim();
  // 移除多余连续空格
  clean = clean.replace(/\s{2,}/g, " ");
  // 截断到渠道上限
  const max = spec.titleLimit.max;
  if (clean.length > max) {
    clean = clean.slice(0, max);
  }
  return clean;
}

/** 规范化正文：
 * 若渠道不支持 Markdown (小红书/抖音/快手等)，平滑转为带有空行段落的纯文本，保留中文标点与 Emoji；
 * 若渠道支持 Markdown (知乎/WordPress)，保留 Markdown 格式。
 */
export function normalizeBodyForChannel(body: string, channelId: string): string {
  const spec = CHANNEL_SPECS[channelId.toUpperCase()] || CHANNEL_SPECS.SIMULATION;
  let text = (body || "").trim();

  if (!spec.bodyLimit.supportsMarkdown) {
    // 1. 去除 Markdown 标题符号 (#, ##, ### 等)，保留标题文字
    text = text.replace(/^#{1,6}\s+(.+)$/gm, "$1");
    // 2. 去除加粗与斜体 (**word**, *word*, __word__)，保留内容
    text = text.replace(/\*\*(.*?)\*\*/g, "$1");
    text = text.replace(/__(.*?)__/g, "$1");
    text = text.replace(/\*(.*?)\*/g, "$1");
    text = text.replace(/_(.*?)_/g, "$1");
    // 3. 去除行内代码 `code`
    text = text.replace(/`([^`]+)`/g, "$1");
    // 4. 去除代码块 ```...```
    text = text.replace(/```[\s\S]*?```/g, (match) => {
      return match.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "");
    });
    // 5. 链接 [text](url) 转为 text
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    // 6. 无序列表符 (- , * , + ) 转为干净的项目符号 (• )
    text = text.replace(/^[\*\-\+]\s+/gm, "• ");
    // 7. 引用块 (> text) 转为直引
    text = text.replace(/^>\s+/gm, "");
    // 8. 规范化连续多行空行为两个换行 (标准段落留白)
    text = text.replace(/\n{3,}/g, "\n\n");
  }

  // 截断到正文上限
  const max = spec.bodyLimit.max;
  if (text.length > max) {
    text = text.slice(0, max);
  }
  return text;
}

/** 规范化标签：根据渠道语法添加或移除 # 号，去重，并严格截断到 maxTags */
export function normalizeTagsForChannel(tags: string[], channelId: string): string[] {
  const spec = CHANNEL_SPECS[channelId.toUpperCase()] || CHANNEL_SPECS.SIMULATION;
  const maxTags = spec.tagsLimit.max;
  const format = spec.tagsLimit.format;

  const rawTags = (tags || []).map((t) => t.replace(/#/g, "").trim()).filter(Boolean);
  const deduped = Array.from(new Set(rawTags));

  const formatted = deduped.map((t) => {
    if (format === "HASH") return `#${t}`;
    if (format === "DOUBLE_HASH") return `#${t}#`;
    return t; // BARE
  });

  return formatted.slice(0, maxTags);
}

export function getAllChannelSpecs(): ChannelRuleSpec[] {
  return Object.values(CHANNEL_SPECS);
}

/** 渠道内容合规性校验 */
export interface ChannelValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

export function validateChannelContent(
  payload: { title: string; body: string; tags: string[]; mediaCount?: number; hasVideo?: boolean; hasCover?: boolean },
  channelId: string
): ChannelValidationResult {
  const spec = CHANNEL_SPECS[channelId.toUpperCase()] || CHANNEL_SPECS.SIMULATION;
  const errors: string[] = [];
  const warnings: string[] = [];

  const title = (payload.title || "").trim();
  const body = (payload.body || "").trim();
  const tags = payload.tags || [];
  const mediaCount = payload.mediaCount || 0;

  // 标题校验
  if (!title) {
    errors.push(`标题不能为空（${spec.name} 要求至少 ${spec.titleLimit.min} 字）`);
  } else if (title.length > spec.titleLimit.max) {
    errors.push(`标题长度超出 ${spec.name} 限制：当前 ${title.length} 字，最大允许 ${spec.titleLimit.max} 字`);
  }
  if (/[\r\n]/.test(title)) {
    warnings.push("标题中包含换行符，系统将在提交时自动规范化为单行文本");
  }

  // 正文校验
  if (!body) {
    errors.push(`正文不能为空（${spec.name} 要求至少 ${spec.bodyLimit.min} 字）`);
  } else if (body.length > spec.bodyLimit.max) {
    errors.push(`正文长度超出 ${spec.name} 限制：当前 ${body.length} 字，最大允许 ${spec.bodyLimit.max} 字`);
  }

  // 话题标签校验
  if (tags.length > spec.tagsLimit.max) {
    errors.push(`话题标签数量超出 ${spec.name} 限制：当前 ${tags.length} 个，最大允许 ${spec.tagsLimit.max} 个`);
  }

  // 素材校验
  if (spec.mediaSpecs.videoRequired && mediaCount === 0) {
    warnings.push(`${spec.name} 以短视频创作为主，建议准备 1 个成片视频或口播分镜素材`);
  }
  if (spec.mediaSpecs.minImages > 0 && mediaCount === 0 && !spec.mediaSpecs.videoRequired) {
    warnings.push(`${spec.name} 建议至少配置 ${spec.mediaSpecs.minImages} 张高清配图或主视觉封面`);
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}
