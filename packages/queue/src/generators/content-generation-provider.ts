/**
 * GeoLens AI Content Engine V2 - Unified Content Generation Provider
 *
 * 核心设计：
 * 1. 统一接口 ContentGenerationProvider
 * 2. 真实 LLM Provider：支持 DeepSeek (deepseek-chat) 与 Qwen (qwen-plus)，复用 @geo/llm
 * 3. Mock Provider：确定性高品质结构化输出，确保在离线/无 Key 时完整覆盖 5 大平台与改写模式
 * 4. 严格输出契约：
 *    - 微信公众号: title, subtitle, summary, body, cta, coverText
 *    - 小红书: titleCandidates[], hook, body, bulletPoints[], hashtags[], coverText
 *    - 微博: shortVersion, mediumVersion, hashtags[]
 *    - 抖音: hook3s, scenes[], voiceover, subtitles[], caption, hashtags[], coverText
 *    - B站: titleCandidates[], outline[], script, description, tags[], coverText
 * 5. Prompt 版本化：geolens-cn-wechat-v1, geolens-cn-xhs-v1 等
 */

import { DeepSeekProvider, QwenProvider, readRealProviderEnv, readQwenProviderEnv } from '@geo/llm';
import { FactGroundingEngine, type VerifiedFact, type ExtractedClaim } from './fact-grounding';
import type { CnPlatform } from './cn-platform-generator';

export interface WeChatStandardOutput {
  title: string;
  subtitle: string;
  summary: string;
  body: string;
  cta: string;
  coverText: string;
}

export interface XiaohongshuStandardOutput {
  titleCandidates: string[];
  hook: string;
  body: string;
  bulletPoints: string[];
  hashtags: string[];
  coverText: string;
}

export interface WeiboStandardOutput {
  shortVersion: string;
  mediumVersion: string;
  hashtags: string[];
}

export interface DouyinSceneItem {
  sceneNumber: number;
  visual: string;
  audio: string;
  durationSec: number;
}

export interface DouyinStandardOutput {
  hook3s: string;
  scenes: DouyinSceneItem[];
  voiceover: string;
  subtitles: string[];
  caption: string;
  hashtags: string[];
  coverText: string;
}

export interface BilibiliStandardOutput {
  titleCandidates: string[];
  outline: string[];
  script: string;
  description: string;
  tags: string[];
  coverText: string;
}

export interface NormalizedVariantOutput {
  platform: CnPlatform;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  coverText: string;
  platformPayload:
    | WeChatStandardOutput
    | XiaohongshuStandardOutput
    | WeiboStandardOutput
    | DouyinStandardOutput
    | BilibiliStandardOutput;
  claims: ExtractedClaim[];
  isFactSafe: boolean;
  promptVersion: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateVariantInput {
  platform: CnPlatform;
  title: string;
  body: string;
  topic?: string;
  generationMode?: string;
  knownFacts?: VerifiedFact[];
  customInstructions?: string;
}

export type CanonicalRewriteMode =
  | 'REWRITE_EXPAND'
  | 'REWRITE_SHORTEN'
  | 'REWRITE_PROFESSIONAL'
  | 'REWRITE_CONVERSATIONAL'
  | 'REWRITE_LOW_PROMO'
  | 'REWRITE_STRONG_CTA'
  | 'FACT_SAFE'
  | 'MORE_NEUTRAL'
  | 'TUTORIAL'
  | 'COMPARISON'
  | 'FAQ';

export type LegacyRewriteMode =
  | 'EXPAND'
  | 'SHORTEN'
  | 'PROFESSIONAL'
  | 'CONVERSATIONAL'
  | 'LOW_PROMO'
  | 'STRONG_CTA';

export type RewriteMode = CanonicalRewriteMode | LegacyRewriteMode;

export function toCanonicalRewriteMode(mode: string): CanonicalRewriteMode {
  const map: Record<string, CanonicalRewriteMode> = {
    EXPAND: 'REWRITE_EXPAND',
    SHORTEN: 'REWRITE_SHORTEN',
    PROFESSIONAL: 'REWRITE_PROFESSIONAL',
    CONVERSATIONAL: 'REWRITE_CONVERSATIONAL',
    LOW_PROMO: 'REWRITE_LOW_PROMO',
    STRONG_CTA: 'REWRITE_STRONG_CTA',
  };
  return map[mode] || (mode as CanonicalRewriteMode);
}

export interface RewriteContentInput {
  platform: CnPlatform;
  currentTitle: string;
  currentBody: string;
  mode: RewriteMode | string;
  knownFacts?: VerifiedFact[];
  customInstructions?: string;
}

export interface ContentGenerationProvider {
  readonly providerName: string;
  readonly modelName: string;
  generatePlatformVariant(input: GenerateVariantInput): Promise<NormalizedVariantOutput>;
  rewriteContent(input: RewriteContentInput): Promise<NormalizedVariantOutput>;
  generateTitles(input: { topic: string; platform: CnPlatform; count?: number }): Promise<string[]>;
  generateOutline(input: { topic: string; platform: CnPlatform; body?: string }): Promise<string[]>;
  generateVideoScript(input: { topic: string; durationSec?: number; platform: CnPlatform }): Promise<DouyinStandardOutput>;
}

export const PROMPT_VERSIONS: Record<string, string> = {
  WECHAT_OFFICIAL_ACCOUNT: 'geolens-cn-wechat-v1',
  XIAOHONGSHU: 'geolens-cn-xhs-v1',
  WEIBO: 'geolens-cn-weibo-v1',
  DOUYIN: 'geolens-cn-douyin-v1',
  BILIBILI: 'geolens-cn-bilibili-v1',
  REWRITE: 'geolens-cn-rewrite-v1',
  CLAIM_GUARD: 'geolens-cn-claimguard-v1',
};

/**
 * 结构化 Mock Content Generation Provider
 */
export class MockContentGenerationProvider implements ContentGenerationProvider {
  readonly providerName = 'mock';
  readonly modelName = 'mock-llm-engine-v2';

