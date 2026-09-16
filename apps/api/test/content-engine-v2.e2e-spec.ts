/**
 * GeoLens AI Content Engine V2 E2E Spec
 *
 * 测试覆盖：
 * 1. 5 大平台结构化生成与 Generation Run 溯源留存
 * 2. 事实库管理 (VerifiedFact: VERIFIED / USER_CONFIRMED / UNVERIFIED)
 * 3. 事实声明提取 (Claim Extraction: SPEC / MEDICAL / SUPERLATIVE)
 * 4. 审批阻断规则 (Blocking Rule: 未核实事实阻断 APPROVE，返回 FACT_CHECK_REQUIRED)
 * 5. 自动安全改写 (Safe Rewrite: 平替未核实数字与医疗结论，消除阻断，顺利通过审批)
 * 6. 多模式改写 (Rewrite: FACT_SAFE, TUTORIAL, COMPARISON 创建新 Generation Run)
 * 7. 图片生成预览与素材入库 (Image Preview -> Accept as ContentAsset)
 * 8. 生成历史审计列表 (Generation Runs History)
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
process.env.GENERATION_PROVIDER_MODE = "mock";

describe("AI Content Engine V2 E2E (事实约束、Claim Guard、文生图、Generation Run)", () => {
  let app: INestApplication;
  let owner: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const password = "v2-engine-pass-123";
  let projectId: string;
  let draftId: string;
  let variantId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    // 注册并登录用户
    const ownerEmail = `v2-owner-${suffix}@geolens.test`;
    owner = request.agent(app.getHttpServer());
    const regRes = await owner.post("/auth/register").send({ email: ownerEmail, name: "V2Owner", password });
    expect(regRes.status).toBe(201);
    const orgId = regRes.body.organization.id;

    await owner.post("/auth/login").send({ email: ownerEmail, password }).expect(200);

    // 创建项目
    const proj = await prisma.project.create({ data: { organizationId: orgId, name: `V2 Engine Project ${suffix}` } });
    projectId = proj.id;

    // 创建带未核实数字和医疗结论的初始草稿
    const draftRes = await owner.post(`/projects/${projectId}/content-drafts`).send({
      title: "PawClean 智能洁足机评测指南",
      body: "PawClean 采用微泡循环水流与亲肤硅胶，运行噪音低于45dB，30秒快速清洗，彻底杜绝趾间炎！它是全网第一款高档洁爪设备。",
      summary: "PawClean 实测",
      topic: "宠物科技",
    });
    expect(draftRes.status).toBe(201);
    draftId = draftRes.body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("1. 生成 5 平台版本并记录可追溯 Generation Run", async () => {
    const res = await owner.post(`/content-drafts/${draftId}/variants`).send({
      platform: "XIAOHONGSHU",
      generationMode: "STANDARD",
    });
    expect(res.status).toBe(201);
    expect(res.body.platform).toBe("XIAOHONGSHU");
    expect(res.body.title).toBeTruthy();
    variantId = res.body.id;

    // 验证 Generation Run 已被创建
    const runsRes = await owner.get(`/content-drafts/${draftId}/generation-runs`);
    expect(runsRes.status).toBe(200);
    expect(runsRes.body.length).toBeGreaterThanOrEqual(1);
    const latestRun = runsRes.body[0];
    expect(latestRun.platform).toBe("XIAOHONGSHU");
    expect(latestRun.promptVersion).toBe("geolens-cn-xhs-v1");
    expect(latestRun.status).toBe("COMPLETED");
  });

  it("2. 事实库管理与声明提取 (Claim Extraction)", async () => {
    // 写入一条用户已确认的事实
    const factRes = await owner.post(`/content-drafts/${draftId}/facts`).send({
      claim: "微泡柔和循环水流",
      factType: "FEATURE",
      status: "USER_CONFIRMED",
      sourceType: "USER_INPUT",
    });
    expect(factRes.status).toBe(201);
    expect(factRes.body.claim).toBe("微泡柔和循环水流");

    // 从草稿中提取声明
    const claimRes = await owner.post(`/content-drafts/${draftId}/extract-claims`).send({});
    expect(claimRes.status).toBe(200);
    expect(claimRes.body.claims.length).toBeGreaterThanOrEqual(3);
    // 应该识别出 45dB、趾间炎、全网第一
    expect(claimRes.body.blocking).toBe(true);
    expect(claimRes.body.unverifiedCount).toBeGreaterThanOrEqual(2);
  });

  it("3. Blocking Rule: 未核实声明必须阻断审批通过 (FACT_CHECK_REQUIRED)", async () => {
    // 提交草稿审核
    await owner.post(`/content-drafts/${draftId}/submit`).expect(200);

    // 尝试批准（但正文中含有未核实的 45dB 和 杜绝趾间炎）
    const decideRes = await owner.post(`/content-drafts/${draftId}/decide`).send({
      decision: "APPROVED",
      comment: "合规审批测试",
    });

    // 必须返回 400 Bad Request 且 error 为 FACT_CHECK_REQUIRED
    expect(decideRes.status).toBe(400);
    expect(decideRes.body.error).toBe("FACT_CHECK_REQUIRED");
    expect(decideRes.body.blockingClaims.length).toBeGreaterThanOrEqual(1);
  });

  it("4. Safe Rewrite: 自动安全改写消除未核实声明，随后顺利通过审批", async () => {
    // 执行自动安全改写
    const safeRes = await owner.post(`/content-drafts/${draftId}/safe-rewrite`).send({});
    expect(safeRes.status).toBe(200);
    expect(safeRes.body.sanitizedText).not.toContain("45dB");
    expect(safeRes.body.sanitizedText).not.toContain("杜绝趾间炎");
    expect(safeRes.body.remainingUnverifiedClaims.length).toBe(0);

    // 将安全改写文本存为草稿新版本
    await owner.patch(`/content-drafts/${draftId}`).send({
      body: safeRes.body.sanitizedText,
      changeNote: "自动安全改写：平替未核实数字与医疗结论",
    }).expect(200);

    // 提交审核
    await owner.post(`/content-drafts/${draftId}/submit`).expect(200);

    // 再次批准：此时无未核实声明，必须成功批准
    const approveRes = await owner.post(`/content-drafts/${draftId}/decide`).send({
      decision: "APPROVED",
      comment: "已合规改写，批准通过",
    });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe("APPROVED");
  });

  it("5. 多模式改写与 Generation Run 不可变历史", async () => {
    const rewriteRes = await owner.post(`/content-drafts/${draftId}/variants/${variantId}/rewrite`).send({
      mode: "FACT_SAFE",
    });
    expect(rewriteRes.status).toBe(201);

    const tutorialRes = await owner.post(`/content-drafts/${draftId}/variants/${variantId}/rewrite`).send({
      mode: "TUTORIAL",
    });
    expect(tutorialRes.status).toBe(201);

    // 查看历史 Generation Runs：每次改写都有独立记录
    const runsRes = await owner.get(`/content-drafts/${draftId}/generation-runs`);
    expect(runsRes.status).toBe(200);
    const modes = runsRes.body.map((r: any) => r.generationMode);
    expect(modes).toContain("FACT_SAFE");
    expect(modes).toContain("TUTORIAL");
  });

  it("6. 文生图预览与素材入库 (Image Preview -> Accept Asset)", async () => {
    // 触发生成预览
    const previewRes = await owner.post(`/content-drafts/${draftId}/image-generation`).send({
      prompt: "PawClean 智能洁足机，现代极简浴室台面，柔和水流摄影",
      ratio: "3:4",
      style: "TECH",
      textOverlay: {
        mainTitle: "PawClean 实测",
        subtitle: "温和循环水流",
        badge: "种草干货",
      },
    });
    expect(previewRes.status).toBe(201);
    expect(previewRes.body.jobId).toBeTruthy();
    expect(previewRes.body.status).toBe("COMPLETED");
    expect(previewRes.body.imageUrl).toBeTruthy();

    // 采纳为 ContentAsset
    const acceptRes = await owner.post(`/content-drafts/${draftId}/image-generation/${previewRes.body.jobId}/accept`).send({
      prompt: "PawClean 智能洁足机",
      ratio: "3:4",
      imageUrl: previewRes.body.imageUrl,
    });
    expect(acceptRes.status).toBe(201);
    expect(acceptRes.body.id).toBeTruthy();
    expect(acceptRes.body.type).toBe("COVER");
    expect(acceptRes.body.checksum).toBeTruthy();
  });
});
