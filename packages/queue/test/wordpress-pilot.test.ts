import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { WordPressConnector } from '../src/connectors/batch1/wordpress.connector';
import type { StoredCredential } from '../src/connectors/types';

test('WordPress Real Pilot: Draft creation, read-back, and rollback lifecycle', async () => {
  let createdPost: any = null;
  let deleteCalled = false;
  let authChecked = false;

  // 1. Standalone WordPress REST API Mock Server
  const server = createServer((req, res) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 'unauthorized', message: 'Auth required' }));
      return;
    }

    if (req.method === 'GET' && req.url === '/wp-json/wp/v2/users/me') {
      authChecked = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 1, name: 'Pilot Admin', slug: 'admin' }));
      return;
    }

    if (req.method === 'POST' && req.url === '/wp-json/wp/v2/posts') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const parsed = JSON.parse(body);
        assert.strictEqual(parsed.status, 'draft', 'Must strictly create DRAFT post');
        createdPost = {
          id: 42,
          title: { raw: parsed.title, rendered: parsed.title },
          content: { raw: parsed.content, rendered: parsed.content },
          status: parsed.status,
          link: 'http://127.0.0.1:18080/?p=42',
        };
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(createdPost));
      });
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/wp-json/wp/v2/posts/42')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(createdPost));
      return;
    }

    if (req.method === 'DELETE' && req.url?.startsWith('/wp-json/wp/v2/posts/42')) {
      deleteCalled = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deleted: true, previous: createdPost }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 'not_found' }));
  });

  await new Promise<void>(resolve => server.listen(18080, '127.0.0.1', () => resolve()));

  try {
    const connector = new WordPressConnector();
    const cred: StoredCredential = {
      credentialRef: 'vault://test',
      baseUrl: 'http://127.0.0.1:18080',
      username: 'admin',
      apiKey: 'test-app-password',
    };

    // 2. Validate Connection (Read-only)
    const valConn = await connector.validateConnection(cred);
    assert.strictEqual(valConn.valid, true);
    assert.strictEqual(valConn.accountName, 'Pilot Admin');
    assert.strictEqual(authChecked, true);

    // 3. Dry Run Check
    const dryRes = await connector.publish(
      { title: 'Pilot Title', body: '<p>Pilot Body</p>' },
      cred,
      { targetStatus: 'draft', dryRun: true }
    );
    assert.strictEqual(dryRes.ok, true);
    assert.strictEqual(dryRes.publisher, 'mock');

    // 4. Real Draft Creation (with EXTERNAL_PUBLISHING_ENABLED = true)
    process.env.EXTERNAL_PUBLISHING_ENABLED = 'true';
    const realRes = await connector.publish(
      { title: 'PawClean 评测', body: '<p>评测正文</p>' },
      cred,
      { targetStatus: 'draft', dryRun: false }
    );
    assert.strictEqual(realRes.ok, true);
    assert.strictEqual(realRes.publisher, 'real');
    assert.strictEqual(realRes.externalId, '42');
    assert.strictEqual(createdPost.status, 'draft', 'Target WordPress post MUST be draft');

    // 5. Read-back verification
    const statusRes = await connector.getPublicationStatus('42', cred);
    assert.strictEqual(statusRes.externalId, '42');
    assert.strictEqual(statusRes.status, 'PROCESSING'); // 'draft' maps to PROCESSING in status query

    // 6. Rollback (Delete) capability verification
    const delRes = await connector.deletePublication('42', cred);
    assert.strictEqual(delRes.ok, true);
    assert.strictEqual(deleteCalled, true);
  } finally {
    process.env.EXTERNAL_PUBLISHING_ENABLED = 'false';
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
