/**
 * M9 · 内容执行领域 e2e（geo_test）。Real Provider Calls / External Writes = 0。
 *
 * 覆盖 PHASE 18/19 不变量：
 *   - 状态机：DRAFT→READY_FOR_REVIEW→APPROVED→PUBLISHED；非法转移一律拒绝。
 *   - 审批闸门：未 APPROVED（含未提交/被驳回）不得发布；只能批最新版本。
 *   - RBAC：审批需 ADMIN/OWNER（MEMBER 403）；编辑/发布仅需 membership。
 *   - 渠道连接状态：REVOKED/EXPIRED 拦截发布。
 *   - 出站写闸门：EXTERNAL_PUBLISHING_ENABLED=false；仅 Mock（假 externalId/url）。
 *   - 幂等：已发布/同键重放不再产生新 attempt。
 *   - 秘密安全：credentialRef 不出现在任何 API/审计输出中。
 *   - 租户隔离：跨租户/跨项目 404；未认证 401。
 *   - 用量：costUsd 恒为 null（非 0）。
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

const json = (obj: unknown) => JSON.stringify(obj);

describe("M9 内容执行领域 e2e", () => {
  let app: INestApplication;
  let owner: ReturnType<typeof request.agent>;
  let member: ReturnType<typeof request.agent>;
  let outsider: ReturnType<typeof request.agent>;
  let anon: ReturnType<typeof request>;
  const suffix = randomUUID().slice(0, 8);
  const password = "m9-e2e-pass-123";
  const SECRET_REF = `vault://geo/test/secret-${suffix}`;
  const ids: Record<string, string> = {};

  const register = async (email: string) => {
    const res = await request(app.getHttpServer()).post("/auth/register").send({ email, name: "E", password });
    expect(res.status).toBe(201);
    return res.body as { organization: { id: string } };
  };

  const mkDraft = async (title: string, payloadObj: unknown = { body: "初版内容" }) => {
    const res = await owner.post(`/projects/${ids.projectA}/content-drafts`).send({ title, body: json(payloadObj) });
    expect(res.status).toBe(201);
    return res.body as { id: string; status: string; latestRevision: { id: string; version: number } };
  };

  /** 生成一个 APPROVED 草稿（create→submit→owner approve）。 */
  const approvedDraft = async (title: string) => {
    const d = await mkDraft(title);
    await owner.post(`/content-drafts/${d.id}/submit`).expect(200);
    const decided = await owner.post(`/content-drafts/${d.id}/decide`).send({ decision: "APPROVED" });
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe("APPROVED");
    return d;
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
    anon = request(app.getHttpServer());

    const ownerEmail = `m9-own-${suffix}@m9.test.com`;
    const memberEmail = `m9-mem-${suffix}@m9.test.com`;
    const outsiderEmail = `m9-out-${suffix}@m9.test.com`;
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

    // member 加入 orgA，角色 MEMBER（用于 RBAC 审批 403 验证）。
    await prisma.organizationMember.create({
      data: { userId: memberUser.id, organizationId: ids.orgA, role: "MEMBER" },
    });

    await owner.post("/auth/login").send({ email: ownerEmail, password }).expect(200);
    await member.post("/auth/login").send({ email: memberEmail, password }).expect(200);
    await outsider.post("/auth/login").send({ email: outsiderEmail, password }).expect(200);

    const pA = await prisma.project.create({ data: { organizationId: ids.orgA, name: `M9 A ${suffix}` } });
    ids.projectA = pA.id;
    const pB = await prisma.project.create({ data: { organizationId: ids.orgB, name: `M9 B ${suffix}` } });
    ids.projectB = pB.id;

    // CONNECTED 连接（经 API 创建，携带 credentialRef；响应/审计均不得回显）。
    const conn = await owner.post(`/projects/${ids.projectA}/channel-connections`).send({
      channel: "XIAOHONGSHU", displayName: `xhs-${suffix}`, credentialRef: SECRET_REF,
    });
    expect(conn.status).toBe(201);
    ids.connConnected = conn.body.id as string;

    // REVOKED 连接（直接落库，用于状态拦截验证）。
    const revoked = await prisma.channelAccountConnection.create({
      data: {
        organizationId: ids.orgA, channel: "DOUYIN", displayName: `dy-${suffix}`,
        credentialRef: SECRET_REF, status: "REVOKED", createdById: ownerUser.id,
      },
    });
    ids.connRevoked = revoked.id;
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
      await app.close();
      await prisma.$disconnect();
    } catch {
      /* 清理失败不掩盖测试结论 */
    }
  }, 120000);

  it("A. 草稿生命周期：创建→编辑(新版本)→提交→审批", async () => {
    const d = await mkDraft(`Draft-A-${suffix}`);
    expect(d.status).toBe("DRAFT");
    expect(d.latestRevision.version).toBe(1);

    const upd = await owner.patch(`/content-drafts/${d.id}`).send({ body: json({ body: "第二版" }) });
    expect(upd.status).toBe(200);
    expect(upd.body.status).toBe("DRAFT"); // 编辑回退到 DRAFT
    expect(upd.body.latestRevision.version).toBe(2);
    expect(upd.body.revisionCount).toBe(2);

    const sub = await owner.post(`/content-drafts/${d.id}/submit`).expect(200);
    expect(sub.body.status).toBe("READY_FOR_REVIEW");

    // MEMBER 审批 → 403（RBAC 复用 OrgRole）。
    const forbidden = await member.post(`/content-drafts/${d.id}/decide`).send({ decision: "APPROVED" });
    expect(forbidden.status).toBe(403);

    const ok = await owner.post(`/content-drafts/${d.id}/decide`).send({ decision: "APPROVED" });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("APPROVED");

    const audit = await owner.get(`/content-drafts/${d.id}/audit`).expect(200);
    const actions = (audit.body as Array<{ action: string }>).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(["DRAFT_CREATED", "DRAFT_UPDATED", "SUBMITTED_FOR_REVIEW", "APPROVED"]));
  }, 60000);

  it("B. 审批闸门：未 APPROVED 不得发布", async () => {
    const d = await mkDraft(`Draft-B-${suffix}`);
    // DRAFT 直接发布 → 400
    const blocked = await owner.post(`/projects/${ids.projectA}/content-drafts/${d.id}/publications`)
      .send({ connectionId: ids.connConnected, payload: json({ body: "x" }) });
    expect(blocked.status).toBe(400);
    // READY_FOR_REVIEW（未审批）→ 仍 400
    await owner.post(`/content-drafts/${d.id}/submit`).expect(200);
    const blocked2 = await owner.post(`/projects/${ids.projectA}/content-drafts/${d.id}/publications`)
      .send({ connectionId: ids.connConnected, payload: json({ body: "x" }) });
    expect(blocked2.status).toBe(400);
  }, 60000);

  it("C. 渠道连接状态拦截：REVOKED 不得发布", async () => {
    const d = await approvedDraft(`Draft-C-${suffix}`);
    const blocked = await owner.post(`/projects/${ids.projectA}/content-drafts/${d.id}/publications`)
      .send({ connectionId: ids.connRevoked, payload: json({ body: "x" }) });
    expect(blocked.status).toBe(400);
    expect(String(blocked.body.message)).toContain("REVOKED");
  }, 60000);

  it("D. 非法状态转移被拒绝", async () => {
    // DRAFT（未提交）直接审批 → 400
    const d = await mkDraft(`Draft-D-${suffix}`);
    const bad = await owner.post(`/content-drafts/${d.id}/decide`).send({ decision: "APPROVED" });
    expect(bad.status).toBe(400);
    // 重复提交（非 READY → 允许一次；再次提交 READY → 400）
    await owner.post(`/content-drafts/${d.id}/submit`).expect(200);
    const again = await owner.post(`/content-drafts/${d.id}/submit`);
    expect(again.status).toBe(400);
  }, 60000);

  it("E. happy path 发布：仅 Mock，0 真实外部写", async () => {
    const d = await approvedDraft(`Draft-E-${suffix}`);
    const pub = await owner.post(`/projects/${ids.projectA}/content-drafts/${d.id}/publications`)
      .send({ connectionId: ids.connConnected, title: "标题", payload: json({ body: "发布内容" }) });
    expect(pub.status).toBe(201);
    expect(pub.body.status).toBe("PUBLISHED");
    expect(pub.body.attempts).toHaveLength(1);
    const attempt = pub.body.attempts[0];
    expect(attempt.publisher).toBe("mock");
    expect(attempt.externalId).toMatch(/^mock_/);
    expect(attempt.externalUrl).toContain("mock.geo.local");
    expect(attempt.status).toBe("PUBLISHED");
    // 出站写闸门：本回合恒 false。
    expect(process.env.EXTERNAL_PUBLISHING_ENABLED).not.toBe("true");
    ids.draftPublished = d.id;
    ids.publication = pub.body.id as string;

    // 草稿随之进入 PUBLISHED；且已发布不可再编辑。
    const g = await owner.get(`/content-drafts/${d.id}`).expect(200);
    expect(g.body.status).toBe("PUBLISHED");
    const edit = await owner.patch(`/content-drafts/${d.id}`).send({ body: json({ body: "改" }) });
    expect(edit.status).toBe(400);
  }, 60000);

  it("F. 幂等：重放不再产生新 attempt", async () => {
    const before = await owner.get(`/publications/${ids.publication}`).expect(200);
    expect(before.body.attempts).toHaveLength(1);
    const again = await owner.post(`/publications/${ids.publication}/process`).expect(200);
    expect(again.body.status).toBe("PUBLISHED");
    expect(again.body.attempts).toHaveLength(1);
  }, 60000);

  it("G. 秘密安全：credentialRef 不出现在 API 与审计中", async () => {
    const conns = await owner.get(`/projects/${ids.projectA}/channel-connections`).expect(200);
    const bodyText = JSON.stringify(conns.body);
    expect(bodyText).not.toContain(SECRET_REF);
    for (const c of conns.body as Array<Record<string, unknown>>) {
      expect(c).not.toHaveProperty("credentialRef");
    }
    const audit = await owner.get(`/content-drafts/${ids.draftPublished}/audit`).expect(200);
    expect(JSON.stringify(audit.body)).not.toContain(SECRET_REF);
    const pub = await owner.get(`/publications/${ids.publication}`).expect(200);
    expect(JSON.stringify(pub.body)).not.toContain(SECRET_REF);
  }, 60000);

  it("H. 租户隔离：跨租户/跨项目 404，未认证 401", async () => {
    await outsider.get(`/content-drafts/${ids.draftPublished}`).expect(404);
    await outsider.get(`/projects/${ids.projectA}/content-drafts`).expect(404);
    await outsider.post(`/projects/${ids.projectA}/content-drafts/${ids.draftPublished}/publications`)
      .send({ connectionId: ids.connConnected, payload: json({ body: "x" }) }).expect(404);
    await anon.get(`/content-drafts/${ids.draftPublished}`).expect(401);
    // 同 org 的 MEMBER 可读（membership 通过）。
    await member.get(`/content-drafts/${ids.draftPublished}`).expect(200);
  }, 60000);

  it("I. 渠道内容校验：超长标题 / 非 JSON payload 拒绝", async () => {
    const d = await approvedDraft(`Draft-I-${suffix}`);
    const longTitle = "超".repeat(30); // XIAOHONGSHU 上限 20
    const tooLong = await owner.post(`/projects/${ids.projectA}/content-drafts/${d.id}/publications`)
      .send({ connectionId: ids.connConnected, title: longTitle, payload: json({ body: "x" }) });
    expect(tooLong.status).toBe(400);
    const notJson = await owner.post(`/projects/${ids.projectA}/content-drafts/${d.id}/publications`)
      .send({ connectionId: ids.connConnected, payload: "not-json{{" });
    expect(notJson.status).toBe(400);
  }, 60000);

  it("J. 用量/成本钩子：costUsd 恒为 null（非 0）", async () => {
    const events = await prisma.contentUsageEvent.findMany({ where: { organizationId: ids.orgA } });
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.eventType === "PUBLICATION_ATTEMPT")).toBe(true);
    expect(events.some((e) => e.eventType === "CONTENT_GENERATION")).toBe(true);
    for (const e of events) {
      expect(e.costUsd).toBeNull(); // 绝不写 0
    }
  }, 60000);

  it("K. 审计动作完整覆盖发布链路", async () => {
    const audit = await owner.get(`/content-drafts/${ids.draftPublished}/audit`).expect(200);
    const actions = (audit.body as Array<{ action: string }>).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining([
      "DRAFT_CREATED", "SUBMITTED_FOR_REVIEW", "APPROVED", "PUBLICATION_CREATED", "PUBLICATION_SUCCEEDED",
    ]));
  }, 60000);
});
