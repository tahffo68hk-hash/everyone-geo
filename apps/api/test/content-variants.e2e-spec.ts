/**
 * CN Platform Content Variants & Generation e2e test
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

describe("国内平台内容生成增强 (CN Content Variants) e2e", () => {
  let app: INestApplication;
  let owner: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const password = "variant-pass-123";
  let projectId: string;
  let draftId: string;
  let sourceRevisionId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    // 注册并登录用户
    const ownerEmail = `variant-owner-${suffix}@geolens.test`;
    owner = request.agent(app.getHttpServer());
    const regRes = await owner.post("/auth/register").send({ email: ownerEmail, name: "Owner", password });
    expect(regRes.status).toBe(201);
    const orgId = regRes.body.organization.id;

    await owner.post("/auth/login").send({ email: ownerEmail, password }).expect(200);

    // 创建项目
    const proj = await prisma.project.create({ data: { organizationId: orgId, name: `CN Content Project ${suffix}` } });
    projectId = proj.id;

    // 创建基础草稿
    const draftRes = await owner.post(`/projects/${projectId}/content-drafts`).send({
      title: "PawClean 智能宠物洁足机深度评测指南",
      body: "PawClean 采用微泡柔和循环水流与亲肤抑菌硅胶刷头，运行噪音低于 45dB，有效清除脚爪泥沙与致敏原。",
      summary: "PawClean 深度实测指南",
      topic: "宠物科技",
    });
    expect(draftRes.status).toBe(201);
    draftId = draftRes.body.id;
    sourceRevisionId = draftRes.body.latestRevision.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("1. 一键生成 5 大国内平台版本 (WeChat, Xiaohongshu, Weibo, Douyin, Bilibili)", async () => {
    const platforms = ["WECHAT_OFFICIAL_ACCOUNT", "XIAOHONGSHU", "WEIBO", "DOUYIN", "BILIBILI"] as const;

    for (const platform of platforms) {
      const res = await owner.post(`/content-drafts/${draftId}/variants`).send({
        platform,
        sourceRevisionId,
      });

      expect(res.status).toBe(201);
      expect(res.body.platform).toBe(platform);
      expect(res.body.draftId).toBe(draftId);
      expect(res.body.sourceRevisionId).toBe(sourceRevisionId);
      expect(res.body.title).toBeTruthy();
      expect(res.body.body).toBeTruthy();
      expect(Array.isArray(res.body.tags)).toBe(true);
      expect(Array.isArray(res.body.imageBriefs)).toBe(true);
      expect(res.body.imageBriefs.length).toBeGreaterThan(0);
      expect(res.body.platformMetadata).toBeDefined();
    }
  });

  it("2. 获取草稿的平台版本列表与详情", async () => {
    const listRes = await owner.get(`/content-drafts/${draftId}/variants`);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body.length).toBeGreaterThanOrEqual(5);

    const firstVariant = listRes.body[0];
    const detailRes = await owner.get(`/content-drafts/${draftId}/variants/${firstVariant.id}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.id).toBe(firstVariant.id);
    expect(detailRes.body.title).toBe(firstVariant.title);
  });

  it("3. 基于某版本继续改写 (Rewrite: Expand, Professional, etc.)", async () => {
    const listRes = await owner.get(`/content-drafts/${draftId}/variants`);
    const origVariant = listRes.body.find((v: any) => v.platform === "XIAOHONGSHU") || listRes.body[0];

    const rewriteRes = await owner.post(`/content-drafts/${draftId}/variants/${origVariant.id}/rewrite`).send({
      mode: "REWRITE_EXPAND",
      customInstructions: "多强调脚爪缝隙清洁细节",
    });

    expect(rewriteRes.status).toBe(201);
    expect(rewriteRes.body.title).toContain("深度完整版");
    expect(rewriteRes.body.platformMetadata.parentVariantId).toBe(origVariant.id);
    expect(rewriteRes.body.platformMetadata.rewriteMode).toBe("REWRITE_EXPAND");
    expect(rewriteRes.body.platformMetadata.changeNote).toContain("自定义要求：多强调脚爪缝隙清洁细节");
  });

  it("4. 应用平台版本为草稿新 Revision (保留版本历史)", async () => {
    const listRes = await owner.get(`/content-drafts/${draftId}/variants`);
    const xhsVariant = listRes.body.find((v: any) => v.platform === "XIAOHONGSHU");

    const applyRes = await owner.post(`/content-drafts/${draftId}/variants/${xhsVariant.id}/apply`).send({
      changeNote: "采纳小红书版本作为新版草稿",
    });

    expect(applyRes.status).toBe(200);
    expect(applyRes.body.draft.title).toBe(xhsVariant.title);
    expect(applyRes.body.draft.status).toBe("DRAFT"); // 安全回退为 DRAFT，待重新审核
    expect(applyRes.body.appliedVariantId).toBe(xhsVariant.id);

    // 回读草稿，确认版本数增加
    const draftRes = await owner.get(`/content-drafts/${draftId}`);
    expect(draftRes.body.revisionCount).toBe(2);
    expect(draftRes.body.latestRevision.changeNote).toBe("采纳小红书版本作为新版草稿");
  });

  it("5. 图片 Brief 生成与列表获取", async () => {
    const genRes = await owner.post(`/content-drafts/${draftId}/image-briefs`).send({
      platform: "WECHAT_OFFICIAL_ACCOUNT",
      preferredStyle: "TECH",
    });

    expect(genRes.status).toBe(201);
    expect(Array.isArray(genRes.body)).toBe(true);
    expect(genRes.body.length).toBeGreaterThan(0);

    const listRes = await owner.get(`/content-drafts/${draftId}/image-briefs`);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body.length).toBeGreaterThanOrEqual(genRes.body.length);
    expect(listRes.body[0].prompt).toBeTruthy();
    expect(listRes.body[0].ratio).toBeTruthy();
  });
});
