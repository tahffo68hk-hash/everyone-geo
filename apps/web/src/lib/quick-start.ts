export type QuickStartQueryType = "DISCOVERY" | "BRANDED_SANITY" | "CUSTOM";

export type QuickStartQuestion = {
  id: string;
  text: string;
  category: string;
  intent: string;
  queryType: QuickStartQueryType;
  rationale: string;
};

const BENCHMARK_CATEGORIES = [
  "tool-discovery",
  "comparison",
  "workflow",
  "recommendation",
  "pain-point",
  "competition",
  "sanity-control",
] as const;

function categoryFor(value: unknown): string {
  const category = typeof value === "string" ? value.trim().toLowerCase() : "";
  if ((BENCHMARK_CATEGORIES as readonly string[]).includes(category)) return category;
  if (/比较|对比|comparison/.test(category)) return "comparison";
  if (/流程|场景|workflow/.test(category)) return "workflow";
  if (/推荐|recommend/.test(category)) return "recommendation";
  if (/痛点|问题|pain/.test(category)) return "pain-point";
  if (/竞品|竞争|competition/.test(category)) return "competition";
  if (/品牌|基线|sanity/.test(category)) return "sanity-control";
  return "tool-discovery";
}

export function normalizeGeneratedQuestions(input: unknown, brandName: string): QuickStartQuestion[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const brand = brandName.trim().toLocaleLowerCase();
  return input.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const value = entry as Record<string, unknown>;
    const text = String(value.text ?? value.queryText ?? "").trim();
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) return [];
    seen.add(key);
    const requestedType = String(value.queryType ?? "").toUpperCase();
    const queryType: QuickStartQueryType = requestedType === "CUSTOM"
      ? "CUSTOM"
      : requestedType === "BRANDED_SANITY" || requestedType === "BRANDED" || (!!brand && key.includes(brand))
        ? "BRANDED_SANITY"
        : "DISCOVERY";
    return [{
      id: `quick-${index}-${key.length}`,
      text,
      category: categoryFor(value.category),
      intent: String(value.intent ?? value.rationale ?? "用户决策").trim() || "用户决策",
      queryType,
      rationale: String(value.rationale ?? "").trim(),
    }];
  });
}

export function buildBenchmarkQueries(questions: QuickStartQuestion[]) {
  return questions.map((question, index) => ({
    queryText: question.text.trim(),
    category: categoryFor(question.category),
    intent: question.intent.trim() || "用户决策",
    locale: "zh-CN",
    weight: 1,
    enabled: true,
    sortOrder: index,
    sanity: question.queryType === "BRANDED_SANITY",
    queryType: question.queryType,
    source: "BUILDER",
  }));
}

export function quickStartStorageKey(userId: string, projectId: string): string {
  return `geolens:quick-start:${userId}:${projectId}`;
}
