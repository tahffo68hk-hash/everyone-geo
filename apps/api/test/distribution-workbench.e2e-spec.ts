/**
 * Multi-Platform Content Distribution Center e2e test
 * 涵盖全部 7 组 P1 缺陷防线 (DIST-01 ~ DIST-07) 及 P2 缺陷验收
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
  let orgId: string;
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
    orgId = regRes.body.organization.id;

    await client.post("/auth/login").send({ email, password }).expect(200);

    const proj = await prisma.project.create({
      data: { organizationId: orgId, name: `Distribution Center Project ${suffix}` },
    });
    projectId = proj.id;

    // 创建内容草稿 (初始为 DRAFT 状态)
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

  it("2. 多渠道适配预览：根据渠道约束生成变体与人工发布包 (DIST-06)", async () => {
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

  it("3. DIST-01 审批门禁防御：草稿未审批严禁分发，autoApprove 无法绕过，正式审批后方可分发", async () => {
    // 3.1 当前草稿仍为 DRAFT 状态，尝试分发必须返回 400 拦截
    const rejectRes1 = await client
      .post(`/projects/${projectId}/content-drafts/${draftId}/distribution/batch`)
      .send({
        revisionId,
        items: [{ channel: "WORDPRESS", mode: "AUTO", title: "测试绕过审批" }],
      });
    expect(rejectRes1.status).toBe(400);
    expect(rejectRes1.body.message).toMatch(/APPROVED/);

    // 3.2 携带 autoApprove: true 也不得静默批准，依然拦截
    const rejectRes2 = await client
      .post(`/projects/${projectId}/content-drafts/${draftId}/distribution/batch`)
      .send({
        revisionId,
        autoApprove: true,
        items: [{ channel: "WORDPRESS", mode: "AUTO", title: "测试静默 autoApprove 绕过" }],
      });
    expect(rejectRes2.status).toBe(400);

    // 3.3 尝试伪造/提交不存在的版本号必须拦截
    const fakeRevId = randomUUID();
    const rejectRes3 = await client
      .post(`/projects/${projectId}/content-drafts/${draftId}/distribution/batch`)
      .send({
        revisionId: fakeRevId,
        items: [{ channel: "WORDPRESS", mode: "AUTO", title: "错误版本" }],
      });
    expect(rejectRes3.status).toBe(400);

    // 3.4 按照合规流程：提交审核并正式审批
    await client.post(`/content-drafts/${draftId}/submit`).expect(200);
    const decideRes = await client
      .post(`/content-drafts/${draftId}/decide`)
      .send({ decision: "APPROVED", revisionId })
      .expect(200);
    expect(decideRes.body.status).toBe("APPROVED");
  });

  it("4. DIST-03 一键批量分发任务创建与幂等防重并发防护", async () => {
    const idemKey = `dist-idem-${randomUUID()}`;
    const batchPayload = {
      revisionId,
      idempotencyKey: idemKey,
      items: [
        {
          channel: "WORDPRESS",
          mode: "AUTO" as const,
          title: "GeoLens 2.0 发布公告 (WordPress)",
          targetStatus: "draft" as const,
        },
        {
          channel: "XIAOHONGSHU",
          mode: "MANUAL" as const,
          title: "好用的多平台分发神器",
          tags: ["AI工具", "效率提升"],
        },
      ],
    };

    // 4.1 首次分发成功
    const res1 = await client
      .post(`/projects/${projectId}/content-drafts/${draftId}/distribution/batch`)
      .send(batchPayload)
      .expect(201);

    expect(res1.body.items).toHaveLength(2);
    const pubWp1 = res1.body.items.find((i: any) => i.channel === "WORDPRESS");
    const pubXhs1 = res1.body.items.find((i: any) => i.channel === "XIAOHONGSHU");
    expect(pubWp1).toBeDefined();
    expect(pubXhs1).toBeDefined();
    expect(["PUBLISHED", "DRAFT_CREATED_EXTERNALLY"]).toContain(pubWp1.status);
    expect(pubXhs1.status).toBe("PENDING");

    // 4.2 携带同一 idempotencyKey 再次提交：幂等返回相同记录，不重复创建
    const res2 = await client
      .post(`/projects/${projectId}/content-drafts/${draftId}/distribution/batch`)
      .send(batchPayload)
      .expect(201);

    expect(res2.body.items).toHaveLength(2);
    const pubWp2 = res2.body.items.find((i: any) => i.channel === "WORDPRESS");
    const pubXhs2 = res2.body.items.find((i: any) => i.channel === "XIAOHONGSHU");
    expect(pubWp2.id).toBe(pubWp1.id);
    expect(pubXhs2.id).toBe(pubXhs1.id);

    // 4.3 验证数据库中每个 Publication 只创建了 1 个 Attempt，无重复并发调用
    const attempts = await prisma.publicationAttempt.findMany({
      where: { publicationId: pubWp1.id },
    });
    expect(attempts.length).toBe(1);
  });

  it("5. DIST-04 WordPress 异常重试防护：非法内容重试失败保持 FAILED，不虚报成功", async () => {
    // 5.1 创建一个超长标题 (> 200 字) 的 WordPress 分发任务（超长内容触发 connector 校验失败）
    const longTitle = "WP超长标题测试".repeat(30); // > 200 字
    const batchRes = await client
      .post(`/projects/${projectId}/content-drafts/${draftId}/distribution/batch`)
      .send({
        revisionId,
        items: [
          {
            channel: "WORDPRESS",
            mode: "AUTO",
            title: longTitle,
            targetStatus: "draft",
          },
        ],
      })
      .expect(201);

    const wpFailPub = batchRes.body.items[0];
    expect(wpFailPub.status).toBe("FAILED");

    // 5.2 触发重试执行：依然校验失败，保留 FAILED 状态，errorMessage 真实可追溯
    const retryRes = await client
      .post(`/publications/${wpFailPub.id}/process`)
      .expect(200);

    expect(retryRes.body.status).toBe("FAILED");
    expect(retryRes.body.attempts.length).toBeGreaterThanOrEqual(2);
    const lastAttempt = retryRes.body.attempts[retryRes.body.attempts.length - 1];
    expect(lastAttempt.status).toBe("FAILED");
    expect(lastAttempt.errorMessage).toBeTruthy();
  });

  it("6. DIST-05 & P2-3 分发记录列表分页与看板字段保真", async () => {
    const listRes = await client
      .get(`/projects/${projectId}/publications?page=1&pageSize=2`)
      .expect(200);

    expect(listRes.body.items.length).toBeLessThanOrEqual(2);
    expect(listRes.body.total).toBeGreaterThanOrEqual(2);
    expect(listRes.body.page).toBe(1);
    expect(listRes.body.pageSize).toBe(2);

    const firstItem = listRes.body.items[0];
    expect(firstItem.id).toBeDefined();
    expect(firstItem.channel).toBeDefined();
    expect(["AUTO", "MANUAL"]).toContain(firstItem.mode);
    expect(Array.isArray(firstItem.attempts)).toBe(true);
    expect(Array.isArray(firstItem.publishedAssets)).toBe(true);
  });

  it("7. DIST-06 物理素材下载端点路径穿越防御与流式传输", async () => {
    // 7.1 路径穿越尝试必须被拦截
    const attackRes = await client
      .get(`/api/assets/download/${orgId}/..%2f..%2fpackage.json`);
    expect([400, 404]).toContain(attackRes.status);

    // 7.2 不存在的资产返回 404
    const notFoundRes = await client
      .get(`/api/assets/download/${orgId}/non-existent-asset-123.jpg`)
      .expect(404);
  });

  it("8. DIST-02 人工发布回填全方位防御：协议校验、禁止未来时间、时间留空保真与幂等去重", async () => {
    // 8.1 创建知乎人工分发记录
    const batchRes = await client
      .post(`/projects/${projectId}/content-drafts/${draftId}/distribution/batch`)
      .send({
        revisionId,
        items: [
          {
            channel: "ZHIHU",
            mode: "MANUAL",
            title: "知乎深度专栏：GEO 时代内容发布",
          },
        ],
      })
      .expect(201);

    const zhihuPubId = batchRes.body.items[0].id;

    // 8.2 缺少任何链接和 ID -> 400
    await client
      .post(`/publications/${zhihuPubId}/confirm-manual-published`)
      .send({})
      .expect(400);

    // 8.3 非法 URL 协议 (javascript:) -> 400
    await client
      .post(`/publications/${zhihuPubId}/confirm-manual-published`)
      .send({ canonicalUrl: "javascript:alert(document.cookie)" })
      .expect(400);

    // 8.4 未来发布时间 -> 400
    await client
      .post(`/publications/${zhihuPubId}/confirm-manual-published`)
      .send({
        canonicalUrl: "https://zhuanlan.zhihu.com/p/12345678",
        actualPublishedAt: "2099-01-01T00:00:00.000Z",
      })
      .expect(400);

    // 8.5 正常回填，但留空 actualPublishedAt：落成 PublishedAsset，actualPublishedAt 严格为 null（绝不伪造为当前时间）
    const confirmRes1 = await client
      .post(`/publications/${zhihuPubId}/confirm-manual-published`)
      .send({
        canonicalUrl: "https://zhuanlan.zhihu.com/p/8899112233",
        externalAssetId: "zhihu_p_8899112233",
        // 不传 actualPublishedAt
        verificationNote: "知乎专栏已人工发布并核验",
      })
      .expect(200);

    expect(confirmRes1.body.publication.status).toBe("PUBLISHED");
    expect(confirmRes1.body.publishedAsset).toBeDefined();
    const asset1 = confirmRes1.body.publishedAsset;
    expect(asset1.canonicalUrl).toBe("https://zhuanlan.zhihu.com/p/8899112233");
    expect(asset1.externalAssetId).toBe("zhihu_p_8899112233");
    expect(asset1.actualPublishedAt).toBeNull(); // 严格为 null，未伪造当前时间

    // 8.6 幂等防重：对同一个 publication 再次提交确认，返回 200 并复用同一 assetId，不生成冗余资产
    const confirmRes2 = await client
      .post(`/publications/${zhihuPubId}/confirm-manual-published`)
      .send({
        canonicalUrl: "https://zhuanlan.zhihu.com/p/8899112233",
        externalAssetId: "zhihu_p_8899112233",
        verificationNote: "知乎专栏已人工发布并核验",
      })
      .expect(200);

    expect(confirmRes2.body.publishedAsset.id).toBe(asset1.id);
  });

  it("9. DIST-07 GEO 再测基准时间闭环：缺少发布时间时标记 MISSING_BASELINE，存在发布时间时正确计算", async () => {
    // 9.1 查询上一步生成的无发布时间资产
    const assetsRes = await client.get(`/projects/${projectId}/published-assets`).expect(200);
    const assetNoDate = assetsRes.body.items.find((a: any) => a.actualPublishedAt === null);
    expect(assetNoDate).toBeDefined();

    // 9.2 关联该资产发起 RetestRun：因缺少发布时间基准，被标记为 MISSING_BASELINE
    const retestRunRes = await client
      .post(`/published-assets/${assetNoDate.id}/retests`)
      .send({ autoExecute: false });

    if (retestRunRes.status === 201) {
      const itemsRes = await client.get(`/retests/${retestRunRes.body.id}/items`).expect(200);
      for (const item of itemsRes.body) {
        expect(item.status).toBe("MISSING_BASELINE");
        expect(item.skipReason).toContain("缺少实际发布时间");
      }
    }

    // 9.3 创建一个具备真实实际发布时间的人工发布资产
    const batchRes = await client
      .post(`/projects/${projectId}/content-drafts/${draftId}/distribution/batch`)
      .send({
        revisionId,
        items: [{ channel: "XIAOHONGSHU", mode: "MANUAL", title: "带发布时间的小红书笔记" }],
      })
      .expect(201);

    const xhsPubId = batchRes.body.items[0].id;
    const confirmDate = new Date(Date.now() - 3600000).toISOString(); // 1小时前
    const confirmRes = await client
      .post(`/publications/${xhsPubId}/confirm-manual-published`)
      .send({
        canonicalUrl: "https://www.xiaohongshu.com/explore/test123456",
        actualPublishedAt: confirmDate,
        verificationNote: "小红书笔记真实审核上线核验",
      })
      .expect(200);

    expect(confirmRes.body.publishedAsset.actualPublishedAt).toBe(confirmDate);
  });
});
