/**
 * M3 Monitor Tasks API e2e（真实 PostgreSQL geo_test + 真实 Redis）。
 * 硬保护：jest-e2e.json setupFiles 已加载 packages/database/scripts/test-env.cjs，
 * 强制 DATABASE_URL 指向 geo_test，否则整套测试拒绝启动。
 *
 * 覆盖：
 *   - 认证（401：无 Cookie 访问 options / create / get）
 *   - GET /monitor-tasks/options（Project + Queries + Mock Engines）
 *   - POST /monitor-tasks：5 Query × 3 Engine = 15 Runs，202 立即返回
 *   - GET /monitor-tasks/:id：totalRuns / runs / progress / timestamps
 *   - 多租户权限隔离：跨组织 project → 404；跨组织 task → 404（不泄露存在性）
 *   - DTO 校验：空 queryIds → 400；engine 不存在 → 400
 */
import "../../../packages/database/scripts/test-env.cjs";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";

describe("MonitorTasks (M3 e2e)", () => {
  let app: INestApplication;
  let http: ReturnType<typeof app.getHttpServer>;

  const suffix = randomUUID().slice(0, 8);
  const emailA = `mt-a-${suffix}@m3e2e.test.com`;
  const emailB = `mt-b-${suffix}@m3e2e.test.com`;
  const password = "m3-e2e-pass-123";

  const ids = {
    orgA: "", orgB: "", projectA: "", projectB: "",
    queries: [] as string[], engines: [] as string[], taskA: "",
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    http = app.getHttpServer();

    // fixture 数据直接落库（Engine/Project/Query 无 API 写入端点）
    const register = async (email: string) => {
      const res = await request(http).post("/auth/register").send({ email, name: "MT User", password });
      expect(res.status).toBe(201);
      return res.body as { user: { id: string }; organization: { id: string } };
    };
    const a = await register(emailA);
    const b = await register(emailB);
    ids.orgA = a.organization.id;
    ids.orgB = b.organization.id;

    const projectA = await prisma.project.create({ data: { organizationId: ids.orgA, name: `MT Project A ${suffix}` } });
    const projectB = await prisma.project.create({ data: { organizationId: ids.orgB, name: `MT Project B ${suffix}` } });
    ids.projectA = projectA.id;
    ids.projectB = projectB.id;
    for (let i = 0; i < 5; i++) {
      const q = await prisma.query.create({ data: { projectId: projectA.id, text: `MT query ${i} ${suffix}` } });
      ids.queries.push(q.id);
    }
    for (let i = 0; i < 3; i++) {
      const e = await prisma.engine.create({ data: { key: `mock-e2e-${i}-${suffix}`, name: `Mock E2E ${i}`, provider: "mock", config: { delayMs: 20 } } });
      ids.engines.push(e.id);
    }
  });

  afterAll(async () => {
    if (!ids.orgA) return; // beforeAll 失败时无数据可清
    try {
      // 依赖逆序清理（Run 随 MonitorTask 级联删除，解除 Engine/Query 引用）
      await prisma.monitorTask.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
      await prisma.engine.deleteMany({ where: { id: { in: ids.engines } } });
      await prisma.project.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
      await prisma.organizationMember.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
      await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } });
      await prisma.user.deleteMany({ where: { email: { contains: "@m3e2e.test.com" } } });
    } finally {
      await app.close(); // 触发 MonitorTasksService.onModuleDestroy（Queue close）
      await prisma.$disconnect();
    }
  });

  it("未认证访问 options / create / get → 401", async () => {
    await request(http).get("/monitor-tasks/options").expect(401);
    await request(http).post("/monitor-tasks").send({ projectId: ids.projectA, queryIds: ids.queries, engineIds: ids.engines }).expect(401);
    await request(http).get(`/monitor-tasks/${randomUUID()}`).expect(401);
  });

  it("options：返回本项目 ACTIVE queries 与 enabled mock engines", async () => {
    const agent = request.agent(http);
    const login = await agent.post("/auth/login").send({ email: emailA, password });
    expect(login.status).toBe(200);

    const res = await agent.get("/monitor-tasks/options").expect(200);
    const project = (res.body.projects as Array<{ id: string; queries: unknown[] }>).find(p => p.id === ids.projectA);
    expect(project).toBeDefined();
    expect(project!.queries).toHaveLength(5);
    expect((res.body.engines as Array<{ id: string }>).map(e => e.id)).toEqual(expect.arrayContaining(ids.engines));
  });

  it("POST /monitor-tasks：5 Query × 3 Engine → 15 Runs，202 立即返回", async () => {
    const agent = request.agent(http);
    await agent.post("/auth/login").send({ email: emailA, password }).expect(200);

    const res = await agent.post("/monitor-tasks")
      .send({ projectId: ids.projectA, queryIds: ids.queries, engineIds: ids.engines })
      .expect(202);
    const body = res.body as {
      id: string; status: string; totalRuns: number; progress: number; createdAt: string;
      runs: Array<{ id: string; queryId: string; engineId: string; status: string }>;
    };
    ids.taskA = body.id;
    expect(body.totalRuns).toBe(15);
    expect(body.runs).toHaveLength(15);
    expect(body.status).toBe("PENDING");
    expect(body.createdAt).toBeTruthy();
    // 每对 (queryId, engineId) 恰好一个 Run
    const pairSet = new Set(body.runs.map(r => `${r.queryId}|${r.engineId}`));
    expect(pairSet.size).toBe(15);
  });

  it("GET /monitor-tasks/:id：返回任务与 Run 摘要，runs 已被异步入队（PENDING/QUEUED）", async () => {
    const agent = request.agent(http);
    await agent.post("/auth/login").send({ email: emailA, password }).expect(200);

    const res = await agent.get(`/monitor-tasks/${ids.taskA}`).expect(200);
    const body = res.body as {
      id: string; totalRuns: number; completedRuns: number; failedRuns: number;
      progress: number; createdAt: string;
      runs: Array<{ id: string; queryId: string; engineId: string; status: string; attempt: number; errorCode: string | null }>;
    };
    expect(body.id).toBe(ids.taskA);
    expect(body.totalRuns).toBe(15);
    expect(body.runs).toHaveLength(15);
    for (const run of body.runs) {
      expect(["PENDING", "QUEUED"]).toContain(run.status);
      expect(run.id).toBeTruthy();
      expect(run.attempt).toBeGreaterThanOrEqual(0);
    }
    // 无 worker 消费，progress 保持 0
    expect(body.progress).toBe(0);
    expect(body.createdAt).toBeTruthy();
  });

  it("权限隔离：跨组织 project 创建任务 → 404；跨组织访问 task → 404", async () => {
    const agentB = request.agent(http);
    await agentB.post("/auth/login").send({ email: emailB, password }).expect(200);

    // B 用 A 的 projectId 创建 → assertUserInProject 校验 membership 失败 → 404
    await agentB.post("/monitor-tasks")
      .send({ projectId: ids.projectA, queryIds: ids.queries, engineIds: ids.engines })
      .expect(404);
    // B 读取 A 的 task → 404（不泄露存在性）
    await agentB.get(`/monitor-tasks/${ids.taskA}`).expect(404);
  });

  it("DTO 校验：空 queryIds / 不存在的 engine → 400", async () => {
    const agent = request.agent(http);
    await agent.post("/auth/login").send({ email: emailA, password }).expect(200);

    await agent.post("/monitor-tasks")
      .send({ projectId: ids.projectA, queryIds: [], engineIds: ids.engines })
      .expect(400);
    await agent.post("/monitor-tasks")
      .send({ projectId: ids.projectA, queryIds: ids.queries, engineIds: [randomUUID()] })
      .expect(400);
  });
});
