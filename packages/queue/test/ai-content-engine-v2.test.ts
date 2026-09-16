import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  FactGroundingEngine,
  type VerifiedFact,
  MockContentGenerationProvider,
  RealContentGenerationProvider,
  sanitizeImagePrompt,
  MockImageGenerationProvider,
  WanxImageGenerationProvider,
} from '../src';

describe('AI Content Engine V2 - Fact Grounding & Claim Extraction', () => {
  const verifiedFacts: VerifiedFact[] = [
    {
      id: 'fact-1',
      claim: '微泡柔和循环水流',
      factType: 'FEATURE',
      status: 'VERIFIED',
      sourceType: 'TARGET_ENTITY',
    },
    {
      id: 'fact-2',
      claim: '亲肤抑菌硅胶刷头',
      factType: 'FEATURE',
      status: 'USER_CONFIRMED',
      sourceType: 'USER_INPUT',
    },
  ];

  test('1. Claim Extraction: 提取数字规格、医疗暗示与绝对化词汇', () => {
    const rawText =
      'PawClean 运行噪音低于45dB，只需30秒快速清洗，杀菌率高达98.7%，能彻底杜绝趾间炎！它是全网第一款高档洁爪神器，仅售299元。';

    const claims = FactGroundingEngine.extractClaims(rawText, verifiedFacts);
    assert.ok(claims.length >= 5, `应提取至少 5 项核心声明，实际提取: ${claims.length}`);

    const noiseClaim = claims.find((c) => c.claim.includes('45dB') || c.claim.includes('低于45dB'));
    assert.ok(noiseClaim, '应提取到 45dB 噪音声明');
    assert.equal(noiseClaim.type, 'SPEC');
    assert.equal(noiseClaim.supportStatus, 'UNVERIFIED');

    const medicalClaim = claims.find((c) => c.claim.includes('趾间炎'));
    assert.ok(medicalClaim, '应提取到 趾间炎 医疗暗示');
    assert.equal(medicalClaim.type, 'MEDICAL');
    assert.equal(medicalClaim.supportStatus, 'UNVERIFIED');

    const superlativeClaim = claims.find((c) => c.claim.includes('全网第一'));
    assert.ok(superlativeClaim, '应提取到 全网第一 极限词');
    assert.equal(superlativeClaim.type, 'SUPERLATIVE');
    assert.equal(superlativeClaim.supportStatus, 'UNVERIFIED');
  });

  test('2. Blocking Rule: 未核实声明必须触发阻断拦截', () => {
    const textWithUnverified = '产品运行噪音低于45dB，有效杜绝趾间炎。';
    const claims = FactGroundingEngine.extractClaims(textWithUnverified, verifiedFacts);
    const check = FactGroundingEngine.checkBlockingRule(claims);

    assert.equal(check.passed, false, '包含未核实事实时必须阻断');
    assert.ok(check.unverifiedCount >= 2, '未核实声明数量应 >= 2');
    assert.ok(check.blockingClaims.length >= 2, '阻断声明列表非空');
  });

  test('3. Safe Rewrite: 自动安全改写，平替未核实数字与医疗结论', () => {
    const rawText = 'PawClean 运行噪音低于45dB，只需30秒快速清洗，帮助杜绝趾间炎，是全网第一的洁足设备。';
    const result = FactGroundingEngine.safeRewrite(rawText, verifiedFacts);

    assert.ok(!result.sanitizedText.includes('45dB'), '改写后不得残留 45dB');
    assert.ok(!result.sanitizedText.includes('杜绝趾间炎'), '改写后不得残留 杜绝趾间炎');
    assert.ok(!result.sanitizedText.includes('全网第一'), '改写后不得残留 全网第一');
    assert.ok(result.sanitizedText.includes('低噪运行'), '应平替为中立低噪表述');
    assert.ok(result.sanitizedText.includes('保持脚爪清洁和干爽'), '应平替为合规护理表述');
    assert.equal(result.remainingUnverifiedClaims.length, 0, '安全改写后无残留未核实声明');
    assert.ok(result.changeSummary.length >= 3, '应记录改写操作详情');
  });
});

