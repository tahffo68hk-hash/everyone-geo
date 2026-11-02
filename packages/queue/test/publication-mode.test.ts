import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { WordPressConnector } from '../src/connectors/batch1/wordpress.connector';
import {
  MockPublicationPublisher,
  REAL_PUBLICATION_NOT_WIRED,
  createPublicationPublisher,
} from '../src/publication';
import { outboundPublishEnabled, resolvePublicationMode } from '../src/publication-mode';

const SAMPLE_ID = '11111111-1111-4111-8111-111111111111';

function withEnv(
  patch: Record<string, string | undefined>,
  fn: () => Promise<void> | void,
): Promise<void> | void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(patch)) {
    previous[key] = process.env[key];
    const value = patch[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const key of Object.keys(previous)) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = fn();
    if (result && typeof (result as Promise<void>).then === 'function') {
      return (result as Promise<void>).finally(restore);
    }
    restore();
  } catch (error) {
    restore();
    throw error;
  }
}

test('publication mode defaults to mock and explicit mock wins over the legacy flag', () => {
  withEnv({ PUBLICATION_MODE: undefined, EXTERNAL_PUBLISHING_ENABLED: undefined }, () => {
    assert.equal(resolvePublicationMode(), 'mock');
    assert.equal(outboundPublishEnabled(), false);
  });
  withEnv({ PUBLICATION_MODE: 'mock', EXTERNAL_PUBLISHING_ENABLED: 'true' }, () => {
    assert.equal(resolvePublicationMode(), 'mock');
    assert.equal(outboundPublishEnabled(), false);
  });
  withEnv({ PUBLICATION_MODE: 'LIVE', EXTERNAL_PUBLISHING_ENABLED: 'true' }, () => {
    assert.equal(resolvePublicationMode(), 'mock');
  });
});

test('legacy EXTERNAL_PUBLISHING_ENABLED=true selects real only when PUBLICATION_MODE is unset', () => {
  withEnv({ PUBLICATION_MODE: undefined, EXTERNAL_PUBLISHING_ENABLED: 'true' }, () => {
    assert.equal(resolvePublicationMode(), 'real');
    assert.equal(outboundPublishEnabled(), true);
  });
  withEnv({ PUBLICATION_MODE: 'real', EXTERNAL_PUBLISHING_ENABLED: undefined }, () => {
    assert.equal(resolvePublicationMode(), 'real');
  });
});

test('mock publisher writes mock_ urls; real mode on this path does not', async () => {
  await withEnv({ PUBLICATION_MODE: 'mock', EXTERNAL_PUBLISHING_ENABLED: 'true' }, async () => {
    const mock = await new MockPublicationPublisher().publish({
      publicationId: SAMPLE_ID,
      channel: 'WORDPRESS',
      payload: '{}',
      idempotencyKey: 'k-mock',
    });
    assert.equal(mock.ok, true);
    assert.equal(mock.publisher, 'mock');
    assert.match(mock.externalId ?? '', /^mock_wordpress_/);
    assert.match(mock.externalUrl ?? '', /^https:\/\/mock\.geo\.local\/wordpress\/mock_wordpress_/);

    const selected = await createPublicationPublisher().publish({
      publicationId: SAMPLE_ID,
      channel: 'WECHAT_OFFICIAL_ACCOUNT',
      payload: '{}',
      idempotencyKey: 'k-selected',
    });
    assert.equal(selected.publisher, 'mock');
    assert.match(selected.externalUrl ?? '', /^https:\/\/mock\.geo\.local\//);
  });

  await withEnv({ PUBLICATION_MODE: 'real', EXTERNAL_PUBLISHING_ENABLED: undefined }, async () => {
    const real = await createPublicationPublisher().publish({
      publicationId: SAMPLE_ID,
      channel: 'WORDPRESS',
      payload: '{}',
      idempotencyKey: 'k-real',
    });
    assert.equal(real.ok, false);
    assert.equal(real.publisher, 'real');
    assert.equal(real.externalId, undefined);
    assert.equal(real.externalUrl, undefined);
    assert.equal(real.errorCode, REAL_PUBLICATION_NOT_WIRED);
    assert.equal(real.errorMessage, REAL_PUBLICATION_NOT_WIRED);
  });
});

test('PUBLICATION_MODE=mock keeps the WordPress connector in the sandbox', async () => {
  await withEnv({ PUBLICATION_MODE: 'mock', EXTERNAL_PUBLISHING_ENABLED: 'true' }, async () => {
    const connector = new WordPressConnector();
    const res = await connector.publish(
      { title: 'Local draft', body: '<p>not sent</p>' },
      { credentialRef: 'vault://test', baseUrl: 'http://127.0.0.1:9', username: 'admin', apiKey: 'secret' },
    );
    assert.equal(res.ok, true);
    assert.equal(res.publisher, 'mock');
    assert.match(res.externalId ?? '', /^mock_wordpress_/);
    assert.match(res.externalUrl ?? '', /^https:\/\/mock\.geo\.local\/wordpress\//);
  });
});
