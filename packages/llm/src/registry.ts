import type { LLMProvider, ProviderKind } from './types';

/** Resolves an Engine.provider string to a registered LLMProvider implementation. */
export class LLMProviderRegistry {
  private readonly providers = new Map<ProviderKind, LLMProvider>();

  register(provider: LLMProvider): this {
    this.providers.set(provider.provider, provider);
    return this;
  }

  resolve(provider: string): LLMProvider | undefined {
    return this.providers.get(provider as ProviderKind);
  }

  list(): LLMProvider[] {
    return [...this.providers.values()];
  }
}
