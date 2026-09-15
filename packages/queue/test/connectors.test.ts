import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  defaultConnectorRegistry,
  CredentialVault,
  OAuthStateSecurity,
  DevLocalStorageAdapter,
  S3CompatibleStorageAdapter,
  WordPressConnector,
  generateManualPublishingPackage,
  normalizeHttpError,
  sanitizeErrorPayload,
} from '../src/index';

test('A. ConnectorRegistry: 所有重点平台均已注册且分类清晰', () => {
  const reg = defaultConnectorRegistry;
  const caps = reg.listCapabilities();

  assert.ok(caps.length >= 25, `Expected >= 25 connectors, got ${caps.length}`);

  // 第一批平台
  assert.equal(reg.getConnector('WORDPRESS' as any)?.channel, 'WORDPRESS');
  assert.equal(reg.getConnector('GHOST' as any)?.channel, 'GHOST');
  assert.equal(reg.getConnector('WEBFLOW' as any)?.channel, 'WEBFLOW');
  assert.equal(reg.getConnector('BLOGGER' as any)?.channel, 'BLOGGER');
  assert.equal(reg.getConnector('DEV_TO' as any)?.channel, 'DEV_TO');
  assert.equal(reg.getConnector('MASTODON' as any)?.channel, 'MASTODON');
  assert.equal(reg.getConnector('BLUESKY' as any)?.channel, 'BLUESKY');
  assert.equal(reg.getConnector('TELEGRAM' as any)?.channel, 'TELEGRAM');
  assert.equal(reg.getConnector('DISCORD' as any)?.channel, 'DISCORD');
  assert.equal(reg.getConnector('SLACK' as any)?.channel, 'SLACK');

  // 第二批平台
  assert.equal(reg.getConnector('THREADS' as any)?.channel, 'THREADS');
  assert.equal(reg.getConnector('LINKEDIN' as any)?.channel, 'LINKEDIN');
  assert.equal(reg.getConnector('PINTEREST' as any)?.channel, 'PINTEREST');
  assert.equal(reg.getConnector('X' as any)?.channel, 'X');
  assert.equal(reg.getConnector('REDDIT' as any)?.channel, 'REDDIT');
  assert.equal(reg.getConnector('GOOGLE_BUSINESS_PROFILE' as any)?.channel, 'GOOGLE_BUSINESS_PROFILE');
  assert.equal(reg.getConnector('YOUTUBE' as any)?.channel, 'YOUTUBE');

  // 第三批平台 (国内 + 海外媒体)
  assert.equal(reg.getConnector('DOUYIN' as any)?.channel, 'DOUYIN');
  assert.equal(reg.getConnector('BILIBILI' as any)?.channel, 'BILIBILI');
  assert.equal(reg.getConnector('WEIBO' as any)?.channel, 'WEIBO');
  assert.equal(reg.getConnector('WECHAT_OFFICIAL_ACCOUNT' as any)?.channel, 'WECHAT_OFFICIAL_ACCOUNT');
  assert.equal(reg.getConnector('TOUTIAO' as any)?.channel, 'TOUTIAO');
  assert.equal(reg.getConnector('XIGUA' as any)?.channel, 'XIGUA');
  assert.equal(reg.getConnector('TIKTOK' as any)?.channel, 'TIKTOK');
  assert.equal(reg.getConnector('INSTAGRAM' as any)?.channel, 'INSTAGRAM');
  assert.equal(reg.getConnector('FACEBOOK' as any)?.channel, 'FACEBOOK');

  // Search Surface
  assert.equal(reg.getConnector('BAIDU_SEARCH_SURFACE' as any)?.channel, 'BAIDU_SEARCH_SURFACE');
  assert.equal(reg.getConnector('BAIDU_SEARCH_SURFACE' as any)?.category, 'SEARCH_SURFACE');

  // Manual Only
  assert.equal(reg.getCapabilities('XIAOHONGSHU' as any)?.implementationStatus, 'MANUAL_ONLY');
  assert.equal(reg.getCapabilities('WECHAT_CHANNELS' as any)?.implementationStatus, 'MANUAL_ONLY');
  assert.equal(reg.getCapabilities('ZHIHU' as any)?.implementationStatus, 'MANUAL_ONLY');
});

