/**
 * GeoLens M3 - Authentication + Organization Tenant Access 端到端测试
 * 覆盖：
 *   1) register 成功(201+cookie+默认组织)
 *   2) register 重复邮箱 409
 *   3) register 弱密码 400
 *   4) login 成功(200+Set-Cookie)
 *   5) login 密码错误 401
 *   6) me 认证通过 200
 *   7) me 未登录 401
 *   8) logout 后 me 401
 *   9) organizations 列表仅含自己的组织
 *  10) organizations/:id 本组织 200 / 他人组织 404（不泄露存在性）
 *  11) projects/:id 本组织 200 / 他人项目 404（IDOR 阻断）/ 未登录 401
 *  12) organizations 未登录 401
 *  13) JWT sub 与 me.user.id 一致
 *
 * 说明：测试直连本地开发 DB（与 seed 共存，注册使用随机邮箱避免冲突）。
 */
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import path from "path";
import request from "supertest";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";
import { AUTH_COOKIE_NAME } from "../src/config/env";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

const RAND = Math.random().toString(36).slice(2, 10);
const EMAIL_A = `a-${RAND}@m3.test`;
const EMAIL_B = `b-${RAND}@m3.test`;
const PASSWORD = "Password123!";

let app: INestApplication;
let orgA: string;
let orgB: string;
let projectA: string;

async function bootApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const a = moduleRef.createNestApplication();
  a.use(cookieParser());
  a.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await a.init();
  return a;
}

function tokenFrom(res: request.Response): string {
  const setCookie = res.headers["set-cookie"] as unknown as string[] | undefined;
  const line = (setCookie ?? []).find(
    (c) => c.startsWith(`${AUTH_COOKIE_NAME}=`),
  );
  if (!line) throw new Error("响应未包含认证 Cookie");
  return line.split(";")[0].split("=")[1];
}

