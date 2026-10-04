import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import { InteractiveRuntime, InteractiveRequest } from '../src/runtime';
import { 
  ProviderDisabledError, 
  ProviderNotConfiguredError, 
  ProviderAuthError,
  ProviderTimeoutError
} from '../src/errors';

describe('InteractiveRuntime', () => {
  const baseRequest: InteractiveRequest = {
    systemPrompt: 'sys',
    userPrompt: 'user'
  };

  test('Mock provider returns deterministic response', async () => {
    const runtime = new InteractiveRuntime({ env: {} });
    const res = await runtime.execute({ ...baseRequest, provider: 'mock' });
    assert.strictEqual(res.provider, 'mock');
    assert.strictEqual(res.content, '{"mock": true, "provider": "mock"}');
  });

  test('Auto route in test env (NODE_ENV=test) -> mock', () => {
    const runtime = new InteractiveRuntime({ env: { NODE_ENV: 'test' } });
    assert.strictEqual(runtime.resolveProvider('auto'), 'mock');
  });

  test('Explicit deepseek without key -> throws ProviderNotConfiguredError', () => {
    const runtime = new InteractiveRuntime({ env: { ENABLE_REAL_PROVIDERS: 'true' } });
    assert.throws(() => {
      runtime.resolveProvider('deepseek');
    }, ProviderNotConfiguredError);
  });

  test('Explicit deepseek with key but ENABLE_REAL_PROVIDERS=false -> throws ProviderDisabledError', () => {
    const runtime = new InteractiveRuntime({ env: { DEEPSEEK_API_KEY: 'key' } });
    assert.throws(() => {
      runtime.resolveProvider('deepseek');
    }, ProviderDisabledError);
  });

  test('Provider resolution logic for auto mode with various env configs', () => {
    // Both keys, should prefer deepseek
    let runtime = new InteractiveRuntime({ env: { ENABLE_REAL_PROVIDERS: 'true', DEEPSEEK_API_KEY: 'd', DASHSCOPE_API_KEY: 'q' } });
    assert.strictEqual(runtime.resolveProvider('auto'), 'deepseek');

    // Only qwen key
    runtime = new InteractiveRuntime({ env: { ENABLE_REAL_PROVIDERS: 'true', DASHSCOPE_API_KEY: 'q' } });
    assert.strictEqual(runtime.resolveProvider('auto'), 'qwen');
    
    // production without key
    runtime = new InteractiveRuntime({ env: { NODE_ENV: 'production' } });
    assert.throws(() => {
      runtime.resolveProvider('auto');
    }, ProviderNotConfiguredError);
  });

  test('Retry on 429', async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      if (attempts === 1) {
        return { ok: false, status: 429 };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'success' } }] })
      };
    };

    const runtime = new InteractiveRuntime({ 
      env: { ENABLE_REAL_PROVIDERS: 'true', DEEPSEEK_API_KEY: 'key' },
      // @ts-ignore
      fetch: mockFetch
    });

    const res = await runtime.execute({ ...baseRequest, provider: 'deepseek' });
    assert.strictEqual(attempts, 2);
    assert.strictEqual(res.content, 'success');
  });

  test('Retry on 500', async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      if (attempts === 1) {
        return { ok: false, status: 500 };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'success2' } }] })
      };
    };

    const runtime = new InteractiveRuntime({ 
      env: { ENABLE_REAL_PROVIDERS: 'true', DEEPSEEK_API_KEY: 'key' },
      // @ts-ignore
      fetch: mockFetch
    });

    const res = await runtime.execute({ ...baseRequest, provider: 'deepseek' });
    assert.strictEqual(attempts, 2);
    assert.strictEqual(res.content, 'success2');
  });

  test('No retry on 401', async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      return { ok: false, status: 401 };
    };

    const runtime = new InteractiveRuntime({ 
      env: { ENABLE_REAL_PROVIDERS: 'true', DEEPSEEK_API_KEY: 'key' },
      // @ts-ignore
      fetch: mockFetch
    });

    await assert.rejects(
      runtime.execute({ ...baseRequest, provider: 'deepseek' }),
      ProviderAuthError
    );
    assert.strictEqual(attempts, 1);
  });

  test('Failover from deepseek to qwen on error in auto mode', async () => {
    let fetchCalls = 0;
    const mockFetch = async (url: string) => {
      fetchCalls++;
      if (url.includes('deepseek')) {
        return { ok: false, status: 401 }; // Fail fast
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'qwen success' } }] })
      };
    };

    const runtime = new InteractiveRuntime({ 
      env: { ENABLE_REAL_PROVIDERS: 'true', DEEPSEEK_API_KEY: 'key1', DASHSCOPE_API_KEY: 'key2' },
      // @ts-ignore
      fetch: mockFetch
    });

    const res = await runtime.execute({ ...baseRequest, provider: 'auto' });
    assert.strictEqual(res.provider, 'qwen');
    assert.strictEqual(res.content, 'qwen success');
    assert.strictEqual(fetchCalls, 2);
  });

  test('Timeout via AbortController', async () => {
    const mockFetch = async (url: string, init: any) => {
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('AbortError');
          err.name = 'AbortError';
          reject(err);
        });
      });
    };

    const runtime = new InteractiveRuntime({ 
      env: { ENABLE_REAL_PROVIDERS: 'true', DEEPSEEK_API_KEY: 'key' },
      // @ts-ignore
      fetch: mockFetch,
      maxRetries: 0 // Avoid retries for speed
    });

    await assert.rejects(
      runtime.execute({ ...baseRequest, provider: 'deepseek', timeoutMs: 50 }),
      ProviderTimeoutError
    );
  });
});
