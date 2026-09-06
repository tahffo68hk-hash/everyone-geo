import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { ProviderConfigError, ProviderMockFailureError, ProviderTimeoutError } from './errors';
import type { LLMProvider, LlmEntity, ProviderRequest, ProviderResponse, StructuredCitation } from './types';

/**
 * Deterministic demo provider. Local simulation only - no network, no
 * credentials. It intentionally identifies itself as mock (sourceType=mock)
 * and never pretends to be a real model.
 *
 * Semantics preserved from M3 executeMock / M4 mock-response:
 *   config: { delayMs, failuresBeforeSuccess, permanentFailure, scenario, citations? }
 */

/** Versioned deterministic demo sentences. No external provider is contacted. */
export function mockScenarioText(scenario: string, engineKey: string, queryText: string, entities: LlmEntity[]): string {
  const brand = entities.find(e => e.entityType === 'brand')?.canonicalName ?? 'ProjectMentor';
  const competitors = entities.filter(e => e.entityType === 'competitor').map(e => e.canonicalName);
  const [a = 'A', b = 'B', c = 'C'] = competitors;
  switch (scenario) {
    case 'first': return `推荐 ${brand}，它适合商业计划书和答辩准备。也可以考虑 ${a}。`;
    case 'second': return `推荐 ${a}、${brand} 和 ${b}。${brand} 很适合大学生创新创业比赛。`;
    case 'mention': return `${brand} 是一个软件工具。${a} 也是一个工具。`;
    case 'absent': return `推荐 ${a} 和 ${b}。`;
    case 'negative': return `${brand} 表现差，不推荐 ${brand}。推荐 ${a}。`;
    case 'citation': return `推荐 ${brand}。参考 https://example.com/guide 和 https://docs.example.com/research 。`;
    case 'competitors': return `可以考虑 ${a}、${b}、${brand} 和 ${c}。`;
    case 'duplicate-citation': return `推荐 ${brand}。https://example.com/guide https://example.com/guide`;
    case 'chinese': return `建议选择 ${brand}，它很适合商业计划书准备。`;
    case 'english': return `We recommend ${brand}. It is a great tool. You can also consider ${a}.`;
    default: throw new ProviderConfigError();
  }
}

function parseCitations(value: unknown): StructuredCitation[] {
  if (!Array.isArray(value)) return [];
  const citations: StructuredCitation[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new ProviderConfigError();
    const row = item as Record<string, unknown>;
    if (typeof row.url !== 'string' || row.url.trim() === '') throw new ProviderConfigError();
    citations.push({ url: row.url, title: typeof row.title === 'string' ? row.title : undefined });
  }
  return citations;
}

export class MockProvider implements LLMProvider {
  readonly provider = 'mock' as const;
  readonly sourceType = 'mock' as const;
  readonly retrievalMode = 'unknown' as const;

  async execute(request: ProviderRequest): Promise<ProviderResponse> {
    const started = performance.now();
    const config = request.engineConfig;
    if (config === null || typeof config !== 'object' || Array.isArray(config)) throw new ProviderConfigError();
    const { delayMs, failuresBeforeSuccess, permanentFailure, scenario } = config as Record<string, unknown>;
    if ((delayMs !== undefined && (typeof delayMs !== 'number' || !Number.isInteger(delayMs) || delayMs < 0 || delayMs > 5000))
      || (failuresBeforeSuccess !== undefined && (typeof failuresBeforeSuccess !== 'number' || !Number.isInteger(failuresBeforeSuccess) || failuresBeforeSuccess < 0 || failuresBeforeSuccess > 100))
      || (permanentFailure !== undefined && typeof permanentFailure !== 'boolean')
      || (scenario !== undefined && typeof scenario !== 'string')) {
      throw new ProviderConfigError();
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      await delay((delayMs as number | undefined) ?? (300 + Math.floor(Math.random() * 701)), undefined, { signal: controller.signal });
    } catch {
      throw new ProviderTimeoutError();
    } finally {
      clearTimeout(timer);
    }
    if (permanentFailure === true || request.attempt <= ((failuresBeforeSuccess as number | undefined) ?? 0)) {
      throw new ProviderMockFailureError();
    }
    const content = scenario !== undefined
      ? mockScenarioText(String(scenario), request.engineKey, request.queryText, request.entities ?? [])
      : `[mock:${request.engineKey}] ${request.queryText}`;
    // M6C model identity：requested = Worker 传入（默认 mock 常量）；
    // responseModel = mock 自身声明（geolens-mock）—— mock 即身份来源。
    const requestedModel = request.requestedModel ?? 'geolens-mock';
    return {
      provider: 'mock', sourceType: this.sourceType, retrievalMode: this.retrievalMode,
      requestedModel, responseModel: 'geolens-mock',
      model: 'geolens-mock', modelVersion: '1',
      content, rawPrompt: request.queryText,
      structuredCitations: parseCitations((config as Record<string, unknown>).citations),
      durationMs: Math.round(performance.now() - started),
    };
  }
}
