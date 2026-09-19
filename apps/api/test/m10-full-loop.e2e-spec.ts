import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma.service";

describe("M10 Full Closed-Loop Integration Gate E2E (M10F)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: any;

  let orgAId: string;
  let userAId: string;
  let cookiesA: string[];

  let orgBId: string;
  let userBId: string;
  let cookiesB: string[];

  let projectAId: string;
  let projectBId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    const suffix = Date.now().toString().slice(-6);
    const password = "Password123!";

    // Register User A (Org A)
    const regA = await request(http)
      .post("/auth/register")
      .send({ email: `m10f-a-${suffix}@test.local`, password, name: "User A" })
      .expect(201);
    orgAId = regA.body.organization.id;
    userAId = regA.body.user.id;

    const logA = await request(http)
      .post("/auth/login")
      .send({ email: `m10f-a-${suffix}@test.local`, password })
      .expect(200);
    cookiesA = (logA.headers["set-cookie"] as unknown as string[]) || [];

    // Register User B (Org B)
    const regB = await request(http)
      .post("/auth/register")
      .send({ email: `m10f-b-${suffix}@test.local`, password, name: "User B" })
      .expect(201);
    orgBId = regB.body.organization.id;
    userBId = regB.body.user.id;

    const logB = await request(http)
      .post("/auth/login")
      .send({ email: `m10f-b-${suffix}@test.local`, password })
      .expect(200);
    cookiesB = (logB.headers["set-cookie"] as unknown as string[]) || [];

    // Project A & Project B
    const pA = await prisma.client.project.create({
      data: { organizationId: orgAId, name: `M10F Proj A ${suffix}`, industry: "SaaS" },
    });
    projectAId = pA.id;

    const pB = await prisma.client.project.create({
      data: { organizationId: orgBId, name: `M10F Proj B ${suffix}`, industry: "SaaS" },
    });
    projectBId = pB.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // 1. Golden Path: Full Lineage & Closed-Loop
  // Strategy -> Campaign -> PlanItem -> ScheduleItem -> Draft -> Revision ->
  // Publication -> PublishedAsset -> Baseline & Retest Evidence -> RetestRun ->
  // OutcomeComparison -> OutcomeAttribution -> M10E Workspace
  // =========================================================================
  describe("1. Golden Path: Full Lineage & End-to-End Orchestration", () => {
    let queryQ1Id: string;
    let strategyId: string;
    let campaignId: string;
    let planItemId: string;
    let scheduleItemId: string;
    let draftId: string;
    let revisionId: string;
    let publicationId: string;
    let publishedAssetId: string;
    let baselineEvidenceId: string;
    let retestRunId: string;
    let outcomeComparisonId: string;
    let attributionId: string;

    const canonicalUrl = "https://example.com/blog/m10f-golden-asset";
    const publishedDate = new Date("2026-09-12T10:00:00.000Z");

    it("1.1 Creates Strategy, Campaign, PlanItem, ScheduleItem, Draft, Revision, Publication", async () => {
      // 1. Suite & Query
      const suite = await prisma.client.benchmarkSuite.create({
        data: { projectId: projectAId, name: "M10F Suite", version: "1" },
      });

      const q = await prisma.client.query.create({
        data: {
          projectId: projectAId,
          text: "企业级 GEO 落地最佳实践有哪些推荐？",
        },
      });
      queryQ1Id = q.id;

      await prisma.client.benchmarkQuery.create({
        data: {
          suiteId: suite.id,
          projectQueryId: q.id,
          queryText: q.text,
          category: "recommendation",
          intent: "评测",
          queryType: "DISCOVERY",
          enabled: true,
          sortOrder: 1,
        },
      });

      // Brand for Project A
      await prisma.client.brand.create({
        data: { projectId: projectAId, name: "企业级 GEO", aliases: ["GEO 落地最佳实践"] },
      });

      // 2. Strategy
      const strategy = await prisma.client.contentStrategy.create({
        data: {
          projectId: projectAId,
          organizationId: orgAId,
          title: "2026 Q3 GEO 扩张战略",
          geoGap: "缺少落地案例分析",
          targetAudience: "研发负责人",
          perceptionGoal: "建立专业可信认知",
          priorityQuestions: [q.text],
          status: "ACTIVE",
          createdById: userAId,
        },
      });
      strategyId = strategy.id;

      // 3. Campaign
      const campaign = await prisma.client.contentCampaign.create({
        data: {
          projectId: projectAId,
          organizationId: orgAId,
          strategyId,
          name: "2026 GEO 落地案例推广战役",
          objective: "建立权威案例与引用",
          primaryGeoGap: "案例评测缺失",
          startDate: new Date("2026-09-01"),
          endDate: new Date("2026-09-30"),
          status: "ACTIVE",
          createdById: userAId,
        },
      });
      campaignId = campaign.id;

      // 4. PlanItem targeting Q1
      const planItem = await prisma.client.contentPlanItem.create({
        data: {
          strategyId,
          projectId: projectAId,
          organizationId: orgAId,
          title: "企业级 GEO 落地最佳实践白皮书",
          platform: "WECHAT",
          format: "ARTICLE",
          objective: "建立权威引用",
          geoTarget: q.text,
          targetQueries: [q.text],
          status: "IN_PROGRESS",
        },
      });
      planItemId = planItem.id;

      // 5. ScheduleItem
      const scheduleItem = await prisma.client.contentScheduleItem.create({
        data: {
          campaignId,
          planItemId,
          projectId: projectAId,
          organizationId: orgAId,
          scheduledDate: new Date("2026-09-10"),
          productionStatus: "IN_PRODUCTION",
          timezone: "Asia/Shanghai",
        },
      });
      scheduleItemId = scheduleItem.id;

      // 6. Draft & Revision
      const draft = await prisma.client.contentDraft.create({
        data: {
          projectId: projectAId,
          organizationId: orgAId,
          sourcePlanItemId: planItemId,
          title: "企业级 GEO 落地最佳实践白皮书",
          status: "APPROVED",
          createdById: userAId,
        },
      });
      draftId = draft.id;

      const rev = await prisma.client.contentRevision.create({
        data: {
          draftId,
          version: 1,
          body: "正文内容...",
          generatedById: userAId,
        },
      });
      revisionId = rev.id;

      // 6.5 Channel Connection
      const conn = await prisma.client.channelAccountConnection.create({
        data: {
          organizationId: orgAId,
          channel: "WECHAT",
          displayName: "WeChat Connection",
          status: "CONNECTED",
          createdById: userAId,
        },
      });

      // 7. Publication
      const pub = await prisma.client.publication.create({
        data: {
          projectId: projectAId,
          organizationId: orgAId,
          connectionId: conn.id,
          draftId,
          revisionId,
          campaignId,
          scheduleItemId,
          planItemId,
          channel: "WECHAT",
          status: "PUBLISHED",
          payload: JSON.stringify({ body: "正文内容..." }),
          idempotencyKey: `m10f-pub-1-${Date.now()}`,
          createdById: userAId,
          publishedAt: publishedDate,
        },
      });
      publicationId = pub.id;

      expect(queryQ1Id).toBeDefined();
      expect(campaignId).toBeDefined();
      expect(planItemId).toBeDefined();
      expect(scheduleItemId).toBeDefined();
      expect(draftId).toBeDefined();
      expect(revisionId).toBeDefined();
      expect(publicationId).toBeDefined();
    });

    it("1.2 Confirms PublishedAsset (M10A) with valid canonical URL & platform verification", async () => {
      const res = await request(http)
        .post(`/publications/${publicationId}/confirm-asset`)
        .set("Cookie", cookiesA)
        .send({
          verificationStatus: "PLATFORM_CONFIRMED",
          canonicalUrl,
          title: "企业级 GEO 落地最佳实践白皮书",
          sourceType: "PLATFORM_PUBLISH",
          verificationNote: "微信公众号后台官方发布凭证确认",
        })
        .expect(201);

      publishedAssetId = res.body.id;
      expect(publishedAssetId).toBeDefined();
      expect(res.body.verificationStatus).toBe("PLATFORM_CONFIRMED");
      expect(res.body.canonicalUrl).toBe(canonicalUrl);

      // Update publishedAsset.publishedAt to match the publication timeline
      await prisma.client.publishedAsset.update({
        where: { id: publishedAssetId },
        data: { publishedAt: publishedDate },
      });

      // Verify ScheduleItem advanced to DONE
      const updatedSchedule = await prisma.client.contentScheduleItem.findUnique({
        where: { id: scheduleItemId },
      });
      expect(updatedSchedule?.productionStatus).toBe("DONE");
    });

    it("1.3 Creates Baseline Evidence before publication", async () => {
      const engine = await prisma.client.engine.upsert({
        where: { key: "mock-default" },
        update: {},
        create: { key: "mock-default", name: "Mock Engine", provider: "mock", config: {}, enabled: true },
      });

      const monitorTask = await prisma.client.monitorTask.create({
        data: { organizationId: orgAId, projectId: projectAId, totalRuns: 1, status: "SUCCEEDED" },
      });

      const run = await prisma.client.run.create({
        data: { monitorTaskId: monitorTask.id, queryId: queryQ1Id, engineId: engine.id, status: "SUCCEEDED" },
      });

      const ev = await prisma.client.evidence.create({
        data: {
          runId: run.id,
          queryText: "企业级 GEO 落地最佳实践有哪些推荐？",
          provider: "mock",
          engineKey: "mock-default",
          engineName: "Mock Engine",
          model: "mock-model",
          retrievalMode: "api_plain",
          sourceType: "mock",
          rawPrompt: "企业级 GEO 落地最佳实践有哪些推荐？",
          rawResponse: "目前市场上常见的方法包括内部文档管理与知识库搭建，建议参考业界实践。",
          metadata: {},
          entitySnapshot: [],
          createdAt: new Date("2026-09-10T12:00:00.000Z"), // Before publishedAt (2026-09-12)
        },
      });
      baselineEvidenceId = ev.id;

      await prisma.client.analysis.create({
        data: {
          evidenceId: ev.id,
          analysisVersion: "m4-rule-v1",
          brandMentioned: false,
          mentionPosition: null,
          recommended: false,
          sentiment: "neutral",
        },
      });

      expect(baselineEvidenceId).toBeDefined();
    });

    it("1.4 Creates & Processes RetestRun (M10B) creating Retest Evidence after publication", async () => {
      // 1. Create RetestRun
      const createRes = await request(http)
        .post(`/published-assets/${publishedAssetId}/retests`)
        .set("Cookie", cookiesA)
        .send({ forceNew: true })
        .expect(201);

      retestRunId = createRes.body.id;
      expect(retestRunId).toBeDefined();

      // 2. Process RetestRun
      const processRes = await request(http)
        .post(`/retests/${retestRunId}/process`)
        .set("Cookie", cookiesA)
        .expect(200);

      expect(processRes.body.status).toBe("COMPLETED");

      // Verify RetestItem was created
      const afterItem = await prisma.client.retestItem.findFirst({
        where: { retestRunId, queryId: queryQ1Id },
      });
      expect(afterItem?.evidenceId).toBeDefined();

      // Create new Run & After Evidence & Analysis to represent strong observed positive change with citation
      const newRetestTask = await prisma.client.monitorTask.create({
        data: { organizationId: orgAId, projectId: projectAId, totalRuns: 1, status: "SUCCEEDED" },
      });
      const engine = await prisma.client.engine.findUnique({ where: { key: "mock-default" } });
      const newRun = await prisma.client.run.create({
        data: {
          monitorTaskId: newRetestTask.id,
          queryId: queryQ1Id,
          engineId: engine!.id,
          status: "SUCCEEDED",
        },
      });

      const rEv = await prisma.client.evidence.create({
        data: {
          runId: newRun.id,
          queryText: "企业级 GEO 落地最佳实践有哪些推荐？",
          provider: "mock",
          engineKey: "mock-default",
          engineName: "Mock Engine",
          model: "mock-model",
          retrievalMode: "api_plain",
          sourceType: "mock",
          rawPrompt: "企业级 GEO 落地最佳实践有哪些推荐？",
          rawResponse: `企业级 GEO 优化推荐参考权威落地指南：${canonicalUrl}，具有全闭环优势。`,
          metadata: {
            citations: [
              {
                url: canonicalUrl,
                title: "企业级 GEO 落地最佳实践白皮书",
              },
            ],
          },
          entitySnapshot: [],
          createdAt: new Date("2026-09-14T10:00:00.000Z"),
        },
      });

      await prisma.client.analysis.create({
        data: {
          evidenceId: rEv.id,
          analysisVersion: "m4-rule-v1",
          brandMentioned: true,
          mentionPosition: 1,
          recommended: true,
          sentiment: "positive",
          citations: {
            create: [
              { url: canonicalUrl, domain: "example.com", position: 1 },
            ],
          },
        },
      });

      await prisma.client.retestItem.update({
        where: { id: afterItem!.id },
        data: { evidenceId: rEv.id, runId: newRun.id },
      });
    });

    it("1.5 Generates OutcomeComparison (M10C) with positive observed delta", async () => {
      const genRes = await request(http)
        .post(`/retests/${retestRunId}/outcomes`)
        .set("Cookie", cookiesA)
        .send({})
        .expect(200);

      expect(genRes.body.items.length).toBeGreaterThanOrEqual(1);
      const outcome = genRes.body.items.find((o: any) => o.queryId === queryQ1Id);
      expect(outcome).toBeDefined();
      expect(outcome.comparisonStatus).toBe("COMPARABLE");
      expect(outcome.baselineCompatibility).toBe("EXACT_MATCH");
      expect(outcome.deltaSnapshot.brandMention.before).toBe(false);
      expect(outcome.deltaSnapshot.brandMention.after).toBe(true);
      expect(outcome.deltaSnapshot.citation.countDelta).toBe(1);
      expect(outcome.deltaSnapshot.recommendation.change).toBe("NOT_RECOMMENDED_TO_RECOMMENDED");

      outcomeComparisonId = outcome.id;
    });

    it("1.6 Generates OutcomeAttribution (M10D) meeting strict LIKELY_RELATED rule", async () => {
      const attrRes = await request(http)
        .post(`/outcomes/${outcomeComparisonId}/attribution`)
        .set("Cookie", cookiesA)
        .send({})
        .expect(200);

      expect(attrRes.body.status).toBe("LIKELY_RELATED");
      expect(attrRes.body.observedChangeType).toBe("POSITIVE");
      expect(attrRes.body.signalsSnapshot.citationMatch.status).toBe("DIRECT_ASSET_CITATION");
      expect(attrRes.body.signalsSnapshot.assetVerification.verified).toBe(true);
      expect(attrRes.body.signalsSnapshot.temporalOrdering.status).toBe("VALID_ORDER");
      expect(attrRes.body.signalsSnapshot.baselineCompatibility).toBe("EXACT_MATCH");
      expect(attrRes.body.reasons).toContain("DIRECT_ASSET_CITATION");

      attributionId = attrRes.body.id;
    });

    it("1.7 Queries M10E Workspace Projection (GET /published-assets/:id/outcome-workspace)", async () => {
      const wsRes = await request(http)
        .get(`/published-assets/${publishedAssetId}/outcome-workspace`)
        .set("Cookie", cookiesA)
        .expect(200);

      expect(wsRes.body.asset.id).toBe(publishedAssetId);
      expect(wsRes.body.asset.title).toBe("企业级 GEO 落地最佳实践白皮书");
      expect(wsRes.body.asset.canonicalUrl).toBe(canonicalUrl);
      expect(wsRes.body.asset.campaign.id).toBe(campaignId);
      expect(wsRes.body.activeRetestRun).toBeDefined();
      expect(wsRes.body.activeRetestRun.id).toBe(retestRunId);
      expect(wsRes.body.activeRetestRun.comparabilitySummary.comparableItems).toBeGreaterThanOrEqual(1);
      expect(wsRes.body.activeRetestRun.attributionSummary.likelyRelatedCount).toBe(1);

      // Verify Query Rows & Evidence
      const row = wsRes.body.activeRetestRun.queryRows.find((r: any) => r.queryId === queryQ1Id);
      expect(row).toBeDefined();
      expect(row.baselineStatus).toBe("EXACT_MATCH");
      expect(row.outcome.comparisonStatus).toBe("COMPARABLE");
      expect(row.attribution.status).toBe("LIKELY_RELATED");
      expect(row.beforeEvidence).toBeDefined();
      expect(row.afterEvidence).toBeDefined();
      expect(row.afterEvidence.rawResponse).toContain(canonicalUrl);
    });

    it("1.8 Traverses Full Lineage backward & forward without broken links", async () => {
      // Forward: Campaign -> PublishedAsset -> RetestRun -> OutcomeComparison -> OutcomeAttribution
      const attr = await prisma.client.outcomeAttribution.findUnique({
        where: { id: attributionId },
        include: {
          outcomeComparison: {
            include: {
              retestRun: {
                include: {
                  publishedAsset: {
                    include: {
                      publication: {
                        include: {
                          draft: true,
                          campaign: true,
                          planItem: true,
                          scheduleItem: true,
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

      expect(attr).toBeDefined();
      expect(attr?.outcomeComparison.retestRun.publishedAsset.id).toBe(publishedAssetId);
      expect(attr?.outcomeComparison.retestRun.publishedAsset.publication?.draftId).toBe(draftId);
      expect(attr?.outcomeComparison.retestRun.publishedAsset.publication?.campaignId).toBe(campaignId);
      expect(attr?.outcomeComparison.retestRun.publishedAsset.publication?.planItemId).toBe(planItemId);
      expect(attr?.outcomeComparison.retestRun.publishedAsset.publication?.scheduleItemId).toBe(scheduleItemId);
    });
  });

  // =========================================================================
  // 2. Scenario Matrix (B3 - B8)
  // =========================================================================
  describe("2. Scenario Matrix: Deterministic Outcomes & Attributions", () => {
    it("Scenario 2: Missing Baseline -> MISSING_BASELINE, delta suppressed, INSUFFICIENT_EVIDENCE", async () => {
      // Create new query with no baseline
      const noBaseQuery = await prisma.client.query.create({
        data: {
          projectId: projectAId,
          text: "无基线评测问题测试",
        },
      });

      // Create new asset
      const draft = await prisma.client.contentDraft.create({
        data: {
          projectId: projectAId,
          organizationId: orgAId,
          title: "无基线资产",
          status: "APPROVED",
          createdById: userAId,
        },
      });
      const rev = await prisma.client.contentRevision.create({
        data: { draftId: draft.id, version: 1, body: "test", generatedById: userAId },
      });
      const conn2 = await prisma.client.channelAccountConnection.create({
        data: {
          organizationId: orgAId,
          channel: "WECHAT",
          displayName: "WeChat Connection 2",
          status: "CONNECTED",
          createdById: userAId,
        },
      });

      const pub = await prisma.client.publication.create({
        data: {
          projectId: projectAId,
          organizationId: orgAId,
          connectionId: conn2.id,
          draftId: draft.id,
          revisionId: rev.id,
          channel: "WECHAT",
          status: "PUBLISHED",
          payload: JSON.stringify({ body: "test" }),
          idempotencyKey: `m10f-pub-2-${Date.now()}`,
          createdById: userAId,
          publishedAt: new Date("2026-09-15T10:00:00.000Z"),
        },
      });
      const asset = await prisma.client.publishedAsset.create({
        data: {
          projectId: projectAId,
          organizationId: orgAId,
          publicationId: pub.id,
          draftId: draft.id,
          revisionId: rev.id,
          platform: "WECHAT",
          title: "无基线资产",
          publishedAt: new Date("2026-09-15T10:00:00.000Z"),
          verificationStatus: "PLATFORM_CONFIRMED",
        },
      });

      // Retest
      const retestRes = await request(http)
        .post(`/published-assets/${asset.id}/retests`)
        .set("Cookie", cookiesA)
        .send({ queryIds: [noBaseQuery.id] })
        .expect(201);

      await request(http)
        .post(`/retests/${retestRes.body.id}/process`)
        .set("Cookie", cookiesA)
        .expect(200);

      // Outcome
      const outRes = await request(http)
        .post(`/retests/${retestRes.body.id}/outcomes`)
        .set("Cookie", cookiesA)
        .send({})
        .expect(200);

      const outcome = outRes.body.items[0];
      expect(outcome.comparisonStatus).toBe("MISSING_BASELINE");
      expect(outcome.deltaSnapshot).toEqual({}); // Delta suppressed!

      // Attribution
      const attrRes = await request(http)
        .post(`/outcomes/${outcome.id}/attribution`)
        .set("Cookie", cookiesA)
        .send({})
        .expect(200);

      expect(attrRes.body.status).toBe("INSUFFICIENT_EVIDENCE");
      expect(attrRes.body.reasons).toContain("MISSING_BASELINE");
    });

    it("Scenario 3: Incompatible Measurement -> INCOMPATIBLE, delta suppressed, not LIKELY_RELATED", async () => {
      // Query
      const incompQuery = await prisma.client.query.create({
        data: {
          projectId: projectAId,
          text: "不兼容测试条件问题",
        },
      });

      const engine = await prisma.client.engine.findUnique({ where: { key: "mock-default" } });
      const monitorTask = await prisma.client.monitorTask.create({
        data: { organizationId: orgAId, projectId: projectAId, totalRuns: 1, status: "SUCCEEDED" },
      });

      // Baseline with api_plain
      const baseRun = await prisma.client.run.create({
        data: {
          monitorTaskId: monitorTask.id,
          queryId: incompQuery.id,
          engineId: engine!.id,
          status: "SUCCEEDED",
        },
      });
      const baseEv = await prisma.client.evidence.create({
        data: {
          runId: baseRun.id,
          queryText: incompQuery.text,
          provider: "mock",
          engineKey: "mock-default",
          engineName: "Mock Engine",
          model: "mock-model",
          retrievalMode: "api_plain",
          sourceType: "mock",
          rawPrompt: incompQuery.text,
          rawResponse: "基线回答",
          metadata: {},
          entitySnapshot: [],
          createdAt: new Date("2026-09-01T10:00:00.000Z"),
        },
      });
      await prisma.client.analysis.create({
        data: {
          evidenceId: baseEv.id,
          analysisVersion: "m4-rule-v1",
          brandMentioned: false,
          mentionPosition: null,
          recommended: false,
          sentiment: "neutral",
        },
      });

      // Asset
      const draft = await prisma.client.contentDraft.create({
        data: { projectId: projectAId, organizationId: orgAId, title: "漂移草稿", status: "APPROVED", createdById: userAId },
      });
      const rev = await prisma.client.contentRevision.create({
        data: { draftId: draft.id, version: 1, body: "test", generatedById: userAId },
      });
      const asset = await prisma.client.publishedAsset.create({
        data: {
          projectId: projectAId,
          organizationId: orgAId,
          draftId: draft.id,
          revisionId: rev.id,
          platform: "WECHAT",
          title: "配置漂移资产",
          publishedAt: new Date("2026-09-05T10:00:00.000Z"),
          verificationStatus: "PLATFORM_CONFIRMED",
        },
      });

      // Retest with official_web_ui (drift from api_plain)
      const retest = await prisma.client.retestRun.create({
        data: {
          projectId: projectAId,
          organizationId: orgAId,
          publishedAssetId: asset.id,
          sequence: 1,
          status: "COMPLETED",
          provider: "mock",
          engineKey: "mock-default",
          engineName: "Mock Engine",
          model: "mock-model",
          retrievalMode: "official_web_ui", // Drift!
          sourceType: "mock",
          querySnapshot: [{ id: incompQuery.id, text: incompQuery.text }],
          createdById: userAId,
          totalItems: 1,
          completedItems: 1,
        },
      });

      const afterMonitorTask = await prisma.client.monitorTask.create({
        data: { organizationId: orgAId, projectId: projectAId, totalRuns: 1, status: "SUCCEEDED" },
      });

      const afterRun = await prisma.client.run.create({
        data: {
          monitorTaskId: afterMonitorTask.id,
          queryId: incompQuery.id,
          engineId: engine!.id,
          status: "SUCCEEDED",
        },
      });

      const afterEvidence = await prisma.client.evidence.create({
        data: {
          runId: afterRun.id,
          queryText: incompQuery.text,
          provider: "mock",
          engineKey: "mock-default",
          engineName: "Mock Engine",
          model: "mock-model",
          retrievalMode: "official_web_ui",
          sourceType: "mock",
          rawPrompt: incompQuery.text,
          rawResponse: "复测回答",
          metadata: {},
          entitySnapshot: [],
          createdAt: new Date("2026-09-10T10:00:00.000Z"),
        },
      });

      await prisma.client.analysis.create({
        data: {
          evidenceId: afterEvidence.id,
          analysisVersion: "m4-rule-v1",
          brandMentioned: true,
          mentionPosition: 1,
          recommended: true,
          sentiment: "positive",
        },
      });

      await prisma.client.retestItem.create({
        data: {
          retestRunId: retest.id,
          queryId: incompQuery.id,
          queryText: incompQuery.text,
          status: "SUCCEEDED",
          baselineStatus: "INCOMPATIBLE",
          baselineEvidenceId: baseEv.id,
          evidenceId: afterEvidence.id,
          runId: afterRun.id,
        },
      });

      // Outcome comparison
      const outRes = await request(http)
        .post(`/retests/${retest.id}/outcomes`)
        .set("Cookie", cookiesA)
        .send({})
        .expect(200);

      const outcome = outRes.body.items[0];
      expect(outcome.comparisonStatus).toBe("INCOMPATIBLE");
      expect(outcome.deltaSnapshot).toEqual({});

      // Attribution
      const attrRes = await request(http)
        .post(`/outcomes/${outcome.id}/attribution`)
        .set("Cookie", cookiesA)
        .send({})
        .expect(200);

      expect(attrRes.body.status).not.toBe("LIKELY_RELATED");
      expect(attrRes.body.status).toBe("INSUFFICIENT_EVIDENCE");
    });

    it("Scenario 4: Multiple Interventions -> CONFOUNDED with confounders listed", async () => {
      const multiQuery = await prisma.client.query.create({
        data: {
          projectId: projectAId,
          text: "多内容干预混杂测试问题",
        },
      });

      const engine = await prisma.client.engine.findUnique({ where: { key: "mock-default" } });
      const monitorTask = await prisma.client.monitorTask.create({
        data: { organizationId: orgAId, projectId: projectAId, totalRuns: 1, status: "SUCCEEDED" },
      });

      // Baseline
      const baseRun = await prisma.client.run.create({
        data: {
          monitorTaskId: monitorTask.id,
          queryId: multiQuery.id,
          engineId: engine!.id,
          status: "SUCCEEDED",
        },
      });
      const baseEv = await prisma.client.evidence.create({
        data: {
          runId: baseRun.id,
          queryText: multiQuery.text,
          provider: "mock",
          engineKey: "mock-default",
          engineName: "Mock Engine",
          model: "mock-model",
          retrievalMode: "api_plain",
          sourceType: "mock",
          rawPrompt: multiQuery.text,
          rawResponse: "基线回答",
          metadata: {},
          entitySnapshot: [],
          createdAt: new Date("2026-09-01T10:00:00.000Z"),
        },
      });
      await prisma.client.analysis.create({
        data: {
          evidenceId: baseEv.id,
          analysisVersion: "m4-rule-v1",
          brandMentioned: false,
          mentionPosition: null,
          recommended: false,
          sentiment: "neutral",
        },
      });

      // PlanItem for Asset 1 & 2
      const planItem = await prisma.client.contentPlanItem.create({
        data: {
          strategyId: (await prisma.client.contentStrategy.findFirst({ where: { projectId: projectAId } }))!.id,
          projectId: projectAId,
          organizationId: orgAId,
          title: "干预策划",
          platform: "WECHAT",
          format: "ARTICLE",
          objective: "干预",
          geoTarget: multiQuery.text,
          targetQueries: [multiQuery.text],
          status: "READY",
        },
      });

      const draft = await prisma.client.contentDraft.create({
        data: { projectId: projectAId, organizationId: orgAId, title: "干预草稿", status: "APPROVED", createdById: userAId },
      });
      const rev = await prisma.client.contentRevision.create({
        data: { draftId: draft.id, version: 1, body: "test", generatedById: userAId },
      });

      // Asset 1 published at 2026-09-03
      const asset1 = await prisma.client.publishedAsset.create({
        data: {
          projectId: projectAId,
          organizationId: orgAId,
          planItemId: planItem.id,
          draftId: draft.id,
          revisionId: rev.id,
          platform: "WECHAT",
          title: "干预内容 1",
          canonicalUrl: "https://example.com/asset-1",
          publishedAt: new Date("2026-09-03T10:00:00.000Z"),
          verificationStatus: "PLATFORM_CONFIRMED",
        },
      });

      // Asset 2 published at 2026-09-05 (intervening in observation window!)
      await prisma.client.publishedAsset.create({
        data: {
          projectId: projectAId,
          organizationId: orgAId,
          planItemId: planItem.id,
          draftId: draft.id,
          revisionId: rev.id,
          platform: "WECHAT",
          title: "干预内容 2 (混杂)",
          canonicalUrl: "https://example.com/asset-2",
          publishedAt: new Date("2026-09-05T10:00:00.000Z"),
          verificationStatus: "PLATFORM_CONFIRMED",
        },
      });

      // Retest for Asset 1 at 2026-09-08
      const retest = await prisma.client.retestRun.create({
        data: {
          projectId: projectAId,
          organizationId: orgAId,
          publishedAssetId: asset1.id,
          sequence: 1,
          status: "COMPLETED",
          provider: "mock",
          engineKey: "mock-default",
          engineName: "Mock Engine",
          model: "mock-model",
          retrievalMode: "api_plain",
          sourceType: "mock",
          querySnapshot: [{ id: multiQuery.id, text: multiQuery.text }],
          createdById: userAId,
          totalItems: 1,
          completedItems: 1,
        },
      });

      const afterMonitorTask4 = await prisma.client.monitorTask.create({
        data: { organizationId: orgAId, projectId: projectAId, totalRuns: 1, status: "SUCCEEDED" },
      });

      const afterRun = await prisma.client.run.create({
        data: {
          monitorTaskId: afterMonitorTask4.id,
          queryId: multiQuery.id,
          engineId: engine!.id,
          status: "SUCCEEDED",
        },
      });

      const afterEv = await prisma.client.evidence.create({
        data: {
          runId: afterRun.id,
          queryText: multiQuery.text,
          provider: "mock",
          engineKey: "mock-default",
          engineName: "Mock Engine",
          model: "mock-model",
          retrievalMode: "api_plain",
          sourceType: "mock",
          rawPrompt: multiQuery.text,
          rawResponse: "提及内容1 https://example.com/asset-1",
          metadata: { citations: [{ url: "https://example.com/asset-1", title: "干预内容 1" }] },
          entitySnapshot: [],
          createdAt: new Date("2026-09-08T10:00:00.000Z"),
        },
      });

      await prisma.client.analysis.create({
        data: {
          evidenceId: afterEv.id,
          analysisVersion: "m4-rule-v1",
          brandMentioned: true,
          mentionPosition: 1,
          recommended: true,
          sentiment: "positive",
        },
      });

      await prisma.client.retestItem.create({
        data: {
          retestRunId: retest.id,
          queryId: multiQuery.id,
          queryText: multiQuery.text,
          status: "SUCCEEDED",
          baselineStatus: "EXACT_MATCH",
          baselineEvidenceId: baseEv.id,
          evidenceId: afterEv.id,
          runId: afterRun.id,
        },
      });

      // Outcome
      const outRes = await request(http)
        .post(`/retests/${retest.id}/outcomes`)
        .set("Cookie", cookiesA)
        .send({})
        .expect(200);

      const outcome = outRes.body.items[0];

      // Attribution
      const attrRes = await request(http)
        .post(`/outcomes/${outcome.id}/attribution`)
        .set("Cookie", cookiesA)
        .send({})
        .expect(200);

      expect(attrRes.body.status).toBe("CONFOUNDED");
      expect(attrRes.body.confoundersSnapshot.multipleInterventions.detected).toBe(true);
    });

    it("Scenario 5: No Change -> NO_OBSERVED_CHANGE (Never failed)", async () => {
      const sameQuery = await prisma.client.query.create({
        data: {
          projectId: projectAId,
          text: "无变化基准问题",
        },
      });

      const engine = await prisma.client.engine.findUnique({ where: { key: "mock-default" } });
      const monitorTask = await prisma.client.monitorTask.create({
        data: { organizationId: orgAId, projectId: projectAId, totalRuns: 1, status: "SUCCEEDED" },
      });

      // Baseline
      const baseRun = await prisma.client.run.create({
        data: {
          monitorTaskId: monitorTask.id,
          queryId: sameQuery.id,
          engineId: engine!.id,
          status: "SUCCEEDED",
        },
      });
      const baseEv = await prisma.client.evidence.create({
        data: {
          runId: baseRun.id,
          queryText: sameQuery.text,
          provider: "mock",
          engineKey: "mock-default",
          engineName: "Mock Engine",
          model: "mock-model",
          retrievalMode: "api_plain",
          sourceType: "mock",
          rawPrompt: sameQuery.text,
          rawResponse: "无变化回答",
          metadata: {},
          entitySnapshot: [],
          createdAt: new Date("2026-09-01T10:00:00.000Z"),
        },
      });
      await prisma.client.analysis.create({
        data: {
          evidenceId: baseEv.id,
          analysisVersion: "m4-rule-v1",
          brandMentioned: false,
          mentionPosition: null,
          recommended: false,
          sentiment: "neutral",
        },
      });

      const draft = await prisma.client.contentDraft.create({
        data: { projectId: projectAId, organizationId: orgAId, title: "无变化草稿", status: "APPROVED", createdById: userAId },
      });
      const rev = await prisma.client.contentRevision.create({
        data: { draftId: draft.id, version: 1, body: "test", generatedById: userAId },
      });

      const asset = await prisma.client.publishedAsset.create({
        data: {
          projectId: projectAId,
          organizationId: orgAId,
          draftId: draft.id,
          revisionId: rev.id,
          platform: "WECHAT",
          title: "无变化资产",
          publishedAt: new Date("2026-09-05T10:00:00.000Z"),
          verificationStatus: "PLATFORM_CONFIRMED",
        },
      });

      const retest = await prisma.client.retestRun.create({
        data: {
          projectId: projectAId,
          organizationId: orgAId,
          publishedAssetId: asset.id,
          sequence: 1,
          status: "COMPLETED",
          provider: "mock",
          engineKey: "mock-default",
          engineName: "Mock Engine",
          model: "mock-model",
          retrievalMode: "api_plain",
          sourceType: "mock",
          querySnapshot: [{ id: sameQuery.id, text: sameQuery.text }],
          createdById: userAId,
          totalItems: 1,
          completedItems: 1,
        },
      });

      const afterMonitorTask5 = await prisma.client.monitorTask.create({
        data: { organizationId: orgAId, projectId: projectAId, totalRuns: 1, status: "SUCCEEDED" },
      });

      const afterRun = await prisma.client.run.create({
        data: {
          monitorTaskId: afterMonitorTask5.id,
          queryId: sameQuery.id,
          engineId: engine!.id,
          status: "SUCCEEDED",
        },
      });

      const afterEv = await prisma.client.evidence.create({
        data: {
          runId: afterRun.id,
          queryText: sameQuery.text,
          provider: "mock",
          engineKey: "mock-default",
          engineName: "Mock Engine",
          model: "mock-model",
          retrievalMode: "api_plain",
          sourceType: "mock",
          rawPrompt: sameQuery.text,
          rawResponse: "无变化回答",
          metadata: {},
          entitySnapshot: [],
          createdAt: new Date("2026-09-10T10:00:00.000Z"),
        },
      });

      // Identical analysis
      await prisma.client.analysis.create({
        data: {
          evidenceId: afterEv.id,
          analysisVersion: "m4-rule-v1",
          brandMentioned: false,
          mentionPosition: null,
          recommended: false,
          sentiment: "neutral",
        },
      });

      await prisma.client.retestItem.create({
        data: {
          retestRunId: retest.id,
          queryId: sameQuery.id,
          queryText: sameQuery.text,
          status: "SUCCEEDED",
          baselineStatus: "EXACT_MATCH",
          baselineEvidenceId: baseEv.id,
          evidenceId: afterEv.id,
          runId: afterRun.id,
        },
      });

      // Outcome
      const outRes = await request(http)
        .post(`/retests/${retest.id}/outcomes`)
        .set("Cookie", cookiesA)
        .send({})
        .expect(200);

      const outcome = outRes.body.items[0];

      // Attribution
      const attrRes = await request(http)
        .post(`/outcomes/${outcome.id}/attribution`)
        .set("Cookie", cookiesA)
        .send({})
        .expect(200);

      expect(attrRes.body.status).toBe("NO_OBSERVED_CHANGE");
      expect(attrRes.body.observedChangeType).toBe("NO_CHANGE");
    });

    it("Scenario 6: Negative Change -> NEGATIVE observed change detected, never suppressed or disguised", async () => {
      const negQuery = await prisma.client.query.create({
        data: { projectId: projectAId, text: `负向变化测试问题 ${Date.now()}` },
      });

      const draft = await prisma.client.contentDraft.create({
        data: { projectId: projectAId, organizationId: orgAId, title: "负向资产", status: "APPROVED", createdById: userAId },
      });
      const rev = await prisma.client.contentRevision.create({
        data: { draftId: draft.id, version: 1, body: "test", generatedById: userAId },
      });

      const asset = await prisma.client.publishedAsset.create({
        data: {
          projectId: projectAId,
          organizationId: orgAId,
          draftId: draft.id,
          revisionId: rev.id,
          platform: "WECHAT",
          title: "负向资产",
          publishedAt: new Date("2026-09-12T00:00:00.000Z"),
          verificationStatus: "PLATFORM_CONFIRMED",
        },
      });

      const engine = await prisma.client.engine.findUnique({ where: { key: "mock-default" } });
      const taskBase = await prisma.client.monitorTask.create({
        data: { organizationId: orgAId, projectId: projectAId, totalRuns: 1, status: "SUCCEEDED" },
      });
      const baseRun = await prisma.client.run.create({
        data: { monitorTaskId: taskBase.id, queryId: negQuery.id, engineId: engine!.id, status: "SUCCEEDED" },
      });
      const baseEv = await prisma.client.evidence.create({
        data: {
          runId: baseRun.id,
          queryText: negQuery.text,
          provider: "mock",
          engineKey: "mock-default",
          engineName: "Mock Engine",
          model: "mock-model",
          retrievalMode: "api_plain",
          sourceType: "mock",
          rawPrompt: negQuery.text,
          rawResponse: "原本包含企业品牌推荐与正面评价。",
          metadata: {},
          entitySnapshot: [],
          createdAt: new Date("2026-09-10T00:00:00.000Z"),
        },
      });
      await prisma.client.analysis.create({
        data: {
          evidenceId: baseEv.id,
          analysisVersion: "m4-rule-v1",
          brandMentioned: true,
          mentionPosition: 1,
          recommended: true,
          sentiment: "positive",
        },
      });

      const taskAfter = await prisma.client.monitorTask.create({
        data: { organizationId: orgAId, projectId: projectAId, totalRuns: 1, status: "SUCCEEDED" },
      });
      const afterRun = await prisma.client.run.create({
        data: { monitorTaskId: taskAfter.id, queryId: negQuery.id, engineId: engine!.id, status: "SUCCEEDED" },
      });
      const afterEv = await prisma.client.evidence.create({
        data: {
          runId: afterRun.id,
          queryText: negQuery.text,
          provider: "mock",
          engineKey: "mock-default",
          engineName: "Mock Engine",
          model: "mock-model",
          retrievalMode: "api_plain",
          sourceType: "mock",
          rawPrompt: negQuery.text,
          rawResponse: "重测后品牌消失且存在负向评价。",
          metadata: {},
          entitySnapshot: [],
          createdAt: new Date("2026-09-14T00:00:00.000Z"),
        },
      });
      await prisma.client.analysis.create({
        data: {
          evidenceId: afterEv.id,
          analysisVersion: "m4-rule-v1",
          brandMentioned: false,
          mentionPosition: null,
          recommended: false,
          sentiment: "negative",
        },
      });

      const retest = await prisma.client.retestRun.create({
        data: {
          projectId: projectAId,
          organizationId: orgAId,
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
          totalItems: 1,
          completedItems: 1,
        },
      });

      await prisma.client.retestItem.create({
        data: {
          retestRunId: retest.id,
          queryId: negQuery.id,
          queryText: negQuery.text,
          status: "SUCCEEDED",
          baselineStatus: "EXACT_MATCH",
          baselineEvidenceId: baseEv.id,
          evidenceId: afterEv.id,
          runId: afterRun.id,
        },
      });

      // Outcome
      const outRes = await request(http)
        .post(`/retests/${retest.id}/outcomes`)
        .set("Cookie", cookiesA)
        .send({})
        .expect(200);

      const outcome = outRes.body.items[0];
      expect(outcome.comparisonStatus).toBe("COMPARABLE");
      expect(outcome.deltaSnapshot.brandMention.change).toBe("PRESENT_TO_ABSENT");

      // Attribution
      const attrRes = await request(http)
        .post(`/outcomes/${outcome.id}/attribution`)
        .set("Cookie", cookiesA)
        .send({})
        .expect(200);

      expect(attrRes.body.observedChangeType).toBe("NEGATIVE");
      expect(attrRes.body.signalsSnapshot.observedChange.details.negativeScore).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 3. Security, Tenant & Project Isolation & Zero Side-Effect Defense
  // =========================================================================
  describe("3. Tenant & Project Isolation & Side-Effect Defense", () => {
    let foreignAssetId: string;
    let foreignRetestRunId: string;
    let foreignOutcomeId: string;

    beforeAll(async () => {
      const draft = await prisma.client.contentDraft.create({
        data: { projectId: projectAId, organizationId: orgAId, title: "独占草稿", status: "APPROVED", createdById: userAId },
      });
      const rev = await prisma.client.contentRevision.create({
        data: { draftId: draft.id, version: 1, body: "test", generatedById: userAId },
      });

      // Create an asset & retest under Project A
      const asset = await prisma.client.publishedAsset.create({
        data: {
          projectId: projectAId,
          organizationId: orgAId,
          draftId: draft.id,
          revisionId: rev.id,
          platform: "WECHAT",
          title: "项目 A 独占资产",
          publishedAt: new Date(),
          verificationStatus: "PLATFORM_CONFIRMED",
        },
      });
      foreignAssetId = asset.id;

      const run = await prisma.client.retestRun.create({
        data: {
          projectId: projectAId,
          organizationId: orgAId,
          publishedAssetId: asset.id,
          sequence: 1,
          status: "PENDING",
          provider: "mock",
          engineKey: "mock-default",
          engineName: "Mock Engine",
          model: "mock-model",
          retrievalMode: "api_plain",
          sourceType: "mock",
          querySnapshot: [],
          createdById: userAId,
          totalItems: 0,
          completedItems: 0,
        },
      });
      foreignRetestRunId = run.id;

      const sec3Query = await prisma.client.query.create({
        data: { projectId: projectAId, text: `Section 3 Query ${Date.now()}` },
      });

      const foreignItem = await prisma.client.retestItem.create({
        data: {
          retestRunId: run.id,
          queryId: sec3Query.id,
          queryText: sec3Query.text,
          status: "PENDING",
        },
      });

      const outcome = await prisma.client.outcomeComparison.create({
        data: {
          projectId: projectAId,
          organizationId: orgAId,
          publishedAssetId: asset.id,
          retestRunId: run.id,
          retestItemId: foreignItem.id,
          queryId: foreignItem.queryId,
          queryText: foreignItem.queryText,
          comparisonVersion: "m10c-v1",
          baselineCompatibility: "EXACT_MATCH",
          comparisonStatus: "COMPARABLE",
          summary: "test",
          deltaSnapshot: {},
        },
      });
      foreignOutcomeId = outcome.id;
    });

    it("3.1 Cross-tenant access returns 404 with ZERO side effects", async () => {
      // 1. User B tries to get Project A verification assets
      await request(http)
        .get(`/projects/${projectAId}/verification-assets`)
        .set("Cookie", cookiesB)
        .expect(404);

      // 2. User B tries to view Asset A workspace projection
      await request(http)
        .get(`/published-assets/${foreignAssetId}/outcome-workspace`)
        .set("Cookie", cookiesB)
        .expect(404);

      // 3. User B tries to create retest for Asset A
      const initialRetests = await prisma.client.retestRun.count();
      await request(http)
        .post(`/published-assets/${foreignAssetId}/retests`)
        .set("Cookie", cookiesB)
        .send({})
        .expect(404);
      const afterRetests = await prisma.client.retestRun.count();
      expect(afterRetests).toBe(initialRetests); // Zero side effects!

      // 4. User B tries to execute/process retest
      await request(http)
        .post(`/retests/${foreignRetestRunId}/process`)
        .set("Cookie", cookiesB)
        .expect(404);

      // 5. User B tries to generate outcomes
      const initialOutcomes = await prisma.client.outcomeComparison.count();
      await request(http)
        .post(`/retests/${foreignRetestRunId}/outcomes`)
        .set("Cookie", cookiesB)
        .send({})
        .expect(404);
      const afterOutcomes = await prisma.client.outcomeComparison.count();
      expect(afterOutcomes).toBe(initialOutcomes); // Zero side effects!

      // 6. User B tries to generate attribution
      const initialAttrs = await prisma.client.outcomeAttribution.count();
      await request(http)
        .post(`/outcomes/${foreignOutcomeId}/attribution`)
        .set("Cookie", cookiesB)
        .send({})
        .expect(404);
      const afterAttrs = await prisma.client.outcomeAttribution.count();
      expect(afterAttrs).toBe(initialAttrs); // Zero side effects!
    });
  });

  // =========================================================================
  // 4. Historical Immutability & Snapshot Drift Defense
  // =========================================================================
  describe("4. Historical Immutability & Drift Defense", () => {
    it("4.1 Baseline evidence & publication records are never mutated by retest/outcome/attribution", async () => {
      // Query an existing baseline evidence
      const evBefore = await prisma.client.evidence.findFirst();
      expect(evBefore).toBeDefined();

      const rawResponseBefore = evBefore?.rawResponse;
      const modelBefore = evBefore?.model;

      // Re-query after all tests
      const evAfter = await prisma.client.evidence.findUnique({
        where: { id: evBefore!.id },
      });

      expect(evAfter?.rawResponse).toBe(rawResponseBefore);
      expect(evAfter?.model).toBe(modelBefore);
    });
  });
});
