import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  QwenProvider, type FetchLike, type FetchResponseLike,
  LLMProviderError, LLMProviderRegistry,
  enginePresentation, qwenConfigured, readQwenProviderEnv,
  type LlmEntity, type ProviderRequest,
} from '../src/index';

const entities: LlmEntity[] = [
  { id: 'brand-1', canonicalName: 'ProjectMentor', aliases: [], entityType: 'brand' },
  { id: 'comp-1', canonicalName: 'Competitor A', aliases: [], entityType: 'competitor' },
];

function baseRequest(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    queryText: '大学生创新创业比赛可以用哪些 AI 工具？',
    engineKey: 'qwen-api', engineName: '通义千问', engineConfig: {},
    attempt: 1, timeoutMs: 5000, entities, ...overrides,
  };
}

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ENABLE_REAL_PROVIDERS: 'true',
    QWEN_API_KEY: 'sk-qwen-test-secret',
    QWEN_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    QWEN_MODEL: 'qwen-plus',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): FetchResponseLike {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function qwenBody(model = 'qwen-plus'): FetchResponseLike {
  return jsonResponse({
    id: 'chatcmpl-qwen-1', object: 'chat.completion', created: 1700000000, model,
    choices: [{ index: 0, message: { role: 'assistant', content: '推荐 ProjectMentor，也适合创业比赛。' }, logprobs: null, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
  });
}

/** 捕获请求（验证 auth header / body / requestedModel / rawPrompt）。 */
function capturingFetch(body: FetchResponseLike = qwenBody()): { fetch: FetchLike; calls: Array<{ url: string; headers: Record<string, string>; body: string }> } {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    return body;
  };
  return { fetch, calls };
}

test('qwen：config 默认值与解析（total 开关仍为 ENABLE_REAL_PROVIDERS）', () => {
  const cfg = readQwenProviderEnv({});
  assert.equal(cfg.apiKey, null);
  assert.equal(cfg.baseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(cfg.model, 'qwen-plus');
  assert.equal(qwenConfigured({ ENABLE_REAL_PROVIDERS: 'true', QWEN_API_KEY: 'x' }), true);
  assert.equal(qwenConfigured({ QWEN_API_KEY: 'x' }), false); // 总开关未开 → false
  assert.equal(qwenConfigured({ ENABLE_REAL_PROVIDERS: 'true' }), false);
});

test('qwen：adapter request —— url/auth header/body 含 requestedModel', async () => {
  const { fetch, calls } = capturingFetch();
  const provider = new QwenProvider({ fetch, env: env() });
  await provider.execute(baseRequest({ requestedModel: 'qwen-plus' }));
  assert.equal(calls[0].url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(calls[0].headers.Authorization, 'Bearer sk-qwen-test-secret');
  const body = JSON.parse(calls[0].body) as { model: string; messages: Array<{ role: string }> };
  assert.equal(body.model, 'qwen-plus');
  assert.equal((body.messages[0] as { role: string }).role, 'user');
});

test('qwen：requestedModel / responseModel（requested ≠ response 正常）', async () => {
  const provider = new QwenProvider({ fetch: capturingFetch(qwenBody('qwen-plus-latest')).fetch, env: env({ QWEN_MODEL: 'qwen-plus' }) });
  const response = await provider.execute(baseRequest({ requestedModel: 'qwen-plus' }));
  assert.equal(response.requestedModel, 'qwen-plus');
  assert.equal(response.responseModel, 'qwen-plus-latest');
  assert.notEqual(response.requestedModel, response.responseModel);
  assert.equal(response.model, 'qwen-plus-latest'); // legacy = responseModel ?? requestedModel
  assert.equal(response.modelVersion, 'qwen-plus-latest');
});

test('qwen：response 未回显 model → responseModel=null（不拿 requested 冒充）', async () => {
  const bare = jsonResponse({
    id: 'x', choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
  const provider = new QwenProvider({ fetch: capturingFetch(bare).fetch, env: env() });
  const response = await provider.execute(baseRequest());
  assert.equal(response.requestedModel, 'qwen-plus');
  assert.equal(response.responseModel, null);
  assert.equal(response.model, 'qwen-plus'); // legacy 回退 requested（兼容旧语义）
  assert.equal(response.modelVersion, null);
});

test('qwen：usage / rawProviderPayload / finishReason / requestId / duration', async () => {
  const provider = new QwenProvider({ fetch: capturingFetch().fetch, env: env() });
  const response = await provider.execute(baseRequest());
  assert.deepEqual(response.usage, { promptTokens: 12, completionTokens: 6, totalTokens: 18 });
  const raw = response.rawProviderPayload as { model?: string; choices?: unknown[] };
  assert.equal(raw.model, 'qwen-plus');
  assert.ok(Array.isArray(raw.choices));
  assert.equal(response.finishReason, 'stop');
  assert.equal(response.requestId, 'chatcmpl-qwen-1');
  assert.ok(response.durationMs >= 0);
  // payload 不含任何 secret 字段
  assert.equal(JSON.stringify(response.rawProviderPayload).includes('sk-qwen'), false);
});

test('qwen：secret 不进错误/响应；rawPrompt 仅含 model+messages', async () => {
  const provider = new QwenProvider({ fetch: capturingFetch().fetch, env: env() });
  const response = await provider.execute(baseRequest());
  assert.equal(response.rawPrompt.includes('sk-qwen'), false);
  assert.equal(JSON.stringify(response).includes('sk-qwen'), false);
});

test('qwen：disabled（总开关关）→ non-retryable disabled', async () => {
  const provider = new QwenProvider({ env: env({ ENABLE_REAL_PROVIDERS: 'false' }) });
  await assert.rejects(() => provider.execute(baseRequest()), (error: unknown) => {
    assert.ok(error instanceof LLMProviderError && error.kind === 'disabled');
    return true;
  });
});

test('qwen：无 Key → non-retryable not_configured', async () => {
  const provider = new QwenProvider({ env: env({ QWEN_API_KEY: '' }) });
  await assert.rejects(() => provider.execute(baseRequest()), (error: unknown) => {
    assert.ok(error instanceof LLMProviderError && error.kind === 'not_configured');
    return true;
  });
});

test('qwen：401/403 → auth（永久）；429 → rate_limit（可重试）；500 → server（可重试）', async () => {
  for (const [status, kind] of [[401, 'auth'], [403, 'auth'], [429, 'rate_limit'], [500, 'server'], [503, 'server'], [400, 'bad_request']] as const) {
    const provider = new QwenProvider({ fetch: capturingFetch(jsonResponse({ error: 'x' }, status)).fetch, env: env() });
    await assert.rejects(() => provider.execute(baseRequest()), (error: unknown) => {
      assert.ok(error instanceof LLMProviderError && error.kind === kind, `status ${status} → ${kind}`);
      return true;
    });
  }
});

test('qwen：invalid JSON / empty output → 明确协议错误（永久）', async () => {
  const badJson: FetchLike = async () => ({ ok: true, status: 200, text: async () => 'not-json{' });
  const empty: FetchLike = async () => ({ ok: true, status: 200, text: async () => '{"choices":[]}' });
  const emptyContent: FetchLike = async () => ({ ok: true, status: 200, text: async () => '{"choices":[{"message":{"role":"assistant","content":""}}]}' });
  for (const [fetch, kind] of [[badJson, 'invalid_response'], [empty, 'invalid_response'], [emptyContent, 'empty_response']] as const) {
    const provider = new QwenProvider({ fetch, env: env() });
    await assert.rejects(() => provider.execute(baseRequest()), (error: unknown) => {
      assert.ok(error instanceof LLMProviderError && error.kind === kind);
      return true;
    });
  }
});

test('qwen：timeout（AbortError）→ timeout（可重试）', async () => {
  const abort: FetchLike = async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  const provider = new QwenProvider({ fetch: abort, env: env() });
  await assert.rejects(() => provider.execute(baseRequest()), (error: unknown) => {
    assert.ok(error instanceof LLMProviderError && error.kind === 'timeout');
    return true;
  });
});

test('qwen：network（TypeError）→ network（可重试）', async () => {
  const net: FetchLike = async () => { throw new TypeError('fetch failed'); };
  const provider = new QwenProvider({ fetch: net, env: env() });
  await assert.rejects(() => provider.execute(baseRequest()), (error: unknown) => {
    assert.ok(error instanceof LLMProviderError && error.kind === 'network');
    return true;
  });
});

test('qwen：enginePresentation / registry 接入', () => {
  const envFull = env();
  assert.deepEqual(enginePresentation('qwen', { model: 'qwen-max' }, envFull), { provider: 'qwen', sourceType: 'official_api', model: 'qwen-max', configured: true });
  assert.deepEqual(enginePresentation('qwen', {}, env()), { provider: 'qwen', sourceType: 'official_api', model: 'qwen-plus', configured: true });
  assert.equal(enginePresentation('qwen', {}, {}).configured, false);
  const registry = new LLMProviderRegistry().register(new QwenProvider());
  assert.equal(registry.resolve('qwen')?.provider, 'qwen');
  assert.equal(registry.resolve('deepseek'), undefined);
});
