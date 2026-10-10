import "../../../packages/database/scripts/test-env.cjs";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";
import { validateCapabilityOutput } from "../src/ai/contracts";

describe("AI Brand Resolution & Video Script E2E", () => {
  let app: INestApplication;
  let http: any;

  const suffix = randomUUID().slice(0, 8);
  const password = "ai-test-pass-123";

  let orgId: string;
  let userId: string;
  let cookies: string[];
  let projectId: string;

  let outsiderOrgId: string;
  let outsiderCookies: string[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    http = app.getHttpServer();

    // 1. Owner account
    const reg = await request(http)
      .post("/auth/register")
      .send({ email: `brand-owner-${suffix}@geo.test`, name: "Brand Owner", password })
      .expect(201);
    orgId = reg.body.organization.id;
    userId = reg.body.user.id;

    const login = await request(http)
      .post("/auth/login")
      .send({ email: `brand-owner-${suffix}@geo.test`, password })
      .expect(200);
    cookies = login.headers["set-cookie"] as unknown as string[];

    const p = await prisma.project.create({
      data: { organizationId: orgId, name: `Brand Project ${suffix}` },
    });
    projectId = p.id;

    // 2. Outsider account
    const regOutsider = await request(http)
      .post("/auth/register")
      .send({ email: `brand-outsider-${suffix}@geo.test`, name: "Outsider", password })
      .expect(201);
    outsiderOrgId = regOutsider.body.organization.id;

    const loginOutsider = await request(http)
      .post("/auth/login")
      .send({ email: `brand-outsider-${suffix}@geo.test`, password })
      .expect(200);
    outsiderCookies = loginOutsider.headers["set-cookie"] as unknown as string[];
  });

  afterAll(async () => {
    await prisma.aiGeneration.deleteMany({ where: { projectId } }).catch(() => {});
    await prisma.brand.deleteMany({ where: { projectId } }).catch(() => {});
    await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => {});
    await prisma.organizationMember.deleteMany({ where: { organizationId: { in: [orgId, outsiderOrgId] } } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: { in: [orgId, outsiderOrgId] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { contains: suffix } } }).catch(() => {});
    await app.close();
  });

  // ============================================================
  // 1. AI 品牌智能解析 (Brand Resolution)
  // ============================================================

  test("1.1 品牌解析接通与结构化 Schema 验证", async () => {
    const res = await request(http)
      .post(`/projects/${projectId}/ai/resolve-brand`)
      .set("Cookie", cookies)
      .send({ brandName: "元气森林" })
      .expect(200);

    expect(res.body.data).toBeDefined();

    const d = res.body.data;
    expect(d.brandName).toBe("元气森林");
    expect(d.fullName).toBeDefined();
    expect(d.industry).toBeDefined();
    expect(Array.isArray(d.aliases)).toBe(true);
    expect(d.aliases.length).toBeGreaterThan(0);
    expect(Array.isArray(d.competitors)).toBe(true);
    expect(d.competitors.length).toBeGreaterThan(0);
    expect(Array.isArray(d.discoveryQueries)).toBe(true);
    expect(d.discoveryQueries.length).toBeGreaterThan(0);

    // 严格契约校验
    const validation = validateCapabilityOutput("brand_resolution", d);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  test("1.2 Discovery Query 严格遵循非品牌词污染规则", async () => {
    const brandName = "小米";
    const res = await request(http)
      .post(`/projects/${projectId}/ai/resolve-brand`)
      .set("Cookie", cookies)
      .send({ brandName })
      .expect(200);

    const d = res.body.data;
    // 检查所有生成的 Discovery Queries，绝不夹带主品牌词
    for (const q of d.discoveryQueries) {
      expect(q.text).not.toContain(brandName);
      expect(q.category).toBeDefined();
      expect(q.intent).toBeDefined();
    }
  });

  test("1.3 AI 解析结果为候选态，绝不未经确认自动覆盖真实目标数据", async () => {
    // 1. 先验证当前数据库中不存在 targetProfile / Brand
    const profileBefore = await request(http)
      .get(`/projects/${projectId}/target-profile`)
      .set("Cookie", cookies)
      .expect(200);
    expect(profileBefore.body?.canonicalName || "").toBe("");

    // 2. 调用 AI 解析
    const resolveRes = await request(http)
      .post(`/projects/${projectId}/ai/resolve-brand`)
      .set("Cookie", cookies)
      .send({ brandName: "理想汽车" })
      .expect(200);
    expect(resolveRes.body.data.brandName).toBe("理想汽车");

    // 3. 再次查询 target-profile，证明数据库依然未被静默覆盖
    const profileAfterAi = await request(http)
      .get(`/projects/${projectId}/target-profile`)
      .set("Cookie", cookies)
      .expect(200);
    expect(profileAfterAi.body?.canonicalName || "").toBe("");

    // 4. 模拟用户人工审核后，显式保存确认数据
    const aiData = resolveRes.body.data;
    const saveRes = await request(http)
      .put(`/projects/${projectId}/target-profile`)
      .set("Cookie", cookies)
      .send({
        canonicalName: aiData.brandName,
        entityType: "BRAND",
        productCategory: aiData.industry,
        description: `${aiData.fullName}，主营：${aiData.industry}`,
      })
      .expect(200);
    expect(saveRes.body.canonicalName).toBe("理想汽车");
    expect(saveRes.body.brandId).toBeDefined();

    // 5. 模拟用户一键采纳 AI 建议别名（挑选非主品牌名的别名）
    const aliasToAdd = aiData.aliases?.find((a: string) => a !== aiData.brandName) || `${aiData.brandName}科技`;
    const aliasRes = await request(http)
      .post(`/projects/${projectId}/target-aliases`)
      .set("Cookie", cookies)
      .send({ alias: aliasToAdd, aliasType: "CUSTOM" })
      .expect(201);
    expect(aliasRes.body.aliases.some((a: any) => a.alias === aliasToAdd)).toBe(true);
  });

  test("1.4 错误处理与非法输入校验", async () => {
    // 缺少 brandName
    const res = await request(http)
      .post(`/projects/${projectId}/ai/resolve-brand`)
      .set("Cookie", cookies)
      .send({})
      .expect(400);
    expect(res.body.message).toBeDefined();

    // 空字符串 brandName
    await request(http)
      .post(`/projects/${projectId}/ai/resolve-brand`)
      .set("Cookie", cookies)
      .send({ brandName: "" })
      .expect(400);
  });

  test("1.5 跨租户隔离拦截", async () => {
    await request(http)
      .post(`/projects/${projectId}/ai/resolve-brand`)
      .set("Cookie", outsiderCookies)
      .send({ brandName: "华为" })
      .expect(404);
  });

  // ============================================================
  // 2. 视频脚本生成 AI (Video Script Generation)
  // ============================================================

  test("2.1 视频脚本生成及分镜契约验证", async () => {
    const res = await request(http)
      .post(`/projects/${projectId}/ai/video-script`)
      .set("Cookie", cookies)
      .send({
        topic: "2026年企业如何做好GEO优化？",
        brandName: "GeoLens",
        platform: "DOUYIN",
        targetDurationSeconds: 60,
      })
      .expect(200);

    expect(res.body.data).toBeDefined();

    const d = res.body.data;
    expect(d.title).toBeDefined();
    expect(d.hook).toBeDefined();
    expect(Array.isArray(d.scenes)).toBe(true);
    expect(d.scenes.length).toBeGreaterThan(0);
    expect(d.scenes[0].sceneNumber).toBe(1);
    expect(d.scenes[0].visual).toBeDefined();
    expect(d.scenes[0].narration).toBeDefined();
    expect(typeof d.scenes[0].durationSeconds).toBe("number");
    expect(d.callToAction).toBeDefined();
    expect(Array.isArray(d.tags)).toBe(true);

    // 契约验证
    const validation = validateCapabilityOutput("video_script", d);
    expect(validation.valid).toBe(true);
  });
});
