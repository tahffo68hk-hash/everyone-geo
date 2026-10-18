import { mockContent } from "./content";
export type Provider = "mock" | "deepseek" | "qwen" | "compatible";
export type Config = {
  provider: Provider;
  baseUrl: string;
  model: string;
  key?: string;
  extra: Record<string, unknown>;
};
export type Question = {
  text: string;
  kind: "DISCOVERY" | "BRANDED";
  intent: string;
};
export const VERSION = "geo-questions-v1";
export const defaults: Record<Provider, { baseUrl: string; model: string }> = {
  mock: { baseUrl: "", model: "mock-deterministic-v1" },
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  qwen: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
  },
  compatible: { baseUrl: "", model: "" },
};
export function infer(name: string, description = "") {
  const s = name + " " + description;
  return /CRM|客户|销售管理/i.test(s)
    ? "CRM 客户关系管理软件"
    : /大学|专业|学科|计算机科学/.test(s)
      ? "大学专业与升学选择"
      : /咖啡|茶饮/.test(s)
        ? "饮品与咖啡"
        : /鞋|运动/.test(s)
          ? "运动用品"
          : /手机|数码/.test(s)
            ? "数码产品"
            : "待确认的产品或服务";
}
export const intents = [
  "用户需求",
  "产品/品牌推荐",
  "方案比较",
  "行业选择",
  "价格与成本",
  "功能与使用场景",
  "品牌认知",
  "竞争对手",
  "购买或使用决策",
  "用户需求",
];
function mockQuestions(b: any): Question[] {
  const c = b.category;
  const texts = [
    `选择${c}时，应该先明确哪些需求？`,
    `有哪些值得比较的${c}选择？`,
    `不同${c}方案适合哪些人？`,
    `初次了解${c}，如何判断是否适合自己？`,
    `${c}的总成本应该怎样评估？`,
    `${c}在日常使用中要重点检查哪些功能或场景？`,
    `${b.name}属于什么类别，有哪些信息需要核实？`,
    `${b.name}与${b.competitors || "同类选择"}应该从哪些维度比较？`,
    `决定选择${b.name}之前，应核实哪些证据？`,
    `选择${c}时有哪些常见误区？`,
  ];
  return texts.map((text, i) => ({
    text,
    kind: i >= 6 && i <= 8 ? "BRANDED" : "DISCOVERY",
    intent: intents[i],
  }));
}
export class MockTransport {
  async complete(prompt: string, mode: string, b: any) {
    if (mode === "questions")
      return JSON.stringify({
        category: b.category,
        questions: mockQuestions(b),
      });
    if (mode === "content")
      return JSON.stringify(mockContent(b.channel, b.name, b.responses));
    if (mode === "suggestions")
      return JSON.stringify({
        suggestions: b.responses
          .slice(0, 4)
          .map((r: any) => ({
            title: `优先补充：${r.intent}`,
            action: `模拟数据/未真实验证：针对「${r.query}」，补充官网FAQ与可核实的场景说明，制作相关文章或短视频，在知乎及视频号分发；该回答${r.brand_mentioned ? "虽提及品牌，仍需核实依据" : "未提及品牌，作为潜在缺口优先检查"}。`,
            queryIds: [r.id],
          })),
      });
    if (mode === "test") return "模拟连接正常，未调用外部模型。";
    const hash = [...prompt].reduce((n, c) => n + c.charCodeAt(0), 0);
    return `【模拟数据/未真实验证】针对${b.category}，建议根据需求、成本、适用场景和可核实证据进行比较。${hash % 3 === 0 || prompt.includes(b.name) ? `${b.name}可以列为待核实的候选，不能据此认定实际能力。` : "目前缺少足够品牌证据，应补充公开说明。"}${b.competitors && hash % 2 === 0 ? `同样需要核实${b.competitors}的适用条件。` : ""}`;
  }
}
export async function complete(
  cfg: Config,
  prompt: string,
  mode: string,
  b: any,
  confirmed: boolean,
  fetcher: typeof fetch = fetch,
) {
  const start = Date.now();
  if (cfg.provider === "mock")
    return {
      answer: await new MockTransport().complete(prompt, mode, b),
      model: cfg.model,
      is_mock: true,
      tokens: null,
      latency_ms: Date.now() - start,
      cost: 0,
      citations: [] as string[],
    };
  if (!confirmed) throw Error("真实调用需要明确费用确认");
  if (!cfg.key) throw Error("请先在设置中配置 API Key");
  const url = new URL(cfg.baseUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("Base URL 必须是无凭据、无查询参数的 HTTPS 地址");
  const extra = Object.fromEntries(
    Object.entries(cfg.extra).filter(([k]) =>
      [
        "temperature",
        "top_p",
        "max_tokens",
        "presence_penalty",
        "frequency_penalty",
        "seed",
      ].includes(k),
    ),
  );
  let res: Response;
  try {
    res = await fetcher(cfg.baseUrl.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.key}`,
      },
      body: JSON.stringify({
        ...extra,
        max_tokens: Math.min(Number(extra.max_tokens) || 1600, 2400),
        model: cfg.model,
        stream: false,
        messages: [
          {
            role: "system",
            content:
              mode === "questions"
                ? "你是 GEO 研究助手。仅返回 JSON，不编造已核实品牌事实。"
                : "根据用户问题独立回答。不要虚构来源或实时搜索结果。",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(45000),
      redirect: "error",
    });
  } catch {
    throw Error("连接失败或超时，请检查服务地址");
  }
  if (!res.ok)
    throw Error(`Provider 请求失败（HTTP ${res.status}），请检查配置或额度`);
  let p: any;
  try {
    p = await res.json();
  } catch {
    throw Error("Provider 返回无效 JSON");
  }
  const answer = p.choices?.[0]?.message?.content;
  if (typeof answer !== "string" || !answer.trim())
    throw Error("Provider 返回空回答");
  const citations = (Array.isArray(p.citations) ? p.citations : []).filter(
    (x: unknown) => typeof x === "string" && /^https?:\/\//.test(x),
  );
  return {
    answer,
    model: typeof p.model === "string" ? p.model : cfg.model,
    is_mock: false,
    tokens: p.usage || null,
    latency_ms: Date.now() - start,
    cost: null,
    citations,
  };
}
export function questionsPrompt(b: any) {
  return `${VERSION}\n品牌背景（仅用户提供，未核实）：${JSON.stringify(b)}\n推断类别并明确待确认。生成10条与类别相关的自然问题，覆盖${intents.join("、")}。7条DISCOVERY不得包含品牌名，3条BRANDED包含品牌名。格式：{"category":"推断类别","questions":[{"text":"问题","kind":"DISCOVERY或BRANDED","intent":"意图"}]}。`;
}
export function parseQuestions(answer: string) {
  let p: any;
  try {
    p = JSON.parse(answer.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw Error("问题生成结果不是有效 JSON，请重试");
  }
  if (
    !Array.isArray(p.questions) ||
    p.questions.length < 8 ||
    p.questions.length > 12 ||
    p.questions.some(
      (q: any) =>
        !q.text || !["DISCOVERY", "BRANDED"].includes(q.kind) || !q.intent,
    )
  )
    throw Error("问题必须为8–12条，且包含类型与意图");
  return p as { category: string; questions: Question[] };
}
