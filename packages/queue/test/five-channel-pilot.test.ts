import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  defaultConnectorRegistry,
  CredentialVault,
  OAuthStateSecurity,
  transformContentForChannel,
  isChannelVideoRequired,
  WeChatOfficialAccountConnector,
  YouTubeConnector,
  BilibiliConnector,
  WeiboConnector,
  DouyinConnector,
  type NormalizedPublishContent,
  type StoredCredential,
} from '../src/index';

const sampleContentTextOnly: NormalizedPublishContent = {
  title: 'PawClean 智能宠物净味器深度评测',
  body: 'PawClean 采用三重生物酶分解技术，能高效去除猫砂盆异味与空气中的细小粉尘颗粒。实测 24 小时除味率达到 98.7%，对养宠家庭呼吸道健康提供全面呵护。',
  summary: 'PawClean 智能宠物净味器全方位评测，三重生物酶高效除味。',
  tags: ['宠物健康', '猫咪用品', '智能家居'],
  coverUrl: 'https://cdn.geolens.io/assets/pawclean-cover.jpg',
};

const sampleContentWithVideo: NormalizedPublishContent = {
  ...sampleContentTextOnly,
  assets: [
    {
      type: 'VIDEO',
      url: 'https://cdn.geolens.io/assets/pawclean-review.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 15_400_000,
      externalId: 'v_asset_pawclean_001',
    },
  ],
};

test('1. Five-Channel Capabilities: 五大平台能力描述符与资质要求', () => {
  const reg = defaultConnectorRegistry;

  // 1. 微信公众号 (WECHAT_OFFICIAL_ACCOUNT)
  const wx = reg.getConnector('WECHAT_OFFICIAL_ACCOUNT' as any);
  assert.ok(wx, 'WeChat connector must be registered');
  const wxCaps = wx.getCapabilities();
  assert.equal(wxCaps.channel, 'WECHAT_OFFICIAL_ACCOUNT');
  assert.equal(wxCaps.category, 'LONG_FORM');
  assert.equal(wxCaps.implementationStatus, 'READY_FOR_CREDENTIALS');
  assert.equal(wxCaps.supportsText, true);
  assert.equal(wxCaps.supportsImages, true);
  assert.equal(wxCaps.supportsVideo, false); // 专注图文草稿
  assert.equal(wxCaps.titleMax, 64);
  assert.equal(wxCaps.bodyMax, 20000);

  // 2. YouTube (YOUTUBE)
  const yt = reg.getConnector('YOUTUBE' as any);
  assert.ok(yt, 'YouTube connector must be registered');
  const ytCaps = yt.getCapabilities();
  assert.equal(ytCaps.channel, 'YOUTUBE');
  assert.equal(ytCaps.category, 'VIDEO');
  assert.equal(ytCaps.supportsVideo, true);
  assert.equal(ytCaps.titleMax, 100);

  // 3. 微博 (WEIBO)
  const wb = reg.getConnector('WEIBO' as any);
  assert.ok(wb, 'Weibo connector must be registered');
  const wbCaps = wb.getCapabilities();
  assert.equal(wbCaps.channel, 'WEIBO');
  assert.equal(wbCaps.category, 'SOCIAL');
  assert.equal(wbCaps.implementationStatus, 'REQUIRES_APP_REVIEW');
  assert.equal(wbCaps.titleMax, 140);
  assert.equal(wbCaps.bodyMax, 2000);

  // 4. 哔哩哔哩 (BILIBILI)
  const bili = reg.getConnector('BILIBILI' as any);
  assert.ok(bili, 'Bilibili connector must be registered');
  const biliCaps = bili.getCapabilities();
  assert.equal(biliCaps.channel, 'BILIBILI');
  assert.equal(biliCaps.category, 'VIDEO');
  assert.equal(biliCaps.implementationStatus, 'REQUIRES_APP_REVIEW');
  assert.equal(biliCaps.titleMax, 80);

  // 5. 抖音 (DOUYIN)
  const dy = reg.getConnector('DOUYIN' as any);
  assert.ok(dy, 'Douyin connector must be registered');
  const dyCaps = dy.getCapabilities();
  assert.equal(dyCaps.channel, 'DOUYIN');
  assert.equal(dyCaps.category, 'VIDEO');
  assert.equal(dyCaps.titleMax, 55);
});

