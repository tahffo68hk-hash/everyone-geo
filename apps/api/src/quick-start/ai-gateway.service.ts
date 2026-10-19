import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { AiProvider } from "@prisma/client";
import { assertPaidCallConfirmed } from "./quick-start.logic";
import { AiTask, buildSystemPrompt, supportsJsonOutput } from "./content-prompts";
import { ContentPlatform } from "./quick-start.constants";

export type { AiTask } from "./content-prompts";

export type AiCompletionRequest = {
  task: AiTask;
  provider: AiProvider;
  model?: string;
  platform?: ContentPlatform;
  prompt: string;
  context: Record<string, unknown>;
  confirmed: boolean;
  requestCount: number;
};

export type AiCompletionResult = {
  answer: string;
  provider: AiProvider;
  model: string;
  isMock: boolean;
  tokens: unknown | null;
  latencyMs: number;
  costEstimate: number | null;
};

const PROVIDER_CONFIG: Record<AiProvider, { model: string; baseUrl?: string; keyName?: string }> = {
  MOCK: { model: "geolens-mock-v1" },
  DEEPSEEK: {
    model: "deepseek-chat",
    baseUrl: "https://api.deepseek.com",
    keyName: "DEEPSEEK_API_KEY",
  },
  QWEN: {
    model: "qwen-plus",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    keyName: "DASHSCOPE_API_KEY",
  },
};

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function inferIndustry(name: string, website: string) {
  const source = `${name} ${website}`;
  if (/CRM|客户|销售管理/i.test(source)) return "CRM 与客户关系管理";
  if (/咖啡|茶饮|奶茶|餐饮/.test(source)) return "餐饮与饮品";
  if (/大学|教育|课程|培训|学校/.test(source)) return "教育与培训";
  if (/鞋|运动|户外/.test(source)) return "运动与户外用品";
  if (/手机|数码|电脑|硬件/.test(source)) return "消费电子与数码产品";
  if (/银行|保险|证券|金融/.test(source)) return "金融服务";
  if (/软件|云服务|SaaS|AI|人工智能|科技/i.test(source)) return "软件与科技服务";
  return "待确认的产品或服务";
}

function mockQuestions(context: Record<string, unknown>) {
  const brand = stringValue(context.brandName, "品牌");
  const industry = stringValue(context.industry, "产品与服务");
  const options = stringArray(context.competitors);
  return [
    { text: `选择${industry}时，应该先明确哪些需求？`, kind: "DISCOVERY", intent: "用户需求" },
    { text: `有哪些值得比较的${industry}方案？`, kind: "DISCOVERY", intent: "方案比较" },
    { text: `不同${industry}方案适合哪些使用场景？`, kind: "DISCOVERY", intent: "功能与使用场景" },
    { text: `初次了解${industry}，怎样判断方案是否适合自己？`, kind: "DISCOVERY", intent: "行业选择" },
    { text: `${industry}的成本通常应从哪些方面评估？`, kind: "DISCOVERY", intent: "价格与成本" },
    { text: `寻找${industry}服务时，有哪些证据值得优先核实？`, kind: "DISCOVERY", intent: "信息核实" },
    { text: `选择${industry}时有哪些常见误区？`, kind: "DISCOVERY", intent: "用户需求" },
    { text: `${brand}提供什么产品或服务，有哪些信息需要核实？`, kind: "BRANDED", intent: "品牌认知" },
    { text: `${brand}与${options[0] ?? "同类方案"}应从哪些维度比较？`, kind: "BRANDED", intent: "竞争对手" },
    { text: `决定是否选择${brand}之前，应核实哪些公开资料？`, kind: "BRANDED", intent: "购买或使用决策" },
  ];
}

function mockAnswer(context: Record<string, unknown>) {
  const brand = stringValue(context.brandName, "本次监测品牌");
  const industry = stringValue(context.industry, "相关产品与服务");
  const question = stringValue(context.question, "用户需求");
  const kind = stringValue(context.kind, "DISCOVERY");
  const index = Number(context.index ?? 0);
  const mention = kind === "BRANDED" ? index % 3 !== 0 : index % 2 === 0;
  const suffix = mention
    ? `本次模拟回答提到${brand}；其产品能力和适用范围仍需依据公开材料核实。`
    : "本次模拟回答未提及监测品牌，可进一步补充公开的产品说明和使用边界。";
  return `【模拟回答·未真实验证】围绕「${question}」，评估${industry}时可以先列出需求、使用场景和需要核对的公开证据。${suffix}`;
}

