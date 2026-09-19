import "../../../packages/database/scripts/test-env.cjs";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";

describe("M11A Learning Signal Foundation E2E", () => {
  let app: INestApplication;
  let http: any;

  const suffix = randomUUID().slice(0, 8);
  const password = "learn-pass-123";

  let orgAId: string;
  let userAId: string;
  let cookiesA: string[];

  let orgBId: string;
  let userBId: string;
  let cookiesB: string[];

  let projectA1Id: string;
  let projectA2Id: string;
  let projectBId: string;

  let query1Id: string;
  let query2Id: string;
  let query3Id: string;
  let query4Id: string;
  let query5Id: string;
  let query6Id: string;
  let query7Id: string;

  let publishedAssetA1Id: string;
  let retestRun1Id: string;

  let outcome1_LikelyRelatedId: string;
  let outcome2_InsufficientId: string;
  let outcome3_ConfoundedId: string;
  let outcome4_NoChangeId: string;
  let outcome5_NegativeId: string;
  let outcome6_MissingBaselineId: string;
  let outcome7_IncompatibleId: string;

  let attr1_LikelyRelatedId: string;
  let attr2_InsufficientId: string;
  let attr3_ConfoundedId: string;
  let attr4_NoChangeId: string;
  let attr5_NegativeId: string;
  let attr6_MissingBaselineId: string;
  let attr7_IncompatibleId: string;

  const canonicalUrl = "https://example.com/blog/m11a-learning-guide";
  const publishedDate = new Date("2026-09-12T10:00:00.000Z");

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    http = app.getHttpServer();

    // 1. Auth & Users
    const regA = await request(http)
      .post("/auth/register")
      .send({ email: `owner-${suffix}@learn.test`, name: "Owner A", password })
      .expect(201);
    orgAId = regA.body.organization.id;
    userAId = regA.body.user.id;

    const loginA = await request(http)
      .post("/auth/login")
      .send({ email: `owner-${suffix}@learn.test`, password })
      .expect(200);
    cookiesA = loginA.headers["set-cookie"] as unknown as string[];

    const regB = await request(http)
      .post("/auth/register")
      .send({ email: `attacker-${suffix}@learn.test`, name: "Attacker B", password })
      .expect(201);
    orgBId = regB.body.organization.id;
    userBId = regB.body.user.id;

    const loginB = await request(http)
      .post("/auth/login")
      .send({ email: `attacker-${suffix}@learn.test`, password })
      .expect(200);
    cookiesB = loginB.headers["set-cookie"] as unknown as string[];

    // 2. Projects
    const pA1 = await prisma.project.create({
      data: { organizationId: orgAId, name: `Project A1 ${suffix}` },
    });
    projectA1Id = pA1.id;

    const pA2 = await prisma.project.create({
      data: { organizationId: orgAId, name: `Project A2 ${suffix}` },
    });
    projectA2Id = pA2.id;

    const pB = await prisma.project.create({
      data: { organizationId: orgBId, name: `Project B ${suffix}` },
    });
    projectBId = pB.id;

    // 3. Strategy & Campaign & Plan
    const strat = await prisma.contentStrategy.create({
      data: {
        projectId: projectA1Id,
        organizationId: orgAId,
        title: "GEO 落地最佳实践战略",
        geoGap: "案例缺乏",
        targetAudience: "技术总监",
        perceptionGoal: "行业首选",
        priorityQuestions: ["企业级 GEO 落地最佳实践有哪些推荐？"],
        status: "ACTIVE",
        createdById: userAId,
      },
    });

    const camp = await prisma.contentCampaign.create({
      data: {
        projectId: projectA1Id,
        organizationId: orgAId,
        strategyId: strat.id,
        name: "Q3 落地实践战役",
        objective: "提升品牌引用",
        primaryGeoGap: "案例缺乏",
        startDate: new Date("2026-09-01"),
        endDate: new Date("2026-09-30"),
        status: "ACTIVE",
        createdById: userAId,
      },
    });

    const plan = await prisma.contentPlanItem.create({
      data: {
        strategyId: strat.id,
        projectId: projectA1Id,
        organizationId: orgAId,
        title: "GEO 落地白皮书文章",
        platform: "WECHAT",
        format: "ARTICLE",
        objective: "提升品牌引用",
        geoTarget: "企业级 GEO 落地最佳实践有哪些推荐？",
        targetQueries: ["企业级 GEO 落地最佳实践有哪些推荐？"],
        status: "IN_PROGRESS",
      },
    });

    const sched = await prisma.contentScheduleItem.create({
      data: {
        campaignId: camp.id,
        planItemId: plan.id,
        projectId: projectA1Id,
        organizationId: orgAId,
        scheduledDate: new Date("2026-09-10"),
        productionStatus: "DONE",
        timezone: "Asia/Shanghai",
      },
    });

    const draft = await prisma.contentDraft.create({
      data: {
        projectId: projectA1Id,
        organizationId: orgAId,
        sourcePlanItemId: plan.id,
        title: "企业级 GEO 落地最佳实践",
        status: "APPROVED",
        createdById: userAId,
      },
    });

    const rev = await prisma.contentRevision.create({
      data: { draftId: draft.id, version: 1, body: "白皮书正文...", generatedById: userAId },
    });

    const conn = await prisma.channelAccountConnection.create({
      data: {
        organizationId: orgAId,
        channel: "WECHAT",
        displayName: "Official Account",
        status: "CONNECTED",
        createdById: userAId,
      },
    });

    const pub = await prisma.publication.create({
      data: {
        projectId: projectA1Id,
        organizationId: orgAId,
        connectionId: conn.id,
        draftId: draft.id,
        revisionId: rev.id,
        campaignId: camp.id,
        scheduleItemId: sched.id,
        planItemId: plan.id,
        channel: "WECHAT",
        status: "PUBLISHED",
        payload: JSON.stringify({ body: "白皮书正文..." }),
        idempotencyKey: `m11a-pub-${suffix}`,
        createdById: userAId,
        publishedAt: publishedDate,
      },
    });

    const asset = await prisma.publishedAsset.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        publicationId: pub.id,
        campaignId: camp.id,
        scheduleItemId: sched.id,
        planItemId: plan.id,
        draftId: draft.id,
        revisionId: rev.id,
        platform: "WECHAT",
        title: "企业级 GEO 落地最佳实践",
        canonicalUrl,
        verificationStatus: "PLATFORM_CONFIRMED",
        sourceType: "PLATFORM_PUBLISH",
        publishedAt: publishedDate,
      },
    });
    publishedAssetA1Id = asset.id;

    // 4. Queries for 7 scenarios
    const q1 = await prisma.query.create({ data: { projectId: projectA1Id, text: "企业级 GEO 落地最佳实践有哪些推荐？" } });
    query1Id = q1.id;
    const q2 = await prisma.query.create({ data: { projectId: projectA1Id, text: "国内哪些 GEO 平台较为成熟？" } });
    query2Id = q2.id;
    const q3 = await prisma.query.create({ data: { projectId: projectA1Id, text: "GEO 优化方案的实施路径是什么？" } });
    query3Id = q3.id;
    const q4 = await prisma.query.create({ data: { projectId: projectA1Id, text: "GEO 评测指标有哪些常见定义？" } });
    query4Id = q4.id;
    const q5 = await prisma.query.create({ data: { projectId: projectA1Id, text: "GEO 系统架构该如何规划？" } });
    query5Id = q5.id;
    const q6 = await prisma.query.create({ data: { projectId: projectA1Id, text: "无基线评测问题？" } });
    query6Id = q6.id;
    const q7 = await prisma.query.create({ data: { projectId: projectA1Id, text: "不兼容环境问题？" } });
    query7Id = q7.id;

    // 5. RetestRun
    const rRun = await prisma.retestRun.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        publishedAssetId: asset.id,
        sequence: 1,
        status: "SUCCEEDED",
        provider: "mock",
        engineKey: "mock-default",
        engineName: "Mock Engine",
        model: "mock-model",
        retrievalMode: "api_plain",
        sourceType: "mock",
        querySnapshot: [],
        createdById: userAId,
        totalItems: 7,
        completedItems: 7,
      },
    });
    retestRun1Id = rRun.id;

    // Helper to create RetestItem, OutcomeComparison, and OutcomeAttribution
    const createItemOutcomeAttr = async (
      queryId: string,
      queryText: string,
      comparisonStatus: string,
      baselineCompatibility: string,
      deltaSnapshot: any,
      attrStatus: string,
      observedChangeType: string,
      citationMatchStatus: string,
      confounders: any = { hasConfounders: false, list: [] },
    ) => {
      const item = await prisma.retestItem.create({
        data: {
          retestRunId: rRun.id,
          queryId,
          queryText,
          status: "SUCCEEDED",
          baselineStatus: baselineCompatibility,
        },
      });

      const outcome = await prisma.outcomeComparison.create({
        data: {
          organizationId: orgAId,
          projectId: projectA1Id,
          publishedAssetId: asset.id,
          retestRunId: rRun.id,
          retestItemId: item.id,
          queryId,
          queryText,
          baselineCompatibility,
          comparisonStatus,
          deltaSnapshot,
          summary: "Deterministic outcome comparison",
          createdById: userAId,
        },
      });

      const attribution = await prisma.outcomeAttribution.create({
        data: {
          organizationId: orgAId,
          projectId: projectA1Id,
          publishedAssetId: asset.id,
          retestRunId: rRun.id,
          retestItemId: item.id,
          outcomeComparisonId: outcome.id,
          queryId,
          queryText,
          status: attrStatus,
          observedChangeType,
          signalsSnapshot: {
            baselineCompatibility,
            assetVerification: { status: "PLATFORM_CONFIRMED", verified: true },
            temporalOrdering: { status: "VALID_ORDER", baselineAt: "2026-09-10T00:00:00Z", publishedAt: "2026-09-12T10:00:00Z", retestAt: "2026-09-14T00:00:00Z" },
            queryTargeting: { status: "EXPLICIT_TARGET", matchedQueryId: queryId, matchedQueryText: queryText },
            citationMatch: {
              status: citationMatchStatus,
              matchedUrl: citationMatchStatus === "DIRECT_ASSET_CITATION" ? canonicalUrl : undefined,
            },
            observedChange: {
              hasChange: observedChangeType !== "NO_CHANGE",
              type: observedChangeType,
              details: {},
            },
          },
          confoundersSnapshot: confounders,
          reasons: [citationMatchStatus, baselineCompatibility],
          explanation: "Deterministic attribution explanation",
          createdById: userAId,
        },
      });

      return { outcomeId: outcome.id, attrId: attribution.id };
    };

    // 1. Golden Path: Likely Related + Positive Delta
    const res1 = await createItemOutcomeAttr(
      query1Id,
      "企业级 GEO 落地最佳实践有哪些推荐？",
      "COMPARABLE",
      "EXACT_MATCH",
      {
        brandMention: { before: false, after: true, change: "ABSENT_TO_PRESENT", changed: true },
        citation: { beforePresent: false, afterPresent: true, countDelta: 2, change: "ABSENT_TO_PRESENT", changed: true },
        position: { before: 3, after: 1, positionDelta: -2, direction: "IMPROVED", changed: true },
        recommendation: { before: false, after: true, change: "NOT_RECOMMENDED_TO_RECOMMENDED", changed: true },
        sentiment: { before: "neutral", after: "positive", changed: true },
        competitorPresence: { added: ["Competitor B"], removed: [], changed: true },
      },
      "LIKELY_RELATED",
      "POSITIVE",
      "DIRECT_ASSET_CITATION",
    );
    outcome1_LikelyRelatedId = res1.outcomeId;
    attr1_LikelyRelatedId = res1.attrId;

    // 2. Insufficient Evidence: Positive delta but NO direct citation
    const res2 = await createItemOutcomeAttr(
      query2Id,
      "国内哪些 GEO 平台较为成熟？",
      "COMPARABLE",
      "EXACT_MATCH",
      {
        brandMention: { before: false, after: true, change: "ABSENT_TO_PRESENT", changed: true },
        citation: { countDelta: 0, changed: false },
      },
      "INSUFFICIENT_EVIDENCE",
      "POSITIVE",
      "SAME_DOMAIN_OTHER_PAGE",
    );
    outcome2_InsufficientId = res2.outcomeId;
    attr2_InsufficientId = res2.attrId;

    // 3. Confounded: Multiple Interventions
    const res3 = await createItemOutcomeAttr(
      query3Id,
      "GEO 优化方案的实施路径是什么？",
      "COMPARABLE",
      "EXACT_MATCH",
      {
        brandMention: { before: false, after: true, change: "ABSENT_TO_PRESENT", changed: true },
      },
      "CONFOUNDED",
      "POSITIVE",
      "DIRECT_ASSET_CITATION",
      {
        hasConfounders: true,
        multipleInterventions: { detected: true, confoundingAssetIds: [randomUUID()] },
      },
    );
    outcome3_ConfoundedId = res3.outcomeId;
    attr3_ConfoundedId = res3.attrId;

    // 4. No Observed Change
    const res4 = await createItemOutcomeAttr(
      query4Id,
      "GEO 评测指标有哪些常见定义？",
      "COMPARABLE",
      "EXACT_MATCH",
      {},
      "NO_OBSERVED_CHANGE",
      "NO_CHANGE",
      "NO_ASSET_CITATION",
    );
    outcome4_NoChangeId = res4.outcomeId;
    attr4_NoChangeId = res4.attrId;

    // 5. Negative Change
    const res5 = await createItemOutcomeAttr(
      query5Id,
      "GEO 系统架构该如何规划？",
      "COMPARABLE",
      "EXACT_MATCH",
      {
        brandMention: { before: true, after: false, change: "PRESENT_TO_ABSENT", changed: true },
        position: { before: 1, after: null, direction: "DECLINED", changed: true },
        sentiment: { before: "positive", after: "negative", changed: true },
      },
      "INSUFFICIENT_EVIDENCE",
      "NEGATIVE",
      "NO_ASSET_CITATION",
    );
    outcome5_NegativeId = res5.outcomeId;
    attr5_NegativeId = res5.attrId;

    // 6. Missing Baseline
    const res6 = await createItemOutcomeAttr(
      query6Id,
      "无基线评测问题？",
      "MISSING_BASELINE",
      "MISSING_BASELINE",
      {},
      "INSUFFICIENT_EVIDENCE",
      "NO_CHANGE",
      "NO_ASSET_CITATION",
    );
    outcome6_MissingBaselineId = res6.outcomeId;
    attr6_MissingBaselineId = res6.attrId;

    // 7. Incompatible Measurement
    const res7 = await createItemOutcomeAttr(
      query7Id,
      "不兼容环境问题？",
      "INCOMPATIBLE",
      "INCOMPATIBLE",
      {},
      "INSUFFICIENT_EVIDENCE",
      "NO_CHANGE",
      "NO_ASSET_CITATION",
    );
    outcome7_IncompatibleId = res7.outcomeId;
    attr7_IncompatibleId = res7.attrId;
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // 1. Golden Path: Positive Outcome -> Learning Observations
  // =========================================================================
  describe("1. Golden Path: Generation, Idempotency, Versioning & Immutability", () => {
    it("1.1 Generates granular LearningObservations for LIKELY_RELATED positive Outcome", async () => {
      const res = await request(http)
        .post(`/outcomes/${outcome1_LikelyRelatedId}/learning-observations`)
        .set("Cookie", cookiesA)
        .send({})
        .expect(200);

      expect(res.body.outcomeComparisonId).toBe(outcome1_LikelyRelatedId);
      expect(res.body.outcomeAttributionId).toBe(attr1_LikelyRelatedId);
      expect(res.body.observationVersion).toBe("m11a-learning-observation-v1");
      expect(res.body.count).toBeGreaterThanOrEqual(5);

      const items = res.body.items;
      // 1. Brand Mention Change
      const brandObs = items.find((o: any) => o.observationType === "BRAND_MENTION_CHANGE");
      expect(brandObs).toBeDefined();
      expect(brandObs.direction).toBe("POSITIVE");
      expect(brandObs.attributionStatus).toBe("LIKELY_RELATED");
      expect(brandObs.summary).toContain("未提及品牌");
      expect(brandObs.contextSnapshot.queryTargetingStatus).toBe("EXPLICIT_TARGET");
      expect(brandObs.signalsSnapshot.citationMatch.status).toBe("DIRECT_ASSET_CITATION");

      // 2. Citation Change
      const citObs = items.find((o: any) => o.observationType === "CITATION_CHANGE");
      expect(citObs).toBeDefined();
      expect(citObs.direction).toBe("POSITIVE");
      expect(citObs.summary).toContain("引用数量增加");

      // 3. Position Change
      const posObs = items.find((o: any) => o.observationType === "POSITION_CHANGE");
      expect(posObs).toBeDefined();
      expect(posObs.direction).toBe("POSITIVE");
      expect(posObs.summary).toContain("提升至第 1 位");

      // 4. Recommendation Change
      const recObs = items.find((o: any) => o.observationType === "RECOMMENDATION_CHANGE");
      expect(recObs).toBeDefined();
      expect(recObs.direction).toBe("POSITIVE");

      // 5. Sentiment Change
      const sentObs = items.find((o: any) => o.observationType === "SENTIMENT_CHANGE");
      expect(sentObs).toBeDefined();
      expect(sentObs.direction).toBe("POSITIVE");

      // 6. Competitor Change
      const compObs = items.find((o: any) => o.observationType === "COMPETITOR_CHANGE");
      expect(compObs).toBeDefined();
      expect(compObs.direction).toBe("MIXED");
    });

    it("1.2 Repeated POST is completely idempotent with ZERO duplicate rows", async () => {
      const countBefore = await prisma.learningObservation.count({
        where: { outcomeComparisonId: outcome1_LikelyRelatedId },
      });

      // Repeat generation
      const res = await request(http)
        .post(`/outcomes/${outcome1_LikelyRelatedId}/learning-observations`)
        .set("Cookie", cookiesA)
        .send({})
        .expect(200);

      const countAfter = await prisma.learningObservation.count({
        where: { outcomeComparisonId: outcome1_LikelyRelatedId },
      });

      expect(countAfter).toBe(countBefore);
      expect(res.body.count).toBe(countBefore);
    });

    it("1.3 New observationVersion coexists without overwriting v1", async () => {
      const v2Res = await request(http)
        .post(`/outcomes/${outcome1_LikelyRelatedId}/learning-observations`)
        .set("Cookie", cookiesA)
        .send({ observationVersion: "m11a-learning-observation-v2" })
        .expect(200);

      expect(v2Res.body.observationVersion).toBe("m11a-learning-observation-v2");

      const v1Rows = await prisma.learningObservation.findMany({
        where: { outcomeComparisonId: outcome1_LikelyRelatedId, observationVersion: "m11a-learning-observation-v1" },
      });
      const v2Rows = await prisma.learningObservation.findMany({
        where: { outcomeComparisonId: outcome1_LikelyRelatedId, observationVersion: "m11a-learning-observation-v2" },
      });

      expect(v1Rows.length).toBeGreaterThanOrEqual(5);
      expect(v2Rows.length).toBeGreaterThanOrEqual(5);
    });

    it("1.4 Observation snapshot is immutable to future Query / Campaign edits", async () => {
      // Fetch an observation
      const obs = await prisma.learningObservation.findFirst({
        where: { outcomeComparisonId: outcome1_LikelyRelatedId },
      });
      expect(obs).toBeDefined();
      const frozenQueryText = (obs!.contextSnapshot as any).queryText;

      // Rename Query in database
      await prisma.query.update({
        where: { id: query1Id },
        data: { text: "全新的修改后问题名称" },
      });

      // Verify the observation's contextSnapshot remains unchanged
      const reReadObs = await prisma.learningObservation.findUnique({
        where: { id: obs!.id },
      });
      expect((reReadObs!.contextSnapshot as any).queryText).toBe(frozenQueryText);

      // Restore
      await prisma.query.update({
        where: { id: query1Id },
        data: { text: frozenQueryText },
      });
    });
  });

  // =========================================================================
  // 2. Scenario Matrix & Boundaries
  // =========================================================================
  describe("2. Scenario Matrix: Limitations, Confounders, Negative & No Change", () => {
    it("2.1 INSUFFICIENT_EVIDENCE: generates ATTRIBUTION_LIMITATION and preserves same-domain notice", async () => {
      const res = await request(http)
        .post(`/outcomes/${outcome2_InsufficientId}/learning-observations`)
        .set("Cookie", cookiesA)
        .send({})
        .expect(200);

      const limitation = res.body.items.find((o: any) => o.observationType === "ATTRIBUTION_LIMITATION");
      expect(limitation).toBeDefined();
      expect(limitation.attributionStatus).toBe("INSUFFICIENT_EVIDENCE");
      expect(limitation.summary).toContain("同域名其他页面");
      expect(limitation.summary).toContain("关联证据不足");
    });

    it("2.2 CONFOUNDED: generates ATTRIBUTION_LIMITATION preserving multiple intervention details", async () => {
      const res = await request(http)
        .post(`/outcomes/${outcome3_ConfoundedId}/learning-observations`)
        .set("Cookie", cookiesA)
        .send({})
        .expect(200);

      const limitation = res.body.items.find((o: any) => o.observationType === "ATTRIBUTION_LIMITATION");
      expect(limitation).toBeDefined();
      expect(limitation.attributionStatus).toBe("CONFOUNDED");
      expect(limitation.summary).toContain("其他落地资产并发发布");
      expect(limitation.signalsSnapshot.confounders.multipleInterventions.detected).toBe(true);
    });

    it("2.3 NO_OBSERVED_CHANGE: generates NO_OBSERVED_CHANGE observation with NO_CHANGE direction", async () => {
      const res = await request(http)
        .post(`/outcomes/${outcome4_NoChangeId}/learning-observations`)
        .set("Cookie", cookiesA)
        .send({})
        .expect(200);

      const noChange = res.body.items.find((o: any) => o.observationType === "NO_OBSERVED_CHANGE");
      expect(noChange).toBeDefined();
      expect(noChange.direction).toBe("NO_CHANGE");
      expect(noChange.attributionStatus).toBe("NO_OBSERVED_CHANGE");
      expect(noChange.summary).toContain("表现保持稳定");
    });

    it("2.4 NEGATIVE: generates NEGATIVE observations, never masked or flipped to positive", async () => {
      const res = await request(http)
        .post(`/outcomes/${outcome5_NegativeId}/learning-observations`)
        .set("Cookie", cookiesA)
        .send({})
        .expect(200);

      const brandObs = res.body.items.find((o: any) => o.observationType === "BRAND_MENTION_CHANGE");
      expect(brandObs).toBeDefined();
      expect(brandObs.direction).toBe("NEGATIVE");
      expect(brandObs.summary).toContain("品牌提及率发生下滑");

      const sentObs = res.body.items.find((o: any) => o.observationType === "SENTIMENT_CHANGE");
      expect(sentObs).toBeDefined();
      expect(sentObs.direction).toBe("NEGATIVE");
      expect(sentObs.summary).toContain("恶化为 negative");
    });

    it("2.5 MISSING_BASELINE: generates MEASUREMENT_LIMITATION explaining missing baseline", async () => {
      const res = await request(http)
        .post(`/outcomes/${outcome6_MissingBaselineId}/learning-observations`)
        .set("Cookie", cookiesA)
        .send({})
        .expect(200);

      const limitObs = res.body.items.find((o: any) => o.observationType === "MEASUREMENT_LIMITATION");
      expect(limitObs).toBeDefined();
      expect(limitObs.baselineCompatibility).toBe("MISSING_BASELINE");
      expect(limitObs.summary).toContain("缺少有效基线评测凭证");
    });

    it("2.6 INCOMPATIBLE: generates MEASUREMENT_LIMITATION explaining environmental mismatch", async () => {
      const res = await request(http)
        .post(`/outcomes/${outcome7_IncompatibleId}/learning-observations`)
        .set("Cookie", cookiesA)
        .send({})
        .expect(200);

      const limitObs = res.body.items.find((o: any) => o.observationType === "MEASUREMENT_LIMITATION");
      expect(limitObs).toBeDefined();
      expect(limitObs.baselineCompatibility).toBe("INCOMPATIBLE");
      expect(limitObs.summary).toContain("环境配置不匹配");
    });
  });

  // =========================================================================
  // 3. Security, Multi-Tenant & Zero Side-Effect Defense
  // =========================================================================
  describe("3. Tenant & Project Isolation & Zero Side-Effect Defense", () => {
    it("3.1 Cross-tenant POST returns 404 with strictly ZERO database writes", async () => {
      const initialCount = await prisma.learningObservation.count();

      // Attacker B attempts to generate observations on Org A's outcome
      await request(http)
        .post(`/outcomes/${outcome1_LikelyRelatedId}/learning-observations`)
        .set("Cookie", cookiesB)
        .send({})
        .expect(404);

      const afterCount = await prisma.learningObservation.count();
      expect(afterCount).toBe(initialCount);
    });

    it("3.2 Cross-tenant GET returns 404", async () => {
      await request(http)
        .get(`/outcomes/${outcome1_LikelyRelatedId}/learning-observations`)
        .set("Cookie", cookiesB)
        .expect(404);

      await request(http)
        .get(`/published-assets/${publishedAssetA1Id}/learning-observations`)
        .set("Cookie", cookiesB)
        .expect(404);

      await request(http)
        .get(`/projects/${projectA1Id}/learning-observations`)
        .set("Cookie", cookiesB)
        .expect(404);
    });

    it("3.3 Cross-project access in same org returns 404", async () => {
      // User A creates observations under Project A1, Project B is another project
      await request(http)
        .get(`/projects/${projectBId}/learning-observations`)
        .set("Cookie", cookiesA)
        .expect(404);

      await request(http)
        .get(`/projects/${projectBId}/learning-summary`)
        .set("Cookie", cookiesA)
        .expect(404);
    });

    it("3.4 Invalid Lineage Injection is rejected with 400 Bad Request", async () => {
      const fakeAssetId = randomUUID();
      const fakeAttrId = randomUUID();

      // Mismatched publishedAssetId
      await request(http)
        .post(`/outcomes/${outcome1_LikelyRelatedId}/learning-observations`)
        .set("Cookie", cookiesA)
        .send({ publishedAssetId: fakeAssetId })
        .expect(400);

      // Mismatched outcomeAttributionId
      await request(http)
        .post(`/outcomes/${outcome1_LikelyRelatedId}/learning-observations`)
        .set("Cookie", cookiesA)
        .send({ outcomeAttributionId: fakeAttrId })
        .expect(400);
    });
  });

  // =========================================================================
  // 4. Project Learning Summary & Pattern Aggregation
  // =========================================================================
  describe("4. Project Learning Summary & Pattern Aggregation", () => {
    it("4.1 Project with < 3 samples per pattern does NOT overclaim any pattern", async () => {
      // In Project A2, create 1 outcome and 1 observation
      const p2Draft = await prisma.contentDraft.create({
        data: { projectId: projectA2Id, organizationId: orgAId, title: "P2 Draft", status: "APPROVED", createdById: userAId },
      });
      const p2Rev = await prisma.contentRevision.create({
        data: { draftId: p2Draft.id, version: 1, body: "test", generatedById: userAId },
      });
      const p2Asset = await prisma.publishedAsset.create({
        data: { projectId: projectA2Id, organizationId: orgAId, draftId: p2Draft.id, revisionId: p2Rev.id, platform: "WECHAT", title: "P2 Asset", verificationStatus: "PLATFORM_CONFIRMED" },
      });
      const p2Query = await prisma.query.create({ data: { projectId: projectA2Id, text: "P2 Query" } });
      const p2Run = await prisma.retestRun.create({
        data: { projectId: projectA2Id, organizationId: orgAId, publishedAssetId: p2Asset.id, sequence: 1, status: "SUCCEEDED", provider: "mock", engineKey: "mock", engineName: "Mock", model: "m", retrievalMode: "api_plain", sourceType: "mock", querySnapshot: [], createdById: userAId, totalItems: 1, completedItems: 1 },
      });
      const p2Item = await prisma.retestItem.create({
        data: { retestRunId: p2Run.id, queryId: p2Query.id, queryText: p2Query.text, status: "SUCCEEDED", baselineStatus: "EXACT_MATCH" },
      });
      const p2Outcome = await prisma.outcomeComparison.create({
        data: { organizationId: orgAId, projectId: projectA2Id, publishedAssetId: p2Asset.id, retestRunId: p2Run.id, retestItemId: p2Item.id, queryId: p2Query.id, queryText: p2Query.text, baselineCompatibility: "EXACT_MATCH", comparisonStatus: "COMPARABLE", deltaSnapshot: { brandMention: { changed: true, change: "ABSENT_TO_PRESENT" } }, createdById: userAId },
      });
      await prisma.outcomeAttribution.create({
        data: { organizationId: orgAId, projectId: projectA2Id, publishedAssetId: p2Asset.id, retestRunId: p2Run.id, retestItemId: p2Item.id, outcomeComparisonId: p2Outcome.id, queryId: p2Query.id, queryText: p2Query.text, status: "LIKELY_RELATED", observedChangeType: "POSITIVE", createdById: userAId },
      });

      // Generate 1 observation
      await request(http)
        .post(`/outcomes/${p2Outcome.id}/learning-observations`)
        .set("Cookie", cookiesA)
        .send({})
        .expect(200);

      // Query Summary for Project A2
      const summaryRes = await request(http)
        .get(`/projects/${projectA2Id}/learning-summary`)
        .set("Cookie", cookiesA)
        .expect(200);

      expect(summaryRes.body.totalObservations).toBe(1);
      expect(summaryRes.body.byDirection.positive).toBe(1);
      // Sample count < 3: patterns MUST be empty!
      expect(summaryRes.body.patterns.length).toBe(0);
    });

    it("4.2 When sampleCount >= 3 for same query and type, generates evidence-backed pattern", async () => {
      // In Project A1, Query 1 already has 1 observation from 1.1. Let's add 2 more independent observation samples
      const asset = await prisma.publishedAsset.findUnique({ where: { id: publishedAssetA1Id } });

      for (let i = 2; i <= 3; i++) {
        const item = await prisma.retestItem.create({
          data: { retestRunId: retestRun1Id, queryId: query1Id, queryText: "企业级 GEO 落地最佳实践有哪些推荐？", status: "SUCCEEDED", baselineStatus: "EXACT_MATCH" },
        });
        const out = await prisma.outcomeComparison.create({
          data: { organizationId: orgAId, projectId: projectA1Id, publishedAssetId: asset!.id, retestRunId: retestRun1Id, retestItemId: item.id, queryId: query1Id, queryText: "企业级 GEO 落地最佳实践有哪些推荐？", baselineCompatibility: "EXACT_MATCH", comparisonStatus: "COMPARABLE", deltaSnapshot: { brandMention: { changed: true, change: "ABSENT_TO_PRESENT" } }, createdById: userAId },
        });
        const attr = await prisma.outcomeAttribution.create({
          data: { organizationId: orgAId, projectId: projectA1Id, publishedAssetId: asset!.id, retestRunId: retestRun1Id, retestItemId: item.id, outcomeComparisonId: out.id, queryId: query1Id, queryText: "企业级 GEO 落地最佳实践有哪些推荐？", status: i === 2 ? "LIKELY_RELATED" : "CONFOUNDED", observedChangeType: "POSITIVE", createdById: userAId },
        });
        await request(http)
          .post(`/outcomes/${out.id}/learning-observations`)
          .set("Cookie", cookiesA)
          .send({})
          .expect(200);
      }

      // Now Query 1 has 3 independent observations of type BRAND_MENTION_CHANGE
      const summaryRes = await request(http)
        .get(`/projects/${projectA1Id}/learning-summary`)
        .set("Cookie", cookiesA)
        .expect(200);

      expect(summaryRes.body.totalObservations).toBeGreaterThanOrEqual(3);
      const pattern = summaryRes.body.patterns.find(
        (p: any) => p.aggregateKey === `query_pattern:${query1Id}:BRAND_MENTION_CHANGE`,
      );
      expect(pattern).toBeDefined();
      expect(pattern.sampleCount).toBe(3);
      expect(pattern.supportingObservationIds.length).toBe(3);
      expect(pattern.likelyRelatedCount).toBe(2);
      expect(pattern.confoundedCount).toBe(1);
      expect(pattern.attributionDistribution["LIKELY_RELATED"]).toBe(2);
      expect(pattern.attributionDistribution["CONFOUNDED"]).toBe(1);
      expect(pattern.summary).toContain("3 次独立评测样本");

      // Verify no confidence % exists on the pattern
      expect(pattern).not.toHaveProperty("confidence");
      expect(pattern).not.toHaveProperty("successProbability");
    });
  });

  // =========================================================================
  // 5. Lineage Traversal & Historical Immutability
  // =========================================================================
  describe("5. Lineage Traversal & Immutability Verification", () => {
    it("5.1 Full Lineage backward & forward from LearningObservation to Strategy", async () => {
      const obs = await prisma.learningObservation.findFirst({
        where: { outcomeComparisonId: outcome1_LikelyRelatedId },
        include: {
          outcomeAttribution: {
            include: {
              outcomeComparison: {
                include: {
                  retestRun: {
                    include: {
                      publishedAsset: {
                        include: {
                          publication: {
                            include: {
                              campaign: {
                                include: {
                                  strategy: true,
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      expect(obs).toBeDefined();
      expect(obs!.outcomeAttribution.id).toBe(attr1_LikelyRelatedId);
      expect(obs!.outcomeAttribution.outcomeComparison.id).toBe(outcome1_LikelyRelatedId);
      expect(obs!.outcomeAttribution.outcomeComparison.publishedAssetId).toBe(publishedAssetA1Id);
      expect(obs!.outcomeAttribution.outcomeComparison.retestRun.publishedAsset.publication?.campaign?.strategy.title).toBe("GEO 落地最佳实践战略");
    });

    it("5.2 M10 Records (Outcome, Attribution, PublishedAsset, Publication) are NOT mutated", async () => {
      const outcome = await prisma.outcomeComparison.findUnique({ where: { id: outcome1_LikelyRelatedId } });
      expect(outcome?.comparisonStatus).toBe("COMPARABLE");

      const attribution = await prisma.outcomeAttribution.findUnique({ where: { id: attr1_LikelyRelatedId } });
      expect(attribution?.status).toBe("LIKELY_RELATED");

      const asset = await prisma.publishedAsset.findUnique({ where: { id: publishedAssetA1Id } });
      expect(asset?.verificationStatus).toBe("PLATFORM_CONFIRMED");
    });
  });
});