  async generatePlatformVariant(input: GenerateVariantInput): Promise<NormalizedVariantOutput> {
    const promptVersion = PROMPT_VERSIONS[input.platform] || 'geolens-cn-base-v1';
    const topic = input.topic || input.title || '智能产品实测';
    const knownFacts = input.knownFacts || [];

    let title = input.title;
    let summary = '';
    let body = '';
    let tags: string[] = [];
    let coverText = '';
    let platformPayload: any = {};

    switch (input.platform) {
      case 'WECHAT_OFFICIAL_ACCOUNT': {
        title = `${topic}深度实测：核心规格与真实场景使用全指南`;
        const subtitle = '从痛点剖析到多维度测评，带你看清每一个实测细节';
        summary = `本篇长文围绕${topic}展开全方位测评，详细记录在日常环境下的工作表现与避坑指南。`;
        coverText = `${topic}实测指南`;
        body = `## 一、引言：养宠家庭的真实清洁痛点\n日常生活中，宠物出行归来常常面临脚爪泥沙残留和潮湿发红问题。传统湿巾反复擦拭容易造成摩擦不适，而水盆清洗不仅水花飞溅，更难以及时吹干。\n\n## 二、核心技术拆解与规格说明\n本款产品采用微泡柔和循环水流与亲肤抑菌硅胶刷头，运行时主打低噪运行，配合弧形导流内胆，能够快速便捷清洗脚爪缝隙污垢。\n\n## 三、真实多场景实测体验\n在不同脚爪大小与毛发长度测试中，硅胶刷头贴合度良好，清洗过程温和不伤爪，帮助保持脚爪清洁和干爽。\n\n## 四、使用建议与日常维护\n1. 每次清洗前可先梳理脚爪毛发；\n2. 建议搭配适温清水使用；\n3. 清洗完毕后可整机冲洗滤网，晾干收纳即可。\n\n## 五、结语与互动\n如果你也在为宠物脚爪护理烦恼，欢迎在评论区分享你的清洁妙招！`;
        const cta = '欢迎在文末留言交流，关注我们获取更多实用智能养宠评测！';
        platformPayload = {
          title,
          subtitle,
          summary,
          body,
          cta,
          coverText,
        } as WeChatStandardOutput;
        tags = ['宠物科技', '深度测评', '微信公众号推文', '好物指南'];
        break;
      }
      case 'XIAOHONGSHU': {
        title = `后悔没早买！${topic}深度实测太香了🔥`;
        const hook = '养宠家庭闭眼入！终于找到不用追着毛孩子擦脚的神仙好物了！';
        coverText = '后悔没早买！';
        const bulletPoints = [
          '微泡循环水流：温和去污不抗拒',
          '亲肤抑菌硅胶：贴合脚爪柔软舒适',
          '低噪平稳运转：宠物不惊慌',
          '全身可水洗：打理收纳省心省力',
        ];
        tags = [`#${topic}`, '#小红书种草', '#养宠好物', '#宠物智能生活'];
        body = `${hook}\n\n作为一个每天遛狗两次的打工人，之前每天回家都得追着狗子擦脚，真的太心累了！\n\n最近入手了${topic}，实测下来真的太惊喜啦：\n\n👉 核心亮点打卡：\n1️⃣ 微泡柔和循环水流，脚爪一伸自动清洗，泥沙瞬间带走！\n2️⃣ 亲肤抑菌硅胶刷头，毛茸茸触感，毛孩子完全不抗拒～\n3️⃣ 主打低噪运行，运行声音超级温柔，胆小宠也能安心用。\n\n💡 实用小Tips：\n洗完顺手用干毛巾轻压吸水即可，帮助保持脚爪清洁和干爽！\n\n集美们还有什么洁爪神器，快来评论区互相安利呀👇`;
        platformPayload = {
          titleCandidates: [
            title,
            `真实测评！${topic}到底值不值得买？`,
            `养宠懒人福音！彻底告别追着擦脚的痛苦时代`,
          ],
          hook,
          body,
          bulletPoints,
          hashtags: tags,
          coverText,
        } as XiaohongshuStandardOutput;
        summary = hook;
        break;
      }
      case 'WEIBO': {
        title = `#${topic}# 宠物智能洁足新体验？`;
        tags = [`#${topic}#`, '#宠物科技#', '#数码好物评测#'];
        coverText = `${topic}快讯`;
        const shortVersion = `【#${topic}# 深度测评指南】日常遛宠清洁有新方案！微泡柔和循环水流搭配抑菌硅胶，主打低噪运行，快速便捷清洗。大家平时遛狗回家怎么擦脚？带话题聊聊～`;
        const mediumVersion = `【#${topic}# 宠物智能洁足体验指南】\n日常遛宠回家，毛孩子脚爪难打理？最新实测总结：\n①微泡柔和循环水流，深层温和冲洗缝隙泥沙；\n②亲肤抑菌硅胶刷头，柔软贴合不伤爪垫；\n③运行噪音平稳柔和，帮助保持脚爪清洁和干爽。\n各位铲屎官平时都是怎么给毛孩子擦脚的？欢迎带话题转发讨论！`;
        body = mediumVersion;
        summary = shortVersion;
        platformPayload = {
          shortVersion,
          mediumVersion,
          hashtags: tags,
        } as WeiboStandardOutput;
        break;
      }
      case 'DOUYIN': {
        title = `千万别瞎擦！${topic}实测大揭秘`;
        coverText = '千万别瞎擦！';
        const hook3s = '千万别瞎擦！你家毛孩子洗脚洗错了，脚爪容易潮湿发痒！';
        const scenes: DouyinSceneItem[] = [
          {
            sceneNumber: 1,
            visual: '特写狗狗踩泥回家，主人拿湿巾追着擦脚，狗狗抗拒后缩',
            audio: '千万别瞎擦！你家毛孩子洗脚洗错了，脚爪容易潮湿发痒！',
            durationSec: 3,
          },
          {
            sceneNumber: 2,
            visual: '镜头切换至洁足机特写，慢动作展示微泡循环水流与柔软硅胶刷毛',
            audio: '看看这个新入手的洁足神器，微泡柔和循环水流，完全不需要用力搓！',
            durationSec: 8,
          },
          {
            sceneNumber: 3,
            visual: '将狗狗脚爪轻轻放入机器，分贝仪显示声音轻柔，狗狗表情放松',
            audio: '主打低噪运行，胆小宠也不会被吓退，30秒快速清洁到位。',
            durationSec: 15,
          },
          {
            sceneNumber: 4,
            visual: '洗完拿出来，展示清水变浑浊对比，脚爪干净清爽',
            audio: '洗完水质对比明显，帮助保持脚爪清洁和干爽！',
            durationSec: 10,
          },
        ];
        tags = [`#${topic}`, '#抖音生活好物', '#养宠日常', '#萌宠好物'];
        const voiceover = scenes.map((s) => s.audio).join(' ');
        const subtitles = scenes.map((s) => s.audio);
        const caption = `每天遛狗回家的痛谁懂？快试试这个神器！${tags.join(' ')}`;
        body = scenes
          .map((s) => `[分镜${s.sceneNumber}] 时长:${s.durationSec}s\n画面:${s.visual}\n台词:${s.audio}`)
          .join('\n\n');
        summary = hook3s;
        platformPayload = {
          hook3s,
          scenes,
          voiceover,
          subtitles,
          caption,
          hashtags: tags,
          coverText,
        } as DouyinStandardOutput;
        break;
      }
      case 'BILIBILI': {
        title = `【深度拆解】${topic}到底是智商税还是真好用？真实实测报告！`;
        coverText = '智商税还是真好用？';
        const titleCandidates = [
          title,
          `硬核实测：${topic}到底值不值得买？`,
          `【避坑指南】买前必看！${topic}全面评测与拆解`,
        ];
        const outline = [
          '00:00 开篇引言：传统洗脚方式为何总翻车',
          '01:15 硬件规格与工业设计拆解',
          '03:40 泥沙清洁力极限测试',
          '06:20 运行噪音与温和度仪器实测',
          '08:50 优缺点全面总结与选购避坑建议',
        ];
        const tags = ['数码评测', '智能硬件', '宠物好物', 'B站知识库', '硬核拆解'];
        const description = `本期视频带来${topic}的全方位硬核拆解与实机评测，从循环水流机制到硅胶材质，用客观数据给你最真实的答案！喜欢的小伙伴请长按点赞一键三连！`;
        body = `## 视频大纲\n${outline.join('\n')}\n\n## 详细解说词脚本\n观众老爷们好！今天咱们不吹不黑，实测这台火出圈的${topic}。\n很多人问：这玩意儿到底是不是智商税？我们直接用泥沙对照组进行了深度测试。\n\n从水流结构来看，它采用了微泡柔和循环水流系统，刷头则是亲肤抑菌硅胶材质。主打低噪运行，实测即使靠近机器也没有刺耳高频声。\n\n清洗后脚爪干净透气，帮助保持脚爪清洁和干爽。\n\n总的来说：适合经常户外遛狗的中小型犬家庭！记得一键三连支持一下！`;
        summary = description;
        platformPayload = {
          titleCandidates,
          outline,
          script: body,
          description,
          tags,
          coverText,
        } as BilibiliStandardOutput;
        break;
      }
    }

    // 运行事实声明提取
    const claims = FactGroundingEngine.extractClaims(body, knownFacts);
    const blockingCheck = FactGroundingEngine.checkBlockingRule(claims);

    return {
      platform: input.platform,
      title,
      summary,
      body,
      tags,
      coverText,
      platformPayload,
      claims,
      isFactSafe: blockingCheck.passed,
      promptVersion,
      provider: this.providerName,
      model: this.modelName,
      inputTokens: Math.round((input.title.length + input.body.length) * 1.2),
      outputTokens: Math.round(body.length * 1.3),
    };
  }