test('B. CredentialVault: AES-256-GCM 加密存储与脱敏验证', () => {
  const vault = new CredentialVault('test-secret-key-32-bytes-long-for-testing!!');
  const secretCred = {
    credentialRef: '',
    apiKey: 'sk-secret-key-12345',
    accessToken: 'access-token-abcde',
    refreshToken: 'refresh-token-xyz',
    username: 'testuser',
  };

  const ref = vault.storeCredential('wordpress', 'site-1', secretCred);
  assert.ok(ref.startsWith('vault://aes256gcm/wordpress/'));

  const recovered = vault.getCredential(ref);
  assert.ok(recovered);
  assert.equal(recovered?.apiKey, 'sk-secret-key-12345');
  assert.equal(recovered?.accessToken, 'access-token-abcde');
  assert.equal(recovered?.username, 'testuser');

  // 脱敏校验：redact 不输出真实 apiKey / accessToken
  const redacted = CredentialVault.redact(recovered);
  assert.equal(redacted.hasApiKey, true);
  assert.equal(redacted.hasAccessToken, true);
  assert.equal((redacted as any).apiKey, undefined);
  assert.equal((redacted as any).accessToken, undefined);

  // 删除凭证
  const deleted = vault.deleteCredential(ref);
  assert.equal(deleted, true);
  assert.equal(vault.getCredential(ref), null);
});

test('C. OAuthStateSecurity: HMAC 签名防篡改与时效/租户绑定校验', () => {
  const sec = new OAuthStateSecurity('oauth-secret-key-123', 1000); // 1 sec expiry for test

  const state = sec.generateState({
    organizationId: '123e4567-e89b-12d3-a456-426614174000',
    projectId: '123e4567-e89b-12d3-a456-426614174001',
    channel: 'WORDPRESS' as any,
    redirectUri: 'https://example.com/callback',
  });

  assert.ok(state.includes('.'));

  // 正常校验
  const verified = sec.verifyState(state, 'https://example.com/callback');
  assert.equal(verified.organizationId, '123e4567-e89b-12d3-a456-426614174000');
  assert.equal(verified.channel, 'WORDPRESS');

  // 篡改校验失败
  const tampered = state.replace(/^[a-zA-Z0-9]+/, 'dGFtcGVyZWQ');
  assert.throws(() => sec.verifyState(tampered), /OAUTH_STATE_SIGNATURE_MISMATCH/);

  // 回调地址不匹配拒绝
  assert.throws(() => sec.verifyState(state, 'https://attacker.com/callback'), /REDIRECT_URI_MISMATCH/);
});

test('D. ContentStorageAdapter: 本地与 S3 兼容适配器契约', async () => {
  // 1. DevLocalStorageAdapter
  const local = new DevLocalStorageAdapter();
  const testBytes = Buffer.from('Hello GeoLens Assets', 'utf8');
  const orgId = '123e4567-e89b-12d3-a456-426614174000';

  const stored = await local.put(orgId, testBytes, 'text/plain', 'test.txt');
  assert.ok(stored.storageKey.startsWith(orgId));
  assert.equal(stored.mimeType, 'text/plain');
  assert.equal(stored.sizeBytes, testBytes.length);
  assert.ok(stored.checksum.length === 64); // sha256 hex length

  const retrieved = await local.get(stored.storageKey);
  assert.equal(retrieved.toString('utf8'), 'Hello GeoLens Assets');

  // 2. S3CompatibleStorageAdapter
  const s3 = new S3CompatibleStorageAdapter({
    endpoint: 'https://s3.us-east-1.amazonaws.com',
    bucket: 'test-bucket',
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  });

  const signedGetUrl = await s3.getSignedUrl('test-org/test-file.jpg', 3600, 'GET');
  assert.ok(signedGetUrl.includes('X-Amz-Algorithm=AWS4-HMAC-SHA256'));
  assert.ok(signedGetUrl.includes('X-Amz-Signature='));
});

