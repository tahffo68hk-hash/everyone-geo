/**
 * M6C Benchmark Report + Model Identity + Comparison e2e（真实 PostgreSQL geo_test）。
 * 硬保护：test-env 强制 geo_test；fixture 全部直连落库（含 requested/response 模型身份
 * 差异行），不调用任何真实 Provider（0 次 DeepSeek 请求）。
 */
import "../../../packages/database/scripts/test-env.cjs";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";
import { M6B_ANALYSIS_VERSION } from "../src/competitors/competitors.service";

const M4 = "m4-rule-v1";
const M6B = M6B_ANALYSIS_VERSION;
type TaskStatus = "PENDING" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "PARTIAL";

describe("Reports M6C e2e", () => {
  let app: INestApplication;
  let owner: ReturnType<typeof request.agent>;
  let outsider: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const emailOwner = `rep-own-${suffix}@m6c.test.com`;
  const emailOther = `rep-oth-${suffix}@m6c.test.com`;
  const password = "m6c-e2e-pass-123";
  const ids: Record<string, string> = {};
  const reportIds: Record<string, string> = {};

  const mkEngine = async (key: string, provider: string, config: Record<string, unknown> = {}) =>
    prisma.engine.create({ data: { key, name: key, provider, config: config as never } });

  interface RunSpec {
    projectId: string; taskId: string; bRunId: string; engineId: string;
    provider: string; sourceType: string; model: string; modelVersion: string | null;
    requestedModel?: string | null; responseModel?: string | null;
    runStatus?: "SUCCEEDED" | "FAILED";
    m4?: boolean; brandMentioned?: boolean;
    m6b?: boolean; competitorSetId?: string;
  }
  const sortOrderSeq = { value: 0 };

  /** 创建一条「镜像 Query + run + BenchmarkRunQuery 快照 + Evidence(+分析)」的一致记录。 */
  async function addRun(spec: RunSpec) {
    const query = await prisma.query.create({ data: { projectId: spec.projectId, text: `q ${sortOrderSeq.value} ${randomUUID()}` } });
    const run = await prisma.run.create({ data: {
      monitorTaskId: spec.taskId, queryId: query.id, engineId: spec.engineId,
      status: spec.runStatus ?? "SUCCEEDED",
      analysisStatus: spec.m4 || spec.m6b ? "SUCCEEDED" : "PENDING",
      executionToken: randomUUID(),
    } });
    await prisma.benchmarkRunQuery.create({ data: {
      benchmarkRunId: spec.bRunId, benchmarkQueryId: randomUUID(), projectQueryId: query.id,
      queryText: query.text, category: "tool-discovery", intent: `intent ${sortOrderSeq.value}`,
      locale: "zh-CN", sortOrder: sortOrderSeq.value, sanity: false,
    } });
    sortOrderSeq.value += 1;
    const evidence = await prisma.evidence.create({ data: {
      runId: run.id, queryText: query.text,
      rawPrompt: JSON.stringify({ model: spec.requestedModel ?? spec.model }),
      rawResponse: `response for ${query.text}`, provider: spec.provider,
      engineKey: spec.engineId, engineName: "Engine",
      model: spec.model, modelVersion: spec.modelVersion,
      requestedModel: spec.requestedModel ?? null, responseModel: spec.responseModel ?? null,
      retrievalMode: spec.sourceType === "official_api" ? "api_plain" : "unknown",
      sourceType: spec.sourceType as never, metadata: {}, entitySnapshot: [],
    } });
    if (spec.m4) {
      await prisma.analysis.create({ data: {
        evidenceId: evidence.id, analysisVersion: M4,
        brandMentioned: spec.brandMentioned ?? false, mentionPosition: spec.brandMentioned ? 1 : null,
        recommended: false, sentiment: "neutral",
      } });
    }
    if (spec.m6b && spec.competitorSetId) {
      await prisma.analysis.create({ data: {
        evidenceId: evidence.id, analysisVersion: M6B,
        brandMentioned: true, mentionPosition: 1, recommended: true, sentiment: "positive",
        competitorSetId: spec.competitorSetId, competitorSetVersion: "1",
        mentions: { create: [{ entityType: "competitor", entityId: spec.brandMentioned ? ids.cand ?? "cand-1" : "cand-1", canonicalName: "ChatGPT", displayName: "ChatGPT", position: 1, context: "x", sentiment: "positive", startOffset: 0, endOffset: 1 }] },
      } });
    }
    return { query, run, evidence };
  }

  /** 建 suite(min) + monitorTask + BenchmarkRun（runQueries 由 addRun 逐个建）。 */
  async function mkBenchmark(args: {
    organizationId: string; projectId: string; engineId: string; provider: string;
    suiteVersion?: string; status?: TaskStatus; failedRuns?: number;
  }) {
    const suite = await prisma.benchmarkSuite.create({ data: {
      projectId: args.projectId, name: `ProjectMentor GEO Benchmark ${randomUUID().slice(0, 6)}`,
      version: args.suiteVersion ?? "1", status: "ACTIVE",
    } });
    const total = (args.status === "PARTIAL" || args.status === "FAILED" ? 2 : 2);
    const completed = args.status === "PARTIAL" ? 1 : args.status === "FAILED" ? 0 : 2;
    const failed = args.failedRuns ?? (args.status === "PARTIAL" || args.status === "FAILED" ? 1 : 0);
    const task = await prisma.monitorTask.create({ data: {
      organizationId: args.organizationId, projectId: args.projectId,
      status: args.status ?? "SUCCEEDED", totalRuns: total,
      completedRuns: completed, failedRuns: failed,
    } });
    const bRun = await prisma.benchmarkRun.create({ data: {
      organizationId: args.organizationId, projectId: args.projectId, suiteId: suite.id,
      suiteName: suite.name, suiteVersion: suite.version,
      runType: args.provider === "mock" ? "DEMO" : "REAL",
      provider: args.provider, engineId: args.engineId, monitorTaskId: task.id,
      status: args.status ?? "SUCCEEDED", plannedRuns: total,
      completedRuns: completed, failedRuns: failed,
      metadata: { engineKey: args.engineId },
    } });
    return { suite, task, bRun };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    owner = request.agent(app.getHttpServer());
    outsider = request.agent(app.getHttpServer());

    const register = async (email: string) => {
      const res = await request(app.getHttpServer()).post("/auth/register").send({ email, name: "R", password });
      expect(res.status).toBe(201);
      return res.body as { user: { id: string }; organization: { id: string } };
    };
    const a = await register(emailOwner);
    const b = await register(emailOther);
    ids.orgA = a.organization.id;
    ids.orgB = b.organization.id;
    const project = await prisma.project.create({ data: { organizationId: ids.orgA, name: `Rep A ${suffix}`, industry: "SaaS" } });
    ids.projectA = project.id;
    const projectB = await prisma.project.create({ data: { organizationId: ids.orgB, name: `Rep B ${suffix}`, industry: "SaaS" } });
    ids.projectB = projectB.id;

    // ================= tenant A =================
    const mock = await mkEngine(`m6c-mock-${suffix}`, "mock", { delayMs: 0, scenario: "first" });
    ids.engMock = mock.id;
    const setProjectId = project.id;

    // runA1：SUCCEEDED，2 条 mock evidence（m4+m6b 双版本）；供报告快照与 m6b 默认版本
    const ra1 = await mkBenchmark({ organizationId: ids.orgA, projectId: ids.projectA, engineId: mock.id, provider: "mock" });
    ids.runA1 = ra1.bRun.id;
    const set1 = await prisma.competitorSet.create({ data: {
      projectId: setProjectId, name: "ProjectMentor Competitor Set", version: "1", status: "ACTIVE",
      entries: { create: [{ candidateId: randomUUID(), canonicalName: "ChatGPT", aliases: ["ChatGPT"], competitorType: "DIRECT", sortOrder: 0 }] },
    } });
    ids.setV1 = set1.id;
    const cand = await prisma.competitorCandidate.create({ data: {
      projectId: setProjectId, canonicalName: "ChatGPT", normalizedName: "chatgpt", aliases: ["ChatGPT"],
      status: "APPROVED", competitorType: "DIRECT", firstSeenAt: new Date(), lastSeenAt: new Date(),
      evidenceCount: 1, queryCount: 1, mentionCount: 1, recommendationCount: 0, metadata: {},
    } });
    ids.cand = cand.id;
    // 让 m6b 分析 mention 关联到真实 candidate（entry.candidateId）
    await prisma.competitorSet.update({ where: { id: set1.id }, data: { entries: { deleteMany: {}, create: [{ candidateId: cand.id, canonicalName: "ChatGPT", aliases: ["ChatGPT"], competitorType: "DIRECT", sortOrder: 0 }] } } });
    await addRun({ projectId: ids.projectA, taskId: ra1.task.id, bRunId: ra1.bRun.id, engineId: mock.id, provider: "mock", sourceType: "mock", model: "geolens-mock", modelVersion: "1", requestedModel: "geolens-mock", responseModel: "geolens-mock", m4: true, brandMentioned: true, m6b: true, competitorSetId: set1.id });
    await addRun({ projectId: ids.projectA, taskId: ra1.task.id, bRunId: ra1.bRun.id, engineId: mock.id, provider: "mock", sourceType: "mock", model: "geolens-mock", modelVersion: "1", requestedModel: "geolens-mock", responseModel: "geolens-mock", m4: true, m6b: true, competitorSetId: set1.id });

    // runA2：PARTIAL —— 1 成功(带 m4) + 1 失败；legacy evidence 无模型身份
    const ra2 = await mkBenchmark({ organizationId: ids.orgA, projectId: ids.projectA, engineId: mock.id, provider: "mock", status: "PARTIAL" });
    ids.runA2 = ra2.bRun.id;
    await addRun({ projectId: ids.projectA, taskId: ra2.task.id, bRunId: ra2.bRun.id, engineId: mock.id, provider: "mock", sourceType: "mock", model: "geolens-mock", modelVersion: "1", requestedModel: null, responseModel: null, m4: true, brandMentioned: true });
    await addRun({ projectId: ids.projectA, taskId: ra2.task.id, bRunId: ra2.bRun.id, engineId: mock.id, provider: "mock", sourceType: "mock", model: "geolens-mock", modelVersion: "1", runStatus: "FAILED" });

    // runA3：RUNNING —— 不可生成报告
    const ra3 = await mkBenchmark({ organizationId: ids.orgA, projectId: ids.projectA, engineId: mock.id, provider: "mock", status: "RUNNING" });
    ids.runA3 = ra3.bRun.id;
    await addRun({ projectId: ids.projectA, taskId: ra3.task.id, bRunId: ra3.bRun.id, engineId: mock.id, provider: "mock", sourceType: "mock", model: "geolens-mock", modelVersion: "1", requestedModel: "geolens-mock", responseModel: "geolens-mock", m4: true });

    // runA4（可比对照）：SUCCEEDED m4 only —— 用于 COMPARABLE + delta
    const ra4 = await mkBenchmark({ organizationId: ids.orgA, projectId: ids.projectA, engineId: mock.id, provider: "mock" });
    ids.runA4 = ra4.bRun.id;
    await addRun({ projectId: ids.projectA, taskId: ra4.task.id, bRunId: ra4.bRun.id, engineId: mock.id, provider: "mock", sourceType: "mock", model: "geolens-mock", modelVersion: "1", requestedModel: "geolens-mock", responseModel: "geolens-mock", m4: true, brandMentioned: false });
    await addRun({ projectId: ids.projectA, taskId: ra4.task.id, bRunId: ra4.bRun.id, engineId: mock.id, provider: "mock", sourceType: "mock", model: "geolens-mock", modelVersion: "1", requestedModel: "geolens-mock", responseModel: "geolens-mock", m4: true, brandMentioned: false });

    // runA5：suite v2（口径失配对照）
    const ra5 = await mkBenchmark({ organizationId: ids.orgA, projectId: ids.projectA, engineId: mock.id, provider: "mock", suiteVersion: "2" });
    ids.runA5 = ra5.bRun.id;
    await addRun({ projectId: ids.projectA, taskId: ra5.task.id, bRunId: ra5.bRun.id, engineId: mock.id, provider: "mock", sourceType: "mock", model: "geolens-mock", modelVersion: "1", requestedModel: "geolens-mock", responseModel: "geolens-mock", m4: true });

    // runA6：REAL(deepseek 身份差异：requested=deepseek-chat / response=deepseek-v4-flash)
    const ds = await mkEngine(`m6c-ds-${suffix}`, "deepseek", { model: "deepseek-chat" });
    ids.engDs = ds.id;
    const ra6 = await mkBenchmark({ organizationId: ids.orgA, projectId: ids.projectA, engineId: ds.id, provider: "deepseek" });
    ids.runA6 = ra6.bRun.id;
    await addRun({ projectId: ids.projectA, taskId: ra6.task.id, bRunId: ra6.bRun.id, engineId: ds.id, provider: "deepseek", sourceType: "official_api", model: "deepseek-v4-flash", modelVersion: "deepseek-v4-flash", requestedModel: "deepseek-chat", responseModel: "deepseek-v4-flash", m4: true, brandMentioned: true });
    await addRun({ projectId: ids.projectA, taskId: ra6.task.id, bRunId: ra6.bRun.id, engineId: ds.id, provider: "deepseek", sourceType: "official_api", model: "deepseek-v4-flash", modelVersion: "deepseek-v4-flash", requestedModel: "deepseek-chat", responseModel: "deepseek-v4-flash", m4: true, brandMentioned: true });

    // Competitor Set v2（激活用于验证旧报告不漂移）
    const set2 = await prisma.competitorSet.create({ data: {
      projectId: setProjectId, name: "ProjectMentor Competitor Set", version: "2", status: "DRAFT",
      entries: { create: [{ candidateId: cand.id, canonicalName: "ChatGPT", aliases: ["ChatGPT"], competitorType: "DIRECT", sortOrder: 0 }] },
    } });
    ids.setV2 = set2.id;

    // ================= tenant B =================
    const mockB = await mkEngine(`m6c-mockB-${suffix}`, "mock", { delayMs: 0 });
    ids.engMockB = mockB.id;
    const rb = await mkBenchmark({ organizationId: ids.orgB, projectId: ids.projectB, engineId: mockB.id, provider: "mock" });
    ids.runB = rb.bRun.id;
    await addRun({ projectId: ids.projectB, taskId: rb.task.id, bRunId: rb.bRun.id, engineId: mockB.id, provider: "mock", sourceType: "mock", model: "geolens-mock", modelVersion: "1", requestedModel: "geolens-mock", responseModel: "geolens-mock", m4: true, brandMentioned: true });
    await addRun({ projectId: ids.projectB, taskId: rb.task.id, bRunId: rb.bRun.id, engineId: mockB.id, provider: "mock", sourceType: "mock", model: "geolens-mock", modelVersion: "1", requestedModel: "geolens-mock", responseModel: "geolens-mock", m4: true, brandMentioned: false });

    await owner.post("/auth/login").send({ email: emailOwner, password }).expect(200);
    await outsider.post("/auth/login").send({ email: emailOther, password }).expect(200);
  }, 90000);

  afterAll(async () => {
    try {
      for (const orgId of [ids.orgA, ids.orgB]) {
        if (!orgId) continue;
        await prisma.benchmarkReport.deleteMany({ where: { project: { organizationId: orgId } } });
        await prisma.competitorSetEntry.deleteMany({ where: { competitorSet: { project: { organizationId: orgId } } } });
        await prisma.competitorSet.deleteMany({ where: { project: { organizationId: orgId } } });
        await prisma.competitorCandidate.deleteMany({ where: { project: { organizationId: orgId } } });
        const projects = await prisma.project.findMany({ where: { organizationId: orgId }, select: { id: true } });
        for (const p of projects) {
          await prisma.analysis.deleteMany({ where: { evidence: { run: { monitorTask: { projectId: p.id } } } } });
          await prisma.evidence.deleteMany({ where: { run: { monitorTask: { projectId: p.id } } } });
          await prisma.run.deleteMany({ where: { monitorTask: { projectId: p.id } } });
          // BenchmarkRun FK 引用 MonitorTask（Restrict）→ 先删 BenchmarkRun（级联 runQueries/reports）
          await prisma.benchmarkRun.deleteMany({ where: { projectId: p.id } });
          await prisma.monitorTask.deleteMany({ where: { projectId: p.id } });
          await prisma.benchmarkSuite.deleteMany({ where: { projectId: p.id } });
          await prisma.query.deleteMany({ where: { projectId: p.id } });
          await prisma.project.deleteMany({ where: { id: p.id } });
        }
        await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
        await prisma.organization.deleteMany({ where: { id: orgId } });
      }
      await prisma.engine.deleteMany({ where: { id: { in: [ids.engMock, ids.engMockB, ids.engDs].filter(Boolean) } } });
      await prisma.user.deleteMany({ where: { email: { contains: "@m6c.test.com" } } });
    } finally {
      await app.close();
      await prisma.$disconnect();
    }
  });

  // ---------------- Model Identity（Evidence 落库 / legacy 不伪造 / immutable） ----------------
  it("Model identity：requested≠response 正常落库；mock 常量；legacy 行不伪造", async () => {
    const real = await prisma.evidence.findFirst({
      where: { provider: "deepseek", requestedModel: { not: null } },
      select: { requestedModel: true, responseModel: true, model: true },
    });
    expect(real?.requestedModel).toBe("deepseek-chat");
    expect(real?.responseModel).toBe("deepseek-v4-flash");
    expect(real?.requestedModel).not.toBe(real?.responseModel);
    const mockRow = await prisma.evidence.findFirst({ where: { provider: "mock", requestedModel: { not: null } }, select: { requestedModel: true, responseModel: true } });
    expect(mockRow?.requestedModel).toBe("geolens-mock");
    expect(mockRow?.responseModel).toBe("geolens-mock");
    const legacy = await prisma.evidence.findFirst({ where: { requestedModel: null }, select: { requestedModel: true, responseModel: true } });
    expect(legacy?.requestedModel).toBeNull();
    expect(legacy?.responseModel).toBeNull(); // 历史不伪造（UI 显示「历史记录未保存」）
  });

  it("Evidence immutable 不因 M6C 新字段被破坏（UPDATE 被 trigger 拒绝）", async () => {
    const legacy = await prisma.evidence.findFirst({ where: { requestedModel: null } });
    await expect(prisma.evidence.update({ where: { id: legacy!.id }, data: { responseModel: "hack" } })).rejects.toThrow(/immutable/i);
  });

  // ---------------- Report 资格 / 快照 / 版本化 ----------------
  it("运行中 Run 不可生成报告（guard）", async () => {
    await owner.post(`/benchmark-runs/${ids.runA3}/reports`).send({}).expect(400);
  });

  it("完成 Run 生成报告：默认优先 m6b-competitors-v1 并快照 Competitor Set v1", async () => {
    const { body } = await owner.post(`/benchmark-runs/${ids.runA1}/reports`).send({}).expect(201);
    expect(body.analysisVersion).toBe(M6B);
    expect(body.runType).toBe("DEMO");
    expect(body.metricSource).toBe("demo");
    expect(body.competitorSet).toMatchObject({ name: "ProjectMentor Competitor Set", version: "1" });
    expect(body.completion.partial).toBe(false);
    reportIds.runA1m6b = body.id;
  });

  it("同 run 的 m4 报告单独生成（不覆盖上一份）", async () => {
    const { body } = await owner.post(`/benchmark-runs/${ids.runA1}/reports`).send({ analysisVersion: M4 }).expect(201);
    expect(body.analysisVersion).toBe(M4);
    expect(body.competitorSet).toBeNull();
    reportIds.runA1m4 = body.id;
    const list = (await owner.get(`/projects/${ids.projectA}/reports`).expect(200)).body as Array<{ benchmarkRunId: string; analysisVersion: string }>;
    const versions = list.filter(item => item.benchmarkRunId === ids.runA1).map(item => item.analysisVersion);
    expect(versions.sort()).toEqual([M4, M6B]); // 两份并存：无 silently replace
  });

  it("metricsSnapshot：overall/byCategory/byQuery/竞对明细 + 模型身份快照", async () => {
    const { body } = await owner.get(`/reports/${reportIds.runA1m6b}`).expect(200);
    const snap = body.metricsSnapshot;
    expect(snap.analysisVersion).toBe(M6B);
    expect(typeof snap.overall.visibilityRate).toBe("number");
    expect(Array.isArray(snap.byCategory)).toBe(true);
    expect(snap.byQuery.length).toBeGreaterThanOrEqual(1);
    expect(snap.competitor.status).toBe("ready");
    expect(snap.competitor.competitors[0].canonicalName).toBe("ChatGPT");
    expect(body.requestedModel).toBe("geolens-mock");
    expect(body.responseModel).toBe("geolens-mock");
  });

  it("REAL 报告（requested≠response）身份快照正确 + metricSource=real", async () => {
    const { body } = await owner.post(`/benchmark-runs/${ids.runA6}/reports`).send({ analysisVersion: M4 }).expect(201);
    expect(body.metricSource).toBe("real");
    expect(body.requestedModel).toBe("deepseek-chat");
    expect(body.responseModel).toBe("deepseek-v4-flash");
  });

  it("竞品集 v2 激活后旧报告仍显示 v1（不漂移）；新分析不改变旧报告", async () => {
    await owner.post(`/competitor-sets/${ids.setV2}/activate`).expect(201);
    const { body } = await owner.get(`/reports/${reportIds.runA1m6b}`).expect(200);
    expect(body.competitorSet.version).toBe("1");
    const before = JSON.stringify(body.metricsSnapshot);
    const { body: again } = await owner.post(`/benchmark-runs/${ids.runA1}/reports`).send({ analysisVersion: M6B }).expect(201);
    expect(again.competitorSet.version).toBe("1"); // 新快照仍绑定 v1（run 分析引用 v1）
    const unchanged = (await owner.get(`/reports/${reportIds.runA1m6b}`).expect(200)).body;
    expect(JSON.stringify(unchanged.metricsSnapshot)).toBe(before);
  });

  it("PARTIAL 报告：partial=true、保留成功/失败分母（失败分母 preserved）", async () => {
    const { body } = await owner.post(`/benchmark-runs/${ids.runA2}/reports`).send({ analysisVersion: M4 }).expect(201);
    expect(body.completion.partial).toBe(true);
    expect(body.completion.succeededRuns).toBe(1);
    expect(body.completion.failedRuns).toBe(1);
    expect(body.completion.analyzedRuns).toBe(1);
  });

  it("指定不存在的 analysisVersion → 400", async () => {
    await owner.post(`/benchmark-runs/${ids.runA1}/reports`).send({ analysisVersion: "ghost-v9" }).expect(400);
  });

  it("Report Evidence 回链：rows 含 queryText/category/status/evidenceId", async () => {
    const { body } = await owner.get(`/reports/${reportIds.runA1m6b}/evidence`).expect(200);
    expect(body.rows.length).toBeGreaterThanOrEqual(2);
    const row = body.rows[0];
    expect(row.runId).toBeTruthy();
    expect(row.queryText).toBeTruthy();
    expect(row.evidenceId).toBeTruthy();
    expect(row.hasSnapshotAnalysis).toBe(true);
    expect(["SUCCEEDED", "FAILED"]).toContain(row.status);
  });

  // ---------------- Compare ----------------
  it("同口径（suite/mock/model/m4/demo）→ COMPARABLE + Δ 数值", async () => {
    const repA = (await owner.post(`/benchmark-runs/${ids.runA4}/reports`).send({ analysisVersion: M4 }).expect(201)).body;
    reportIds.runA4m4 = repA.id;
    const { body } = await owner.post("/reports/compare").send({ reportAId: reportIds.runA1m4, reportBId: repA.id }).expect(201);
    expect(body.compatibility.verdict).toBe("COMPARABLE");
    const vis = body.deltaOverall.find((row: { metric: string }) => row.metric === "visibilityRate");
    expect(typeof vis.delta).toBe("number");
    expect(body.warnings).toEqual([]);
  });

  it("suiteVersion 失配 → NOT_COMPARABLE + 口径警告", async () => {
    const repV2 = (await owner.post(`/benchmark-runs/${ids.runA5}/reports`).send({ analysisVersion: M4 }).expect(201)).body;
    const { body } = await owner.post("/reports/compare").send({ reportAId: reportIds.runA1m4, reportBId: repV2.id }).expect(201);
    expect(body.compatibility.verdict).toBe("NOT_COMPARABLE");
    expect(body.compatibility.dimensions.find((d: { key: string }) => d.key === "suiteVersion")?.compatible).toBe(false);
    expect(body.warnings.length).toBeGreaterThan(0);
  });

  it("provider / requestedModel / responseModel 失配维度被暴露（对比含逐维报告）", async () => {
    // runA6 是 REAL + deepseek + 模型身份差异 → 与 runA1m4 (DEMO/mock) 对比
    const repReal = (await owner.post(`/benchmark-runs/${ids.runA6}/reports`).send({ analysisVersion: M4 }).expect(201)).body;
    const { body } = await owner.post("/reports/compare").send({ reportAId: reportIds.runA1m4, reportBId: repReal.id }).expect(201);
    const dims = body.compatibility.dimensions;
    expect(dims.find((d: { key: string }) => d.key === "provider")?.compatible).toBe(false);
    expect(dims.find((d: { key: string }) => d.key === "requestedModel")?.compatible).toBe(false);
    expect(dims.find((d: { key: string }) => d.key === "responseModel")?.compatible).toBe(false);
    expect(["PARTIALLY_COMPARABLE", "NOT_COMPARABLE"]).toContain(body.compatibility.verdict);
  });

  it("compare null 指标 → delta=null（不 NaN）", async () => {
    const repA = (await owner.post(`/benchmark-runs/${ids.runA2}/reports`).send({ analysisVersion: M4 }).expect(201)).body; // PARTIAL 对照
    const { body } = await owner.post("/reports/compare").send({ reportAId: reportIds.runA1m4, reportBId: repA.id }).expect(201);
    for (const row of body.deltaOverall) {
      if (row.a === null || row.b === null) expect(row.delta).toBeNull();
    }
  });

  // ---------------- 隔离与鉴权 ----------------
  it("跨租户：外租户读/生成/对比/回链 → 404", async () => {
    await outsider.get(`/reports/${reportIds.runA1m6b}`).expect(404);
    await outsider.get(`/projects/${ids.projectA}/reports`).expect(404);
    await outsider.post(`/benchmark-runs/${ids.runA1}/reports`).send({}).expect(404);
    await outsider.get(`/reports/${reportIds.runA1m6b}/evidence`).expect(404);
    await outsider.post("/reports/compare").send({ reportAId: reportIds.runA1m4, reportBId: reportIds.runA1m6b }).expect(404);
  });

  it("未认证访问全部 reports 端点 → 401", async () => {
    await request(app.getHttpServer()).post(`/benchmark-runs/${ids.runA1}/reports`).send({}).expect(401);
    await request(app.getHttpServer()).get(`/projects/${ids.projectA}/reports`).expect(401);
    await request(app.getHttpServer()).get(`/reports/${reportIds.runA1m6b}`).expect(401);
    await request(app.getHttpServer()).get(`/reports/${reportIds.runA1m6b}/evidence`).expect(401);
    await request(app.getHttpServer()).post("/reports/compare").send({}).expect(401);
  });

  // ---------------- 公开分享与令牌安全 ----------------
  it("公开分享报告：授权用户创建分享 → 获得不可猜测 shareToken → 匿名凭 Token 读取白名单数据", async () => {
    const reportId = reportIds.runA1m4;
    // 1. 外部直接用 reportId 猜测访问公开端点 → 404 (防止遍历猜测私有报告)
    await request(app.getHttpServer()).get(`/public/reports/${reportId}`).expect(404);

    // 2. 非租户成员创建分享 → 404
    await outsider.post(`/reports/${reportId}/share`).expect(404);

    // 3. 授权用户主动创建分享 → 成功生成 48 位安全 shareToken
    const { body: shareMeta } = await owner.post(`/reports/${reportId}/share`).expect(201);
    expect(shareMeta.shareToken).toBeDefined();
    expect(typeof shareMeta.shareToken).toBe("string");
    expect(shareMeta.shareToken.length).toBeGreaterThanOrEqual(32);
    expect(shareMeta.shareEnabled).toBe(true);

    // 4. 匿名用户使用 shareToken 访问公开报告 → 200，且仅暴露白名单聚合字段
    const { body: publicRep } = await request(app.getHttpServer())
      .get(`/public/reports/${shareMeta.shareToken}`)
      .expect(200);
    expect(publicRep.shareToken).toBe(shareMeta.shareToken);
    expect(publicRep.suiteName).toBeDefined();
    expect(publicRep.metricsSnapshot).toBeDefined();
    // 白名单验证：不得泄露租户 ID、内部组织 ID 与私有配置
    expect(publicRep.projectId).toBeUndefined();
    expect(publicRep.organizationId).toBeUndefined();
    expect(publicRep.metadata).toBeUndefined();

    // 5. 授权用户撤销分享 → 成功
    await owner.post(`/reports/${reportId}/revoke-share`).expect(201);

    // 6. 撤销后再次以 shareToken 访问 → 404 (立即失效)
    await request(app.getHttpServer()).get(`/public/reports/${shareMeta.shareToken}`).expect(404);
  });
});
