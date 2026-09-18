import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma.service";

describe("M10E Outcome Attribution Workspace E2E", () => {
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

  let publishedAssetId: string;
  let retestRunId: string;

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

    // Register User A
    const regA = await request(http)
      .post("/auth/register")
      .send({ email: `ws-a-${suffix}@test.local`, password, name: "User A" })
      .expect(201);
    orgAId = regA.body.organization.id;
    userAId = regA.body.user.id;

    const logA = await request(http)
      .post("/auth/login")
      .send({ email: `ws-a-${suffix}@test.local`, password })
      .expect(200);
    cookiesA = (logA.headers["set-cookie"] as unknown as string[]) || [];

    // Register User B
    const regB = await request(http)
      .post("/auth/register")
      .send({ email: `ws-b-${suffix}@test.local`, password, name: "User B" })
      .expect(201);
    orgBId = regB.body.organization.id;
    userBId = regB.body.user.id;

    const logB = await request(http)
      .post("/auth/login")
      .send({ email: `ws-b-${suffix}@test.local`, password })
      .expect(200);
    cookiesB = (logB.headers["set-cookie"] as unknown as string[]) || [];

    // Project A
    const pA = await prisma.client.project.create({
      data: { organizationId: orgAId, name: `Workspace Proj A ${suffix}`, industry: "SaaS" },
    });
    projectAId = pA.id;

    // Project B
    const pB = await prisma.client.project.create({
      data: { organizationId: orgBId, name: `Workspace Proj B ${suffix}`, industry: "SaaS" },
    });
    projectBId = pB.id;

    // Draft & Revision in Project A
    const draft = await prisma.client.contentDraft.create({
      data: {
        organizationId: orgAId,
        projectId: projectAId,
        title: `Workspace Draft ${suffix}`,
        status: "PUBLISHED",
        createdById: userAId,
      },
    });
    const rev = await prisma.client.contentRevision.create({
      data: {
        draftId: draft.id,
        version: 1,
        body: "Draft body content",
        generatedById: userAId,
      },
    });

    // PublishedAsset in Project A
    const asset = await prisma.client.publishedAsset.create({
      data: {
        organizationId: orgAId,
        projectId: projectAId,
        draftId: draft.id,
        revisionId: rev.id,
        platform: "WECHAT",
        title: `Workspace Asset ${suffix}`,
        canonicalUrl: "https://mp.weixin.qq.com/s/workspace-test",
        verificationStatus: "PLATFORM_CONFIRMED",
        sourceType: "PLATFORM_PUBLISH",
      },
    });
    publishedAssetId = asset.id;

    // RetestRun in Project A
    const query = await prisma.client.query.create({
      data: { projectId: projectAId, text: `Workspace Query ${suffix}` },
    });

    const run = await prisma.client.retestRun.create({
      data: {
        organizationId: orgAId,
        projectId: projectAId,
        publishedAssetId: asset.id,
        sequence: 1,
        status: "COMPLETED",
        querySnapshot: [{ id: query.id, text: query.text }],
        provider: "mock",
        engineKey: "mock-default",
        model: "mock-model",
        retrievalMode: "api_plain",
        sourceType: "mock",
        totalItems: 1,
        completedItems: 1,
        createdById: userAId,
      },
    });
    retestRunId = run.id;

    const item = await prisma.client.retestItem.create({
      data: {
        retestRunId: run.id,
        queryId: query.id,
        queryText: query.text,
        status: "SUCCEEDED",
        baselineStatus: "EXACT_MATCH",
      },
    });

    const outcome = await prisma.client.outcomeComparison.create({
      data: {
        organizationId: orgAId,
        projectId: projectAId,
        publishedAssetId: asset.id,
        retestRunId: run.id,
        retestItemId: item.id,
        queryId: query.id,
        queryText: query.text,
        baselineCompatibility: "EXACT_MATCH",
        comparisonStatus: "COMPARABLE",
        summary: "品牌提及: 未出现 → 出现",
        beforeSnapshot: { brandMention: false },
        afterSnapshot: { brandMention: true },
        deltaSnapshot: { brandMention: { changed: true, change: "ABSENT_TO_PRESENT" } },
      },
    });

    await prisma.client.outcomeAttribution.create({
      data: {
        organizationId: orgAId,
        projectId: projectAId,
        publishedAssetId: asset.id,
        retestRunId: run.id,
        retestItemId: item.id,
        outcomeComparisonId: outcome.id,
        queryId: query.id,
        queryText: query.text,
        status: "LIKELY_RELATED",
        observedChangeType: "POSITIVE",
        signalsSnapshot: { baselineCompatibility: "EXACT_MATCH", citationMatch: { status: "DIRECT_ASSET_CITATION" } },
        reasons: ["EXACT_BASELINE", "DIRECT_ASSET_CITATION"],
        explanation: "Before / After 测试条件一致且直接引用落地资产，判定为可能相关。",
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("1. GET /projects/:id/verification-assets returns published assets with retest summary", async () => {
    const res = await request(http)
      .get(`/projects/${projectAId}/verification-assets`)
      .set("Cookie", cookiesA)
      .expect(200);

    expect(res.body.projectId).toBe(projectAId);
    expect(res.body.total).toBe(1);
    const item = res.body.items[0];
    expect(item.id).toBe(publishedAssetId);
    expect(item.comparableQueryCount).toBe(1);
    expect(item.changedQueryCount).toBe(1);
    expect(item.attributionDistribution.likelyRelated).toBe(1);
    expect(item.attributionDistribution.total).toBe(1);
    expect(item.latestRetest.status).toBe("COMPLETED");
  });

  it("2. GET /published-assets/:id/outcome-workspace returns comprehensive projection", async () => {
    const res = await request(http)
      .get(`/published-assets/${publishedAssetId}/outcome-workspace`)
      .set("Cookie", cookiesA)
      .expect(200);

    expect(res.body.asset.id).toBe(publishedAssetId);
    expect(res.body.asset.platform).toBe("WECHAT");
    expect(res.body.activeRetestRun).toBeDefined();
    expect(res.body.activeRetestRun.id).toBe(retestRunId);
    expect(res.body.activeRetestRun.comparabilitySummary.comparableItems).toBe(1);
    expect(res.body.activeRetestRun.attributionSummary.likelyRelatedCount).toBe(1);
    expect(res.body.activeRetestRun.queryRows.length).toBe(1);

    const qRow = res.body.activeRetestRun.queryRows[0];
    expect(qRow.outcome.comparisonStatus).toBe("COMPARABLE");
    expect(qRow.attribution.status).toBe("LIKELY_RELATED");
    expect(qRow.attribution.observedChangeType).toBe("POSITIVE");
  });

  it("3. Tenant & Project Isolation: User B cannot access Project A verification assets (404)", async () => {
    await request(http)
      .get(`/projects/${projectAId}/verification-assets`)
      .set("Cookie", cookiesB)
      .expect(404);
  });

  it("4. Tenant & Project Isolation: User B cannot access PublishedAsset A outcome workspace (404)", async () => {
    await request(http)
      .get(`/published-assets/${publishedAssetId}/outcome-workspace`)
      .set("Cookie", cookiesB)
      .expect(404);
  });

  it("5. Non-existent IDs return 404", async () => {
    const fakeUuid = "00000000-0000-0000-0000-000000000000";
    await request(http)
      .get(`/projects/${fakeUuid}/verification-assets`)
      .set("Cookie", cookiesA)
      .expect(404);

    await request(http)
      .get(`/published-assets/${fakeUuid}/outcome-workspace`)
      .set("Cookie", cookiesA)
      .expect(404);
  });
});
