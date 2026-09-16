/**
 * M9A - Content Strategy & Planning E2E Tests
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

describe("M9A Content Strategy & Planning E2E", () => {
  let app: INestApplication;
  let owner: ReturnType<typeof request.agent>;
  let attacker: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const password = "strategy-pass-123";
  let orgId: string;
  let projectId: string;
  let opportunityId: string;
  let createdStrategyId: string;
  let firstPlanItemId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    // 1. 注册合法 Owner
    const ownerEmail = `strategy-owner-${suffix}@geolens.test`;
    owner = request.agent(app.getHttpServer());
    const regRes = await owner.post("/auth/register").send({ email: ownerEmail, name: "Strategy Owner", password });
    expect(regRes.status).toBe(201);
    orgId = regRes.body.organization.id;
    await owner.post("/auth/login").send({ email: ownerEmail, password }).expect(200);

    // 2. 注册攻击者（不同租户）
    const attackerEmail = `strategy-attacker-${suffix}@geolens.test`;
    attacker = request.agent(app.getHttpServer());
    const attReg = await attacker.post("/auth/register").send({ email: attackerEmail, name: "Attacker", password });
    expect(attReg.status).toBe(201);
    await attacker.post("/auth/login").send({ email: attackerEmail, password }).expect(200);

    // 3. 创建项目
    const proj = await prisma.project.create({
      data: {
        organizationId: orgId,
        name: `PawClean Project ${suffix}`,
        industry: "宠物科技",
      },
    });
    projectId = proj.id;

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
      regRes.body.user.id,
    );

    // 5. 构造来源 ContentOpportunity 数据结构
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

    const oppRun = await prisma.contentOpportunityRun.create({
      data: {
        projectId,
        recommendationRunId: recRun.id,
        opportunityVersion: "v1",
        status: "COMPLETED",
        summarySnapshot: "宠物洁足知识与选购空白",
      },
    });

    const opp = await prisma.contentOpportunity.create({
      data: {
        opportunityRunId: oppRun.id,
        titleDirection: "宠物外出后脚爪清洁与日常护理方案",
        summary: "主流 AI 引擎在宠物脚爪清洁与选购相关词上缺乏 PawClean 引用，竞品占优",
        rationale: "针对家庭养宠场景补齐权威清洁护理知识，建立品类第一引据",
        opportunityType: "NET_NEW_CONTENT",
        priority: "HIGH",
        priorityScore: 85,
        effortLevel: "LOW",
        category: "宠物科技",
        assetType: "COMPARISON_PAGE",
        contentIntent: "INFORMATIONAL",
        representativeQuery: "宠物外出回家如何清洁脚爪",
        targetEngines: ["DeepSeek", "百度", "Perplexity"],
        targetCompetitors: ["传统湿巾", "劣质电动洗脚杯"],
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
            {
              queryTextSnapshot: "宠物洁足机哪个牌子好",
              category: "选购对比",
              intent: "COMMERCIAL",
              brandAbsent: true,
              competitorPositive: true,
              sortOrder: 2,
            },
          ],
        },
      },
    });
    opportunityId = opp.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("1. 基于 Opportunity 一键生成内容战略与生产计划 (9 大战略支柱 + 5 平台计划项)", async () => {
    const res = await owner
      .post(`/projects/${projectId}/content-strategies/generate`)
      .send({
        opportunityId,
        customGuidance: "重点强化 PawClean 的静音抑菌与免吹干优势",
      });

    expect(res.status).toBe(201);
    const body = res.body;

    expect(body.id).toBeTruthy();
    createdStrategyId = body.id;
    expect(body.projectId).toBe(projectId);
    expect(body.organizationId).toBe(orgId);
    expect(body.sourceOpportunityId).toBe(opportunityId);
    expect(body.title).toContain("宠物外出后脚爪清洁与日常护理方案");

    // 验证 9 大战略支柱：
    // 1. geoGap (当前 GEO 缺口)
    expect(typeof body.geoGap).toBe("string");
    expect(body.geoGap.length).toBeGreaterThan(50);
    expect(body.geoGap).toContain("PawClean");

    // 2. priorityQuestions (最值得通过内容解决的问题)
    expect(Array.isArray(body.priorityQuestions)).toBe(true);
    expect(body.priorityQuestions.length).toBeGreaterThanOrEqual(2);
    expect(body.priorityQuestions[0]).toHaveProperty("question");
    expect(body.priorityQuestions[0]).toHaveProperty("intent");
    expect(body.priorityQuestions[0]).toHaveProperty("urgency");

    // 3. targetAudience (目标受众)
    expect(typeof body.targetAudience).toBe("string");
    expect(body.targetAudience.length).toBeGreaterThan(30);

    // 4. perceptionGoal (内容应建立的心智认知)
    expect(typeof body.perceptionGoal).toBe("string");
    expect(body.perceptionGoal.length).toBeGreaterThan(20);

    // 5. keyThemes (核心覆盖主题)
    expect(Array.isArray(body.keyThemes)).toBe(true);
    expect(body.keyThemes.length).toBeGreaterThanOrEqual(3);
    expect(body.keyThemes[0]).toHaveProperty("theme");
    expect(body.keyThemes[0]).toHaveProperty("focus");
    expect(body.keyThemes[0]).toHaveProperty("outlinePoints");

    // 6. platformPriorities (平台优先级与角色分工)
    expect(Array.isArray(body.platformPriorities)).toBe(true);
    expect(body.platformPriorities.length).toBe(5);
    const platforms = body.platformPriorities.map((p: any) => p.platform);
    expect(platforms).toContain("WECHAT_OFFICIAL_ACCOUNT");
    expect(platforms).toContain("XIAOHONGSHU");
    expect(platforms).toContain("BILIBILI");
    expect(platforms).toContain("DOUYIN");
    expect(platforms).toContain("WEIBO");

    // 7. contentFormats (推荐内容形式)
    expect(Array.isArray(body.contentFormats)).toBe(true);
    expect(body.contentFormats.length).toBe(5);
    expect(body.contentFormats[0]).toHaveProperty("format");
    expect(body.contentFormats[0]).toHaveProperty("tone");

    // 8. evidenceRequired (所需事实与依据)
    expect(Array.isArray(body.evidenceRequired)).toBe(true);
    expect(body.evidenceRequired.length).toBeGreaterThan(0);
    // 包含录入的 VerifiedFact
    const hasFact = body.evidenceRequired.some((e: any) => e.claim.includes("43dB"));
    expect(hasFact).toBe(true);

    // 9. validationMetrics (成功验证指标)
    expect(Array.isArray(body.validationMetrics)).toBe(true);
    expect(body.validationMetrics.length).toBeGreaterThanOrEqual(3);
    expect(body.validationMetrics[0]).toHaveProperty("metric");
    expect(body.validationMetrics[0]).toHaveProperty("target");

    // 验证多平台内容计划 (ContentPlanItems)
    expect(Array.isArray(body.planItems)).toBe(true);
    expect(body.planItems.length).toBe(5);
    firstPlanItemId = body.planItems[0].id;

    for (const item of body.planItems) {
      expect(item.id).toBeTruthy();
      expect(item.strategyId).toBe(createdStrategyId);
      expect(item.title).toBeTruthy();
      expect(item.platform).toBeTruthy();
      expect(item.format).toBeTruthy();
      expect(item.objective).toBeTruthy();
      expect(item.geoTarget).toBeTruthy();
      expect(Array.isArray(item.targetQueries)).toBe(true);
      expect(Array.isArray(item.keyClaims)).toBe(true);
      expect(item.status).toBe("PLANNED");
      expect(item.draftId).toBeNull();
    }
  });

  it("2. 获取项目内容战略列表与单个战略详情", async () => {
    // 列表
    const listRes = await owner.get(`/projects/${projectId}/content-strategies`).expect(200);
    expect(listRes.body.total).toBeGreaterThanOrEqual(1);
    expect(listRes.body.strategies[0].id).toBe(createdStrategyId);
    expect(listRes.body.strategies[0].planItemCount).toBe(5);

    // 详情
    const getRes = await owner.get(`/content-strategies/${createdStrategyId}`).expect(200);
    expect(getRes.body.id).toBe(createdStrategyId);
    expect(getRes.body.planItems.length).toBe(5);
  });

  it("3. 修改计划项内容与状态", async () => {
    const patchRes = await owner
      .patch(`/content-strategies/${createdStrategyId}/plan-items/${firstPlanItemId}`)
      .send({
        title: "修改后的深度实操教程标题",
        objective: "补齐进阶护理场景知识覆盖",
        status: "IN_PRODUCTION",
      })
      .expect(200);

    expect(patchRes.body.id).toBe(firstPlanItemId);
    expect(patchRes.body.title).toBe("修改后的深度实操教程标题");
    expect(patchRes.body.objective).toBe("补齐进阶护理场景知识覆盖");
    expect(patchRes.body.status).toBe("IN_PRODUCTION");
  });

  it("4. 闭环打通：一键自计划项派生 ContentDraft 并完成完整溯源关联", async () => {
    const draftRes = await owner
      .post(`/content-strategies/${createdStrategyId}/plan-items/${firstPlanItemId}/create-draft`)
      .send({})
      .expect(201);

    const { draft, planItem, reused } = draftRes.body;
    expect(reused).toBe(false);
    expect(draft.id).toBeTruthy();
    expect(draft.title).toBe("修改后的深度实操教程标题");
    expect(draft.sourceStrategyId).toBe(createdStrategyId);
    expect(draft.sourcePlanItemId).toBe(firstPlanItemId);
    expect(draft.sourceOpportunityId).toBe(opportunityId);

    // 检查初始版本
    expect(draft.revisionCount).toBe(1);
    expect(draft.latestRevision).toBeDefined();
    expect(draft.latestRevision.body).toContain("核心核实事实与依据");
    expect(draft.latestRevision.body).toContain("43dB");

    // 检查计划项状态更新
    expect(planItem.status).toBe("DRAFTED");
    expect(planItem.draftId).toBe(draft.id);

    // 验证通过现有草稿接口可完整读取溯源信息
    const getDraftRes = await owner.get(`/content-drafts/${draft.id}`).expect(200);
    expect(getDraftRes.body.id).toBe(draft.id);
    expect(getDraftRes.body.sourceStrategyId).toBe(createdStrategyId);
    expect(getDraftRes.body.sourcePlanItemId).toBe(firstPlanItemId);

    // 幂等重复调用：返回已有草稿与绑定关系
    const repeatRes = await owner
      .post(`/content-strategies/${createdStrategyId}/plan-items/${firstPlanItemId}/create-draft`)
      .send({})
      .expect(201);
    expect(repeatRes.body.reused).toBe(true);
    expect(repeatRes.body.draft.id).toBe(draft.id);
  });

  it("5. 多租户安全隔离校验 (404 Not Found)", async () => {
    // 跨租户获取战略
    await attacker.get(`/content-strategies/${createdStrategyId}`).expect(404);

    // 跨租户为该项目生成战略
    await attacker
      .post(`/projects/${projectId}/content-strategies/generate`)
      .send({ opportunityId })
      .expect(404);

    // 跨租户操作计划项
    await attacker
      .patch(`/content-strategies/${createdStrategyId}/plan-items/${firstPlanItemId}`)
      .send({ title: "恶意篡改" })
      .expect(404);

    // 跨租户生成草稿
    await attacker
      .post(`/content-strategies/${createdStrategyId}/plan-items/${firstPlanItemId}/create-draft`)
      .send({})
      .expect(404);
  });
});
