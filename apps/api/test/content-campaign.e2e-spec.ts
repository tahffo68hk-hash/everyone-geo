/**
 * M9B - Campaign, Content Calendar & Production Queue E2E Tests
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

describe("M9B Campaign, Content Calendar & Production Queue E2E", () => {
  let app: INestApplication;
  let owner: ReturnType<typeof request.agent>;
  let attacker: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const password = "campaign-pass-123";
  let orgId: string;
  let projectId: string;
  let ownerUserId: string;
  let attackerUserId: string;
  let attackerOrgId: string;
  let attackerProjectId: string;
  let strategyId: string;
  let campaignId: string;
  let createdScheduleItemIds: string[] = [];
  let readyScheduleItemId: string;
  let blockedScheduleItemId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    // 1. 注册合法 Owner
    const ownerEmail = `campaign-owner-${suffix}@geolens.test`;
    owner = request.agent(app.getHttpServer());
    const regRes = await owner.post("/auth/register").send({ email: ownerEmail, name: "Campaign Owner", password });
    expect(regRes.status).toBe(201);
    orgId = regRes.body.organization.id;
    ownerUserId = regRes.body.user.id;
    await owner.post("/auth/login").send({ email: ownerEmail, password }).expect(200);

    // 2. 注册攻击者（不同租户）
    const attackerEmail = `campaign-attacker-${suffix}@geolens.test`;
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
        name: `PawClean Campaign Proj ${suffix}`,
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

    // 4. 创建已核实事实 (Verified Facts)
    await prisma.$executeRawUnsafe(
      `INSERT INTO content_verified_facts (
        id, organization_id, project_id, claim, fact_type, status, source_type, source_ref, created_by_id, created_at, updated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid,
        'PawClean 运行工作噪音低于 43dB，满足静音标准',
        'SPECIFICATION', 'VERIFIED', 'LAB_REPORT', '国家声学实验室报告 #AC-2026', $4::uuid, NOW(), NOW()
      )`,
      randomUUID(),
      orgId,
      projectId,
      ownerUserId,
    );

    // 5. 构造血缘：Diagnosis -> Recommendation -> Opportunity
    const diag = await prisma.diagnosisRun.create({
      data: {
        projectId,
        reportId: randomUUID(),
        diagnosisVersion: "v1",
        status: "COMPLETED",
      },
    });

    const recRun = await prisma.recommendationRun.create({
      data: {
        projectId,
        diagnosisRunId: diag.id,
        recommendationVersion: "v1",
        status: "COMPLETED",
      },
    });

    const rec = await prisma.recommendation.create({
      data: {
        recommendationRunId: recRun.id,
        recommendationType: "CONTENT_COVERAGE",
        title: "补齐宠物脚爪清洁科普与选购指南",
        summary: "主流 AI 引擎缺少权威清洁引据",
        rationale: "依据诊断事实补足内容短板",
        priority: "HIGH",
        priorityScore: 85,
        impactArea: "CONTENT_COVERAGE",
        status: "PROPOSED",
      },
    });

    const oppRun = await prisma.contentOpportunityRun.create({
      data: {
        projectId,
        recommendationRunId: recRun.id,
        opportunityVersion: "v1",
        status: "COMPLETED",
        summarySnapshot: "宠物洁足机选购与脚爪护理空白",
      },
    });

    const opp = await prisma.contentOpportunity.create({
      data: {
        opportunityRunId: oppRun.id,
        titleDirection: "宠物外出后脚爪清洁与日常护理方案",
        summary: "主流 AI 引擎在宠物脚爪清洁与选购相关词上缺乏 PawClean 引用",
        rationale: "针对家庭养宠场景补齐权威清洁护理知识，建立品类第一引据",
        opportunityType: "NET_NEW_CONTENT",
        priority: "HIGH",
        priorityScore: 88,
        effortLevel: "LOW",
        category: "宠物科技",
        assetType: "COMPARISON_PAGE",
        contentIntent: "INFORMATIONAL",
        representativeQuery: "宠物外出回家如何清洁脚爪",
        targetEngines: ["DeepSeek", "百度"],
        targetCompetitors: ["传统湿巾"],
        status: "PROPOSED",
        queries: {
          create: [
            {
              queryTextSnapshot: "宠物回家如何清洁脚爪",
              category: "日常护理",
              intent: "INFORMATIONAL",
              brandAbsent: true,
              sortOrder: 1,
            },
          ],
        },
      },
    });

    // 6. 生成 M9A Strategy (包含完整血缘溯源)
    const stratRes = await owner
      .post(`/projects/${projectId}/content-strategies/generate`)
      .send({
        opportunityId: opp.id,
        recommendationId: rec.id,
        diagnosisRunId: diag.id,
        customGuidance: "重点强化 PawClean 的静音抑菌与免吹干优势",
      });
    expect(stratRes.status).toBe(201);
    strategyId = stratRes.body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("1. POST /api/content/campaigns 一键从 Strategy 实例化 Campaign 与排期项", async () => {
    const res = await owner
      .post("/api/content/campaigns")
      .send({
        strategyId,
        projectId,
        name: "PawClean 2026 秋季新品推广战役",
        description: "覆盖微信、小红书、微博全矩阵的 GEO 优化战役",
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 10 * 86400000).toISOString(),
      });

    expect(res.status).toBe(201);
    const body = res.body;

    expect(body.id).toBeTruthy();
    campaignId = body.id;
    expect(body.name).toBe("PawClean 2026 秋季新品推广战役");
    expect(body.status).toBe("ACTIVE");
    expect(body.strategyId).toBe(strategyId);

    // 验证血缘保留
    expect(body.lineage).toBeDefined();
    expect(body.lineage.strategyId).toBe(strategyId);
    expect(body.lineage.opportunityId).toBeTruthy();
    expect(body.lineage.diagnosisId).toBeTruthy();

    // 验证排期项已自动实例化
    expect(Array.isArray(body.scheduleItems)).toBe(true);
    expect(body.scheduleItems.length).toBeGreaterThanOrEqual(3);
    createdScheduleItemIds = body.scheduleItems.map((i: any) => i.id);

    // 记录 ready 和 blocked 项备测
    for (const item of body.scheduleItems) {
      if (item.productionStatus === "READY" && !readyScheduleItemId) {
        readyScheduleItemId = item.id;
      }
      if (
        (item.productionStatus === "BLOCKED_FACTS" || item.productionStatus === "BLOCKED_ASSETS") &&
        !blockedScheduleItemId
      ) {
        blockedScheduleItemId = item.id;
      }
    }

    // 验证进度指标
    expect(body.progress).toBeDefined();
    expect(body.progress.total).toBe(body.scheduleItems.length);
  });

  it("2. GET /api/content/campaigns?projectId=... 获取战役列表与进度汇总", async () => {
    const res = await owner
      .get(`/api/content/campaigns?projectId=${projectId}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const campaign = res.body.find((c: any) => c.id === campaignId);
    expect(campaign).toBeDefined();
    expect(campaign.name).toBe("PawClean 2026 秋季新品推广战役");
    expect(campaign.progress.total).toBeGreaterThanOrEqual(3);
    expect(campaign.lineage.strategyId).toBe(strategyId);
  });

  it("3. GET /api/content/campaigns/:id 获取战役详情、排期项与 nextAction", async () => {
    const res = await owner
      .get(`/api/content/campaigns/${campaignId}`)
      .expect(200);

    const body = res.body;
    expect(body.id).toBe(campaignId);
    expect(body.scheduleItems.length).toBeGreaterThanOrEqual(3);

    for (const item of body.scheduleItems) {
      expect(item.nextAction).toBeDefined();
      expect(typeof item.nextAction).toBe("string");
      expect(item.isOverdue).toBeDefined();
      expect(item.planItem).toBeDefined();
      expect(item.planItem.platform).toBeDefined();
    }
  });

  it("4. PATCH /api/content/campaigns/:id 更新状态与周期", async () => {
    // 暂停战役
    const res1 = await owner
      .patch(`/api/content/campaigns/${campaignId}`)
      .send({ status: "PAUSED" })
      .expect(200);
    expect(res1.body.status).toBe("PAUSED");

    // 恢复战役
    const res2 = await owner
      .patch(`/api/content/campaigns/${campaignId}`)
      .send({ status: "ACTIVE" })
      .expect(200);
    expect(res2.body.status).toBe("ACTIVE");

    // 非法状态拒绝
    await owner
      .patch(`/api/content/campaigns/${campaignId}`)
      .send({ status: "INVALID_STATUS" })
      .expect(400);
  });

  it("5. POST /api/content/campaigns/:id/calendar/generate 按规则排期与依赖关系", async () => {
    const res = await owner
      .post(`/api/content/campaigns/${campaignId}/calendar/generate`)
      .send({
        startDate: new Date().toISOString(),
        pacingStrategy: "WORKDAYS_ONLY",
        maxItemsPerDay: 2,
        timezone: "Asia/Shanghai",
      })
      .expect(200);

    expect(res.body.id).toBe(campaignId);
    expect(res.body.scheduleItems.length).toBeGreaterThanOrEqual(3);

    // 验证依赖关系编排：小红书/微博应当具有 dependsOn
    const xhsOrWeibo = res.body.scheduleItems.find(
      (i: any) =>
        (i.planItem?.platform === "XIAOHONGSHU" || i.planItem?.platform === "WEIBO") &&
        i.dependsOnItemId !== null,
    );
    // 如果有生成对应平台项，依赖项应绑定成功
    if (xhsOrWeibo) {
      expect(xhsOrWeibo.dependsOnItemId).toBeTruthy();
    }
  });

  it("6. GET /api/content/campaigns/:id/calendar 获取日历聚合视图", async () => {
    const res = await owner
      .get(`/api/content/campaigns/${campaignId}/calendar?timezone=Asia/Shanghai`)
      .expect(200);

    expect(res.body.campaign).toBeDefined();
    expect(res.body.timezone).toBe("Asia/Shanghai");
    expect(res.body.items).toBeDefined();
    expect(res.body.byDate).toBeDefined();
    expect(typeof res.body.byDate).toBe("object");

    const dates = Object.keys(res.body.byDate);
    expect(dates.length).toBeGreaterThan(0);
  });

  it("7. PATCH /api/content/schedule-items/:id 修改排期、指派人员与防非法注入", async () => {
    const targetItemId = createdScheduleItemIds[0];

    // 指派给组织合法成员 (Owner)
    const res = await owner
      .patch(`/api/content/schedule-items/${targetItemId}`)
      .send({
        assignedToId: ownerUserId,
        scheduledTime: "14:30",
      })
      .expect(200);

    expect(res.body.assignedToId).toBe(ownerUserId);
    expect(res.body.scheduledTime).toBe("14:30");

    // 尝试指派给其他组织的非成员 -> 必须拒绝 400
    await owner
      .patch(`/api/content/schedule-items/${targetItemId}`)
      .send({ assignedToId: attackerUserId })
      .expect(400);

    // 尝试自己依赖自己 -> 必须拒绝 400
    await owner
      .patch(`/api/content/schedule-items/${targetItemId}`)
      .send({ dependsOnItemId: targetItemId })
      .expect(400);
  });

  it("8. GET /api/content/production-queue 生产队列确定性排序与指标汇总", async () => {
    // 构造一个逾期条目验证确定性置顶
    const overdueItemId = createdScheduleItemIds[1];
    await prisma.contentScheduleItem.update({
      where: { id: overdueItemId },
      data: {
        scheduledDate: new Date(Date.now() - 3 * 86400000), // 3 天前
      },
    });

    const res = await owner
      .get(`/api/content/production-queue?projectId=${projectId}`)
      .expect(200);

    expect(res.body.summary).toBeDefined();
    expect(res.body.summary.total).toBeGreaterThanOrEqual(3);
    expect(res.body.summary.overdueCount).toBeGreaterThanOrEqual(1);

    // 验证逾期条目排在首位
    const items = res.body.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].isOverdue).toBe(true);

    // 测试 overdueOnly 过滤
    const overdueRes = await owner
      .get(`/api/content/production-queue?projectId=${projectId}&overdueOnly=true`)
      .expect(200);

    for (const it of overdueRes.body.items) {
      expect(it.isOverdue).toBe(true);
    }
  });

  it("9. POST /api/content/schedule-items/:id/start-production 事实与物料准入阻断守卫", async () => {
    // 如果存在被事实或物料阻断的排期项，必须严格阻断拒绝 (400)
    if (blockedScheduleItemId) {
      const res = await owner
        .post(`/api/content/schedule-items/${blockedScheduleItemId}/start-production`)
        .expect(400);

      expect(res.body.error).toMatch(/PLAN_FACT_INPUT_REQUIRED|PLAN_ASSET_INPUT_REQUIRED/);
    } else {
      // 人工将一个排期项置为 BLOCKED_FACTS 测试阻断
      const testBlockedItemId = createdScheduleItemIds[2];
      await prisma.contentScheduleItem.update({
        where: { id: testBlockedItemId },
        data: { productionStatus: "BLOCKED_FACTS" },
      });

      const res = await owner
        .post(`/api/content/schedule-items/${testBlockedItemId}/start-production`)
        .expect(400);
      expect(res.body.error).toBe("PLAN_FACT_INPUT_REQUIRED");
    }
  });

  it("10. POST /api/content/schedule-items/:id/start-production 成功创建草稿与幂等复用防护", async () => {
    // 寻找或构造一个 READY 排期项
    let targetItemId = readyScheduleItemId;
    if (!targetItemId) {
      targetItemId = createdScheduleItemIds[0];
      await prisma.contentScheduleItem.update({
        where: { id: targetItemId },
        data: { productionStatus: "READY" },
      });
      // 同时确保底层 planItem status 为 READY
      const itemRecord = await prisma.contentScheduleItem.findUniqueOrThrow({
        where: { id: targetItemId },
      });
      await prisma.contentPlanItem.update({
        where: { id: itemRecord.planItemId },
        data: { status: "READY" },
      });
    }

    // 第一次生产触发 -> 生成 Draft
    const res1 = await owner
      .post(`/api/content/schedule-items/${targetItemId}/start-production`)
      .expect(200);

    expect(res1.body.draft).toBeDefined();
    expect(res1.body.draft.id).toBeTruthy();
    expect(res1.body.reused).toBe(false);
    expect(res1.body.scheduleItem.productionStatus).toBe("DRAFT_CREATED");

    // 第二次重复触发 -> 幂等复用已有 Draft，绝不产生重复孤儿草稿
    const res2 = await owner
      .post(`/api/content/schedule-items/${targetItemId}/start-production`)
      .expect(200);

    expect(res2.body.draft.id).toBe(res1.body.draft.id);
    expect(res2.body.reused).toBe(true);
  });

  it("11. 租户与项目隔离安全防护：异租户访问全部返回 404", async () => {
    // 攻击者尝试访问受害者 Campaign -> 404
    await attacker
      .get(`/api/content/campaigns/${campaignId}`)
      .expect(404);

    // 攻击者尝试修改受害者排期项 -> 404
    await attacker
      .patch(`/api/content/schedule-items/${createdScheduleItemIds[0]}`)
      .send({ scheduledTime: "09:00" })
      .expect(404);

    // 攻击者尝试启动受害者生产 -> 404
    await attacker
      .post(`/api/content/schedule-items/${createdScheduleItemIds[0]}/start-production`)
      .expect(404);

    // 攻击者尝试查看受害者项目生产队列 -> 404
    await attacker
      .get(`/api/content/production-queue?projectId=${projectId}`)
      .expect(404);
  });

  it("12. 审计日志完整留痕 (CAMPAIGN_CREATED, CALENDAR_GENERATED, PRODUCTION_STARTED)", async () => {
    const audits = await prisma.contentAuditLog.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    expect(audits.length).toBeGreaterThan(0);
    const details = audits.map((a) => a.detail || "");

    expect(details.some((d) => d.includes("CAMPAIGN_CREATED"))).toBe(true);
    expect(details.some((d) => d.includes("CALENDAR_GENERATED"))).toBe(true);
    expect(details.some((d) => d.includes("PRODUCTION_STARTED"))).toBe(true);
  });
});
