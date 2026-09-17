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
      expect(["PLANNED", "READY", "FACT_INPUT_REQUIRED", "ASSET_INPUT_REQUIRED"]).toContain(item.status);
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

  it("6. [AG-M9A-01 & AG-M9A-02] CloudDB Pro + 空事实库 + 空基线: 严禁编造宠物/硅胶/45dB参数，指标必须定性且无任意百分比", async () => {
    // 创建一个完全独立的 B2B SaaS 数据库项目，事实库保持完全为空
    const cloudDbProj = await prisma.project.create({
      data: {
        organizationId: orgId,
        name: `CloudDB Pro ${suffix}`,
        industry: "企业级分布式数据库",
      },
    });

    const cloudDiag = await prisma.diagnosisRun.create({
      data: {
        projectId: cloudDbProj.id,
        reportId: randomUUID(),
        diagnosisVersion: "v1",
        status: "COMPLETED",
      },
    });

    const cloudRec = await prisma.recommendationRun.create({
      data: {
        projectId: cloudDbProj.id,
        diagnosisRunId: cloudDiag.id,
        recommendationVersion: "v1",
        status: "COMPLETED",
      },
    });

    const cloudOppRun = await prisma.contentOpportunityRun.create({
      data: {
        projectId: cloudDbProj.id,
        recommendationRunId: cloudRec.id,
        opportunityVersion: "v1",
        status: "COMPLETED",
        summarySnapshot: "分布式数据库事务与高可用知识空白",
      },
    });

    const cloudOpp = await prisma.contentOpportunity.create({
      data: {
        opportunityRunId: cloudOppRun.id,
        titleDirection: "CloudDB Pro 分布式事务与多机房容灾架构深度解析",
        summary: "主流 AI 在分布式事务性能与多机房高可用选型时缺乏 CloudDB Pro 官方权威引证",
        rationale: "补齐技术白皮书与架构规范",
        opportunityType: "NET_NEW_CONTENT",
        priority: "HIGH",
        priorityScore: 85,
        effortLevel: "LOW",
        category: "企业级IT",
        assetType: "DOCUMENTATION",
        contentIntent: "INFORMATIONAL",
        representativeQuery: "CloudDB Pro 分布式事务如何保证一致性",
        targetEngines: ["DeepSeek", "百度", "Perplexity"],
        status: "PROPOSED",
        queries: {
          create: [
            {
              queryTextSnapshot: "CloudDB Pro 分布式事务性能与跨机房延迟",
              intent: "INFORMATIONAL",
              brandAbsent: true,
              sortOrder: 1,
            },
          ],
        },
      },
    });

    const res = await owner
      .post(`/projects/${cloudDbProj.id}/content-strategies/generate`)
      .send({
        opportunityId: cloudOpp.id,
      })
      .expect(201);

    const body = res.body;
    const fullJson = JSON.stringify(body);

    // 严禁出现任何特定消费品/硬件/伪造检测报告词汇
    expect(fullJson).not.toMatch(/45dB|45分贝|99\.2%|抑菌|硅胶|宠物|洁爪|狗|猫|声学检测|微生物/);

    // 事实库为空：evidenceRequired 标记为 UNVERIFIED_OR_EMPTY
    expect(body.evidenceRequired[0].status).toBe("UNVERIFIED_OR_EMPTY");
    expect(body.evidenceRequired[0].claim).toContain("暂无可用的结构化核验事实");

    // 空基线：validationMetrics 全部为定性指标，禁止自动编造任何百分比
    for (const metric of body.validationMetrics) {
      expect(metric.source).toBe("QUALITATIVE_TARGET");
      expect(metric.target).not.toContain("%");
    }
  });

  it("7. [AG-M9A-03] DOCUMENTATION 类型机会触发平台准入门禁，排除小红书/抖音并记录准入理由", async () => {
    // 查询上一测中针对 CloudDB Pro 生成的战略
    const listRes = await owner.get(`/projects/${(await prisma.project.findFirst({ where: { name: `CloudDB Pro ${suffix}` } }))!.id}/content-strategies`).expect(200);
    const cloudStrat = listRes.body.strategies[0];
    const fullStrat = await owner.get(`/content-strategies/${cloudStrat.id}`).expect(200);

    const platforms = fullStrat.body.planItems.map((p: any) => p.platform);
    expect(platforms).toContain("WECHAT_OFFICIAL_ACCOUNT");
    // 技术文档必须排除小红书与抖音
    expect(platforms).not.toContain("XIAOHONGSHU");
    expect(platforms).not.toContain("DOUYIN");
    expect(platforms.length).toBeLessThanOrEqual(2);

    // 验证平台入选理由 (platformEligibilityReason)
    expect(fullStrat.body.planItems[0].metadata.platformEligibilityReason).toContain("该 Query 为深度技术解释");
  });

  it("8. [AG-M9A-04] 多 Opportunity 语义聚类：3 条高重合机会聚为同一 Content Pillar 并保留血缘", async () => {
    const oppRun = await prisma.contentOpportunityRun.findFirstOrThrow({
      where: { projectId },
    });

    const oppA = await prisma.contentOpportunity.create({
      data: {
        opportunityRunId: oppRun.id,
        titleDirection: "狗狗回家怎么洗脚",
        summary: "狗狗回家脚爪清洁方法",
        rationale: "针对家庭养宠场景补齐权威清洁护理知识",
        opportunityType: "NET_NEW_CONTENT",
        priority: "HIGH",
        priorityScore: 80,
        effortLevel: "LOW",
        assetType: "COMPARISON_PAGE",
        contentIntent: "INFORMATIONAL",
        status: "PROPOSED",
        queries: { create: [{ queryTextSnapshot: "狗狗回家洗脚技巧", sortOrder: 1 }] },
      },
    });

    const oppB = await prisma.contentOpportunity.create({
      data: {
        opportunityRunId: oppRun.id,
        titleDirection: "遛狗后怎么清洁爪子",
        summary: "遛狗后足部清洁指引",
        rationale: "针对家庭养宠场景补齐权威清洁护理知识",
        opportunityType: "NET_NEW_CONTENT",
        priority: "HIGH",
        priorityScore: 78,
        effortLevel: "LOW",
        assetType: "COMPARISON_PAGE",
        contentIntent: "INFORMATIONAL",
        status: "PROPOSED",
        queries: { create: [{ queryTextSnapshot: "遛狗清洁爪子步骤", sortOrder: 1 }] },
      },
    });

    const oppC = await prisma.contentOpportunity.create({
      data: {
        opportunityRunId: oppRun.id,
        titleDirection: "宠物外出后足部怎么清理",
        summary: "宠物外出足部清理避坑",
        rationale: "针对家庭养宠场景补齐权威清洁护理知识",
        opportunityType: "NET_NEW_CONTENT",
        priority: "HIGH",
        priorityScore: 75,
        effortLevel: "LOW",
        assetType: "COMPARISON_PAGE",
        contentIntent: "INFORMATIONAL",
        status: "PROPOSED",
        queries: { create: [{ queryTextSnapshot: "宠物外出足部清理", sortOrder: 1 }] },
      },
    });

    const res = await owner
      .post(`/projects/${projectId}/content-strategies/generate`)
      .send({
        opportunityIds: [oppA.id, oppB.id, oppC.id],
      })
      .expect(201);

    const body = res.body;
    expect(body.metadata.sourceOpportunityIds).toHaveLength(3);
    expect(body.metadata.sourceOpportunityIds).toContain(oppA.id);
    expect(body.metadata.sourceOpportunityIds).toContain(oppB.id);
    expect(body.metadata.sourceOpportunityIds).toContain(oppC.id);

    // 验证 planItem 保存了聚类血缘与机会计数
    expect(body.planItems[0].metadata.sourceOpportunityIds).toHaveLength(3);
    expect(body.planItems[0].metadata.opportunityCount).toBe(3);
  });

  it("9. [AG-M9A-05] 缺失必需事实依据时计划项标记为 FACT_INPUT_REQUIRED，服务端拦截派生草稿", async () => {
    // 获取 CloudDB Pro（无核验事实）下的计划项
    const cloudDb = await prisma.project.findFirstOrThrow({ where: { name: `CloudDB Pro ${suffix}` } });
    const listRes = await owner.get(`/projects/${cloudDb.id}/content-strategies`).expect(200);
    const strat = listRes.body.strategies[0];
    const stratDetail = await owner.get(`/content-strategies/${strat.id}`).expect(200);

    const factBlockedItem = stratDetail.body.planItems.find((p: any) => p.status === "FACT_INPUT_REQUIRED");
    expect(factBlockedItem).toBeDefined();
    expect(factBlockedItem.metadata.missingFacts.length).toBeGreaterThan(0);

    // 服务端必须直接拦截 (400 Bad Request)
    const errRes = await owner
      .post(`/content-strategies/${strat.id}/plan-items/${factBlockedItem.id}/create-draft`)
      .send({})
      .expect(400);

    expect(errRes.body.error).toBe("PLAN_FACT_INPUT_REQUIRED");
  });

  it("10. [AG-M9A-06] 缺少视频物料时标记为 ASSET_INPUT_REQUIRED，服务端拦截视频计划生成草稿", async () => {
    // 针对 PawClean 获取一个视频计划项（Bilibili 或 抖音）
    const listRes = await owner.get(`/projects/${projectId}/content-strategies`).expect(200);
    const strat = listRes.body.strategies[0];
    const stratDetail = await owner.get(`/content-strategies/${strat.id}`).expect(200);

    const videoItem = stratDetail.body.planItems.find((p: any) => p.platform === "BILIBILI" || p.platform === "DOUYIN");
    expect(videoItem).toBeDefined();

    // 确保将其标记为 ASSET_INPUT_REQUIRED
    await owner
      .patch(`/content-strategies/${strat.id}/plan-items/${videoItem.id}`)
      .send({ status: "ASSET_INPUT_REQUIRED" })
      .expect(200);

    // 服务端必须直接拦截 (400 Bad Request)
    const errRes = await owner
      .post(`/content-strategies/${strat.id}/plan-items/${videoItem.id}/create-draft`)
      .send({})
      .expect(400);

    expect(errRes.body.error).toBe("PLAN_ASSET_INPUT_REQUIRED");
  });

  it("11. 就绪计划项 (READY) 允许正常派生草稿并生成结构化大纲", async () => {
    const listRes = await owner.get(`/projects/${projectId}/content-strategies`).expect(200);
    const strat = listRes.body.strategies[0];
    const stratDetail = await owner.get(`/content-strategies/${strat.id}`).expect(200);

    const wechatItem = stratDetail.body.planItems.find((p: any) => p.platform === "WECHAT_OFFICIAL_ACCOUNT");
    expect(wechatItem).toBeDefined();

    // 将其标记为 READY
    await owner
      .patch(`/content-strategies/${strat.id}/plan-items/${wechatItem.id}`)
      .send({ status: "READY" })
      .expect(200);

    // 成功派生
    const draftRes = await owner
      .post(`/content-strategies/${strat.id}/plan-items/${wechatItem.id}/create-draft`)
      .send({})
      .expect(201);

    expect(draftRes.body.reused).toBe(false);
    expect(draftRes.body.draft.id).toBeTruthy();
    expect(draftRes.body.planItem.status).toBe("DRAFTED");
  });

  it("12. 重复调用相同计划项派生默认幂等复用，显式要求时方在同草稿上新增 Revision", async () => {
    const listRes = await owner.get(`/projects/${projectId}/content-strategies`).expect(200);
    const strat = listRes.body.strategies[0];
    const stratDetail = await owner.get(`/content-strategies/${strat.id}`).expect(200);
    const draftedItem = stratDetail.body.planItems.find((p: any) => p.status === "DRAFTED");
    expect(draftedItem).toBeDefined();
    const originalDraftId = draftedItem.draftId;

    // 默认重复调用：幂等复用，不产生垃圾重复草稿
    const reuseRes = await owner
      .post(`/content-strategies/${strat.id}/plan-items/${draftedItem.id}/create-draft`)
      .send({})
      .expect(201);

    expect(reuseRes.body.reused).toBe(true);
    expect(reuseRes.body.draft.id).toBe(originalDraftId);

    // 显式传入 createNewRevision = true：在原草稿上创建 Revision 2
    const rev2Res = await owner
      .post(`/content-strategies/${strat.id}/plan-items/${draftedItem.id}/create-draft`)
      .send({ createNewRevision: true })
      .expect(201);

    expect(rev2Res.body.reused).toBe(false);
    expect(rev2Res.body.draft.id).toBe(originalDraftId);
    expect(rev2Res.body.draft.revisionCount).toBe(2);
  });
});

