/**
 * M6D Multi-Provider（DeepSeek vs Qwen）e2e（geo_test）。
 * 覆盖清单 27-46：同 suite 两 Provider 报告、planned 数、multi cost guard、
 * 未配置 guard、失败分母、对比 = PARTIALLY_COMPARABLE（口径说明）、provider/模型维度、
 * 场景矩阵、query 证据 A/B 回链、成功样本差异警告、401/404 隔离。0 次真实调用。
 */
import "../../../packages/database/scripts/test-env.cjs";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";

const M4 = "m4-rule-v1";
const SEQ = { value: 0 };

describe("Multi-Provider M6D e2e", () => {
  let app: INestApplication;
  let owner: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const email = `mp-${suffix}@m6d.test.com`;
  const password = "m6d-e2e-pass-123";
  const ids: Record<string, string> = {};
  const reportIds: Record<string, string> = {};

  const mkEngine = async (key: string, provider: string) =>
    prisma.engine.create({ data: { key, name: key, provider, config: provider === "mock" ? { delayMs: 0 } : {} as never } });

  async function addEvidenceRun(args: {
    projectId: string; taskId: string; bRunId: string; engineId: string;
    provider: string; sourceType: string; requestedModel: string; responseModel: string;
    runStatus?: "SUCCEEDED" | "FAILED"; analysisVersion?: string;
  }) {
    const query = await prisma.query.create({ data: { projectId: args.projectId, text: `mp q ${SEQ.value} ${randomUUID()}` } });
    const run = await prisma.run.create({ data: {
      monitorTaskId: args.taskId, queryId: query.id, engineId: args.engineId,
      status: args.runStatus ?? "SUCCEEDED", analysisStatus: args.analysisVersion ? "SUCCEEDED" : "PENDING",
      executionToken: randomUUID(),
    } });
    await prisma.benchmarkRunQuery.create({ data: {
      benchmarkRunId: args.bRunId, benchmarkQueryId: randomUUID(), projectQueryId: query.id,
      queryText: query.text, category: "tool-discovery", intent: `intent ${SEQ.value}`,
      locale: "zh-CN", sortOrder: SEQ.value, sanity: false,
    } });
    SEQ.value += 1;
    const evidence = await prisma.evidence.create({ data: {
      runId: run.id, queryText: query.text,
      rawPrompt: JSON.stringify({ model: args.requestedModel }),
      rawResponse: `response ${query.text}`, provider: args.provider,
      engineKey: args.engineId, engineName: args.provider === "qwen" ? "通义千问" : "DeepSeek",
      requestedModel: args.requestedModel, responseModel: args.responseModel,
      model: args.responseModel, modelVersion: args.responseModel,
      retrievalMode: "api_plain", sourceType: args.sourceType as never, metadata: {}, entitySnapshot: [],
    } });
    if (args.analysisVersion) {
      await prisma.analysis.create({ data: {
        evidenceId: evidence.id, analysisVersion: args.analysisVersion,
        brandMentioned: true, mentionPosition: 1, recommended: true, sentiment: "positive",
      } });
    }
    return { run, evidence };
  }

  async function mkBench(args: { organizationId: string; projectId: string; engineId: string; provider: string; status?: "SUCCEEDED" | "PARTIAL" }) {
    const suite = await prisma.benchmarkSuite.create({ data: {
      projectId: args.projectId, name: `MP Suite ${randomUUID().slice(0, 6)}`, version: "1", status: "ACTIVE",
    } });
    const failed = args.status === "PARTIAL" ? 1 : 0;
    const task = await prisma.monitorTask.create({ data: {
      organizationId: args.organizationId, projectId: args.projectId,
      status: args.status === "PARTIAL" ? "PARTIAL" : "SUCCEEDED",
      totalRuns: 2, completedRuns: failed ? 1 : 2, failedRuns: failed,
    } });
    const bRun = await prisma.benchmarkRun.create({ data: {
      organizationId: args.organizationId, projectId: args.projectId, suiteId: suite.id,
      suiteName: suite.name, suiteVersion: "1", runType: "REAL", provider: args.provider,
      engineId: args.engineId, monitorTaskId: task.id, status: args.status === "PARTIAL" ? "PARTIAL" : "SUCCEEDED",
      plannedRuns: 2, completedRuns: failed ? 1 : 2, failedRuns: failed,
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
    const res = await request(app.getHttpServer()).post("/auth/register").send({ email, name: "MP", password });
    expect(res.status).toBe(201);
    ids.org = res.body.organization.id;
    const project = await prisma.project.create({ data: { organizationId: ids.org, name: `MP Project ${suffix}`, industry: "SaaS" } });
    ids.project = project.id;

    const ds = await mkEngine(`mp-ds-${suffix}`, "deepseek");
    const qw = await mkEngine(`mp-qw-${suffix}`, "qwen");
    ids.ds = ds.id;
    ids.qw = qw.id;

    // DeepSeek run（全成功，m4）
    const ra = await mkBench({ organizationId: ids.org, projectId: ids.project, engineId: ds.id, provider: "deepseek" });
    ids.dsRun = ra.bRun.id;
    await addEvidenceRun({ projectId: ids.project, taskId: ra.task.id, bRunId: ra.bRun.id, engineId: ds.id, provider: "deepseek", sourceType: "official_api", requestedModel: "deepseek-chat", responseModel: "deepseek-v4-flash", analysisVersion: M4 });
    await addEvidenceRun({ projectId: ids.project, taskId: ra.task.id, bRunId: ra.bRun.id, engineId: ds.id, provider: "deepseek", sourceType: "official_api", requestedModel: "deepseek-chat", responseModel: "deepseek-v4-flash", analysisVersion: M4 });
    // Qwen run（全成功，m4）
    const rb = await mkBench({ organizationId: ids.org, projectId: ids.project, engineId: qw.id, provider: "qwen" });
    ids.qwRun = rb.bRun.id;
    await addEvidenceRun({ projectId: ids.project, taskId: rb.task.id, bRunId: rb.bRun.id, engineId: qw.id, provider: "qwen", sourceType: "official_api", requestedModel: "qwen-plus", responseModel: "qwen-plus-latest", analysisVersion: M4 });
    await addEvidenceRun({ projectId: ids.project, taskId: rb.task.id, bRunId: rb.bRun.id, engineId: qw.id, provider: "qwen", sourceType: "official_api", requestedModel: "qwen-plus", responseModel: "qwen-plus-latest", analysisVersion: M4 });
    // Qwen partial run（1 失败）→ 成功样本差异
    const rc = await mkBench({ organizationId: ids.org, projectId: ids.project, engineId: qw.id, provider: "qwen", status: "PARTIAL" });
    ids.qwPartialRun = rc.bRun.id;
    await addEvidenceRun({ projectId: ids.project, taskId: rc.task.id, bRunId: rc.bRun.id, engineId: qw.id, provider: "qwen", sourceType: "official_api", requestedModel: "qwen-plus", responseModel: "qwen-plus", analysisVersion: M4 });
    await addEvidenceRun({ projectId: ids.project, taskId: rc.task.id, bRunId: rc.bRun.id, engineId: qw.id, provider: "qwen", sourceType: "official_api", requestedModel: "qwen-plus", responseModel: "qwen-plus", runStatus: "FAILED" });

    await owner.post("/auth/login").send({ email, password }).expect(200);
  }, 90000);

  afterAll(async () => {
    try {
      await prisma.benchmarkReport.deleteMany({ where: { projectId: ids.project } });
      const projects = await prisma.project.findMany({ where: { id: ids.project } });
      for (const p of projects) {
        await prisma.analysis.deleteMany({ where: { evidence: { run: { monitorTask: { projectId: p.id } } } } });
        await prisma.evidence.deleteMany({ where: { run: { monitorTask: { projectId: p.id } } } });
        await prisma.run.deleteMany({ where: { monitorTask: { projectId: p.id } } });
        await prisma.benchmarkRun.deleteMany({ where: { projectId: p.id } });
        await prisma.monitorTask.deleteMany({ where: { projectId: p.id } });
        await prisma.benchmarkSuite.deleteMany({ where: { projectId: p.id } });
        await prisma.query.deleteMany({ where: { projectId: p.id } });
      }
      await prisma.project.deleteMany({ where: { id: ids.project } });
      await prisma.engine.deleteMany({ where: { id: { in: [ids.ds, ids.qw] } } });
      await prisma.organizationMember.deleteMany({ where: { organizationId: ids.org } });
      await prisma.organization.deleteMany({ where: { id: ids.org } });
      await prisma.user.deleteMany({ where: { email } });
    } finally {
      await app.close();
      await prisma.$disconnect();
    }
  });

  // ---------------- 27-29：同 suite 两 Provider 报告 + planned ----------------
  it("同 suite 分别 DeepSeek / Qwen 运行并各出报告（REAL/official_api/api_plain 身份分离）", async () => {
    const dsRep = (await owner.post(`/benchmark-runs/${ids.dsRun}/reports`).send({ analysisVersion: M4 }).expect(201)).body;
    const qwRep = (await owner.post(`/benchmark-runs/${ids.qwRun}/reports`).send({ analysisVersion: M4 }).expect(201)).body;
    reportIds.ds = dsRep.id;
    reportIds.qw = qwRep.id;
    expect(dsRep.metricSource).toBe("real");
    expect(dsRep.requestedModel).toBe("deepseek-chat");
    expect(dsRep.responseModel).toBe("deepseek-v4-flash");
    expect(qwRep.provider).toBe("qwen");
    expect(qwRep.requestedModel).toBe("qwen-plus");
    expect(qwRep.responseModel).toBe("qwen-plus-latest");
    expect(qwRep.runType).toBe("REAL");
  });

  it("两报告 provider/测试集/分析版本一致，模型身份分离 → 对比 PARTIALLY_COMPARABLE（跨 Provider 文案）", async () => {
    const { body } = await owner.post("/reports/compare").send({ reportAId: reportIds.ds, reportBId: reportIds.qw }).expect(201);
    expect(body.compatibility.verdict).toBe("PARTIALLY_COMPARABLE");
    const dims = body.compatibility.dimensions;
    expect(dims.find((d: { key: string }) => d.key === "provider")?.compatible).toBe(false);
    expect(dims.find((d: { key: string }) => d.key === "suiteVersion")?.compatible).toBe(true);
    expect(dims.find((d: { key: string }) => d.key === "analysisVersion")?.compatible).toBe(true);
    expect(dims.find((d: { key: string }) => d.key === "competitorSetVersion")?.compatible).toBe(true);
    expect(body.warnings.some((w: string) => w.includes("模型服务不同"))).toBe(true);
    expect(body.warnings.some((w: string) => w.includes("完整"))).toBe(false); // 成功样本相同 → 无样本提示
  });

  it("PARTIAL（Qwen 1/2 成功）vs 全成功（DeepSeek 2/2）→ 样本完整性警告 + 失败分母", async () => {
    const qwPart = (await owner.post(`/benchmark-runs/${ids.qwPartialRun}/reports`).send({ analysisVersion: M4 }).expect(201)).body;
    reportIds.qwPart = qwPart.id;
    expect(qwPart.completion.partial).toBe(true);
    expect(qwPart.completion.succeededRuns).toBe(1);
    expect(qwPart.completion.failedRuns).toBe(1);
    const { body } = await owner.post("/reports/compare").send({ reportAId: reportIds.ds, reportBId: qwPart.id }).expect(201);
    expect(body.warnings.some((w: string) => w.includes("样本完整性不同，比较需谨慎"))).toBe(true);
  });

  it("场景矩阵保留（A/B 均有 byCategory）+ query 证据 A/B 回链", async () => {
    const evA = (await owner.get(`/reports/${reportIds.ds}/evidence`).expect(200)).body;
    const evB = (await owner.get(`/reports/${reportIds.qw}/evidence`).expect(200)).body;
    expect(evA.rows.length).toBe(2);
    expect(evB.rows.length).toBe(2);
    const aRows = (evA.rows as Array<{ queryText: string }>).map(r => r.queryText);
    const bRows = (evB.rows as Array<{ queryText: string }>).map(r => r.queryText);
    expect(aRows.some(t => bRows.includes(t))).toBe(false); // 不同 run 的 query 文本（各 run 镜像）
    expect(evA.rows[0].evidenceId).toBeTruthy();
    expect(evB.rows[0].evidenceId).toBeTruthy();
    const reportA = (await owner.get(`/reports/${reportIds.ds}`).expect(200)).body;
    expect(Array.isArray(reportA.metricsSnapshot.byCategory)).toBe(true);
  });

  it("planned/cost guard：qwen 未配置 → 400（不产生调用）；超上限 → 400 且明示计划 2 次真实调用", async () => {
    // 构造可 startRun 的 suite（2 条启用镜像 query）
    const queries = [];
    for (let i = 0; i < 2; i++) {
      const q = await prisma.query.create({ data: { projectId: ids.project, text: `guard ${suffix} ${i}` } });
      queries.push(q.id);
    }
    const suite = await prisma.benchmarkSuite.create({ data: { projectId: ids.project, name: `Guard ${suffix}`, version: "1", status: "ACTIVE" } });
    for (let i = 0; i < 2; i++) {
      await prisma.benchmarkQuery.create({ data: {
        suiteId: suite.id, projectQueryId: queries[i], queryText: `guard ${suffix} ${i}`,
        category: "workflow", intent: "howto", locale: "zh-CN", sortOrder: i, enabled: true,
      } });
    }
    ids.suiteForGuard = suite.id;

    try {
      // qwen 无配置（显式清空 env，防止宿主 .env 已配置真实 Key 而改变前提）→ 400 中文 guard
      delete process.env.ENABLE_REAL_PROVIDERS;
      delete process.env.QWEN_API_KEY;
      delete process.env.QWEN_MODEL;
      const noCfg = await owner.post(`/benchmark-suites/${suite.id}/runs`).send({ engineId: ids.qw, runType: "real" });
      expect(noCfg.status).toBe(400);
      expect(String(noCfg.body.message)).toContain("未配置");

      // 配置就绪但 planned=2 > cap=1 → 400，明示计划真实调用次数
      process.env.ENABLE_REAL_PROVIDERS = "true";
      process.env.QWEN_API_KEY = "sk-m6d-e2e-fake-key";
      process.env.QWEN_MODEL = "qwen-plus";
      process.env.REAL_PROVIDER_MAX_RUNS_PER_TASK = "1";
      const overCap = await owner.post(`/benchmark-suites/${suite.id}/runs`).send({ engineId: ids.qw, runType: "real" });
      expect(overCap.status).toBe(400);
      expect(String(overCap.body.message)).toContain("2 次真实调用");
      expect(String(overCap.body.message)).toMatch(/超过|上限/);
      expect(String(overCap.body.message)).toContain("REAL_PROVIDER_MAX_RUNS_PER_TASK");
    } finally {
      delete process.env.ENABLE_REAL_PROVIDERS;
      delete process.env.QWEN_API_KEY;
      delete process.env.QWEN_MODEL;
      delete process.env.REAL_PROVIDER_MAX_RUNS_PER_TASK;
    }
  });

  it("401 / 跨租户隔离：未认证与异租户访问报告/对比 → 401/404", async () => {
    await request(app.getHttpServer()).post(`/benchmark-runs/${ids.dsRun}/reports`).send({}).expect(401);
    await request(app.getHttpServer()).post("/reports/compare").send({ reportAId: reportIds.ds, reportBId: reportIds.qw }).expect(401);
    const other = request.agent(app.getHttpServer());
    const res = await request(app.getHttpServer()).post("/auth/register").send({ email: `mp-oth-${suffix}@m6d.test.com`, name: "O", password });
    const otherOrg = res.body.organization.id;
    await other.post("/auth/login").send({ email: `mp-oth-${suffix}@m6d.test.com`, password }).expect(200);
    await other.get(`/reports/${reportIds.ds}`).expect(404);
    await other.get(`/projects/${ids.project}/reports`).expect(404);
    await other.post("/reports/compare").send({ reportAId: reportIds.ds, reportBId: reportIds.qw }).expect(404);
    await prisma.organizationMember.deleteMany({ where: { organizationId: otherOrg } });
    await prisma.organization.deleteMany({ where: { id: otherOrg } });
    await prisma.user.deleteMany({ where: { email: `mp-oth-${suffix}@m6d.test.com` } });
  });
});
