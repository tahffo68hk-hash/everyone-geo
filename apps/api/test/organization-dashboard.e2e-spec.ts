/**
 * 工作台 Dashboard project summary API contract（geo_test）。
 *
 * 回归背景：/app 工作台崩溃 —— Cannot read properties of undefined (reading 'length')。
 * 根因：GET /organizations/:id 的 projects include 未带上 brands relation，
 * Prisma 序列化后 project 对象整体缺失 brands key（undefined），
 * 前端 p.brands.length 直接崩溃。
 *
 * 本套件钉住修复后 contract：
 *   1) org 详情里无品牌项目必须返回 brands: []（key 存在、是数组、空）
 *   2) org 详情里有品牌项目必须返回 brands: [{ id, name }]（含 id 与 name）
 *   3) 混合列表（一个有品牌、一个没有）两行都是合法数组
 *   4) GET /projects/:id 同项目品牌数组一致性
 *   5) 越权/未登录依旧 404/401（不回归租户隔离）
 *
 * 全程 0 真实 Provider 调用，只走 HTTP + Prisma fixture。
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
process.env.DEEPSEEK_API_KEY = "";
process.env.QWEN_API_KEY = "";

describe("Dashboard org-detail project brands contract (e2e)", () => {
  let app: INestApplication;
  let owner: ReturnType<typeof request.agent>;
  let outsider: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const password = "dash-e2e-pass-123";
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    owner = request.agent(app.getHttpServer());
    outsider = request.agent(app.getHttpServer());

    const emailA = `dash-own-${suffix}@m8e.test.com`;
    const emailB = `dash-oth-${suffix}@m8e.test.com`;
    const regA = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: emailA, name: "Owner", password, organizationName: `Dash Org A ${suffix}` })
      .expect(201);
    const regB = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: emailB, name: "Other", password, organizationName: `Dash Org B ${suffix}` })
      .expect(201);
    ids.orgA = regA.body.organization.id;
    ids.orgB = regB.body.organization.id;

    await owner.post("/auth/login").send({ email: emailA, password }).expect(200);
    await outsider.post("/auth/login").send({ email: emailB, password }).expect(200);

    // Project 1：无品牌（legacy / 尚未设置监测对象 —— 合法状态）
    const pNoBrand = await prisma.project.create({
      data: { organizationId: ids.orgA, name: `Dash NoBrand ${suffix}` },
    });
    ids.projectNoBrand = pNoBrand.id;

    // Project 2：有一个品牌（监测对象已配置）
    const pBranded = await prisma.project.create({
      data: { organizationId: ids.orgA, name: `Dash Branded ${suffix}` },
    });
    ids.projectBranded = pBranded.id;
    await prisma.brand.create({
      data: { projectId: pBranded.id, name: "DashTarget", aliases: ["Dash Alias"] },
    });
  });

  afterAll(async () => {
    try {
      const orgIds = [ids.orgA, ids.orgB].filter(Boolean) as string[];
      if (orgIds.length) {
        await prisma.project.deleteMany({ where: { organizationId: { in: orgIds } } });
        const members = await prisma.organizationMember.findMany({ where: { organizationId: { in: orgIds } }, select: { userId: true } });
        const userIds = Array.from(new Set(members.map((m) => m.userId)));
        await prisma.organizationMember.deleteMany({ where: { organizationId: { in: orgIds } } });
        await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
        if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
      await prisma.engine.deleteMany({ where: { key: { contains: suffix } } });
    } catch (e) {
      console.error("organization-dashboard teardown error", e);
    } finally {
      await prisma.$disconnect();
      await app?.close();
    }
  });

  it("1. org 详情：无品牌项目返回 brands: []（key 存在且为空数组，绝不缺失/undefined）", async () => {
    const res = await owner.get(`/organizations/${ids.orgA}`).expect(200);
    const projects = res.body.projects as Array<{ id: string; name: string; brands?: unknown }>;
    expect(Array.isArray(projects)).toBe(true);

    const row = projects.find((p) => p.id === ids.projectNoBrand);
    expect(row).toBeDefined();
    expect(row!.brands).toBeDefined();
    expect(Array.isArray(row!.brands)).toBe(true);
    expect(row!.brands).toEqual([]);
  });

  it("2. org 详情：有品牌项目返回 brands: [{ id, name }]，工作台可展示 '品牌：xxx'", async () => {
    const res = await owner.get(`/organizations/${ids.orgA}`).expect(200);
    const projects = res.body.projects as Array<{ id: string; name: string; brands?: Array<{ id: string; name: string }> }>;
    const row = projects.find((p) => p.id === ids.projectBranded);
    expect(row).toBeDefined();
    expect(Array.isArray(row!.brands)).toBe(true);
    expect(row!.brands!.length).toBe(1);
    expect(row!.brands![0].name).toBe("DashTarget");
    expect(typeof row!.brands![0].id).toBe("string");
  });

  it("3. 混合列表：每个 project 行的 brands 都是数组（一个有品牌、一个没有），全量契约不变量", async () => {
    const res = await owner.get(`/organizations/${ids.orgA}`).expect(200);
    const projects = res.body.projects as Array<{ id: string; name: string; brands?: unknown }>;
    expect(projects.length).toBeGreaterThanOrEqual(2);
    for (const p of projects) {
      expect(Array.isArray(p.brands)).toBe(true);
    }
    const idsSet = new Set(projects.map((p) => p.id));
    expect(idsSet.has(ids.projectNoBrand)).toBe(true);
    expect(idsSet.has(ids.projectBranded)).toBe(true);
  });

  it("4. GET /projects/:id 与 org 详情品牌一致性（brandless → []，branded → 1）", async () => {
    const noBrand = await owner.get(`/projects/${ids.projectNoBrand}`).expect(200);
    expect(noBrand.body.brands).toEqual([]);

    const branded = await owner.get(`/projects/${ids.projectBranded}`).expect(200);
    expect(Array.isArray(branded.body.brands)).toBe(true);
    expect(branded.body.brands).toHaveLength(1);
    expect(branded.body.brands[0].name).toBe("DashTarget");
  });

  it("5. 租户隔离不回归：他人 org 详情 404、未登录 401", async () => {
    await outsider.get(`/organizations/${ids.orgA}`).expect(404);
    await request(app.getHttpServer()).get(`/organizations/${ids.orgA}`).expect(401);
  });
});
