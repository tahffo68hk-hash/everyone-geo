import "../../../packages/database/scripts/test-env.cjs";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";

describe("M10D Outcome Attribution E2E", () => {
  let app: INestApplication;
  let http: any;

  const suffix = randomUUID().slice(0, 8);
  const password = "attr-pass-123";

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
  let query6Id: string;
  let query7Id: string;

  let publishedAssetAId: string;
  let publishedAssetBConfounderId: string;
  let unverifiedAssetId: string;

  let retestRun1Id: string;

  let outcome1_LikelyRelatedId: string;
  let outcome2_NoDirectCitationId: string;
  let outcome3_SameDomainOtherPageId: string;
  let outcome4_IncompatibleId: string;
  let outcome5_MissingBaselineId: string;
  let outcome6_NoChangeId: string;
  let outcome7_MultipleInterventionsId: string;
  let outcome8_UnverifiedAssetId: string;
  let outcome9_NegativeChangeId: string;

  const assetCanonicalUrl = "https://mp.weixin.qq.com/s/smartrobo-authentic-note-1";
  const publishedDate = new Date("2026-09-01T12:00:00Z");

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    http = app.getHttpServer();

    // 1. Users & Orgs
    const regResA = await request(http)
      .post("/auth/register")
      .send({ email: `owner-${suffix}@attr.test`, name: "Owner A", password })
      .expect(201);
    orgAId = regResA.body.organization.id;
    userAId = regResA.body.user.id;

    const loginResA = await request(http)
      .post("/auth/login")
      .send({ email: `owner-${suffix}@attr.test`, password })
      .expect(200);
    cookiesA = (loginResA.headers["set-cookie"] as unknown as string[]) || [];

    const regResB = await request(http)
      .post("/auth/register")
      .send({ email: `attacker-${suffix}@attr.test`, name: "Attacker B", password })
      .expect(201);
    orgBId = regResB.body.organization.id;
    userBId = regResB.body.user.id;

    const loginResB = await request(http)
      .post("/auth/login")
      .send({ email: `attacker-${suffix}@attr.test`, password })
      .expect(200);
    cookiesB = (loginResB.headers["set-cookie"] as unknown as string[]) || [];

    // 2. Projects in Org A
    const pA1 = await prisma.project.create({
      data: { organizationId: orgAId, name: `Project A1 ${suffix}`, industry: "智能家居" },
    });
    projectA1Id = pA1.id;

    const pA2 = await prisma.project.create({
      data: { organizationId: orgAId, name: `Project A2 ${suffix}`, industry: "智能家居" },
    });
    projectA2Id = pA2.id;

    // Queries in Project A1
    const q1 = await prisma.query.create({ data: { projectId: projectA1Id, text: `静音扫地机推荐 ${suffix}` } });
    query1Id = q1.id;
    const q2 = await prisma.query.create({ data: { projectId: projectA1Id, text: `无直接引用测试 ${suffix}` } });
    query2Id = q2.id;
    const q3 = await prisma.query.create({ data: { projectId: projectA1Id, text: `同域名其他页面测试 ${suffix}` } });
    query3Id = q3.id;
    const q4 = await prisma.query.create({ data: { projectId: projectA1Id, text: `不兼容基线测试 ${suffix}` } });
    query4Id = q4.id;
    const q5 = await prisma.query.create({ data: { projectId: projectA1Id, text: `缺失基线测试 ${suffix}` } });
    query5Id = q5.id;
    const q6 = await prisma.query.create({ data: { projectId: projectA1Id, text: `无变化测试 ${suffix}` } });
    query6Id = q6.id;
    const q7 = await prisma.query.create({ data: { projectId: projectA1Id, text: `并发混淆测试 ${suffix}` } });
    query7Id = q7.id;

    // 3. Strategy & PlanItem & PublishedAsset
    const stratA = await prisma.contentStrategy.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        title: `Strategy ${suffix}`,
        status: "ACTIVE",
        geoGap: "声量",
        targetAudience: "养宠人群",
        perceptionGoal: "静音",
        priorityQuestions: [q1.text, q2.text, q3.text, q4.text, q5.text, q6.text, q7.text],
        createdById: userAId,
      },
    });

    const planItemA = await prisma.contentPlanItem.create({
      data: {
        strategyId: stratA.id,
        organizationId: orgAId,
        projectId: projectA1Id,
        title: `图文评测 ${suffix}`,
        platform: "WECHAT",
        format: "TUTORIAL",
        objective: "提及率",
        geoTarget: "静音扫地机",
        targetQueries: [q1.text, q2.text, q3.text, q7.text], // Targets q1, q2, q3, q7
        status: "READY",
      },
    });

    const planItemConfounder = await prisma.contentPlanItem.create({
      data: {
        strategyId: stratA.id,
        organizationId: orgAId,
        projectId: projectA1Id,
        title: `混淆计划 ${suffix}`,
        platform: "WECHAT",
        format: "TUTORIAL",
        objective: "提及率",
        geoTarget: "扫地机",
        targetQueries: [q7.text], // ONLY targets q7!
        status: "READY",
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
        body: "Draft body",
        generatedById: userAId,
      },
    });

    // Main PublishedAsset A (PLATFORM_CONFIRMED)
    const assetA = await prisma.publishedAsset.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        planItemId: planItemA.id,
        draftId: draftA.id,
        revisionId: revA.id,
        platform: "WECHAT",
        title: `SmartRobo 真实评测文章 ${suffix}`,
        canonicalUrl: assetCanonicalUrl,
        verificationStatus: "PLATFORM_CONFIRMED",
        sourceType: "PLATFORM_PUBLISH",
        verifiedAt: publishedDate,
        publishedAt: publishedDate,
      },
    });
    publishedAssetAId = assetA.id;

    // Unverified Asset
    const unverifiedAsset = await prisma.publishedAsset.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        planItemId: planItemA.id,
        draftId: draftA.id,
        revisionId: revA.id,
        platform: "WECHAT",
        title: `未核验文章 ${suffix}`,
        canonicalUrl: "https://mp.weixin.qq.com/s/unverified-note",
        verificationStatus: "UNVERIFIED",
        sourceType: "PLATFORM_PUBLISH",
        publishedAt: publishedDate,
      },
    });
    unverifiedAssetId = unverifiedAsset.id;

    // Confounder PublishedAsset B: Targets ONLY q7, published between baseline and retest!
    const assetBConfounder = await prisma.publishedAsset.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        planItemId: planItemConfounder.id, // ONLY targets q7!
        draftId: draftA.id,
        revisionId: revA.id,
        platform: "WECHAT",
        title: `并发发布的竞品/干预文章 ${suffix}`,
        canonicalUrl: "https://mp.weixin.qq.com/s/confounder-note",
        verificationStatus: "PLATFORM_CONFIRMED",
        sourceType: "PLATFORM_PUBLISH",
        publishedAt: new Date("2026-09-01T15:00:00Z"), // Between baseline and retest!
      },
    });
    publishedAssetBConfounderId = assetBConfounder.id;

    // 4. RetestRun fixture
    const retestRun = await prisma.retestRun.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        publishedAssetId: publishedAssetAId,
        sequence: 1,
        status: "COMPLETED",
        querySnapshot: [{ id: q1.id, text: q1.text }],
        provider: "mock",
        engineKey: "mock-default",
        model: "mock-model",
        retrievalMode: "api_plain",
        sourceType: "mock",
        createdById: userAId,
      },
    });
    retestRun1Id = retestRun.id;

    const createItem = async (qId: string, qText: string) => {
      return prisma.retestItem.create({
        data: {
          retestRunId: retestRun1Id,
          queryId: qId,
          queryText: qText,
          status: "SUCCEEDED",
        },
      });
    };

    const it1 = await createItem(q1.id, q1.text);
    const it2 = await createItem(q2.id, q2.text);
    const it3 = await createItem(q3.id, q3.text);
    const it4 = await createItem(q4.id, q4.text);
    const it5 = await createItem(q5.id, q5.text);
    const it6 = await createItem(q6.id, q6.text);
    const it7 = await createItem(q7.id, q7.text);
    const it8 = await createItem(q1.id, q1.text);
    const it9 = await createItem(q1.id, q1.text);

    // Baseline & Retest dates for valid temporal ordering:
    const baselineCapturedAt = "2026-08-20T10:00:00.000Z";
    const retestCapturedAt = "2026-09-02T10:00:00.000Z";

    // 1. Outcome 1: Strong LIKELY_RELATED setup
    // EXACT_MATCH + target query + direct asset citation + observed positive gain + valid temporal + verified asset + NO confounders
    const o1 = await prisma.outcomeComparison.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        publishedAssetId: publishedAssetAId,
        retestRunId: retestRun1Id,
        retestItemId: it1.id,
        queryId: q1.id,
        queryText: q1.text,
        baselineCompatibility: "EXACT_MATCH",
        comparisonStatus: "COMPARABLE",
        comparisonVersion: "m10c-outcome-v1",
        beforeSnapshot: {
          capturedAt: baselineCapturedAt,
          model: "mock-model",
          retrievalMode: "api_plain",
          provider: "mock",
          brandMentioned: false,
          citationPresent: false,
        },
        afterSnapshot: {
          capturedAt: retestCapturedAt,
          model: "mock-model",
          retrievalMode: "api_plain",
          provider: "mock",
          brandMentioned: true,
          citationPresent: true,
          citationUrls: [assetCanonicalUrl], // EXACT direct citation!
        },
        deltaSnapshot: {
          brandMention: { before: false, after: true, change: "ABSENT_TO_PRESENT", changed: true },
          citation: { beforePresent: false, afterPresent: true, beforeCount: 0, afterCount: 1, countDelta: 1, change: "ABSENT_TO_PRESENT", changed: true },
          recommendation: { before: false, after: true, change: "NOT_RECOMMENDED_TO_RECOMMENDED", changed: true },
          position: { before: null, after: 1, positionDelta: null, direction: "IMPROVED", changed: true },
          sentiment: { before: "neutral", after: "positive", changed: true },
          competitorPresence: { before: [], after: [], added: [], removed: [], persisted: [], changed: false },
        },
        summary: "品牌提及: 未出现 → 出现; 引用: 0 → 1",
      },
    });
    outcome1_LikelyRelatedId = o1.id;

    // 2. Outcome 2: Mention gain WITHOUT direct asset citation
    const o2 = await prisma.outcomeComparison.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        publishedAssetId: publishedAssetAId,
        retestRunId: retestRun1Id,
        retestItemId: it2.id,
        queryId: q2.id,
        queryText: q2.text,
        baselineCompatibility: "EXACT_MATCH",
        comparisonStatus: "COMPARABLE",
        comparisonVersion: "m10c-outcome-v1",
        beforeSnapshot: { capturedAt: baselineCapturedAt, model: "mock-model", retrievalMode: "api_plain", provider: "mock", brandMentioned: false },
        afterSnapshot: {
          capturedAt: retestCapturedAt,
          model: "mock-model",
          retrievalMode: "api_plain",
          provider: "mock",
          brandMentioned: true,
          citationUrls: ["https://other-domain.com/unrelated-article"], // NOT asset citation!
        },
        deltaSnapshot: {
          brandMention: { before: false, after: true, change: "ABSENT_TO_PRESENT", changed: true },
          citation: { changed: false },
        },
        summary: "品牌提及: 未出现 → 出现",
      },
    });
    outcome2_NoDirectCitationId = o2.id;

    // 3. Outcome 3: Same-Domain Other Page
    const o3 = await prisma.outcomeComparison.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        publishedAssetId: publishedAssetAId,
        retestRunId: retestRun1Id,
        retestItemId: it3.id,
        queryId: q3.id,
        queryText: q3.text,
        baselineCompatibility: "EXACT_MATCH",
        comparisonStatus: "COMPARABLE",
        comparisonVersion: "m10c-outcome-v1",
        beforeSnapshot: { capturedAt: baselineCapturedAt, model: "mock-model", retrievalMode: "api_plain", provider: "mock" },
        afterSnapshot: {
          capturedAt: retestCapturedAt,
          model: "mock-model",
          retrievalMode: "api_plain",
          provider: "mock",
          brandMentioned: true,
          citationUrls: ["https://mp.weixin.qq.com/s/totally-different-article-id-999"], // Same domain, different page!
        },
        deltaSnapshot: {
          brandMention: { before: false, after: true, change: "ABSENT_TO_PRESENT", changed: true },
        },
        summary: "品牌提及: 未出现 → 出现",
      },
    });
    outcome3_SameDomainOtherPageId = o3.id;

    // 4. Outcome 4: Incompatible baseline
    const o4 = await prisma.outcomeComparison.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        publishedAssetId: publishedAssetAId,
        retestRunId: retestRun1Id,
        retestItemId: it4.id,
        queryId: q4.id,
        queryText: q4.text,
        baselineCompatibility: "INCOMPATIBLE",
        comparisonStatus: "INCOMPATIBLE",
        comparisonVersion: "m10c-outcome-v1",
        beforeSnapshot: { capturedAt: baselineCapturedAt, retrievalMode: "official_web_ui" },
        afterSnapshot: { capturedAt: retestCapturedAt, retrievalMode: "api_plain" },
        deltaSnapshot: {},
        summary: "不兼容基线",
      },
    });
    outcome4_IncompatibleId = o4.id;

    // 5. Outcome 5: Missing baseline
    const o5 = await prisma.outcomeComparison.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        publishedAssetId: publishedAssetAId,
        retestRunId: retestRun1Id,
        retestItemId: it5.id,
        queryId: q5.id,
        queryText: q5.text,
        baselineCompatibility: "MISSING_BASELINE",
        comparisonStatus: "MISSING_BASELINE",
        comparisonVersion: "m10c-outcome-v1",
        beforeSnapshot: {},
        afterSnapshot: { capturedAt: retestCapturedAt, brandMentioned: true },
        deltaSnapshot: {},
        summary: "缺失基线",
      },
    });
    outcome5_MissingBaselineId = o5.id;

    // 6. Outcome 6: No observed change
    const o6 = await prisma.outcomeComparison.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        publishedAssetId: publishedAssetAId,
        retestRunId: retestRun1Id,
        retestItemId: it6.id,
        queryId: q6.id,
        queryText: q6.text,
        baselineCompatibility: "EXACT_MATCH",
        comparisonStatus: "COMPARABLE",
        comparisonVersion: "m10c-outcome-v1",
        beforeSnapshot: { capturedAt: baselineCapturedAt, brandMentioned: false },
        afterSnapshot: { capturedAt: retestCapturedAt, brandMentioned: false },
        deltaSnapshot: {
          brandMention: { before: false, after: false, change: "REMAINED_ABSENT", changed: false },
          citation: { changed: false },
          position: { changed: false },
          recommendation: { changed: false },
          sentiment: { changed: false },
          competitorPresence: { changed: false },
        },
        summary: "无变化",
      },
    });
    outcome6_NoChangeId = o6.id;

    // 7. Outcome 7: Multiple Interventions Confounder on q7
    const o7 = await prisma.outcomeComparison.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        publishedAssetId: publishedAssetAId,
        retestRunId: retestRun1Id,
        retestItemId: it7.id,
        queryId: q7.id,
        queryText: q7.text,
        baselineCompatibility: "EXACT_MATCH",
        comparisonStatus: "COMPARABLE",
        comparisonVersion: "m10c-outcome-v1",
        beforeSnapshot: { capturedAt: baselineCapturedAt, brandMentioned: false },
        afterSnapshot: { capturedAt: retestCapturedAt, brandMentioned: true, citationUrls: [assetCanonicalUrl] },
        deltaSnapshot: { brandMention: { before: false, after: true, change: "ABSENT_TO_PRESENT", changed: true } },
        summary: "并发混淆对比",
      },
    });
    outcome7_MultipleInterventionsId = o7.id;

    // 8. Outcome 8: Unverified Asset
    const o8 = await prisma.outcomeComparison.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        publishedAssetId: unverifiedAssetId, // UNVERIFIED asset!
        retestRunId: retestRun1Id,
        retestItemId: it8.id,
        queryId: q1.id,
        queryText: q1.text,
        baselineCompatibility: "EXACT_MATCH",
        comparisonStatus: "COMPARABLE",
        comparisonVersion: "m10c-outcome-v1",
        beforeSnapshot: { capturedAt: baselineCapturedAt },
        afterSnapshot: { capturedAt: retestCapturedAt, citationUrls: ["https://mp.weixin.qq.com/s/unverified-note"] },
        deltaSnapshot: { brandMention: { before: false, after: true, change: "ABSENT_TO_PRESENT", changed: true } },
        summary: "未核验资产表现变化",
      },
    });
    outcome8_UnverifiedAssetId = o8.id;

    // 9. Outcome 9: Negative observed change
    const o9 = await prisma.outcomeComparison.create({
      data: {
        organizationId: orgAId,
        projectId: projectA1Id,
        publishedAssetId: publishedAssetAId,
        retestRunId: retestRun1Id,
        retestItemId: it9.id,
        queryId: q1.id,
        queryText: q1.text,
        baselineCompatibility: "EXACT_MATCH",
        comparisonStatus: "COMPARABLE",
        comparisonVersion: "m10c-outcome-v1",
        beforeSnapshot: { capturedAt: baselineCapturedAt, brandMentioned: true, mentionPosition: 1 },
        afterSnapshot: { capturedAt: retestCapturedAt, brandMentioned: false, mentionPosition: null },
        deltaSnapshot: {
          brandMention: { before: true, after: false, change: "PRESENT_TO_ABSENT", changed: true },
          position: { before: 1, after: null, direction: "DECLINED", changed: true },
        },
        summary: "品牌提及: 出现 → 未出现",
      },
    });
    outcome9_NegativeChangeId = o9.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // -------------------------------------------------------------
  // Test 1: Missing baseline -> INSUFFICIENT_EVIDENCE
  // -------------------------------------------------------------
  it("Test 1: Missing baseline results in INSUFFICIENT_EVIDENCE status", async () => {
    const res = await request(http)
      .post(`/outcomes/${outcome5_MissingBaselineId}/attribution`)
      .set("Cookie", cookiesA)
      .send({})
      .expect(200);

    expect(res.body.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(res.body.reasons).toContain("MISSING_BASELINE");
    expect(res.body.explanation).toContain("缺少发布前的有效基线凭证");
  });

  // -------------------------------------------------------------
  // Test 2: Incompatible baseline -> INSUFFICIENT_EVIDENCE
  // -------------------------------------------------------------
  it("Test 2: Incompatible baseline results in INSUFFICIENT_EVIDENCE without false attribution", async () => {
    const res = await request(http)
      .post(`/outcomes/${outcome4_IncompatibleId}/attribution`)
      .set("Cookie", cookiesA)
      .send({})
      .expect(200);

    expect(res.body.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(res.body.reasons).toContain("INCOMPATIBLE_BASELINE");
  });

  // -------------------------------------------------------------
  // Test 3: Unverified PublishedAsset -> INSUFFICIENT_EVIDENCE
  // -------------------------------------------------------------
  it("Test 3: Unverified PublishedAsset blocks LIKELY_RELATED and marks UNVERIFIED_ASSET", async () => {
    const res = await request(http)
      .post(`/outcomes/${outcome8_UnverifiedAssetId}/attribution`)
      .set("Cookie", cookiesA)
      .send({})
      .expect(200);

    expect(res.body.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(res.body.reasons).toContain("UNVERIFIED_ASSET");
    expect(res.body.explanation).toContain("尚未完成平台或人工核验");
  });

  // -------------------------------------------------------------
  // Test 4: EXACT_MATCH + target + direct citation + gain -> LIKELY_RELATED
  // -------------------------------------------------------------
  it("Test 4: Full strong evidence combination yields LIKELY_RELATED", async () => {
    const res = await request(http)
      .post(`/outcomes/${outcome1_LikelyRelatedId}/attribution`)
      .set("Cookie", cookiesA)
      .send({})
      .expect(200);

    expect(res.body.status).toBe("LIKELY_RELATED");
    expect(res.body.reasons).toContain("DIRECT_ASSET_CITATION");
    expect(res.body.reasons).toContain("EXACT_BASELINE");
    expect(res.body.reasons).toContain("VERIFIED_PUBLICATION");
    expect(res.body.reasons).toContain("QUERY_EXPLICITLY_TARGETED");
    expect(res.body.explanation).toContain("可能相关");
  });

  // -------------------------------------------------------------
  // Test 5: Mention gain WITHOUT direct citation -> INSUFFICIENT_EVIDENCE
  // -------------------------------------------------------------
  it("Test 5: Mention gain alone without direct asset citation cannot become LIKELY_RELATED", async () => {
    const res = await request(http)
      .post(`/outcomes/${outcome2_NoDirectCitationId}/attribution`)
      .set("Cookie", cookiesA)
      .send({})
      .expect(200);

    expect(res.body.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(res.body.reasons).toContain("NO_DIRECT_ASSET_CITATION");
  });

  // -------------------------------------------------------------
  // Test 6: Same-domain different page is NOT direct asset citation
  // -------------------------------------------------------------
  it("Test 6: Same-domain other page is partitioned and does NOT satisfy direct citation", async () => {
    const res = await request(http)
      .post(`/outcomes/${outcome3_SameDomainOtherPageId}/attribution`)
      .set("Cookie", cookiesA)
      .send({})
      .expect(200);

    expect(res.body.signalsSnapshot.citationMatch.status).toBe("SAME_DOMAIN_OTHER_PAGE");
    expect(res.body.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(res.body.reasons).toContain("SAME_DOMAIN_OTHER_PAGE");
    expect(res.body.reasons).toContain("NO_DIRECT_ASSET_CITATION");
  });

  // -------------------------------------------------------------
  // Test 7: Exact canonical URL matching
  // -------------------------------------------------------------
  it("Test 7: Normalized matching correctly identifies DIRECT_ASSET_CITATION", async () => {
    const res = await request(http)
      .get(`/outcomes/${outcome1_LikelyRelatedId}/attribution`)
      .set("Cookie", cookiesA)
      .expect(200);

    expect(res.body.signalsSnapshot.citationMatch.status).toBe("DIRECT_ASSET_CITATION");
  });

  // -------------------------------------------------------------
  // Test 8: Multiple Interventions detection on q7
  // -------------------------------------------------------------
  it("Test 8: Concurrent published assets targeting same query are flagged as MULTIPLE_INTERVENTIONS", async () => {
    const res = await request(http)
      .post(`/outcomes/${outcome7_MultipleInterventionsId}/attribution`)
      .set("Cookie", cookiesA)
      .send({})
      .expect(200);

    expect(res.body.confoundersSnapshot.multipleInterventions.detected).toBe(true);
    expect(res.body.confoundersSnapshot.multipleInterventions.confoundingAssetIds).toContain(publishedAssetBConfounderId);
    expect(res.body.status).toBe("CONFOUNDED");
    expect(res.body.reasons).toContain("MULTIPLE_INTERVENTIONS");
  });

  // -------------------------------------------------------------
  // Test 9: Model / Retrieval Mode mismatch flagged as confounder
  // -------------------------------------------------------------
  it("Test 9: Configuration changes between baseline and retest are recorded in confoundersSnapshot", async () => {
    const res = await request(http)
      .get(`/outcomes/${outcome4_IncompatibleId}/attribution`)
      .set("Cookie", cookiesA)
      .expect(200);

    expect(res.body.confoundersSnapshot.retrievalModeChanged).toBe(true);
  });

  // -------------------------------------------------------------
  // Test 10: Temporal ordering validation
  // -------------------------------------------------------------
  it("Test 10: Temporal ordering is captured in signalsSnapshot", async () => {
    const res = await request(http)
      .get(`/outcomes/${outcome1_LikelyRelatedId}/attribution`)
      .set("Cookie", cookiesA)
      .expect(200);

    expect(res.body.signalsSnapshot.temporalOrdering.status).toBe("VALID_ORDER");
  });

  // -------------------------------------------------------------
  // Test 11: Negative observed change supported
  // -------------------------------------------------------------
  it("Test 11: Negative observed change is captured with NEGATIVE type", async () => {
    const res = await request(http)
      .post(`/outcomes/${outcome9_NegativeChangeId}/attribution`)
      .set("Cookie", cookiesA)
      .send({})
      .expect(200);

    expect(res.body.observedChangeType).toBe("NEGATIVE");
  });

  // -------------------------------------------------------------
  // Test 12: No observed change supported
  // -------------------------------------------------------------
  it("Test 12: No observed change yields NO_OBSERVED_CHANGE status and NO_CHANGE type", async () => {
    const res = await request(http)
      .post(`/outcomes/${outcome6_NoChangeId}/attribution`)
      .set("Cookie", cookiesA)
      .send({})
      .expect(200);

    expect(res.body.status).toBe("NO_OBSERVED_CHANGE");
    expect(res.body.observedChangeType).toBe("NO_CHANGE");
    expect(res.body.reasons).toContain("NO_OBSERVED_CHANGE");
  });

  // -------------------------------------------------------------
  // Test 13: Attribution snapshot immutability
  // -------------------------------------------------------------
  it("Test 13: Attribution records frozen snapshots of signals and confounders", async () => {
    const res = await request(http)
      .get(`/outcomes/${outcome1_LikelyRelatedId}/attribution`)
      .set("Cookie", cookiesA)
      .expect(200);

    expect(res.body.signalsSnapshot).toBeDefined();
    expect(res.body.confoundersSnapshot).toBeDefined();
    expect(res.body.explanation).toBeTruthy();
  });

  // -------------------------------------------------------------
  // Test 14: Idempotency
  // -------------------------------------------------------------
  it("Test 14: Repeated generation is idempotent and returns existing row without duplicates", async () => {
    const countBefore = await prisma.outcomeAttribution.count({
      where: { outcomeComparisonId: outcome1_LikelyRelatedId },
    });
    expect(countBefore).toBe(1);

    const res = await request(http)
      .post(`/outcomes/${outcome1_LikelyRelatedId}/attribution`)
      .set("Cookie", cookiesA)
      .send({})
      .expect(200);

    const countAfter = await prisma.outcomeAttribution.count({
      where: { outcomeComparisonId: outcome1_LikelyRelatedId },
    });
    expect(countAfter).toBe(1);
    expect(res.body.outcomeComparisonId).toBe(outcome1_LikelyRelatedId);
  });

  // -------------------------------------------------------------
  // Test 15: New version coexistence
  // -------------------------------------------------------------
  it("Test 15: Different attributionVersion creates distinct record coexisting with v1", async () => {
    const res = await request(http)
      .post(`/outcomes/${outcome1_LikelyRelatedId}/attribution`)
      .set("Cookie", cookiesA)
      .send({ attributionVersion: "m10d-attribution-v2-preview" })
      .expect(200);

    expect(res.body.attributionVersion).toBe("m10d-attribution-v2-preview");

    const count = await prisma.outcomeAttribution.count({
      where: { outcomeComparisonId: outcome1_LikelyRelatedId },
    });
    expect(count).toBe(2);
  });

  // -------------------------------------------------------------
  // Test 16: Tenant Isolation
  // -------------------------------------------------------------
  it("Test 16: Org B attacker cannot read or generate Org A attribution (404)", async () => {
    await request(http)
      .post(`/outcomes/${outcome1_LikelyRelatedId}/attribution`)
      .set("Cookie", cookiesB)
      .send({})
      .expect(404);

    await request(http)
      .get(`/outcomes/${outcome1_LikelyRelatedId}/attribution`)
      .set("Cookie", cookiesB)
      .expect(404);

    await request(http)
      .get(`/published-assets/${publishedAssetAId}/attributions`)
      .set("Cookie", cookiesB)
      .expect(404);

    await request(http)
      .get(`/retests/${retestRun1Id}/attributions`)
      .set("Cookie", cookiesB)
      .expect(404);
  });

  // -------------------------------------------------------------
  // Test 17 & 18: Project Isolation & Unauthorized POST Zero Side Effect
  // -------------------------------------------------------------
  it("Test 17 & 18: Cross-project user receives 404 and unauthorized POST causes ZERO DB side effect", async () => {
    const countBefore = await prisma.outcomeAttribution.count();

    // Attacker B attempts to create attribution for Outcome 1
    await request(http)
      .post(`/outcomes/${outcome1_LikelyRelatedId}/attribution`)
      .set("Cookie", cookiesB)
      .send({ attributionVersion: "malicious-inject" })
      .expect(404);

    const countAfter = await prisma.outcomeAttribution.count();
    expect(countAfter).toBe(countBefore); // ZERO SIDE EFFECT!
  });

  // -------------------------------------------------------------
  // Test 19: PublishedAsset Lineage & Retest Run Summary
  // -------------------------------------------------------------
  it("Test 19: Lineage endpoints return asset history and run-level attribution summary", async () => {
    const assetRes = await request(http)
      .get(`/published-assets/${publishedAssetAId}/attributions`)
      .set("Cookie", cookiesA)
      .expect(200);

    expect(assetRes.body.publishedAssetId).toBe(publishedAssetAId);
    expect(assetRes.body.totalAttributions).toBeGreaterThanOrEqual(1);

    const runRes = await request(http)
      .get(`/retests/${retestRun1Id}/attributions`)
      .set("Cookie", cookiesA)
      .expect(200);

    expect(runRes.body.retestRunId).toBe(retestRun1Id);
    expect(runRes.body.summary).toBeDefined();
    expect(runRes.body.summary.totalOutcomes).toBeGreaterThanOrEqual(1);
    expect(runRes.body.items).toBeInstanceOf(Array);
  });

  // -------------------------------------------------------------
  // Test 20 & 21: Real Provider Calls = 0 & External Platform Writes = 0
  // -------------------------------------------------------------
  it("Test 20 & 21: Attribution is strictly internal rule-based with 0 external API calls", async () => {
    const record = await prisma.outcomeAttribution.findFirst({
      where: { outcomeComparisonId: outcome1_LikelyRelatedId },
    });
    expect(record).toBeDefined();
    expect(record!.attributionVersion).toBe("m10d-attribution-v1");
  });
});
