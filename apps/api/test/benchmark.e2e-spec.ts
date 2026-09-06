/**
 * M6A Benchmark e2e（真实 PostgreSQL geo_test + 真实 Redis）。
 * 硬保护：setupFiles 已加载 packages/database/scripts/test-env.cjs，强制 geo_test。
 *
 * 覆盖（对照 M6A 测试清单）：
 *   1.  suite versioning：POST 同名同版本重复 → 400；GET 列表/详情含版本
 *   2.  Benchmark v1 24 query seed exact（enabled main = 24，sanity = 2 disabled）
 *   3.  category distribution：6 类 × 4 = 24
 *   4.  ownership/auth：401、跨租户 suite/run 404
 *   5.  create benchmark run（demo）→ 202、plannedRuns = queries、runs PENDING/QUEUED
 *   6.  real-run guard：deepseek 未配置 → 400；超过 cap → 400（planned 数明示）
 *   7.  evidence linkage：GET /benchmark-runs/:id 返回按 query 的 run + analysisStatus
 *   8.  analysis linkage / metrics：overall + byCategory + byQuery 三级聚合
 *   9.  failed run denominator：只以 SUCCEEDED+已分析为 eligible
 *  10.  demo/real isolation：mixed 任务只统计 real 子集（metricSource=mixed/real/demo）
 *  11.  competitorScope = pending-m6b（不输出误导性 SoV 结论）
 */
import "../../../packages/database/scripts/test-env.cjs";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";
import {
  BENCHMARK_V1_QUERIES,
  BENCHMARK_V1_SUITE,
  benchmarkCategoryCounts,
} from "../../../packages/database/scripts/benchmark-queries";

