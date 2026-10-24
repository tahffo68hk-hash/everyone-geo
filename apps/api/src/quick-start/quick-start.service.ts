import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  AiProvider,
  Prisma,
  QuerySource,
  QueryType,
  QuickStartQuestionKind,
} from "@prisma/client";
import { TenantService } from "../common/tenant.service";
import { PrismaService } from "../prisma.service";
import { AiGatewayService } from "./ai-gateway.service";
import {
  ConfirmModelCallDto,
  CreateQuickStartSessionDto,
  InferIndustryDto,
  QuickStartQuestionDto,
  UpdateQuickStartQuestionsDto,
  UpdateQuickStartSettingsDto,
} from "./dto/quick-start.dto";
import {
  analyzeBrandMention,
  assertPaidCallConfirmed,
  calculateVisibilityMetrics,
  isValidQuestionCount,
  parseJsonPayload,
  QuestionKind,
} from "./quick-start.logic";
import { buildUserPrompt, getPromptVersion } from "./content-prompts";

type QuestionSnapshot = {
  queryId?: string;
  text: string;
  kind: QuickStartQuestionKind;
  intent: string;
};

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function savedQuestions(value: Prisma.JsonValue | null): QuestionSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Prisma.JsonObject =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  ).map((item) => ({
    queryId: typeof item.queryId === "string" ? item.queryId : undefined,
    text: typeof item.text === "string" ? item.text : "",
    kind: item.kind === "BRANDED" ? "BRANDED" : "DISCOVERY",
    intent: typeof item.intent === "string" ? item.intent : "用户需求",
  }));
}

function normalizeWebsite(value?: string) {
  const input = value?.trim();
  if (!input) return undefined;
  const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new BadRequestException("官网地址格式无效");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new BadRequestException("官网地址只支持 HTTP 或 HTTPS");
  }
  return parsed.toString();
}

function queryType(question: QuestionSnapshot): QueryType {
  if (question.kind === "BRANDED") return "BRAND";
  if (/比较|竞品|对比/.test(question.intent)) return "COMPARISON";
  if (/购买|决策|价格|成本/.test(question.intent)) return "PURCHASE_INTENT";
  if (/推荐/.test(question.intent)) return "RECOMMENDATION";
  if (/功能|场景|使用/.test(question.intent)) return "PROBLEM_SOLVING";
  return "INDUSTRY";
}

