import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { performance } from "node:perf_hooks";
import { PrismaService } from "../prisma.service";
import { AI_PROMPTS, PROMPT_VERSIONS } from "./ai-prompt-registry";
import { AiProviderName } from "./dto/ai.dto";

export interface AiGatewayRequest<T = any> {
  organizationId: string;
  projectId?: string;
  userId?: string;

  feature: string;
  entityType?: string;
  entityId?: string;

  provider?: AiProviderName;
  model?: string;

  promptVersion: string;
  input: any;

  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;

  idempotencyKey?: string;
  parseJson?: boolean;
}

export interface AiGatewayResponse<T = any> {
  content: string;
  data?: T;

  provider: string;
  model: string;
  requestedModel: string;
  actualModel: string | null;

  promptVersion: string;

  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;

  estimatedCost: number | null;
  latencyMs: number;

  requestId: string | null;
  generationId?: string;

  startedAt: string;
  completedAt: string;
}

// In-flight debounce map: key = `${organizationId}:${feature}:${hash/idempotencyKey}`
const pendingRequests = new Map<string, Promise<AiGatewayResponse<any>>>();

@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 检查系统内当前配置的 Provider 状态（不泄露密钥）
   */
  getProviderStatus() {
    const dsKey = process.env.DEEPSEEK_API_KEY?.trim() || null;
    const qwenKey = process.env.QWEN_API_KEY?.trim() || null;
    const realEnabled = process.env.ENABLE_REAL_PROVIDERS === "true";

    return {
      realProvidersEnabled: realEnabled,
      providers: [
        {
          provider: "deepseek",
          configured: Boolean(dsKey && realEnabled),
          hasKey: Boolean(dsKey),
          defaultModel: process.env.DEEPSEEK_MODEL || "deepseek-chat",
          baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
        },
        {
          provider: "qwen",
          configured: Boolean(qwenKey && realEnabled),
          hasKey: Boolean(qwenKey),
          defaultModel: process.env.QWEN_MODEL || "qwen-plus",
          baseUrl: process.env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
        },
        {
          provider: "mock",
          configured: true,
          hasKey: true,
          defaultModel: "mock-ai-engine",
          baseUrl: "internal://mock",
        },
      ],
    };
  }

  /**
   * 核心结构化生成方法 generateStructured<T>()
   */
  async generateStructured<T = any>(req: AiGatewayRequest<T>): Promise<AiGatewayResponse<T>> {
    return this.generateInternal<T>({ ...req, parseJson: true });
  }

  /**
   * 文本生成方法 generateText()
   */
  async generateText(req: AiGatewayRequest<string>): Promise<AiGatewayResponse<string>> {
    return this.generateInternal<string>({ ...req, parseJson: false });
  }

  /**
   * 统一生成调度内核：路由、幂等防抖、重试、超时、审计入库
   */
  private async generateInternal<T>(req: AiGatewayRequest<T>): Promise<AiGatewayResponse<T>> {
    const startedAt = new Date();
    const startTimeMs = performance.now();

    // 防抖与幂等处理
    const debounceKey = req.idempotencyKey
      ? `${req.organizationId}:${req.feature}:${req.idempotencyKey}`
      : null;

    if (debounceKey && pendingRequests.has(debounceKey)) {
      this.logger.log(`[AiGateway] Reusing pending request for key: ${debounceKey}`);
      return pendingRequests.get(debounceKey)!;
    }

    const execPromise = (async () => {
      // 1. 获取 Prompt
      const promptDef = AI_PROMPTS[req.promptVersion];
      if (!promptDef) {
        throw new BadRequestException(`未知的 promptVersion: ${req.promptVersion}`);
      }

      const systemPrompt = promptDef.systemPrompt;
      const userPrompt = promptDef.buildUserPrompt(req.input);

      // 2. 解析目标 Provider
      const targetProvider = this.resolveProvider(req.provider);
      let response: {
        content: string;
        model: string;
        actualModel: string | null;
        inputTokens: number | null;
        outputTokens: number | null;
        totalTokens: number | null;
        estimatedCost: number | null;
        requestId: string | null;
      };

      let status = "SUCCESS";
      let errorCode: string | undefined;
      let errorMessage: string | undefined;

      try {
        if (targetProvider === "mock") {
          response = await this.executeMock<T>(req.feature, req.input, req.model || "mock-ai-engine");
        } else if (targetProvider === "deepseek") {
          response = await this.executeDeepSeek(systemPrompt, userPrompt, req.model, req.temperature, req.maxTokens, req.timeoutMs);
        } else if (targetProvider === "qwen") {
          response = await this.executeQwen(systemPrompt, userPrompt, req.model, req.temperature, req.maxTokens, req.timeoutMs);
        } else {
          throw new BadRequestException(`不支持的 Provider: ${targetProvider}`);
        }
      } catch (err: any) {
        status = "FAILED";
        errorCode = err?.name || "AI_GENERATION_FAILED";
        errorMessage = err?.message || String(err);

        // 记录失败审计
        await this.recordAudit({
          organizationId: req.organizationId,
          projectId: req.projectId,
          userId: req.userId,
          feature: req.feature,
          entityType: req.entityType,
          entityId: req.entityId,
          provider: targetProvider,
          model: req.model || "unknown",
          requestedModel: req.model || "unknown",
          promptVersion: req.promptVersion,
          inputSnapshot: req.input,
          outputSnapshot: null,
          status,
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          estimatedCost: null,
          latencyMs: Math.round(performance.now() - startTimeMs),
          errorCode,
          errorMessage,
          createdAt: startedAt,
          completedAt: new Date(),
        });

        throw err;
      }

      const latencyMs = Math.round(performance.now() - startTimeMs);
      const completedAt = new Date();

      // 3. 结构化 JSON 解析与校验
      let parsedData: T | undefined = undefined;
      if (req.parseJson) {
        try {
          parsedData = this.cleanAndParseJson<T>(response.content);
        } catch (err: any) {
          status = "FAILED";
          errorCode = "JSON_PARSE_ERROR";
          errorMessage = `大模型输出未能解析为有效 JSON: ${err.message}`;

          await this.recordAudit({
            organizationId: req.organizationId,
            projectId: req.projectId,
            userId: req.userId,
            feature: req.feature,
            entityType: req.entityType,
            entityId: req.entityId,
            provider: targetProvider,
            model: response.model,
            requestedModel: req.model || response.model,
            promptVersion: req.promptVersion,
            inputSnapshot: req.input,
            outputSnapshot: { rawContent: response.content },
            status,
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
            totalTokens: response.totalTokens,
            estimatedCost: response.estimatedCost,
            latencyMs,
            errorCode,
            errorMessage,
            createdAt: startedAt,
            completedAt,
          });

          throw new BadRequestException(errorMessage);
        }
      }

      // 4. 成功入库审计
      const auditRow = await this.recordAudit({
        organizationId: req.organizationId,
        projectId: req.projectId,
        userId: req.userId,
        feature: req.feature,
        entityType: req.entityType,
        entityId: req.entityId,
        provider: targetProvider,
        model: response.model,
        requestedModel: req.model || response.model,
        promptVersion: req.promptVersion,
        inputSnapshot: req.input,
        outputSnapshot: parsedData ? (parsedData as any) : { content: response.content },
        status: "SUCCESS",
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        totalTokens: response.totalTokens,
        estimatedCost: response.estimatedCost,
        latencyMs,
        createdAt: startedAt,
        completedAt,
      });

      return {
        content: response.content,
        data: parsedData,
        provider: targetProvider,
        model: response.model,
        requestedModel: req.model || response.model,
        actualModel: response.actualModel,
        promptVersion: req.promptVersion,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        totalTokens: response.totalTokens,
        estimatedCost: response.estimatedCost,
        latencyMs,
        requestId: response.requestId,
        generationId: auditRow?.id,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
      };
    })();

    if (debounceKey) {
      pendingRequests.set(debounceKey, execPromise);
      execPromise.finally(() => {
        pendingRequests.delete(debounceKey);
      });
    }

    return execPromise;
  }

  /**
   * 解析目标 Provider，支持 auto 自适应路由
   */
  private resolveProvider(requested?: AiProviderName): "deepseek" | "qwen" | "mock" {
    // 单元测试与 E2E 默认使用 mock，除非显式指定
    const isTest = process.env.NODE_ENV === "test";
    if (isTest && (!requested || requested === "mock" || requested === "auto")) {
      return "mock";
    }

    if (requested && requested !== "auto") {
      if (requested === "mock") return "mock";
      if (requested === "deepseek") {
        if (!process.env.DEEPSEEK_API_KEY) {
          throw new ServiceUnavailableException("DeepSeek API Key 未配置");
        }
        return "deepseek";
      }
      if (requested === "qwen") {
        if (!process.env.QWEN_API_KEY) {
          throw new ServiceUnavailableException("Qwen API Key 未配置");
        }
        return "qwen";
      }
    }

    // auto: 按可用度优先选择
    if (process.env.ENABLE_REAL_PROVIDERS === "true") {
      if (process.env.DEEPSEEK_API_KEY?.trim()) return "deepseek";
      if (process.env.QWEN_API_KEY?.trim()) return "qwen";
    }

    return "mock";
  }

  /**
   * 真实调用 DeepSeek API (带有限重试与超时控制)
   */
  private async executeDeepSeek(
    systemPrompt: string,
    userPrompt: string,
    modelOverride?: string,
    temperature = 0.7,
    maxTokens = 4096,
    timeoutMs = 45000,
  ) {
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) throw new ServiceUnavailableException("DeepSeek API Key 未配置");

    const baseUrl = (process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, "");
    const model = modelOverride?.trim() || process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";

    return this.callOpenAiCompatibleApi({
      provider: "deepseek",
      url: `${baseUrl}/chat/completions`,
      apiKey,
      model,
      systemPrompt,
      userPrompt,
      temperature,
      maxTokens,
      timeoutMs,
      // DeepSeek 费用估算: $0.14 / 1M prompt, $0.28 / 1M completion
      costPerInputToken: 0.00000014,
      costPerOutputToken: 0.00000028,
    });
  }

  /**
   * 真实调用 Qwen (DashScope 兼容接口)
   */
  private async executeQwen(
    systemPrompt: string,
    userPrompt: string,
    modelOverride?: string,
    temperature = 0.7,
    maxTokens = 4096,
    timeoutMs = 45000,
  ) {
    const apiKey = process.env.QWEN_API_KEY?.trim();
    if (!apiKey) throw new ServiceUnavailableException("Qwen API Key 未配置");

    const baseUrl = (process.env.QWEN_BASE_URL?.trim() || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/+$/, "");
    const model = modelOverride?.trim() || process.env.QWEN_MODEL?.trim() || "qwen-plus";

    return this.callOpenAiCompatibleApi({
      provider: "qwen",
      url: `${baseUrl}/chat/completions`,
      apiKey,
      model,
      systemPrompt,
      userPrompt,
      temperature,
      maxTokens,
      timeoutMs,
      // Qwen Plus 估算: $0.0008 / 1k input ($0.0000008/token), $0.002 / 1k output ($0.000002/token)
      costPerInputToken: 0.0000008,
      costPerOutputToken: 0.000002,
    });
  }

  /**
   * OpenAI-compatible 通用 HTTP 请求驱动器
   */
  private async callOpenAiCompatibleApi(params: {
    provider: string;
    url: string;
    apiKey: string;
    model: string;
    systemPrompt: string;
    userPrompt: string;
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
    costPerInputToken: number;
    costPerOutputToken: number;
  }) {
    const maxRetries = 2;
    let attempt = 0;
    let lastError: any = null;

    while (attempt <= maxRetries) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), params.timeoutMs);

      try {
        const payload = {
          model: params.model,
          messages: [
            { role: "system", content: params.systemPrompt },
            { role: "user", content: params.userPrompt },
          ],
          temperature: params.temperature,
          max_tokens: params.maxTokens,
          stream: false,
        };

        const res = await fetch(params.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${params.apiKey}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!res.ok) {
          const status = res.status;
          const errBody = await res.text().catch(() => "");
          this.logger.warn(`[${params.provider}] API returned ${status}: ${errBody.slice(0, 300)}`);

          if (status === 401 || status === 403) {
            throw new ServiceUnavailableException(`${params.provider} API 密钥无效或未授权`);
          }
          if (status === 429) {
            if (attempt <= maxRetries) {
              await new Promise((r) => setTimeout(r, attempt * 1000));
              continue;
            }
            throw new ServiceUnavailableException(`${params.provider} API 速率受限 (429)，请稍后重试`);
          }
          if (status >= 500 && attempt <= maxRetries) {
            await new Promise((r) => setTimeout(r, attempt * 800));
            continue;
          }
          throw new ServiceUnavailableException(`${params.provider} 调用失败 (HTTP ${status})`);
        }

        const data: any = await res.json();
        const choice = data?.choices?.[0];
        const content = choice?.message?.content || "";
        const actualModel = data?.model || null;

        const usage = data?.usage;
        const inputTokens = usage?.prompt_tokens ?? null;
        const outputTokens = usage?.completion_tokens ?? null;
        const totalTokens = usage?.total_tokens ?? null;

        let estimatedCost: number | null = null;
        if (inputTokens != null && outputTokens != null) {
          estimatedCost = Number(
            (inputTokens * params.costPerInputToken + outputTokens * params.costPerOutputToken).toFixed(6),
          );
        }

        return {
          content,
          model: params.model,
          actualModel,
          inputTokens,
          outputTokens,
          totalTokens,
          estimatedCost,
          requestId: data?.id || null,
        };
      } catch (err: any) {
        clearTimeout(timer);
        lastError = err;
        if (err.name === "AbortError" || err.name === "TimeoutError") {
          throw new ServiceUnavailableException(`${params.provider} 调用超时 (${params.timeoutMs}ms)`);
        }
        if (attempt <= maxRetries && (err.code === "ECONNRESET" || err.code === "ETIMEDOUT")) {
          await new Promise((r) => setTimeout(r, attempt * 1000));
          continue;
        }
        throw err;
      }
    }

    throw lastError || new InternalServerErrorException("重试后仍然失败");
  }

  /**
   * 确定性 Mock Provider：用于单元测试与未配置真实环境时的零成本模拟
   */
  private async executeMock<T>(feature: string, input: any, modelName: string) {
    let mockContent = "";

    switch (feature) {
      case "query_set_generation": {
        const brand = input.brandName || "品牌";
        const cat = input.category || "企业管理软件";
        mockContent = JSON.stringify({
          querySetName: `${brand} 核心 GEO 评估问题集`,
          description: `基于 ${cat} 领域与核心业务场景生成的代表性问答集合`,
          queries: [
            {
              text: `2026年适合中大型企业的${cat}推荐`,
              category: "行业选型",
              intent: "COMMERCIAL",
              queryType: "DISCOVERY",
              rationale: "发现型选型问题，严格不含品牌名",
            },
            {
              text: `如何评估一款${cat}的实际投资回报率与落地成本？`,
              category: "痛点解决",
              intent: "INFORMATIONAL",
              queryType: "DISCOVERY",
              rationale: "真实决策痛点提问，无品牌词",
            },
            {
              text: `市面上主流${cat}对比横评与选型避坑指南`,
              category: "竞品对比",
              intent: "COMMERCIAL",
              queryType: "DISCOVERY",
              rationale: "客观中立横评对比，无品牌词",
            },
            {
              text: `${brand}怎么样？主要优缺点与适用场景有哪些？`,
              category: "品牌基线",
              intent: "INFORMATIONAL",
              queryType: "BRANDED",
              rationale: "品牌基线提问，用于探测大模型直接认知",
            },
            {
              text: `${brand}和市面上其他${cat}相比有什么特色功能？`,
              category: "品牌基线",
              intent: "COMMERCIAL",
              queryType: "BRANDED",
              rationale: "品牌基线对比",
            },
          ],
        });
        break;
      }

      case "query_expansion": {
        mockContent = JSON.stringify({
          expandedQueries: [
            {
              text: "预算有限的小团队适合选择哪种轻量级解决方案？",
              category: "长尾选型",
              intent: "COMMERCIAL",
              queryType: "DISCOVERY",
              rationale: "覆盖价格敏感长尾用户",
            },
            {
              text: "在私有化部署场景下，各厂商的数据安全合规性如何保障？",
              category: "场景痛点",
              intent: "INFORMATIONAL",
              queryType: "DISCOVERY",
              rationale: "深度企业级场景提问",
            },
            {
              text: "有哪些替代传统笨重系统的现代智能化新工具？",
              category: "替代方案",
              intent: "DISCOVERY",
              queryType: "DISCOVERY",
              rationale: "方案探索提问",
            },
          ],
        });
        break;
      }

      case "query_rewrite": {
        mockContent = JSON.stringify({
          originalQuery: input.queryText,
          rewrittenQueries: [
            {
              text: `求推荐靠谱的解决方案，${input.queryText} 真实体验如何？`,
              explanation: "更加口语化，激发 AI 搜索深度回答",
              targetIntent: "natural",
            },
            {
              text: `${input.queryText} 关键选型指标与行业对比分析`,
              explanation: "强化专业决策维度，利于提炼表格与要点",
              targetIntent: "decision",
            },
          ],
        });
        break;
      }

      case "query_classify": {
        mockContent = JSON.stringify({
          intent: "COMMERCIAL",
          category: "行业选型",
          queryType: input.queryText?.includes("品牌") ? "BRANDED" : "DISCOVERY",
          confidence: 0.92,
          rationale: "该提问反映了用户在购买决策前的选型诉求",
        });
        break;
      }

      case "geo_topic_detection": {
        mockContent = JSON.stringify({
          coreTopics: ["企业效能优化", "智能化决策", "数据资产沉淀"],
          geoTopics: [
            {
              name: "ROI 计算模型",
              description: "AI 搜索常引用的投入产出衡量维度",
              userIntent: "选型验证",
              importance: "HIGH",
            },
            {
              name: "架构平滑迁移",
              description: "系统替换过程中的兼容性关注",
              userIntent: "实施评估",
              importance: "MEDIUM",
            },
          ],
          entities: [
            {
              name: input.brandName || "AcmeBrand",
              type: "BRAND",
              aliases: ["Acme", "AcmeFlow"],
            },
          ],
          comparisonDimensions: ["响应延迟", "合规安全", "落地周期"],
          decisionDimensions: ["年费性价比", "团队上手难度", "售后支持"],
        });
        break;
      }

      case "geo_keyword_extraction": {
        mockContent = JSON.stringify({
          keywords: [
            {
              keyword: "智能化决策中枢",
              type: "CONCEPT",
              intent: "COMMERCIAL",
              importance: "HIGH",
              reason: "核心品类高频意图词",
              relatedQueries: ["如何构建智能化决策中枢"],
            },
            {
              keyword: "多模态数据分析",
              type: "ENTITY",
              intent: "INFORMATIONAL",
              importance: "MEDIUM",
              reason: "技术架构实体词",
              relatedQueries: ["多模态分析在B端落地案例"],
            },
          ],
        });
        break;
      }

      case "geo_keyword_gap": {
        mockContent = JSON.stringify({
          gaps: [
            {
              topic: "离线部署合规性",
              entity: "国产信创环境适配",
              gapType: "TOPIC_GAP",
              rationale: "竞品高频提及但本品尚未建立充分内容覆盖",
              recommendedQueries: ["主流系统在国产化环境下的部署表现"],
              suggestedContentType: "技术白皮书与部署指南",
            },
          ],
          disclaimer: "AI semantic analysis",
        });
        break;
      }

      case "geo_clustering": {
        mockContent = JSON.stringify({
          clusters: [
            {
              clusterName: "技术架构与安全",
              intent: "INFORMATIONAL",
              members: (input.items || []).slice(0, 2),
              recommendedUse: "用于撰写深度技术白皮书",
            },
            {
              clusterName: "成本效益与选型",
              intent: "COMMERCIAL",
              members: (input.items || []).slice(2),
              recommendedUse: "用于横评指南与落地案例",
            },
          ],
        });
        break;
      }

      case "diagnosis_explanation": {
        mockContent = JSON.stringify({
          summary: "在发现型选型问题中品牌整体提及度偏低，主要缺少高权重的行业横评第三方引用。",
          explanation: "诊断表明竞品凭借多篇结构化对比指南获得了大模型搜索的高频首要推荐，而本品内容主要集中在官网产品介绍，缺乏外部佐证。",
          keyFindings: [
            {
              point: "客观横评内容覆盖不足",
              impact: "HIGH",
              reason: "AI 搜索引擎优先引用中立评测源",
            },
          ],
          supportingEvidenceIds: [],
          limitations: ["基于系统当前采集的证据快照分析，不代表全网所有时刻的状态"],
        });
        break;
      }

      case "recommendation_draft": {
        mockContent = JSON.stringify({
          title: "发布中立多维度的品类选型指南与实施避坑手册",
          problem: "核心发现型提问中缺少 Answer-first 类型的结构化对比解答",
          action: "在知乎及专业行业媒体发布包含本品及主流竞品对比的客观横评指南",
          expectedObservableSignal: "在行业选型问题下被 AI 引擎作为引用信源检索到并呈现正面结论",
          priorityRationale: "选型类问题的转化意图最高，且目前该维度差距最明显",
          dependencies: ["完成产品核心参数与竞品横向比对表"],
          risks: ["需严格确保竞品数据客观属实，避免合规争议"],
        });
        break;
      }

      case "opportunity_draft": {
        mockContent = JSON.stringify({
          title: "攻占『企业级选型指南』核心高频提问",
          objective: "建立品牌在专业选型场景下的权威 Answer 占位",
          problemStatement: "目前大模型优先向用户呈现竞品方案，本品牌存在明显的能见度真空",
          priorityQueries: input.targetQueries || ["2026年企业级选型推荐"],
          suggestedContentAngle: "主打中立横评与成本效益细致拆解",
          estimatedEffort: "MEDIUM",
        });
        break;
      }

      case "strategy_draft": {
        mockContent = JSON.stringify({
          objective: input.objective || "提升重点商业提问下的 AI 引用率与首推占比",
          priorityQuestions: input.targetQueries || ["如何选择最适合的解决方案"],
          targetAudiences: [input.audience || "企业技术主管与业务决策人"],
          contentDirections: [
            {
              name: "专业横评与选型工具包",
              description: "包含细分场景评估表与参数对比",
              targetChannels: ["知乎", "微信公众号", "官网博客"],
            },
          ],
          successObservationPlan: ["每周自动化复测目标提问下的引用变化与情感倾向"],
          risks: ["内容过载或过度营销化导致 AI 识别为低质量广告"],
        });
        break;
      }

      case "campaign_draft": {
        mockContent = JSON.stringify({
          campaignName: "Q3 行业先锋 GEO 攻坚战役",
          objective: "针对 5 个高价值选型问题建立高质量引用内容矩阵",
          targetQueries: input.targetQueries || ["适合中大型团队的系统对比"],
          contentPlan: [
            {
              title: "深度横评：主流系统的多维指标全景测试",
              format: "COMPARISON",
              targetChannel: "知乎",
              scheduledWeek: "W1",
              keyAngle: "实测数据与架构对比",
            },
          ],
          channelSuggestions: ["知乎", "掘金", "微信公众号"],
          milestones: [
            { milestone: "完成横评内容撰写与内部核对", targetDateHint: "第 3 天" },
            { milestone: "多渠道同步并触发复测验证", targetDateHint: "第 10 天" },
          ],
        });
        break;
      }

      case "content_brief": {
        mockContent = JSON.stringify({
          titleIdeas: ["2026全景选型指南：一文搞懂核心技术与成本对比"],
          contentObjective: "为 AI 搜索引擎提供直接引用的权威 Answer 格式解答",
          targetAudience: input.audience || "技术总监与选型委员会",
          questionsToAnswer: input.targetQueries || ["主流工具该怎么选？"],
          keyEntities: ["私有化交付", "自动化审计", "高并发吞吐"],
          outline: ["引言与核心结论", "三套主流方案横评表", "实测性能指标拆解", "常见落地误区 FAQ"],
          evidenceRequirements: ["附带测试环境配置与基准分位图"],
          citationRequirements: ["标注开源基准与官方公开发布文档"],
          cta: "下载完整架构白皮书或预约演示",
        });
        break;
      }

      case "content_titles": {
        mockContent = JSON.stringify({
          titles: [
            {
              title: `${input.topic}：2026 深度横评与选型决策指南`,
              style: "GUIDE",
              rationale: "权威长尾标题，易被大模型收录为选型核心信源",
            },
            {
              title: `如何评价 ${input.topic}？核心优缺点与避坑全解读`,
              style: "DIRECT_ANSWER",
              rationale: "符合用户在知乎与社区的自然问法",
            },
          ],
        });
        break;
      }

      case "content_outline": {
        mockContent = JSON.stringify({
          outline: [
            {
              section: "1. 核心结论与选型决策矩阵 (Answer-First)",
              subpoints: ["一分钟速览：各方案推荐人群", "核心参数横向对比总表"],
              intentToSatisfy: "满足快速获取结论的商业选型意图",
            },
            {
              section: "2. 架构设计与性能实测分析",
              subpoints: ["测试指标与硬件基线", "吞吐与延迟数据表现"],
              intentToSatisfy: "满足技术专家对事实依据的深度探究",
            },
            {
              section: "3. 常见问题解答 (FAQ)",
              subpoints: ["部署周期需要多久？", "如何实现存量数据无损迁移？"],
              intentToSatisfy: "满足落地细节疑虑",
            },
          ],
        });
        break;
      }

      case "content_draft": {
        mockContent = JSON.stringify({
          title: input.title || "企业智能化升级实践指南",
          body: `# ${input.title || "企业智能化升级实践指南"}\n\n## 核心结论 (Answer-First)\n在选择现代企业级解决方案时，核心应评估系统的**数据自治性**、**扩展敏捷度**与**全生命周期 TCO**。\n\n## 深度对比与架构拆解\n根据多项工程实践，采用模块化解耦架构可缩短约 40% 的实施周期。\n\n## 常见问答 (FAQ)\n### 问：系统适合多大规模的团队？\n答：支持 50 至 5000 人的跨部门协同，具备弹性伸缩能力。`,
          summary: "本文系统拆解了企业智能化选型的核心考量，提供清晰的决策矩阵与 FAQ。",
          tags: ["技术选型", "系统架构", "GEO优化"],
          faqSection: [
            {
              question: "实施周期通常需要多久？",
              answer: "标准模块化部署可在 2 周内完成初版上线，平滑替代旧有流程。",
            },
          ],
        });
        break;
      }

      case "content_rewrite": {
        mockContent = JSON.stringify({
          originalContent: input.content,
          rewrittenContent: `【优化重写】\n${input.content}\n\n**核心精简要点**：\n1. 采用直接回答格式，前置关键结论。\n2. 明确标注了技术实体与指标，便于 AI 引擎快速提取。`,
          changeSummary: "增强了段落首句的总结性，增加了结构化列表以便大模型解析。",
          diffHighlights: ["重构了导言段落为直接结论", "增加了加粗实体与要点分点"],
        });
        break;
      }

      case "content_geo_opt": {
        mockContent = JSON.stringify({
          missingQuestions: ["尚未直接回答『部署成本具体由哪些部分构成』"],
          missingEntities: ["缺少行业标准指标（如 MTTD、MTTR、QPS）的明确定义"],
          missingFacts: ["引用了泛化的『性能优异』，缺少可量化的基准分值"],
          structuralFeedback: ["建议在第二小节增加一个清晰的横向对比表格"],
          suggestedFaq: [
            {
              question: "与其他传统方案的主要技术差异是什么？",
              answer: "主要差异在于采用了全新的事件驱动流水线架构，显著降低了长链路等待时间。",
            },
          ],
          optimizedContent: `${input.content}\n\n### 补充核心要点说明\n在实际评估中，建议重点考量具体吞吐量指标与行业标准合规项。`,
        });
        break;
      }

      case "content_faq": {
        mockContent = JSON.stringify({
          faqs: [
            {
              question: "这款方案与其他主流方案的核心差异是什么？",
              answer: "核心差异体现在更轻量级的部署要求与开箱即用的智能化编排能力。",
              userIntent: "COMMERCIAL_EVALUATION",
            },
            {
              question: "是否支持私有化与合规审计？",
              answer: "完整支持本地容器化交付与企业级 RBAC 审计追踪。",
              userIntent: "COMPLIANCE_CHECK",
            },
          ],
        });
        break;
      }

      case "fact_risk_scan": {
        mockContent = JSON.stringify({
          claims: [
            {
              claim: "性能大幅超越市面所有同类方案",
              riskLevel: "HIGH",
              needsEvidence: true,
              reason: "绝对化陈述，容易引起合规质疑或被搜索引擎降权",
            },
          ],
          overallRisk: "MEDIUM",
          suggestions: ["将『超越所有同类』修改为『在特定基准测试场景下展现出明显的响应优势』并补充测试条件"],
        });
        break;
      }

      case "competitor_candidates": {
        mockContent = JSON.stringify({
          candidates: [
            {
              name: "AcmeCompetitor",
              aliases: ["竞品A", "ACComp"],
              category: "行业直接竞品",
              reasonDetected: "在证据和用户提问的横向对比中多次并列出现",
            },
          ],
        });
        break;
      }

      case "outcome_summary": {
        mockContent = JSON.stringify({
          summary: "本次效果验证表明，在目标查询下的整体表现呈现积极关联，基线与复测指标均有改善。",
          majorChanges: ["核心提问中的品牌正面提及频率提升", "AI 回答新增了对本品横评信源的直接引用"],
          observedTrends: ["长尾问题改善显著，高竞争度头部问题仍有提升空间"],
          disclaimer: "基于系统观测事实的自然语言解读，非额外推导",
        });
        break;
      }

      case "attribution_explanation": {
        const status = input.attributionStatus || "LIKELY_RELATED";
        mockContent = JSON.stringify({
          explanation: `系统归因判定为【${status}】。在内容发布后的观测窗口内，复测指标与基线相比表现出正向关联，且尚未检测到显著的外部强干扰因素。`,
          keyFactors: ["内容发布时间与可见度改善存在时间连续性", "引用的关键词与发布素材高度契合"],
          confoundingNotes: input.confounders?.length ? ["存在少量并发变动需持续观察"] : ["未观测到重大并发混淆事件"],
          attributionStatusNotice: "系统基于事实关联度给出归因倾向，保持保守因果边界，非绝对确定性证明",
        });
        break;
      }

      case "report_summary": {
        mockContent = JSON.stringify({
          executiveSummary: "本周期项目在目标 GEO 提问中的综合表现保持稳健，在专业选型场景中具备较好提及率。",
          keyFindings: ["发现型长尾问题是当前的优势阵地", "对比型提问仍被行业权威评测站主导"],
          evidenceLimitations: ["受测试引擎每日波动影响，单点得分建议结合 7 日均线综合研判"],
          recommendedNextSteps: ["针对竞品占优的 3 个核心提问增加更深入的 FAQ 与案例内容"],
        });
        break;
      }

      case "learning_summary": {
        const count = input.sampleCount || 0;
        const isSingleOrLow = count < 3;
        mockContent = JSON.stringify({
          patternExplanation: isSingleOrLow
            ? "当前关联样本量不足（<3），仅为偶发观察，无法判定为稳定规律。"
            : `基于 ${count} 次关联样本的聚合分析，在类似场景下发布结构化横评内容通常可观测到正向效果改善。`,
          scopeOfApplicability: isSingleOrLow ? ["不适用任何规律推广"] : ["适用于中大型企业决策类提问"],
          limitations: ["大模型底座策略更新可能使观察到的模式在未来产生偏移"],
          testableHypotheses: ["在下一批同类提问中继续应用相同结构的 Answer 内容验证其复现率"],
          singleSampleWarning: isSingleOrLow ? "样本量不足 3 次，严禁将本次结果作为『最佳实践』直接规模化推广！" : "",
        });
        break;
      }

      case "learning_actions": {
        mockContent = JSON.stringify({
          proposedActions: [
            {
              action: "为低表现但高转化的选型问题补充 Answer-First 结构的对比说明",
              why: "前期观察显示结构化回答更容易被 AI 引擎解析采纳",
              supportingPattern: input.patternSummary || "样本观察模式",
              risks: "需持续跟踪外部引擎是否收录更新",
              whatToMeasureNext: "发布后 7 天内的首次引用时间与提及位置",
            },
          ],
          disclaimer: "Draft suggestion only - requires user review",
        });
        break;
      }

      default: {
        mockContent = JSON.stringify({
          message: `AI generation completed for feature: ${feature}`,
          feature,
          timestamp: new Date().toISOString(),
        });
        break;
      }
    }

    return {
      content: mockContent,
      model: modelName,
      actualModel: modelName,
      inputTokens: 120,
      outputTokens: 280,
      totalTokens: 400,
      estimatedCost: 0,
      requestId: `mock-${Date.now()}`,
    };
  }

  /**
   * 清理代码块并安全解析 JSON
   */
  private cleanAndParseJson<T>(raw: string): T {
    let clean = raw.trim();
    // 清除 markdown 代码块包围
    if (clean.startsWith("```json")) {
      clean = clean.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
    } else if (clean.startsWith("```")) {
      clean = clean.replace(/^```\s*/i, "").replace(/\s*```$/, "");
    }
    clean = clean.trim();

    try {
      return JSON.parse(clean) as T;
    } catch (e: any) {
      // 容错处理：寻找第一个 { 和最后一个 } 或第一个 [ 和最后一个 ]
      const firstBrace = clean.indexOf("{");
      const lastBrace = clean.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const candidate = clean.slice(firstBrace, lastBrace + 1);
        try {
          return JSON.parse(candidate) as T;
        } catch {}
      }

      const firstBracket = clean.indexOf("[");
      const lastBracket = clean.lastIndexOf("]");
      if (firstBracket !== -1 && lastBracket > firstBracket) {
        const candidate = clean.slice(firstBracket, lastBracket + 1);
        try {
          return JSON.parse(candidate) as T;
        } catch {}
      }

      throw e;
    }
  }

  /**
   * 写入 AI 生成审计记录 (AiGeneration)
   * 严禁保存 API Key 等机密
   */
  private async recordAudit(data: {
    organizationId: string;
    projectId?: string;
    userId?: string;
    feature: string;
    entityType?: string;
    entityId?: string;
    provider: string;
    model: string;
    requestedModel?: string;
    promptVersion: string;
    inputSnapshot?: any;
    outputSnapshot?: any;
    status: string;
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    estimatedCost?: number | null;
    latencyMs?: number | null;
    errorCode?: string;
    errorMessage?: string;
    createdAt: Date;
    completedAt?: Date;
  }) {
    try {
      // 敏感数据安全清洗
      const safeInput = data.inputSnapshot ? this.sanitizeSnapshot(data.inputSnapshot) : undefined;
      const safeOutput = data.outputSnapshot ? this.sanitizeSnapshot(data.outputSnapshot) : undefined;

      return await this.prisma.client.aiGeneration.create({
        data: {
          organizationId: data.organizationId,
          projectId: data.projectId || null,
          userId: data.userId || null,
          feature: data.feature,
          entityType: data.entityType || null,
          entityId: data.entityId || null,
          provider: data.provider,
          model: data.model,
          requestedModel: data.requestedModel || null,
          promptVersion: data.promptVersion,
          inputSnapshot: safeInput,
          outputSnapshot: safeOutput,
          status: data.status,
          inputTokens: data.inputTokens ?? null,
          outputTokens: data.outputTokens ?? null,
          totalTokens: data.totalTokens ?? null,
          estimatedCost: data.estimatedCost != null ? (data.estimatedCost as any) : null,
          latencyMs: data.latencyMs ?? null,
          errorCode: data.errorCode || null,
          errorMessage: data.errorMessage || null,
          createdAt: data.createdAt,
          completedAt: data.completedAt || new Date(),
        },
      });
    } catch (auditErr: any) {
      this.logger.error(`Failed to record AI generation audit: ${auditErr.message}`);
      return null;
    }
  }

  /**
   * 递归清理 snapshot 中潜在的敏感字段
   */
  private sanitizeSnapshot(obj: any): any {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map((i) => this.sanitizeSnapshot(i));

    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      const lk = k.toLowerCase();
      if (lk.includes("key") || lk.includes("secret") || lk.includes("token") || lk.includes("auth") || lk.includes("password")) {
        result[k] = "[REDACTED]";
      } else if (typeof v === "object") {
        result[k] = this.sanitizeSnapshot(v);
      } else {
        result[k] = v;
      }
    }
    return result;
  }
}
