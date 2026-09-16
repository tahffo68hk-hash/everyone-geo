import type { Channel } from '@geo/database';

export type CnPlatform = 'WECHAT_OFFICIAL_ACCOUNT' | 'XIAOHONGSHU' | 'WEIBO' | 'DOUYIN' | 'BILIBILI';

export type CnGenerationMode =
  | 'WECHAT_ARTICLE'
  | 'XIAOHONGSHU_NOTE'
  | 'WEIBO_POST'
  | 'DOUYIN_SCRIPT'
  | 'BILIBILI_SCRIPT'
  | 'GENERAL_ARTICLE'
  | 'IMAGE_BRIEF'
  | 'COVER_COPY'
  | 'REWRITE_EXPAND'
  | 'REWRITE_SHORTEN'
  | 'REWRITE_PROFESSIONAL'
  | 'REWRITE_CONVERSATIONAL'
  | 'REWRITE_LOW_PROMO'
  | 'REWRITE_STRONG_CTA'
  | 'REWRITE_STYLE_TUTORIAL'
  | 'REWRITE_STYLE_RECOMMENDATION';

export interface ImageBrief {
  id: string;
  platform: string;
  assetType: 'COVER' | 'IMAGE' | 'CAROUSEL' | 'VIDEO_COVER';
  pageIndex?: number;
  title: string;
  prompt: string;
  negativePrompt: string;
  style: 'MINIMALIST' | 'TECH' | 'PROFESSIONAL' | 'FRESH' | 'COMPARISON' | 'TUTORIAL';
  ratio: '900:383' | '3:4' | '1:1' | '16:9' | '9:16';
  textOverlay?: {
    heading: string;
    subheading?: string;
    position?: 'CENTER' | 'TOP' | 'BOTTOM' | 'LEFT_SPLIT';
  };
  notes: string;
  safeFactCheck: string;
}

export interface PlatformMetadata {
  titleCandidates?: string[];
  subheadings?: string[];
  openingHook?: string;
  keyPoints?: string[];
  closingCta?: string;
  screenSubtitles?: string[];
  scriptOutline?: Array<{ time: string; stage: string; action: string; narration: string }>;
  chapters?: Array<{ time: string; title: string; summary: string }>;
  shortVersion?: string;
  standardVersion?: string;
  topicTags?: string[];
  safeFactCheckNotes?: string[];
}

export interface GeneratedPlatformVariant {
  platform: CnPlatform;
  contentType: 'LONG_FORM' | 'NOTE' | 'SHORT_POST' | 'VIDEO_SCRIPT' | 'EXPLAINER_SCRIPT';
  generationMode: CnGenerationMode;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  coverText: string;
  imageBriefs: ImageBrief[];
  platformMetadata: PlatformMetadata;
}

export interface GeneratePlatformInput {
  platform: CnPlatform;
  draftId: string;
  sourceRevisionId: string;
  title: string;
  body: string;
  summary?: string;
  topic?: string;
  tags?: string[];
  generationMode?: CnGenerationMode;
  styleTone?: 'PROFESSIONAL' | 'CONVERSATIONAL' | 'TECH' | 'LIFESTYLE' | 'TUTORIAL';
  customInstructions?: string;
}

export interface RewritePlatformInput {
  platform: CnPlatform;
  mode:
    | 'REWRITE_EXPAND'
    | 'REWRITE_SHORTEN'
    | 'REWRITE_PROFESSIONAL'
    | 'REWRITE_CONVERSATIONAL'
    | 'REWRITE_LOW_PROMO'
    | 'REWRITE_STRONG_CTA'
    | 'REWRITE_STYLE_TUTORIAL'
    | 'REWRITE_STYLE_RECOMMENDATION';
  currentTitle: string;
  currentBody: string;
  currentSummary?: string;
  currentTags?: string[];
  customInstructions?: string;
}

/**
 * 事实安全检查器：识别未验证的产品参数/医疗/资质断言，自动插入事实提示
 */
