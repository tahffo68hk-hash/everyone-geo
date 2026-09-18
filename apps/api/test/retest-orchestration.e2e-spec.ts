import "../../../packages/database/scripts/test-env.cjs";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";

describe("M10B GEO Retest Orchestration E2E", () => {
  let app: INestApplication;
  let http: any;

  const suffix = randomUUID().slice(0, 8);
  const password = "retest-pass-123";

  let orgAId: string;
  let userAId: string;
  let cookiesA: string[];

  let orgBId: string;
  let cookiesB: string[];

  let projectA1Id: string;
  let projectA2Id: string;

  let query1Id: string;
  let query2Id: string;
  let query3Id: string;

  let publishedAssetAId: string;
  let baselineEv1Id: string;
  let baselineEv2Id: string;
  let postEv3Id: string;

  const publishedDate = new Date("2026-09-01T12:00:00Z");

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    http = app.getHttpServer();

    // 1. Register Org A
    const regResA = await request(http)
      .post("/auth/register")
      .send({ email: `owner-${suffix}@retest.test`, name: "Owner A", password })
      .expect(201);
    orgAId = regResA.body.organization.id;
    userAId = regResA.body.user.id;

    const loginResA = await request(http)
      .post("/auth/login")
      .send({ email: `owner-${suffix}@retest.test`, password })
      .expect(200);
    cookiesA = (loginResA.headers["set-cookie"] as unknown as string[]) || [];

    // 2. Register Org B (Attacker)
    const regResB = await request(http)
      .post("/auth/register")
      .send({ email: `attacker-${suffix}@retest.test`, name: "Attacker B", password })
      .expect(201);
    orgBId = regResB.body.organization.id;

    const loginResB = await request(http)
      .post("/auth/login")
      .send({ email: `attacker-${suffix}@retest.test`, password })
      .expect(200);
    cookiesB = (loginResB.headers["set-cookie"] as unknown as string[]) || [];

    // 3. Projects in Org A
    const pA1 = await prisma.project.create({
      data: { organizationId: orgAId, name: `Project A1 ${suffix}`, industry: "宠物科技" },
    });
    projectA1Id = pA1.id;

    const pA2 = await prisma.project.create({
      data: { organizationId: orgAId, name: `Project A2 ${suffix}`, industry: "宠物科技" },
    });
    projectA2Id = pA2.id;

    // Brand for entity snapshotting
    await prisma.brand.create({
      data: { projectId: projectA1Id, name: "PawClean", aliases: ["PawClean Pro"] },
    });

    // 4. Queries in Project A1
    const suiteA = await prisma.benchmarkSuite.create({
      data: { projectId: projectA1Id, name: `Suite ${suffix}`, version: "1" },
    });

    const q1 = await prisma.query.create({
      data: { projectId: projectA1Id, text: `静音宠物饮水机推荐 ${suffix}` },
    });
    query1Id = q1.id;
    await prisma.benchmarkQuery.create({
      data: { suiteId: suiteA.id, projectQueryId: q1.id, queryText: q1.text, category: "recommendation", intent: "种草", queryType: "DISCOVERY", enabled: true, sortOrder: 1 },
    });

    const q2 = await prisma.query.create({
      data: { projectId: projectA1Id, text: `PawClean 真实评测 ${suffix}` },
    });
    query2Id = q2.id;
    await prisma.benchmarkQuery.create({
      data: { suiteId: suiteA.id, projectQueryId: q2.id, queryText: q2.text, category: "evaluation", intent: "评测", queryType: "DISCOVERY", enabled: true, sortOrder: 2 },
    });

    const q3 = await prisma.query.create({
      data: { projectId: projectA1Id, text: `PawClean 官网 ${suffix}` },
    });
    query3Id = q3.id;
    await prisma.benchmarkQuery.create({
      data: { suiteId: suiteA.id, projectQueryId: q3.id, queryText: q3.text, category: "branded", intent: "官网", queryType: "BRANDED_SANITY", sanity: true, enabled: true, sortOrder: 3 },
    });

    // 5. Strategy & PlanItem & Campaign
    const diagA = await prisma.diagnosisRun.create({
      data: { projectId: projectA1Id, reportId: randomUUID(), diagnosisVersion: "v1", status: "READY", summarySnapshot: {} },
    });
    const stratA = await prisma.contentStrategy.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        title: `Strategy ${suffix}`,
        sourceDiagnosisId: diagA.id,
        status: "ACTIVE",
        geoGap: "声量差距",
        targetAudience: "养宠人群",
        perceptionGoal: "静音安全",
        priorityQuestions: [q1.text, q2.text],
        createdById: userAId,
      },
    });

    const planItemA = await prisma.contentPlanItem.create({
      data: {
        strategyId: stratA.id,
        organizationId: orgAId,
        projectId: projectA1Id,
        title: `静音实测图文 ${suffix}`,
        platform: "WECHAT",
        format: "TUTORIAL",
        objective: "品牌建设",
        geoTarget: "静音宠物",
        targetQueries: [q1.text, q2.text], // Lineage target queries
        status: "READY",
      },
    });

    const campA = await prisma.contentCampaign.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        strategyId: stratA.id,
        name: `Campaign ${suffix}`,
        objective: "声量提升",
        primaryGeoGap: "声量",
        startDate: new Date("2026-10-01"),
        endDate: new Date("2026-10-31"),
        status: "ACTIVE",
        createdById: userAId,
      },
    });

    const schedA = await prisma.contentScheduleItem.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        campaignId: campA.id,
        planItemId: planItemA.id,
        scheduledDate: new Date("2026-10-15T09:00:00Z"),
        productionStatus: "DONE",
        timezone: "Asia/Shanghai",
      },
    });

    // Draft & Revision
    const draftA = await prisma.contentDraft.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        sourcePlanItemId: planItemA.id,
        title: `Draft A ${suffix}`,
        status: "PUBLISHED",
        createdById: userAId,
      },
    });
    const revA = await prisma.contentRevision.create({
      data: {
        draftId: draftA.id,
        version: 1,
        body: "Draft content body",
        generatedById: userAId,
      },
    });

    // PublishedAsset A (Published at 2026-10-15T12:00:00Z)
    const assetA = await prisma.publishedAsset.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        campaignId: campA.id,
        scheduleItemId: schedA.id,
        planItemId: planItemA.id,
        draftId: draftA.id,
        revisionId: revA.id,
        platform: "WECHAT",
        title: `PawClean 静音发布文章 ${suffix}`,
        canonicalUrl: "https://mp.weixin.qq.com/s/authentic-asset-1",
        externalAssetId: "wx_asset_001",
        verificationStatus: "PLATFORM_CONFIRMED",
        sourceType: "PLATFORM_PUBLISH",
        verifiedAt: publishedDate,
        publishedAt: publishedDate,
      },
    });
    publishedAssetAId = assetA.id;

    // 6. Pre-existing Evidence (Baselines & Post-pub test fixtures)
    // Engine mock
    const engine = await prisma.engine.upsert({
      where: { key: "mock-default" },
      update: {},
      create: { key: "mock-default", name: "Mock Engine", provider: "mock", config: {}, enabled: true },
    });

    const baselineTask = await prisma.monitorTask.create({
      data: { organizationId: orgAId, projectId: projectA1Id, totalRuns: 3, status: "SUCCEEDED" },
    });

    // Evidence 1: Pre-pub for Query 1 (Exact Match: mock, api_plain, mock, mock-model)
    const run1 = await prisma.run.create({
      data: { monitorTaskId: baselineTask.id, queryId: query1Id, engineId: engine.id, status: "SUCCEEDED" },
    });
    const ev1 = await prisma.evidence.create({
      data: {
        runId: run1.id,
        queryText: q1.text,
        rawPrompt: q1.text,
        rawResponse: "历史基线内容 1",
        provider: "mock",
        engineKey: "mock-default",
        engineName: "Mock Engine",
        model: "mock-model",
        retrievalMode: "api_plain",
        sourceType: "mock",
        metadata: {},
        entitySnapshot: [],
        createdAt: new Date("2026-08-20T09:00:00Z"), // < publishedDate
      },
    });
    baselineEv1Id = ev1.id;

    // Evidence 2: Pre-pub for Query 2 (Mismatch retrievalMode: official_web_ui)
    const run2 = await prisma.run.create({
      data: { monitorTaskId: baselineTask.id, queryId: query2Id, engineId: engine.id, status: "SUCCEEDED" },
    });
    const ev2 = await prisma.evidence.create({
      data: {
        runId: run2.id,
        queryText: q2.text,
        rawPrompt: q2.text,
        rawResponse: "历史基线内容 2 (web ui)",
        provider: "mock",
        engineKey: "mock-default",
        engineName: "Mock Engine",
        model: "mock-model",
        retrievalMode: "official_web_ui", // Different from retest default api_plain!
        sourceType: "mock",
        metadata: {},
        entitySnapshot: [],
        createdAt: new Date("2026-08-25T09:00:00Z"), // < publishedDate
      },
    });
    baselineEv2Id = ev2.id;

    // Evidence 3: Post-pub for Query 3 (createdAt > publishedDate)
    const run3 = await prisma.run.create({
      data: { monitorTaskId: baselineTask.id, queryId: query3Id, engineId: engine.id, status: "SUCCEEDED" },
    });
    const ev3 = await prisma.evidence.create({
      data: {
        runId: run3.id,
        queryText: q3.text,
        rawPrompt: q3.text,
        rawResponse: "发布后产生的其他测试证据",
        provider: "mock",
        engineKey: "mock-default",
        engineName: "Mock Engine",
        model: "mock-model",
        retrievalMode: "api_plain",
        sourceType: "mock",
        metadata: {},
        entitySnapshot: [],
        createdAt: new Date("2026-09-05T09:00:00Z"), // > publishedDate! Must NOT be chosen as baseline!
      },
    });
    postEv3Id = ev3.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Matrix 1 & 2: Create Retest Run and derive query scope from PlanItem
  // -------------------------------------------------------------------------
  let retest1Id: string;
  it("1 & 2. POST /published-assets/:id/retests 自动从 PlanItem 血缘推导 Query Scope 并创建 RetestRun", async () => {
    const res = await request(http)
      .post(`/published-assets/${publishedAssetAId}/retests`)
      .set("Cookie", cookiesA)
      .send({})
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.publishedAssetId).toBe(publishedAssetAId);
    expect(res.body.status).toBe("COMPLETED");
    expect(res.body.sequence).toBe(1);
    expect(res.body.totalItems).toBe(2); // Derived query1 & query2 from PlanItem.targetQueries
    expect(res.body.completedItems).toBe(2);
    expect(res.body.failedItems).toBe(0);

    retest1Id = res.body.id;
  });

  // -------------------------------------------------------------------------
  // Matrix 3: Query snapshot immutability
  // -------------------------------------------------------------------------
  it("3. Query snapshot 创建后不受原 Query 编辑或改名影响", async () => {
    // 篡改原 Query text
    const originalText = (await prisma.query.findUniqueOrThrow({ where: { id: query1Id } })).text;
    await prisma.query.update({
      where: { id: query1Id },
      data: { text: "篡改后的 Query 内容" },
    });

    // 读取 RetestRun
    const res = await request(http)
      .get(`/retests/${retest1Id}`)
      .set("Cookie", cookiesA)
      .expect(200);

    // snapshot 保持初始文本
    const snapshotItem = res.body.querySnapshot.find((q: any) => q.id === query1Id);
    expect(snapshotItem.text).toBe(originalText);

    // 恢复原文本
    await prisma.query.update({ where: { id: query1Id }, data: { text: originalText } });
  });

  // -------------------------------------------------------------------------
  // Matrix 4, 5, 6, 7: Baseline Selection & Compatibility Rules
  // -------------------------------------------------------------------------
  it("4 & 7. 匹配到发布前同配置 Evidence 标记为 EXACT_MATCH；检索模式不匹配标记为 INCOMPATIBLE", async () => {
    const res = await request(http)
      .get(`/retests/${retest1Id}/items`)
      .set("Cookie", cookiesA)
      .expect(200);

    const items = res.body;
    expect(items.length).toBe(2);

    const item1 = items.find((i: any) => i.queryId === query1Id);
    expect(item1.baselineStatus).toBe("EXACT_MATCH");
    expect(item1.baselineEvidenceId).toBe(baselineEv1Id);
    expect(item1.baselineWarning).toBeNull();

    const item2 = items.find((i: any) => i.queryId === query2Id);
    expect(item2.baselineStatus).toBe("INCOMPATIBLE");
    expect(item2.baselineEvidenceId).toBe(baselineEv2Id);
    expect(item2.baselineWarning).toContain("检索模式不匹配");
  });

  it("5 & 6. 发布时间后的 Evidence 绝不可被选为 Before 基准；无发布前证据标记为 MISSING_BASELINE", async () => {
    // 显式指定重测 query3（该 query 仅有发布时间后的 Evidence，发布前无 Evidence）
    const res = await request(http)
      .post(`/published-assets/${publishedAssetAId}/retests`)
      .set("Cookie", cookiesA)
      .send({ queryIds: [query3Id], forceNew: true })
      .expect(201);

    const itemsRes = await request(http)
      .get(`/retests/${res.body.id}/items`)
      .set("Cookie", cookiesA)
      .expect(200);

    const item3 = itemsRes.body[0];
    expect(item3.queryId === query3Id).toBe(true);
    expect(item3.baselineStatus).toBe("MISSING_BASELINE");
    expect(item3.baselineEvidenceId).toBeNull();
    // 绝不可将 postEv3Id 当作 Before baseline
    expect(item3.baselineEvidenceId).not.toBe(postEv3Id);
  });

  // -------------------------------------------------------------------------
  // Matrix 8 & 9: Evidence First - New Evidence Created with timestamp >= publishedAt
  // -------------------------------------------------------------------------
  it("8 & 9. Retest 产生全新的 Evidence，不覆盖历史 Evidence，且时间戳 >= publishedAt", async () => {
    const itemsRes = await request(http)
      .get(`/retests/${retest1Id}/items`)
      .set("Cookie", cookiesA)
      .expect(200);

    const item1 = itemsRes.body.find((i: any) => i.queryId === query1Id);
    expect(item1.evidenceId).toBeDefined();
    expect(item1.evidenceId).not.toBe(baselineEv1Id);

    // 历史 baseline evidence 仍原样存在
    const oldEv = await prisma.evidence.findUnique({ where: { id: baselineEv1Id } });
    expect(oldEv).not.toBeNull();
    expect(oldEv!.rawResponse).toBe("历史基线内容 1");

    // 新 Evidence 时间戳必须在发布时间之后
    const newEv = await prisma.evidence.findUnique({ where: { id: item1.evidenceId } });
    expect(newEv).not.toBeNull();
    expect(newEv!.createdAt.getTime()).toBeGreaterThanOrEqual(publishedDate.getTime());
  });

  // -------------------------------------------------------------------------
  // Matrix 10: Idempotency
  // -------------------------------------------------------------------------
  it("10. 相同 PublishedAsset 在有进行中 Run 时幂等复用，或通过 forceNew 创建新版本", async () => {
    // 创建一个 autoExecute=false 的任务，保持 PENDING 状态
    const runPending = await request(http)
      .post(`/published-assets/${publishedAssetAId}/retests`)
      .set("Cookie", cookiesA)
      .send({ forceNew: true, autoExecute: false })
      .expect(201);

    expect(runPending.body.status).toBe("PENDING");

    // 再次请求（未传 forceNew），应复用进行中的 PENDING 任务
    const runReused = await request(http)
      .post(`/published-assets/${publishedAssetAId}/retests`)
      .set("Cookie", cookiesA)
      .send({ forceNew: false })
      .expect(201);

    expect(runReused.body.id).toBe(runPending.body.id);

    // 触发 process
    await request(http)
      .post(`/retests/${runPending.body.id}/process`)
      .set("Cookie", cookiesA)
      .expect(200);

    // 查询该 asset 的重测历史列表
    const listRes = await request(http)
      .get(`/published-assets/${publishedAssetAId}/retests`)
      .set("Cookie", cookiesA)
      .expect(200);

    expect(listRes.body.length).toBeGreaterThanOrEqual(2);
    expect(listRes.body[0].sequence).toBeGreaterThan(listRes.body[1].sequence);
  });

  // -------------------------------------------------------------------------
  // Matrix 11: Single item failure does not discard other items (PARTIAL status)
  // -------------------------------------------------------------------------
  it("11. 单 Item 失败不丢弃其他成功 Evidence，整体状态为 PARTIAL", async () => {
    const res = await request(http)
      .post(`/published-assets/${publishedAssetAId}/retests`)
      .set("Cookie", cookiesA)
      .send({
        forceNew: true,
        simulateFailureQueryId: query1Id, // 故障注入
      })
      .expect(201);

    expect(res.body.status).toBe("PARTIAL");
    expect(res.body.failedItems).toBe(1);
    expect(res.body.completedItems).toBe(1);

    const itemsRes = await request(http)
      .get(`/retests/${res.body.id}/items`)
      .set("Cookie", cookiesA)
      .expect(200);

    const failedItem = itemsRes.body.find((i: any) => i.queryId === query1Id);
    expect(failedItem.status).toBe("FAILED");
    expect(failedItem.errorCode).toBe("MOCK_SIMULATED_FAILURE");

    const okItem = itemsRes.body.find((i: any) => i.queryId === query2Id);
    expect(okItem.status).toBe("SUCCEEDED");
    expect(okItem.evidenceId).toBeDefined();

    // 成功的 Evidence 真实存在于数据库
    const ev = await prisma.evidence.findUnique({ where: { id: okItem.evidenceId } });
    expect(ev).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Matrix 12, 13, 14, 15: Tenant Isolation & Project Isolation & 404 Guards
  // -------------------------------------------------------------------------
  it("12. 严格租户隔离：异租户访问全部返回 404", async () => {
    // 异租户创建 Retest
    await request(http)
      .post(`/published-assets/${publishedAssetAId}/retests`)
      .set("Cookie", cookiesB)
      .send({})
      .expect(404);

    // 异租户查询 Retest
    await request(http)
      .get(`/retests/${retest1Id}`)
      .set("Cookie", cookiesB)
      .expect(404);

    // 异租户查询 Items
    await request(http)
      .get(`/retests/${retest1Id}/items`)
      .set("Cookie", cookiesB)
      .expect(404);

    // 异租户查询 Asset Retest 历史
    await request(http)
      .get(`/published-assets/${publishedAssetAId}/retests`)
      .set("Cookie", cookiesB)
      .expect(404);
  });

  // -------------------------------------------------------------------------
  // AG-M10B-01 Defect Regression: Unauthorized Retest Execution Zero Side-Effect
  // -------------------------------------------------------------------------
  it("AG-M10B-01 Case A & B. 未授权用户触发 process 必须返回 404 且在 DB 中严格零副作用", async () => {
    // 1. 准备处于 PENDING 状态的受害者 RetestRun
    const pendingRes = await request(http)
      .post(`/published-assets/${publishedAssetAId}/retests`)
      .set("Cookie", cookiesA)
      .send({ forceNew: true, autoExecute: false, queryIds: [query1Id] })
      .expect(201);

    const pendingRunId = pendingRes.body.id;
    expect(pendingRes.body.status).toBe("PENDING");

    // 记录受害者项目的基准计数值
    const initialRunState = await prisma.retestRun.findUniqueOrThrow({
      where: { id: pendingRunId },
      include: { items: true },
    });
    expect(initialRunState.status).toBe("PENDING");
    expect(initialRunState.items[0].attemptCount).toBe(0);

    const initialEvidenceCount = await prisma.evidence.count({
      where: { run: { monitorTask: { projectId: projectA1Id } } },
    });
    const initialRunCount = await prisma.run.count({
      where: { monitorTask: { projectId: projectA1Id } },
    });
    const initialTaskCount = await prisma.monitorTask.count({
      where: { projectId: projectA1Id },
    });

    // 2. Case A: 跨租户攻击者 (Org B) 请求 POST /retests/:id/process
    await request(http)
      .post(`/retests/${pendingRunId}/process`)
      .set("Cookie", cookiesB)
      .send({})
      .expect(404);

    // 3. Case B: 跨项目/不存在权限的用户请求 POST /retests/:id/process (同样被拦截为 404)
    const outsiderAgent = request(http);
    const outsiderSuffix = randomUUID().slice(0, 8);
    const outsiderEmail = `outsider-${outsiderSuffix}@other.test`;
    await outsiderAgent.post("/auth/register").send({
      email: outsiderEmail,
      name: "Outsider",
      password: "retest-pass-123",
    }).expect(201);
    const loginOutsider = await outsiderAgent.post("/auth/login").send({
      email: outsiderEmail,
      password: "retest-pass-123",
    }).expect(200);
    const outsiderCookies = (loginOutsider.headers["set-cookie"] as unknown as string[]) || [];

    await request(http)
      .post(`/retests/${pendingRunId}/process`)
      .set("Cookie", outsiderCookies)
      .send({})
      .expect(404);

    // 4. 核心断言：未授权请求必须具有绝对的零副作用 (Zero Side Effect)
    const afterAttackRunState = await prisma.retestRun.findUniqueOrThrow({
      where: { id: pendingRunId },
      include: { items: true },
    });
    expect(afterAttackRunState.status).toBe("PENDING"); // 绝不得推进到 RUNNING 或 COMPLETED
    expect(afterAttackRunState.items[0].attemptCount).toBe(0); // attemptCount 不得增加
    expect(afterAttackRunState.items[0].status).toBe("PENDING");

    const afterAttackEvidenceCount = await prisma.evidence.count({
      where: { run: { monitorTask: { projectId: projectA1Id } } },
    });
    const afterAttackRunCount = await prisma.run.count({
      where: { monitorTask: { projectId: projectA1Id } },
    });
    const afterAttackTaskCount = await prisma.monitorTask.count({
      where: { projectId: projectA1Id },
    });

    expect(afterAttackEvidenceCount).toBe(initialEvidenceCount); // Evidence 绝不无故增加
    expect(afterAttackRunCount).toBe(initialRunCount);
    expect(afterAttackTaskCount).toBe(initialTaskCount);

    // 5. 合法 Owner 执行：确保修复后合法触发不受影响
    const ownerExecRes = await request(http)
      .post(`/retests/${pendingRunId}/process`)
      .set("Cookie", cookiesA)
      .send({})
      .expect(200);

    expect(ownerExecRes.body.status).toBe("COMPLETED");
    const ownerFinalRunState = await prisma.retestRun.findUniqueOrThrow({
      where: { id: pendingRunId },
      include: { items: true },
    });
    expect(ownerFinalRunState.status).toBe("COMPLETED");
    expect(ownerFinalRunState.items[0].attemptCount).toBe(1);
    expect(ownerFinalRunState.items[0].status).toBe("SUCCEEDED");
  });

  it("13 & 14 & 15. 项目隔离与不存在 ID 防护返回 404", async () => {
    // 不存在的 publishedAssetId -> 404
    await request(http)
      .post(`/published-assets/${randomUUID()}/retests`)
      .set("Cookie", cookiesA)
      .send({})
      .expect(404);

    // 不存在的 retestId -> 404
    await request(http)
      .get(`/retests/${randomUUID()}`)
      .set("Cookie", cookiesA)
      .expect(404);
  });

  // -------------------------------------------------------------------------
  // Matrix 16: Real Provider Calls = 0
  // -------------------------------------------------------------------------
  it("16. 测试阶段 Real Provider Calls = 0，非 mock 在未启用时严格拦截", async () => {
    // 检查已产生的所有 Retest Evidence，provider 必须全为 'mock'
    const allRetestRuns = await prisma.retestRun.findMany({
      where: { publishedAssetId: publishedAssetAId },
      include: { items: true },
    });
    expect(allRetestRuns.length).toBeGreaterThan(0);
    expect(allRetestRuns.every((r) => r.provider === "mock")).toBe(true);

    // 尝试在未开启 real provider 时声明 deepseek，应被拦截 400
    const originalEnv = process.env.ENABLE_REAL_PROVIDERS;
    try {
      process.env.ENABLE_REAL_PROVIDERS = "false";
      await request(http)
        .post(`/published-assets/${publishedAssetAId}/retests`)
        .set("Cookie", cookiesA)
        .send({ provider: "deepseek", forceNew: true })
        .expect(400);
    } finally {
      process.env.ENABLE_REAL_PROVIDERS = originalEnv;
    }
  });
});
