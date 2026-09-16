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
  mapRatioToWanxSize,
  toCanonicalRewriteMode,
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

  test('1b. AG-AI-01: 百分比声明稳定提取 (除菌率98.7%, 杀菌率99%, 去除率95.5%, 准确率99.9%, 98.7%)', () => {
    const samples = [
      { text: '经权威实验室检测，除菌率98.7%', expected: '除菌率98.7%' },
      { text: '高效循环冲洗，杀菌率99%', expected: '杀菌率99%' },
      { text: '强力去除微尘，去除率95.5%', expected: '去除率95.5%' },
      { text: '微气泡靶向清洁，准确率99.9%', expected: '准确率99.9%' },
      { text: '整体清洁效率达到 98.7%', expected: '98.7%' },
    ];

    for (const { text, expected } of samples) {
      const claims = FactGroundingEngine.extractClaims(text);
      assert.ok(claims.length >= 1, `文本「${text}」应成功提取至少 1 项声明`);
      const claim = claims.find((c) => c.claim.includes(expected));
      assert.ok(claim, `应提取到包含「${expected}」的声明`);
      assert.equal(claim.type, 'NUMERICAL');
      assert.equal(claim.supportStatus, 'UNVERIFIED');
      assert.ok(claim.id, 'ExtractedClaim 必须具备稳定 id');
      assert.ok(claim.id.startsWith('claim-numerical-'), 'id 格式应为 claim-numerical-*');
    }
  });

  test('1c. AG-AI-04: ExtractedClaim 具备稳定组合与唯一 id 字段', () => {
    const text = '运行噪音低于45dB，除菌率98.7%，杜绝趾间炎，销量第一。';
    const claims = FactGroundingEngine.extractClaims(text);
    assert.ok(claims.length >= 4, `提取声明数应 >= 4，实际: ${claims.length}`);
    const ids = claims.map((c) => c.id);
    assert.equal(new Set(ids).size, claims.length, '所有 extracted claim 的 id 必须唯一且确定');
    for (const claim of claims) {
      assert.ok(typeof claim.id === 'string' && claim.id.length > 0, 'id 字段必须为非空字符串');
    }
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

  test('3b. Fact Guard & Safe Rewrite Regression (45dB, 98.7%, 行业第一, 销量第一, 杜绝趾间炎 阻断与改写)', () => {
    const targetText = 'PawClean 运行噪音45dB，除菌率98.7%，行业第一，销量第一，彻底杜绝趾间炎。';
    const verifiedKnowledge: VerifiedFact[] = [
      { id: 'f1', claim: '食品级硅胶', factType: 'FEATURE', status: 'VERIFIED', sourceType: 'TARGET_ENTITY' },
      { id: 'f2', claim: '2000mAh', factType: 'SPEC', status: 'VERIFIED', sourceType: 'TARGET_ENTITY' },
      { id: 'f3', claim: 'Type-C', factType: 'FEATURE', status: 'VERIFIED', sourceType: 'TARGET_ENTITY' },
      { id: 'f4', claim: '15W', factType: 'SPEC', status: 'VERIFIED', sourceType: 'TARGET_ENTITY' },
    ];

    // 1. 验证阻断
    const claims = FactGroundingEngine.extractClaims(targetText, verifiedKnowledge);
    const check = FactGroundingEngine.checkBlockingRule(claims);
    assert.equal(check.passed, false, '违规声明必须阻断');
    assert.ok(check.unverifiedCount >= 5, `应识别 5 项未核验声明，实际识别: ${check.unverifiedCount}`);

    // 2. 验证已核验事实通过
    const compliantText = 'PawClean 采用食品级硅胶刷头，配备2000mAh电池，支持Type-C充电与15W运行功率。';
    const compliantClaims = FactGroundingEngine.extractClaims(compliantText, verifiedKnowledge);
    const compliantCheck = FactGroundingEngine.checkBlockingRule(compliantClaims);
    assert.equal(compliantCheck.passed, true, '全部吻合已知事实库的内容应放行');

    // 3. 验证 Safe Rewrite 不保留未核验的具体数字、比例、排名与医疗结论
    const rewriteRes = FactGroundingEngine.safeRewrite(targetText, verifiedKnowledge);
    assert.ok(!rewriteRes.sanitizedText.includes('45dB'), '不得保留 45dB 具体数字');
    assert.ok(!rewriteRes.sanitizedText.includes('98.7%'), '不得保留 98.7% 具体比例');
    assert.ok(!rewriteRes.sanitizedText.includes('行业第一'), '不得保留 行业第一 极限词');
    assert.ok(!rewriteRes.sanitizedText.includes('销量第一'), '不得保留 销量第一 排名词');
    assert.ok(!rewriteRes.sanitizedText.includes('杜绝趾间炎'), '不得保留 杜绝趾间炎 医疗宣称');
    assert.equal(rewriteRes.remainingUnverifiedClaims.length, 0, '安全改写后未核查声明为 0');
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

  test('5. 多模式改写引擎（包含所有 REWRITE_* 规范模式与兼容别名）', async () => {
    const baseText = 'PawClean 采用微泡循环水流与亲肤抑菌硅胶，运行噪音低于45dB，杜绝趾间炎。';

    const canonicalModes = [
      'REWRITE_EXPAND',
      'REWRITE_SHORTEN',
      'REWRITE_PROFESSIONAL',
      'REWRITE_CONVERSATIONAL',
      'REWRITE_LOW_PROMO',
      'REWRITE_STRONG_CTA',
      'FACT_SAFE',
      'MORE_NEUTRAL',
      'TUTORIAL',
      'COMPARISON',
      'FAQ',
    ] as const;

    for (const mode of canonicalModes) {
      const res = await provider.rewriteContent({
        platform: 'WECHAT_OFFICIAL_ACCOUNT',
        currentTitle: 'PawClean 评测',
        currentBody: baseText,
        mode,
      });
      assert.ok(res.body.length > 0, `改写模式 ${mode} 应产出非空正文`);
      assert.notEqual(res.body, baseText, `改写模式 ${mode} 正文必须发生目标变化`);
      assert.equal(res.promptVersion, 'geolens-cn-rewrite-v1');
      if (mode === 'FACT_SAFE') {
        assert.equal(res.isFactSafe, true, 'FACT_SAFE 改写后必须事实安全');
      }
    }

    // 验证历史短名向后兼容映射
    const legacyShortNames = ['EXPAND', 'SHORTEN', 'PROFESSIONAL', 'CONVERSATIONAL', 'LOW_PROMO', 'STRONG_CTA'] as const;
    for (const shortName of legacyShortNames) {
      const canonical = toCanonicalRewriteMode(shortName);
      assert.equal(canonical, `REWRITE_${shortName}`);
      const res = await provider.rewriteContent({
        platform: 'WECHAT_OFFICIAL_ACCOUNT',
        currentTitle: 'PawClean 评测',
        currentBody: baseText,
        mode: shortName,
      });
      assert.notEqual(res.body, baseText, `短名 ${shortName} 必须触发对应改写逻辑`);
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

  test('7b. AG-AI-03: Wanx 官方比例规格映射 (1:1, 9:16, 3:4, 16:9, 900:383)', () => {
    const square = mapRatioToWanxSize('1:1');
    assert.equal(square.providerSize, '1024*1024');
    assert.equal(square.orientation, 'square');

    const portrait916 = mapRatioToWanxSize('9:16');
    assert.equal(portrait916.providerSize, '720*1280');
    assert.equal(portrait916.orientation, 'portrait');

    const portrait34 = mapRatioToWanxSize('3:4');
    assert.equal(portrait34.providerSize, '720*1280');
    assert.equal(portrait34.orientation, 'portrait');
    assert.equal(portrait34.cropMode, 'FIT_OR_CROP_3_4');

    const landscape169 = mapRatioToWanxSize('16:9');
    assert.equal(landscape169.providerSize, '1280*720');
    assert.equal(landscape169.orientation, 'landscape');

    const landscape900383 = mapRatioToWanxSize('900:383');
    assert.equal(landscape900383.providerSize, '1280*720');
    assert.equal(landscape900383.orientation, 'landscape');
    assert.equal(landscape900383.cropMode, 'FIT_OR_CROP_900_383');
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