test('E. WordPressConnector: 生产能力、内容校验与出站写闸门', async () => {
  const wp = new WordPressConnector();
  const caps = wp.getCapabilities();

  assert.equal(caps.channel, 'WORDPRESS');
  assert.equal(caps.category, 'OWNED_SITE');
  assert.equal(caps.supportsText, true);
  assert.equal(caps.supportsImages, true);
  assert.equal(caps.supportsDelete, true);
  assert.equal(caps.supportsEdit, true);

  // 超长标题校验失败
  const badVal = await wp.validateContent({
    title: 'x'.repeat(250), // max is 200
    body: 'Valid post body',
  });
  assert.equal(badVal.valid, false);
  assert.ok(badVal.errors[0].includes('Title length'));

  // 空正文校验失败
  const emptyBody = await wp.validateContent({
    title: 'Valid title',
    body: '   ',
  });
  assert.equal(emptyBody.valid, false);

  // 出站写闸门：环境变量未开启时恒返回安全 Mock
  const mockPub = await wp.publish(
    { title: 'Test Post', body: 'Hello WordPress' },
    { credentialRef: 'vault://mock', username: 'admin', apiKey: 'pass' },
    { dryRun: false },
  );
  assert.equal(mockPub.ok, true);
  assert.equal(mockPub.publisher, 'mock');
  assert.ok(mockPub.externalId?.startsWith('mock_wordpress_'));
  assert.ok(mockPub.externalUrl?.includes('mock.geo.local'));

  // dryRun 测试
  const dryPub = await wp.publish(
    { title: 'Test Post', body: 'Hello WordPress' },
    { credentialRef: 'vault://mock' },
    { dryRun: true },
  );
  assert.equal(dryPub.ok, true);
  assert.ok(dryPub.externalId?.startsWith('dryrun_wordpress_'));
});

test('F. ManualPublishingPackage: 人工发布包生成', () => {
  const pkg = generateManualPublishingPackage('XIAOHONGSHU' as any, {
    title: '2026年品牌增长终极指南',
    body: '这是正文内容。',
    tags: ['品牌营销', 'GEO策略'],
    assets: [
      { type: 'IMAGE', url: 'https://example.com/cover.jpg', mimeType: 'image/jpeg', sizeBytes: 102400 },
    ],
  });

  assert.equal(pkg.channel, 'XIAOHONGSHU');
  assert.equal(pkg.title, '2026年品牌增长终极指南');
  assert.deepEqual(pkg.hashtags, ['#品牌营销', '#GEO策略']);
  assert.equal(pkg.assetManifest.length, 1);
  assert.ok(pkg.checklist.length >= 3);
  assert.ok(pkg.callToAction.includes('小红书'));
});

test('G. Error Normalization: 错误码映射与敏感字段脱敏', () => {
  const err401 = normalizeHttpError(401, { error: 'token_expired', access_token: 'secret_abc' });
  assert.equal(err401.code, 'AUTH_EXPIRED');
  assert.equal(err401.retryable, false);

  const err429 = normalizeHttpError(429, { message: 'Too many requests' });
  assert.equal(err429.code, 'RATE_LIMITED');
  assert.equal(err429.retryable, true);

  const err503 = normalizeHttpError(503, { message: 'Service unavailable' });
  assert.equal(err503.code, 'PLATFORM_UNAVAILABLE');
  assert.equal(err503.retryable, true);

  // 脱敏校验
  const sanitized = sanitizeErrorPayload({
    message: 'Failed auth',
    access_token: 'sk-secret-token',
    user_secret: 'top_secret',
    status: 'failed',
  });
  assert.equal(sanitized.access_token, '[REDACTED]');
  assert.equal(sanitized.user_secret, '[REDACTED]');
  assert.equal(sanitized.status, 'failed');
});