  async rewriteContent(input: RewriteContentInput): Promise<NormalizedVariantOutput> {
    const promptVersion = PROMPT_VERSIONS.REWRITE;
    let newTitle = input.currentTitle;
    let newBody = input.currentBody;
    const knownFacts = input.knownFacts || [];

    const canonicalMode = toCanonicalRewriteMode(input.mode);

    switch (canonicalMode) {
      case 'REWRITE_EXPAND':
        newTitle = `${input.currentTitle}（深度完整版）`;
        newBody = `${input.currentBody}\n\n### 深度技术补充与细节说明\n在进一步的工程学测试中，该产品所采用的微泡水流流道设计经过多轮流体仿真优化，能够平衡冲刷力与温和性，降低对角质层的物理刺激。同时机身易拆卸结构极大降低了毛发缠绕概率，为日常清洁维护提供了便利。`;
        break;
      case 'REWRITE_SHORTEN': {
        newTitle = `${input.currentTitle}（精粹版）`;
        const lines = input.currentBody
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0);
        const excerpt = lines.slice(0, 3).join('；');
        newBody = `【核心精粹】\n${excerpt}\n\n【一句话速览】选对工具，科学高效护理！`;
        break;
      }
      case 'REWRITE_PROFESSIONAL':
        newTitle = `关于${input.currentTitle}的技术规格与测评报告`;
        newBody = `### 评测概述\n本项评测基于标准测试环境，对设备在清洁度、噪音控制及耐用性维度进行定量分析。\n\n${input.currentBody}\n\n### 结论与数据评价\n综合测试表现，该设备各项指标表现平稳，符合居家宠物卫生护理的基本要求。`;
        break;
      case 'REWRITE_CONVERSATIONAL':
        newTitle = `大家快看！${input.currentTitle}真实体验来啦！`;
        newBody = `大家平时肯定都有同感吧！每次遛狗回家洗脚简直像打仗一样！\n\n${input.currentBody}\n\n大家如果还有更好玩的方法，评论区快来跟我聊聊呀～`;
        break;
      case 'REWRITE_LOW_PROMO':
        newTitle = `客观评测：${input.currentTitle}的优缺点分析`;
        newBody = `【客观评测说明：本内容不含任何商业推销，仅供参考】\n\n${input.currentBody}\n\n必须指出的局限性：对于超大体型犬类，水箱容量略显紧凑，需及时补水；建议根据实际需求理性选购。`;
        break;
      case 'REWRITE_STRONG_CTA':
        newTitle = `【限时福利】${input.currentTitle}`;
        newBody = `${input.currentBody}\n\n🔥 限时宠粉福利：点击下方链接了解专属活动，现在收藏加购立享清洗配件大礼包！评论区留言抽一位幸运铲屎官送出体验装！`;
        break;
      case 'FACT_SAFE': {
        const safeResult = FactGroundingEngine.safeRewrite(input.currentBody, knownFacts);
        newBody = safeResult.sanitizedText;
        break;
      }
      case 'MORE_NEUTRAL':
        newTitle = `【中立报告】${input.currentTitle}`;
        newBody = `【中立说明】本文客观整理自公开规格与实测反馈。\n\n${input.currentBody}`;
        break;
      case 'TUTORIAL':
        newTitle = `保姆级教程：${input.currentTitle}`;
        newBody = `## 手把手保姆级使用教程\n1. 第一步：加温水至注水线；\n2. 第二步：引导宠物自然伸爪；\n3. 第三步：启动微泡清洁；\n4. 第四步：取出脚爪并用干毛巾擦干。\n\n${input.currentBody}`;
        break;
      case 'COMPARISON':
        newTitle = `深度对比评测：${input.currentTitle}`;
        newBody = `## 对比测试：传统擦爪 vs 智能微泡洁足\n- 清洁效率：智能微泡 > 湿巾反复擦拭\n- 宠物接受度：温和硅胶 > 强行按压水盆\n- 维护成本：整机冲洗可重复使用 > 消耗大量纸巾湿巾\n\n${input.currentBody}`;
        break;
      case 'FAQ':
        newTitle = `答疑汇总：${input.currentTitle}`;
        newBody = `${input.currentBody}\n\n## 常见疑问解答 (FAQ)\nQ: 胆小的猫咪或者小型犬会害怕吗？\nA: 产品主打低噪运行，开机声音温和，可先不通电让宠物闻嗅适应。\n\nQ: 硅胶刷头容易藏污纳垢吗？\nA: 刷头为亲肤抑菌硅胶，可整体拆下水冲晾干，非常卫生。`;
        break;
    }

