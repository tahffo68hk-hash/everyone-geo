import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  generatePlatformVariant,
  rewriteContent,
  extractSafeFactCheckNotes,
  type GeneratePlatformInput,
} from '../src/generators/cn-platform-generator';

test('1. CN Platform Content Generation: 5 Platforms Coverage', () => {
  const baseInput: GeneratePlatformInput = {
    platform: 'WECHAT_OFFICIAL_ACCOUNT',
    draftId: '9098ed88-170b-4c44-be9f-a9c88c166486',
    sourceRevisionId: 'aac89b56-d3ec-408c-8526-e3a97dc8562e',
    title: 'PawClean 智能宠物洁足机深度评测',
    body: 'PawClean 智能宠物洁足机专为中小型犬猫日常户外出行后的爪部清洁设计。产品采用创新的 360 度循环微泡喷淋系统与食品级柔软硅胶毛刷，在30秒内温和且高效地清除脚掌泥沙。噪音控制在45分贝以内。',
    summary: 'PawClean 智能宠物洁足机深度评测指南',
    tags: ['宠物科技', 'PawClean', '洁足机'],
  };

  // A. 微信公众号版
  const wechat = generatePlatformVariant({ ...baseInput, platform: 'WECHAT_OFFICIAL_ACCOUNT' });
  assert.strictEqual(wechat.platform, 'WECHAT_OFFICIAL_ACCOUNT');
  assert.strictEqual(wechat.contentType, 'LONG_FORM');
  assert.ok(wechat.title.includes('PawClean'));
  assert.ok(wechat.body.includes('<h2>一、产品定位与核心技术亮点</h2>'));
  assert.ok(wechat.body.includes('💬 互动话题'));
  assert.ok(wechat.imageBriefs.length >= 2);
  assert.strictEqual(wechat.imageBriefs[0].ratio, '900:383');

  // B. 小红书版
  const xhs = generatePlatformVariant({ ...baseInput, platform: 'XIAOHONGSHU' });
  assert.strictEqual(xhs.platform, 'XIAOHONGSHU');
  assert.strictEqual(xhs.contentType, 'NOTE');
  assert.ok(xhs.platformMetadata.titleCandidates && xhs.platformMetadata.titleCandidates.length >= 3);
  assert.ok(xhs.platformMetadata.openingHook?.includes('姐妹们'));
  assert.ok(xhs.body.includes('1️⃣'));
  assert.ok(xhs.tags.some(t => t.includes('#宠物好物')));
  assert.ok(xhs.imageBriefs.some(b => b.ratio === '3:4'));

  // C. 微博版
  const weibo = generatePlatformVariant({ ...baseInput, platform: 'WEIBO' });
  assert.strictEqual(weibo.platform, 'WEIBO');
  assert.strictEqual(weibo.contentType, 'SHORT_POST');
  assert.ok(weibo.title.startsWith('【'));
  assert.ok(weibo.platformMetadata.shortVersion && weibo.platformMetadata.shortVersion.length <= 140);
  assert.ok(weibo.platformMetadata.topicTags && weibo.platformMetadata.topicTags.length > 0);
  assert.ok(weibo.imageBriefs.some(b => b.ratio === '1:1'));

  // D. 抖音版
  const douyin = generatePlatformVariant({ ...baseInput, platform: 'DOUYIN' });
  assert.strictEqual(douyin.platform, 'DOUYIN');
  assert.strictEqual(douyin.contentType, 'VIDEO_SCRIPT');
  assert.ok(douyin.platformMetadata.openingHook?.includes('00:00') || douyin.platformMetadata.openingHook?.includes('停'));
  assert.ok(douyin.platformMetadata.scriptOutline && douyin.platformMetadata.scriptOutline.length === 5);
  assert.ok(douyin.platformMetadata.screenSubtitles && douyin.platformMetadata.screenSubtitles.length > 0);
  assert.ok(douyin.imageBriefs.some(b => b.ratio === '9:16'));

  // E. Bilibili版
  const bili = generatePlatformVariant({ ...baseInput, platform: 'BILIBILI' });
  assert.strictEqual(bili.platform, 'BILIBILI');
  assert.strictEqual(bili.contentType, 'EXPLAINER_SCRIPT');
  assert.ok(bili.platformMetadata.chapters && bili.platformMetadata.chapters.length >= 4);
  assert.ok(bili.body.includes('硬核评测'));
  assert.ok(bili.imageBriefs.some(b => b.ratio === '16:9'));
});

test('2. Rewrite Engines: Multiple Modes & Lineage Notes', () => {
  const title = 'PawClean 智能洁足机';
  const body = 'PawClean 是一款自动清洗脚爪的设备，采用微泡水流和柔软硅胶，30秒洗干净。';

  // A. 扩写
  const expanded = rewriteContent({
    platform: 'WECHAT_OFFICIAL_ACCOUNT',
    mode: 'REWRITE_EXPAND',
    currentTitle: title,
    currentBody: body,
  });
  assert.ok(expanded.title.includes('深度完整版'));
  assert.ok(expanded.body.length > body.length);
  assert.ok(expanded.changeNote.includes('深度扩写'));

  // B. 缩写
  const shortened = rewriteContent({
    platform: 'WEIBO',
    mode: 'REWRITE_SHORTEN',
    currentTitle: title,
    currentBody: body,
  });
  assert.ok(shortened.title.includes('精粹版'));
  assert.ok(shortened.changeNote.includes('精炼缩写'));

  // C. 专业化
  const prof = rewriteContent({
    platform: 'BILIBILI',
    mode: 'REWRITE_PROFESSIONAL',
    currentTitle: title,
    currentBody: body,
  });
  assert.ok(prof.body.includes('致敏原') || prof.body.includes('声学'));
  assert.ok(prof.changeNote.includes('专业度'));

  // D. 降低营销感
  const lowPromo = rewriteContent({
    platform: 'XIAOHONGSHU',
    mode: 'REWRITE_LOW_PROMO',
    currentTitle: title,
    currentBody: body,
  });
  assert.ok(lowPromo.body.includes('局限性'));
  assert.ok(lowPromo.changeNote.includes('客观'));

  // E. 教程风格
  const tutorial = rewriteContent({
    platform: 'XIAOHONGSHU',
    mode: 'REWRITE_STYLE_TUTORIAL',
    currentTitle: title,
    currentBody: body,
  });
  assert.ok(tutorial.body.includes('保姆级') || tutorial.body.includes('第 1 步'));
});

test('3. Fact Checking & Safe Notes Extraction', () => {
  const notes1 = extractSafeFactCheckNotes('全国第一款100%彻底根除皮肤病的洁足机', '采用医疗级抑菌');
  assert.ok(notes1.some(n => n.includes('绝对化')));
  assert.ok(notes1.some(n => n.includes('功效性')));
  assert.ok(notes1.some(n => n.includes('极限词') || n.includes('第一')));

  const notes2 = extractSafeFactCheckNotes('PawClean 智能洁足机', '温和水流清洗');
  assert.ok(notes2.some(n => n.includes('提示')));
});
