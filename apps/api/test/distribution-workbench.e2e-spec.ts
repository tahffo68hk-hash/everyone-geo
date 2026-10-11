/**
 * Multi-Platform Content Distribution Center e2e test
 * 自动发布 + 人工辅助发布双模式及 PublishedAsset 闭环
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

describe("多平台内容分发中心 (Distribution Center) e2e", () => {
  let app: INestApplication;
  let client: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const password = "dist-pass-1234";
  let projectId: string;
  let draftId: string;
  let revisionId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const email = `dist-user-${suffix}@geolens.test`;
    client = request.agent(app.getHttpServer());
    const regRes = await client.post("/auth/register").send({ email, name: "Dist User", password });
    expect(regRes.status).toBe(201);
    const orgId = regRes.body.organization.id;

    await client.post("/auth/login").send({ email, password }).expect(200);

    const proj = await prisma.project.create({
      data: { organizationId: orgId, name: `Distribution Center Project ${suffix}` },
    });
    projectId = proj.id;

    // 创建内容草稿
    const draftRes = await client.post(`/projects/${projectId}/content-drafts`).send({
      title: "GeoLens 2.0 智能内容营销平台发布",
      body: "GeoLens 2.0 全新升级多平台内容分发中心，无缝兼容官方授权自动同步与多端人工辅助分发，打通 GEO 优化效果闭环。",
      summary: "GeoLens 2.0 分发中心上线",
      topic: "产品发布",
    });
    expect(draftRes.status).toBe(201);
    draftId = draftRes.body.id;
    revisionId = draftRes.body.latestRevision.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("1. 获取渠道矩阵：返回 8 大重点渠道及其自动/人工能力描述", async () => {
    const res = await client.get(`/projects/${projectId}/distribution/channels`).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(8);

    const channels = res.body.map((c: any) => c.channel);
    expect(channels).toContain("WECHAT_OFFICIAL_ACCOUNT");
    expect(channels).toContain("WORDPRESS");
    expect(channels).toContain("XIAOHONGSHU");
    expect(channels).toContain("ZHIHU");
    expect(channels).toContain("DOUYIN");

    const wechat = res.body.find((c: any) => c.channel === "WECHAT_OFFICIAL_ACCOUNT");
    expect(wechat.supportsAuto).toBe(true);
    expect(wechat.autoCapability).toBe("DRAFT_ONLY");

    const xhs = res.body.find((c: any) => c.channel === "XIAOHONGSHU");
    expect(xhs.supportsManual).toBe(true);
    expect(xhs.autoCapability).toBe("MANUAL_ONLY");
  });

  it("2. 多渠道适配预览：根据所选渠道生成针对性标题、正文与人工发布包清单", async () => {
    const res = await client
      .post(`/projects/${projectId}/content-drafts/${draftId}/distribution/adapt`)
      .send({
        revisionId,
        channels: ["XIAOHONGSHU", "ZHIHU", "WORDPRESS"],
      })
      .expect(200);

    expect(res.body.draftId).toBe(draftId);
    expect(res.body.channels).toHaveLength(3);

    const xhs = res.body.channels.find((c: any) => c.channel === "XIAOHONGSHU");
    expect(xhs).toBeDefined();
    expect(xhs.title.length).toBeLessThanOrEqual(20);
    expect(xhs.manualPackage).toBeDefined();
    expect(xhs.manualPackage.checklist.length).toBeGreaterThan(0);

    const zhihu = res.body.channels.find((c: any) => c.channel === "ZHIHU");
    expect(zhihu).toBeDefined();
    expect(zhihu.channelSpecificPayload.content_markdown).toBeDefined();
  });

  it("3. 一键批量分发任务创建：自动发布与人工辅助双模式独立运行", async () => {
    const res = await client
      .post(`/projects/${projectId}/content-drafts/${draftId}/distribution/batch`)
      .send({
        revisionId,
        items: [
          {
            channel: "WORDPRESS",
            mode: "AUTO",
            title: "GeoLens 2.0 发布公告 (WordPress)",
            targetStatus: "draft",
          },
          {
            channel: "XIAOHONGSHU",
            mode: "MANUAL",
            title: "好用的多平台分发神器",
            tags: ["AI工具", "效率提升"],
          },
        ],
      })
      .expect(201);

    expect(res.body.items).toHaveLength(2);

    const wpItem = res.body.items.find((i: any) => i.channel === "WORDPRESS");
    expect(wpItem).toBeDefined();
    expect(wpItem.mode).toBe("AUTO");
    // WordPress 自动发布执行后应记录为成功（草稿或发布）
    expect(["PUBLISHED", "DRAFT_CREATED_EXTERNALLY"]).toContain(wpItem.status);

    const xhsItem = res.body.items.find((i: any) => i.channel === "XIAOHONGSHU");
    expect(xhsItem).toBeDefined();
    expect(xhsItem.mode).toBe("MANUAL");
    expect(xhsItem.status).toBe("PENDING");
    expect(xhsItem.manualPackage).toBeDefined();
    expect(xhsItem.manualPackage.checklist).toBeDefined();
  });

  it("4. 人工发布回填确认：必须具备真实证据，成功生成 PublishedAsset 并打通血缘", async () => {
    // 先创建一个人工发布记录
    const batchRes = await client
      .post(`/projects/${projectId}/content-drafts/${draftId}/distribution/batch`)
      .send({
        revisionId,
        items: [
          {
            channel: "ZHIHU",
            mode: "MANUAL",
            title: "深度探讨：AI 内容分发如何与 GEO 闭环结合",
          },
        ],
      })
      .expect(201);

    const zhihuPubId = batchRes.body.items[0].id;
    expect(zhihuPubId).toBeDefined();

    // 缺少公开证据时拒绝确认
    await client
      .post(`/publications/${zhihuPubId}/confirm-manual-published`)
      .send({})
      .expect(400);

    // 携带真实公开链接与平台 ID 确认发布
    const confirmRes = await client
      .post(`/publications/${zhihuPubId}/confirm-manual-published`)
      .send({
        canonicalUrl: "https://zhuanlan.zhihu.com/p/8899112233",
        externalAssetId: "zhihu_p_8899112233",
        actualPublishedAt: "2026-10-11T12:00:00.000Z",
        verificationNote: "知乎专栏已通过审核上线并公开可查",
      })
      .expect(200);

    expect(confirmRes.body.publication.status).toBe("PUBLISHED");
    expect(confirmRes.body.publishedAsset).toBeDefined();

    const asset = confirmRes.body.publishedAsset;
    expect(asset.canonicalUrl).toBe("https://zhuanlan.zhihu.com/p/8899112233");
    expect(asset.externalAssetId).toBe("zhihu_p_8899112233");
    expect(asset.verificationStatus).toBe("MANUAL_VERIFIED");
    expect(asset.platform).toBe("ZHIHU");
    expect(asset.draftId).toBe(draftId);
    expect(asset.revisionId).toBe(revisionId);

    // 验证可通过项目资产列表检索到该落地资产
    const listRes = await client.get(`/projects/${projectId}/published-assets`).expect(200);
    expect(listRes.body.items.some((i: any) => i.id === asset.id)).toBe(true);
  });
});
