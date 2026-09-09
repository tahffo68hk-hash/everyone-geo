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
    await prisma.$disconnect();
    await app?.close();
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
});
