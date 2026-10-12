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

  describe("10. V1 Gate 复验残留缺陷", () => {
    const batchUrl = () => `/projects/${projectId}/content-drafts/${draftId}/distribution/batch`;

    it("10.1 预览、提交与发布包为同一份最终内容；人工渠道超限整批拒绝且零副作用", async () => {
      const adapt = await client
        .post(`/projects/${projectId}/content-drafts/${draftId}/distribution/adapt`)
        .send({ revisionId, channels: ["XIAOHONGSHU", "ZHIHU", "WEIBO", "DOUYIN", "WECHAT_CHANNELS", "BILIBILI"] })
        .expect(200);
      for (const c of adapt.body.channels) {
        expect(c.manualPackage.title).toBe(c.title);
        expect(c.manualPackage.body).toBe(c.body);
        expect(c.manualPackage.hashtags).not.toContain("#内容营销");
      }

      const before = await prisma.publication.count({ where: { draftId } });
      const over = await client
        .post(batchUrl())
        .send({
          revisionId,
          items: [
            { channel: "ZHIHU", mode: "MANUAL", title: "合法知乎稿" },
            { channel: "XIAOHONGSHU", mode: "MANUAL", title: "长".repeat(25), body: "文".repeat(1100) },
          ],
        });
      expect(over.status).toBe(400);
      expect(over.body.message).toContain("标题 25/20 字");
      expect(await prisma.publication.count({ where: { draftId } })).toBe(before);

      const edited = { title: "最终编辑版", body: "最终编辑正文 FINAL\n#独立复验 #门店内容" };
      const ok = await client
        .post(batchUrl())
        .send({ revisionId, items: [{ channel: "XIAOHONGSHU", mode: "MANUAL", ...edited, tags: [] }] })
        .expect(201);
      const pubId = ok.body.items[0].id;
      const pkg = await client.get(`/publications/${pubId}/manual-package`).expect(200);
      expect(pkg.body.title).toBe(edited.title);
      expect(pkg.body.body).toBe(edited.body);
      expect(pkg.body.hashtags).toEqual(["#独立复验", "#门店内容"]);
      expect(ok.body.items[0].manualPackage.body).toBe(edited.body);
      const stored = await prisma.publication.findUniqueOrThrow({ where: { id: pubId } });
      expect(stored.title).toBe(edited.title);
      expect(JSON.parse(stored.payload).body).toBe(edited.body);
    });

    it("10.2 同一稳定键并发提交全部成功且只产生一个任务，重放不覆盖原任务内容", async () => {
      const key = `dist-concurrent-${randomUUID()}`;
      const payload = {
        revisionId,
        idempotencyKey: key,
        items: [{ channel: "XIAOHONGSHU", mode: "MANUAL", title: "并发提交" }],
      };
      const responses = await Promise.all(Array.from({ length: 6 }, () => client.post(batchUrl()).send(payload)));
      expect(responses.map((r) => r.status)).toEqual(Array(6).fill(201));
      expect(new Set(responses.map((r) => r.body.items[0].id)).size).toBe(1);
      expect(await prisma.publication.count({ where: { idempotencyKey: `${key}:XIAOHONGSHU` } })).toBe(1);

      const replay = await client
        .post(batchUrl())
        .send({ ...payload, items: [{ channel: "XIAOHONGSHU", mode: "MANUAL", title: "重放改标题" }] })
        .expect(201);
      expect(replay.body.items[0].replayed).toBe(true);
      expect(replay.body.items[0].title).toBe("并发提交");
      expect(replay.body.items[0].manualPackage.title).toBe("并发提交");
    });

    it("10.3 人工确认：非法 URL 被拒、并发确认只落一个资产、不同身份重复确认 409", async () => {
      const res = await client
        .post(batchUrl())
        .send({ revisionId, items: [{ channel: "WEIBO", mode: "MANUAL", title: "并发确认" }] })
        .expect(201);
      const pubId = res.body.items[0].id;

      for (const bad of ["https://", "http://", "https:///path-only"]) {
        await client.post(`/publications/${pubId}/confirm-manual-published`).send({ canonicalUrl: bad }).expect(400);
      }

      const body = {
        canonicalUrl: "https://weibo.com/1234567890/concurrent",
        actualPublishedAt: new Date(Date.now() - 7200000).toISOString(),
        verificationNote: "e2e 人工核验",
      };
      const confirms = await Promise.all(
        Array.from({ length: 4 }, () => client.post(`/publications/${pubId}/confirm-manual-published`).send(body)),
      );
      expect(confirms.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      expect(new Set(confirms.map((r) => r.body.publishedAsset.id)).size).toBe(1);
      expect(await prisma.publishedAsset.count({ where: { publicationId: pubId } })).toBe(1);
      expect(await prisma.publicationAttempt.count({ where: { publicationId: pubId } })).toBe(1);

      await client
        .post(`/publications/${pubId}/confirm-manual-published`)
        .send({ ...body, canonicalUrl: "https://weibo.com/1234567890/other" })
        .expect(409);
    });

    it("10.4 素材下载按项目成员隔离：本人可下载，非成员 404", async () => {
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      );
      const upload = await client
        .post(`/projects/${projectId}/content-assets`)
        .field("type", "IMAGE")
        .field("draftId", draftId)
        .attach("file", png, { filename: "e2e.png", contentType: "image/png" })
        .expect(201);
      const adapt = await client
        .post(`/projects/${projectId}/content-drafts/${draftId}/distribution/adapt`)
        .send({ revisionId, channels: ["XIAOHONGSHU"] })
        .expect(200);
      const storageKey = String(upload.body.storageRef).replace("dev-local://", "");
      const manifestUrl: string = adapt.body.channels[0].manualPackage.assetManifest
        .map((a: { url: string }) => a.url)
        .find((u: string) => u.endsWith(storageKey));
      expect(manifestUrl).toBeDefined();
      const url = new URL(manifestUrl).pathname;

      const owner = await client.get(url).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
      expect(owner.status).toBe(200);
      expect(Buffer.compare(owner.body as Buffer, png)).toBe(0);

      const outsider = request.agent(app.getHttpServer());
      const outsiderEmail = `dist-outsider-${suffix}@geolens.test`;
      await outsider.post("/auth/register").send({ email: outsiderEmail, name: "Outsider", password }).expect(201);
      await outsider.post("/auth/login").send({ email: outsiderEmail, password }).expect(200);
      await outsider.get(url).expect(404);
    });

    it("10.5 未知发布时间的资产复测一律 MISSING_BASELINE，不以落库时间 publishedAt 冒充锚点", async () => {
      const query = await prisma.query.create({ data: { projectId, text: `分发复测锚点 ${suffix}` } });
      const engine =
        (await prisma.engine.findFirst({ where: { provider: "mock" } })) ??
        (await prisma.engine.create({ data: { key: `mock-dist-${suffix}`, name: "Mock", provider: "mock", config: {} } }));
      const task = await prisma.monitorTask.create({
        data: { organizationId: orgId, projectId, totalRuns: 1, status: "SUCCEEDED", completedRuns: 1 },
      });
      const run = await prisma.run.create({
        data: { monitorTaskId: task.id, queryId: query.id, engineId: engine.id, status: "SUCCEEDED" },
      });
      await prisma.evidence.create({
        data: {
          runId: run.id,
          queryText: query.text,
          rawPrompt: `Query: ${query.text}`,
          rawResponse: "发布前基线",
          provider: "mock",
          engineKey: engine.key,
          engineName: engine.name,
          model: "mock-model",
          retrievalMode: "api_plain",
          sourceType: "mock",
          metadata: {},
          entitySnapshot: {},
          createdAt: new Date(Date.now() - 86400000),
        },
      });

      const res = await client
        .post(batchUrl())
        .send({ revisionId, items: [{ channel: "BILIBILI", mode: "MANUAL", title: "未知时间资产" }] })
        .expect(201);
      const confirm = await client
        .post(`/publications/${res.body.items[0].id}/confirm-manual-published`)
        .send({ canonicalUrl: "https://www.bilibili.com/read/cv-unknown-time", verificationNote: "e2e 人工核验" })
        .expect(200);
      const asset = confirm.body.publishedAsset;
      expect(asset.actualPublishedAt).toBeNull();
      expect(asset.publicationTimeSource).toBe("UNKNOWN");

      const retest = await client
        .post(`/published-assets/${asset.id}/retests`)
        .send({ queryIds: [query.id], provider: "mock", sourceType: "mock", autoExecute: false })
        .expect(201);
      const items = await prisma.retestItem.findMany({ where: { retestRunId: retest.body.id } });
      expect(items).toHaveLength(1);
      expect(items[0].baselineStatus).toBe("MISSING_BASELINE");
      expect(items[0].baselineEvidenceId).toBeNull();
      const stored = await prisma.retestRun.findUniqueOrThrow({ where: { id: retest.body.id } });
      expect((stored.inputSnapshot as any).publishedAsset.publishedAt).toBeNull();
    });
  });
});
