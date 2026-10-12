export interface ModelPricing {
  costPerInputToken: number;
  costPerOutputToken: number;
  currency: "USD";
  pricingVersion: string;
}

export const AI_MODEL_PRICING: Record<string, ModelPricing> = {
  "deepseek-chat": { costPerInputToken: 0.00000014, costPerOutputToken: 0.00000028, currency: "USD", pricingVersion: "2026-09" },
  // 2026-10-12 官方 Flash 高峰、缓存未命中价。用于审计估算上界，不是账单金额。
  "deepseek-flash": { costPerInputToken: 0.0000003, costPerOutputToken: 0.0000012, currency: "USD", pricingVersion: "2026-10-12-peak-cache-miss" },
  "deepseek-v4-flash": { costPerInputToken: 0.0000003, costPerOutputToken: 0.0000012, currency: "USD", pricingVersion: "2026-10-12-peak-cache-miss" },
  "deepseek-reasoner": { costPerInputToken: 0.00000055, costPerOutputToken: 0.00000219, currency: "USD", pricingVersion: "2026-09" },
  "qwen-plus": { costPerInputToken: 0.0000008, costPerOutputToken: 0.000002, currency: "USD", pricingVersion: "2026-09" },
  "qwen-turbo": { costPerInputToken: 0.0000003, costPerOutputToken: 0.0000006, currency: "USD", pricingVersion: "2026-09" },
  "qwen-max": { costPerInputToken: 0.0000024, costPerOutputToken: 0.0000096, currency: "USD", pricingVersion: "2026-09" },
  "mock-ai-engine": { costPerInputToken: 0, costPerOutputToken: 0, currency: "USD", pricingVersion: "2026-09" },
  "geolens-mock": { costPerInputToken: 0, costPerOutputToken: 0, currency: "USD", pricingVersion: "2026-09" },
};

export function calculateEstimatedCost(model: string, inputTokens: number | null, outputTokens: number | null): number | null {
  if (inputTokens == null || outputTokens == null) return null;
  const pricing = AI_MODEL_PRICING[model];
  if (!pricing) return null;  // unknown model = null, not 0
  return Number((inputTokens * pricing.costPerInputToken + outputTokens * pricing.costPerOutputToken).toFixed(6));
}