describe("Benchmark M6A e2e", () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication["getHttpServer"]>;
  let owner: ReturnType<typeof request.agent>;
  let outsider: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const emailA = `bench-a-${suffix}@m6e2e.test.com`;
  const emailB = `bench-b-${suffix}@m6e2e.test.com`;
  const password = "m6-e2e-pass-123";

  const ids = {
    orgA: "", orgB: "", projectA: "", projectB: "",
    engines: [] as string[],
    seededSuiteId: "",
    demoSuiteId: "",
    demoRunId: "",
    metricsSuiteId: "",
    metricsRunId: "",
    mixedRunId: "",
  };

  const mainQueries = BENCHMARK_V1_QUERIES.filter(query => query.enabled && !query.sanity);
  const sanityQueries = BENCHMARK_V1_QUERIES.filter(query => query.sanity);
  const counts = benchmarkCategoryCounts(BENCHMARK_V1_QUERIES);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    http = app.getHttpServer();
    owner = request.agent(http);
    outsider = request.agent(http);

    const register = async (email: string) => {
      const res = await request(http).post("/auth/register").send({ email, name: "Bench User", password });
      expect(res.status).toBe(201);
      return res.body as { user: { id: string }; organization: { id: string } };
    };
    const a = await register(emailA);
    const b = await register(emailB);
    ids.orgA = a.organization.id;
    ids.orgB = b.organization.id;
    const projectA = await prisma.project.create({ data: { organizationId: ids.orgA, name: `Bench A ${suffix}` } });
    const projectB = await prisma.project.create({ data: { organizationId: ids.orgB, name: `Bench B ${suffix}` } });
    ids.projectA = projectA.id;
    ids.projectB = projectB.id;

    const mockEngine = await prisma.engine.create({ data: { key: `bench-mock-${suffix}`, name: "Bench mock", provider: "mock", config: { delayMs: 10 } } });
    const deepseekEngine = await prisma.engine.create({ data: { key: `bench-ds-${suffix}`, name: "Bench deepseek", provider: "deepseek" } });
    ids.engines.push(mockEngine.id, deepseekEngine.id);

    // ============ fixture 1: 版本化 suite（API createSuite 路径） ============
    const ownerSession = await owner.post("/auth/login").send({ email: emailA, password }).expect(200);
    expect(ownerSession.status).toBe(200);
    const seeded = await owner.post(`/projects/${ids.projectA}/benchmark-suites`).send({
      name: BENCHMARK_V1_SUITE.name,
      version: BENCHMARK_V1_SUITE.version,
      description: BENCHMARK_V1_SUITE.description,
      queries: BENCHMARK_V1_QUERIES.map(query => ({
        queryText: query.queryText, category: query.category, intent: query.intent,
        locale: query.locale, weight: query.weight, enabled: query.enabled,
        sortOrder: query.sortOrder, sanity: query.sanity,
      })),
    }).expect(201);
    ids.seededSuiteId = seeded.body.id;

    // ============ fixture 2: metrics / evidence linkage（直接落库 fixture） ============
    // 6 queries：tool-discovery×2 / comparison×1 / competition×1 succeeded+analyzed，
    // competition×1 FAILED，workflow×1 PENDING → denominator 与 category 聚合可断言。
    const metricsSuite = await prisma.benchmarkSuite.create({ data: {
      projectId: ids.projectA, name: `Metrics Suite ${suffix}`, version: "1",
    } });
    ids.metricsSuiteId = metricsSuite.id;
    const defs = [
      { text: "m-q-td1", category: "tool-discovery" },
      { text: "m-q-td2", category: "tool-discovery" },
      { text: "m-q-cmp", category: "comparison" },
      { text: "m-q-ctf", category: "competition" },
      { text: "m-q-fail", category: "competition" },
      { text: "m-q-pend", category: "workflow" },
    ] as const;
    const benchQueryIds: string[] = [];
    const projectQueryIds: string[] = [];
    for (const [index, def] of defs.entries()) {
      const q = await prisma.query.create({ data: {
        projectId: ids.projectA, text: `${def.text} ${suffix}`, source: "IMPORTED", status: "PAUSED",
      } });
      projectQueryIds.push(q.id);
      const bq = await prisma.benchmarkQuery.create({ data: {
        suiteId: metricsSuite.id, sortOrder: index, queryText: q.text,
        category: def.category, intent: `${def.category} intent`, projectQueryId: q.id,
      } });
      benchQueryIds.push(bq.id);
    }

    const rawPrompt = "Benchmark prompt";
    const rawResponse = "推荐 GeoLens\nhttps://example.com/bench";
    const mkRun = async (taskId: string, queryIdx: number, status: string) => {
      const run = await prisma.run.create({ data: {
        monitorTaskId: taskId, queryId: projectQueryIds[queryIdx], engineId: mockEngine.id,
        status: status as never, analysisStatus: status === "SUCCEEDED" ? "SUCCEEDED" : "PENDING",
        executionToken: status === "SUCCEEDED" ? randomUUID() : null,
      } });
      if (status !== "SUCCEEDED") return run;
      const evidence = await prisma.evidence.create({ data: {
        runId: run.id, queryText: defs[queryIdx].text, rawPrompt, rawResponse,
        provider: "mock", engineKey: "bench-mock", engineName: "Bench mock",
        model: "geolens-mock", modelVersion: "1", retrievalMode: "unknown", sourceType: "mock",
        metadata: { fixture: true }, entitySnapshot: [],
      } });
      const mentioned = queryIdx !== 1; // td2 不提及品牌
      await prisma.analysis.create({ data: {
        evidenceId: evidence.id, analysisVersion: "m4-rule-v1", brandMentioned: mentioned,
        mentionPosition: mentioned ? 1 : null, recommended: mentioned, sentiment: mentioned ? "positive" : "unknown",
        mentions: mentioned ? { create: [{
          entityType: "brand", entityId: "brand-geolens", canonicalName: "GeoLens", displayName: "GeoLens",
          position: 1, context: rawResponse, sentiment: "positive", startOffset: 5, endOffset: 12,
        }] } : undefined,
        citations: { create: [{ url: "https://example.com/bench", domain: "example.com", title: null, position: 1 }] },
      } });
      return run;
    };
    // metrics demo run（全 mock）
    const task1 = await prisma.monitorTask.create({ data: {
      organizationId: ids.orgA, projectId: ids.projectA, totalRuns: 6, status: "PARTIAL",
    } });
    await mkRun(task1.id, 0, "SUCCEEDED");
    await mkRun(task1.id, 1, "SUCCEEDED");
    await mkRun(task1.id, 2, "SUCCEEDED");
    await mkRun(task1.id, 3, "SUCCEEDED");
    await mkRun(task1.id, 4, "FAILED");
    // queryIdx 5 PENDING
    await prisma.run.create({ data: {
      monitorTaskId: task1.id, queryId: projectQueryIds[5], engineId: mockEngine.id,
      status: "PENDING", analysisStatus: "PENDING",
    } });
    const metricsRun = await prisma.benchmarkRun.create({ data: {
      organizationId: ids.orgA, projectId: ids.projectA, suiteId: metricsSuite.id,
      suiteName: metricsSuite.name, suiteVersion: "1", runType: "DEMO", provider: "mock",
      engineId: mockEngine.id, monitorTaskId: task1.id, plannedRuns: 6, status: "PARTIAL",
    } });
    ids.metricsRunId = metricsRun.id;

    // metrics mixed run（deepseek real + mock demo）
    const task2 = await prisma.monitorTask.create({ data: {
      organizationId: ids.orgA, projectId: ids.projectA, totalRuns: 3, status: "SUCCEEDED",
    } });
    for (const [idx, engineId] of [[0, deepseekEngine.id], [1, deepseekEngine.id], [2, mockEngine.id]] as const) {
      const run = await prisma.run.create({ data: {
        monitorTaskId: task2.id, queryId: projectQueryIds[idx], engineId: engineId as string,
        status: "SUCCEEDED", analysisStatus: "SUCCEEDED", executionToken: randomUUID(),
      } });
      const mentioned = true;
      const evidence = await prisma.evidence.create({ data: {
        runId: run.id, queryText: defs[idx].text, rawPrompt, rawResponse,
        provider: engineId === deepseekEngine.id ? "deepseek" : "mock",
        engineKey: engineId === deepseekEngine.id ? "bench-ds" : "bench-mock",
        engineName: "Engine", model: "deepseek-chat", modelVersion: "v1",
        retrievalMode: "api_plain", sourceType: "official_api", metadata: {}, entitySnapshot: [],
      } });
      await prisma.analysis.create({ data: {
        evidenceId: evidence.id, analysisVersion: "m4-rule-v1", brandMentioned: mentioned,
        mentionPosition: 1, recommended: mentioned, sentiment: "positive",
        mentions: { create: [{
          entityType: "brand", entityId: "brand-geolens", canonicalName: "GeoLens", displayName: "GeoLens",
          position: 1, context: rawResponse, sentiment: "positive", startOffset: 5, endOffset: 12,
        }] },
      } });
    }
    const mixedRun = await prisma.benchmarkRun.create({ data: {
      organizationId: ids.orgA, projectId: ids.projectA, suiteId: metricsSuite.id,
      suiteName: metricsSuite.name, suiteVersion: "1", runType: "REAL", provider: "deepseek",
      engineId: deepseekEngine.id, monitorTaskId: task2.id, plannedRuns: 3, status: "SUCCEEDED",
    } });
    ids.mixedRunId = mixedRun.id;
  });

  afterAll(async () => {
    if (!ids.orgA) return;
    try {
      // 依赖逆序清理
      await prisma.benchmarkRun.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
      await prisma.monitorTask.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
      await prisma.engine.deleteMany({ where: { id: { in: ids.engines } } });
      await prisma.project.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
      await prisma.organizationMember.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
      await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } });
      await prisma.user.deleteMany({ where: { email: { contains: "@m6e2e.test.com" } } });
    } finally {
      await app.close();
      await prisma.$disconnect();
    }
  });

  // ---------- auth / ownership ----------
  it("未认证访问全部 benchmark 端点 → 401", async () => {
    await request(http).get(`/projects/${ids.projectA}/benchmark-suites`).expect(401);
    await request(http).get(`/benchmark-suites/${randomUUID()}`).expect(401);
    await request(http).post(`/benchmark-suites/${randomUUID()}/runs`).send({}).expect(401);
    await request(http).get(`/benchmark-runs/${randomUUID()}`).expect(401);
    await request(http).get(`/benchmark-runs/${randomUUID()}/metrics`).expect(401);
  });

  it("跨租户访问 suite / run → 404（不泄露存在性）", async () => {
    await outsider.post("/auth/login").send({ email: emailB, password }).expect(200);
    await outsider.get(`/projects/${ids.projectA}/benchmark-suites`).expect(404);
    await outsider.get(`/benchmark-suites/${ids.seededSuiteId}`).expect(404);
    await outsider.get(`/benchmark-runs/${ids.metricsRunId}`).expect(404);
    await outsider.get(`/benchmark-runs/${ids.metricsRunId}/metrics`).expect(404);
  });

  // ---------- suite versioning / seed exact / category distribution ----------
  it("同名同版本 suite 重复创建 → 400（版本化唯一）", async () => {
    await owner.post(`/projects/${ids.projectA}/benchmark-suites`).send({
      name: BENCHMARK_V1_SUITE.name, version: BENCHMARK_V1_SUITE.version,
      queries: [{ queryText: "x", category: "workflow", intent: "i" }],
    }).expect(400);
  });

  it("Benchmark v1 seed exact：24 main enabled + 2 sanity disabled；6 类 × 4", async () => {
    expect(mainQueries).toHaveLength(24);
    expect(sanityQueries).toHaveLength(2);
    expect(sanityQueries.every(query => query.enabled === false && query.sanity === true)).toBe(true);
    expect([...counts.values()].sort()).toEqual([4, 4, 4, 4, 4, 4]);
    for (const category of ["tool-discovery", "comparison", "workflow", "recommendation", "pain-point", "competition"]) {
      expect(counts.get(category as never)).toBe(4);
    }
    const allTexts = new Set(mainQueries.map(query => query.queryText));
    expect(allTexts.size).toBe(24);
    // 主查询不得人为提示目标品牌
    expect(mainQueries.some(query => query.queryText.includes("ProjectMentor"))).toBe(false);
  });

  it("GET suite 详情：queryCount=24 / sanity=2 / categoryCounts 6 类各 4 / queries 按 sortOrder", async () => {
    const { body } = await owner.get(`/benchmark-suites/${ids.seededSuiteId}`).expect(200);
    expect(body.name).toBe(BENCHMARK_V1_SUITE.name);
    expect(body.version).toBe("1");
    expect(body.queryCount).toBe(24);
    expect(body.sanityQueryCount).toBe(2);
    expect(body.categoryCounts).toEqual({
      "tool-discovery": 4, comparison: 4, workflow: 4, recommendation: 4, "pain-point": 4, competition: 4,
    });
    expect(body.queries).toHaveLength(26);
    const orders = body.queries.map((query: { sortOrder: number }) => query.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("GET /projects/:id/benchmark-suites 列表含 project 隔离", async () => {
    const { body } = await owner.get(`/projects/${ids.projectA}/benchmark-suites`).expect(200);
    expect(body.length).toBe(2);
    const names = body.map((suite: { name: string }) => suite.name);
    expect(names).toContain(BENCHMARK_V1_SUITE.name);
    expect(names).toContain(`Metrics Suite ${suffix}`);
  });

  // ---------- demo run 创建（管线交接） ----------
  it("Demo Run：202 + plannedRuns=24 + MonitorTask 已建（幂等可重复读）", async () => {
    const mockId = ids.engines[0];
    const { body } = await owner.post(`/benchmark-suites/${ids.seededSuiteId}/runs`)
      .send({ engineId: mockId, runType: "demo" }).expect(202);
    expect(body.plannedRuns).toBe(24);
    expect(body.runType).toBe("DEMO");
    expect(body.provider).toBe("mock");
    expect(body.runs).toHaveLength(24);
    expect(body.suite.name).toBe(BENCHMARK_V1_SUITE.name);
    expect(body.suite.version).toBe("1");
    ids.demoRunId = body.id;
    const again = await owner.get(`/benchmark-runs/${body.id}`).expect(200);
    expect(again.body.id).toBe(body.id);
    expect(again.body.runs.every((run: { status: string }) => ["PENDING", "QUEUED", "RUNNING", "SUCCEEDED"].includes(run.status))).toBe(true);
    const task = await prisma.monitorTask.findUniqueOrThrow({ where: { id: (await prisma.benchmarkRun.findUniqueOrThrow({ where: { id: body.id } })).monitorTaskId } });
    expect(task.totalRuns).toBe(24);
  });

  it("Demo Run 拒绝非 mock 引擎（真实引擎不可被 demo 误触发）", async () => {
    await owner.post(`/benchmark-suites/${ids.seededSuiteId}/runs`)
      .send({ engineId: ids.engines[1], runType: "demo" }).expect(400);
  });

  it("重复派发：同 suite 两次 Start → 两个独立 BenchmarkRun / MonitorTask（无副作用复用）", async () => {
    const first = await owner.post(`/benchmark-suites/${ids.seededSuiteId}/runs`)
      .send({ engineId: ids.engines[0], runType: "demo" }).expect(202);
    const second = await owner.post(`/benchmark-suites/${ids.seededSuiteId}/runs`)
      .send({ engineId: ids.engines[0], runType: "demo" }).expect(202);
    expect(first.body.id).not.toBe(second.body.id);
    const firstTaskId = (await prisma.benchmarkRun.findUniqueOrThrow({ where: { id: first.body.id } })).monitorTaskId;
    const secondTaskId = (await prisma.benchmarkRun.findUniqueOrThrow({ where: { id: second.body.id } })).monitorTaskId;
    expect(firstTaskId).not.toBe(secondTaskId);
    const firstCount = await prisma.run.count({ where: { monitorTaskId: firstTaskId } });
    const secondCount = await prisma.run.count({ where: { monitorTaskId: secondTaskId } });
    expect(firstCount).toBe(24);
    expect(secondCount).toBe(24);
  });

  // ---------- real-run guard（不产生真实调用） ----------
  it("Real Run guard：provider 未启用 → 400 且不创建 run", async () => {
    // geo_test 默认从仓库 .env 读到真实 DeepSeek 配置 → 显式禁用模拟“未配置”
    const previous = process.env.ENABLE_REAL_PROVIDERS;
    const previousKey = process.env.DEEPSEEK_API_KEY;
    delete process.env.ENABLE_REAL_PROVIDERS;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      const before = await prisma.benchmarkRun.count({ where: { suiteId: ids.seededSuiteId } });
      const res = await owner.post(`/benchmark-suites/${ids.seededSuiteId}/runs`)
        .send({ engineId: ids.engines[1], runType: "real" });
      expect(res.status).toBe(400);
      expect(String(res.body.message)).toContain("DeepSeek Provider 未配置");
      const after = await prisma.benchmarkRun.count({ where: { suiteId: ids.seededSuiteId } });
      expect(after).toBe(before);
    } finally {
      if (previous === undefined) delete process.env.ENABLE_REAL_PROVIDERS; else process.env.ENABLE_REAL_PROVIDERS = previous;
      if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previousKey;
    }
  });

  it("Real Run guard：plannedRuns > cap → 400 且报出计划调用数", async () => {
    const previous = process.env.ENABLE_REAL_PROVIDERS;
    const previousKey = process.env.DEEPSEEK_API_KEY;
    process.env.ENABLE_REAL_PROVIDERS = "true";
    process.env.DEEPSEEK_API_KEY = "sk-m6a-test-not-real";
    process.env.REAL_PROVIDER_MAX_RUNS_PER_TASK = "3";
    try {
      const before = await prisma.benchmarkRun.count({ where: { suiteId: ids.seededSuiteId } });
      const res = await owner.post(`/benchmark-suites/${ids.seededSuiteId}/runs`)
        .send({ engineId: ids.engines[1], runType: "real" });
      expect(res.status).toBe(400);
      expect(String(res.body.message)).toContain("24 次真实调用");
      expect(String(res.body.message)).toContain("REAL_PROVIDER_MAX_RUNS_PER_TASK=3");
      const after = await prisma.benchmarkRun.count({ where: { suiteId: ids.seededSuiteId } });
      expect(after).toBe(before);
    } finally {
      if (previous === undefined) delete process.env.ENABLE_REAL_PROVIDERS; else process.env.ENABLE_REAL_PROVIDERS = previous;
      if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previousKey;
      delete process.env.REAL_PROVIDER_MAX_RUNS_PER_TASK;
    }
  });

  // ---------- evidence / analysis linkage + metrics ----------
  it("GET run：evidence linkage —— 每条 run 映射回 benchmark query 与 analysisStatus", async () => {
    const { body } = await owner.get(`/benchmark-runs/${ids.metricsRunId}`).expect(200);
    expect(body.plannedRuns).toBe(6);
    // PENDING 的 q5 被 demo-run 的全局 dispatch 推进为 QUEUED（无 worker → 不终态）
    expect(["RUNNING", "PARTIAL"].includes(body.status)).toBe(true);
    const rows = body.runs as Array<{ queryText: string; category: string; status: string; analysisStatus: string; benchmarkQueryId: string }>;
    const failed = rows.find(row => row.queryText === `m-q-fail ${suffix}`);
    expect(failed?.status).toBe("FAILED");
    const succeeded = rows.filter(row => row.status === "SUCCEEDED");
    expect(succeeded).toHaveLength(4);
    expect(succeeded.every(row => row.analysisStatus === "SUCCEEDED")).toBe(true);
    expect(succeeded.every(row => Boolean(row.benchmarkQueryId))).toBe(true);
  });

  it("GET metrics：overall + byCategory + byQuery，failed/pending 不入 eligible", async () => {
    const { body } = await owner.get(`/benchmark-runs/${ids.metricsRunId}/metrics`).expect(200);
    expect(body.metricVersion).toBe("geolens-v1");
    expect(body.metricSource).toBe("demo");
    expect(body.competitorScope).toMatchObject({ status: "pending-m6b" });
    // overall：totalRuns=6（含 FAILED+PENDING），eligible=4 成功且已分析
    expect(body.overall.totalRuns).toBe(6);
    expect(body.overall.failedRuns).toBe(1);
    expect(body.overall.successfulRuns).toBe(4);
    expect(body.overall.analyzedRuns).toBe(4);
    expect(body.overall.analysisMissingRuns).toBe(0);
    // mentioned: td1, cmp, ctf → 3/4
    expect(body.overall.visibilityRate).toBeCloseTo(0.75);
    expect(body.overall.queryEligibleCount).toBe(4);
    expect(body.overall.queryMentionedCount).toBe(3);
    // byCategory
    const td = body.byCategory.find((row: { category: string }) => row.category === "tool-discovery");
    expect(td).toMatchObject({ queryEligibleCount: 2, queryMentionedCount: 1 });
    expect(td.metrics.visibilityRate).toBeCloseTo(0.5);
    const cmp = body.byCategory.find((row: { category: string }) => row.category === "comparison");
    expect(cmp).toMatchObject({ queryEligibleCount: 1, queryMentionedCount: 1 });
    expect(cmp.metrics.visibilityRate).toBeCloseTo(1);
    // byQuery 保留全部查询（含 FAILED/PENDING，analyzed=false 可钻取错误）
    const byQuery = body.byQuery as Array<{ queryText: string; brandMentioned: boolean | null; category: string; analyzed: boolean; status: string }>;
    expect(byQuery).toHaveLength(6);
    const td1 = byQuery.find(row => row.queryText === `m-q-td1 ${suffix}`);
    expect(td1).toMatchObject({ category: "tool-discovery", analyzed: true, brandMentioned: true });
    const td2 = byQuery.find(row => row.queryText === `m-q-td2 ${suffix}`);
    expect(td2?.brandMentioned).toBe(false);
    const failedRow = byQuery.find(row => row.queryText === `m-q-fail ${suffix}`);
    expect(failedRow).toMatchObject({ status: "FAILED", analyzed: false, brandMentioned: null });
    const nonTerminalRow = byQuery.find(row => row.queryText === `m-q-pend ${suffix}`);
    expect(nonTerminalRow).toMatchObject({ analyzed: false });
    expect(["PENDING", "QUEUED", "RUNNING"].includes(nonTerminalRow?.status ?? "")).toBe(true);
    expect(byQuery.filter(row => row.analyzed)).toHaveLength(4);
  });

  it("demo/real isolation：mixed 任务仅统计 real 子集（metricSource=mixed）", async () => {
    const { body } = await owner.get(`/benchmark-runs/${ids.mixedRunId}/metrics`).expect(200);
    expect(body.metricSource).toBe("mixed");
    // real pool = 2（deepseek），mock 1 条被排除
    expect(body.overall.totalRuns).toBe(2);
    expect(body.overall.visibilityRate).toBeCloseTo(1);
    expect(body.byQuery).toHaveLength(2);
    expect(body.byQuery.every((row: { status: string }) => row.status === "SUCCEEDED")).toBe(true);
  });

  it("DTO 校验：空 queries / 非法 runType / 非法 engine → 400", async () => {
    await owner.post(`/projects/${ids.projectA}/benchmark-suites`)
      .send({ name: "Bad", version: "1", queries: [] }).expect(400);
    await owner.post(`/benchmark-suites/${ids.seededSuiteId}/runs`)
      .send({ engineId: ids.engines[0], runType: "not-a-type" }).expect(400);
    await owner.post(`/benchmark-suites/${ids.seededSuiteId}/runs`)
      .send({ engineId: randomUUID(), runType: "demo" }).expect(400);
  });
});
