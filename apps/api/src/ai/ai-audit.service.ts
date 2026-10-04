import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

export interface AiAuditRecordParams {
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
}

@Injectable()
export class AiAuditService {
  private readonly logger = new Logger(AiAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 写入 AI 生成审计记录 (AiGeneration)
   * 严禁保存 API Key 等机密凭据
   */
  async recordAudit(data: AiAuditRecordParams) {
    try {
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
   * 判断一个键名是否属于凭据、秘钥等敏感字段（严格保护正常的业务词汇如 keyword, keyEntity, tokenUsage 等）
   */
  isSensitiveKey(key: string): boolean {
    const lk = key.toLowerCase().replace(/[-_]/g, "");

    // 1. 业务词汇白名单：严格保护，绝不脱敏
    const safeWhitelist = [
      "keyword",
      "keywords",
      "keywordgap",
      "keyentity",
      "keyentities",
      "keyfindings",
      "keythemes",
      "keyfactors",
      "keyangle",
      "keypoints",
      "primarykey",
      "foreignkey",
      "inputtokens",
      "outputtokens",
      "totaltokens",
      "tokenusage",
      "tokens",
      "prompttokens",
      "completiontokens",
    ];
    if (safeWhitelist.some((safe) => lk.includes(safe))) {
      return false;
    }

    // 2. 敏感凭据黑名单
    const sensitivePatterns = [
      "apikey",
      "apisecret",
      "secret",
      "accesstoken",
      "refreshtoken",
      "authtoken",
      "authorization",
      "password",
      "passwd",
      "privatekey",
      "clientsecret",
      "bearer",
    ];
    return sensitivePatterns.some((pattern) => lk.includes(pattern));
  }

  /**
   * 递归清理 snapshot 中潜在的敏感凭据与 API Key 字符串
   */
  sanitizeSnapshot(obj: any): any {
    if (!obj || typeof obj !== "object") {
      if (typeof obj === "string") {
        return obj.replace(/sk-[a-zA-Z0-9_-]{16,}/g, "sk-[REDACTED]");
      }
      return obj;
    }
    if (Array.isArray(obj)) return obj.map((i) => this.sanitizeSnapshot(i));

    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (this.isSensitiveKey(k)) {
        result[k] = "[REDACTED]";
      } else if (typeof v === "object") {
        result[k] = this.sanitizeSnapshot(v);
      } else if (typeof v === "string") {
        result[k] = v.replace(/sk-[a-zA-Z0-9_-]{16,}/g, "sk-[REDACTED]");
      } else {
        result[k] = v;
      }
    }
    return result;
  }

  /**
   * 清理纯文本中的敏感 API Key、Bearer Token、Secret
   */
  sanitizeSensitiveText(value: string | undefined): string | undefined {
    if (!value) return value;
    return value
      .replace(/Bearer\s+[^\s)]+/gi, "Bearer [REDACTED]")
      .replace(/sk-[a-zA-Z0-9_-]{16,}/g, "sk-[REDACTED]")
      .replace(/(api[_-]?key|secret|password)\s*[:=]\s*[^\s,;)}]+/gi, "$1=[REDACTED]");
  }
}
