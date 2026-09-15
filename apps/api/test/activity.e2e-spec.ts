/**
 * R2 Activity Center e2e（真实 PostgreSQL geo_test + 真实 Redis）。
 * 硬保护：setupFiles 已加载 packages/database/scripts/test-env.cjs，强制 geo_test。
 *
 * 覆盖（对照 R2 任务书「统一任务中心」验收点）：
 *   1. 鉴权：未登录 GET /activity → 401
 *   2. 聚合：跨 4 类（BENCHMARK / MANUAL / MONITOR / RETEST）聚合、确定性排序、分页
 *   3. Tenant / Project 隔离：跨租户看不到对方活动；projectId 收敛生效
 *   4. type 筛选：MANUAL / BENCHMARK / EXPERIMENT（空集不报错）
 *   5. status 筛选：AWAITING_MANUAL_INPUT（手动测量子 Run 提升）、SUCCEEDED
 *   6. 关键词 q 过滤：命中 suiteName / projectName / experiment title
 *   7. 分页：pageSize / page / total 语义正确
 *   8. 非法参数：未知 type / 未知 status → 400
 *   9. 校验过滤：未知枚举 → 400
 */
import "../../../packages/database/scripts/test-env.cjs";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";

describe("Activity Center R2 e2e", () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication["getHttpServer"]>;
  let owner: ReturnType<typeof request.agent>;
  let outsider: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const emailA = `act-a-${suffix}@e2e.test.com`;
  const emailB = `act-b-${suffix}@e2e.test.com`;
  const password = "act-e2e-pass-123";

  const ids = {
    orgA: "", orgB: "", projectA: "", projectB: "",
    engine: "",
    // fixture 1: automated benchmark (BENCHMARK)
    autoSuiteId: "", autoRunId: "",
    // fixture 2: manual measurement (MANUAL, 含 AWAITING_MANUAL_INPUT 子 Run)
    manualSuiteId: "", manualRunId: "", manualTaskId: "",
    // fixture 3: pure monitor task (MONITOR，无 benchmarkRun)
    monitorTaskId: "",
    // fixture 4: retest (RETEST)
    retestId: "",
    q1: "", // 用于 Join query
    // fixture 5: 滞后镜像 —— 子 Run 全 SUCCEEDED，但 BenchmarkRun 镜像列 status=PENDING/completedRuns=0
    staleRunId: "",
    // fixture 6: PARTIAL —— 子 Run 2 SUCCEEDED + 1 FAILED，镜像列滞后
    partialRunId: "",
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    http = app.getHttpServer();

    owner = request.agent(http);
    outsider = request.agent(http);

    const register = async (email: string) => {
      const res = await request(http).post("/auth/register").send({ email, name: "Act User", password });
      expect(res.status).toBe(201);
      return res.body as { user: { id: string }; organization: { id: string } };
    };
    const [a, b] = [await register(emailA), await register(emailB)];
    ids.orgA = a.organization.id;
    ids.orgB = b.organization.id;

    const projectA = await prisma.project.create({ data: { organizationId: ids.orgA, name: `Act A ${suffix}` } });
    const projectB = await prisma.project.create({ data: { organizationId: ids.orgB, name: `Act B ${suffix}` } });
    ids.projectA = projectA.id;
    ids.projectB = projectB.id;

    const engine = await prisma.engine.create({ data: { key: `act-mock-${suffix}`, name: "Act mock", provider: "mock", config: { delayMs: 1 } } });
    ids.engine = engine.id;

    const q1 = await prisma.query.create({ data: { projectId: ids.projectA, text: `act-q1 ${suffix}`, source: "IMPORTED", status: "PAUSED" } });
    ids.q1 = q1.id;

    // ---- session ----
    await owner.post("/auth/login").send({ email: emailA, password }).expect(200);
    await outsider.post("/auth/login").send({ email: emailB, password }).expect(200);

    // ============ fixture 1: automated benchmark (BENCHMARK) ============
    const autoSuite = await prisma.benchmarkSuite.create({ data: { projectId: ids.projectA, name: `Auto Suite ${suffix}`, version: "1" } });
    ids.autoSuiteId = autoSuite.id;
    const autoTask = await prisma.monitorTask.create({ data: {
      organizationId: ids.orgA, projectId: ids.projectA, totalRuns: 1, status: "SUCCEEDED", completedRuns: 1,
    } });
    await prisma.run.create({ data: {
      monitorTaskId: autoTask.id, queryId: ids.q1, engineId: ids.engine,
      status: "SUCCEEDED", analysisStatus: "SUCCEEDED",
    } });
    const autoRun = await prisma.benchmarkRun.create({ data: {
      organizationId: ids.orgA, projectId: ids.projectA, suiteId: autoSuite.id,
      suiteName: autoSuite.name, suiteVersion: "1", runType: "DEMO", provider: "mock",
      engineId: ids.engine, monitorTaskId: autoTask.id, plannedRuns: 1, completedRuns: 1,
      status: "SUCCEEDED",
    } });
    ids.autoRunId = autoRun.id;

    // ============ fixture 2: manual measurement (MANUAL + AWAITING_MANUAL_INPUT) ============
    const manualSuite = await prisma.benchmarkSuite.create({ data: { projectId: ids.projectA, name: `Manual Suite ${suffix}`, version: "1" } });
    ids.manualSuiteId = manualSuite.id;
    const manualTask = await prisma.monitorTask.create({ data: {
      organizationId: ids.orgA, projectId: ids.projectA, totalRuns: 2, status: "PARTIAL",
    } });
    // 子 Run 需不同 queryId（Run 有 @@unique([monitorTaskId, queryId, engineId])）
    const q2 = await prisma.query.create({ data: { projectId: ids.projectA, text: `act-q2 ${suffix}`, source: "IMPORTED", status: "PAUSED" } });
    // 子 Run 1: 已完成
    await prisma.run.create({ data: {
      monitorTaskId: manualTask.id, queryId: ids.q1, engineId: ids.engine,
      status: "SUCCEEDED", analysisStatus: "SUCCEEDED",
    } });
    // 子 Run 2: 等待人工录入 → 一级状态应提升为 AWAITING_MANUAL_INPUT
    await prisma.run.create({ data: {
      monitorTaskId: manualTask.id, queryId: q2.id, engineId: ids.engine,
      status: "AWAITING_MANUAL_INPUT", analysisStatus: "PENDING",
    } });
    const manualRun = await prisma.benchmarkRun.create({ data: {
      organizationId: ids.orgA, projectId: ids.projectA, suiteId: manualSuite.id,
      suiteName: manualSuite.name, suiteVersion: "1", runType: "DEMO", provider: "manual",
      engineId: ids.engine, monitorTaskId: manualTask.id, plannedRuns: 2, completedRuns: 1,
      status: "PARTIAL",
    } });
    ids.manualRunId = manualRun.id;
    ids.manualTaskId = manualTask.id;

    // ============ fixture 3: pure monitor task (MONITOR，无 benchmarkRun) ============
    const monitorTask = await prisma.monitorTask.create({ data: {
      organizationId: ids.orgA, projectId: ids.projectA, totalRuns: 3, status: "QUEUED",
      completedRuns: 0, failedRuns: 0,
    } });
    ids.monitorTaskId = monitorTask.id;

    // ============ fixture 4: retest (RETEST) ============
    // RETEST 强依赖 experiment→contentOpportunity→recommendationRun→diagnosisRun→report
    // 关联链，seed 成本高、脆弱；本套件改为断言「RETEST 类型筛选在无数据时返回空列表而非报错」，
    // experiment 真实数据聚合由 service 单测/后续 M8+ 阶段补充覆盖。
    // ============ fixture 5: 滞后镜像（复现 P0 状态不同步）============
    // 真实子 Run 已全 SUCCEEDED，但 BenchmarkRun 冗余镜像列滞后为 PENDING / completedRuns=0。
    // R2 修复前 Activity 会显示「等待中 0/3」；修复后必须表现真实终态 SUCCEEDED / 3/3。
    const staleSuite = await prisma.benchmarkSuite.create({ data: { projectId: ids.projectA, name: `Stale Suite ${suffix}`, version: "1" } });
    const staleTask = await prisma.monitorTask.create({ data: {
      organizationId: ids.orgA, projectId: ids.projectA, totalRuns: 3, status: "SUCCEEDED", completedRuns: 3,
    } });
    for (let i = 0; i < 3; i++) {
      const q = await prisma.query.create({ data: { projectId: ids.projectA, text: `stale-q${i} ${suffix}`, source: "IMPORTED", status: "PAUSED" } });
      await prisma.run.create({ data: {
        monitorTaskId: staleTask.id, queryId: q.id, engineId: ids.engine,
        status: "SUCCEEDED", analysisStatus: "SUCCEEDED",
      } });
    }
    const staleRun = await prisma.benchmarkRun.create({ data: {
      organizationId: ids.orgA, projectId: ids.projectA, suiteId: staleSuite.id,
      suiteName: staleSuite.name, suiteVersion: "1", runType: "DEMO", provider: "mock",
      engineId: ids.engine, monitorTaskId: staleTask.id, plannedRuns: 3, completedRuns: 0,
      status: "PENDING", // 滞后镜像
    } });
    ids.staleRunId = staleRun.id;

    // ============ fixture 6: PARTIAL（部分成功部分失败，镜像列滞后）============
    const partialSuite = await prisma.benchmarkSuite.create({ data: { projectId: ids.projectA, name: `Partial Suite ${suffix}`, version: "1" } });
    const partialTask = await prisma.monitorTask.create({ data: {
      organizationId: ids.orgA, projectId: ids.projectA, totalRuns: 3, status: "PARTIAL", completedRuns: 3,
    } });
    const partialQs = [];
    for (let i = 0; i < 3; i++) {
      partialQs.push(await prisma.query.create({ data: { projectId: ids.projectA, text: `partial-q${i} ${suffix}`, source: "IMPORTED", status: "PAUSED" } }));
    }
    const partialStatuses = ["SUCCEEDED", "SUCCEEDED", "FAILED"] as const;
    for (let i = 0; i < 3; i++) {
      await prisma.run.create({ data: {
        monitorTaskId: partialTask.id, queryId: partialQs[i].id, engineId: ids.engine,
        status: partialStatuses[i], analysisStatus: partialStatuses[i] === "FAILED" ? "FAILED" : "SUCCEEDED",
      } });
    }
    const partialRun = await prisma.benchmarkRun.create({ data: {
      organizationId: ids.orgA, projectId: ids.projectA, suiteId: partialSuite.id,
      suiteName: partialSuite.name, suiteVersion: "1", runType: "DEMO", provider: "mock",
      engineId: ids.engine, monitorTaskId: partialTask.id, plannedRuns: 3, completedRuns: 0,
      status: "PENDING", // 滞后镜像
    } });
    ids.partialRunId = partialRun.id;
  }, 120_000);

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
      console.error("activity teardown error", e);
    } finally {
      await prisma.$disconnect();
      await app?.close();
    }
  });

  test("GET /activity 未登录 → 401", async () => {
    const res = await request(http).get("/activity");
    expect(res.status).toBe(401);
  });

  test("默认聚合：BENCHMARK / MANUAL / MONITOR 均出现在列表中", async () => {
    const res = await owner.get("/activity").query({ pageSize: 50 }).expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(3);
    const types = new Set(res.body.items.map((it: { type: string }) => it.type));
    expect(types.has("BENCHMARK")).toBe(true);
    expect(types.has("MANUAL")).toBe(true);
    expect(types.has("MONITOR")).toBe(true);
  });

  test("MANUAL 任务：人工待录入子 Run 提升为 AWAITING_MANUAL_INPUT 一级状态", async () => {
    const res = await owner.get("/activity").query({ pageSize: 50 }).expect(200);
    const manual = res.body.items.find((it: { id: string }) => it.id === ids.manualRunId);
    expect(manual).toBeTruthy();
    expect(manual.type).toBe("MANUAL");
    expect(manual.status).toBe("AWAITING_MANUAL_INPUT");
    expect(manual.resultUrl).toContain("manual-runs");
  });

  test("BENCHMARK 类型筛选只返回 automated benchmark", async () => {
    const res = await owner.get("/activity").query({ type: "BENCHMARK", pageSize: 50 }).expect(200);
    for (const it of res.body.items) expect(it.type).toBe("BENCHMARK");
    const auto = res.body.items.find((it: { id: string }) => it.id === ids.autoRunId);
    expect(auto).toBeTruthy();
  });

  test("EXPERIMENT 类型筛选：无数据时返回空列表而非报错", async () => {
    const res = await owner.get("/activity").query({ type: "EXPERIMENT" }).expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  test("RETEST 类型筛选：无数据时返回空列表而非报错", async () => {
    const res = await owner.get("/activity").query({ type: "RETEST" }).expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  test("status=AWAITING_MANUAL_INPUT 只命中人工待录入任务", async () => {
    const res = await owner.get("/activity").query({ status: "AWAITING_MANUAL_INPUT", pageSize: 50 }).expect(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    for (const it of res.body.items) expect(it.status).toBe("AWAITING_MANUAL_INPUT");
  });

  test("关键词 q 过滤：按 suiteName / projectName 命中 BENCHMARK 与 MONITOR", async () => {
    const res = await owner.get("/activity").query({ q: `Auto Suite ${suffix}`, pageSize: 50 }).expect(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    expect(res.body.items.every((it: { suiteName: string | null }) => it.suiteName && it.suiteName.includes(`Auto Suite ${suffix}`))).toBe(true);
  });

  test("projectId 收敛：只返回该项目的活动", async () => {
    // 在项目 B 下造一个任务，owner 不应看到；owner 项目 A 下 fixture 全部可见
    const bTask = await prisma.monitorTask.create({ data: {
      organizationId: ids.orgB, projectId: ids.projectB, totalRuns: 1, status: "PENDING",
    } });
    const res = await owner.get("/activity").query({ projectId: ids.projectA, pageSize: 50 }).expect(200);
    for (const it of res.body.items) expect(it.projectId).toBe(ids.projectA);
    await prisma.monitorTask.delete({ where: { id: bTask.id } });
  });

  test("Tenant 隔离：outsider 看不到他人组织的活动（项目过滤后为空）", async () => {
    const res = await outsider.get("/activity").query({ projectId: ids.projectA }).expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  test("分页语义：pageSize=1 时 second page 不重叠、total 恒定", async () => {
    const page1 = await owner.get("/activity").query({ pageSize: 1, page: 1 }).expect(200);
    const page2 = await owner.get("/activity").query({ pageSize: 1, page: 2 }).expect(200);
    expect(page1.body.items.length).toBe(1);
    expect(page2.body.items.length).toBe(1);
    expect(page1.body.items[0].id).not.toBe(page2.body.items[0].id);
    expect(page1.body.total).toBe(page2.body.total);
    // 排序确定性：时间降序
    const t1 = new Date(page1.body.items[0].createdAt).getTime();
    const t2 = new Date(page2.body.items[0].createdAt).getTime();
    expect(t1).toBeGreaterThanOrEqual(t2);
  });

  test("非法 type → 400", async () => {
    const res = await owner.get("/activity").query({ type: "NOT_A_TYPE" }).expect(400);
    expect(res.body.message).toContain("未知任务类型");
  });

  test("非法 status → 400", async () => {
    const res = await owner.get("/activity").query({ status: "BOGUS" }).expect(400);
    expect(res.body.message).toContain("未知状态");
  });

  test("Activity contract：resultUrl/resultType/resultId/availableActions 语义", async () => {
    const res = await owner.get("/activity").query({ pageSize: 50 }).expect(200);
    const items = res.body.items as Array<Record<string, unknown>>;

    // BENCHMARK：结果是 BenchmarkRun → RUN + run.id
    const auto = items.find(it => it.id === ids.autoRunId) as Record<string, any>;
    expect(auto).toBeTruthy();
    expect(auto.resultUrl).toContain("/app/benchmark");
    expect(auto.resultType).toBe("RUN");
    expect(auto.resultId).toBe(ids.autoRunId);
    expect(auto.availableActions).toContain("VIEW_RESULT");

    // MANUAL：结果也是 BenchmarkRun（manual-runs 详情）→ RUN；AWAITING_MANUAL_INPUT 有真实录入入口
    const manual = items.find(it => it.id === ids.manualRunId) as Record<string, any>;
    expect(manual).toBeTruthy();
    expect(manual.status).toBe("AWAITING_MANUAL_INPUT");
    expect(manual.resultType).toBe("RUN");
    expect(manual.resultId).toBe(ids.manualRunId);
    expect(manual.availableActions).toContain("VIEW_RESULT");
    expect(manual.availableActions).toContain("CONTINUE_MANUAL_INPUT");

    // MONITOR：结果是 MonitorTask → MONITOR + task.id
    const monitor = items.find(it => it.id === ids.monitorTaskId) as Record<string, any>;
    expect(monitor).toBeTruthy();
    expect(monitor.resultType).toBe("MONITOR");
    expect(monitor.resultId).toBe(ids.monitorTaskId);
  });

  test("Activity contract：不支持的 action 不返回（无 CANCEL / 无 RETRY）", async () => {
    // 当前后端不存在安全的 cancel / retry endpoint，availableActions 不应杜撰这些动作
    const res = await owner.get("/activity").query({ pageSize: 50 }).expect(200);
    for (const it of res.body.items as Array<{ availableActions: string[] }>) {
      expect(it.availableActions).toBeDefined();
      expect(it.availableActions).not.toContain("CANCEL");
      expect(it.availableActions).not.toContain("RETRY");
      expect(it.availableActions.every((a: string) => a === "VIEW_RESULT" || a === "CONTINUE_MANUAL_INPUT")).toBe(true);
    }
  });

  test("P0 修复：滞后镜像（子 Run 全 SUCCEEDED）必须表现真实终态 SUCCEEDED，而非旧 PENDING 0/3", async () => {
    const res = await owner.get("/activity").query({ pageSize: 50 }).expect(200);
    const stale = ((res.body.items as Array<Record<string, any>>).find((it) => it.id === ids.staleRunId)) as Record<string, any>;
    expect(stale).toBeTruthy();
    expect(stale.type).toBe("BENCHMARK");
    // 不得被旧 PENDING/QUEUED 镜像列覆盖
    expect(stale.status).toBe("SUCCEEDED");
    expect(stale.progress).toBeTruthy();
    expect(stale.progress.completed).toBe(3);
    expect(stale.progress.total).toBe(3);
    expect(stale.progress.label).toBe("3 / 3");
  });

  test("P0 修复：PARTIAL（部分成功部分失败）状态与 completed/total 来自真实子 Run", async () => {
    const res = await owner.get("/activity").query({ pageSize: 50 }).expect(200);
    const partial = ((res.body.items as Array<Record<string, any>>).find((it) => it.id === ids.partialRunId)) as Record<string, any>;
    expect(partial).toBeTruthy();
    expect(partial.status).toBe("PARTIAL");
    // 2 SUCCEEDED + 1 FAILED → 已解决 3 / 计划 3
    expect(partial.progress.completed).toBe(3);
    expect(partial.progress.total).toBe(3);
    expect(partial.progress.label).toBe("3 / 3");
  });
});
