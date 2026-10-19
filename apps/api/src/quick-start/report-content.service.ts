import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AiProvider, Prisma } from "@prisma/client";
import { TenantService } from "../common/tenant.service";
import { PrismaService } from "../prisma.service";
import { AiGatewayService } from "./ai-gateway.service";
import { GenerateContentDto, SaveContentDto } from "./dto/quick-start.dto";
import { CONTENT_PLATFORM_LABELS, ContentPlatform } from "./quick-start.constants";
import { parseJsonPayload } from "./quick-start.logic";
import { buildUserPrompt, getPromptVersion } from "./content-prompts";
import { cleanPublishText, parseGeneratedContent } from "./content-quality";

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

@Injectable()
export class ReportContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly gateway: AiGatewayService,
  ) {}

  async getReport(reportId: string, userId: string) {
    const access = await this.prisma.client.geoReport.findUnique({
      where: { id: reportId },
      select: { id: true, projectId: true },
    });
    if (!access) throw new NotFoundException("报告不存在或无权访问");
    await this.tenant.assertUserInProject(userId, access.projectId);

    return this.prisma.client.geoReport.findUnique({
      where: { id: reportId },
      include: {
        brand: true,
        project: {
          include: {
            competitors: {
              select: { name: true, website: true, description: true },
            },
          },
        },
        run: {
          include: {
            responses: { orderBy: { createdAt: "asc" } },
          },
        },
        suggestions: {
          orderBy: { createdAt: "desc" },
          include: {
            evidence: {
              include: {
                response: {
                  select: {
                    id: true,
                    queryId: true,
                    queryText: true,
                    intent: true,
                    rawResponse: true,
                    brandMentioned: true,
                    isMock: true,
                  },
                },
              },
            },
          },
        },
        contentAssets: {
          orderBy: { createdAt: "desc" },
          include: {
            generations: {
              orderBy: { createdAt: "desc" },
              include: {
                evidence: {
                  include: {
                    response: { select: { id: true, queryText: true, intent: true, isMock: true } },
                  },
                },
              },
            },
            distributionTasks: true,
          },
        },
      },
    });
  }

  async generateSuggestions(
    reportId: string,
    userId: string,
    confirmed: boolean,
  ) {
    const report = await this.getReport(reportId, userId);
    if (!report) throw new NotFoundException("报告不存在或无权访问");
    const responses = report.run.responses;
    if (responses.length === 0) throw new BadRequestException("报告没有可用的回答证据");
    this.assertProviderConfigured(report.run.provider);

    const prompt = buildUserPrompt({
      brandProfile: {
        name: report.brand.name,
        website: report.brand.website,
        description: report.brand.description,
        products: report.brand.products,
      },
      projectProfile: {
        industry: report.project.industry,
        region: report.project.region,
        targetAudience: report.project.targetAudience,
      },
      geoStrategy: {
        relatedTopics: Array.from(new Set([
          report.project.industry,
          report.project.targetAudience,
          ...responses.map((response) => response.queryText),
        ].filter((value): value is string => Boolean(value?.trim())))),
        entities: Array.from(new Set([
          report.brand.name,
          ...report.brand.aliases,
          ...report.brand.products,
          ...report.project.competitors.map((item) => item.name),
        ].filter(Boolean))),
        searchIntents: Array.from(new Set(responses.map((response) => response.intent).filter(Boolean))),
      },
      geoFindings: responses.map((response) => ({
        responseId: response.id,
        queryId: response.queryId,
        query: response.queryText,
        answer: response.rawResponse,
        brandMentioned: response.brandMentioned,
        isMock: response.isMock,
      })),
    });
    const result = await this.gateway.complete({
      task: "suggestions",
      provider: report.run.provider,
      model: report.run.model,
      prompt,
      context: {
        brandName: report.brand.name,
        responses: responses.map((response) => ({
          id: response.id,
          queryId: response.queryId,
          queryText: response.queryText,
          intent: response.intent,
          brandMentioned: response.brandMentioned,
          rawResponse: response.rawResponse,
        })),
      },
      confirmed,
      requestCount: 1,
    });
    const payload = parseJsonPayload(result.answer) as { suggestions?: unknown };
    if (!Array.isArray(payload.suggestions) || payload.suggestions.length === 0 || payload.suggestions.length > 4) {
      throw new BadRequestException("优化建议格式无效，请重试");
    }
    const byResponseId = new Map(responses.map((response) => [response.id, response]));
    const suggestions = payload.suggestions.map((value) => {
      const item = isRecord(value) ? value : {};
      const responseId = typeof item.responseId === "string" ? item.responseId : "";
      const evidence = byResponseId.get(responseId);
      const title = typeof item.title === "string" ? cleanPublishText(item.title) : "";
      const action = typeof item.action === "string" ? cleanPublishText(item.action) : "";
      if (
        !evidence ||
        !title ||
        !action
      ) {
        throw new BadRequestException("优化建议必须关联本报告中的实际回答证据");
      }
      return {
        title: title.slice(0, 160),
        action: action.slice(0, 4000),
        queryId: evidence.queryId,
        responseId: evidence.id,
      };
    });

    const generation = {
      provider: result.provider,
      model: result.model,
      promptVersion: getPromptVersion("suggestions"),
      tokens: result.tokens,
      latencyMs: result.latencyMs,
      costEstimate: result.costEstimate,
      isMock: result.isMock,
      confirmedAt: result.isMock ? null : new Date().toISOString(),
      confirmedById: result.isMock ? null : userId,
    };
    await this.prisma.client.$transaction(
      suggestions.map((suggestion) =>
        this.prisma.client.optimizationSuggestion.create({
          data: {
            reportId,
            title: suggestion.title,
            action: suggestion.action,
            queryIds: suggestion.queryId ? [suggestion.queryId] : [],
            provider: result.provider,
            model: result.model,
            promptVersion: getPromptVersion("suggestions"),
            generation: jsonInput(generation),
            isMock: result.isMock,
            evidenceMock: report.containsMockData,
            evidence: { create: [{ responseId: suggestion.responseId }] },
          },
        }),
      ),
    );
    return this.getReport(reportId, userId);
  }

  async generateContent(
    reportId: string,
    userId: string,
    dto: GenerateContentDto,
  ) {
    const report = await this.getReport(reportId, userId);
    if (!report) throw new NotFoundException("报告不存在或无权访问");
    const channel = dto.channel as ContentPlatform;
    const suggestion = dto.suggestionId
      ? report.suggestions.find((item) => item.id === dto.suggestionId)
      : report.suggestions[0];
    if (dto.suggestionId && !suggestion) {
      throw new NotFoundException("该优化建议不属于当前报告");
    }

    const evidenceRows = suggestion
      ? suggestion.evidence.map((entry) => entry.response)
      : report.run.responses
          .slice()
          .sort((left, right) => Number(left.brandMentioned) - Number(right.brandMentioned))
          .slice(0, 3);
    const opportunity = suggestion?.title ?? evidenceRows[0]?.queryText ?? "用户关心的问题";
    const enterpriseContext = dto.enterpriseContext?.trim() ?? "";
    const projectDescription = report.project.description?.trim() ?? "";
    const meaningfulProjectDescription = projectDescription === "由 GeoLens 快速开始创建"
      ? ""
      : projectDescription;
    const brandFacts = [
      report.brand.description,
      ...report.brand.products,
      meaningfulProjectDescription,
      report.project.targetAudience,
      enterpriseContext,
    ].filter((value): value is string => Boolean(value?.trim()));
    const promptVersion = getPromptVersion("content", channel);
    const prompt = buildUserPrompt({
      brandProfile: {
        name: report.brand.name,
        website: report.brand.website,
        description: report.brand.description,
        products: report.brand.products,
      },
      enterpriseContext,
      projectProfile: {
        name: report.project.name,
        description: meaningfulProjectDescription,
        industry: report.project.industry,
        region: report.project.region,
        targetAudience: report.project.targetAudience,
        competitors: report.project.competitors.map((item) => ({
          name: item.name,
          website: item.website,
          description: item.description,
        })),
      },
      geoStrategy: {
        targetQuestion: opportunity,
        relatedTopics: Array.from(new Set([
          report.project.industry,
          report.project.targetAudience,
          opportunity,
        ].filter((value): value is string => Boolean(value?.trim())))),
        entities: Array.from(new Set([
          report.brand.name,
          ...report.brand.aliases,
          ...report.brand.products,
          ...report.project.competitors.map((item) => item.name),
        ].filter(Boolean))),
        searchIntents: Array.from(new Set(evidenceRows.map((response) => response.intent).filter(Boolean))),
        findings: evidenceRows.map((response) => ({
          responseId: response.id,
          queryId: response.queryId,
          query: response.queryText,
          answer: response.rawResponse,
          brandMentioned: response.brandMentioned,
          isMock: response.isMock,
        })),
        suggestion: suggestion ? { title: suggestion.title, action: suggestion.action } : null,
      },
      platform: { id: channel, label: CONTENT_PLATFORM_LABELS[channel] },
    });
    this.assertProviderConfigured(report.run.provider);
    const result = await this.gateway.complete({
      task: "content",
      provider: report.run.provider,
      model: report.run.model,
      platform: channel,
      prompt,
      context: {
        brandName: report.brand.name,
        brandDescription: report.brand.description ?? "",
        products: report.brand.products,
        industry: report.project.industry ?? "",
        targetAudience: report.project.targetAudience ?? "",
        enterpriseContext,
        platform: channel,
        channel: CONTENT_PLATFORM_LABELS[channel],
        opportunity,
        evidence: evidenceRows.map((response) => response.rawResponse),
      },
      confirmed: dto.confirmed === true,
      requestCount: 1,
    });
    const content = parseGeneratedContent(result.answer, channel, {
      brandName: report.brand.name,
      supportedFacts: [report.brand.name, report.brand.website ?? "", ...brandFacts].join("\n"),
      hasEnterpriseDetails: Boolean(
        report.brand.description?.trim() ||
        report.brand.products.length ||
        meaningfulProjectDescription ||
        enterpriseContext,
      ),
      opportunity,
    });
    const title = cleanPublishText(content.title);
    const body = cleanPublishText(content.body);
    const hashtags = content.hashtags;
    const metadata = {
      ...content.metadata,
      promptVersion,
      enterpriseContext,
    };
    const evidenceMock = report.containsMockData || evidenceRows.some((response) => response.isMock);
    const generation = {
      provider: result.provider,
      model: result.model,
      promptVersion,
      tokens: result.tokens,
      latencyMs: result.latencyMs,
      costEstimate: result.costEstimate,
      isMock: result.isMock,
      confirmedAt: result.isMock ? null : new Date().toISOString(),
      confirmedById: result.isMock ? null : userId,
    };
    const asset = await this.prisma.client.contentAsset.create({
      data: {
        projectId: report.projectId,
        brandId: report.brandId,
        reportId,
        channel,
        title,
        body,
        hashtags,
        metadata: jsonInput(metadata),
        status: "DRAFT",
        isMock: result.isMock,
        evidenceMock,
        generations: {
          create: {
            provider: result.provider,
            model: result.model,
            promptVersion,
            generation: jsonInput(generation),
            tokens: result.tokens === null ? undefined : jsonInput(result.tokens),
            costEstimate: result.costEstimate,
            isMock: result.isMock,
            evidenceMock,
            evidence: {
              create: evidenceRows.map((response) => ({ responseId: response.id })),
            },
          },
        },
      },
      include: { generations: { include: { evidence: true } } },
    });
    await this.prisma.client.quickStartSession.update({
      where: { id: report.run.sessionId },
      data: { currentStep: "CONTENT" },
    });
    return asset;
  }

  async saveContent(contentId: string, userId: string, dto: SaveContentDto) {
    const access = await this.prisma.client.contentAsset.findUnique({
      where: { id: contentId },
      select: { id: true, projectId: true, metadata: true },
    });
    if (!access) throw new NotFoundException("内容草稿不存在或无权访问");
    await this.tenant.assertUserInProject(userId, access.projectId);
    if (!dto.title.trim() || !dto.body.trim()) {
      throw new BadRequestException("标题和正文不能为空");
    }
    const data: Prisma.ContentAssetUpdateInput = {
      title: dto.title.trim(),
      body: dto.body.trim(),
      hashtags: (dto.hashtags ?? []).map((tag) => tag.trim()).filter(Boolean),
      status: "SAVED",
    };
    if (dto.summaryText !== undefined || dto.videoScriptText !== undefined) {
      const metadata = isRecord(access.metadata) ? access.metadata : {};
      data.metadata = jsonInput({
        ...metadata,
        ...(dto.summaryText !== undefined ? { summaryText: dto.summaryText.trim() } : {}),
        ...(dto.videoScriptText !== undefined ? { videoScriptText: dto.videoScriptText.trim() } : {}),
      });
    }
    return this.prisma.client.contentAsset.update({
      where: { id: contentId },
      data,
      include: { generations: { orderBy: { createdAt: "desc" }, include: { evidence: true } } },
    });
  }

  private assertProviderConfigured(provider: AiProvider) {
    const descriptor = this.gateway.providerStatus().find((item) => item.provider === provider);
    if (!descriptor?.configured) {
      throw new ServiceUnavailableException(
        `${descriptor?.label ?? provider} 尚未配置服务端 API Key；本次没有发送模型请求`,
      );
    }
  }
}
