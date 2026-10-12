import "../../../packages/database/scripts/test-env.cjs";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";
import { constrainAdaptationChannel, adaptationIdempotencyKey } from "../src/ai/content-adaptation";
import { adaptationBudgetAllowsCall, assessAdaptationBudget } from "../src/ai/adaptation-budget";

process.env.ENABLE_REAL_PROVIDERS = "false";
process.env.EXTERNAL_PUBLISHING_ENABLED = "false";

describe("content adaptation constraints", () => {
  it("truncates over-limit text and flags unsourced percentages", () => {
    const result = constrainAdaptationChannel(
      {
        channel: "XIAOHONGSHU",
        title: "这是一个明显超过二十个字的标题用来验证截断",
        body: "原文事实。转化率提升 80%。",
        hashtags: ["#甲", "甲", "乙", "丙"],
        videoScript: "不该出现的脚本",
        omittedClaims: [],
      },
      "原文事实",
      { title: 20, body: 1000, maxTags: 2 },
      false,
    );
    expect(result.title.length).toBe(20);
    expect(result.hashtags).toEqual(["甲", "乙"]);
    expect(result.videoScript).toBeNull();
    expect(result.adjustments.join(" ")).toContain("标题已截断");
    expect(result.riskNotes.join(" ")).toContain("80%");
  });

  it("removes prompt labels that are not part of the source", () => {
    const result = constrainAdaptationChannel(
      {
        channel: "XIAOHONGSHU",
        title: "标题",
        body: "原文事实。补充说明：门禁复验。人工要求：无。",
        hashtags: ["原文"],
        videoScript: "",
        omittedClaims: [],
      },
      "原文事实",
      { title: 20, body: 1000, maxTags: 10 },
      false,
    );
    expect(result.body).toBe("原文事实。");
    expect(result.adjustments.join(" ")).toContain("提示词标签");
    expect(result.videoScript).toBeNull();
  });

  it("keeps the same key when channel order changes", () => {
    const left = adaptationIdempotencyKey({
      promptVersion: "content-channel-adaptation-v1",
      revisionId: "rev",
      title: "t",
      body: "b",
      channels: ["WORDPRESS", "XIAOHONGSHU"],
    });
    const right = adaptationIdempotencyKey({
      promptVersion: "content-channel-adaptation-v1",
      revisionId: "rev",
      title: "t",
      body: "b",
      channels: ["XIAOHONGSHU", "WORDPRESS"],
    });
    expect(left).toBe(right);
  });

  it("blocks a real adaptation whose worst-case cost exceeds the ceiling", () => {
    const budget = assessAdaptationBudget("系统", "x".repeat(400_000));
    expect(adaptationBudgetAllowsCall(budget)).toBe(false);
    expect(budget.worstCaseUsd).toBeGreaterThan(0.08);
  });

  it("allows the short channel prompt under the peak price ceiling", () => {
    const budget = assessAdaptationBudget("你是编辑", "原文标题：门禁\n原文正文：隔离正文");
    expect(adaptationBudgetAllowsCall(budget)).toBe(true);
    expect(budget.model).toBe("deepseek-flash");
    expect(budget.maxOutputTokens).toBe(1536);
    expect(budget.worstCaseUsd).toBeLessThan(0.01);
  });
});

