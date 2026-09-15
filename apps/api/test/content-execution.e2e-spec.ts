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
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";

process.env.ENABLE_REAL_PROVIDERS = "false";
process.env.EXTERNAL_PUBLISHING_ENABLED = "false";
// DEV_ONLY 本地素材存储：落到独立临时目录，测试后清理（不污染仓库）。
const ASSET_DIR = mkdtempSync(join(tmpdir(), "m9-assets-"));
process.env.CONTENT_ASSET_STORAGE_DIR = ASSET_DIR;

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
    // 同 org、不同 project（跨 project 溯源拒绝用）。
    const pS = await prisma.project.create({ data: { organizationId: ids.orgA, name: `M9 S ${suffix}` } });
    ids.projectSameOrg = pS.id;

    // 来源溯源 fixtures：为各 project 建 opportunity 链（DiagnosisRun→RecommendationRun→OpportunityRun→Opportunity）。
    const mkOpportunity = async (projectId: string) => {
      const dr = await prisma.diagnosisRun.create({ data: { projectId, reportId: randomUUID(), diagnosisVersion: "test-v1" } });
      const rr = await prisma.recommendationRun.create({ data: { projectId, diagnosisRunId: dr.id, recommendationVersion: "test-v1" } });
      const cor = await prisma.contentOpportunityRun.create({ data: { projectId, recommendationRunId: rr.id, opportunityVersion: "test-v1" } });
      const op = await prisma.contentOpportunity.create({
        data: {
          opportunityRunId: cor.id, opportunityType: "ENTITY_OVERVIEW", titleDirection: "t",
          summary: "s", rationale: "r", priority: "HIGH", priorityScore: 80,
          contentIntent: "DISCOVERY", effortLevel: "LOW", expectedSignals: [],
        },
      });
      return { opportunityId: op.id, diagnosisId: dr.id };
    };
    const oppA = await mkOpportunity(ids.projectA);
    ids.oppA = oppA.opportunityId;
    ids.diagA = oppA.diagnosisId;
    ids.oppSameOrg = (await mkOpportunity(ids.projectSameOrg)).opportunityId;
    ids.oppB = (await mkOpportunity(ids.projectB)).opportunityId;

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
    } finally {
      try { rmSync(ASSET_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
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

  it("L. 渠道能力描述符（PHASE 17）：全部 mock / 不猜测真实 API", async () => {
    const res = await owner.get("/channels/capabilities").expect(200);
    const caps = res.body as Array<Record<string, unknown>>;
    expect(caps.length).toBeGreaterThanOrEqual(2);
    const xhs = caps.find((c) => c.channel === "XIAOHONGSHU");
    expect(xhs).toBeTruthy();
    expect(xhs!.publisher).toBe("mock");
    expect(xhs!.oauthImplemented).toBe(false);
    expect(xhs!.apiDetails).toBe("unverified");
    expect(caps.every((c) => c.publisher === "mock" && c.oauthImplemented === false)).toBe(true);
  }, 60000);

  it("M. 来源溯源：Opportunity/Diagnosis → Draft；跨 project/tenant 拒绝", async () => {
    // happy path：同 project 来源关联。
    const ok = await owner.post(`/projects/${ids.projectA}/content-drafts`).send({
      title: `Src-${suffix}`, body: json({ body: "x" }),
      sourceOpportunityId: ids.oppA, sourceDiagnosisId: ids.diagA,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.sourceOpportunityId).toBe(ids.oppA);
    expect(ok.body.sourceDiagnosisId).toBe(ids.diagA);
    expect(ok.body.sourceRecommendationId).toBeNull();

    // detail 同样返回来源。
    const detail = await owner.get(`/content-drafts/${ok.body.id}`).expect(200);
    expect(detail.body.sourceOpportunityId).toBe(ids.oppA);
    expect(detail.body.sourceDiagnosisId).toBe(ids.diagA);

    // 跨 project（同 org、不同 project）→ 404。
    const crossProject = await owner.post(`/projects/${ids.projectA}/content-drafts`).send({
      title: `SrcCP-${suffix}`, body: json({ body: "x" }), sourceOpportunityId: ids.oppSameOrg,
    });
    expect(crossProject.status).toBe(404);

    // 跨 tenant（orgB 的 opportunity）→ 404。
    const crossTenant = await owner.post(`/projects/${ids.projectA}/content-drafts`).send({
      title: `SrcCT-${suffix}`, body: json({ body: "x" }), sourceOpportunityId: ids.oppB,
    });
    expect(crossTenant.status).toBe(404);

    // 不存在的来源 → 404（绝不伪造关联）。
    const bogus = await owner.post(`/projects/${ids.projectA}/content-drafts`).send({
      title: `SrcBG-${suffix}`, body: json({ body: "x" }), sourceRecommendationId: randomUUID(),
    });
    expect(bogus.status).toBe(404);
  }, 60000);

  it("N. Revision 历史正文：多版本可读、历史不被覆盖、latest guard 保持", async () => {
    const d = await mkDraft(`Rev-${suffix}`, { body: "v1-body" });
    await owner.patch(`/content-drafts/${d.id}`).send({ body: json({ body: "v2-body" }) }).expect(200);
    await owner.patch(`/content-drafts/${d.id}`).send({ body: json({ body: "v3-body" }) }).expect(200);

    const detail = await owner.get(`/content-drafts/${d.id}`).expect(200);
    const revs = detail.body.revisions as Array<{ id: string; version: number; body: string; generationMode: string }>;
    expect(revs.length).toBe(3);
    const byV = new Map(revs.map((r) => [r.version, r.body]));
    expect(byV.get(1)).toContain("v1-body"); // 历史正文未被覆盖（immutable）
    expect(byV.get(2)).toContain("v2-body");
    expect(byV.get(3)).toContain("v3-body");

    // 单版本端点（Revision endpoint）。
    const v1 = revs.find((r) => r.version === 1)!;
    const single = await owner.get(`/content-drafts/${d.id}/revisions/${v1.id}`).expect(200);
    expect(single.body.version).toBe(1);
    expect(single.body.body).toContain("v1-body");
    // 不泄露 system prompt / api key / secret 字段。
    expect(JSON.stringify(single.body)).not.toMatch(/apiKey|api_key|systemPrompt|system_prompt|secret/i);

    // latest guard：提交后只能审批最新版本。
    await owner.post(`/content-drafts/${d.id}/submit`).expect(200);
    const bad = await owner.post(`/content-drafts/${d.id}/decide`).send({ decision: "APPROVED", revisionId: v1.id });
    expect(bad.status).toBe(400);
    const okDecide = await owner.post(`/content-drafts/${d.id}/decide`).send({ decision: "APPROVED" });
    expect(okDecide.status).toBe(200);
    expect(okDecide.body.status).toBe("APPROVED");

    // 跨 tenant 单版本不可读。
    await outsider.get(`/content-drafts/${d.id}/revisions/${v1.id}`).expect(404);
  }, 60000);

  it("O. 发布列表：分页 + status/channel 过滤 + 租户/项目隔离", async () => {
    const all = await owner.get(`/projects/${ids.projectA}/publications?page=1&pageSize=10`).expect(200);
    expect(all.body.page).toBe(1);
    expect(all.body.pageSize).toBe(10);
    expect(all.body.total).toBeGreaterThanOrEqual(1);
    const item = (all.body.items as Array<Record<string, unknown>>).find((x) => x.id === ids.publication)!;
    expect(item).toBeTruthy();
    expect(item.draftId).toBe(ids.draftPublished);
    expect(item.channel).toBe("XIAOHONGSHU");
    expect(item.status).toBe("PUBLISHED");
    expect(item.isMock).toBe(true); // 本轮恒 mock
    expect(item.publishedAt).toBeTruthy(); // 成功发布时刻
    expect(item.scheduledAt).toBeNull();
    expect(String(item.externalUrl)).toContain("mock.geo.local");
    expect((item.accountConnection as Record<string, unknown>).id).toBe(ids.connConnected);

    // status filter
    const okStatus = await owner.get(`/projects/${ids.projectA}/publications?status=PUBLISHED`).expect(200);
    expect((okStatus.body.items as Array<Record<string, unknown>>).every((x) => x.status === "PUBLISHED")).toBe(true);
    const emptyStatus = await owner.get(`/projects/${ids.projectA}/publications?status=FAILED`).expect(200);
    expect((emptyStatus.body.items as unknown[]).length).toBe(0);
    // channel filter
    const xhs = await owner.get(`/projects/${ids.projectA}/publications?channel=XIAOHONGSHU`).expect(200);
    expect((xhs.body.items as unknown[]).length).toBeGreaterThanOrEqual(1);
    const douyin = await owner.get(`/projects/${ids.projectA}/publications?channel=DOUYIN`).expect(200);
    expect((douyin.body.items as unknown[]).length).toBe(0);
    // pagination 边界
    const p1 = await owner.get(`/projects/${ids.projectA}/publications?page=1&pageSize=1`).expect(200);
    expect((p1.body.items as unknown[]).length).toBeLessThanOrEqual(1);

    // tenant / project isolation
    await outsider.get(`/projects/${ids.projectA}/publications`).expect(404);
    await anon.get(`/projects/${ids.projectA}/publications`).expect(401);
    const otherProject = await owner.get(`/projects/${ids.projectSameOrg}/publications`).expect(200);
    expect(otherProject.body.total).toBe(0);
  }, 60000);

  it("P. 素材上传：MIME allowlist / 大小上限 / checksum / 租户隔离（DEV_ONLY）", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const ok = await owner.post(`/projects/${ids.projectA}/content-assets`)
      .field("type", "IMAGE")
      .attach("file", png, { filename: "a.png", contentType: "image/png" });
    expect(ok.status).toBe(201);
    expect(ok.body.type).toBe("IMAGE");
    expect(ok.body.mimeType).toBe("image/png");
    expect(ok.body.sizeBytes).toBe(png.length);
    expect(ok.body.devOnly).toBe(true); // DEV_ONLY 明确标记
    expect(String(ok.body.storageRef)).toMatch(/^dev-local:\/\//);
    expect(ok.body.checksum).toBe(createHash("sha256").update(png).digest("hex"));

    // 非法 MIME → 400（未校验 MIME 一律拒绝）
    const badMime = await owner.post(`/projects/${ids.projectA}/content-assets`)
      .field("type", "IMAGE")
      .attach("file", Buffer.from("hello"), { filename: "a.txt", contentType: "text/plain" });
    expect(badMime.status).toBe(400);
    // 不支持的类型 → 400
    const badType = await owner.post(`/projects/${ids.projectA}/content-assets`)
      .field("type", "TEXT")
      .attach("file", Buffer.from("hello"), { filename: "a.txt", contentType: "text/plain" });
    expect(badType.status).toBe(400);
    // 超过大小上限 → 400（IMAGE 上限 10MB）
    const tooBig = await owner.post(`/projects/${ids.projectA}/content-assets`)
      .field("type", "IMAGE")
      .attach("file", Buffer.alloc(10 * 1024 * 1024 + 1), { filename: "big.png", contentType: "image/png" });
    expect(tooBig.status).toBe(400);

    // 跨 tenant 上传 → 404
    await outsider.post(`/projects/${ids.projectA}/content-assets`)
      .field("type", "IMAGE")
      .attach("file", png, { filename: "a.png", contentType: "image/png" })
      .expect(404);

    // 列表 + 项目隔离
    const list = await owner.get(`/projects/${ids.projectA}/content-assets`).expect(200);
    expect(list.body.total).toBeGreaterThanOrEqual(1);
    expect((list.body.items as Array<Record<string, unknown>>)[0]).toHaveProperty("checksum");
    const otherList = await owner.get(`/projects/${ids.projectSameOrg}/content-assets`).expect(200);
    expect(otherList.body.total).toBe(0);
  }, 120000);
});
