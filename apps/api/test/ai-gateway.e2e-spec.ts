import "../../../packages/database/scripts/test-env.cjs";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";

describe("AI Gateway & Security E2E", () => {
  let app: INestApplication;
  let http: any;

  const suffix = randomUUID().slice(0, 8);
  const password = "ai-gateway-pass";

  let orgAId: string;
  let userAId: string;
  let cookiesA: string[];

  let orgBId: string;
  let userBId: string;
  let cookiesB: string[];

  let projectAId: string;
  let projectBId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    http = app.getHttpServer();

    // 1. User A in Org A
    const regA = await request(http)
      .post("/auth/register")
      .send({ email: `a-${suffix}@ai.test`, name: "User A", password })
      .expect(201);
    orgAId = regA.body.organization.id;
    userAId = regA.body.user.id;

    const loginA = await request(http)
      .post("/auth/login")
      .send({ email: `a-${suffix}@ai.test`, password })
      .expect(200);
    cookiesA = loginA.headers["set-cookie"] as unknown as string[];

    // 2. User B in Org B (Attacker)
    const regB = await request(http)
      .post("/auth/register")
      .send({ email: `b-${suffix}@ai.test`, name: "User B", password })
      .expect(201);
    orgBId = regB.body.organization.id;
    userBId = regB.body.user.id;

    const loginB = await request(http)
      .post("/auth/login")
      .send({ email: `b-${suffix}@ai.test`, password })
      .expect(200);
    cookiesB = loginB.headers["set-cookie"] as unknown as string[];

    // 3. Projects
    const pA = await prisma.project.create({
      data: { organizationId: orgAId, name: `Project A ${suffix}` },
    });
    projectAId = pA.id;

    const pB = await prisma.project.create({
      data: { organizationId: orgBId, name: `Project B ${suffix}` },
    });
    projectBId = pB.id;
  });

  afterAll(async () => {
    await prisma.aiGeneration.deleteMany({
      where: { organizationId: { in: [orgAId, orgBId] } },
    }).catch(() => {});
    await prisma.project.deleteMany({
      where: { id: { in: [projectAId, projectBId] } },
    }).catch(() => {});
    await prisma.organizationMember.deleteMany({
      where: { organizationId: { in: [orgAId, orgBId] } },
    }).catch(() => {});
    await prisma.organization.deleteMany({
      where: { id: { in: [orgAId, orgBId] } },
    }).catch(() => {});
    await prisma.user.deleteMany({
      where: { id: { in: [userAId, userBId] } },
    }).catch(() => {});
    await app.close();
  });

  test("1. GET /ai/status: 返回 Provider 状态且绝不暴露 API Key 等任何 Secret", async () => {
    const res = await request(http)
      .get("/ai/status")
      .set("Cookie", cookiesA)
      .expect(200);

    expect(res.body).toHaveProperty("realProvidersEnabled");
    expect(res.body).toHaveProperty("providers");
    expect(Array.isArray(res.body.providers)).toBe(true);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("sk-");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("Authorization");

    const providers = res.body.providers.map((p: any) => p.provider);
    expect(providers).toContain("deepseek");
    expect(providers).toContain("qwen");
    expect(providers).toContain("mock");
  });

  test("2. 跨租户鉴权拦截：User B 试图操作 Project A 的 AI 接口应严格返回 404", async () => {
    const generationsBefore = await prisma.aiGeneration.count({
      where: { projectId: projectAId },
    });

    const res = await request(http)
      .post(`/projects/${projectAId}/ai/query-set`)
      .set("Cookie", cookiesB)
      .send({
        brandName: "AttackerBrand",
        category: "Malicious Category",
      });

    expect(res.status).toBe(404);

    // 关键安全断言：未授权请求必须是 ZERO API CALL 与 ZERO DB WRITE
    const generationsAfter = await prisma.aiGeneration.count({
      where: { projectId: projectAId },
    });
    expect(generationsAfter).toBe(generationsBefore);
  });

  test("3. 合法 AI 调用与 Provenance 审计入库：生成记录与 Token/耗时指标完整记录", async () => {
    const res = await request(http)
      .post(`/projects/${projectAId}/ai/query-set`)
      .set("Cookie", cookiesA)
      .send({
        brandName: "AcmeCloud",
        category: "企业级协作工具",
        queryCount: 5,
      })
      .expect(200);

    expect(res.body).toHaveProperty("provider");
    expect(res.body).toHaveProperty("model");
    expect(res.body).toHaveProperty("promptVersion");
    expect(res.body).toHaveProperty("generationId");
    expect(res.body).toHaveProperty("data");
    expect(res.body.data.queries.length).toBeGreaterThanOrEqual(3);

    // 检查数据库审计记录
    const auditRecord = await prisma.aiGeneration.findUnique({
      where: { id: res.body.generationId },
    });

    expect(auditRecord).toBeDefined();
    expect(auditRecord?.organizationId).toBe(orgAId);
    expect(auditRecord?.projectId).toBe(projectAId);
    expect(auditRecord?.userId).toBe(userAId);
    expect(auditRecord?.feature).toBe("query_set_generation");
    expect(auditRecord?.status).toBe("SUCCESS");
    expect(auditRecord?.inputTokens).toBeGreaterThan(0);
    expect(auditRecord?.outputTokens).toBeGreaterThan(0);
    expect(auditRecord?.totalTokens).toBeGreaterThan(0);
    expect(auditRecord?.latencyMs).toBeGreaterThanOrEqual(0);

    // 审计快照中不得含有 secret
    const auditStr = JSON.stringify(auditRecord);
    expect(auditStr).not.toContain("sk-");
  });

  test("4. GET /projects/:id/ai/generations: 可按项目查询 AI 生产历史", async () => {
    const res = await request(http)
      .get(`/projects/${projectAId}/ai/generations?limit=10`)
      .set("Cookie", cookiesA)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].projectId).toBe(projectAId);
    expect(res.body[0]).toHaveProperty("feature");
    expect(res.body[0]).toHaveProperty("latencyMs");
  });
});
