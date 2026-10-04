import { ProviderKind, ProviderUsage } from './types';
import { 
  LLMProviderError, 
  ProviderDisabledError, 
  ProviderNotConfiguredError, 
  ProviderRateLimitError,
  ProviderServerError,
  ProviderNetworkError,
  ProviderAuthError,
  ProviderTimeoutError,
  ProviderBadRequestError
} from './errors';
import { calculateEstimatedCost } from './pricing';
import { readRealProviderEnv, readQwenProviderEnv } from './config';

export type InteractiveProvider = 'deepseek' | 'qwen' | 'mock' | 'auto';

export interface InteractiveRequest {
  provider?: InteractiveProvider;
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface InteractiveResponse {
  content: string;
  provider: ProviderKind;
  requestedProvider: InteractiveProvider;
  model: string;
  requestedModel: string;
  actualModel: string | null;
  usage: ProviderUsage | null;
  estimatedCost: number | null;
  latencyMs: number;
  requestId: string | null;
}

export interface InteractiveRuntimeConfig {
  env?: NodeJS.ProcessEnv;
  maxRetries?: number; // default 2
  fetch?: (url: string, init: any) => Promise<any>;
}

export class InteractiveRuntime {
  private env: NodeJS.ProcessEnv;
  private maxRetries: number;
  private fetchFn: (url: string, init: any) => Promise<any>;

  constructor(config?: InteractiveRuntimeConfig) {
    this.env = config?.env || process.env;
    this.maxRetries = config?.maxRetries ?? 2;
    // @ts-ignore
    this.fetchFn = config?.fetch || globalThis.fetch;
  }

  resolveProvider(requested: InteractiveProvider = 'auto'): ProviderKind {
    const isTest = this.env.NODE_ENV === 'test';
    const forceReal = this.env.FORCE_REAL_AI === 'true';
    const dsCfg = readRealProviderEnv(this.env);
    const qwenCfg = readQwenProviderEnv(this.env);
    const enableReal = dsCfg.realProvidersEnabled || forceReal;

    if (requested === 'mock') {
      return 'mock';
    }

    if (requested === 'deepseek') {
      if (!enableReal) {
        throw new ProviderDisabledError();
      }
      if (!dsCfg.apiKey) {
        throw new ProviderNotConfiguredError();
      }
      return 'deepseek';
    }

    if (requested === 'qwen') {
      if (!enableReal) {
        throw new ProviderDisabledError();
      }
      if (!qwenCfg.apiKey) {
        throw new ProviderNotConfiguredError();
      }
      return 'qwen';
    }

    // auto
    if (isTest && !forceReal) {
      return 'mock';
    }

    if (enableReal) {
      if (dsCfg.apiKey) return 'deepseek';
      if (qwenCfg.apiKey) return 'qwen';
    }

    // production without key or real disabled
    if (this.env.NODE_ENV === 'production' || this.env.NODE_ENV === undefined) {
       throw new ProviderNotConfiguredError();
    }

    throw new ProviderNotConfiguredError();
  }

  async execute(request: InteractiveRequest): Promise<InteractiveResponse> {
    const requestedProvider = request.provider || 'auto';
    const providerKind = this.resolveProvider(requestedProvider);
    
    if (providerKind === 'mock') {
      const start = Date.now();
      return {
        content: '{"mock": true, "provider": "mock"}',
        provider: 'mock',
        requestedProvider,
        model: 'mock-ai-engine',
        requestedModel: request.model || 'mock-ai-engine',
        actualModel: null,
        usage: null,
        estimatedCost: 0,
        latencyMs: Math.max(1, Date.now() - start),
        requestId: `mock-${start}`
      };
    }

    try {
      return await this.executeReal(providerKind, request, requestedProvider);
    } catch (error) {
      if (requestedProvider === 'auto') {
        const fallbackProvider = providerKind === 'deepseek' ? 'qwen' : 'deepseek';
        try {
          const fallbackKind = this.resolveProvider(fallbackProvider);
          return await this.executeReal(fallbackKind, request, requestedProvider);
        } catch (fallbackError) {
          throw error; // throw original error if fallback fails
        }
      }
      throw error;
    }
  }

  private async executeReal(provider: ProviderKind, request: InteractiveRequest, requestedProvider: InteractiveProvider): Promise<InteractiveResponse> {
    let url = '';
    let apiKey = '';
    let defaultModel = '';

    if (provider === 'deepseek') {
      const dsCfg = readRealProviderEnv(this.env);
      url = `${dsCfg.baseUrl}/chat/completions`;
      apiKey = dsCfg.apiKey || '';
      defaultModel = dsCfg.model;
    } else if (provider === 'qwen') {
      const qwenCfg = readQwenProviderEnv(this.env);
      url = `${qwenCfg.baseUrl}/chat/completions`;
      apiKey = qwenCfg.apiKey || '';
      defaultModel = qwenCfg.model;
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    const requestedModel = request.model || defaultModel;
    const body = {
      model: requestedModel,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt }
      ],
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens
    };

    const start = Date.now();
    let attempt = 0;
    
    while (attempt <= this.maxRetries) {
      try {
        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), request.timeoutMs || 30000);

        const response = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(body),
          signal: abortController.signal
        });
        clearTimeout(timeout);

        if (!response.ok) {
          const status = response.status;
          
          if (status === 429) {
            throw new ProviderRateLimitError(status);
          }
          if (status === 401 || status === 403) {
            throw new ProviderAuthError(status);
          }
          if (status >= 500) {
            throw new ProviderServerError(status);
          }
          throw new ProviderBadRequestError(status);
        }

        const data = await response.json();
        const latencyMs = Date.now() - start;
        
        const content = data.choices?.[0]?.message?.content || '';
        const actualModel = data.model || requestedModel;
        const usage = data.usage ? {
          promptTokens: data.usage.prompt_tokens || 0,
          completionTokens: data.usage.completion_tokens || 0,
          totalTokens: data.usage.total_tokens || 0
        } : null;
        
        const estimatedCost = usage ? calculateEstimatedCost(actualModel, usage.promptTokens, usage.completionTokens) : null;

        return {
          content,
          provider,
          requestedProvider,
          model: requestedModel,
          requestedModel,
          actualModel,
          usage,
          estimatedCost,
          latencyMs,
          requestId: data.id || null
        };

      } catch (error: any) {
        if (error.name === 'AbortError') {
          error = new ProviderTimeoutError();
        }

        const isRetryable = 
          (error instanceof ProviderRateLimitError) || 
          (error instanceof ProviderServerError) ||
          (error instanceof ProviderTimeoutError) ||
          (error instanceof ProviderNetworkError) ||
          (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT');

        if (!isRetryable || attempt >= this.maxRetries) {
          throw error;
        }

        const delay = error instanceof ProviderRateLimitError ? (attempt + 1) * 1000 : (attempt + 1) * 800;
        await new Promise(res => setTimeout(res, delay));
        attempt++;
      }
    }

    throw new Error('Unreachable');
  }
}