describe("AI content channel adaptation e2e", () => {
  let app: INestApplication;
  let client: ReturnType<typeof request.agent>;
  let outsider: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const password = "adapt-pass-1234";
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

    const email = `adapt-${suffix}@geolens.test`;
    client = request.agent(app.getHttpServer());
    const reg = await client.post("/auth/register").send({ email, name: "Adapt User", password });
    expect(reg.status).toBe(201);
    orgId = reg.body.organization.id;
    await client.post("/auth/login").send({ email, password }).expect(200);

    const project = await prisma.project.create({
      data: { organizationId: orgId, name: `Adaptation ${suffix}` },
    });
    projectId = project.id;
    const draftRes = await client.post(`/projects/${projectId}/content-drafts`).send({
      title: "GeoLens 分发门禁复验稿标题超长用于小红书截断",
      body: "这是隔离适配正文，只陈述本地复验事实，不包含任何效果承诺。",
      summary: "隔离适配",
      topic: "门禁",
    });
    expect(draftRes.status).toBe(201);
    draftId = draftRes.body.id;
    revisionId = draftRes.body.latestRevision.id;

    outsider = request.agent(app.getHttpServer());
    const otherEmail = `adapt-out-${suffix}@geolens.test`;
    await outsider.post("/auth/register").send({ email: otherEmail, name: "Outsider", password }).expect(201);
    await outsider.post("/auth/login").send({ email: otherEmail, password }).expect(200);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("returns a labeled mock adaptation and does not create a publication", async () => {
    const res = await client
      .post(`/projects/${projectId}/content-drafts/${draftId}/ai/channel-adaptation`)
      .send({
        provider: "mock",
        channels: ["XIAOHONGSHU", "WECHAT_OFFICIAL_ACCOUNT", "DOUYIN"],
      })
      .expect(200);

    expect(res.body.realAi).toBe(false);
    expect(res.body.generationSource).toBe("mock");
    expect(res.body.provider).toBe("mock");
    expect(res.body.replayed).toBe(false);
    expect(res.body.promptVersion).toBe("content-channel-adaptation-v1");
    expect(res.body.estimatedCost).toBe(0);
    const xhs = res.body.channels.find((item: { channel: string }) => item.channel === "XIAOHONGSHU");
    const wechat = res.body.channels.find((item: { channel: string }) => item.channel === "WECHAT_OFFICIAL_ACCOUNT");
    const douyin = res.body.channels.find((item: { channel: string }) => item.channel === "DOUYIN");
    expect(xhs.title.length).toBeLessThanOrEqual(20);
    expect(xhs.body).toContain("隔离适配正文");
    expect(xhs.videoScript).toBeNull();
    expect(wechat.videoScript).toBeNull();
    expect(douyin.videoScript).toContain("口播沿用原文");
    expect(await prisma.publication.count({ where: { draftId } })).toBe(0);

    const replay = await client
      .post(`/projects/${projectId}/content-drafts/${draftId}/ai/channel-adaptation`)
      .send({ provider: "mock", channels: ["DOUYIN", "XIAOHONGSHU", "WECHAT_OFFICIAL_ACCOUNT"] })
      .expect(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.generationId).toBe(res.body.generationId);
    expect(await prisma.aiGeneration.count({
      where: { entityId: draftId, feature: "content_channel_adaptation", status: "SUCCESS" },
    })).toBe(1);

    const forced = await client
      .post(`/projects/${projectId}/content-drafts/${draftId}/ai/channel-adaptation`)
      .send({ provider: "mock", force: true, channels: ["XIAOHONGSHU", "WECHAT_OFFICIAL_ACCOUNT", "DOUYIN"] })
      .expect(200);
    expect(forced.body.replayed).toBe(false);
    expect(await prisma.aiGeneration.count({
      where: { entityId: draftId, feature: "content_channel_adaptation", status: "SUCCESS" },
    })).toBe(2);
  });

  it("rejects another organization and unknown channels", async () => {
    await outsider
      .post(`/projects/${projectId}/content-drafts/${draftId}/ai/channel-adaptation`)
      .send({ provider: "mock", channels: ["XIAOHONGSHU"] })
      .expect(404);
    await client
      .post(`/projects/${projectId}/content-drafts/${draftId}/ai/channel-adaptation`)
      .send({ provider: "mock", channels: ["NOT_A_CHANNEL"] })
      .expect(400);
    await client
      .post(`/projects/${projectId}/content-drafts/${draftId}/ai/channel-adaptation`)
      .send({ provider: "qwen", channels: ["XIAOHONGSHU"] })
      .expect(400);
  });

  it("confirmed script enters the existing manual package without marking a public asset", async () => {
    const adapted = await client
      .post(`/projects/${projectId}/content-drafts/${draftId}/ai/channel-adaptation`)
      .send({ provider: "mock", channels: ["DOUYIN"] })
      .expect(200);
    const douyin = adapted.body.channels[0];
    await client.post(`/content-drafts/${draftId}/submit`).expect(200);
    await client.post(`/content-drafts/${draftId}/decide`).send({ decision: "APPROVED", revisionId }).expect(200);

    const batch = await client
      .post(`/projects/${projectId}/content-drafts/${draftId}/distribution/batch`)
      .send({
        idempotencyKey: `adapt-${suffix}`,
        items: [{
          channel: "DOUYIN",
          mode: "MANUAL",
          title: douyin.title,
          body: douyin.body,
          tags: douyin.hashtags,
          videoScript: douyin.videoScript,
        }],
      })
      .expect(201);
    expect(batch.body.items[0].replayed).toBeFalsy();
    expect(batch.body.items[0].manualPackage.videoScript).toContain("口播沿用原文");
    expect(batch.body.items[0].manualPackage.title).toBe(douyin.title);
    expect(batch.body.items[0].status).toBe("PENDING");
    expect(await prisma.publishedAsset.count({ where: { draftId } })).toBe(0);

    const again = await client
      .post(`/projects/${projectId}/content-drafts/${draftId}/distribution/batch`)
      .send({
        idempotencyKey: `adapt-${suffix}`,
        items: [{
          channel: "DOUYIN",
          mode: "MANUAL",
          title: "另一份标题",
          body: douyin.body,
          tags: douyin.hashtags,
          videoScript: "另一份脚本",
        }],
      })
      .expect(201);
    expect(again.body.items[0].replayed).toBe(true);
    expect(again.body.items[0].manualPackage.title).toBe(douyin.title);
    expect(again.body.items[0].manualPackage.videoScript).toContain("口播沿用原文");
  });
});
