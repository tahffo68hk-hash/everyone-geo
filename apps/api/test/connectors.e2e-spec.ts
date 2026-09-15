/**
 * Multi-Channel Connector Platform e2e 自动化测试套件
 * 
 * 覆盖：
 * 1. GET /channels (全量渠道与分类能力矩阵)
 * 2. GET /channels/:channel/capabilities (单渠道能力详情与 404 容错)
 * 3. POST /connections/:channel/authorize (安全 OAuth state 签发与租户绑定)
 * 4. GET /connections/:channel/callback (OAuth 换码、凭据入库、连接激活与秘密防泄露)
 * 5. DELETE /connections/:id (连接撤销与凭据清理)
 * 6. POST /publications/:id/validate (发布前能力校验与 dryRun 检查)
 * 7. POST /publications/:id/publish (安全网关拦截下的发布流转与 Mock 外部标识)
 * 8. GET /publications/:id/status (发布状态追踪与 attempts 查询)
 * 9. GET /publications/:id/manual-package (无官方 API 渠道如小红书的手工发布包导出)
 */
import "../../../packages/database/scripts/test-env.cjs";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";
import { defaultCredentialVault } from "@geo/queue";

process.env.ENABLE_REAL_PROVIDERS = "false";
process.env.EXTERNAL_PUBLISHING_ENABLED = "false";
const ASSET_DIR = mkdtempSync(join(tmpdir(), "connector-assets-"));
process.env.CONTENT_ASSET_STORAGE_DIR = ASSET_DIR;

const json = (obj: unknown) => JSON.stringify(obj);