describe('AI Content Engine V2 - Standardized Platform Generation', () => {
  const provider = new MockContentGenerationProvider();

  test('4. 5 平台结构化输出契约 (WeChat, Xiaohongshu, Weibo, Douyin, Bilibili)', async () => {
    // 微信公众号
    const wx = await provider.generatePlatformVariant({
      platform: 'WECHAT_OFFICIAL_ACCOUNT',
      title: 'PawClean 实测指南',
      body: 'PawClean 采用微泡循环水流，亲肤抑菌硅胶刷头，主打低噪运行。',
    });
    assert.equal(wx.platform, 'WECHAT_OFFICIAL_ACCOUNT');
    assert.ok(wx.platformPayload.title);
    assert.ok(wx.platformPayload.subtitle);
    assert.ok(wx.platformPayload.summary);
    assert.ok(wx.platformPayload.body);
    assert.ok(wx.platformPayload.cta);
    assert.ok(wx.platformPayload.coverText);
    assert.equal(wx.isFactSafe, true);

    // 小红书
    const xhs = await provider.generatePlatformVariant({
      platform: 'XIAOHONGSHU',
      title: 'PawClean 种草实测',
      body: 'PawClean 微泡水流温和清洁。',
    });
    assert.equal(xhs.platform, 'XIAOHONGSHU');
    assert.ok(Array.isArray(xhs.platformPayload.titleCandidates));
    assert.ok(xhs.platformPayload.hook);
    assert.ok(xhs.platformPayload.body);
    assert.ok(Array.isArray(xhs.platformPayload.bulletPoints));
    assert.ok(Array.isArray(xhs.platformPayload.hashtags));
    assert.ok(xhs.platformPayload.coverText);

    // 微博
    const wb = await provider.generatePlatformVariant({
      platform: 'WEIBO',
      title: 'PawClean 微博快讯',
      body: '微泡循环水流，温和去污。',
    });
    assert.equal(wb.platform, 'WEIBO');
    assert.ok(wb.platformPayload.shortVersion);
    assert.ok(wb.platformPayload.mediumVersion);
    assert.ok(Array.isArray(wb.platformPayload.hashtags));

    // 抖音
    const dy = await provider.generatePlatformVariant({
      platform: 'DOUYIN',
      title: 'PawClean 抖音分镜脚本',
      body: '60秒分镜头实测。',
    });
    assert.equal(dy.platform, 'DOUYIN');
    assert.ok(dy.platformPayload.hook3s);
    assert.ok(Array.isArray(dy.platformPayload.scenes));
    assert.ok(dy.platformPayload.scenes.length >= 3);
    assert.ok(dy.platformPayload.scenes[0].visual);
    assert.ok(dy.platformPayload.scenes[0].audio);
    assert.ok(dy.platformPayload.voiceover);
    assert.ok(Array.isArray(dy.platformPayload.subtitles));
    assert.ok(dy.platformPayload.caption);

    // B站
    const bili = await provider.generatePlatformVariant({
      platform: 'BILIBILI',
      title: 'PawClean B站视频大纲与专栏',
      body: '硬核拆解视频解说词与专栏。',
    });
    assert.equal(bili.platform, 'BILIBILI');
    assert.ok(Array.isArray(bili.platformPayload.titleCandidates));
    assert.ok(Array.isArray(bili.platformPayload.outline));
    assert.ok(bili.platformPayload.script);
    assert.ok(bili.platformPayload.description);
    assert.ok(Array.isArray(bili.platformPayload.tags));
  });

  test('5. 多模式改写引擎（包含 FACT_SAFE, MORE_NEUTRAL, TUTORIAL, COMPARISON, FAQ）', async () => {
    const baseText = 'PawClean 采用微泡循环水流与亲肤抑菌硅胶，运行噪音低于45dB，杜绝趾间炎。';

    const modes = [
      'EXPAND',
      'SHORTEN',
      'PROFESSIONAL',
      'CONVERSATIONAL',
      'LOW_PROMO',
      'STRONG_CTA',
      'FACT_SAFE',
      'MORE_NEUTRAL',
      'TUTORIAL',
      'COMPARISON',
      'FAQ',
    ] as const;

    for (const mode of modes) {
      const res = await provider.rewriteContent({
        platform: 'WECHAT_OFFICIAL_ACCOUNT',
        currentTitle: 'PawClean 评测',
        currentBody: baseText,
        mode,
      });
      assert.ok(res.body.length > 0, `改写模式 ${mode} 应产出非空正文`);
      assert.equal(res.promptVersion, 'geolens-cn-rewrite-v1');
      if (mode === 'FACT_SAFE') {
        assert.equal(res.isFactSafe, true, 'FACT_SAFE 改写后必须事实安全');
      }
    }
  });
});

describe('AI Content Engine V2 - Image Generation & Safety', () => {
  test('6. Image Fact Safety: 清洗未经证实的产品屏幕与医疗标识', () => {
    const rawPrompt =
      'ultra-realistic photo of smart pet paw cleaner with bright touchscreen led display and medical cfda certified badge on modern bathroom counter';
    const { safePrompt, isModified, warnings } = sanitizeImagePrompt(rawPrompt);

    assert.equal(isModified, true, '包含虚构硬件与医疗标识时必须被清洗');
    assert.ok(!safePrompt.includes('touchscreen'), '不得包含 touchscreen');
    assert.ok(!safePrompt.includes('cfda certified'), '不得包含 cfda certified');
    assert.ok(warnings.length >= 2, '应给出对应安全警告');
  });

  test('7. MockImageGenerationProvider: 按照平台标准比例生成图像与排版', async () => {
    const imgProvider = new MockImageGenerationProvider();
    const ratios = ['900:383', '3:4', '1:1', '9:16', '16:9'] as const;

    for (const ratio of ratios) {
      const output = await imgProvider.generateImage({
        prompt: 'modern pet paw cleaner, clean studio lighting',
        ratio,
        style: 'TECH',
        textOverlay: {
          mainTitle: 'PawClean 智能洁足机',
          subtitle: '微泡循环水流实测',
          badge: '干货指南',
        },
      });

      assert.equal(output.status, 'COMPLETED');
      assert.equal(output.ratio, ratio);
      assert.ok(output.imageUrl?.startsWith('data:image/svg+xml;base64,'));
      assert.ok(output.imageBuffer && output.imageBuffer.length > 100);
      assert.ok(output.checksum.length === 64);
    }
  });

  test('8. RealContentGenerationProvider: 优雅降级与 Provider 标识', async () => {
    const realProvider = new RealContentGenerationProvider();
    assert.ok(['deepseek', 'qwen', 'mock'].includes(realProvider.providerName));

    const titles = await realProvider.generateTitles({
      topic: '智能洁足机',
      platform: 'WECHAT_OFFICIAL_ACCOUNT',
      count: 3,
    });
    assert.equal(titles.length, 3);
  });
});