test('2. Content Transform: 渠道专属内容变体生成与溯源关联', () => {
  const lineage = {
    sourceDraftId: '9098ed88-170b-4c44-be9f-a9c88c166486',
    sourceRevisionId: 'aac89b56-d3ec-408c-8526-e3a97dc8562e',
  };

  // 微信公众号：长文与 HTML 段落
  const wxVar = transformContentForChannel(sampleContentTextOnly, 'WECHAT_OFFICIAL_ACCOUNT' as any, lineage);
  assert.equal(wxVar.channel, 'WECHAT_OFFICIAL_ACCOUNT');
  assert.equal(wxVar.sourceDraftId, lineage.sourceDraftId);
  assert.equal(wxVar.sourceRevisionId, lineage.sourceRevisionId);
  assert.equal(wxVar.requiresVideo, false);
  assert.ok(wxVar.body.startsWith('<p>'));
  assert.ok(wxVar.channelSpecificPayload.articles);

  // 微博：短文本与话题标签
  const wbVar = transformContentForChannel(sampleContentTextOnly, 'WEIBO' as any, lineage);
  assert.equal(wbVar.channel, 'WEIBO');
  assert.equal(wbVar.requiresVideo, false);
  assert.ok(wbVar.body.includes('【PawClean 智能宠物净味器深度评测】'));
  assert.ok(wbVar.body.includes('#宠物健康#'));

  // 哔哩哔哩：视频投稿格式与分区
  const biliVar = transformContentForChannel(sampleContentTextOnly, 'BILIBILI' as any, lineage);
  assert.equal(biliVar.channel, 'BILIBILI');
  assert.equal(biliVar.requiresVideo, true);
  assert.equal(biliVar.channelSpecificPayload.tid, 174);

  // YouTube：视频元数据与 private 保护
  const ytVar = transformContentForChannel(sampleContentTextOnly, 'YOUTUBE' as any, lineage);
  assert.equal(ytVar.channel, 'YOUTUBE');
  assert.equal(ytVar.requiresVideo, true);
  assert.equal((ytVar.channelSpecificPayload as any).status.privacyStatus, 'private');

  // 抖音：短视频文案
  const dyVar = transformContentForChannel(sampleContentTextOnly, 'DOUYIN' as any, lineage);
  assert.equal(dyVar.channel, 'DOUYIN');
  assert.equal(dyVar.requiresVideo, true);
});

test('3. Video Asset Readiness Gate: 视频平台必须有真实视频，图文平台免除视频', async () => {
  const wx = new WeChatOfficialAccountConnector();
  const wb = new WeiboConnector();
  const bili = new BilibiliConnector();
  const yt = new YouTubeConnector();
  const dy = new DouyinConnector();

  // 文本内容在视频平台必须报错 VIDEO_ASSET_REQUIRED
  const biliTextVal = await bili.validateContent(sampleContentTextOnly);
  assert.equal(biliTextVal.valid, false);
  assert.ok(biliTextVal.errors.some((e) => e.includes('VIDEO_ASSET_REQUIRED')));

  const ytTextVal = await yt.validateContent(sampleContentTextOnly);
  assert.equal(ytTextVal.valid, false);
  assert.ok(ytTextVal.errors.some((e) => e.includes('VIDEO_ASSET_REQUIRED')));

  const dyTextVal = await dy.validateContent(sampleContentTextOnly);
  assert.equal(dyTextVal.valid, false);
  assert.ok(dyTextVal.errors.some((e) => e.includes('VIDEO_ASSET_REQUIRED')));

  // 文本内容在图文平台（微信公众号与微博）正常通过
  const wxTextVal = await wx.validateContent(sampleContentTextOnly);
  assert.equal(wxTextVal.valid, true, 'WeChat should validate text-only draft');

  const wbTextVal = await wb.validateContent(sampleContentTextOnly);
  assert.equal(wbTextVal.valid, true, 'Weibo should validate text-only post');

  // 附带视频资产后，视频平台通过验证
  const biliVidVal = await bili.validateContent(sampleContentWithVideo);
  assert.equal(biliVidVal.valid, true, 'Bilibili should pass with video asset');

  const ytVidVal = await yt.validateContent(sampleContentWithVideo);
  assert.equal(ytVidVal.valid, true, 'YouTube should pass with video asset');

  const dyVidVal = await dy.validateContent(sampleContentWithVideo);
  assert.equal(dyVidVal.valid, true, 'Douyin should pass with video asset');
});