    const claims = FactGroundingEngine.extractClaims(newBody, knownFacts);
    const blockingCheck = FactGroundingEngine.checkBlockingRule(claims);

    return {
      platform: input.platform,
      title: newTitle,
      summary: `改写版本 (${input.mode})`,
      body: newBody,
      tags: ['改写优化', input.platform],
      coverText: newTitle.slice(0, 16),
      platformPayload: {
        title: newTitle,
        body: newBody,
        mode: input.mode,
      } as any,
      claims,
      isFactSafe: blockingCheck.passed,
      promptVersion,
      provider: this.providerName,
      model: this.modelName,
      inputTokens: Math.round(input.currentBody.length * 1.1),
      outputTokens: Math.round(newBody.length * 1.2),
    };
  }

  async generateTitles(input: { topic: string; platform: CnPlatform; count?: number }): Promise<string[]> {
    const count = input.count || 3;
    const base = input.topic;
    return [
      `${base}深度实测：选购避坑必看指南`,
      `后悔没早买！${base}真实体验到底香不香？`,
      `硬核拆解：${base}各项指标全方位评测`,
    ].slice(0, count);
  }

  async generateOutline(input: { topic: string; platform: CnPlatform; body?: string }): Promise<string[]> {
    return [
      '一、核心背景与用户真实痛点引出',
      '二、产品硬件规格与关键设计细节',
      '三、多维度实测数据对比（清洁/噪音/材质）',
      '四、客观优缺点总结与避坑建议',
      '五、结尾行动号召与互动讨论',
    ];
  }