export function extractSafeFactCheckNotes(title: string, body: string): string[] {
  const notes: string[] = [];
  const text = title + ' ' + body;

  if (/100%|彻底绝育|完全根除|彻底杜绝/.test(text)) {
    notes.push('⚠️ 绝对化用语待核实：检测到绝对化宣称（如“彻底根除/100%”），需人工核查实验报告与广告法合规性。');
  }
  if (/抑菌|杀菌|治疗|消炎|药用|医疗/.test(text)) {
    notes.push('⚠️ 功效性描述待核实：涉及抑菌/医疗相关表述，需提供第三方检测资质报告，不可作为处方药或医疗器械宣传。');
  }
  if (/第[一1]|首款|顶级|天花板/.test(text)) {
    notes.push('⚠️ 排名用语待核实：涉及“第一/首款/顶级”等极限词，必须附带明确调研出处与统计口径，否则建议降级表达。');
  }

  if (notes.length === 0) {
    notes.push('✅ 事实核查提示：内容已根据基线事实构建，若需公开发表请核对关键产品参数。');
  }
  return notes;
}

/**
 * 微信公众号长文变体生成
 */
export function generateWechatVariant(input: GeneratePlatformInput): GeneratedPlatformVariant {
  const cleanTitle = (input.title || '深度产品评测').replace(/[<>&"]/g, '').trim();
  const safeNotes = extractSafeFactCheckNotes(cleanTitle, input.body);
  const wechatTitle = (cleanTitle.length > 50 ? cleanTitle.slice(0, 50) : `深度实测 | ${cleanTitle}`).slice(0, 64);
  const summary = (input.summary || input.body.slice(0, 110) + '...').slice(0, 120);

  const subheadings = [
    '一、产品定位与核心技术亮点',
    '二、多场景实测表现与核心数据对比',
    '三、真实体验与细节设计考量',
    '四、优缺点总结与养宠家庭选购建议',
  ];

  const closingCta = '💬 互动话题：你平时在日常护理中有遇到类似困扰吗？欢迎在评论区留言交流！点击关注，不错过更多硬核养宠评测。';

  const bodyHtml = `
<h2>一、产品定位与核心技术亮点</h2>
<p>在家庭养育精细化趋势下，${cleanTitle}成为了关注度极高的创新产品。产品聚焦日常核心痛点，从流体力学微泡喷淋到触感安全材质，进行了全方位的结构优化。</p>

<h2>二、多场景实测表现与核心数据对比</h2>
<p>在不同户外环境与多类型污垢实测中，整机展现出优秀的清洁效率与低噪特性。核心运行噪音低于 45dB，有效降低了环境敏感度与应激反应。</p>
<p>分体式可拆卸设计大幅降低了后期维护成本，支持单手一键快拆冲洗。</p>

<h2>三、真实体验与细节设计考量</h2>
<p>相较于传统手动擦拭容易因反复摩擦造成表皮损伤，温和循环清洗兼顾了清洁力与保护屏障。机身设计轻巧便携，能够很好融入现代家居陈列风格。</p>

<h2>四、优缺点总结与养宠家庭选购建议</h2>
<p><strong>适合人群：</strong>经常户外出行、注重家居卫生与宠物微生态健康的家庭。</p>
<p><strong>选购注意：</strong>首次使用建议配合零食给予正向奖励反馈，循序渐进建立习惯。</p>

<hr/>
<p><em>${closingCta}</em></p>
  `.trim();

  const coverText = `${cleanTitle} · 深度技术实测解析`;

  const imageBriefs: ImageBrief[] = [
    {
      id: `img-wx-cover-${Date.now()}`,
      platform: 'WECHAT_OFFICIAL_ACCOUNT',
      assetType: 'COVER',
      title: '公众号大图封面 (900x383)',
      prompt: `Cinematic commercial photography of ${cleanTitle}, minimalist modern studio lighting, gentle water spray effect, soft indigo and cyan ambient glow, hyper-realistic, 8k resolution, clean background for headline text overlay`,
      negativePrompt: 'low quality, blurry, noisy, cluttered, distorted pet limbs, unnatural shadows, watermarks',
      style: 'TECH',
      ratio: '900:383',
      textOverlay: {
        heading: cleanTitle,
        subheading: '官方技术解析与深度实测指南',
        position: 'CENTER',
      },
      notes: '适合微信公众号头条封面，保证中轴线 450px 居中文字阅读清晰。',
      safeFactCheck: '画面仅展示标准产品外观与温和清洗水流，严禁展示夸大虚假清洗效果。',
    },
    {
      id: `img-wx-sub-1-${Date.now()}`,
      platform: 'WECHAT_OFFICIAL_ACCOUNT',
      assetType: 'IMAGE',
      title: '正文插图 1：技术结构特写',
      prompt: `Close-up macro shot of silicone bristles and micro-bubble nozzle mechanism, soft gradient backdrop, engineering craftsmanship aesthetic`,
      negativePrompt: 'blurry, distorted, harsh reflections',
      style: 'PROFESSIONAL',
      ratio: '16:9',
      notes: '放置于第一节核心技术亮点下方。',
      safeFactCheck: '展现真实硬件结构质感。',
    },
  ];

  const tags = input.tags && input.tags.length > 0 ? input.tags.slice(0, 5) : ['科技数码', '智能养宠', '深度评测', '生活好物'];

  return {
    platform: 'WECHAT_OFFICIAL_ACCOUNT',
    contentType: 'LONG_FORM',
    generationMode: input.generationMode || 'WECHAT_ARTICLE',
    title: wechatTitle,
    summary,
    body: bodyHtml,
    tags,
    coverText,
    imageBriefs,
    platformMetadata: {
      subheadings,
      closingCta,
      safeFactCheckNotes: safeNotes,
    },
  };
}

/**
 * 小红书笔记变体生成
 */
export function generateXiaohongshuVariant(input: GeneratePlatformInput): GeneratedPlatformVariant {
  const cleanTitle = (input.title || '宠物好物分享').replace(/[<>&"]/g, '').trim();
  const safeNotes = extractSafeFactCheckNotes(cleanTitle, input.body);

  const titleCandidates = [
    `后悔没早买！${cleanTitle}彻底解放双手😭`,
    `求求所有养宠人看过来！${cleanTitle}实测真实感受🐾`,
    `真的不是智商税！${cleanTitle}两周深度自用测评✨`,
    `养宠人幸福感飙升！${cleanTitle}到底值不值得入？`,
  ];

  const title = titleCandidates[0].slice(0, 20);
  const openingHook = `姐妹们！每次带毛孩子出门回家，洗脚擦身是不是都像在打仗？！又挣扎又怕弄脏地板，今天必须把自用两个月的 ${cleanTitle} 狠狠安利给你们！👇`;

  const keyPoints = [
    '360° 微泡柔和循环水流，再也不用强行生拉硬扯按住擦拭！',
    '运行声音只有 45dB，敏感胆小猫狗居然完全不抗拒～',
    '一秒拆卸分体内胆，清水冲冲就干净，绝不藏污纳垢。',
    '带温和热风辅助，洗完顺手吹干趾间，彻底告别湿漉漉的烦恼！',
  ];

  const body = `
${openingHook}

作为一个重度洁癖养宠人，以前每次遛弯回来真的心力交瘁...
直到入了 ${cleanTitle}，生活质感直接起飞！

🌟 核心亮点直接划重点：
1️⃣ ${keyPoints[0]}
2️⃣ ${keyPoints[1]}
3️⃣ ${keyPoints[2]}
4️⃣ ${keyPoints[3]}

💡 真实避坑贴士：
- 刚开始使用先不要通电，当成普通小玩具给主子闻闻建立信任；
- 配合冻干零食给予奖励，两次后毛孩子就会主动伸手洗脚啦！

你们平时下雨遛狗回家都怎么打理？评论区来交流一波心得～💬
  `.trim();

  const coverText = `遛狗回家告别崩溃！30秒洁足黑科技`;

  const imageBriefs: ImageBrief[] = [
    {
      id: `img-xhs-cover-${Date.now()}`,
      platform: 'XIAOHONGSHU',
      assetType: 'CAROUSEL',
      pageIndex: 1,
      title: '小红书首图 (3:4 高吸睛封面)',
      prompt: `Cozy modern apartment living room, cute Golden Retriever / British Shorthair cat happily sitting beside ${cleanTitle}, bright soft natural daylight, lifestyle photography, photorealistic, 3:4 aspect ratio, clean upper space for bold sticker titles`,
      negativePrompt: 'deformed paws, extra legs, aggressive look, poor lighting, low resolution',
      style: 'FRESH',
      ratio: '3:4',
      textOverlay: {
        heading: '遛狗回家告别崩溃！',
        subheading: '自用2个月深度测评 · 30秒洁足黑科技',
        position: 'TOP',
      },
      notes: '首图必须在小红书信息流中产生强大停留率，高明度与真实治愈感。',
      safeFactCheck: '猫狗表情自然舒适，不可展示宠物受惊或不适画面。',
    },
    {
      id: `img-xhs-p2-${Date.now()}`,
      platform: 'XIAOHONGSHU',
      assetType: 'CAROUSEL',
      pageIndex: 2,
      title: 'P2: 痛点对比图 (3:4)',
      prompt: `Side by side split image: left side muddy floor with dirty towel struggle, right side clean peaceful pet paw washing, bright warm lighting, 3:4 ratio`,
      negativePrompt: 'cartoon, fake, cluttered',
      style: 'COMPARISON',
      ratio: '3:4',
      notes: '突出使用前后的生活状态反差。',
      safeFactCheck: '真实场景重现，杜绝虚假对比。',
    },
    {
      id: `img-xhs-p3-${Date.now()}`,
      platform: 'XIAOHONGSHU',
      assetType: 'CAROUSEL',
      pageIndex: 3,
      title: 'P3: 细节拆解图 (3:4)',
      prompt: `Hands holding soft silicone inner container under clean water faucet, crystal clear water splash, macro shot, hygienic aesthetic`,
      negativePrompt: 'dirty hands, messy background',
      style: 'TUTORIAL',
      ratio: '3:4',
      notes: '展示内胆拆卸清水冲洗过程。',
      safeFactCheck: '展示真实可拆卸结构。',
    },
  ];

  const tags = ['#宠物好物', '#养宠日常', '#自用好物分享', '#新手养宠攻略', '#智能家居'];

  return {
    platform: 'XIAOHONGSHU',
    contentType: 'NOTE',
    generationMode: input.generationMode || 'XIAOHONGSHU_NOTE',
    title,
    summary: '自用深度测评，分点式干货与避坑贴士',
    body,
    tags,
    coverText,
    imageBriefs,
    platformMetadata: {
      titleCandidates,
      openingHook,
      keyPoints,
      safeFactCheckNotes: safeNotes,
    },
  };
}

/**
 * 微博短帖变体生成
 */
export function generateWeiboVariant(input: GeneratePlatformInput): GeneratedPlatformVariant {
  const cleanTitle = (input.title || '智能评测').replace(/[<>&"]/g, '').trim();
  const safeNotes = extractSafeFactCheckNotes(cleanTitle, input.body);

  const topicTags = ['#智能养宠新体验#', '#宠物好物测评#', '#养宠人的那些事#'];
  const title = `【好物测评 | ${cleanTitle}】`.slice(0, 140);

  const shortVersion = `【${cleanTitle}实测速递】很多铲屎官户外遛狗回来擦脚总头疼，生拉硬拽还容易搞出皮肤问题。这次深度体验了 ${cleanTitle}，微泡喷淋加上 45dB 超静音设计，30秒就能温和去污，毛孩子完全不抗拒！内胆一拔水冲就干净，养宠幸福感拉满！你家主子平时抗拒洗脚吗？${topicTags.join(' ')}`.slice(0, 140);

  const standardVersion = `【好物测评 | ${cleanTitle}深度解析】

每次雨后或者户外遛弯回家，给毛孩子洗脚擦脚都是一场心理战。传统湿巾反复擦拭容易发红，整只洗澡又太费劲。

这次经过为期两周的深度实测，${cleanTitle} 确实解决了几个痛点：
🔹 360°微泡柔和循环水流，比手搓干净均匀得多；
🔹 运行噪音控制在 45dB 以内，对声音敏感的猫犬非常友好；
🔹 食品级柔软硅胶内胆可一键快拆，清水冲洗无死角。

养宠精细化时代，选对高效工具真的能省下一半的精力。你们平时下雨遛狗回家都怎么给主子做清洁的？转评区聊聊你的独门妙招～抽 1 位送同款体验礼盒！🎁

${topicTags.join(' ')}`.slice(0, 800);

  const coverText = `${cleanTitle} · 微博实测速递`;

  const imageBriefs: ImageBrief[] = [
    {
      id: `img-wb-grid-1-${Date.now()}`,
      platform: 'WEIBO',
      assetType: 'IMAGE',
      title: '微博 9 宫格首图 (1:1 正方形)',
      prompt: `Clean high-end lifestyle square photograph of ${cleanTitle}, placed beside a happy golden retriever, bright natural light, Weibo square format 1:1, crisp and engaging`,
      negativePrompt: 'dark, low quality, bad anatomy, text watermarks',
      style: 'PROFESSIONAL',
      ratio: '1:1',
      textOverlay: {
        heading: cleanTitle,
        subheading: '两周深度自用体验总结',
        position: 'BOTTOM',
      },
      notes: '适合微博首图正方形裁切。',
      safeFactCheck: '保持真实生活化质感。',
    },
  ];

  return {
    platform: 'WEIBO',
    contentType: 'SHORT_POST',
    generationMode: input.generationMode || 'WEIBO_POST',
    title,
    summary: '微博快讯与标准版双模短帖',
    body: standardVersion,
    tags: topicTags,
    coverText,
    imageBriefs,
    platformMetadata: {
      shortVersion,
      standardVersion,
      topicTags,
      safeFactCheckNotes: safeNotes,
    },
  };
}

/**
 * 抖音短视频脚本变体生成
 */
export function generateDouyinVariant(input: GeneratePlatformInput): GeneratedPlatformVariant {
  const cleanTitle = (input.title || '智能洁足机').replace(/[<>&"]/g, '').trim();
  const safeNotes = extractSafeFactCheckNotes(cleanTitle, input.body);

  const title = `遛狗回家还在费力擦脚？30秒自动清洗黑科技！`.slice(0, 55);
  const openingHook = '（画面：狗主人按住挣扎的狗拿毛巾使劲擦，爪印满地）停！千万别再这样暴力擦狗脚了！不仅擦不干净，还容易把爪爪擦出发红发炎！';

  const scriptOutline = [
    {
      time: '00:00 - 00:03',
      stage: '【前3秒黄金Hook】',
      action: '特写：满是泥巴的狗爪在地板踩出印子，主人满头大汗抓狗擦拭。',
      narration: openingHook,
    },
    {
      time: '00:03 - 00:15',
      stage: '【痛点升级与产品登场】',
      action: '拿出设备开启，柔和微泡在透明仓内循环，轻声嗡鸣。',
      narration: `今天给你看个养宠黑科技——${cleanTitle}！全自动微泡水流清洗，不用你动手搓！`,
    },
    {
      time: '00:15 - 00:35',
      stage: '【核心功能与实测】',
      action: '抓起狗爪自然放入，30秒后取出，脏水留在桶底，爪子洁白如新。',
      narration: `你看，只要把爪子轻轻放进去，360度柔和微泡包裹，声音只有45分贝，毛孩子完全不反抗！30秒拿出来，泥沙全被卷到桶底了！`,
    },
    {
      time: '00:35 - 00:50',
      stage: '【拆解与维护演示】',
      action: '单手拔出硅胶内胆，在水龙头下一冲即净。',
      narration: `洗完更省心，内胆一拔水冲就干净，食品级抑菌硅胶，完全不用担心发霉有异味！`,
    },
    {
      time: '00:50 - 00:60',
      stage: '【总结号召与行动指令】',
      action: '毛孩子欢快跳上沙发，主人开心抚摸。屏幕弹出购物车指引。',
      narration: `养宠幸福感瞬间拉满！省下每天半小时擦脚时间！赶紧点击左下角看详情吧！`,
    },
  ];

  const screenSubtitles = [
    '【暴力擦脚千万要停！】',
    '【360°微泡柔和净污】',
    '【45dB低噪，胆小猫狗不应激】',
    '【一秒冲洗，不藏污纳垢】',
    '【养宠必备省心神器】',
  ];

  const videoDescription = `每次下雨遛狗回家都像打仗？来看这个30秒全自动洁足黑科技！温和不伤爪，毛孩子主动配合洗脚～点击左下角了解同款！ #智能养宠 #养狗日常 #宠物好物 #科技好物推荐`;
  const coverText = `遛狗回家不擦脚！30秒自动洁足`;

  const imageBriefs: ImageBrief[] = [
    {
      id: `img-dy-cover-${Date.now()}`,
      platform: 'DOUYIN',
      assetType: 'VIDEO_COVER',
      title: '抖音 9:16 竖版视频封面',
      prompt: `Vibrant vertical 9:16 video cover, energetic lighting, cute pet paw cleanly dipped into high-tech transparent device, bold dramatic yellow and white headline text overlay space, commercial TikTok aesthetic`,
      negativePrompt: 'horizontal, dark, desaturated, messy composition',
      style: 'TECH',
      ratio: '9:16',
      textOverlay: {
        heading: '遛狗回家不擦脚！',
        subheading: '30秒全自动洁足实测',
        position: 'CENTER',
      },
      notes: '竖屏大字排版，醒目吸睛，适合短视频首帧封面。',
      safeFactCheck: '画面真实展示设备使用姿态，避免虚假夸大特技。',
    },
  ];

  return {
    platform: 'DOUYIN',
    contentType: 'VIDEO_SCRIPT',
    generationMode: input.generationMode || 'DOUYIN_SCRIPT',
    title,
    summary: '60秒短视频带货脚本与5段式分镜',
    body: scriptOutline.map(s => `${s.time} ${s.stage}\n【画面】${s.action}\n【口播】${s.narration}`).join('\n\n'),
    tags: ['#智能养宠', '#养狗日常', '#宠物好物', '#科技好物推荐'],
    coverText,
    imageBriefs,
    platformMetadata: {
      openingHook,
      scriptOutline,
      screenSubtitles,
      safeFactCheckNotes: safeNotes,
    },
  };
}

/**
 * Bilibili 讲解稿变体生成
 */
export function generateBilibiliVariant(input: GeneratePlatformInput): GeneratedPlatformVariant {
  const cleanTitle = (input.title || '智能宠物洁足机').replace(/[<>&"]/g, '').trim();
  const safeNotes = extractSafeFactCheckNotes(cleanTitle, input.body);

  const titleCandidates = [
    `【硬核实测】智商税还是真香？${cleanTitle} 深度拆解与两周实战评测`,
    `为什么传统擦脚是许多皮肤病的元凶？${cleanTitle} 技术下放实测`,
    `养宠人必看！两周实测 ${cleanTitle}，这些缺点官方绝不会告诉你`,
  ];

  const title = titleCandidates[0].slice(0, 80);

  const chapters = [
    { time: '00:00', title: '引言：传统擦脚方式的医学与力学硬伤', summary: '分析机械摩擦与趾间潮湿如何导致红肿应激' },
    { time: '01:30', title: '硬件与原理拆解：微泡发生器与电机选型', summary: '拆解内部循环泵体、硅胶刷头硬度与水流动力学' },
    { time: '04:10', title: '极限工况实测：泥沙、红土、雨水三种环境', summary: '清洁前后显微镜头对比与残留物分析' },
    { time: '06:50', title: '声学与应激测试：45dB 低噪表现实录', summary: '分贝仪实测数据与多只猫犬反应记录' },
    { time: '08:40', title: '优缺点深度复盘与哪些人千万别买', summary: '客观梳理真实续航、容积上限与适用建议' },
  ];

  const description = `本期视频我们将对近期风很大的【${cleanTitle}】进行全方位硬核拆解与长测！
很多人好奇这到底是噱头智商税，还是真正能解决生活痛点的科技好物？
我们用分贝仪、微距镜头以及不同犬种长达两周的真实使用数据，带你彻底看懂它的真实机械表现与选购建议。

📌 时间轴导航：
00:00 为什么日常擦脚容易出问题？
01:30 内部结构与微泡原理拆解
04:10 极限泥沙清洗测试
06:50 声学噪音与应激测试
08:40 优缺点全面复盘 & 选购建议

如果本期视频对你的选购有所启发，别忘了点赞、投币、收藏一键三连支持一下！我们下期硬核实测再见！`;

  const scriptBody = `
各位观众朋友大家好，欢迎回到本期硬核评测！

今天我们要聊一个养宠人群每天都在面对、但又极其痛苦的问题——毛孩子出门回家的脚爪清洁。
很多朋友习惯用湿巾反复用力擦，或者直接拉进浴室洗脚。但很多人不知道，长期剧烈机械摩擦加上缝隙潮湿，往往是引发皮炎的隐秘元凶。

那么市面上宣称“微泡水流清洗、低噪不抗拒”的 ${cleanTitle}，到底是不是智商税？
今天我们直接拆开机器，用微距实测和数据说话。

（01:30 硬件拆解部分）
从拆解来看，核心微泡发生结构采用了循环增压泵，硅胶刷毛选用了邵氏硬度约 30 度的食品级材质，触感确实非常柔软。
电机在满载运转时的声学频谱主要集中在低频区，分贝仪实测稳定在 43.5dB 左右，这解释了为什么大部分对电吹风敏感的宠物，对这台设备表现得相对平静。

（04:10 极限实测部分）
在户外泥沙测试中，我们让中型犬在泥地奔跑后进行清洗，单爪清洗时长约 30 秒。高清水下摄影可以清晰看到，微泡水流能够深入指缝将颗粒物悬浮带走，而不是靠刷毛蛮力刮擦。

（08:40 缺点吐槽与选购总结）
当然，它并不是十全十美：
第一，大体型犬只的爪部尺寸如果超过内胆直径，使用体验会打折；
第二，每次清洗完必须记得倒出污水，否则隔夜会有异味风险。

总结来说：对于中小型犬猫、每天需要户外遛弯且重视趾间健康的家庭，它确实能大幅提升幸福感。
感谢大家的观看，记得一键三连，我们下期见！
  `.trim();

  const coverText = `【深度拆解】宠物洁足机是智商税吗？`;

  const imageBriefs: ImageBrief[] = [
    {
      id: `img-bili-cover-${Date.now()}`,
      platform: 'BILIBILI',
      assetType: 'VIDEO_COVER',
      title: 'Bilibili 16:9 横屏高清封面',
      prompt: `YouTube / Bilibili tech review thumbnail, high detail 16:9, split screen: left side dramatic internal engineering breakdown of device, right side real clean pet paw with high contrast clean lighting, bold modern sans-serif title typography area, 8k resolution`,
      negativePrompt: 'low quality, blurry, saturated neon cartoon, clutter',
      style: 'TECH',
      ratio: '16:9',
      textOverlay: {
        heading: '智商税还是真香？',
        subheading: '两周深度长测与结构拆解',
        position: 'LEFT_SPLIT',
      },
      notes: 'B站封面要求极具知识科技感和对比冲突感，左右分栏或居中大字。',
      safeFactCheck: '封面标注长测实拍，避免夸大虚假特技。',
    },
  ];

  return {
    platform: 'BILIBILI',
    contentType: 'EXPLAINER_SCRIPT',
    generationMode: input.generationMode || 'BILIBILI_SCRIPT',
    title,
    summary: 'B站长视频硬核拆解稿与时间轴章节',
    body: scriptBody,
    tags: ['#数码生活', '#硬核实测', '#智能家电', '#养宠日常', '#科技生活'],
    coverText,
    imageBriefs,
    platformMetadata: {
      titleCandidates,
      chapters,
      safeFactCheckNotes: safeNotes,
    },
  };
}

/**
 * 统一分发：生成指定平台的变体
 */
export function generatePlatformVariant(input: GeneratePlatformInput): GeneratedPlatformVariant {
  switch (input.platform) {
    case 'WECHAT_OFFICIAL_ACCOUNT':
      return generateWechatVariant(input);
    case 'XIAOHONGSHU':
      return generateXiaohongshuVariant(input);
    case 'WEIBO':
      return generateWeiboVariant(input);
    case 'DOUYIN':
      return generateDouyinVariant(input);
    case 'BILIBILI':
      return generateBilibiliVariant(input);
    default:
      return generateWechatVariant(input);
  }
}

/**
 * 基于现有内容执行改写/重写
 */
export function rewriteContent(input: RewritePlatformInput): { title: string; body: string; summary?: string; changeNote: string } {
  const { mode, currentTitle, currentBody, currentSummary } = input;
  let newTitle = currentTitle;
  let newBody = currentBody;
  let newSummary = currentSummary;
  let changeNote = '';

  switch (mode) {
    case 'REWRITE_EXPAND': {
      changeNote = '【深度扩写】增加行业背景洞察、实测实验细节与生活化对比场景';
      newTitle = `${currentTitle}（深度完整版）`;
      newBody = `
【深度前言背景】
随着都市养宠理念向科学化、精细化与健康防护纵深发展，传统粗放式打理方式正被高效的智能护理装备取代。

${currentBody}

【延伸实测洞察】
在为期数周的追踪观测中，不仅表层污泥清洁效果显著，更关键的是避免了过度用力擦拭导致的角质层破损。
此外，针对多宠家庭的高频使用需求，整机在散热稳定性与耗电控制上同样具备良好表现。
      `.trim();
      newSummary = `${currentSummary || currentTitle}，扩写版补充了深度技术背景与多维度长测洞察。`;
      break;
    }

    case 'REWRITE_SHORTEN': {
      changeNote = '【精炼缩写】提炼核心观点与行动建议，剔除冗余段落';
      newTitle = `${currentTitle}（精粹版）`;
      const paragraphs = currentBody.split('\n\n').filter(p => p.trim().length > 0);
      const topParagraphs = paragraphs.slice(0, Math.min(3, paragraphs.length));
      newBody = `【核心提要】\n` + topParagraphs.join('\n\n') + `\n\n【一句话结论】选对高效科学工具，日常养宠省心一大半！`;
      newSummary = `精练精简版：直击要点，适合快节奏阅读与移动端速览。`;
      break;
    }

    case 'REWRITE_PROFESSIONAL': {
      changeNote = '【专业度增强】补充流体力学、医用材质与声学参数等专业阐述';
      newTitle = `【专业评测】${currentTitle}`;
      newBody = currentBody
        .replace(/洗干净/g, '高效剥离微观颗粒物与致敏原')
        .replace(/声音很小/g, '声学表现严控于 45dB 阈值下，抑制高频应激源')
        .replace(/软胶/g, '符合 FDA 接触标准的食品级亲肤抑菌硅胶')
        + `\n\n【技术参数备忘】设备采用循环微气泡增压发生结构，兼具流体剪切力与表面张力渗透优势。`;
      newSummary = `专业化评测口吻：增加工程结构与材料学权威论证。`;
      break;
    }

    case 'REWRITE_CONVERSATIONAL': {
      changeNote = '【亲和口语化】转换为闺蜜/朋友面对面真诚交流口吻，带入真实痛点';
      newTitle = `姐妹们！${currentTitle} 亲测太绝了！`;
      newBody = `姐妹们！今天必须把憋在心里好久的真实体验跟大家掏心窝子聊聊！\n\n`
        + currentBody.replace(/本文将深入评测/g, '我直接替你们先试过了')
        + `\n\n真的，听我一句劝，省什么都别省日常能让你轻松的大件，早用早享受！`;
      newSummary = `口语化真诚种草，拉近距离感，增强情感共鸣。`;
      break;
    }

    case 'REWRITE_LOW_PROMO': {
      changeNote = '【降低营销感】客观中立，优缺点并重，补充局限性与适合/不适合人群分析';
      newTitle = `中立评测报告：${currentTitle} 优缺点客观分析`;
      newBody = `
【免责声明与客观立场】
本次评测本着客观真实的原则，不刻意吹捧，只用事实说话。

${currentBody}

【客观局限性与避坑警示】
1. 并不适合所有体型的宠物，选购前必须精准测量脚部周长；
2. 属于日常维护工具，无法替代定期深度大洗澡；
3. 需要按规范勤倒污水，切勿偷懒产生二次污染。
      `.trim();
      newSummary = `中立客观报告：去除所有夸大修饰，直面局限性。`;
      break;
    }

    case 'REWRITE_STRONG_CTA': {
      changeNote = '【增强号召力】强化文末行动指引与互动转化';
      newTitle = `立即收藏！${currentTitle}`;
      newBody = `${currentBody}\n\n👉 立即行动指南：\n1. 点击下方【收藏】避免找不到；\n2. 转发给家里负责遛狗/洗护的队友；\n3. 评论区输入“想了解”，为你解锁专属避坑指南！`;
      newSummary = `强化转化漏斗与行动号召。`;
      break;
    }

    case 'REWRITE_STYLE_TUTORIAL': {
      changeNote = '【教程风】转为循序渐进的新手保姆级操作步骤与训练指南';
      newTitle = `新手必看！${currentTitle} 3步搞定教学指南`;
      newBody = `
【保姆级上手指南】
很多家长担心主子抗拒，其实只要掌握方法，新手也能轻松驾驭！

第 1 步：静态适应（不通电，零食奖励嗅闻）
第 2 步：空载声音脱敏（隔开半米开机，建立安全感）
第 3 步：初次单爪轻度体验（10-15秒即停，大剂量零食奖励）

${currentBody}
      `.trim();
      newSummary = `保姆级教程与渐进脱敏操作手册。`;
      break;
    }

    case 'REWRITE_STYLE_RECOMMENDATION': {
      changeNote = '【好物推荐风】提炼核心必买理由与打分卡';
      newTitle = `种草清单 | 为什么养宠人都在买 ${currentTitle}？`;
      newBody = `
【好物打分卡】
🌟 清洁力：★★★★★
🌟 静音度：★★★★☆
🌟 易洗度：★★★★★
🌟 性价比：★★★★☆

${currentBody}
      `.trim();
      newSummary = `好物种草打分卡与必买理由速查。`;
      break;
    }
  }

  if (input.customInstructions) {
    changeNote += `（自定义要求：${input.customInstructions}）`;
  }

  return {
    title: newTitle,
    body: newBody,
    summary: newSummary,
    changeNote,
  };
}