test('4. WeChat Official Account: 草稿箱安全隔离 (Draft Box Only, No Freepublish)', async () => {
  const wx = new WeChatOfficialAccountConnector();
  const cred: StoredCredential = {
    credentialRef: 'vault://aes256gcm/wechat_official_account/test-wx-01',
    apiKey: 'wx_appid_test',
    password: 'wx_appsecret_test',
    accessToken: 'mock_access_token_123',
  };

  // 出站闸门关闭（默认）下安全生成 Mock 外部标识
  const resMock = await wx.publish(sampleContentTextOnly, cred);
  assert.equal(resMock.ok, true);
  assert.equal(resMock.publisher, 'mock');
  assert.ok(resMock.externalId?.startsWith('mock_wechat_official_account_'));

  // DryRun 模式
  const resDry = await wx.publish(sampleContentTextOnly, cred, { dryRun: true });
  assert.equal(resDry.ok, true);
  assert.equal(resDry.publisher, 'mock');
  assert.ok(resDry.externalId?.startsWith('dryrun_wechat_official_account_'));
});

test('5. Outbound Guard & Idempotency: 默认禁止外部写操作', async () => {
  assert.notEqual(process.env.EXTERNAL_PUBLISHING_ENABLED, 'true');

  const yt = new YouTubeConnector();
  const cred: StoredCredential = {
    credentialRef: 'vault://aes256gcm/youtube/test-yt-01',
    accessToken: 'yt_access_token_mock',
  };

  const res = await yt.publish(sampleContentWithVideo, cred);
  assert.equal(res.ok, true);
  assert.equal(res.publisher, 'mock');
  assert.ok(res.externalUrl?.includes('mock.geo.local/youtube/'));
});

test('6. Credential Vault & OAuth Security for 5 Platforms', () => {
  const vault = new CredentialVault('pilot-secret-test-key-32-chars-long!');
  const sec = new OAuthStateSecurity('oauth-state-secret-test', 60000);

  const channels = ['WECHAT_OFFICIAL_ACCOUNT', 'YOUTUBE', 'WEIBO', 'BILIBILI', 'DOUYIN'] as const;

  for (const ch of channels) {
    // 凭据安全存储与读取
    const ref = vault.storeCredential(ch, 'test-id', {
      credentialRef: '',
      accessToken: 'token_' + ch + '_123',
      refreshToken: 'refresh_' + ch + '_456',
    });
    assert.ok(ref.startsWith('vault://aes256gcm/' + ch.toLowerCase() + '/'));

    const retrieved = vault.getCredential(ref);
    assert.equal(retrieved?.accessToken, 'token_' + ch + '_123');

    // 脱敏视图绝不泄露 token
    const redacted = CredentialVault.redact(retrieved);
    assert.equal(redacted.hasAccessToken, true);
    assert.equal((redacted as any).accessToken, undefined);

    // OAuth State 签名验证
    const callbackUri = 'https://api.geolens.io/connections/' + ch.toLowerCase() + '/callback';
    const state = sec.generateState({
      organizationId: '123e4567-e89b-12d3-a456-426614174000',
      projectId: '123e4567-e89b-12d3-a456-426614174001',
      channel: ch as any,
      redirectUri: callbackUri,
    });
    const verified = sec.verifyState(state, callbackUri);
    assert.equal(verified.channel, ch);
  }
});
