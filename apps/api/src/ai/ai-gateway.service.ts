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
import { AiAuditService } from "./ai-audit.service";
import { generateMockFixture } from "./ai-mock-fixtures";

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
  requestedProvider: AiProviderName;
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

import {
  AI_MODEL_PRICING,
  calculateEstimatedCost,
  type ModelPricing,
  InteractiveRuntime,
  LLMProviderError,
  ProviderDisabledError,
  ProviderNotConfiguredError,
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderServerError,
  ProviderNetworkError,
  ProviderTimeoutError,
} from "@geo/llm";
import { validateCapabilityOutput } from "./contracts";

export { AI_MODEL_PRICING, calculateEstimatedCost, type ModelPricing };

// In-flight debounce map: key = `${organizationId}:${feature}:${hash/idempotencyKey}`
const pendingRequests = new Map<string, Promise<AiGatewayResponse<any>>>();

@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);
  private readonly runtime = new InteractiveRuntime();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AiAuditService,
  ) {}


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
          configured: Boolean(dsKey),
          enabled: Boolean(dsKey && realEnabled),
          hasKey: Boolean(dsKey),
          realModeAllowed: Boolean(dsKey && realEnabled),
          availability: dsKey ? (realEnabled ? "not_checked" : "disabled") : "missing",
          lastErrorCode: null,
          defaultModel: process.env.DEEPSEEK_MODEL || "deepseek-chat",
          baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
        },
        {
          provider: "qwen",
          configured: Boolean(qwenKey),
          enabled: Boolean(qwenKey && realEnabled),
          hasKey: Boolean(qwenKey),
          realModeAllowed: Boolean(qwenKey && realEnabled),
          availability: qwenKey ? (realEnabled ? "not_checked" : "disabled") : "missing",
          lastErrorCode: null,
          defaultModel: process.env.QWEN_MODEL || "qwen-plus",
          baseUrl: process.env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
        },
        {
          provider: "mock",
          configured: true,
          enabled: true,
          hasKey: true,
          realModeAllowed: false,
          availability: "available",
          lastErrorCode: null,
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
      const isAuto = !req.provider || req.provider === "auto";
      let targetProvider: "deepseek" | "qwen" | "mock";
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

      let activeProvider: "deepseek" | "qwen" | "mock" | "auto" = req.provider && req.provider !== "auto" ? req.provider : "auto";
      let status = "SUCCESS";
      let errorCode: string | undefined;
      let errorMessage: string | undefined;

      try {
        targetProvider = this.resolveProvider(req.provider);
        activeProvider = targetProvider;
        if (targetProvider === "mock") {
          response = generateMockFixture(req.feature, req.input, req.model || "mock-ai-engine");
        } else {
          try {
            const runtimeRes = await this.runtime.execute({
              provider: req.provider || "auto",
              systemPrompt,
              userPrompt,
              model: req.model,
              temperature: req.temperature,
              maxTokens: req.maxTokens,
              timeoutMs: req.timeoutMs,
            });
            activeProvider = runtimeRes.provider as any;
            response = {
              content: runtimeRes.content,
              model: runtimeRes.model,
              actualModel: runtimeRes.actualModel,
              inputTokens: runtimeRes.usage?.promptTokens ?? null,
              outputTokens: runtimeRes.usage?.completionTokens ?? null,
              totalTokens: runtimeRes.usage?.totalTokens ?? null,
              estimatedCost: runtimeRes.estimatedCost,
              requestId: runtimeRes.requestId,
            };
          } catch (llmErr: any) {
            this.handleLlmError(llmErr);
          }
        }
      } catch (err: any) {
        status = "FAILED";
        errorCode = err?.name || "AI_GENERATION_FAILED";
        errorMessage = err?.message || String(err);

        // 记录失败审计入库
        await this.auditService.recordAudit({
          organizationId: req.organizationId,
          projectId: req.projectId,
          userId: req.userId,
          feature: req.feature,
          entityType: req.entityType,
          entityId: req.entityId,
          provider: activeProvider,
          model: req.model || (activeProvider === "deepseek" ? "deepseek-chat" : activeProvider === "qwen" ? "qwen-plus" : "unknown"),
          requestedModel: req.model || "unknown",
          promptVersion: req.promptVersion,
          inputSnapshot: req.input,
          outputSnapshot: { error: this.auditService.sanitizeSensitiveText(errorMessage), errorCode },
          status,
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          estimatedCost: null,
          latencyMs: Math.round(performance.now() - startTimeMs),
          errorCode,
          errorMessage: this.auditService.sanitizeSensitiveText(errorMessage),
          createdAt: startedAt,
          completedAt: new Date(),
        });

        throw err;
      }

      const latencyMs = Math.round(performance.now() - startTimeMs);
      const completedAt = new Date();

      // 3. 结构化 JSON 解析与有限修复策略 (MAX_STRUCTURED_OUTPUT_REPAIR = 1)
      let parsedData: T | undefined = undefined;
      const MAX_STRUCTURED_OUTPUT_REPAIR = 1;
      let repairAttempts = 0;
      let wasRepaired = false;

      if (req.parseJson) {
        let currentContent = response.content;
        let lastParseOrValError: Error | null = null;

        for (let attempt = 0; attempt <= MAX_STRUCTURED_OUTPUT_REPAIR; attempt++) {
          try {
            parsedData = this.cleanAndParseJson<T>(currentContent);
            this.validateStructuredOutput(req.feature, parsedData);
            lastParseOrValError = null;
            if (attempt > 0) {
              wasRepaired = true;
              response.content = currentContent;
            }
            break;
          } catch (err: any) {
            lastParseOrValError = err;
            // 仅对真实 Provider 执行有限修复，Mock 模式无需网络修复
            if (attempt < MAX_STRUCTURED_OUTPUT_REPAIR && targetProvider !== "mock") {
              repairAttempts++;
              this.logger.warn(`[AiGateway] Structured output invalid for ${req.feature} (${err.message}), executing repair attempt ${repairAttempts}/${MAX_STRUCTURED_OUTPUT_REPAIR}...`);
              try {
                const repairPrompt = `The previous JSON response failed validation:
Error: ${err.message}

Previous raw output:
${currentContent.slice(0, 2000)}

Please return ONLY the corrected, valid JSON conforming to the original schema. No markdown formatting, no explanations, no wrappers. Just the raw JSON object.`;

                const repairRes = await this.runtime.execute({
                  provider: activeProvider === "auto" ? "auto" : activeProvider,
                  systemPrompt: "You are a JSON repair specialist. Output ONLY valid, parseable JSON conforming to the required schema.",
                  userPrompt: repairPrompt,
                  model: req.model,
                  temperature: 0.2,
                  maxTokens: req.maxTokens || 4096,
                  timeoutMs: 30000,
                });

                currentContent = repairRes.content;
                // 累计用量与成本
                if (repairRes.usage) {
                  response.inputTokens = (response.inputTokens || 0) + (repairRes.usage.promptTokens || 0);
                  response.outputTokens = (response.outputTokens || 0) + (repairRes.usage.completionTokens || 0);
                  response.totalTokens = (response.totalTokens || 0) + (repairRes.usage.totalTokens || 0);
                }
                if (repairRes.estimatedCost != null) {
                  response.estimatedCost = Number(((response.estimatedCost || 0) + repairRes.estimatedCost).toFixed(6));
                }
              } catch (repairCallErr: any) {
                this.logger.warn(`[AiGateway] Repair call failed: ${repairCallErr.message}`);
                break;
              }
            }
          }
        }

        if (lastParseOrValError) {
          status = "FAILED";
          errorCode = (lastParseOrValError as any)?.code === "STRUCTURED_OUTPUT_INVALID" ? (lastParseOrValError as any).code : "JSON_PARSE_ERROR";
          errorMessage = `大模型输出未能解析为有效 JSON: ${lastParseOrValError.message}${repairAttempts > 0 ? ` (已尝试修复 ${repairAttempts} 次仍失败)` : ""}`;

          await this.auditService.recordAudit({
            organizationId: req.organizationId,
            projectId: req.projectId,
            userId: req.userId,
            feature: req.feature,
            entityType: req.entityType,
            entityId: req.entityId,
            provider: activeProvider,
            model: response.model,
            requestedModel: req.model || response.model,
            promptVersion: req.promptVersion,
            inputSnapshot: req.input,
            outputSnapshot: { rawContent: this.auditService.sanitizeSensitiveText(response.content), repairAttempts, wasRepaired },
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
      const auditRow = await this.auditService.recordAudit({
        organizationId: req.organizationId,
        projectId: req.projectId,
        userId: req.userId,
        feature: req.feature,
        entityType: req.entityType,
        entityId: req.entityId,
        provider: activeProvider,
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
        provider: activeProvider,
        requestedProvider: req.provider || "auto",
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
   * 解析目标 Provider，委托 @geo/llm InteractiveRuntime 统一处理
   */
  private resolveProvider(requested?: AiProviderName): "deepseek" | "qwen" | "mock" {
    try {
      return this.runtime.resolveProvider(requested || "auto");
    } catch (err: any) {
      this.handleLlmError(err);
    }
  }

  /**
   * 统一异常映射：将 @geo/llm 运行时错误映射为 NestJS HTTP 异常
   */
  private handleLlmError(err: any): never {
    if (err instanceof ProviderDisabledError) {
      throw new ServiceUnavailableException("真实 AI Provider 当前未启用");
    }
    if (err instanceof ProviderNotConfiguredError) {
      throw new ServiceUnavailableException("未配置任何可用的真实 AI Provider (DEEPSEEK_API_KEY / QWEN_API_KEY)");
    }
    if (err instanceof ProviderAuthError) {
      throw new ServiceUnavailableException(`API 密钥无效或未授权 (HTTP ${err.httpStatus || 401})`);
    }
    if (err instanceof ProviderRateLimitError) {
      throw new ServiceUnavailableException("API 速率受限，请稍后重试");
    }
    if (err instanceof ProviderTimeoutError) {
      throw new ServiceUnavailableException("AI 调用超时，请稍后重试");
    }
    if (err instanceof LLMProviderError) {
      throw new ServiceUnavailableException(err.message);
    }
    throw err;
  }

  /**
   * 确定性 Mock Provider：用于单元测试与未配置真实环境时的零成本模拟
   */
  private executeMock(feature: string, input: any, modelName: string) {
    return generateMockFixture(feature, input, modelName);
  }

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

  private validateStructuredOutput(feature: string, value: unknown): void {
    const result = validateCapabilityOutput(feature, value);
    if (!result.valid) {
      const error = new Error(`结构化输出校验失败 (${feature}): ${result.errors.join('; ')}`);
      (error as any).code = "STRUCTURED_OUTPUT_INVALID";
      throw error;
    }
  }

  /**
   * 写入 AI 生成审计记录 (AiGeneration)
   * 严禁保存 API Key 等机密
   */
  isSensitiveKey(key: string): boolean {
    return this.auditService.isSensitiveKey(key);
  }

  sanitizeSnapshot(obj: any): any {
    return this.auditService.sanitizeSnapshot(obj);
  }

  sanitizeSensitiveText(value: string | undefined): string | undefined {
    return this.auditService.sanitizeSensitiveText(value);
  }
}
