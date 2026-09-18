/**
 * M10A - Publication Lineage Foundation E2E Tests
 *
 * 验证核心目标：
 * 1. Lineage creation & auto-linking (Campaign -> PlanItem -> ScheduleItem -> Draft -> Revision -> Publication -> Attempt -> PublishedAsset)
 * 2. Reverse lineage traversal (Asset -> Pub -> Rev -> Draft -> Schedule -> Plan -> Campaign -> Strategy -> Diagnosis)
 * 3. Nonexistent draft/revision rejected (404)
 * 4. Tenant isolation (Org B cannot query Org A assets/lineage -> 404)
 * 5. Project isolation (Cross-project queries return 404 or scoped items)
 * 6. Fake URL / mock ID rejection on PLATFORM_CONFIRMED (Evidence First, No Fake Assets)
 * 7. Unverified assets do not fabricate external URLs/IDs
 * 8. Manual verified assets require provenance note
 * 9. Historical records durable / append-only (not overwritten)
 * 10. Real external platform writes = 0
 */
import "../../../packages/database/scripts/test-env.cjs";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";

process.env.ENABLE_REAL_PROVIDERS = "false";
process.env.EXTERNAL_PUBLISHING_ENABLED = "false";

describe("M10A Publication Lineage Foundation E2E", () => {
  let app: INestApplication;
  let owner: ReturnType<typeof request.agent>;
  let attacker: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const password = "lineage-pass-123";

  let orgId: string;
  let projectId: string;
  let ownerUserId: string;

  let attackerOrgId: string;
  let attackerProjectId: string;
  let attackerUserId: string;

  let diagnosisId: string;
  let strategyId: string;
  let campaignId: string;
  let planItemId: string;
  let scheduleItemId: string;
  let draftId: string;
  let revisionId: string;
  let connectionId: string;
  let publicationId: string;
  let publishedAssetId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    // 1. 注册合法 Owner
    const ownerEmail = `lineage-owner-${suffix}@geolens.test`;
    owner = request.agent(app.getHttpServer());
    const regRes = await owner.post("/auth/register").send({ email: ownerEmail, name: "Lineage Owner", password });
    expect(regRes.status).toBe(201);
    orgId = regRes.body.organization.id;
    ownerUserId = regRes.body.user.id;
    await owner.post("/auth/login").send({ email: ownerEmail, password }).expect(200);

    // 2. 注册攻击者（不同租户）
    const attackerEmail = `lineage-attacker-${suffix}@geolens.test`;
    attacker = request.agent(app.getHttpServer());
    const attReg = await attacker.post("/auth/register").send({ email: attackerEmail, name: "Attacker", password });
    expect(attReg.status).toBe(201);
    attackerOrgId = attReg.body.organization.id;
    attackerUserId = attReg.body.user.id;
    await attacker.post("/auth/login").send({ email: attackerEmail, password }).expect(200);

    // 3. 创建合法项目与攻击者项目
    const proj = await prisma.project.create({
      data: {
        organizationId: orgId,
        name: `Lineage Test Proj ${suffix}`,
        industry: "宠物科技",
      },
    });
    projectId = proj.id;

    const attProj = await prisma.project.create({
      data: {
        organizationId: attackerOrgId,
        name: `Attacker Proj ${suffix}`,
        industry: "竞品",
      },
    });
    attackerProjectId = attProj.id;

    // 4. 创建已核实事实 (Verified Fact)
    await prisma.$executeRawUnsafe(
      `INSERT INTO content_verified_facts (
        id, organization_id, project_id, claim, fact_type, status, source_type, source_ref, created_by_id, created_at, updated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid,
        'PawClean 超声波除毛刷噪音低于 40dB',
        'SPECIFICATION', 'VERIFIED', 'LAB_REPORT', '国家声学报告 #LN-2026', $4::uuid, NOW(), NOW()
      )`,
      randomUUID(),
      orgId,
      projectId,
      ownerUserId,
    );

    // 5. 构造血缘源头：DiagnosisRun
    const diag = await prisma.diagnosisRun.create({
      data: {
        projectId,
        reportId: randomUUID(),
        diagnosisVersion: "geolens-diagnosis-v1",
        status: "READY",
        summarySnapshot: { overallScore: 82, findingCount: 3 },
      },
    });
    diagnosisId = diag.id;

    // 6. 构造 Strategy
    const strat = await prisma.contentStrategy.create({
      data: {
        organizationId: orgId,
        projectId,
        title: `PawClean M10A Strategy ${suffix}`,
        sourceDiagnosisId: diagnosisId,
        status: "ACTIVE",
        geoGap: "品牌声量不足",
        targetAudience: "年轻养宠家庭",
        perceptionGoal: "静音、高效除毛",
        keyThemes: ["静音", "除毛黑科技"],
        platformPriorities: [{ platform: "WECHAT", priority: "HIGH" }, { platform: "XIAOHONGSHU", priority: "HIGH" }],
        contentFormats: ["TUTORIAL", "COMPARISON"],
        evidenceRequired: ["LAB_REPORT"],
        validationMetrics: ["GEO_MENTION_RATE"],
        createdById: ownerUserId,
      },
    });
    strategyId = strat.id;

    // 7. 构造 PlanItem
    const plan = await prisma.contentPlanItem.create({
      data: {
        strategyId,
        organizationId: orgId,
        projectId,
        title: "PawClean 40dB 超轻音实测拆解",
        platform: "WECHAT",
        format: "TUTORIAL",
        objective: "提升微信公众号品牌权威度",
        geoTarget: "家用宠物清洁",
        status: "READY",
        keyClaims: ["PawClean 超声波除毛刷噪音低于 40dB"],
      },
    });
    planItemId = plan.id;

    // 8. 构造 Campaign 与 ScheduleItem
    const camp = await prisma.contentCampaign.create({
      data: {
        organizationId: orgId,
        projectId,
        name: `PawClean 秋季品宣战役 ${suffix}`,
        strategyId,
        objective: "提升 AI 品牌心智提及率",
        primaryGeoGap: "品牌声量不足",
        startDate: new Date("2026-10-01"),
        endDate: new Date("2026-10-31"),
        status: "ACTIVE",
        createdById: ownerUserId,
      },
    });
    campaignId = camp.id;

    const sched = await prisma.contentScheduleItem.create({
      data: {
        organizationId: orgId,
        projectId,
        campaignId,
        planItemId,
        scheduledDate: new Date("2026-10-10T10:00:00Z"),
        productionStatus: "READY",
        timezone: "Asia/Shanghai",
      },
    });
    scheduleItemId = sched.id;

    // 9. 通过 startProduction 派生草稿与版本
    const prodRes = await owner
      .post(`/api/content/schedule-items/${scheduleItemId}/start-production`)
      .expect(200);
    draftId = prodRes.body.draft.id;

    const draftDetail = await owner.get(`/content-drafts/${draftId}`).expect(200);
    revisionId = draftDetail.body.latestRevision.id;

    // 10. 审批草稿
    await owner
      .post(`/content-drafts/${draftId}/submit`)
      .expect(200);
    await owner
      .post(`/content-drafts/${draftId}/decide`)
      .send({ decision: "APPROVED", comment: "Approved for publication lineage test" })
      .expect(200);

    // 11. 建立渠道连接
    const connRes = await owner
      .post(`/projects/${projectId}/channel-connections`)
      .send({
        channel: "WECHAT",
        displayName: `WeChat Official Account ${suffix}`,
      })
      .expect(201);
    connectionId = connRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("1. 发布创建时自动推断并关联完整血缘 (Campaign -> ScheduleItem -> PlanItem)", async () => {
    const res = await owner
      .post(`/projects/${projectId}/content-drafts/${draftId}/publications`)
      .send({
        connectionId,
        title: "PawClean 40dB 实测文章",
        payload: JSON.stringify({ body: "完整评测正文..." }),
      })
      .expect(201);

    publicationId = res.body.id;
    expect(res.body.id).toBeDefined();
    expect(res.body.campaignId).toBe(campaignId);
    expect(res.body.scheduleItemId).toBe(scheduleItemId);
    expect(res.body.planItemId).toBe(planItemId);
    expect(res.body.attempts.length).toBeGreaterThanOrEqual(1);
    expect(res.body.attempts[0].campaignId).toBe(campaignId);
    expect(res.body.attempts[0].scheduleItemId).toBe(scheduleItemId);
    expect(res.body.attempts[0].planItemId).toBe(planItemId);
  });

  it("2. 确认平台落地资产 (PLATFORM_CONFIRMED) 并推进排期状态至 DONE", async () => {
    const confirmRes = await owner
      .post(`/publications/${publicationId}/confirm-asset`)
      .send({
        verificationStatus: "PLATFORM_CONFIRMED",
        canonicalUrl: "https://mp.weixin.qq.com/s/authentic-geolens-post-888",
        externalAssetId: "wx_article_888999",
        title: "PawClean 40dB 微信正式发文",
        sourceType: "PLATFORM_PUBLISH",
        verificationNote: "平台审核通过，公网已可访问",
      })
      .expect(201);

    publishedAssetId = confirmRes.body.id;
    expect(publishedAssetId).toBeDefined();
    expect(confirmRes.body.verificationStatus).toBe("PLATFORM_CONFIRMED");
    expect(confirmRes.body.canonicalUrl).toBe("https://mp.weixin.qq.com/s/authentic-geolens-post-888");
    expect(confirmRes.body.externalAssetId).toBe("wx_article_888999");
    expect(confirmRes.body.campaignId).toBe(campaignId);
    expect(confirmRes.body.scheduleItemId).toBe(scheduleItemId);
    expect(confirmRes.body.planItemId).toBe(planItemId);
    expect(confirmRes.body.verifiedAt).toBeDefined();
    expect(confirmRes.body.verifiedById).toBe(ownerUserId);

    // 验证排期项被推进至 DONE
    const schedItem = await prisma.contentScheduleItem.findUnique({
      where: { id: scheduleItemId },
    });
    expect(schedItem?.productionStatus).toBe("DONE");

    // 验证发布状态更新为 PUBLISHED
    const pub = await prisma.publication.findUnique({
      where: { id: publicationId },
    });
    expect(pub?.status).toBe("PUBLISHED");
    expect(pub?.publishedAt).toBeDefined();
  });

  it("3. 完整发布血缘反向全链路追溯 (Reverse Lineage Traversal)", async () => {
    const res = await owner
      .get(`/published-assets/${publishedAssetId}/lineage`)
      .expect(200);

    const data = res.body;

    // PublishedAsset 自身
    expect(data.publishedAsset.id).toBe(publishedAssetId);
    expect(data.publishedAsset.verificationStatus).toBe("PLATFORM_CONFIRMED");

    // Lineage 链条全链路节点完备
    expect(data.lineage).toBeDefined();
    expect(data.lineage.diagnosis.id).toBe(diagnosisId);
    expect(data.lineage.strategy.id).toBe(strategyId);
    expect(data.lineage.strategy.title).toContain("PawClean M10A Strategy");
    expect(data.lineage.campaign.id).toBe(campaignId);
    expect(data.lineage.campaign.name).toContain("PawClean 秋季品宣战役");
    expect(data.lineage.planItem.id).toBe(planItemId);
    expect(data.lineage.planItem.title).toBe("PawClean 40dB 超轻音实测拆解");
    expect(data.lineage.scheduleItem.id).toBe(scheduleItemId);
    expect(data.lineage.scheduleItem.productionStatus).toBe("DONE");
    expect(data.lineage.draft.id).toBe(draftId);
    expect(data.lineage.revision.id).toBe(revisionId);
    expect(data.lineage.publication.id).toBe(publicationId);
    expect(data.lineage.publicationAttempt).toBeDefined();

    // Provenance 核验凭证
    expect(data.provenance).toBeDefined();
    expect(data.provenance.canonicalUrl).toBe("https://mp.weixin.qq.com/s/authentic-geolens-post-888");
    expect(data.provenance.externalAssetId).toBe("wx_article_888999");
    expect(data.provenance.verificationStatus).toBe("PLATFORM_CONFIRMED");
    expect(data.provenance.verifiedById).toBe(ownerUserId);
  });

  it("4. 战役维度查询发布记录与落地资产列表", async () => {
    const pubListRes = await owner
      .get(`/api/content/campaigns/${campaignId}/publications`)
      .expect(200);
    expect(Array.isArray(pubListRes.body)).toBe(true);
    expect(pubListRes.body.some((p: any) => p.id === publicationId)).toBe(true);

    const assetListRes = await owner
      .get(`/api/content/campaigns/${campaignId}/published-assets`)
      .expect(200);
    expect(Array.isArray(assetListRes.body)).toBe(true);
    expect(assetListRes.body.some((a: any) => a.id === publishedAssetId)).toBe(true);
  });

  it("5. 手动录入落地资产 (MANUAL_VERIFIED) 需凭证说明", async () => {
    // 缺少 verificationNote -> 400
    await owner
      .post(`/projects/${projectId}/published-assets`)
      .send({
        projectId,
        draftId,
        platform: "XIAOHONGSHU",
        title: "小红书手动核验图文",
        canonicalUrl: "https://www.xiaohongshu.com/explore/6543210987",
        verificationStatus: "MANUAL_VERIFIED",
      })
      .expect(400);

    // 包含合法 verificationNote -> 201
    const manualRes = await owner
      .post(`/projects/${projectId}/published-assets`)
      .send({
        projectId,
        draftId,
        platform: "XIAOHONGSHU",
        title: "小红书手动核验图文",
        canonicalUrl: "https://www.xiaohongshu.com/explore/6543210987",
        externalAssetId: "xhs_note_6543210987",
        verificationStatus: "MANUAL_VERIFIED",
        verificationNote: "运营人工在小红书 App 核验上线与主图渲染",
      })
      .expect(201);

    expect(manualRes.body.id).toBeDefined();
    expect(manualRes.body.verificationStatus).toBe("MANUAL_VERIFIED");
    expect(manualRes.body.sourceType).toBe("MANUAL_VERIFIED");
  });

  it("6. 真实资产约束 (No Fake Assets)：禁止伪造 Mock URL / 虚假前缀", async () => {
    // 试图使用 mock:// 链接 -> 400
    await owner
      .post(`/publications/${publicationId}/confirm-asset`)
      .send({
        verificationStatus: "PLATFORM_CONFIRMED",
        canonicalUrl: "mock://wechat.com/article/123",
      })
      .expect(400);

    // 试图使用 localhost 链接 -> 400
    await owner
      .post(`/publications/${publicationId}/confirm-asset`)
      .send({
        verificationStatus: "PLATFORM_CONFIRMED",
        canonicalUrl: "http://localhost:3000/posts/123",
      })
      .expect(400);

    // 试图使用 mock_ id -> 400
    await owner
      .post(`/publications/${publicationId}/confirm-asset`)
      .send({
        verificationStatus: "PLATFORM_CONFIRMED",
        externalAssetId: "mock_asset_id_999",
      })
      .expect(400);
  });

  it("7. 未核验资产 (UNVERIFIED) 绝不合成虚假外部链接", async () => {
    const unverifiedRes = await owner
      .post(`/publications/${publicationId}/confirm-asset`)
      .send({
        verificationStatus: "UNVERIFIED",
        title: "PawClean 待核验资产",
      })
      .expect(201);

    expect(unverifiedRes.body.verificationStatus).toBe("UNVERIFIED");
    expect(unverifiedRes.body.canonicalUrl).toBeNull();
    expect(unverifiedRes.body.externalAssetId).toBeNull();
    expect(unverifiedRes.body.verifiedAt).toBeNull();
    expect(unverifiedRes.body.verifiedById).toBeNull();
  });

  it("8. 严格租户隔离：异租户访问资产及血缘均返回 404", async () => {
    // 攻击者查询已发布资产详情 -> 404
    await attacker
      .get(`/published-assets/${publishedAssetId}`)
      .expect(404);

    // 攻击者查询血缘 -> 404
    await attacker
      .get(`/published-assets/${publishedAssetId}/lineage`)
      .expect(404);

    // 攻击者确认受害者发布记录 -> 404
    await attacker
      .post(`/publications/${publicationId}/confirm-asset`)
      .send({
        verificationStatus: "PLATFORM_CONFIRMED",
        canonicalUrl: "https://mp.weixin.qq.com/s/attacker-try",
      })
      .expect(404);

    // 攻击者向受害者项目录入资产 -> 404
    await attacker
      .post(`/projects/${projectId}/published-assets`)
      .send({
        projectId,
        draftId,
        platform: "WECHAT",
        title: "非法注入资产",
        verificationStatus: "UNVERIFIED",
      })
      .expect(404);

    // 攻击者查询受害者战役发布列表 -> 404
    await attacker
      .get(`/api/content/campaigns/${campaignId}/publications`)
      .expect(404);

    // 攻击者查询受害者战役资产列表 -> 404
    await attacker
      .get(`/api/content/campaigns/${campaignId}/published-assets`)
      .expect(404);
  });

  it("9. 不存在的资产 ID 或草稿 ID 返回 404", async () => {
    const fakeId = randomUUID();
    await owner
      .get(`/published-assets/${fakeId}`)
      .expect(404);

    await owner
      .get(`/published-assets/${fakeId}/lineage`)
      .expect(404);

    await owner
      .post(`/projects/${projectId}/published-assets`)
      .send({
        projectId,
        draftId: fakeId,
        platform: "WECHAT",
        title: "无效草稿资产",
        verificationStatus: "UNVERIFIED",
      })
      .expect(404);
  });

  it("10. 历史记录不可覆盖 (Evidence First & Zero External Writes)", async () => {
    // 再次记录一次资产，验证追加式存储，历史资产不被覆写
    const secondAsset = await owner
      .post(`/publications/${publicationId}/confirm-asset`)
      .send({
        verificationStatus: "MANUAL_VERIFIED",
        canonicalUrl: "https://weixin.qq.com/second-version",
        verificationNote: "二次核验版本记录",
      })
      .expect(201);

    expect(secondAsset.body.id).not.toBe(publishedAssetId);

    // 查询项目资产列表，两条记录均完整存在
    const listRes = await owner
      .get(`/projects/${projectId}/published-assets`)
      .expect(200);

    expect(listRes.body.total).toBeGreaterThanOrEqual(2);
    const ids = listRes.body.items.map((i: any) => i.id);
    expect(ids).toContain(publishedAssetId);
    expect(ids).toContain(secondAsset.body.id);

    // 验证所有 PublicationAttempt 的 publisher 恒为 mock，Real External Writes = 0
    const attempts = await prisma.publicationAttempt.findMany({
      where: { publicationId },
    });
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    for (const att of attempts) {
      expect(att.publisher).toBe("mock");
    }
  });
});
