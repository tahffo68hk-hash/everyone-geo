/**
 * General Project Onboarding e2e（geo_test）。
 *
 * 目标：普通用户不依赖 seed，能通过正式 API 从 0 创建任意品牌/产品的监测项目。
 * 1) POST /organizations/:id/projects 建项目（Auth+tenant；同名 409；无默认 Brand）
 * 2) 无 Target 是合法状态（target-profile brandId=null）
 * 3) 复用 M8E target API：AcmeFlow / CRM SaaS / 别名
 * 4) 复用 Query Set：DISCOVERY + BRANDED_SANITY + 空问题集（稍后创建）
 * 5) Target contamination guard：DISCOVERY 含目标 → 400；BRANDED_SANITY → 通过
 * 6) 双项目（AcmeFlow CRM + CleanBot 洗地机）数据隔离；跨 tenant 404
 * 7) org 详情返回工作台卡片所需摘要（brands/productCategory/suite 数/最近 run）
 *
 * 全程 0 真实 Provider 调用（只做 create/configure，不触发 Run）。
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

describe("General Project Onboarding (e2e)", () => {
  let app: INestApplication;
  let alice: ReturnType<typeof request.agent>;
  let bob: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const password = "onboard-e2e-pass-123";
  const ids: Record<string, string> = {};

  const projectPayload = (name: string) => ({
    name: `${name} ${suffix}`,
    description: `GEO 监测项目（通用 onboarding e2e）：${name}`,
    industry: "SaaS",
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    alice = request.agent(app.getHttpServer());
    bob = request.agent(app.getHttpServer());

    const emailA = `onb-a-${suffix}@m8e.test.com`;
    const emailB = `onb-b-${suffix}@m8e.test.com`;
    const regA = await request(app.getHttpServer()).post("/auth/register").send({
      email: emailA, name: "Alice", password, organizationName: `Onb Org A ${suffix}`,
    }).expect(201);
    const regB = await request(app.getHttpServer()).post("/auth/register").send({
      email: emailB, name: "Bob", password, organizationName: `Onb Org B ${suffix}`,
    }).expect(201);
    ids.orgA = regA.body.organization.id;
    ids.orgB = regB.body.organization.id;
    await alice.post("/auth/login").send({ email: emailA, password }).expect(200);
    await bob.post("/auth/login").send({ email: emailB, password }).expect(200);
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
      console.error("project-onboarding teardown error", e);
    } finally {
      await prisma.$disconnect();
      await app?.close();
    }
  });

  it("1. 创建通用项目：本组织 201；同组织同名 409；他人组织 404；未登录 401", async () => {
    const p = projectPayload("AcmeFlow");
    const created = await alice.post(`/organizations/${ids.orgA}/projects`).send(p).expect(201);
    expect(created.body.id).toBeDefined();
    expect(created.body.name).toBe(p.name);
    expect(created.body.organizationId).toBe(ids.orgA);
    ids.acmeProject = created.body.id;

    // 同名冲突 → 409
    await alice.post(`/organizations/${ids.orgA}/projects`).send(p).expect(409);
    // 他人组织 → 404（不泄露存在性）
    await alice.post(`/organizations/${ids.orgB}/projects`).send(projectPayload("X")).expect(404);
    // 未登录 → 401
    await request(app.getHttpServer()).post(`/organizations/${ids.orgA}/projects`).send(projectPayload("Y")).expect(401);
    // DTO：缺 name → 400
    await alice.post(`/organizations/${ids.orgA}/projects`).send({ description: "no-name" }).expect(400);
  });

  it("2. 新项目无 Target（合法状态）→ PUT target-profile 设置 AcmeFlow/CRM SaaS + 别名", async () => {
    const before = await alice.get(`/projects/${ids.acmeProject}/target-profile`).expect(200);
    expect(before.body?.brandId ?? null).toBeNull();
    expect(before.body?.canonicalName ?? "").toBe("");

    const up = await alice.put(`/projects/${ids.acmeProject}/target-profile`).send({
      canonicalName: "AcmeFlow", entityType: "PRODUCT", productCategory: "CRM SaaS",
      website: "https://acmeflow.example.com", description: "通用 CRM SaaS（e2e）",
    }).expect(200);
    expect(up.body.canonicalName).toBe("AcmeFlow");
    expect(up.body.productCategory).toBe("CRM SaaS");
    expect(up.body.entityType).toBe("PRODUCT");
    ids.acmeBrandId = up.body.brandId;

    await alice.post(`/projects/${ids.acmeProject}/target-aliases`)
      .send({ alias: "Acme Flow", aliasType: "OFFICIAL" }).expect(201);
    await alice.post(`/projects/${ids.acmeProject}/target-aliases`)
      .send({ alias: "AcmeFlow CRM", aliasType: "PRODUCT" }).expect(201);
    const after = await alice.get(`/projects/${ids.acmeProject}/target-profile`).expect(200);
    const enabled = (after.body.aliases as Array<{ alias: string; enabled: boolean }>)
      .filter(a => a.enabled).map(a => a.alias);
    expect(enabled).toContain("Acme Flow");
    expect(enabled).toContain("AcmeFlow CRM");
  });

  it("3. 空问题集可创建（稍后创建路径）；DISCOVERY 可创建；含目标 DISCOVERY 400 / BRANDED_SANITY 通过", async () => {
    // 空 suite：省略 queries
    const empty = await alice.post(`/projects/${ids.acmeProject}/benchmark-suites`)
      .send({ name: "AcmeFlow 稍后补问题", version: "1" }).expect(201);
    expect(empty.body.queryCount ?? 0).toBe(0);
    ids.emptySuite = empty.body.id;

    // DISCOVERY（不含品牌）
    const suite = await alice.post(`/projects/${ids.acmeProject}/benchmark-suites`).send({
      name: "AcmeFlow 默认问题集", version: "1",
      queries: [
        { queryText: "适合小型销售团队的 CRM 有哪些？", category: "tool-discovery", intent: "选型发现", queryType: "DISCOVERY", source: "MANUAL" },
        { queryText: "初创企业应该使用什么客户管理软件？", category: "recommendation", intent: "推荐", queryType: "DISCOVERY", source: "MANUAL" },
      ],
    }).expect(201);
    expect(suite.body.queryCount).toBe(2);
    ids.acmeSuite = suite.body.id;

    // 含目标 DISCOVERY → 400（contamination guard）
    await alice.post(`/projects/${ids.acmeProject}/benchmark-suites`).send({
      name: "AcmeFlow 污染批次", version: "1",
      queries: [
        { queryText: "AcmeFlow 有哪些功能？", category: "tool-discovery", intent: "测试", queryType: "DISCOVERY" },
      ],
    }).expect(400);

    // 同一句作为 BRANDED_SANITY（品牌认知测试）→ 通过
    const sanity = await alice.post(`/projects/${ids.acmeProject}/benchmark-suites`).send({
      name: "AcmeFlow 品牌认知", version: "1",
      queries: [
        { queryText: "AcmeFlow 有哪些功能？", category: "sanity-control", intent: "品牌认知", queryType: "BRANDED_SANITY" },
      ],
    }).expect(201);
    expect(sanity.body.sanityQueryCount).toBe(1);
  });

  it("4. 第二个通用项目（CleanBot 洗地机）完全独立：同一套代码、无 ProjectMentor 分支", async () => {
    const p = projectPayload("CleanBot");
    const created = await alice.post(`/organizations/${ids.orgA}/projects`).send({ ...p, industry: "家电" }).expect(201);
    ids.cleanProject = created.body.id;

    await alice.put(`/projects/${ids.cleanProject}/target-profile`).send({
      canonicalName: "CleanBot", entityType: "BRAND", productCategory: "洗地机",
    }).expect(200);

    const suite = await alice.post(`/projects/${ids.cleanProject}/benchmark-suites`).send({
      name: "CleanBot 默认问题集", version: "1",
      queries: [
        { queryText: "家用洗地机哪个品牌比较好？", category: "comparison", intent: "对比", queryType: "DISCOVERY" },
        { queryText: "适合有宠物家庭的洗地机有哪些？", category: "tool-discovery", intent: "发现", queryType: "DISCOVERY" },
      ],
    }).expect(201);
    expect(suite.body.queryCount).toBe(2);
    ids.cleanSuite = suite.body.id;
  });

  it("5. 项目间数据隔离：AcmeFlow 看不到 CleanBot 的问题集，反之亦然", async () => {
    const acmeSuites = await alice.get(`/projects/${ids.acmeProject}/benchmark-suites`).expect(200);
    const cleanSuites = await alice.get(`/projects/${ids.cleanProject}/benchmark-suites`).expect(200);
    const acmeIds = new Set((acmeSuites.body as Array<{ id: string }>).map(s => s.id));
    const cleanIds = new Set((cleanSuites.body as Array<{ id: string }>).map(s => s.id));
    expect(acmeIds.has(ids.cleanSuite)).toBe(false);
    expect(cleanIds.has(ids.acmeSuite)).toBe(false);
    expect(acmeIds.has(ids.emptySuite)).toBe(true);

    const acmeDetail = await alice.get(`/benchmark-suites/${ids.acmeSuite}`).expect(200);
    const texts = (acmeDetail.body.queries as Array<{ queryText: string }>).map(q => q.queryText);
    expect(texts.some(t => t.includes("洗地机"))).toBe(false);
    expect(texts.some(t => t.includes("CRM"))).toBe(true);
  });

  it("6. org 详情返回工作台卡片摘要（brands 含产品类别、suite 数、最近 run 形如空）", async () => {
    const detail = await alice.get(`/organizations/${ids.orgA}`).expect(200);
    const projects = detail.body.projects as Array<{
      id: string; brands: Array<{ name: string; productCategory: string | null }>;
      _count: { benchmarkSuites: number }; benchmarkRuns: Array<unknown>;
    }>;
    const acme = projects.find((x) => x.id === ids.acmeProject)!;
    expect(acme.brands[0].name).toBe("AcmeFlow");
    expect(acme.brands[0].productCategory).toBe("CRM SaaS");
    expect(acme._count.benchmarkSuites).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(acme.benchmarkRuns)).toBe(true);

    const clean = projects.find((x) => x.id === ids.cleanProject)!;
    expect(clean.brands[0].name).toBe("CleanBot");
    expect(clean.brands[0].productCategory).toBe("洗地机");
  });

  it("7. 跨租户隔离：Bob 无法读 Alice 的新项目（404），列表互相不可见", async () => {
    await bob.get(`/projects/${ids.acmeProject}`).expect(404);
    await bob.get(`/projects/${ids.acmeProject}/benchmark-suites`).expect(404);
    await bob.get(`/organizations/${ids.orgA}`).expect(404);

    const bobOptions = await bob.get("/monitor-tasks/options").expect(200);
    const bobIds = new Set((bobOptions.body.projects as Array<{ id: string }>).map(p => p.id));
    expect(bobIds.has(ids.acmeProject)).toBe(false);
    expect(bobIds.has(ids.cleanProject)).toBe(false);
  });
});