describe("M3 Auth + Tenant Access (e2e)", () => {
  beforeAll(async () => {
    app = await bootApp();

    const regA = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ name: "Alice M3", email: EMAIL_A, password: PASSWORD, organizationName: `Org A ${RAND}` })
      .expect(201);
    orgA = regA.body.organization.id;

    const regB = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ name: "Bob M3", email: EMAIL_B, password: PASSWORD, organizationName: `Org B ${RAND}` })
      .expect(201);
    orgB = regB.body.organization.id;

    // 为两个组织各建一个项目，用于租户隔离/IDOR 验证
    const pa = await prisma.project.create({
      data: { organizationId: orgA, name: `M3 Project A ${RAND}` },
    });
    await prisma.project.create({
      data: { organizationId: orgB, name: `M3 Project B ${RAND}` },
    });
    projectA = pa.id;
  });

  afterAll(async () => {
    if (projectA) await prisma.project.deleteMany({ where: { id: projectA } });
    await prisma.$disconnect();
    await app?.close();
  });

  describe("register", () => {
    it("01 注册成功：201 + 认证 Cookie + 自动创建默认组织", async () => {
      const email = `c-${RAND}@m3.test`;
      const orgName = `Carol C ${RAND}`;
      const res = await request(app.getHttpServer())
        .post("/auth/register")
        .send({ name: "Carol", email, password: PASSWORD, organizationName: orgName })
        .expect(201);
      expect(res.body.user.email).toBe(email);
      expect(res.body.organization).toBeDefined();
      expect(res.body.organization.slug).toBe(`carol-c-${RAND}`);
      expect((res.headers["set-cookie"] as unknown as string[]).join()).toContain(
        `${AUTH_COOKIE_NAME}=`,
      );
    });

    it("02 重复邮箱注册返回 409", async () => {
      await request(app.getHttpServer())
        .post("/auth/register")
        .send({ name: "Dup", email: EMAIL_A, password: PASSWORD })
        .expect(409);
    });

    it("03 弱密码返回 400（校验不通过）", async () => {
      await request(app.getHttpServer())
        .post("/auth/register")
        .send({ name: "Weak", email: `weak-${RAND}@m3.test`, password: "123" })
        .expect(400);
    });
  });

  describe("login / session", () => {
    it("04 登录成功：200 + Set-Cookie", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: EMAIL_A, password: PASSWORD })
        .expect(200);
      expect(res.body.user.email).toBe(EMAIL_A);
      expect((res.headers["set-cookie"] as unknown as string[]).join()).toContain(
        `${AUTH_COOKIE_NAME}=`,
      );
    });

    it("05 密码错误返回 401", async () => {
      await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: EMAIL_A, password: "WrongPass999" })
        .expect(401);
    });

    it("06 携带 Cookie 访问 /auth/me 返回当前用户", async () => {
      const agent = request.agent(app.getHttpServer());
      await agent.post("/auth/login").send({ email: EMAIL_A, password: PASSWORD }).expect(200);
      const res = await agent.get("/auth/me").expect(200);
      expect(res.body.user.email).toBe(EMAIL_A);
      expect(Array.isArray(res.body.organizations)).toBe(true);
    });

    it("07 未登录访问 /auth/me 返回 401", async () => {
      await request(app.getHttpServer()).get("/auth/me").expect(401);
    });

    it("08 logout 清空会话（Cookie 再访问 me 401）", async () => {
      const agent = request.agent(app.getHttpServer());
      await agent.post("/auth/login").send({ email: EMAIL_A, password: PASSWORD }).expect(200);
      await agent.post("/auth/logout").expect(200);
      await agent.get("/auth/me").expect(401);
    });
  });

  describe("organization / project tenant isolation", () => {
    it("09 organizations 仅返回当前用户所属组织", async () => {
      const agent = request.agent(app.getHttpServer());
      await agent.post("/auth/login").send({ email: EMAIL_A, password: PASSWORD }).expect(200);
      const res = await agent.get("/organizations").expect(200);
      const ids = res.body.map((o: { id: string }) => o.id);
      expect(ids).toContain(orgA);
      expect(ids).not.toContain(orgB);
    });

    it("10 本组织可访问，他人组织一律 404", async () => {
      const agentA = request.agent(app.getHttpServer());
      const agentB = request.agent(app.getHttpServer());
      await agentA.post("/auth/login").send({ email: EMAIL_A, password: PASSWORD }).expect(200);
      await agentB.post("/auth/login").send({ email: EMAIL_B, password: PASSWORD }).expect(200);

      await agentA.get(`/organizations/${orgA}`).expect(200);
      await agentB.get(`/organizations/${orgB}`).expect(200);
      await agentB.get(`/organizations/${orgA}`).expect(404);
    });

    it("11 项目 IDOR 阻断：本组织 200 / 他人项目 404 / 未登录 401", async () => {
      const agentB = request.agent(app.getHttpServer());
      await agentB.post("/auth/login").send({ email: EMAIL_B, password: PASSWORD }).expect(200);

      const agentA = request.agent(app.getHttpServer());
      await agentA.post("/auth/login").send({ email: EMAIL_A, password: PASSWORD }).expect(200);
      const self = await agentA.get(`/projects/${projectA}`).expect(200);
      expect(self.body.name).toContain("M3 Project A");

      await agentB.get(`/projects/${projectA}`).expect(404);
      await request(app.getHttpServer()).get(`/projects/${projectA}`).expect(401);
    });

    it("12 未登录访问 organizations 返回 401", async () => {
      await request(app.getHttpServer()).get("/organizations").expect(401);
    });
  });

  describe("token integrity", () => {
    it("13 JWT payload.sub 与 /auth/me 返回的 user.id 一致", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: EMAIL_A, password: PASSWORD })
        .expect(200);
      const token = tokenFrom(res);
      const payloadJson = Buffer.from(token.split(".")[1], "base64url").toString("utf-8");
      const { sub } = JSON.parse(payloadJson) as { sub: string };

      const agent = request.agent(app.getHttpServer());
      await agent.post("/auth/login").send({ email: EMAIL_A, password: PASSWORD }).expect(200);
      const me = await agent.get("/auth/me").expect(200);
      expect(sub).toBe(me.body.user.id);
    });
  });
});
