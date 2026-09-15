import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  defaultConnectorRegistry,
  CredentialVault,
  OAuthStateSecurity,
  transformContentForChannel,
  TelegramConnector,
  DiscordConnector,
  SlackConnector,
  MastodonConnector,
  BlueskyConnector,
  DevToConnector,
  ThreadsConnector,
  LinkedInConnector,
  type NormalizedPublishContent,
  type StoredCredential,
} from '../src/index';

const approvedDraftContent: NormalizedPublishContent = {
  title: 'PawClean 智能除味器深度测评报告',
  body: 'PawClean 采用三重生物酶主动分解技术，能够在 24 小时内净化 98.7% 的猫砂盆异味与氨气，对猫咪嗅觉与呼吸道健康提供医学级安全保障。',
  summary: 'PawClean 智能除味器深度测评报告，医学级宠物健康守护。',
  tags: ['宠物家居', '智能硬件', '猫咪健康', '测评'],
  coverUrl: 'https://cdn.geolens.io/assets/pawclean-alt-cover.jpg',
  canonicalUrl: 'https://geolens.io/reviews/pawclean-test',
};

const lineage = {
  sourceDraftId: '9098ed88-170b-4c44-be9f-a9c88c166486',
  sourceRevisionId: 'aac89b56-d3ec-408c-8526-e3a97dc8562e',
};

test('1. Alternative Channels Capabilities & Readiness', () => {
  const reg = defaultConnectorRegistry;

  // 1. Telegram
  const tg = reg.getConnector('TELEGRAM' as any);
  assert.ok(tg);
  assert.equal(tg.getCapabilities().channel, 'TELEGRAM');
  assert.equal(tg.getCapabilities().category, 'MESSAGING');
  assert.equal(tg.getCapabilities().bodyMax, 4096);

  // 2. Discord
  const discord = reg.getConnector('DISCORD' as any);
  assert.ok(discord);
  assert.equal(discord.getCapabilities().channel, 'DISCORD');
  assert.equal(discord.getCapabilities().category, 'COMMUNITY');
  assert.equal(discord.getCapabilities().bodyMax, 2000);

  // 3. Slack
  const slack = reg.getConnector('SLACK' as any);
  assert.ok(slack);
  assert.equal(slack.getCapabilities().channel, 'SLACK');
  assert.equal(slack.getCapabilities().category, 'MESSAGING');
  assert.equal(slack.getCapabilities().bodyMax, 4000);

  // 4. Mastodon
  const mastodon = reg.getConnector('MASTODON' as any);
  assert.ok(mastodon);
  assert.equal(mastodon.getCapabilities().channel, 'MASTODON');
  assert.equal(mastodon.getCapabilities().category, 'SOCIAL');
  assert.equal(mastodon.getCapabilities().bodyMax, 500);

  // 5. Bluesky
  const bsky = reg.getConnector('BLUESKY' as any);
  assert.ok(bsky);
  assert.equal(bsky.getCapabilities().channel, 'BLUESKY');
  assert.equal(bsky.getCapabilities().category, 'SOCIAL');
  assert.equal(bsky.getCapabilities().bodyMax, 300);

  // 6. DEV.to
  const devto = reg.getConnector('DEV_TO' as any);
  assert.ok(devto);
  assert.equal(devto.getCapabilities().channel, 'DEV_TO');
  assert.equal(devto.getCapabilities().category, 'COMMUNITY');
  assert.equal(devto.getCapabilities().implementationStatus, 'READY_FOR_CREDENTIALS');

  // 7. Threads (Readiness only)
  const threads = reg.getConnector('THREADS' as any);
  assert.ok(threads);
  assert.equal(threads.getCapabilities().implementationStatus, 'REQUIRES_APP_REVIEW');

  // 8. LinkedIn (Readiness only)
  const linkedin = reg.getConnector('LINKEDIN' as any);
  assert.ok(linkedin);
  assert.equal(linkedin.getCapabilities().implementationStatus, 'REQUIRES_APP_REVIEW');
});