function mockSuggestions(context: Record<string, unknown>) {
  const responses = Array.isArray(context.responses) ? context.responses : [];
  const selected = responses
    .slice()
    .sort((left, right) => Number(left.brandMentioned) - Number(right.brandMentioned))
    .slice(0, Math.min(4, responses.length));
  return JSON.stringify({
    suggestions: selected.map((row, index) => {
      const item = (row ?? {}) as Record<string, unknown>;
      const queryText = stringValue(item.queryText, "本次监测问题");
      const mentioned = item.brandMentioned === true;
      return {
        title: `${mentioned ? "补充可信依据" : "优先填补未提及机会"}：${stringValue(item.intent, "用户问题")}`,
        action: `【模拟建议·未真实验证】围绕「${queryText}」整理公开可核实的产品信息、适用场景与限制，并在官网增加简明说明。本建议只对应本次回答样本，不代表排名提升。`,
        queryId: stringValue(item.queryId),
        responseId: stringValue(item.id),
        priority: index < 2 ? "优先" : "后续",
      };
    }),
  });
}

function mockContent(context: Record<string, unknown>) {
  const platform = stringValue(context.platform, "geo");
  const opportunity = stringValue(context.opportunity, "用户关心的问题");
  const topicText = opportunity.replace(/[？?。！!]+$/u, "").trim() || "用户关心的问题";
  const subject = stringValue(context.industry).trim() || topicText;
  const audience = stringValue(context.targetAudience).trim();
  const brandName = stringValue(context.brandName, "本企业");
  const brandDescription = stringValue(context.brandDescription);
  const products = stringArray(context.products);
  const profileFacts = [
    brandDescription.trim(),
    products.length ? `产品列表包括${products.join("、")}` : "",
  ].filter(Boolean);
  const profileSentence = profileFacts.length
    ? `\n\n${brandName}的品牌资料写明：${profileFacts.join("；")}。具体功能和适用范围仍应核对公开说明。`
    : "";
  const hasEnterpriseDetails = Boolean(brandDescription.trim() || products.length);
  const topic = `“${topicText}”`;
  let title = `${topicText}：先从实际需求开始核对`;
  let body = `判断${topic}相关方案时，可以先列出要解决的问题、使用场景和必须确认的服务边界。再把每项需求与企业公开说明逐一对应；资料没有说明的功能、价格或效果，先向企业核实。`;
  let videoScript: Record<string, unknown> | null = null;
  let hashtags = ["选择指南", "信息核实"];

  if (platform === "xiaohongshu") {
    title = `${audience ? `${audience}选` : "选"}${subject}，先梳理实际需求`;
    body = `如果你正在了解${topic}，先把日常最常遇到的场景写下来，再对照公开的产品说明逐项核对。\n\n比较时，重点看实际要完成的任务、使用人群和适用边界。简介没有说明的功能、价格或效果，先向企业确认。${profileSentence}`;
    hashtags = ["选择指南", "实用清单", "信息核实"];
  } else if (platform === "douyin") {
    const voiceover = `选${topic}时，先别只看功能列表。${audience ? `${audience}可以先` : "先"}把日常要做的事写下来，再核对产品说明是否覆盖。资料里没写清的价格、适用条件和效果，先向企业确认。`;
    title = `${subject}怎么选？先看${audience || "实际团队"}的工作场景`;
    body = voiceover;
    videoScript = {
      voiceover,
      shotSuggestions: ["镜头展示一张空白需求清单", "切到产品公开说明并逐项核对"],
    };
    hashtags = ["选择指南", "实用信息"];
  } else if (platform === "bilibili") {
    const narration = `围绕${topic}，先确定要解决的实际问题，再比较方案是否覆盖这些需要。\n\n接下来检查使用人群和适用边界，并把产品说明中没有写清的部分列出来，向企业核实。这样可以把需求、公开资料和待确认事项分开。`;
    title = `${subject}怎么选：从${audience || "实际需求"}到适用边界`;
    body = `本期围绕${topic}，整理一套从实际需求出发的核对思路。重点是如何比较公开说明、使用场景和待确认边界。${profileSentence}`;
    videoScript = {
      opening: `先从${topic}这个具体问题开始。`,
      narration,
      outline: [
        { heading: "先界定需求", keyPoints: ["列出要解决的问题", "对应日常使用场景"] },
        { heading: "核对公开资料", keyPoints: ["逐项对照产品说明", "单独记录资料缺口"] },
      ],
      ending: "把尚未确认的信息留给企业核实，再根据自身场景作决定。",
    };
    hashtags = ["知识分享", "选择指南"];
  }

  const riskNotes = hasEnterpriseDetails
    ? []
    : ["企业产品、服务、客户和使用场景资料尚未提供，本文按通用问题清单生成。"];
  return JSON.stringify({
    title,
    body,
    summary: `围绕${topicText}，从客户需求、公开资料和适用边界逐项核对。`,
    hashtags,
    videoScript,
    riskNotes,
    metadata: {
      coverSuggestion: `以“${opportunity}”为主题，展示需求与核对要点。`,
      mediaSuggestions: "需求清单、产品公开说明和适用边界；图片及其他素材由用户提供并审核。",
    },
  });
}