function citationsIn(text: string) {
  return Array.from(text.matchAll(/https?:\/\/[^\s<>"')\]]+/g), (match) => match[0]);
}

@Injectable()
export class QuickStartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly gateway: AiGatewayService,
  ) {}

  providers() {
    return this.gateway.providerStatus();
  }

  async inferIndustry(dto: InferIndustryDto) {
    const provider = dto.provider ?? "MOCK";
    this.assertProviderConfigured(provider);
    const result = await this.gateway.complete({
      task: "industry",
      provider,
      model: dto.model,
      prompt: buildUserPrompt({ brandName: dto.brandName, website: dto.website ?? "" }),
      context: { brandName: dto.brandName, website: dto.website ?? "" },
      confirmed: dto.confirmed === true,
      requestCount: 1,
    });
    const payload = parseJsonPayload(result.answer) as { industry?: unknown };
    if (typeof payload.industry !== "string" || payload.industry.trim().length === 0) {
      throw new BadRequestException("行业推断没有返回可用结果");
    }
    const promptVersion = getPromptVersion("industry");
    return {
      industry: payload.industry.trim(),
      provider: result.provider,
      model: result.model,
      promptVersion,
      isMock: result.isMock,
      message: result.isMock ? "模拟推断，请核实后修改" : "模型建议，请核实后修改",
    };
  }

  async listSessions(userId: string, organizationId?: string) {
    if (organizationId) {
      await this.tenant.assertUserInOrganization(userId, organizationId);
    }
    const memberships = await this.prisma.client.organizationMember.findMany({
      where: { userId },
      select: { organizationId: true },
    });
    const organizationIds = organizationId
      ? [organizationId]
      : memberships.map((membership) => membership.organizationId);
    if (organizationIds.length === 0) return [];

    return this.prisma.client.quickStartSession.findMany({
      where: { project: { organizationId: { in: organizationIds } } },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        id: true,
        currentStep: true,
        provider: true,
        model: true,
        updatedAt: true,
        project: { select: { id: true, name: true } },
        brand: { select: { name: true } },
        runs: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            responseCount: true,
            requestCount: true,
            isMock: true,
          },
        },
      },
    });
  }

  async createSession(userId: string, dto: CreateQuickStartSessionDto) {
    const brandName = dto.brandName.trim();
    if (!brandName) throw new BadRequestException("请填写品牌名称");
    await this.tenant.assertUserInOrganization(userId, dto.organizationId);
    const website = normalizeWebsite(dto.website);
    const provider = dto.provider ?? "MOCK";

    const created = await this.prisma.client.$transaction(async (tx) => {
      let project = dto.projectId
        ? await tx.project.findFirst({
            where: { id: dto.projectId, organizationId: dto.organizationId },
          })
        : await tx.project.findFirst({
            where: {
              organizationId: dto.organizationId,
              status: "ACTIVE",
              brands: { some: { name: brandName } },
            },
            orderBy: { createdAt: "asc" },
          });
      if (dto.projectId && !project) {
        throw new NotFoundException("项目不存在或无权访问");
      }
      if (!project && !dto.projectId) {
        project = await tx.project.findUnique({
          where: {
            organizationId_name: {
              organizationId: dto.organizationId,
              name: brandName,
            },
          },
        });
      }
      if (!project) {
        project = await tx.project.create({
          data: {
            organizationId: dto.organizationId,
            name: brandName,
            description: "由 GeoLens 快速开始创建",
            industry: dto.industry?.trim() || null,
            status: "ACTIVE",
          },
        });
      } else {
        await tx.project.update({
          where: { id: project.id },
          data: {
            status: "ACTIVE",
            ...(dto.industry?.trim() ? { industry: dto.industry.trim() } : {}),
          },
        });
      }

      let brand = await tx.brand.findFirst({
        where: { projectId: project.id, name: brandName },
      });
      if (!brand) {
        brand = await tx.brand.create({
          data: {
            projectId: project.id,
            name: brandName,
            website,
          },
        });
      } else if (website) {
        brand = await tx.brand.update({
          where: { id: brand.id },
          data: { website },
        });
      }

      for (const rawName of dto.competitors ?? []) {
        const name = rawName.trim();
        if (!name || name.toLocaleLowerCase() === brandName.toLocaleLowerCase()) continue;
        const competitor = await tx.competitor.findFirst({
          where: { projectId: project.id, name },
          select: { id: true },
        });
        if (!competitor) {
          await tx.competitor.create({ data: { projectId: project.id, name } });
        }
      }

      const session = await tx.quickStartSession.create({
        data: {
          projectId: project.id,
          brandId: brand.id,
          createdById: userId,
          provider,
          model: dto.model?.trim() || this.gateway.defaultModel(provider),
          currentStep: "QUESTIONS",
          questions: jsonInput([]),
        },
      });
      const querySet = await tx.querySet.create({
        data: {
          projectId: project.id,
          name: `快速开始 ${session.id.slice(0, 8)}`,
          description: "快速开始向导确认的 GEO 监测问题",
        },
      });
      return tx.quickStartSession.update({
        where: { id: session.id },
        data: { querySetId: querySet.id },
        select: { id: true },
      });
    });

    return this.getSession(created.id, userId);
  }

  async getSession(sessionId: string, userId: string) {
    const access = await this.prisma.client.quickStartSession.findUnique({
      where: { id: sessionId },
      select: { id: true, projectId: true },
    });
    if (!access) throw new NotFoundException("快速开始记录不存在或无权访问");
    await this.tenant.assertUserInProject(userId, access.projectId);

    const session = await this.prisma.client.quickStartSession.findUnique({
      where: { id: sessionId },
      include: {
        project: { include: { competitors: true } },
        brand: true,
        querySet: {
          include: {
            queries: {
              where: { status: "ACTIVE" },
              orderBy: { createdAt: "asc" },
            },
          },
        },
        runs: {
          take: 1,
          orderBy: { createdAt: "desc" },
          include: {
            responses: { orderBy: { createdAt: "asc" } },
            report: {
              include: {
                suggestions: {
                  orderBy: { createdAt: "desc" },
                  include: {
                    evidence: {
                      include: { response: { select: { id: true, queryText: true, rawResponse: true, isMock: true } } },
                    },
                  },
                },
                contentAssets: {
                  orderBy: { createdAt: "desc" },
                  include: {
                    generations: { orderBy: { createdAt: "desc" } },
                    distributionTasks: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!session) throw new NotFoundException("快速开始记录不存在或无权访问");
    return { ...session, questions: savedQuestions(session.questions) };
  }

  async updateSettings(
    sessionId: string,
    userId: string,
    dto: UpdateQuickStartSettingsDto,
  ) {
    await this.getSession(sessionId, userId);
    await this.prisma.client.quickStartSession.update({
      where: { id: sessionId },
      data: {
        provider: dto.provider,
        model: dto.model?.trim() || this.gateway.defaultModel(dto.provider),
      },
    });
    return this.getSession(sessionId, userId);
  }

  async generateQuestions(
    sessionId: string,
    userId: string,
    dto: ConfirmModelCallDto,
  ) {
    const session = await this.getSession(sessionId, userId);
    const provider = session.provider;
    this.assertProviderConfigured(provider);
    const prompt = buildUserPrompt({
      brandProfile: {
        name: session.brand.name,
        website: session.brand.website,
        description: session.brand.description,
        products: session.brand.products,
      },
      projectProfile: {
        industry: session.project.industry,
        region: session.project.region,
        targetAudience: session.project.targetAudience,
        competitors: session.project.competitors.map((item) => item.name),
      },
    });
    const promptVersion = getPromptVersion("questions");
    const result = await this.gateway.complete({
      task: "questions",
      provider,
      model: session.model,
      prompt,
      context: {
        brandName: session.brand.name,
        website: session.brand.website ?? "",
        industry: session.project.industry ?? "",
        competitors: session.project.competitors.map((item) => item.name),
      },
      confirmed: dto.confirmed === true,
      requestCount: 1,
    });
    const payload = parseJsonPayload(result.answer) as { questions?: unknown };
    const questions = this.validateGeneratedQuestions(payload.questions);
    const saved = await this.persistQuestions(session, questions, "AI_GENERATED");
    await this.prisma.client.quickStartSession.update({
      where: { id: sessionId },
      data: {
        questionGeneration: jsonInput({
          provider: result.provider,
          model: result.model,
          promptVersion,
          tokens: result.tokens,
          latencyMs: result.latencyMs,
          costEstimate: result.costEstimate,
          isMock: result.isMock,
          confirmedAt: result.isMock ? null : new Date().toISOString(),
          confirmedById: result.isMock ? null : userId,
        }),
      },
    });
    return { questions: saved, generation: { ...result, promptVersion } };
  }

  async updateQuestions(
    sessionId: string,
    userId: string,
    dto: UpdateQuickStartQuestionsDto,
  ) {
    const session = await this.getSession(sessionId, userId);
    const normalized = dto.questions.map((question) => ({
      ...question,
      text: question.text.trim(),
      intent: question.intent.trim(),
    }));
    if (!isValidQuestionCount(normalized.length)) {
      throw new BadRequestException("监测问题需保持 8–12 条");
    }
    if (normalized.some((question) => !question.text || !question.intent)) {
      throw new BadRequestException("问题和意图不能为空");
    }
    const textSet = new Set(normalized.map((question) => question.text.toLocaleLowerCase()));
    if (textSet.size !== normalized.length) {
      throw new BadRequestException("问题列表中有重复内容");
    }
    const saved = await this.persistQuestions(session, normalized, "MANUAL");
    return { questions: saved };
  }

  private validateGeneratedQuestions(value: unknown): QuickStartQuestionDto[] {
    if (!Array.isArray(value) || value.length < 8 || value.length > 12) {
      throw new BadRequestException("监测问题需为 8–12 条，请重新生成");
    }
    const questions = value.map((item) => item as Partial<QuickStartQuestionDto>);
    if (
      questions.some(
        (question) =>
          typeof question.text !== "string" ||
          question.text.trim().length === 0 ||
          question.text.length > 500 ||
          typeof question.intent !== "string" ||
          question.intent.trim().length === 0 ||
          !["DISCOVERY", "BRANDED"].includes(String(question.kind)),
      )
    ) {
      throw new BadRequestException("模型返回的问题格式无效，请重试");
    }
    if (
      questions.filter((question) => question.kind === "DISCOVERY").length < 5 ||
      questions.filter((question) => question.kind === "BRANDED").length < 2
    ) {
      throw new BadRequestException("生成结果需要同时包含发现型和品牌相关问题");
    }
    return questions.map((question) => ({
      text: question.text!.trim(),
      intent: question.intent!.trim(),
      kind: question.kind as QuickStartQuestionKind,
    }));
  }

  private async persistQuestions(
    session: {
      id: string;
      projectId: string;
      querySetId: string | null;
      questions: Prisma.JsonValue | null;
    },
    questions: Array<QuickStartQuestionDto | QuestionSnapshot>,
    source: QuerySource,
  ): Promise<QuestionSnapshot[]> {
    const previous = savedQuestions(session.questions);
    const previousIds = new Set(
      previous
        .map((question) => question.queryId)
        .filter((id): id is string => Boolean(id)),
    );
    for (const question of questions) {
      if (question.queryId && !previousIds.has(question.queryId)) {
        throw new BadRequestException("问题记录与当前快速开始会话不匹配");
      }
    }

    return this.prisma.client.$transaction(async (tx) => {
      let querySetId = session.querySetId;
      if (!querySetId) {
        const querySet = await tx.querySet.create({
          data: {
            projectId: session.projectId,
            name: `快速开始 ${session.id.slice(0, 8)}`,
            description: "快速开始向导确认的 GEO 监测问题",
          },
        });
        querySetId = querySet.id;
      }

      const keptIds = new Set(
        questions
          .map((question) => question.queryId)
          .filter((id): id is string => Boolean(id)),
      );
      const removedIds = [...previousIds].filter((id) => !keptIds.has(id));
      if (removedIds.length > 0) {
        await tx.query.updateMany({
          where: { id: { in: removedIds }, projectId: session.projectId },
          data: { status: "ARCHIVED" },
        });
      }

      const stored: QuestionSnapshot[] = [];
      for (const question of questions) {
        const data = {
          text: question.text.trim(),
          type: queryType(question),
          source: question.queryId ? undefined : source,
          status: "ACTIVE" as const,
          language: "zh-CN",
          querySetId,
        };
        const query = question.queryId
          ? await tx.query.update({
              where: { id: question.queryId },
              data,
              select: { id: true },
            })
          : await tx.query.create({
              data: { ...data, projectId: session.projectId },
              select: { id: true },
            });
        stored.push({ ...question, queryId: query.id });
      }

      await tx.quickStartSession.update({
        where: { id: session.id },
        data: {
          querySetId,
          questions: jsonInput(stored),
          currentStep: "QUESTIONS",
        },
      });
      return stored;
    });
  }

  async startRun(sessionId: string, userId: string, dto: ConfirmModelCallDto) {
    const session = await this.getSession(sessionId, userId);
    const questions = savedQuestions(session.questions);
    if (!isValidQuestionCount(questions.length) || questions.some((question) => !question.queryId)) {
      throw new BadRequestException("请先保存并确认 8–12 条监测问题");
    }
    assertPaidCallConfirmed(session.provider, dto.confirmed === true, questions.length);
    this.assertProviderConfigured(session.provider);

    const activeRun = await this.prisma.client.monitoringRun.findFirst({
      where: { sessionId, status: "RUNNING" },
      select: { id: true },
    });
    if (activeRun) throw new ConflictException("当前会话已有检测正在进行");

    let run;
    try {
      run = await this.prisma.client.monitoringRun.create({
        data: {
          sessionId,
          activeSessionId: sessionId,
          projectId: session.projectId,
          brandId: session.brandId,
          provider: session.provider,
          model: session.model,
          isMock: session.provider === "MOCK",
          requestCount: questions.length,
          confirmedById: session.provider === "MOCK" ? undefined : userId,
          confirmedAt: session.provider === "MOCK" ? undefined : new Date(),
        },
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw new ConflictException("当前会话已有检测正在进行");
      }
      throw error;
    }
    await this.prisma.client.quickStartSession.update({
      where: { id: sessionId },
      data: { currentStep: "MONITOR" },
    });

    void this.executeRun(run.id, session, questions, dto.confirmed === true).catch(
      async (error: unknown) => {
        await this.prisma.client.monitoringRun.updateMany({
          where: { id: run.id, status: "RUNNING" },
          data: {
            status: "FAILED",
            activeSessionId: null,
            error: error instanceof Error ? error.message.slice(0, 1000) : "检测任务异常终止",
            completedAt: new Date(),
          },
        });
      },
    );
    return {
      id: run.id,
      status: run.status,
      provider: run.provider,
      model: run.model,
      isMock: run.isMock,
      requestCount: run.requestCount,
      responseCount: 0,
    };
  }

  async getRun(runId: string, userId: string) {
    const access = await this.prisma.client.monitoringRun.findUnique({
      where: { id: runId },
      select: { id: true, projectId: true },
    });
    if (!access) throw new NotFoundException("检测记录不存在或无权访问");
    await this.tenant.assertUserInProject(userId, access.projectId);
    const run = await this.prisma.client.monitoringRun.findUnique({
      where: { id: runId },
      include: {
        responses: { orderBy: { createdAt: "asc" } },
        report: true,
      },
    });
    if (!run) throw new NotFoundException("检测记录不存在或无权访问");
    if (run.status === "RUNNING") {
      const lastActivity = run.responses.at(-1)?.createdAt ?? run.startedAt;
      if (Date.now() - lastActivity.getTime() > 120_000) {
        await this.recoverInterruptedRun(run);
        return this.prisma.client.monitoringRun.findUnique({
          where: { id: runId },
          include: {
            responses: { orderBy: { createdAt: "asc" } },
            report: true,
          },
        });
      }
    }
    return run;
  }

  private async recoverInterruptedRun(run: {
    id: string;
    sessionId: string;
    projectId: string;
    brandId: string;
    isMock: boolean;
    responses: Array<{
      kind: QuickStartQuestionKind;
      brandMentioned: boolean;
      competitorMentions: string[];
      isMock: boolean;
      citations: unknown;
    }>;
  }) {
    const responseCount = run.responses.length;
    const status = responseCount > 0 ? "PARTIAL" : "FAILED";
    await this.prisma.client.$transaction(async (tx) => {
      await tx.monitoringRun.updateMany({
        where: { id: run.id, status: "RUNNING" },
        data: {
          status,
          activeSessionId: null,
          responseCount,
          error: "检测进程中断；未完成的问题未自动重试，可由用户手动重新运行。",
          completedAt: new Date(),
        },
      });
      if (responseCount > 0) {
        await tx.geoReport.upsert({
          where: { runId: run.id },
          create: {
            runId: run.id,
            projectId: run.projectId,
            brandId: run.brandId,
            metrics: jsonInput({
              ...calculateVisibilityMetrics(run.responses.map((response) => ({
                ...response,
                sourceCount: Array.isArray(response.citations) ? response.citations.length : 0,
              }))),
              sampleNote: "检测进程中断；仅统计已保存的回答样本。",
            }),
            containsMockData: run.isMock || run.responses.some((response) => response.isMock),
          },
          update: {},
        });
        await tx.quickStartSession.update({
          where: { id: run.sessionId },
          data: { currentStep: "REPORT" },
        });
      }
    });
  }

  private async executeRun(
    runId: string,
    session: {
      id: string;
      projectId: string;
      brandId: string;
      provider: AiProvider;
      model: string;
      brand: {
        name: string;
        aliases: string[];
        website?: string | null;
        description?: string | null;
        products?: string[];
      };
      project: {
        industry: string | null;
        region?: string | null;
        targetAudience?: string | null;
        description?: string | null;
        competitors: Array<{ name: string; aliases: string[] }>;
      };
    },
    questions: QuestionSnapshot[],
    confirmed: boolean,
  ) {
    let responseCount = 0;
    const samples: Array<{
      kind: QuestionKind;
      brandMentioned: boolean;
      competitorMentions: string[];
      sourceCount: number;
    }> = [];
    let failure: unknown;

    try {
      for (let index = 0; index < questions.length; index += 1) {
        const question = questions[index];
        const sources = session.provider === "DEEPSEEK"
          ? await this.gateway.search(question.text)
          : [];
        const rawPrompt = buildUserPrompt({
          question: question.text,
          brandProfile: {
            name: session.brand.name,
            website: session.brand.website ?? "",
            description: session.brand.description ?? "",
            products: session.brand.products ?? [],
          },
          projectProfile: {
            industry: session.project.industry ?? "",
            region: session.project.region ?? "",
            targetAudience: session.project.targetAudience ?? "",
            description: session.project.description ?? "",
            competitors: session.project.competitors.map((item) => item.name),
          },
          searchEvidence: sources,
        });
        const result = await this.gateway.complete({
          task: "answer",
          provider: session.provider,
          model: session.model,
          prompt: rawPrompt,
          context: {
            brandName: session.brand.name,
            industry: session.project.industry ?? "",
            competitors: session.project.competitors.map((item) => item.name),
            question: question.text,
            kind: question.kind,
            index,
          },
          confirmed: session.provider === "MOCK" || confirmed,
          requestCount: questions.length,
        });
        const mention = analyzeBrandMention(result.answer, session.brand.name);
        const competitors = session.project.competitors
          .filter((competitor) => analyzeBrandMention(result.answer, competitor.name).mentioned)
          .map((competitor) => competitor.name);
        await this.prisma.client.monitoringResponse.create({
          data: {
            runId,
            queryId: question.queryId,
            queryText: question.text,
            kind: question.kind,
            intent: question.intent,
            provider: result.provider,
            model: result.model,
            promptVersion: getPromptVersion("answer"),
            rawPrompt,
            rawResponse: result.answer,
            brandMentioned: mention.mentioned,
            mentionPosition: mention.position,
            competitorMentions: competitors,
            citations: session.provider === "DEEPSEEK"
              ? sources.map((source) => source.url)
              : citationsIn(result.answer),
            tokens: result.tokens === null ? undefined : jsonInput(result.tokens),
            latencyMs: result.latencyMs,
            costEstimate: result.costEstimate,
            isMock: result.isMock,
          },
        });
        samples.push({
          kind: question.kind,
          brandMentioned: mention.mentioned,
          competitorMentions: competitors,
          sourceCount: sources.length,
        });
        responseCount += 1;
        await this.prisma.client.monitoringRun.update({
          where: { id: runId },
          data: { responseCount },
        });
      }

      const metrics = calculateVisibilityMetrics(samples);
      const run = await this.prisma.client.monitoringRun.findUniqueOrThrow({
        where: { id: runId },
        select: { projectId: true, brandId: true },
      });
      await this.prisma.client.geoReport.create({
        data: {
          runId,
          projectId: run.projectId,
          brandId: run.brandId,
          metrics: jsonInput({
            ...metrics,
            sampleNote: "仅统计本次成功保存的回答样本；未完成的问题不计为未提及。",
          }),
          containsMockData: session.provider === "MOCK",
        },
      });
      await this.prisma.client.monitoringRun.update({
        where: { id: runId },
        data: {
          status: "COMPLETED",
          activeSessionId: null,
          completedAt: new Date(),
        },
      });
      await this.prisma.client.quickStartSession.update({
        where: { id: session.id },
        data: { currentStep: "REPORT" },
      });
      return;
    } catch (error) {
      failure = error;
    }

    const message = failure instanceof Error ? failure.message : "检测执行失败";
    await this.prisma.client.monitoringRun.update({
      where: { id: runId },
      data: {
        responseCount,
        status: responseCount > 0 ? "PARTIAL" : "FAILED",
        activeSessionId: null,
        error: message.slice(0, 1000),
        completedAt: new Date(),
      },
    });
    if (responseCount > 0) {
      try {
        const run = await this.prisma.client.monitoringRun.findUniqueOrThrow({
          where: { id: runId },
          select: { projectId: true, brandId: true },
        });
        await this.prisma.client.geoReport.create({
          data: {
            runId,
            projectId: run.projectId,
            brandId: run.brandId,
            metrics: jsonInput({
              ...calculateVisibilityMetrics(samples),
              sampleNote: "部分问题未完成；仅统计已保存的回答样本。",
            }),
            containsMockData: session.provider === "MOCK",
          },
        });
        await this.prisma.client.quickStartSession.update({
          where: { id: session.id },
          data: { currentStep: "REPORT" },
        });
      } catch {
        // The run remains PARTIAL with its saved immutable responses if report creation fails.
      }
    }
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
