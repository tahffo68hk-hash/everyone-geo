/**
 * R2 · Query 运营 e2e（geo_test）。全程 0 真实 Provider 调用。
 * 覆盖 QueryWorkspaceController 的 R2 端点：
 *   - GET  /projects/:id/queries          —— 分页 / 搜索 / 过滤 / 排序 / archive 视图
 *   - POST /projects/:id/queries/batch    —— enable / disable / archive / move
 *   - POST /projects/:id/queries/cost-preflight —— 纯占位（pricing=null，0 真实调用）
 * 隔离：
 *   - cross-tenant / cross-project 一律 404（不泄露存在性）
 *   - archived（软删）query 不进默认列表、不进 preflight 计数
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

const BASE_ROWS = [
  { queryText: "为什么小团队应该用 CRM？", category: "comparison", intent: "对比", queryType: "DISCOVERY" },
  { queryText: "哪个 CRM 适合销售人员？", category: "recommendation", intent: "选型", queryType: "BRANDED_SANITY" },
  { queryText: "免费的 CRM 工具有哪些？", category: "tool-discovery", intent: "发现", queryType: "CUSTOM" },
  { queryText: "CRM 如何做客户分群？", category: "workflow", intent: "使用", queryType: "CUSTOM" },
  { queryText: "销售漏斗怎么管理？", category: "workflow", intent: "使用", queryType: "CUSTOM" },
];

describe("R2 Query 运营 e2e", () => {
  let app: INestApplication;
  let owner: ReturnType<typeof request.agent>;
  let outsider: ReturnType<typeof request.agent>;
  let anon: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const password = "r2-e2e-pass-123";
  const ids: Record<string, string> = {};
  let movedQueryIds: string[] = [];

  const mkSuite = async (nameSuffix: string, rows: typeof BASE_ROWS, enabledOverrides?: Record<number, boolean>) => {
    const queries = rows.map((q, i) => ({
      ...q,
      sortOrder: i,
      enabled: enabledOverrides?.[i] ?? true,
      source: "MANUAL",
    }));
    const res = await owner.post(`/projects/${ids.projectA}/benchmark-suites`).send({
      name: `${nameSuffix}-${suffix}`, version: "1", description: "R2 e2e", queries,
    });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  };

  const dbCount = async (suiteId: string, where?: { archived?: boolean }) =>
    prisma.benchmarkQuery.count({ where: { suiteId, ...(where?.archived !== undefined ? { archived: where.archived } : {}) } });

  const listIds = async (suiteId: string) => {
    const res = await owner.get(`/projects/${ids.projectA}/queries?suiteId=${suiteId}`).expect(200);
    const items = res.body.items as Array<{ id: string }>;
    return items.map(i => i.id);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    owner = request.agent(app.getHttpServer());
    outsider = request.agent(app.getHttpServer());
    anon = request(app.getHttpServer());

    const register = async (email: string) => {
      const res = await request(app.getHttpServer()).post("/auth/register").send({ email, name: "E", password });
      expect(res.status).toBe(201);
      return res.body as { organization: { id: string } };
    };
    const a = await register(`r2-own-${suffix}@r2.test.com`);
    const b = await register(`r2-oth-${suffix}@r2.test.com`);
    ids.orgA = a.organization.id;
    ids.orgB = b.organization.id;
    await owner.post("/auth/login").send({ email: `r2-own-${suffix}@r2.test.com`, password }).expect(200);
    await outsider.post("/auth/login").send({ email: `r2-oth-${suffix}@r2.test.com`, password }).expect(200);

    // 主项目（orgA）+ 同 org 另一项目（cross-project）+ outsider 项目（cross-tenant）
    const pA = await prisma.project.create({ data: { organizationId: ids.orgA, name: `R2 A ${suffix}`, industry: "SaaS" } });
    ids.projectA = pA.id;
    const pSameOrg = await prisma.project.create({ data: { organizationId: ids.orgA, name: `R2 B ${suffix}`, industry: "SaaS" } });
    ids.projectSameOrg = pSameOrg.id;
    const pB = await prisma.project.create({ data: { organizationId: ids.orgB, name: `R2 C ${suffix}`, industry: "SaaS" } });
    ids.projectB = pB.id;

    // suiteA：5 条不同 queryType（第 2 条 disabled）
    const suiteA = await mkSuite("QsA", BASE_ROWS, { 1: false });
    ids.suiteA = suiteA.id;
    expect(await dbCount(suiteA.id)).toBe(5);
    // suiteB：move 目标（空）
    const suiteB = await mkSuite("QsB", []);
    ids.suiteB = suiteB.id;
    // suiteC：归档隔离（cross-project query ∈ orgA projectSameOrg）
    const suiteC = await owner.post(`/projects/${ids.projectSameOrg}/benchmark-suites`).send({
      name: `QsC-${suffix}`, version: "1", description: "other project",
      queries: [{ queryText: "别的项目里的 query", category: "workflow", intent: "x", sortOrder: 0, queryType: "CUSTOM" }],
    });
    expect(suiteC.status).toBe(201);
    ids.suiteC = suiteC.body.id as string;
  }, 120000);

  afterAll(async () => {
    try {
      // R2 隔离修复（PHASE 1.1）：本 suite 对自己创建的数据负责，按 tenant 根节点级联清理，
      // 避免 geo_test 残留污染后续 suite / 下一次 full regression。
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
      console.error("qwr2 teardown error", e);
    } finally {
      await prisma.$disconnect();
      await app?.close();
    }
  });

  it("1. list 默认隐藏已归档；含分页/类型/status 过滤、搜索、排序", async () => {
    // 基线：5 条全部可见（1 条 disabled 在 status 过滤外）
    const base = await owner.get(`/projects/${ids.projectA}/queries?suiteId=${ids.suiteA}`).expect(200);
    expect(base.body.total).toBe(5);
    expect(base.body.page).toBe(1);
    expect(base.body.pageSize).toBe(20);
    expect(base.body.items.length).toBe(5);

    // status=disabled 只返回 1 条
    const disabled = await owner.get(`/projects/${ids.projectA}/queries?suiteId=${ids.suiteA}&status=disabled`).expect(200);
    expect(disabled.body.total).toBe(1);
    expect(disabled.body.items[0].enabled).toBe(false);

    // status=enabled 返回 4 条
    const enabled = await owner.get(`/projects/${ids.projectA}/queries?suiteId=${ids.suiteA}&status=enabled`).expect(200);
    expect(enabled.body.total).toBe(4);

    // type=CUSTOM 返回 3 条
    const typed = await owner.get(`/projects/${ids.projectA}/queries?suiteId=${ids.suiteA}&type=CUSTOM`).expect(200);
    expect(typed.body.total).toBe(3);
    expect(typed.body.items.every((i: { queryType: string }) => i.queryType === "CUSTOM")).toBe(true);

    // 搜索 q=CRM
    const searched = await owner.get(`/projects/${ids.projectA}/queries?suiteId=${ids.suiteA}&q=CRM`).expect(200);
    expect(searched.body.total).toBeGreaterThanOrEqual(2);
    expect(searched.body.items.every((i: { queryText: string }) => i.queryText.toLowerCase().includes("crm"))).toBe(true);

    // 分页：pageSize=2 → 每页 2 条
    const page1 = await owner.get(`/projects/${ids.projectA}/queries?suiteId=${ids.suiteA}&page=1&pageSize=2`).expect(200);
    expect(page1.body.items.length).toBe(2);
    const page2 = await owner.get(`/projects/${ids.projectA}/queries?suiteId=${ids.suiteA}&page=2&pageSize=2`).expect(200);
    expect(page2.body.items.length).toBe(2);

    // 排序：queryText desc / asc 首尾互换
    const desc = await owner.get(`/projects/${ids.projectA}/queries?suiteId=${ids.suiteA}&sort=queryText&order=desc`).expect(200);
    const asc = await owner.get(`/projects/${ids.projectA}/queries?suiteId=${ids.suiteA}&sort=queryText&order=asc`).expect(200);
    const texts = (arr: { queryText: string }[]) => arr.map(i => i.queryText);
    expect(texts(desc.body.items)[0]).not.toBe(texts(asc.body.items)[0]);
  });

  it("2. batch：enable / disable", async () => {
    const all = await listIds(ids.suiteA);
    // 全部禁用
    const dis = await owner.post(`/projects/${ids.projectA}/queries/batch`)
      .send({ operation: "disable", queryIds: all }).expect(201);
    expect(dis.body.operation).toBe("disable");
    expect(dis.body.affected).toBe(5);
    const afterDis = await owner.get(`/projects/${ids.projectA}/queries?suiteId=${ids.suiteA}&status=enabled`).expect(200);
    expect(afterDis.body.total).toBe(0);
    // 再全部启用
    const en = await owner.post(`/projects/${ids.projectA}/queries/batch`)
      .send({ operation: "enable", queryIds: all }).expect(201);
    expect(en.body.affected).toBe(5);
    const afterEn = await owner.get(`/projects/${ids.projectA}/queries?suiteId=${ids.suiteA}&status=enabled`).expect(200);
    expect(afterEn.body.total).toBe(5);
  });

  it("3. batch：archive（软删）——仅影响未来执行，历史快照不变", async () => {
    const all = await listIds(ids.suiteA);
    const arch = await owner.post(`/projects/${ids.projectA}/queries/batch`)
      .send({ operation: "archive", queryIds: all.slice(0, 2) }).expect(201);
    expect(arch.body.operation).toBe("archive");
    expect(arch.body.affected).toBe(2);
    expect(arch.body.note).toContain("软删除");

    // 默认列表只显示剩余 3 条
    const def = await owner.get(`/projects/${ids.projectA}/queries?suiteId=${ids.suiteA}`).expect(200);
    expect(def.body.total).toBe(3);
    // archived=true 只返回归档 2 条
    const archView = await owner.get(`/projects/${ids.projectA}/queries?suiteId=${ids.suiteA}&archived=true`).expect(200);
    expect(archView.body.total).toBe(2);
    expect(archView.body.items.every((i: { archived: boolean }) => i.archived === true)).toBe(true);
    // 归档行不参与 status 过滤
    const en = await owner.get(`/projects/${ids.projectA}/queries?suiteId=${ids.suiteA}&status=enabled`).expect(200);
    expect(en.body.items.every((i: { archived: boolean }) => i.archived === false)).toBe(true);
  });

  it("3b. batch：restore（还原归档）——仅翻回 archived=false，历史快照不变", async () => {
    // 独立 suite，避免干扰 test 3/test 4 对 suiteA 的归档/移动假设
    const rs = await mkSuite("QsRestore", [
      { queryText: "restore a", category: "workflow", intent: "x", queryType: "CUSTOM" },
      { queryText: "restore b", category: "workflow", intent: "x", queryType: "CUSTOM" },
    ]);
    const rIds = await listIds(rs.id);
    expect(rIds.length).toBe(2);
    const ar = await owner.post(`/projects/${ids.projectA}/queries/batch`).send({ operation: "archive", queryIds: rIds }).expect(201);
    expect(ar.body.operation).toBe("archive");
    expect(ar.body.affected).toBe(2);
    const archivedView = await owner.get(`/projects/${ids.projectA}/queries?suiteId=${rs.id}&archived=true`).expect(200);
    expect(archivedView.body.total).toBe(2);
    const res = await owner.post(`/projects/${ids.projectA}/queries/batch`)
      .send({ operation: "restore", queryIds: rIds }).expect(201);
    expect(res.body.operation).toBe("restore");
    expect(res.body.affected).toBe(2);
    expect(res.body.note).toContain("历史");
    // 还原后默认列表恢复 2 条，归档视图为空（archive 是软删除，还原不重写任何历史）
    const after = await owner.get(`/projects/${ids.projectA}/queries?suiteId=${rs.id}`).expect(200);
    expect(after.body.total).toBe(2);
    const archView = await owner.get(`/projects/${ids.projectA}/queries?suiteId=${rs.id}&archived=true`).expect(200);
    expect(archView.body.total).toBe(0);
  });

  it("4. batch：move 至同项目另一 Query Set", async () => {
    const all = await listIds(ids.suiteA);
    const move = await owner.post(`/projects/${ids.projectA}/queries/batch`)
      .send({ operation: "move", queryIds: all, targetSuiteId: ids.suiteB }).expect(201);
    expect(move.body.operation).toBe("move");
    expect(move.body.affected).toBe(3);
    expect(move.body.toSuiteId).toBe(ids.suiteB);
    // 源 suite 现在为空，目标 suite 有 3 条
    const from = await owner.get(`/projects/${ids.projectA}/queries?suiteId=${ids.suiteA}`).expect(200);
    expect(from.body.total).toBe(0);
    const to = await owner.get(`/projects/${ids.projectA}/queries?suiteId=${ids.suiteB}`).expect(200);
    expect(to.body.total).toBe(3);
    movedQueryIds = all;
  });

  it("5. 隔离：cross-project / cross-tenant / 匿名一律 404 / 401；batch move 缺 targetSuiteId 400", async () => {
    // suiteC 属于 orgA 另一个项目
    const crossProject = await owner.get(`/projects/${ids.projectA}/queries?suiteId=${ids.suiteC}`).expect(404);
    expect(crossProject.body).toBeDefined();
    // suiteA 属于 orgA，outsider（orgB）访问 → 404
    await outsider.get(`/projects/${ids.projectA}/queries?suiteId=${ids.suiteA}`).expect(404);
    await anon.get(`/projects/${ids.projectA}/queries`).expect(401);
    await anon.post(`/projects/${ids.projectA}/queries/batch`).send({ operation: "disable", queryIds: [randomUUID()] }).expect(401);
    // move 缺 targetSuiteId（用真实存在的 queryId，确保进入 service 校验）
    const noTarget = await owner.post(`/projects/${ids.projectA}/queries/batch`)
      .send({ operation: "move", queryIds: movedQueryIds }).expect(400);
    expect(noTarget.body.message).toContain("targetSuiteId");
  });

  it("6. cost-preflight：纯占位——pricing=null、demo=true、0 真实调用", async () => {
    // 创建一条真实可估算的 enabled query + 1 个 enabled engine
    const one = await mkSuite("QsP", [{ queryText: "preflight query A", category: "workflow", intent: "x", queryType: "CUSTOM" }]);
    const qids = await listIds(one.id);
    const engine = await prisma.engine.create({
      data: { key: `r2-pf-${suffix}`, name: "R2 PF", provider: "mock", config: { delayMs: 0, scenario: "absent" } as never },
    });

    const pf = await owner.post(`/projects/${ids.projectA}/queries/cost-preflight`)
      .send({ queryIds: qids, engineIds: [engine.id] }).expect(201);
    expect(pf.body.queryCount).toBe(1);
    expect(pf.body.engineCount).toBe(1);
    expect(pf.body.estimatedCalls).toBe(1);
    expect(pf.body.pricing).toBeNull();
    expect(pf.body.currency).toBeNull();
    expect(pf.body.demo).toBe(true);
    expect(pf.body.note).toContain("暂不可估算");

    // 无参数时按整项目 enabled query × enabled engine
    const all = await owner.post(`/projects/${ids.projectA}/queries/cost-preflight`).send({}).expect(201);
    expect(all.body.queryCount).toBeGreaterThan(0);
    expect(all.body.engineCount).toBeGreaterThan(0);
    expect(all.body.pricing).toBeNull();
  });

  it("7. cost-preflight suite-scoped：enabled+非归档计数，disabled/archived 不计，pricing/estimatedCost null", async () => {
    // 新 suite：3 条启用 + 1 条禁用
    const s = await mkSuite("QsPf", [
      { queryText: "suite pf a", category: "workflow", intent: "x", queryType: "CUSTOM" },
      { queryText: "suite pf b", category: "workflow", intent: "x", queryType: "CUSTOM" },
      { queryText: "suite pf c", category: "workflow", intent: "x", queryType: "CUSTOM" },
      { queryText: "suite pf disabled", category: "workflow", intent: "x", queryType: "CUSTOM" },
    ], { 3: false });
    const engine = await prisma.engine.create({
      data: { key: `r2-pf-suite-${suffix}`, name: "R2 PF Suite", provider: "mock", config: { delayMs: 0 } as never },
    });
    const ids2 = await listIds(s.id);
    expect(ids2.length).toBe(4);
    // 明确取一条 enabled query 归档（不依赖 list 返回顺序，避免偶发选中 disabled 行）
    const enabledIds = (await owner.get(`/projects/${ids.projectA}/queries?suiteId=${s.id}&status=enabled`).expect(200))
      .body.items.map((i: { id: string }) => i.id);
    expect(enabledIds.length).toBe(3);
    // 归档其中 1 条 enabled → 剩余 2 条 enabled + 1 禁用（不计）
    const dbBefore = await prisma.benchmarkQuery.groupBy({ by: ["enabled", "archived"], where: { suiteId: s.id }, _count: { _all: true } });
    expect(dbBefore.find(r => r.enabled && !r.archived)?._count._all).toBe(3);
    const ar = await owner.post(`/projects/${ids.projectA}/queries/batch`)
      .send({ operation: "archive", queryIds: [enabledIds[0]] }).expect(201);
    const dbAfter = await prisma.benchmarkQuery.groupBy({ by: ["enabled", "archived"], where: { suiteId: s.id }, _count: { _all: true } });
    const enNonAr = dbAfter.find(r => r.enabled && !r.archived)?._count._all ?? -1;
    expect(enNonAr).toBe(2);
    expect(ar.body.operation).toBe("archive");

    const pf = await owner.post(`/projects/${ids.projectA}/queries/cost-preflight`)
      .send({ suiteId: s.id, engineIds: [engine.id], runType: "demo" }).expect(201);
    expect(pf.body.suiteId).toBe(s.id);
    expect(pf.body.runType).toBe("demo");
    expect(pf.body.queryCount).toBe(2);     // 4 - 1 archived - 1 disabled
    expect(pf.body.engineCount).toBe(1);
    expect(pf.body.estimatedCalls).toBe(2);
    expect(pf.body.blocked).toBe(false);
    expect(pf.body.pricing).toBeNull();
    expect(pf.body.estimatedCost).toBeNull();
    expect(pf.body.currency).toBeNull();
    expect(pf.body.demo).toBe(true);
  });

  it("8. cost-preflight：engine 全禁用/不匹配 → blocked=NO_ENGINE_AVAILABLE；suite 无可用 query 不计 blocked", async () => {
    // suiteB 为空 suite：无 enabled query → queryCount=0，但 engine 存在时按 demo 不放行估算为 0
    const engine = await prisma.engine.create({
      data: { key: `r2-pf-b-${suffix}`, name: "R2 PF B", provider: "mock", config: { delayMs: 0 } as never },
    });
    const emptyS = await mkSuite("QsPfE", []);
    const pfEmpty = await owner.post(`/projects/${ids.projectA}/queries/cost-preflight`)
      .send({ suiteId: emptyS.id, engineIds: [engine.id] }).expect(201);
    expect(pfEmpty.body.queryCount).toBe(0);
    expect(pfEmpty.body.engineCount).toBe(1);
    expect(pfEmpty.body.estimatedCalls).toBe(0);
    expect(pfEmpty.body.blocked).toBe(false);

    // engineIds 指向不存在的 engine → enabled 引擎为 0 → blocked
    const noEngine = await owner.post(`/projects/${ids.projectA}/queries/cost-preflight`)
      .send({ suiteId: emptyS.id, engineIds: [randomUUID()] }).expect(201);
    expect(noEngine.body.engineCount).toBe(0);
    expect(noEngine.body.blocked).toBe(true);
    expect(noEngine.body.blockedReasonCode).toBe("NO_ENGINE_AVAILABLE");
    expect(noEngine.body.blockedReason).toContain("AI 引擎");
  });

  it("9. cost-preflight：runType=real + provider 不可用 → blocked=REAL_PROVIDER_UNAVAILABLE（0 真实调用）", async () => {
    // 本套件 ENABLE_REAL_PROVIDERS=false 且无 key → deepseek/qwen 未配置
    const s = await mkSuite("QsPfR", [{ queryText: "real pf", category: "workflow", intent: "x", queryType: "CUSTOM" }]);
    const engine = await prisma.engine.create({
      data: { key: `r2-pf-ds-${suffix}`, name: "R2 PF DS", provider: "deepseek", config: { model: "deepseek-chat" } as never },
    });
    const pf = await owner.post(`/projects/${ids.projectA}/queries/cost-preflight`)
      .send({ suiteId: s.id, engineIds: [engine.id], runType: "real" }).expect(201);
    expect(pf.body.runType).toBe("real");
    expect(pf.body.queryCount).toBe(1);
    expect(pf.body.engineCount).toBe(1);
    expect(pf.body.blocked).toBe(true);
    expect(pf.body.blockedReasonCode).toBe("REAL_PROVIDER_UNAVAILABLE");
    expect(pf.body.blockedReason).toContain("Provider");
  });

  it("10. cost-preflight：queryIds × suiteId 冲突 → 400；跨 project / 跨 tenant → 404；runType 非法 → 400", async () => {
    const s = await mkSuite("QsPfX", [{ queryText: "x", category: "workflow", intent: "x", queryType: "CUSTOM" }]);
    const qids = await listIds(s.id);
    const both = await owner.post(`/projects/${ids.projectA}/queries/cost-preflight`)
      .send({ suiteId: s.id, queryIds: qids }).expect(400);
    expect(both.body.message).toContain("不能同时指定");

    // suiteC 属于 orgA 的另一个项目 → 404
    await owner.post(`/projects/${ids.projectA}/queries/cost-preflight`)
      .send({ suiteId: ids.suiteC }).expect(404);
    // cross-tenant：outsider（orgB）访问 orgA 的 suite（挂在 orgA 的 project id 下）→ 404
    await outsider.post(`/projects/${ids.projectA}/queries/cost-preflight`)
      .send({ suiteId: ids.suiteA }).expect(404);

    // runType 非法 → 400
    await owner.post(`/projects/${ids.projectA}/queries/cost-preflight`)
      .send({ suiteId: s.id, runType: "nope" }).expect(400);
  });
});