test('2. Content Variant Generation & Lineage Preservation for Alternative Channels', () => {
  // Telegram 变体
  const tgVar = transformContentForChannel(approvedDraftContent, 'TELEGRAM' as any, lineage);
  assert.equal(tgVar.channel, 'TELEGRAM');
  assert.equal(tgVar.sourceDraftId, lineage.sourceDraftId);
  assert.equal(tgVar.sourceRevisionId, lineage.sourceRevisionId);
  assert.ok(tgVar.body.includes('*PawClean 智能除味器深度测评报告*'));
  assert.equal((tgVar.channelSpecificPayload as any).parse_mode, 'Markdown');

  // Discord 变体 (Webhook Embed)
  const discordVar = transformContentForChannel(approvedDraftContent, 'DISCORD' as any, lineage);
  assert.equal(discordVar.channel, 'DISCORD');
  assert.equal(discordVar.sourceDraftId, lineage.sourceDraftId);
  assert.ok((discordVar.channelSpecificPayload as any).embeds);
  assert.equal((discordVar.channelSpecificPayload as any).embeds[0].color, 0x5865f2);

  // Slack 变体
  const slackVar = transformContentForChannel(approvedDraftContent, 'SLACK' as any, lineage);
  assert.equal(slackVar.channel, 'SLACK');
  assert.ok(slackVar.body.startsWith('*PawClean 智能除味器深度测评报告*'));

  // Mastodon 变体 (unlisted)
  const mastodonVar = transformContentForChannel(approvedDraftContent, 'MASTODON' as any, lineage);
  assert.equal(mastodonVar.channel, 'MASTODON');
  assert.equal((mastodonVar.channelSpecificPayload as any).visibility, 'unlisted');

  // Bluesky 变体
  const bskyVar = transformContentForChannel(approvedDraftContent, 'BLUESKY' as any, lineage);
  assert.equal(bskyVar.channel, 'BLUESKY');
  assert.ok(bskyVar.body.length <= 300);

  // DEV.to 变体 (published: false 保持 Draft)
  const devtoVar = transformContentForChannel(approvedDraftContent, 'DEV_TO' as any, lineage);
  assert.equal(devtoVar.channel, 'DEV_TO');
  assert.equal(devtoVar.sourceDraftId, lineage.sourceDraftId);
  assert.equal((devtoVar.channelSpecificPayload as any).article.published, false);
  assert.equal((devtoVar.channelSpecificPayload as any).article.title, 'PawClean 智能除味器深度测评报告');
});

test('3. DEV.to Draft Box Isolation: 严格创建 Draft，绝不直接公开', async () => {
  const devto = new DevToConnector();
  const cred: StoredCredential = {
    credentialRef: 'vault://aes256gcm/dev_to/pilot-user',
    apiKey: 'devto_mock_api_key_123',
  };

  // 默认发布 options（不带 confirm 与 publish 参数）
  const res = await devto.publish(approvedDraftContent, cred, { dryRun: true });
  assert.equal(res.ok, true);
  assert.equal(res.publisher, 'mock');
  assert.ok(res.externalId?.startsWith('dryrun_dev_to_'));
});

test('4. Discord & Telegram DryRun: 不产生外部网络写', async () => {
  const discord = new DiscordConnector();
  const resDiscord = await discord.publish(approvedDraftContent, {
    credentialRef: 'vault://aes256gcm/discord/test-wh',
    webhookUrl: 'https://discord.com/api/webhooks/mock/123',
  }, { dryRun: true });
  assert.equal(resDiscord.ok, true);
  assert.equal(resDiscord.publisher, 'mock');
  assert.ok(resDiscord.externalId?.startsWith('dryrun_discord_'));

  const tg = new TelegramConnector();
  const resTg = await tg.publish(approvedDraftContent, {
    credentialRef: 'vault://aes256gcm/telegram/test-bot',
    apiKey: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
    chatId: '@geolens_test',
  }, { dryRun: true });
  assert.equal(resTg.ok, true);
  assert.equal(resTg.publisher, 'mock');
  assert.ok(resTg.externalId?.startsWith('dryrun_telegram_'));
});

test('5. Outbound Write Guard on Alternative Channels', async () => {
  assert.notEqual(process.env.EXTERNAL_PUBLISHING_ENABLED, 'true');

  const mastodon = new MastodonConnector();
  const res = await mastodon.publish(approvedDraftContent, {
    credentialRef: 'vault://aes256gcm/mastodon/test-user',
    accessToken: 'mock_mastodon_token',
  });
  assert.equal(res.ok, true);
  assert.equal(res.publisher, 'mock');
  assert.ok(res.externalUrl?.includes('mock.geo.local/mastodon/'));
});
