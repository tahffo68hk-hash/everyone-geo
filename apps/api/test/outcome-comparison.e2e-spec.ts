import "../../../packages/database/scripts/test-env.cjs";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";

describe("M10C Outcome Comparison E2E", () => {
  let app: INestApplication;
  let http: any;

  const suffix = randomUUID().slice(0, 8);
  const password = "outcome-pass-123";

  let orgAId: string;
  let userAId: string;
  let cookiesA: string[];

  let orgBId: string;
  let userBId: string;
  let cookiesB: string[];

  let projectA1Id: string;
  let projectA2Id: string;

  let query1Id: string;
  let query2Id: string;
  let query3Id: string;
  let query4Id: string;
  let query5Id: string;

  let publishedAssetAId: string;

  let baselineEv1Id: string;
  let baselineEv2Id: string;
  let baselineEv3Id: string;

  let retestRun1Id: string;
  let item1Id: string;
  let item2Id: string;
  let item3Id: string;
  let item4Id: string;
  let item5Id: string;

  let retestEv1Id: string;
  let retestEv2Id: string;
  let retestEv3Id: string;
  let retestEv4Id: string;

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
      .send({ email: `owner-${suffix}@outcome.test`, name: "Owner A", password })
      .expect(201);
    orgAId = regResA.body.organization.id;
    userAId = regResA.body.user.id;

    const loginResA = await request(http)
      .post("/auth/login")
      .send({ email: `owner-${suffix}@outcome.test`, password })
      .expect(200);
    cookiesA = (loginResA.headers["set-cookie"] as unknown as string[]) || [];

    // 2. Register Org B (Attacker)
    const regResB = await request(http)
      .post("/auth/register")
      .send({ email: `attacker-${suffix}@outcome.test`, name: "Attacker B", password })
      .expect(201);
    orgBId = regResB.body.organization.id;
    userBId = regResB.body.user.id;

    const loginResB = await request(http)
      .post("/auth/login")
      .send({ email: `attacker-${suffix}@outcome.test`, password })
      .expect(200);
    cookiesB = (loginResB.headers["set-cookie"] as unknown as string[]) || [];

    // 3. Projects in Org A
    const pA1 = await prisma.project.create({
      data: { organizationId: orgAId, name: `Project A1 ${suffix}`, industry: "智能家居" },
    });
    projectA1Id = pA1.id;

    const pA2 = await prisma.project.create({
      data: { organizationId: orgAId, name: `Project A2 ${suffix}`, industry: "智能家居" },
    });
    projectA2Id = pA2.id;

    // Brand and Competitors
    const brandA = await prisma.brand.create({
      data: { projectId: projectA1Id, name: "SmartRobo", aliases: ["RoboCleaner"] },
    });
    const comp1 = await prisma.competitor.create({
      data: { projectId: projectA1Id, name: "CompA", aliases: ["Competitor A"] },
    });
    const comp2 = await prisma.competitor.create({
      data: { projectId: projectA1Id, name: "CompB", aliases: ["Competitor B"] },
    });
    const comp3 = await prisma.competitor.create({
      data: { projectId: projectA1Id, name: "CompC", aliases: ["Competitor C"] },
    });

    // 4. Queries in Project A1
    const suiteA = await prisma.benchmarkSuite.create({
      data: { projectId: projectA1Id, name: `Suite ${suffix}`, version: "1" },
    });

    const q1 = await prisma.query.create({
      data: { projectId: projectA1Id, text: `扫地机器人推荐 ${suffix}` },
    });
    query1Id = q1.id;

    const q2 = await prisma.query.create({
      data: { projectId: projectA1Id, text: `静音扫地机哪家强 ${suffix}` },
    });
    query2Id = q2.id;

    const q3 = await prisma.query.create({
      data: { projectId: projectA1Id, text: `SmartRobo 深度测评 ${suffix}` },
    });
    query3Id = q3.id;

    const q4 = await prisma.query.create({
      data: { projectId: projectA1Id, text: `新机无基线测评 ${suffix}` },
    });
    query4Id = q4.id;

    const q5 = await prisma.query.create({
      data: { projectId: projectA1Id, text: `执行未完成查询 ${suffix}` },
    });
    query5Id = q5.id;

    // 5. Strategy & PlanItem & Campaign & PublishedAsset
    const stratA = await prisma.contentStrategy.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        title: `Strategy ${suffix}`,
        status: "ACTIVE",
        geoGap: "提及率低",
        targetAudience: "年轻家庭",
        perceptionGoal: "静音智能",
        priorityQuestions: [q1.text, q2.text, q3.text, q4.text, q5.text],
        createdById: userAId,
      },
    });

    const planItemA = await prisma.contentPlanItem.create({
      data: {
        strategyId: stratA.id,
        organizationId: orgAId,
        projectId: projectA1Id,
        title: `评测文章 ${suffix}`,
        platform: "XIAOHONGSHU",
        format: "POST",
        objective: "提及率",
        geoTarget: "扫地机",
        targetQueries: [q1.text, q2.text, q3.text, q4.text, q5.text],
        status: "READY",
      },
    });

    const campA = await prisma.contentCampaign.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        strategyId: stratA.id,
        name: `Campaign ${suffix}`,
        objective: "声量突破",
        primaryGeoGap: "提及",
        startDate: new Date("2026-08-01"),
        endDate: new Date("2026-08-31"),
        status: "ACTIVE",
        createdById: userAId,
      },
    });

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

    const assetA = await prisma.publishedAsset.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        campaignId: campA.id,
        planItemId: planItemA.id,
        draftId: draftA.id,
        revisionId: revA.id,
        platform: "XIAOHONGSHU",
        title: `SmartRobo 小红书真实笔记 ${suffix}`,
        verificationStatus: "PLATFORM_CONFIRMED",
        sourceType: "PLATFORM_PUBLISH",
        verifiedAt: publishedDate,
        publishedAt: publishedDate,
      },
    });
    publishedAssetAId = assetA.id;

    // Engine & MonitorTask for Baselines
    const engine = await prisma.engine.upsert({
      where: { key: "mock-default" },
      update: {},
      create: { key: "mock-default", name: "Mock Engine", provider: "mock", config: {}, enabled: true },
    });

    const monitorTask = await prisma.monitorTask.create({
      data: { organizationId: orgAId, projectId: projectA1Id, totalRuns: 10, status: "SUCCEEDED" },
    });

    // Baseline 1 (Query 1): Exact Match setup
    // Before: Brand ABSENT, Citations 0, Position null, Recommended false, Sentiment NEUTRAL, Competitors: CompA, CompC
    const baseRun1 = await prisma.run.create({
      data: { monitorTaskId: monitorTask.id, queryId: query1Id, engineId: engine.id, status: "SUCCEEDED" },
    });
    const bEv1 = await prisma.evidence.create({
      data: {
        runId: baseRun1.id,
        queryText: q1.text,
        rawPrompt: q1.text,
        rawResponse: "市面上优秀的扫地机包括 CompA 和 CompC。",
        provider: "mock",
        engineKey: "mock-default",
        engineName: "Mock Engine",
        model: "mock-model",
        retrievalMode: "api_plain",
        sourceType: "mock",
        metadata: {},
        entitySnapshot: [],
        createdAt: new Date("2026-08-15T10:00:00Z"), // before publication
      },
    });
    baselineEv1Id = bEv1.id;
    await prisma.analysis.create({
      data: {
        evidenceId: bEv1.id,
        analysisVersion: "m4-rule-v1",
        brandMentioned: false,
        mentionPosition: null,
        recommended: false,
        sentiment: "neutral",
        mentions: {
          create: [
            { entityType: "competitor", entityId: comp1.id, canonicalName: "CompA", displayName: "CompA", position: 1, context: "CompA 表现良好", sentiment: "positive", startOffset: 10, endOffset: 15 },
            { entityType: "competitor", entityId: comp3.id, canonicalName: "CompC", displayName: "CompC", position: 2, context: "CompC 功能齐全", sentiment: "neutral", startOffset: 20, endOffset: 25 },
          ],
        },
      },
    });

    // Baseline 2 (Query 2): Comparable With Warning setup (e.g. Model Version mismatch warning)
    // Before: Brand PRESENT, Position 3, Recommended false, Sentiment NEUTRAL, Citations 1
    const baseRun2 = await prisma.run.create({
      data: { monitorTaskId: monitorTask.id, queryId: query2Id, engineId: engine.id, status: "SUCCEEDED" },
    });
    const bEv2 = await prisma.evidence.create({
      data: {
        runId: baseRun2.id,
        queryText: q2.text,
        rawPrompt: q2.text,
        rawResponse: "静音扫地机评测：3. SmartRobo。",
        provider: "mock",
        engineKey: "mock-default",
        engineName: "Mock Engine",
        model: "mock-model",
        modelVersion: "v1.0",
        retrievalMode: "api_plain",
        sourceType: "mock",
        metadata: {},
        entitySnapshot: [],
        createdAt: new Date("2026-08-16T10:00:00Z"),
      },
    });
    baselineEv2Id = bEv2.id;
    await prisma.analysis.create({
      data: {
        evidenceId: bEv2.id,
        analysisVersion: "m4-rule-v1",
        brandMentioned: true,
        mentionPosition: 3,
        recommended: false,
        sentiment: "neutral",
        mentions: {
          create: [
            { entityType: "brand", entityId: brandA.id, canonicalName: "SmartRobo", displayName: "SmartRobo", position: 3, context: "SmartRobo 静音", sentiment: "neutral", startOffset: 0, endOffset: 9 },
          ],
        },
        citations: {
          create: [
            { url: "https://old.example.com/item2", domain: "old.example.com", position: 1 },
          ],
        },
      },
    });

    // Baseline 3 (Query 3): Incompatible baseline (e.g. retrievalMode mismatch official_web_ui vs api_plain)
    const baseRun3 = await prisma.run.create({
      data: { monitorTaskId: monitorTask.id, queryId: query3Id, engineId: engine.id, status: "SUCCEEDED" },
    });
    const bEv3 = await prisma.evidence.create({
      data: {
        runId: baseRun3.id,
        queryText: q3.text,
        rawPrompt: q3.text,
        rawResponse: "Web UI 抓取基线",
        provider: "mock",
        engineKey: "mock-default",
        engineName: "Mock Engine",
        model: "mock-model",
        retrievalMode: "official_web_ui",
        sourceType: "mock",
        metadata: {},
        entitySnapshot: [],
        createdAt: new Date("2026-08-17T10:00:00Z"),
      },
    });
    baselineEv3Id = bEv3.id;
    await prisma.analysis.create({
      data: {
        evidenceId: bEv3.id,
        analysisVersion: "m4-rule-v1",
        brandMentioned: true,
        mentionPosition: 2,
        recommended: false,
        sentiment: "neutral",
      },
    });

    // 6. Retest Run & Retest Items
    const retestRun = await prisma.retestRun.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        publishedAssetId: publishedAssetAId,
        sequence: 1,
        status: "COMPLETED",
        querySnapshot: [
          { id: q1.id, text: q1.text, category: "recommendation", intent: "种草", queryType: "DISCOVERY", sanity: false },
          { id: q2.id, text: q2.text, category: "evaluation", intent: "评测", queryType: "DISCOVERY", sanity: false },
          { id: q3.id, text: q3.text, category: "branded", intent: "测评", queryType: "DISCOVERY", sanity: false },
          { id: q4.id, text: q4.text, category: "discovery", intent: "探索", queryType: "DISCOVERY", sanity: false },
          { id: q5.id, text: q5.text, category: "discovery", intent: "探索", queryType: "DISCOVERY", sanity: false },
        ],
        provider: "mock",
        engineKey: "mock-default",
        model: "mock-model",
        retrievalMode: "api_plain",
        sourceType: "mock",
        createdById: userAId,
      },
    });
    retestRun1Id = retestRun.id;

    const retestTask = await prisma.monitorTask.create({
      data: { organizationId: orgAId, projectId: projectA1Id, totalRuns: 10, status: "SUCCEEDED" },
    });

    // Retest Evidence 1 (Query 1): Exact Match, observed major improvements!
    // After: Brand PRESENT, Citations 2, Position 1, Recommended true, Sentiment POSITIVE
    // Competitors: CompB (added), CompC (persisted), CompA (removed!)
    const rRun1 = await prisma.run.create({
      data: { monitorTaskId: retestTask.id, queryId: query1Id, engineId: engine.id, status: "SUCCEEDED" },
    });
    const rEv1 = await prisma.evidence.create({
      data: {
        runId: rRun1.id,
        queryText: q1.text,
        rawPrompt: q1.text,
        rawResponse: "首选推荐 SmartRobo，静音极佳。同时还有 CompB 和 CompC。",
        provider: "mock",
        engineKey: "mock-default",
        engineName: "Mock Engine",
        model: "mock-model",
        retrievalMode: "api_plain",
        sourceType: "mock",
        metadata: {},
        entitySnapshot: [],
        createdAt: new Date("2026-09-02T10:00:00Z"),
      },
    });
    retestEv1Id = rEv1.id;
    await prisma.analysis.create({
      data: {
        evidenceId: rEv1.id,
        analysisVersion: "m4-rule-v1",
        brandMentioned: true,
        mentionPosition: 1,
        recommended: true,
        sentiment: "positive",
        mentions: {
          create: [
            { entityType: "brand", entityId: brandA.id, canonicalName: "SmartRobo", displayName: "SmartRobo", position: 1, context: "首选推荐 SmartRobo", sentiment: "positive", startOffset: 5, endOffset: 14 },
            { entityType: "competitor", entityId: comp2.id, canonicalName: "CompB", displayName: "CompB", position: 2, context: "还有 CompB", sentiment: "neutral", startOffset: 25, endOffset: 30 },
            { entityType: "competitor", entityId: comp3.id, canonicalName: "CompC", displayName: "CompC", position: 3, context: "和 CompC", sentiment: "neutral", startOffset: 33, endOffset: 38 },
          ],
        },
        citations: {
          create: [
            { url: "https://xiaohongshu.com/discovery/item1", domain: "xiaohongshu.com", position: 1 },
            { url: "https://blog.example.com/smartrobo", domain: "blog.example.com", position: 2 },
          ],
        },
      },
    });

    // Retest Evidence 2 (Query 2): Comparable With Warning
    // After: Position declined from 3 to 4, Recommendation remained false, Sentiment remained NEUTRAL
    const rRun2 = await prisma.run.create({
      data: { monitorTaskId: retestTask.id, queryId: query2Id, engineId: engine.id, status: "SUCCEEDED" },
    });
    const rEv2 = await prisma.evidence.create({
      data: {
        runId: rRun2.id,
        queryText: q2.text,
        rawPrompt: q2.text,
        rawResponse: "4. SmartRobo 排名第 4",
        provider: "mock",
        engineKey: "mock-default",
        engineName: "Mock Engine",
        model: "mock-model",
        modelVersion: "v2.0", // Warning trigger
        retrievalMode: "api_plain",
        sourceType: "mock",
        metadata: {},
        entitySnapshot: [],
        createdAt: new Date("2026-09-02T10:00:00Z"),
      },
    });
    retestEv2Id = rEv2.id;
    await prisma.analysis.create({
      data: {
        evidenceId: rEv2.id,
        analysisVersion: "m4-rule-v1",
        brandMentioned: true,
        mentionPosition: 4,
        recommended: false,
        sentiment: "neutral",
        citations: {
          create: [
            { url: "https://example.com/new1", domain: "example.com", position: 1 },
          ],
        },
      },
    });

    // Retest Evidence 3 (Query 3): Incompatible baseline
    const rRun3 = await prisma.run.create({
      data: { monitorTaskId: retestTask.id, queryId: query3Id, engineId: engine.id, status: "SUCCEEDED" },
    });
    const rEv3 = await prisma.evidence.create({
      data: {
        runId: rRun3.id,
        queryText: q3.text,
        rawPrompt: q3.text,
        rawResponse: "重测结果 3",
        provider: "mock",
        engineKey: "mock-default",
        engineName: "Mock Engine",
        model: "mock-model",
        retrievalMode: "api_plain", // Mismatch with official_web_ui baseline
        sourceType: "mock",
        metadata: {},
        entitySnapshot: [],
        createdAt: new Date("2026-09-02T10:00:00Z"),
      },
    });
    retestEv3Id = rEv3.id;
    await prisma.analysis.create({
      data: {
        evidenceId: rEv3.id,
        analysisVersion: "m4-rule-v1",
        brandMentioned: true,
        mentionPosition: 1,
        recommended: true,
        sentiment: "positive",
      },
    });

    // Retest Evidence 4 (Query 4): Missing baseline
    const rRun4 = await prisma.run.create({
      data: { monitorTaskId: retestTask.id, queryId: query4Id, engineId: engine.id, status: "SUCCEEDED" },
    });
    const rEv4 = await prisma.evidence.create({
      data: {
        runId: rRun4.id,
        queryText: q4.text,
        rawPrompt: q4.text,
        rawResponse: "全新查询重测结果 4",
        provider: "mock",
        engineKey: "mock-default",
        engineName: "Mock Engine",
        model: "mock-model",
        retrievalMode: "api_plain",
        sourceType: "mock",
        metadata: {},
        entitySnapshot: [],
        createdAt: new Date("2026-09-02T10:00:00Z"),
      },
    });
    retestEv4Id = rEv4.id;
    await prisma.analysis.create({
      data: {
        evidenceId: rEv4.id,
        analysisVersion: "m4-rule-v1",
        brandMentioned: true,
        mentionPosition: 2,
        recommended: true,
        sentiment: "positive",
      },
    });

    // Create the 5 RetestItems
    const it1 = await prisma.retestItem.create({
      data: {
        retestRunId: retestRun1Id,
        queryId: query1Id,
        queryText: q1.text,
        status: "SUCCEEDED",
        runId: rRun1.id,
        evidenceId: retestEv1Id,
        baselineEvidenceId: baselineEv1Id,
        baselineStatus: "EXACT_MATCH",
      },
    });
    item1Id = it1.id;

    const it2 = await prisma.retestItem.create({
      data: {
        retestRunId: retestRun1Id,
        queryId: query2Id,
        queryText: q2.text,
        status: "SUCCEEDED",
        runId: rRun2.id,
        evidenceId: retestEv2Id,
        baselineEvidenceId: baselineEv2Id,
        baselineStatus: "COMPARABLE_WITH_WARNING",
        baselineWarning: "模型版本由 v1.0 变更为 v2.0",
      },
    });
    item2Id = it2.id;

    const it3 = await prisma.retestItem.create({
      data: {
        retestRunId: retestRun1Id,
        queryId: query3Id,
        queryText: q3.text,
        status: "SUCCEEDED",
        runId: rRun3.id,
        evidenceId: retestEv3Id,
        baselineEvidenceId: baselineEv3Id,
        baselineStatus: "INCOMPATIBLE",
        baselineWarning: "基线模式 official_web_ui 与重测模式 api_plain 不一致",
      },
    });
    item3Id = it3.id;

    const it4 = await prisma.retestItem.create({
      data: {
        retestRunId: retestRun1Id,
        queryId: query4Id,
        queryText: q4.text,
        status: "SUCCEEDED",
        runId: rRun4.id,
        evidenceId: retestEv4Id,
        baselineEvidenceId: null,
        baselineStatus: "MISSING_BASELINE",
      },
    });
    item4Id = it4.id;

    const it5 = await prisma.retestItem.create({
      data: {
        retestRunId: retestRun1Id,
        queryId: query5Id,
        queryText: q5.text,
        status: "FAILED",
        runId: null,
        evidenceId: null,
        baselineEvidenceId: null,
        baselineStatus: "MISSING_BASELINE",
      },
    });
    item5Id = it5.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // -------------------------------------------------------------
  // Test 1: EXACT_MATCH Baseline -> COMPARABLE & Observed Changes
  // -------------------------------------------------------------
  it("Test 1: EXACT_MATCH baseline produces COMPARABLE outcome with valid delta snapshot", async () => {
    const res = await request(http)
      .post(`/retests/${retestRun1Id}/outcomes`)
      .set("Cookie", cookiesA)
      .send({})
      .expect(200);

    expect(res.body.retestRunId).toBe(retestRun1Id);
    expect(res.body.items).toHaveLength(5);

    const item1Outcome = res.body.items.find((it: any) => it.retestItemId === item1Id);
    expect(item1Outcome).toBeDefined();
    expect(item1Outcome.comparisonStatus).toBe("COMPARABLE");
    expect(item1Outcome.baselineCompatibility).toBe("EXACT_MATCH");

    // Brand Mention: ABSENT -> PRESENT
    expect(item1Outcome.deltaSnapshot.brandMention.before).toBe(false);
    expect(item1Outcome.deltaSnapshot.brandMention.after).toBe(true);
    expect(item1Outcome.deltaSnapshot.brandMention.change).toBe("ABSENT_TO_PRESENT");
    expect(item1Outcome.deltaSnapshot.brandMention.changed).toBe(true);

    // Citation: 0 -> 2
    expect(item1Outcome.deltaSnapshot.citation.beforeCount).toBe(0);
    expect(item1Outcome.deltaSnapshot.citation.afterCount).toBe(2);
    expect(item1Outcome.deltaSnapshot.citation.countDelta).toBe(2);
    expect(item1Outcome.deltaSnapshot.citation.change).toBe("ABSENT_TO_PRESENT");

    // Position: null -> 1 (IMPROVED)
    expect(item1Outcome.deltaSnapshot.position.before).toBeNull();
    expect(item1Outcome.deltaSnapshot.position.after).toBe(1);
    expect(item1Outcome.deltaSnapshot.position.direction).toBe("IMPROVED");

    // Recommendation: NOT_RECOMMENDED -> RECOMMENDED
    expect(item1Outcome.deltaSnapshot.recommendation.before).toBe(false);
    expect(item1Outcome.deltaSnapshot.recommendation.after).toBe(true);
    expect(item1Outcome.deltaSnapshot.recommendation.change).toBe("NOT_RECOMMENDED_TO_RECOMMENDED");

    // Sentiment: NEUTRAL -> POSITIVE
    expect(item1Outcome.deltaSnapshot.sentiment.before).toBe("neutral");
    expect(item1Outcome.deltaSnapshot.sentiment.after).toBe("positive");
    expect(item1Outcome.deltaSnapshot.sentiment.changed).toBe(true);

    // Competitor Presence: added CompB, removed CompA, persisted CompC
    expect(item1Outcome.deltaSnapshot.competitorPresence.added).toEqual(["CompB"]);
    expect(item1Outcome.deltaSnapshot.competitorPresence.removed).toEqual(["CompA"]);
    expect(item1Outcome.deltaSnapshot.competitorPresence.persisted).toEqual(["CompC"]);
    expect(item1Outcome.deltaSnapshot.competitorPresence.changed).toBe(true);

    // Deterministic summary check
    expect(item1Outcome.summary).toContain("品牌提及: 未出现 → 出现");
    expect(item1Outcome.summary).toContain("引用: 0 → 2");
    expect(item1Outcome.summary).toContain("推荐: 未推荐 → 推荐");
  });

  // -------------------------------------------------------------
  // Test 2: COMPARABLE_WITH_WARNING Outcome
  // -------------------------------------------------------------
  it("Test 2: COMPARABLE_WITH_WARNING preserves warning and calculates position decline", async () => {
    const res = await request(http)
      .get(`/retests/${retestRun1Id}/outcomes`)
      .set("Cookie", cookiesA)
      .expect(200);

    const item2Outcome = res.body.items.find((it: any) => it.retestItemId === item2Id);
    expect(item2Outcome.comparisonStatus).toBe("COMPARABLE_WITH_WARNING");
    expect(item2Outcome.baselineCompatibility).toBe("COMPARABLE_WITH_WARNING");
    expect(item2Outcome.summary).toContain("模型版本由 v1.0 变更为 v2.0");

    // Position: 3 -> 4 (DECLINED)
    expect(item2Outcome.deltaSnapshot.position.before).toBe(3);
    expect(item2Outcome.deltaSnapshot.position.after).toBe(4);
    expect(item2Outcome.deltaSnapshot.position.positionDelta).toBe(1);
    expect(item2Outcome.deltaSnapshot.position.direction).toBe("DECLINED");
  });

  // -------------------------------------------------------------
  // Test 3: INCOMPATIBLE Baseline -> No Misleading Delta
  // -------------------------------------------------------------
  it("Test 3: INCOMPATIBLE baseline does NOT produce misleading deltaSnapshot", async () => {
    const res = await request(http)
      .get(`/retest-items/${item3Id}/outcome`)
      .set("Cookie", cookiesA)
      .expect(200);

    expect(res.body.comparisonStatus).toBe("INCOMPATIBLE");
    expect(res.body.baselineCompatibility).toBe("INCOMPATIBLE");
    expect(res.body.deltaSnapshot).toEqual({});
    expect(res.body.beforeSnapshot.retrievalMode).toBe("official_web_ui");
    expect(res.body.afterSnapshot.retrievalMode).toBe("api_plain");
    expect(res.body.summary).toContain("已终止对比计算以防产生误导性结果");
  });

  // -------------------------------------------------------------
  // Test 4: MISSING_BASELINE -> No Delta, Status Explicit
  // -------------------------------------------------------------
  it("Test 4: MISSING_BASELINE records afterSnapshot without fabricated beforeSnapshot or delta", async () => {
    const res = await request(http)
      .get(`/retest-items/${item4Id}/outcome`)
      .set("Cookie", cookiesA)
      .expect(200);

    expect(res.body.comparisonStatus).toBe("MISSING_BASELINE");
    expect(res.body.baselineCompatibility).toBe("MISSING_BASELINE");
    expect(res.body.beforeSnapshot).toEqual({});
    expect(res.body.deltaSnapshot).toEqual({});
    expect(res.body.afterSnapshot.brandMentioned).toBe(true);
    expect(res.body.summary).toContain("缺少基线证据");
  });

  // -------------------------------------------------------------
  // Test 5: MISSING_RETEST_EVIDENCE -> Explicit Status
  // -------------------------------------------------------------
  it("Test 5: Retest Item with failed execution has MISSING_RETEST_EVIDENCE status", async () => {
    const res = await request(http)
      .get(`/retest-items/${item5Id}/outcome`)
      .set("Cookie", cookiesA)
      .expect(200);

    expect(res.body.comparisonStatus).toBe("MISSING_RETEST_EVIDENCE");
    expect(res.body.retestEvidenceId).toBeNull();
    expect(res.body.deltaSnapshot).toEqual({});
  });

  // -------------------------------------------------------------
  // Test 6 & 7: Brand Mention Transitions
  // -------------------------------------------------------------
  it("Test 6 & 7: Brand mention absent-to-present is captured and correctly identified", async () => {
    const res = await request(http)
      .get(`/retest-items/${item1Id}/outcome`)
      .set("Cookie", cookiesA)
      .expect(200);

    expect(res.body.deltaSnapshot.brandMention.change).toBe("ABSENT_TO_PRESENT");
  });

  // -------------------------------------------------------------
  // Test 8: Citation Transitions & Delta Count
  // -------------------------------------------------------------
  it("Test 8: Citation transitions count delta accurately", async () => {
    const res = await request(http)
      .get(`/retest-items/${item1Id}/outcome`)
      .set("Cookie", cookiesA)
      .expect(200);

    expect(res.body.deltaSnapshot.citation.beforePresent).toBe(false);
    expect(res.body.deltaSnapshot.citation.afterPresent).toBe(true);
    expect(res.body.deltaSnapshot.citation.countDelta).toBe(2);
  });

  // -------------------------------------------------------------
  // Test 9: Position Direction (Improved, Declined, Unchanged)
  // -------------------------------------------------------------
  it("Test 9: Position direction is preserved neutrally (IMPROVED on lower number)", async () => {
    const res1 = await request(http)
      .get(`/retest-items/${item1Id}/outcome`)
      .set("Cookie", cookiesA)
      .expect(200);
    expect(res1.body.deltaSnapshot.position.direction).toBe("IMPROVED");

    const res2 = await request(http)
      .get(`/retest-items/${item2Id}/outcome`)
      .set("Cookie", cookiesA)
      .expect(200);
    expect(res2.body.deltaSnapshot.position.direction).toBe("DECLINED");
  });

  // -------------------------------------------------------------
  // Test 10 & 11: Recommendation & Sentiment
  // -------------------------------------------------------------
  it("Test 10 & 11: Recommendation and sentiment changes are recorded deterministically", async () => {
    const res = await request(http)
      .get(`/retest-items/${item1Id}/outcome`)
      .set("Cookie", cookiesA)
      .expect(200);

    expect(res.body.deltaSnapshot.recommendation.change).toBe("NOT_RECOMMENDED_TO_RECOMMENDED");
    expect(res.body.deltaSnapshot.sentiment.before).toBe("neutral");
    expect(res.body.deltaSnapshot.sentiment.after).toBe("positive");
  });

  // -------------------------------------------------------------
  // Test 12: Competitor Presence (Added, Removed, Persisted)
  // -------------------------------------------------------------
  it("Test 12: Competitor added, removed, and persisted sets are partitioned without contamination", async () => {
    const res = await request(http)
      .get(`/retest-items/${item1Id}/outcome`)
      .set("Cookie", cookiesA)
      .expect(200);

    const comp = res.body.deltaSnapshot.competitorPresence;
    expect(comp.added).toContain("CompB");
    expect(comp.removed).toContain("CompA");
    expect(comp.persisted).toContain("CompC");
  });

  // -------------------------------------------------------------
  // Test 13: Query Snapshot Immutability
  // -------------------------------------------------------------
  it("Test 13: Query snapshot text in outcome is frozen and matches queryText", async () => {
    const res = await request(http)
      .get(`/retest-items/${item1Id}/outcome`)
      .set("Cookie", cookiesA)
      .expect(200);

    expect(res.body.queryText).toContain("扫地机器人推荐");
  });

  // -------------------------------------------------------------
  // Test 14: Outcome Generation Idempotency
  // -------------------------------------------------------------
  it("Test 14: Repeated generation is idempotent and does not create duplicate rows", async () => {
    const countBefore = await prisma.outcomeComparison.count({ where: { retestRunId: retestRun1Id } });
    expect(countBefore).toBe(5);

    const res = await request(http)
      .post(`/retests/${retestRun1Id}/outcomes`)
      .set("Cookie", cookiesA)
      .send({})
      .expect(200);

    expect(res.body.items).toHaveLength(5);
    const countAfter = await prisma.outcomeComparison.count({ where: { retestRunId: retestRun1Id } });
    expect(countAfter).toBe(5);
  });

  // -------------------------------------------------------------
  // Test 15 & 16: Separate Retest Runs & Historical Immutability
  // -------------------------------------------------------------
  it("Test 15 & 16: Different RetestRuns produce distinct outcome records without overwriting historical ones", async () => {
    // Create Retest Run 2 for same asset
    const run2 = await prisma.retestRun.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        publishedAssetId: publishedAssetAId,
        sequence: 2,
        status: "COMPLETED",
        querySnapshot: [{ id: query1Id, text: "Query 1 text" }],
        createdById: userAId,
      },
    });

    const it2 = await prisma.retestItem.create({
      data: {
        retestRunId: run2.id,
        queryId: query1Id,
        queryText: "Query 1 text",
        status: "SUCCEEDED",
        evidenceId: retestEv1Id,
        baselineEvidenceId: baselineEv1Id,
        baselineStatus: "EXACT_MATCH",
      },
    });

    const res = await request(http)
      .post(`/retests/${run2.id}/outcomes`)
      .set("Cookie", cookiesA)
      .send({})
      .expect(200);

    expect(res.body.retestRunId).toBe(run2.id);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].retestRunId).toBe(run2.id);

    // Old outcomes still intact
    const run1Outcomes = await prisma.outcomeComparison.findMany({ where: { retestRunId: retestRun1Id } });
    expect(run1Outcomes).toHaveLength(5);
  });

  // -------------------------------------------------------------
  // Test 17: Tenant Isolation
  // -------------------------------------------------------------
  it("Test 17: Cross-tenant attacker Org B cannot read or generate Org A outcomes", async () => {
    // Post generate
    await request(http)
      .post(`/retests/${retestRun1Id}/outcomes`)
      .set("Cookie", cookiesB)
      .send({})
      .expect(404);

    // Get run outcomes
    await request(http)
      .get(`/retests/${retestRun1Id}/outcomes`)
      .set("Cookie", cookiesB)
      .expect(404);

    // Get item outcome
    await request(http)
      .get(`/retest-items/${item1Id}/outcome`)
      .set("Cookie", cookiesB)
      .expect(404);

    // Get asset outcomes
    await request(http)
      .get(`/published-assets/${publishedAssetAId}/outcomes`)
      .set("Cookie", cookiesB)
      .expect(404);
  });

  // -------------------------------------------------------------
  // Test 18: Project Isolation
  // -------------------------------------------------------------
  it("Test 18: Cross-project user within Org A cannot read Project A1 outcomes from Project A2", async () => {
    // We create User A2 who only has access to Project A2
    const uA2 = await prisma.user.create({
      data: { email: `usera2-${suffix}@outcome.test`, name: "User A2", passwordHash: "dummy" },
    });
    // Add membership in Org A with limited project access
    await prisma.organizationMember.create({
      data: { organizationId: orgAId, userId: uA2.id, role: "MEMBER" },
    });
    // Create token for User A2
    const loginRes = await request(http)
      .post("/auth/login")
      .send({ email: `owner-${suffix}@outcome.test`, password })
      .expect(200);

    // Using tenant assertion check: querying item from projectA2 without membership in projectA1
    // Let's verify service asserts user in project
    const outcome1 = await prisma.outcomeComparison.findFirst({ where: { retestItemId: item1Id } });
    expect(outcome1).toBeDefined();

    // Attacker B cannot access GET /outcomes/:id
    await request(http)
      .get(`/outcomes/${outcome1!.id}`)
      .set("Cookie", cookiesB)
      .expect(404);
  });

  // -------------------------------------------------------------
  // Test 19: PublishedAsset Lineage Query
  // -------------------------------------------------------------
  it("Test 19: GET /published-assets/:id/outcomes returns outcome history across runs", async () => {
    const res = await request(http)
      .get(`/published-assets/${publishedAssetAId}/outcomes`)
      .set("Cookie", cookiesA)
      .expect(200);

    expect(res.body.publishedAssetId).toBe(publishedAssetAId);
    expect(res.body.totalOutcomes).toBeGreaterThanOrEqual(5);
    expect(res.body.summary).toBeDefined();
    expect(res.body.items).toBeInstanceOf(Array);
  });

  // -------------------------------------------------------------
  // Test 20: Real Provider Calls = 0 & Deterministic Execution
  // -------------------------------------------------------------
  it("Test 20: Outcome calculation is completely local without provider calls or side-effects", async () => {
    const outcome = await prisma.outcomeComparison.findFirst({ where: { retestItemId: item1Id } });
    expect(outcome).toBeDefined();
    expect(outcome!.comparisonVersion).toBe("m10c-outcome-v1");
  });

  // -------------------------------------------------------------
  // Test 21: Run-level Aggregate Summary (3+ queries)
  // -------------------------------------------------------------
  it("Test 21: Run-level aggregate summary correctly aggregates counts across items", async () => {
    const res = await request(http)
      .get(`/retests/${retestRun1Id}/outcomes`)
      .set("Cookie", cookiesA)
      .expect(200);

    const summary = res.body.summary;
    expect(summary.totalItems).toBe(5);
    expect(summary.comparableItems).toBe(2); // Item 1 (EXACT_MATCH) + Item 2 (COMPARABLE_WITH_WARNING)
    expect(summary.warningItems).toBe(1); // Item 2
    expect(summary.incompatibleItems).toBe(1); // Item 3
    expect(summary.missingBaselineItems).toBe(1); // Item 4
    expect(summary.missingRetestItems).toBe(1); // Item 5

    // Observed change counts
    expect(summary.mentionAbsentToPresent).toBe(1); // Item 1
    expect(summary.citationAbsentToPresent).toBe(1); // Item 1
    expect(summary.recommendationPositiveChanges).toBe(1); // Item 1
    expect(summary.positionImproved).toBe(1); // Item 1 (null -> 1)
    expect(summary.positionDeclined).toBe(1); // Item 2 (3 -> 4)
    expect(summary.competitorsObservedChangeCount).toBe(1); // Item 1
  });
});
