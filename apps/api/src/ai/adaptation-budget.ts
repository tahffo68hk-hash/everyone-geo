/**
 * DeepSeek Flash 官方价目（2026-10-12 查阅 https://api-docs.deepseek.com/quick_start/pricing）。
 * 调用前按更高的高峰、缓存未命中价计算上界。非高峰更便宜，不拿来放宽门禁。
 */
export const DEEPSEEK_FLASH_PEAK_USD_PER_MILLION = {
  inputCacheMiss: 0.3,
  output: 1.2,
} as const;

export const ADAPTATION_REAL_MODEL = "deepseek-flash";
export const ADAPTATION_MAX_OUTPUT_TOKENS = 4096;
export const ADAPTATION_BUDGET_CEILING_USD = 0.08;

export interface AdaptationBudget {
  model: string;
  inputCharacters: number;
  inputTokensUpper: number;
  maxOutputTokens: number;
  worstCaseUsd: number;
  ceilingUsd: number;
  priceBasis: string;
}

/** 中文场景下按 1 个字符最多 1 个 token 估算，并加上消息封装余量。这是上界，不是事后统计。 */
export function upperBoundInputTokens(systemPrompt: string, userPrompt: string): number {
  return systemPrompt.length + userPrompt.length + 32;
}

export function worstCaseAdaptationUsd(inputTokensUpper: number, maxOutputTokens: number): number {
  const input = (inputTokensUpper * DEEPSEEK_FLASH_PEAK_USD_PER_MILLION.inputCacheMiss) / 1_000_000;
  const output = (maxOutputTokens * DEEPSEEK_FLASH_PEAK_USD_PER_MILLION.output) / 1_000_000;
  return Number((input + output).toFixed(6));
}

export function assessAdaptationBudget(systemPrompt: string, userPrompt: string): AdaptationBudget {
  const inputTokensUpper = upperBoundInputTokens(systemPrompt, userPrompt);
  const worstCaseUsd = worstCaseAdaptationUsd(inputTokensUpper, ADAPTATION_MAX_OUTPUT_TOKENS);
  return {
    model: ADAPTATION_REAL_MODEL,
    inputCharacters: systemPrompt.length + userPrompt.length,
    inputTokensUpper,
    maxOutputTokens: ADAPTATION_MAX_OUTPUT_TOKENS,
    worstCaseUsd,
    ceilingUsd: ADAPTATION_BUDGET_CEILING_USD,
    priceBasis: "deepseek-flash peak cache-miss input $0.30/1M + peak output $1.20/1M; thinking disabled; one attempt",
  };
}

export function adaptationBudgetAllowsCall(budget: AdaptationBudget): boolean {
  return budget.model === ADAPTATION_REAL_MODEL
    && budget.maxOutputTokens === ADAPTATION_MAX_OUTPUT_TOKENS
    && budget.worstCaseUsd <= budget.ceilingUsd
    && budget.worstCaseUsd <= 0.1;
}
