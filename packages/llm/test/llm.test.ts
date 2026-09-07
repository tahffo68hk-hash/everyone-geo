import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  DeepSeekProvider, type FetchLike, type FetchResponseLike,
  LLMProviderError, LLMProviderRegistry, MockProvider,
  deepseekConfigured, enginePresentation, isRetryableProviderError,
  mockScenarioText, readRealProviderEnv, realProvidersEnabled,
  type LlmEntity, type ProviderRequest, type ProviderResponse,
} from '../src/index';

const entities: LlmEntity[] = [
  { id: 'brand-1', canonicalName: 'ProjectMentor', aliases: ['项目导师'], entityType: 'brand' },
  { id: 'comp-1', canonicalName: 'Competitor A', aliases: ['CompA'], entityType: 'competitor' },
  { id: 'comp-2', canonicalName: 'Competitor B', aliases: ['CompB'], entityType: 'competitor' },
];

function baseRequest(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    queryText: '大学生创新创业比赛可以用哪些 AI 工具？',
    engineKey: 'test-engine', engineName: 'Test Engine', engineConfig: {},
    attempt: 1, timeoutMs: 5000, entities, ...overrides,
  };
}

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ENABLE_REAL_PROVIDERS: 'true',
    DEEPSEEK_API_KEY: 'sk-test-secret-123',
    DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
    DEEPSEEK_MODEL: 'deepseek-chat',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): FetchResponseLike {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function capturingFetch(): { fetch: FetchLike; calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> } {
  const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse({
      id: 'chatcmpl-test-1', object: 'chat.completion', created: 1700000000, model: 'deepseek-chat',
      choices: [{ index: 0, message: { role: 'assistant', content: '推荐 ProjectMentor。' }, logprobs: null, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
      system_fingerprint: 'fp_abc',
    });
  };
  return { fetch, calls };
}

/** Fake DeepSeek 响应：可指定 API 回报的 model（M6C requested ≠ response 场景）。 */
function modelResponse(model: string): FetchLike {
  return async () => jsonResponse({
    id: 'chatcmpl-identity', object: 'chat.completion', created: 1700000000, model,
    choices: [{ index: 0, message: { role: 'assistant', content: '返回内容' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

// ---------------------------------------------------------------- config & registry

test('config：默认 disabled / 无 key / 默认 baseUrl model timeout cap', () => {
  const cfg = readRealProviderEnv({});
  assert.equal(cfg.realProvidersEnabled, false);
  assert.equal(cfg.apiKey, null);
  assert.equal(cfg.baseUrl, 'https://api.deepseek.com');
  assert.equal(cfg.model, 'deepseek-chat');
  assert.equal(cfg.timeoutMs, 60_000);
  assert.equal(cfg.realProviderMaxRunsPerTask, 3);
  assert.equal(deepseekConfigured({}), false);
  assert.equal(realProvidersEnabled({ ENABLE_REAL_PROVIDERS: 'true' }), true);
});

test('config：合法值解析与非法值回退默认', () => {
  const cfg = readRealProviderEnv({
    ENABLE_REAL_PROVIDERS: 'true', DEEPSEEK_API_KEY: '  sk-1  ',
    DEEPSEEK_BASE_URL: 'https://api.deepseek.com/', DEEPSEEK_MODEL: 'deepseek-reasoner',
    DEEPSEEK_TIMEOUT_MS: '45000', REAL_PROVIDER_MAX_RUNS_PER_TASK: '5',
  });
  assert.equal(cfg.apiKey, 'sk-1');
  assert.equal(cfg.baseUrl, 'https://api.deepseek.com');
  assert.equal(cfg.model, 'deepseek-reasoner');
  assert.equal(cfg.timeoutMs, 45000);
  assert.equal(cfg.realProviderMaxRunsPerTask, 5);
  assert.equal(deepseekConfigured({ ENABLE_REAL_PROVIDERS: 'true', DEEPSEEK_API_KEY: 'x' }), true);
  const broken = readRealProviderEnv({ DEEPSEEK_TIMEOUT_MS: 'abc', REAL_PROVIDER_MAX_RUNS_PER_TASK: '99999' });
  assert.equal(broken.timeoutMs, 60_000);
  assert.equal(broken.realProviderMaxRunsPerTask, 3);
});

test('enginePresentation：mock 恒可用；deepseek 取决于 key+flag；未知 provider 不可用', () => {
  assert.deepEqual(enginePresentation('mock', { delayMs: 1 }, {}), { provider: 'mock', sourceType: 'mock', model: 'geolens-mock', configured: true });
  assert.deepEqual(enginePresentation('deepseek', {}, {}), { provider: 'deepseek', sourceType: 'official_api', model: 'deepseek-chat', configured: false });
  assert.deepEqual(enginePresentation('deepseek', { model: 'deepseek-reasoner' }, env()), { provider: 'deepseek', sourceType: 'official_api', model: 'deepseek-reasoner', configured: true });
  assert.deepEqual(enginePresentation('unknown-provider', {}, {}), { provider: 'unknown-provider', sourceType: null, model: null, configured: false });
});

test('registry：注册/解析/列表与未知 provider', () => {
  const registry = new LLMProviderRegistry();
  const mock = new MockProvider();
  registry.register(mock);
  assert.equal(registry.resolve('mock'), mock);
  assert.equal(registry.resolve('deepseek'), undefined);
  assert.equal(registry.resolve('nope'), undefined);
  assert.equal(registry.list().length, 1);
  assert.equal(registry.list()[0].provider, 'mock');
});

// ---------------------------------------------------------------- mock provider

test('mock：默认文案与 scenario 文案、durationMs', async () => {
  const provider = new MockProvider();
  const plain = await provider.execute(baseRequest({ engineConfig: { delayMs: 0 } }));
  assert.equal(plain.content, '[mock:test-engine] 大学生创新创业比赛可以用哪些 AI 工具？');
  assert.equal(plain.provider, 'mock');
  assert.equal(plain.sourceType, 'mock');
  assert.equal(plain.retrievalMode, 'unknown');
  assert.equal(plain.model, 'geolens-mock');
  assert.equal(plain.requestedModel, 'geolens-mock'); // M6C mock identity
  assert.equal(plain.responseModel, 'geolens-mock');  // M6C mock identity
  const scenario = await provider.execute(baseRequest({ engineConfig: { delayMs: 5, scenario: 'first' } }));
  assert.ok(scenario.content.includes('ProjectMentor'));
  assert.ok(scenario.durationMs >= 5);
});

test('mock：structuredCitations 从 config.citations 解析；非法 url 抛 invalid_config', async () => {
  const provider = new MockProvider();
  const withCitations = await provider.execute(baseRequest({ engineConfig: { delayMs: 0, scenario: 'first', citations: [{ url: 'https://example.com/a', title: 'A' }] } }));
  assert.equal(withCitations.structuredCitations?.length, 1);
  await assert.rejects(() => provider.execute(baseRequest({ engineConfig: { delayMs: 0, citations: [{ url: '' }] } })), (error: unknown) => {
    assert.ok(error instanceof LLMProviderError && error.kind === 'invalid_config');
    return true;
  });
});

test('mock：非法 config / permanentFailure / failuresBeforeSuccess 语义', async () => {
  const provider = new MockProvider();
  await assert.rejects(() => provider.execute(baseRequest({ engineConfig: 'nope' })), (error: unknown) => {
    assert.ok(error instanceof LLMProviderError && error.kind === 'invalid_config');
    return true;
  });
  await assert.rejects(() => provider.execute(baseRequest({ engineConfig: { delayMs: 0, permanentFailure: true } })), (error: unknown) => {
    assert.ok(error instanceof LLMProviderError && error.kind === 'mock_failure');
    return true;
  });
  await assert.rejects(() => provider.execute(baseRequest({ engineConfig: { delayMs: 0, failuresBeforeSuccess: 2 }, attempt: 2 })), (error: unknown) => {
    assert.ok(error instanceof LLMProviderError && error.kind === 'mock_failure');
    return true;
  });
  const ok = await provider.execute(baseRequest({ engineConfig: { delayMs: 0, failuresBeforeSuccess: 2 }, attempt: 3 }));
  assert.ok(ok.content.length > 0);
});

test('mock：超时 → ProviderTimeoutError（kind=timeout 可重试）', async () => {
  const provider = new MockProvider();
  await assert.rejects(() => provider.execute(baseRequest({ engineConfig: { delayMs: 1000 }, timeoutMs: 20 })), (error: unknown) => {
    assert.ok(error instanceof LLMProviderError && error.kind === 'timeout');
    return true;
  });
});

test('mockScenarioText：版本化确定性 demo 文案（中文/英文/负面/citation 场景）', () => {
  assert.ok(mockScenarioText('chinese', 'k', 'q', entities).includes('ProjectMentor'));
  assert.ok(mockScenarioText('english', 'k', 'q', entities).includes('recommend ProjectMentor'));
  assert.ok(mockScenarioText('negative', 'k', 'q', entities).includes('不推荐 ProjectMentor'));
  assert.ok(mockScenarioText('citation', 'k', 'q', entities).includes('https://example.com/guide'));
  assert.throws(() => mockScenarioText('nope', 'k', 'q', entities));
});

// ---------------------------------------------------------------- deepseek guards

test('deepseek：默认 env 下 real providers disabled → ProviderDisabledError', async () => {
  const provider = new DeepSeekProvider({ env: {} });
  await assert.rejects(() => provider.execute(baseRequest()), (error: unknown) => {
    assert.ok(error instanceof LLMProviderError && error.kind === 'disabled');
    assert.equal(isRetryableProviderError(error.kind), false);
    return true;
  });
});

test('deepseek：flag=true 但无 API Key → ProviderNotConfiguredError', async () => {
  const provider = new DeepSeekProvider({ env: { ENABLE_REAL_PROVIDERS: 'true' } });
  await assert.rejects(() => provider.execute(baseRequest()), (error: unknown) => {
    assert.ok(error instanceof LLMProviderError && error.kind === 'not_configured');
    return true;
  });
});

// ---------------------------------------------------------------- request mapping

test('deepseek：请求映射（url/headers/body/model/messages/temperature/max_tokens）', async () => {
  const { fetch, calls } = capturingFetch();
  const provider = new DeepSeekProvider({ fetch, env: env() });
  await provider.execute(baseRequest({
    engineConfig: { model: 'deepseek-reasoner', temperature: 0.2, maxTokens: 512, systemPrompt: '你是中文助手。' },
  }));
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, 'https://api.deepseek.com/chat/completions');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer sk-test-secret-123');
  assert.equal(init.headers['Content-Type'], 'application/json');
  const body = JSON.parse(init.body) as Record<string, unknown>;
  assert.equal(body.model, 'deepseek-reasoner');
  assert.equal(body.stream, false);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.max_tokens, 512);
  const messages = body.messages as Array<Record<string, string>>;
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  assert.equal(messages[1].content, baseRequest().queryText);
});

test('deepseek：响应映射（provider/requestedModel/responseModel/model/modelVersion/usage/requestId/finishReason/rawPrompt）', async () => {
  const { fetch, calls } = capturingFetch();
  const provider = new DeepSeekProvider({ fetch, env: env() });
  const response = await provider.execute(baseRequest());
  assert.equal(response.provider, 'deepseek');
  assert.equal(response.sourceType, 'official_api');
  assert.equal(response.retrievalMode, 'api_plain');
  // M6C model identity：requested = 请求模型；response = Provider 回报模型
  assert.equal(response.requestedModel, 'deepseek-chat');
  assert.equal(response.responseModel, 'deepseek-chat');
  assert.equal(response.model, 'deepseek-chat'); // legacy = responseModel ?? requestedModel
  assert.equal(response.modelVersion, 'deepseek-chat');
  assert.equal(response.content, '推荐 ProjectMentor。');
  assert.equal(response.requestId, 'chatcmpl-test-1');
  assert.equal(response.finishReason, 'stop');
  assert.deepEqual(response.usage, { promptTokens: 12, completionTokens: 5, totalTokens: 17 });
  assert.ok(response.rawPrompt.includes('deepseek-chat'));
  assert.ok(response.durationMs >= 0);
  assert.equal(calls[0].init.signal instanceof AbortSignal, true);
});

test('deepseek：requested ≠ response —— 请求 deepseek-chat、API 回报 deepseek-v4-flash 正常保存', async () => {
  const provider = new DeepSeekProvider({ fetch: modelResponse('deepseek-v4-flash'), env: env({ DEEPSEEK_MODEL: 'deepseek-chat' }) });
  const response = await provider.execute(baseRequest());
  assert.equal(response.requestedModel, 'deepseek-chat');
  assert.equal(response.responseModel, 'deepseek-v4-flash');
  assert.notEqual(response.requestedModel, response.responseModel); // 两者语义分离
  assert.equal(response.model, 'deepseek-v4-flash'); // legacy 保持旧行为
  assert.equal(response.modelVersion, 'deepseek-v4-flash');
});

test('deepseek：payload 未报告 model → responseModel=null 且用配置 model', async () => {
  const fetch: FetchLike = async (_url, _init) => jsonResponse({
    id: 'chatcmpl-x', choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
  const provider = new DeepSeekProvider({ fetch, env: env({ DEEPSEEK_MODEL: 'deepseek-chat' }) });
  const response = await provider.execute(baseRequest());
  assert.equal(response.requestedModel, 'deepseek-chat');
  assert.equal(response.responseModel, null);
  assert.equal(response.model, 'deepseek-chat');
  assert.equal(response.modelVersion, null);
});

test('deepseek：usage 字段缺失/部分 → usage 不返回', async () => {
  const fetch: FetchLike = async (_url, _init) => jsonResponse({
    id: 'x', choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1 },
  });
  const provider = new DeepSeekProvider({ fetch, env: env() });
  const response = await provider.execute(baseRequest());
  assert.equal(response.usage, undefined);
});

// ---------------------------------------------------------------- error classification

test('deepseek：401/403 → auth（永久）', async () => {
  for (const status of [401, 403]) {
    const fetch: FetchLike = async (_url, _init) => jsonResponse({ error: { message: 'bad key' } }, status);
    const provider = new DeepSeekProvider({ fetch, env: env() });
    await assert.rejects(() => provider.execute(baseRequest()), (error: unknown) => {
      assert.ok(error instanceof LLMProviderError && error.kind === 'auth' && error.httpStatus === status);
      assert.equal(isRetryableProviderError(error.kind), false);
      return true;
    });
  }
});

test('deepseek：429 → rate_limit（可重试）；500 → server（可重试）；400 → bad_request（永久）', async () => {
  const cases: Array<[number, string, boolean]> = [[429, 'rate_limit', true], [500, 'server', true], [503, 'server', true], [400, 'bad_request', false]];
  for (const [status, kind, retryable] of cases) {
    const fetch: FetchLike = async (_url, _init) => jsonResponse({}, status);
    const provider = new DeepSeekProvider({ fetch, env: env() });
    await assert.rejects(() => provider.execute(baseRequest()), (error: unknown) => {
      assert.ok(error instanceof LLMProviderError && error.kind === kind && error.httpStatus === status);
      assert.equal(isRetryableProviderError(error.kind), retryable);
      return true;
    });
  }
});

test('deepseek：超时（AbortError）→ timeout（可重试）', async () => {
  const fetch: FetchLike = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const provider = new DeepSeekProvider({ fetch, env: env() });
  await assert.rejects(() => provider.execute(baseRequest({ timeoutMs: 5 })), (error: unknown) => {
    assert.ok(error instanceof LLMProviderError && error.kind === 'timeout');
    assert.equal(isRetryableProviderError(error.kind), true);
    return true;
  });
});

test('deepseek：网络错误（TypeError）→ network（可重试）', async () => {
  const fetch: FetchLike = async () => { throw new TypeError('fetch failed'); };
  const provider = new DeepSeekProvider({ fetch, env: env() });
  await assert.rejects(() => provider.execute(baseRequest()), (error: unknown) => {
    assert.ok(error instanceof LLMProviderError && error.kind === 'network');
    assert.equal(isRetryableProviderError(error.kind), true);
    return true;
  });
});

test('deepseek：malformed / empty content / 非数组 choices → 结构校验错误（永久）', async () => {
  const provider = new DeepSeekProvider({
    fetch: async (_url, _init) => jsonResponse('not-json{'),
    env: env(),
  });
  await assert.rejects(() => provider.execute(baseRequest()), (error: unknown) => {
    assert.ok(error instanceof LLMProviderError && error.kind === 'invalid_response');
    return true;
  });
  const emptyFetch: FetchLike = async (_url, _init) => jsonResponse({
    id: 'x', choices: [{ index: 0, message: { role: 'assistant', content: '   ' }, finish_reason: 'stop' }],
  });
  const emptyProvider = new DeepSeekProvider({ fetch: emptyFetch, env: env() });
  await assert.rejects(() => emptyProvider.execute(baseRequest()), (error: unknown) => {
    assert.ok(error instanceof LLMProviderError && error.kind === 'empty_response');
    assert.equal(isRetryableProviderError(error.kind), false);
    return true;
  });
  const noChoices: FetchLike = async (_url, _init) => jsonResponse({ id: 'x' });
  const noChoicesProvider = new DeepSeekProvider({ fetch: noChoices, env: env() });
  await assert.rejects(() => noChoicesProvider.execute(baseRequest()), (error: unknown) => {
    assert.ok(error instanceof LLMProviderError && error.kind === 'invalid_response');
    return true;
  });
});

// ---------------------------------------------------------------- secret redaction

test('secret 保护：错误消息与 ProviderResponse 均不含 API Key / Authorization', async () => {
  const authFetch: FetchLike = async (_url, _init) => jsonResponse({ error: 'sk-test-secret-123' }, 401);
  const authProvider = new DeepSeekProvider({ fetch: authFetch, env: env() });
  await assert.rejects(() => authProvider.execute(baseRequest()), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes('sk-test-secret-123'));
    assert.ok(!error.message.includes('Authorization'));
    return true;
  });
  const { fetch } = capturingFetch();
  const okProvider = new DeepSeekProvider({ fetch, env: env() });
  const response = await okProvider.execute(baseRequest());
  const serialized = JSON.stringify(response);
  assert.ok(!serialized.includes('sk-test-secret-123'));
  assert.ok(!serialized.includes('Authorization'));
  const payload = JSON.stringify(response.rawProviderPayload);
  assert.ok(!payload.includes('sk-test-secret-123'));
  assert.ok(!payload.includes('Authorization'));
  assert.ok(!payload.includes('推荐 ProjectMentor。'), 'rawProviderPayload 不应重复回答正文');
  assert.ok((response.rawProviderPayload as Record<string, unknown>).id, 'rawProviderPayload 保留 id');
  assert.ok((response.rawProviderPayload as Record<string, unknown>).usage, 'rawProviderPayload 保留 usage');
});

// ---------------------------------------------------------------- M8E prompt neutrality

test('M8E-74: Discovery provider prompt 不含 target canonical/alias（中性 prompt）', async () => {
  const { fetch, calls } = capturingFetch();
  const provider = new DeepSeekProvider({ fetch, env: env() });
  await provider.execute(baseRequest({ queryText: '大学生参加创新创业比赛可以使用哪些 AI 工具？' }));
  assert.equal(calls.length, 1);
  const body = JSON.parse((calls[0].init!.body as string) ?? '');
  const sent = JSON.stringify(body.messages);
  assert.ok(sent.includes('大学生参加创新创业比赛可以使用哪些 AI 工具？'), '用户 query 必须原样发送');
  assert.ok(!sent.includes('ProjectMentor'), 'target canonical 不得泄漏进 prompt');
  assert.ok(!sent.includes('项目导师'), 'target alias 不得泄漏进 prompt');
});

test('M8E-74b: BRANDED_SANITY query 本身含 target 时允许（用户明示问题）', async () => {
  const { fetch, calls } = capturingFetch();
  const provider = new DeepSeekProvider({ fetch, env: env() });
  await provider.execute(baseRequest({ queryText: 'ProjectMentor 是什么？' }));
  const body = JSON.parse((calls[0].init!.body as string) ?? '');
  const sent = JSON.stringify(body.messages);
  assert.ok(sent.includes('ProjectMentor'), '品牌认知测试的 query 本身可含品牌');
});

test('M8E-74c: systemPrompt（若配置）不自动包含 target', async () => {
  const { fetch, calls } = capturingFetch();
  const provider = new DeepSeekProvider({ fetch, env: env() });
  await provider.execute(baseRequest({ engineConfig: { systemPrompt: '请直接回答用户问题。' } }));
  const body = JSON.parse((calls[0].init!.body as string) ?? '');
  assert.ok(!JSON.stringify(body.messages).includes('ProjectMentor'));
});
