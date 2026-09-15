import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { WeChatOfficialAccountConnector } from '../src/connectors/batch3/wechat-official.connector';
import type { StoredCredential } from '../src/connectors/types';

test('WeChat Official Account Real Pilot: Draft Box Isolation & Lifecycle', async () => {
  let draftAdded = false;
  let deleteCalled = false;
  let draftPayload: any = null;

  // 1. Mock WeChat Open API Server
  const server = createServer((req, res) => {
    // Stable token endpoint
    if (req.method === 'POST' && req.url === '/cgi-bin/stable_token') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'test_wechat_token_12345', expires_in: 7200 }));
      return;
    }

    // Material upload endpoint (image)
    if (req.method === 'POST' && req.url?.startsWith('/cgi-bin/material/add_material')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ media_id: 'test_thumb_media_id_999' }));
      return;
    }

    // Draft add endpoint (Draft Box only)
    if (req.method === 'POST' && req.url?.startsWith('/cgi-bin/draft/add')) {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        draftPayload = JSON.parse(body);
        draftAdded = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ media_id: 'wx_draft_test_media_id_456' }));
      });
      return;
    }

    // Draft delete endpoint (Rollback)
    if (req.method === 'POST' && req.url?.startsWith('/cgi-bin/draft/delete')) {
      deleteCalled = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ errcode: 404, errmsg: 'Not found' }));
  });

  await new Promise<void>(resolve => server.listen(18081, '127.0.0.1', resolve));

  const origFetch = globalThis.fetch;
  // Route api.weixin.qq.com to local test server
  globalThis.fetch = (input: any, init?: any) => {
    const urlStr = typeof input === 'string' ? input : input.url;
    const localUrl = urlStr.replace('https://api.weixin.qq.com', 'http://127.0.0.1:18081');
    return origFetch(localUrl, init);
  };

  try {
    const connector = new WeChatOfficialAccountConnector();
    const cred: StoredCredential = {
      credentialRef: 'vault://test/wx/1',
      apiKey: 'wx_test_appid',
      password: 'wx_test_appsecret',
    };

    // 2. 验证凭据
    const connVal = await connector.validateConnection(cred);
    assert.strictEqual(connVal.valid, true);
    assert.ok(connVal.accountName?.includes('微信公众号'));

    // 3. 内容校验
    const valRes = await connector.validateContent({
      title: 'PawClean 智能洁足机评测',
      body: '<p>深度实测 PawClean 宠物洁足机。</p>',
    });
    assert.strictEqual(valRes.valid, true);

    // 4. 出站写保护：EXTERNAL_PUBLISHING_ENABLED=false 时降级为 Mock
    const prevGuard = process.env.EXTERNAL_PUBLISHING_ENABLED;
    process.env.EXTERNAL_PUBLISHING_ENABLED = 'false';
    const mockRes = await connector.publish(
      { title: '测试', body: '内容' },
      cred,
      { targetStatus: 'draft' },
    );
    assert.strictEqual(mockRes.publisher, 'mock');
    assert.strictEqual(draftAdded, false);

    // 5. 开启出站写闸门：真实写入微信草稿箱
    process.env.EXTERNAL_PUBLISHING_ENABLED = 'true';
    const realRes = await connector.publish(
      {
        title: 'PawClean 智能洁足机评测',
        body: '<p>深度实测 PawClean 宠物洁足机。</p>',
        summary: 'PawClean 宠物洁足机深度实测摘要',
        assets: [{ id: '1', type: 'IMAGE', mimeType: 'image/jpeg', storageKey: 'k', externalId: 'test_thumb_media_id_999' }],
      },
      cred,
      { targetStatus: 'draft' },
    );

    assert.strictEqual(realRes.ok, true);
    assert.strictEqual(realRes.publisher, 'real');
    assert.strictEqual(realRes.externalId, 'wx_draft_test_media_id_456');
    assert.strictEqual((realRes.rawResponse as any)?.status, 'DRAFT_CREATED_EXTERNALLY');
    assert.strictEqual((realRes.rawResponse as any)?.finalBroadcastRequiresHuman, true);
    assert.strictEqual(draftAdded, true);
    assert.strictEqual(draftPayload.articles[0].thumb_media_id, 'test_thumb_media_id_999');

    // 6. Rollback 验证
    const delRes = await connector.deletePublication('wx_draft_test_media_id_456', cred);
    assert.strictEqual(delRes.ok, true);
    assert.strictEqual(deleteCalled, true);

    // 恢复环境变量
    process.env.EXTERNAL_PUBLISHING_ENABLED = prevGuard;
  } finally {
    globalThis.fetch = origFetch;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