@Injectable()
export class AiGatewayService {
  defaultModel(provider: AiProvider) {
    return PROVIDER_CONFIG[provider].model;
  }

  providerStatus() {
    return (Object.keys(PROVIDER_CONFIG) as AiProvider[]).map((provider) => ({
      provider,
      model: PROVIDER_CONFIG[provider].model,
      configured:
        provider === "MOCK" || Boolean(process.env[PROVIDER_CONFIG[provider].keyName!]),
      label:
        provider === "MOCK"
          ? "Mock（模拟数据/未真实验证）"
          : provider === "DEEPSEEK"
            ? "DeepSeek"
            : "Qwen / DashScope",
    }));
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    const startedAt = Date.now();
    assertPaidCallConfirmed(request.provider, request.confirmed, request.requestCount);
    const model = request.model?.trim() || this.defaultModel(request.provider);

    if (request.provider === "MOCK") {
      const answer = this.mockResult(request.task, request.context);
      return {
        answer,
        provider: request.provider,
        model,
        isMock: true,
        tokens: null,
        latencyMs: Date.now() - startedAt,
        costEstimate: 0,
      };
    }

    const config = PROVIDER_CONFIG[request.provider];
    const apiKey = config.keyName ? process.env[config.keyName] : undefined;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        `${config.keyName} 未配置；本次请求没有发送到外部模型`,
      );
    }

    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: request.task === "content" ? 0.45 : 0.2,
          max_tokens: request.task === "content" ? 3600 : 1800,
          stream: false,
          ...(request.provider === "DEEPSEEK" && supportsJsonOutput(request.task)
            ? { response_format: { type: "json_object" } }
            : {}),
          messages: [
            {
              role: "system",
              content: buildSystemPrompt(request.task, request.platform),
            },
            { role: "user", content: request.prompt },
          ],
        }),
        signal: AbortSignal.timeout(45_000),
        redirect: "error",
      });
    } catch {
      throw new ServiceUnavailableException("模型连接失败或超时，请检查服务端配置");
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `模型请求失败（HTTP ${response.status}）；未自动重试`,
      );
    }

    let payload: {
      choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
      model?: unknown;
      usage?: unknown;
    };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new BadRequestException("模型返回了无效 JSON");
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new BadRequestException("模型返回结果结构无效");
    }
    const choice = payload.choices?.[0];
    if (choice?.finish_reason === "length") {
      throw new BadRequestException("模型输出达到长度上限，内容不完整；请缩短输入后重新生成");
    }
    const answer = choice?.message?.content;
    if (typeof answer !== "string" || answer.trim().length === 0) {
      throw new BadRequestException("模型没有返回可用内容");
    }

    return {
      answer,
      provider: request.provider,
      model: typeof payload.model === "string" ? payload.model : model,
      isMock: false,
      tokens: payload.usage ?? null,
      latencyMs: Date.now() - startedAt,
      costEstimate: null,
    };
  }

  private mockResult(task: AiTask, context: Record<string, unknown>) {
    if (task === "industry") {
      return JSON.stringify({
        industry: inferIndustry(
          stringValue(context.brandName),
          stringValue(context.website),
        ),
      });
    }
    if (task === "questions") {
      return JSON.stringify({ questions: mockQuestions(context) });
    }
    if (task === "answer") return mockAnswer(context);
    if (task === "suggestions") return mockSuggestions(context);
    return mockContent(context);
  }
}