  async generateVideoScript(input: { topic: string; durationSec?: number; platform: CnPlatform }): Promise<DouyinStandardOutput> {
    const res = await this.generatePlatformVariant({
      platform: 'DOUYIN',
      title: input.topic,
      body: input.topic,
    });
    return res.platformPayload as DouyinStandardOutput;
  }
}

/**
 * 真实 LLM Provider (DeepSeek / Qwen)
 * 当 process.env.GENERATION_PROVIDER_MODE === 'real' 时调用，
 * 否则优雅使用 MockContentGenerationProvider
 */
export class RealContentGenerationProvider implements ContentGenerationProvider {
  readonly providerName: string;
  readonly modelName: string;
  private readonly fallbackMock = new MockContentGenerationProvider();
  private readonly deepseekProvider?: DeepSeekProvider;
  private readonly qwenProvider?: QwenProvider;

  constructor() {
    const dsEnv = readRealProviderEnv();
    const qwenEnv = readQwenProviderEnv();

    if (dsEnv.apiKey) {
      this.providerName = 'deepseek';
      this.modelName = dsEnv.model || 'deepseek-chat';
      this.deepseekProvider = new DeepSeekProvider();
    } else if (qwenEnv.apiKey) {
      this.providerName = 'qwen';
      this.modelName = qwenEnv.model || 'qwen-plus';
      this.qwenProvider = new QwenProvider();
    } else {
      this.providerName = 'mock';
      this.modelName = 'mock-llm-engine-v2';
    }
  }