describe("Multi-Channel Connector Platform e2e", () => {
  let app: INestApplication;
  let owner: ReturnType<typeof request.agent>;
  let member: ReturnType<typeof request.agent>;
  let outsider: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const password = "conn-e2e-pass-123";
  const ids: Record<string, string> = {};

  const register = async (email: string) => {
    const res = await request(app.getHttpServer()).post("/auth/register").send({ email, name: "ConnectorTester", password });
    expect(res.status).toBe(201);
    return res.body as { organization: { id: string } };
  };

  const mkApprovedDraft = async (title: string, bodyContent = "正式营销文案测试内容") => {
    const dRes = await owner.post(`/projects/${ids.projectA}/content-drafts`).send({
      title,
      body: json({ body: bodyContent, tags: ["GEO", "SEO"], coverUrl: "https://example.com/cover.jpg" }),
    });
    expect(dRes.status).toBe(201);
    const draft = dRes.body as { id: string };
    await owner.post(`/content-drafts/${draft.id}/submit`).expect(200);
    const decided = await owner.post(`/content-drafts/${draft.id}/decide`).send({ decision: "APPROVED" });
    expect(decided.status).toBe(200);
    return draft;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    owner = request.agent(app.getHttpServer());
    member = request.agent(app.getHttpServer());
    outsider = request.agent(app.getHttpServer());

    const ownerEmail = `conn-own-${suffix}@test.com`;
    const memberEmail = `conn-mem-${suffix}@test.com`;
    const outsiderEmail = `conn-out-${suffix}@test.com`;

    const a = await register(ownerEmail);
    const b = await register(memberEmail);
    const c = await register(outsiderEmail);
    ids.orgA = a.organization.id;
    ids.orgM = b.organization.id;
    ids.orgB = c.organization.id;

    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail } });
    const memberUser = await prisma.user.findUniqueOrThrow({ where: { email: memberEmail } });
    const outsiderUser = await prisma.user.findUniqueOrThrow({ where: { email: outsiderEmail } });
    ids.ownerUserId = ownerUser.id;
    ids.memberUserId = memberUser.id;
    ids.outsiderUserId = outsiderUser.id;

    await prisma.organizationMember.create({
      data: { userId: memberUser.id, organizationId: ids.orgA, role: "MEMBER" },
    });

    await owner.post("/auth/login").send({ email: ownerEmail, password }).expect(200);
    await member.post("/auth/login").send({ email: memberEmail, password }).expect(200);
    await outsider.post("/auth/login").send({ email: outsiderEmail, password }).expect(200);

    const pA = await prisma.project.create({ data: { organizationId: ids.orgA, name: `Conn Project A ${suffix}` } });
    ids.projectA = pA.id;
    const pB = await prisma.project.create({ data: { organizationId: ids.orgB, name: `Conn Project B ${suffix}` } });
    ids.projectB = pB.id;
  }, 120000);

  afterAll(async () => {
    try {
      const orgIds = [ids.orgA, ids.orgM, ids.orgB].filter(Boolean) as string[];
      if (orgIds.length) {
        await prisma.project.deleteMany({ where: { organizationId: { in: orgIds } } });
        const members = await prisma.organizationMember.findMany({ where: { organizationId: { in: orgIds } }, select: { userId: true } });
        const userIds = Array.from(new Set(members.map((m) => m.userId)));
        await prisma.organizationMember.deleteMany({ where: { organizationId: { in: orgIds } } });
        await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
        if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
      await app?.close();
    } catch {
      /* 容错清理 */
    }
  });

  describe("1. 渠道矩阵与能力描述符", () => {
    it("GET /channels 返回所有注册渠道的统一能力矩阵与分类", async () => {
      const res = await owner.get("/channels").expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(30);

      const channels = res.body.map((c: any) => c.channel);
      expect(channels).toContain("WORDPRESS");
      expect(channels).toContain("GHOST");
      expect(channels).toContain("XIAOHONGSHU");
      expect(channels).toContain("DOUYIN");
      expect(channels).toContain("BAIDU_SEARCH_SURFACE");

      const wp = res.body.find((c: any) => c.channel === "WORDPRESS");
      expect(wp.category).toBe("OWNED_SITE");
      expect(wp.supportsText).toBe(true);
      expect(wp.implementationStatus).toBe("READY");

      const xhs = res.body.find((c: any) => c.channel === "XIAOHONGSHU");
      expect(xhs.implementationStatus).toBe("MANUAL_ONLY");

      const dy = res.body.find((c: any) => c.channel === "DOUYIN");
      expect(dy.implementationStatus).toBe("RESTRICTED");

      const baidu = res.body.find((c: any) => c.channel === "BAIDU_SEARCH_SURFACE");
      expect(baidu.category).toBe("SEARCH_SURFACE");
    });

    it("GET /channels/:channel/capabilities 返回单个渠道能力详情", async () => {
      const res = await owner.get("/channels/WORDPRESS/capabilities").expect(200);
      expect(res.body.channel).toBe("WORDPRESS");
      expect(res.body.officialDocsUrl).toBeDefined();
      expect(res.body.assetLimits).toBeDefined();
      expect(res.body.titleMax).toBeGreaterThan(0);
    });

    it("GET /channels/:channel/capabilities 对未知渠道返回 404", async () => {
      await owner.get("/channels/UNKNOWN_CHANNEL_XYZ/capabilities").expect(404);
    });
  });

  describe("2. OAuth 授权流与凭据金库", () => {
    let stateString: string;
    let createdConnectionId: string;

    it("POST /connections/:channel/authorize 生成带签名与租户绑定的 state 和授权 URL", async () => {
      const res = await owner
        .post("/connections/WORDPRESS/authorize")
        .send({
          projectId: ids.projectA,
          redirectUri: "https://app.geolens.io/auth/callback",
        })
        .expect(200);

      expect(res.body.authorizationUrl).toBeDefined();
      expect(res.body.state).toBeDefined();
      stateString = res.body.state;
      expect(stateString.split(".").length).toBe(2); // payload.sig
    });

    it("GET /connections/:channel/callback 换取凭据并建立连接，绝不回显密钥", async () => {
      const res = await owner
        .get(`/connections/WORDPRESS/callback?code=mock_oauth_code_xyz987&state=${encodeURIComponent(stateString)}`)
        .expect(200);

      expect(res.body.id).toBeDefined();
      createdConnectionId = res.body.id;
      expect(res.body.channel).toBe("WORDPRESS");
      expect(res.body.status).toBe("CONNECTED");
      // 验证绝不外泄 credentialRef 与 secret tokens
      expect(res.body.credentialRef).toBeUndefined();
      expect(res.body.accessToken).toBeUndefined();

      // 验证底层密钥库已安全落库
      const dbConn = await prisma.channelAccountConnection.findUniqueOrThrow({
        where: { id: createdConnectionId },
      });
      expect(dbConn.credentialRef).toMatch(/^vault:\/\/aes256gcm\/wordpress\//);
      const stored = defaultCredentialVault.getCredential(dbConn.credentialRef!);
      expect(stored?.accessToken).toContain("mock_oauth_token_");
    });

    it("DELETE /connections/:connectionId 撤销连接并清理密钥库", async () => {
      const delRes = await owner.delete(`/connections/${createdConnectionId}`).expect(200);
      expect(delRes.body.success).toBe(true);

      const exists = await prisma.channelAccountConnection.findUnique({
        where: { id: createdConnectionId },
      });
      expect(exists).toBeNull();

      // 再次删除返回 404
      await owner.delete(`/connections/${createdConnectionId}`).expect(404);
    });
  });

  describe("3. 内容发布前置校验与 dryRun 检查", () => {
    let wpConnId: string;
    let pubId: string;

    beforeAll(async () => {
      const conn = await owner.post(`/projects/${ids.projectA}/channel-connections`).send({
        channel: "WORDPRESS",
        displayName: `WP Blog ${suffix}`,
        credentialRef: `vault://aes256gcm/wordpress/fixture-${suffix}`,
      });
      expect(conn.status).toBe(201);
      wpConnId = conn.body.id;

      const draft = await mkApprovedDraft(`WP 发布前校验草稿 ${suffix}`);
      const pubRes = await owner.post(`/projects/${ids.projectA}/content-drafts/${draft.id}/publications`).send({
        connectionId: wpConnId,
        title: `WP 发布前校验草稿 ${suffix}`,
        payload: json({ body: "测试发布校验内容", tags: ["WP", "SEO"] }),
      });
      expect(pubRes.status).toBe(201);
      pubId = pubRes.body.id;
    });

    it("POST /publications/:id/validate 执行 preflight 检查", async () => {
      const res = await owner.post(`/publications/${pubId}/validate`).send().expect(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.dryRunPassed).toBe(true);
      expect(res.body.errors).toEqual([]);
      expect(res.body.channel).toBe("WORDPRESS");
    });

    it("POST /publications/:id/validate 拦截非本组织/不存在的 publication", async () => {
      await outsider.post(`/publications/${pubId}/validate`).expect(404);
    });
  });

  describe("4. 发布执行出站写闸门与 Mock 追踪", () => {
    let wpConnId: string;
    let pubId: string;

    beforeAll(async () => {
      const conn = await owner.post(`/projects/${ids.projectA}/channel-connections`).send({
        channel: "WORDPRESS",
        displayName: `WP Exec ${suffix}`,
        credentialRef: `vault://aes256gcm/wordpress/fixture-exec-${suffix}`,
      });
      expect(conn.status).toBe(201);
      wpConnId = conn.body.id;

      const draft = await mkApprovedDraft(`正式发布测试草稿 ${suffix}`);
      const pubRes = await owner.post(`/projects/${ids.projectA}/content-drafts/${draft.id}/publications`).send({
        connectionId: wpConnId,
        title: `正式发布测试草稿 ${suffix}`,
        payload: json({ body: "正式营销测试内容", tags: ["GEO", "AUTO"] }),
      });
      expect(pubRes.status).toBe(201);
      pubId = pubRes.body.id;

      // 重置发布状态为 PENDING，并清理 attempt 以便测试 POST /publications/:id/publish
      await prisma.publicationAttempt.deleteMany({ where: { publicationId: pubId } });
      await prisma.publication.update({ where: { id: pubId }, data: { status: "PENDING", publishedAt: null } });
    });

    it("POST /publications/:id/publish 在闸门关闭时安全生成 Mock attempt 并标记 PUBLISHED", async () => {
      const res = await owner.post(`/publications/${pubId}/publish`).send({ confirm: true }).expect(200);

      expect(res.body.executionResult).toBeDefined();
      expect(res.body.executionResult.status).toBe("PUBLISHED");
      expect(res.body.executionResult.result?.externalUrl).toMatch(/^https:\/\/mock\.geo\.local\/wordpress\//i);

      // 验证发布状态
      expect(res.body.publication.status).toBe("PUBLISHED");
      expect(res.body.publication.attempts.length).toBeGreaterThan(0);
      const attempt = res.body.publication.attempts[0];
      expect(attempt.status).toBe("PUBLISHED");
      expect(attempt.externalUrl).toContain("mock.geo.local");
    });

    it("GET /publications/:id/status 查询发布状态与重试尝试记录", async () => {
      const res = await owner.get(`/publications/${pubId}/status`).expect(200);
      expect(res.body.id).toBe(pubId);
      expect(res.body.status).toBe("PUBLISHED");
      expect(res.body.attempts).toBeDefined();
      expect(res.body.attempts.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("5. Manual-Only 渠道（小红书等）手工发布包导出", () => {
    let xhsConnId: string;
    let xhsPubId: string;

    beforeAll(async () => {
      const conn = await owner.post(`/projects/${ids.projectA}/channel-connections`).send({
        channel: "XIAOHONGSHU",
        displayName: `小红书手工号 ${suffix}`,
        credentialRef: `vault://aes256gcm/xiaohongshu/fixture-${suffix}`,
      });
      expect(conn.status).toBe(201);
      xhsConnId = conn.body.id;

      const draft = await mkApprovedDraft(`小红书种草笔记 ${suffix}`, "这是一款极具质感的测试产品体验记录！");
      const pubRes = await owner.post(`/projects/${ids.projectA}/content-drafts/${draft.id}/publications`).send({
        connectionId: xhsConnId,
        title: `小红书种草笔记 ${suffix}`,
        payload: json({ body: "这是一款极具质感的测试产品体验记录！", tags: ["GEO", "SEO"] }),
      });
      expect(pubRes.status).toBe(201);
      xhsPubId = pubRes.body.id;
    });

    it("GET /publications/:id/manual-package 导出符合小红书规则的手工发布包", async () => {
      const res = await owner.get(`/publications/${xhsPubId}/manual-package`).expect(200);

      expect(res.body.channel).toBe("XIAOHONGSHU");
      expect(res.body.title).toContain("小红书种草笔记");
      expect(res.body.body).toContain("这是一款极具质感的测试产品体验记录！");
      expect(res.body.hashtags).toEqual(["#GEO", "#SEO"]);
      expect(Array.isArray(res.body.checklist)).toBe(true);
      expect(res.body.checklist.some((c: string) => c.includes("小红书"))).toBe(true);
      expect(res.body.callToAction).toContain("小红书");
      expect(Array.isArray(res.body.assetManifest)).toBe(true);
    });
  });
});