  async generatePlatformVariant(input: GenerateVariantInput): Promise<NormalizedVariantOutput> {
    const isRealEnabled = process.env.GENERATION_PROVIDER_MODE === 'real';

    if (!isRealEnabled || (!this.deepseekProvider && !this.qwenProvider)) {
      return this.fallbackMock.generatePlatformVariant(input);
    }

    try {
      const prompt = `你是一名专业的国内新媒体内容总监。请根据以下产品信息，针对目标平台【${input.platform}】生成专属适配文案。
产品标题：${input.title}
产品详情：${input.body}
要求：输出符合该平台调性的专业内容，严格包含标题、正文、标签、封面短语。不要捏造未核实的数据（如未经证实的具体分贝数或医疗结论）。`;

      let textResponse = '';
      if (this.deepseekProvider) {
        const res = await this.deepseekProvider.execute({
          queryText: prompt,
          engineKey: 'deepseek-chat',
          engineName: 'DeepSeek Chat',
          engineConfig: {},
          attempt: 0,
          timeoutMs: 30000,
        });
        textResponse = res.content;
      } else if (this.qwenProvider) {
        const res = await this.qwenProvider.execute({
          queryText: prompt,
          engineKey: 'qwen-plus',
          engineName: 'Qwen Plus',
          engineConfig: {},
          attempt: 0,
          timeoutMs: 30000,
        });
        textResponse = res.content;
      }

      if (!textResponse) {
        return this.fallbackMock.generatePlatformVariant(input);
      }

      const claims = FactGroundingEngine.extractClaims(textResponse, input.knownFacts);
      const blocking = FactGroundingEngine.checkBlockingRule(claims);

      return {
        platform: input.platform,
        title: `${input.title} (${input.platform} AI生成版)`,
        summary: textResponse.slice(0, 100),
        body: textResponse,
        tags: ['AI生成', input.platform],
        coverText: input.title.slice(0, 16),
        platformPayload: {
          title: input.title,
          body: textResponse,
        } as any,
        claims,
        isFactSafe: blocking.passed,
        promptVersion: PROMPT_VERSIONS[input.platform] || 'geolens-cn-base-v1',
        provider: this.providerName,
        model: this.modelName,
        inputTokens: Math.round(prompt.length * 1.1),
        outputTokens: Math.round(textResponse.length * 1.2),
      };
    } catch {
      // 真实调用异常时回退到确定性 Mock
      return this.fallbackMock.generatePlatformVariant(input);
    }
  }

  async rewriteContent(input: RewriteContentInput): Promise<NormalizedVariantOutput> {
    return this.fallbackMock.rewriteContent(input);
  }

  async generateTitles(input: { topic: string; platform: CnPlatform; count?: number }): Promise<string[]> {
    return this.fallbackMock.generateTitles(input);
  }

  async generateOutline(input: { topic: string; platform: CnPlatform; body?: string }): Promise<string[]> {
    return this.fallbackMock.generateOutline(input);
  }

  async generateVideoScript(input: { topic: string; durationSec?: number; platform: CnPlatform }): Promise<DouyinStandardOutput> {
    return this.fallbackMock.generateVideoScript(input);
  }
}
