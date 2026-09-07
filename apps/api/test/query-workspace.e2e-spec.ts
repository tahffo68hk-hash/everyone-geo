/**
 * M8E Target Entity & Query Workspace e2e（geo_test）。全程 0 真实 Provider 调用：
 * 1) 通用项目：Project B（AcmeFlow，CRM SaaS）—— 不出现 ProjectMentor 参与。
 * 2) Target Profile：GET/PUT、alias 增删停用、entityType/productCategory。
 * 3) Discovery Guard：DISCOVERY + 含目标 ⇒ 拒绝；BRANDED_SANITY ⇒ 可保存。
 * 4) Query Builder preview（无副作用）+ save；Import preview 含目标建议 SANITY。
 * 5) Metrics scope：sanity excluded；eligible/excluded 计数；visibility 不被品牌问题抬高。
 * 6) Target snapshot 冻结：改 alias 后旧 Run snapshot 不变（evidence.entitySnapshot）。
 * 7) Prompt neutrality（纯函数层 llm.test 覆盖）+ tenant/401。
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

const M4 = "m4-rule-v1";

describe("M8E Target & Query Workspace e2e", () => {
  let app: INestApplication;
  let owner: ReturnType<typeof request.agent>;
  let outsider: ReturnType<typeof request.agent>;
  let anon: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const password = "m8e-e2e-pass-123";
  const ids: Record<string, string> = {};
  const brandName = "AcmeFlow"; // 虚构 demo 品牌（不引入真实公司事实）
  const projectName = `Acme CRM Demo ${suffix}`;
  const queries = [
    { text: "适合小型销售团队的 CRM 有哪些？", category: "tool-discovery", intent: "泛发现" },
    { text: "销售团队怎么选 CRM？", category: "recommendation", intent: "选型建议" },
    { text: "初创公司用什么 CRM SaaS 比较好？", category: "comparison", intent: "对比" },
  ];

  const mkEngine = async (key: string, scenario: string) =>
    prisma.engine.create({ data: { key: `m8e-${key}-${suffix}`, name: `M8E ${key}`, provider: "mock", config: { delayMs: 0, scenario } as never } });

  async function completeRun(runId: string, opts: { brandMentioned: boolean }) {
    const run = await prisma.run.findUnique({ where: { id: runId }, select: { queryId: true, engineId: true } });
    if (!run) throw new Error(`run missing ${runId}`);
    const query = await prisma.query.findUnique({ where: { id: run.queryId }, select: { text: true } });
    const engine = await prisma.engine.findUnique({ where: { id: run.engineId }, select: { key: true, name: true, provider: true } });
    const text = opts.brandMentioned
      ? `推荐 ${brandName}，它适合小型销售团队管理客户。也可以考虑 Alpha CRM。`
      : `推荐 Alpha CRM 和 Beta CRM。`;
    const evidence = await prisma.evidence.create({
      data: {
        runId, queryText: query?.text ?? text, rawPrompt: text, rawResponse: text,
        provider: engine?.provider ?? "mock", engineKey: engine?.key ?? "mock", engineName: engine?.name ?? "mock",
        model: "geolens-mock", modelVersion: "1", requestedModel: "geolens-mock", responseModel: "geolens-mock",
        retrievalMode: "unknown", sourceType: "mock", metadata: {}, entitySnapshot: [],
      },
    });
    await prisma.analysis.create({
      data: {
        evidenceId: evidence.id, analysisVersion: M4,
        brandMentioned: opts.brandMentioned, mentionPosition: opts.brandMentioned ? 1 : null,
        recommended: opts.brandMentioned, sentiment: opts.brandMentioned ? "positive" : "neutral",
        mentions: {
          create: opts.brandMentioned
            ? [{ entityType: "brand", entityId: "brand-1", canonicalName: brandName, displayName: brandName, position: 1, context: text, sentiment: "positive", startOffset: 3, endOffset: 3 + brandName.length }]
            : [],
        },
        citations: { create: [] },
      },
    });
    await prisma.run.update({ where: { id: runId }, data: { status: "SUCCEEDED", analysisStatus: "SUCCEEDED", executionToken: randomUUID() } });
  }

  async function finishBenchmarkRun(benchmarkRunId: string, improved: boolean) {
    const run = await prisma.benchmarkRun.findUnique({
      where: { id: benchmarkRunId },
      include: { runQueries: { orderBy: { sortOrder: "asc" } }, monitorTask: { include: { runs: { select: { id: true, queryId: true } } } } },
    });
    if (!run) throw new Error("benchmark run missing");
    let succeeded = 0;
    for (const row of run.runQueries) {
      const taskRun = run.monitorTask.runs.find(r => r.queryId === row.projectQueryId);
      if (!taskRun) continue;
      await completeRun(taskRun.id, { brandMentioned: improved });
      succeeded += 1;
    }
    await prisma.monitorTask.update({
      where: { id: run.monitorTaskId },
      data: { status: "SUCCEEDED", completedRuns: succeeded, failedRuns: 0 },
    });
  }

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
    const a = await register(`m8e-own-${suffix}@m8e.test.com`);
    const b = await register(`m8e-oth-${suffix}@m8e.test.com`);
    ids.orgA = a.organization.id;
    ids.orgB = b.organization.id;
    await owner.post("/auth/login").send({ email: `m8e-own-${suffix}@m8e.test.com`, password }).expect(200);
    await outsider.post("/auth/login").send({ email: `m8e-oth-${suffix}@m8e.test.com`, password }).expect(200);
    const project = await prisma.project.create({ data: { organizationId: ids.orgA, name: projectName, industry: "SaaS" } });
    ids.projectA = project.id;
    const otherProject = await prisma.project.create({ data: { organizationId: ids.orgB, name: `M8E Other ${suffix}`, industry: "SaaS" } });
    ids.projectB = otherProject.id;
    ids.engAbsent = (await mkEngine("alpha", "absent")).id;
    ids.engImproved = (await mkEngine("beta", "first")).id;
  }, 120000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app?.close();
  });

  it("1. Target Profile：空 → upsert（canonical/entityType/productCategory）→ alias 增/停/删", async () => {
    const empty = await owner.get(`/projects/${ids.projectA}/target-profile`).expect(200);
    expect(empty.body?.brandId ?? null).toBeNull();

    const up = await owner.put(`/projects/${ids.projectA}/target-profile`).send({
      canonicalName: brandName, entityType: "PRODUCT", productCategory: "CRM SaaS", website: "https://acmeflow.example.com",
    }).expect(200);
    expect(up.body.canonicalName).toBe(brandName);
    expect(up.body.productCategory).toBe("CRM SaaS");
    expect(up.body.entityType).toBe("PRODUCT");

    const alias = await owner.post(`/projects/${ids.projectA}/target-aliases`).send({ alias: "Acme Flow", aliasType: "OFFICIAL" }).expect(201);
    type AliasRow = { id: string | null; alias: string; aliasType: string; enabled: boolean };
    const aliasList = (alias.body.aliases as AliasRow[]);
    expect(aliasList.some((a: AliasRow) => a.alias === "Acme Flow" && a.enabled)).toBe(true);
    const aliasRow = aliasList.find((a: AliasRow) => a.alias === "Acme Flow");
    const disabled = await owner.patch(`/target-aliases/${aliasRow!.id}`).send({ enabled: false }).expect(200);
    expect((disabled.body.aliases as AliasRow[]).find((a: AliasRow) => a.alias === "Acme Flow")!.enabled).toBe(false);
    const deleted = await owner.delete(`/target-aliases/${aliasRow!.id}`).expect(200);
    expect((deleted.body.aliases as AliasRow[]).some((a: AliasRow) => a.alias === "Acme Flow")).toBe(false);
    await anon.get(`/projects/${ids.projectA}/target-profile`).expect(401);
    await outsider.put(`/projects/${ids.projectA}/target-profile`).send({ canonicalName: "X" }).expect(404);
  });

  it("2. Discovery Guard：DISCOVERY + 含目标拒绝；BRANDED_SANITY 可保存；Custom 警告", async () => {
    const suiteRes = await owner.post(`/projects/${ids.projectA}/benchmark-suites`).send({
      name: `AcmeFlow 问题集 ${suffix}`, version: "1",
      queries: queries.map((q, i) => ({ queryText: q.text, category: q.category, intent: q.intent, sortOrder: i, enabled: true, queryType: 'DISCOVERY' })),
    });
    expect(suiteRes.status).toBe(201);
    const suite = suiteRes.body;
    ids.suiteA = suite.id;
    expect(suite.queryCount).toBe(3);

    // Builder preview（无副作用：不写 DB）
    const beforeCount = await prisma.benchmarkQuery.count({ where: { suiteId: ids.suiteA } });
    const preview = await owner.post(`/projects/${ids.projectA}/query-builder/preview`).send({
      category: "CRM SaaS", scenario: ["销售团队选型"], intents: ["RECOMMEND"], audience: ["小团队"],
    }).expect(201);
    expect(preview.body.estimated).toBeGreaterThan(0);
    const afterPreviewCount = await prisma.benchmarkQuery.count({ where: { suiteId: ids.suiteA } });
    expect(afterPreviewCount).toBe(beforeCount); // preview 无副作用

    // DISCOVERY + 含目标 → 拒绝（品牌会使自然可见度虚高）
    const contaminated = await owner.post(`/benchmark-suites/${ids.suiteA}/queries/batch`).send({
      rows: [{ text: "AcmeFlow 适合小型销售团队吗？", category: "branded", intent: "品牌认知", queryType: "DISCOVERY" }],
    }).expect(400);
    expect(JSON.stringify(contaminated.body.message)).toContain("品牌");

    // BRANDED_SANITY → 保存成功
    const sanitySave = await owner.post(`/benchmark-suites/${ids.suiteA}/queries/batch`).send({
      rows: [{ text: "AcmeFlow 适合小型销售团队吗？", category: "sanity-control", intent: "品牌认知测试", queryType: "BRANDED_SANITY" }],
    }).expect(201);
    expect(sanitySave.body.added).toBe(1);
    ids.sanityQueryId = sanitySave.body.addedQueries[0].id;

    // CUSTOM + 含目标 → 允许（有警告语义由 contamination 记录；不计入主指标）
    const customSave = await owner.post(`/benchmark-suites/${ids.suiteA}/queries/batch`).send({
      rows: [{ text: "AcmeFlow 和 HubSpot 相比怎么样？", category: "custom", intent: "自定义对比", queryType: "CUSTOM" }],
    }).expect(201);
    expect(customSave.body.added).toBe(1);
  });

  it("3. Import preview：多行 + 去重 + 含目标建议 SANITY（无副作用）", async () => {
    const preview = await owner.post(`/projects/${ids.projectA}/queries/import-preview`).send({
      lines: [
        "小型销售团队的 CRM 推荐", " 小型销售团队的 CRM 推荐 ",
        "AcmeFlow 的优势是什么？", "CRM SaaS 有免费的吗？",
      ],
    }).expect(201);
    expect(preview.body.unique).toBe(3); // 两行空白/重复合并
    expect(preview.body.targetContaminated).toBe(1);
    const tainted = (preview.body.rows as Array<{ text: string; queryType: string; targetCheck: string }>).find((r) => r.text.includes("AcmeFlow"))!;
    expect(tainted.queryType).toBe("BRANDED_SANITY");
    expect(tainted.targetCheck).toBe("TARGET_MENTIONED");
    const dbCount = await prisma.benchmarkQuery.count({ where: { suiteId: ids.suiteA } });
    expect(dbCount).toBe(5); // 3 initial + 1 sanity + 1 custom —— import preview 未写库
  });

  it("4. Query Set Detail 显示 queryType/contamination；tenant 隔离", async () => {
    const suite = await owner.get(`/benchmark-suites/${ids.suiteA}`).expect(200);
    expect(suite.body.queryCount).toBe(4); // 3 discovery + 1 custom（sanity 不计 count）
    const dis = (suite.body.queries as Array<{ queryType: string | null }>).filter(q => q.queryType === "DISCOVERY");
    expect(dis.length).toBe(3);
    const sanity = (suite.body.queries as Array<{ queryType: string | null; contamination: { status: string; matchedAlias: string | null } | null }>).find(q => q.queryType === "BRANDED_SANITY")!;
    expect(sanity).toBeTruthy();
    expect(sanity.contamination!.status).toBe("TARGET_MENTIONED");
    expect(sanity.contamination!.matchedAlias).toBe("AcmeFlow");
    await anon.get(`/benchmark-suites/${ids.suiteA}`).expect(401);
    await outsider.get(`/benchmark-suites/${ids.suiteA}`).expect(404);
  });

  it("5. Run + metrics：DISCOVERY 计入、BRANDED_SANITY excluded（visibility 不被品牌问题抬高）", async () => {
    // 启用 sanity + 一条 DISCOVERY 是 absent 场景（品牌不出现）→ 保证 denominator 诚实
    await prisma.benchmarkQuery.update({ where: { id: ids.sanityQueryId }, data: { enabled: true } });
    const run = await owner.post(`/benchmark-suites/${ids.suiteA}/runs`).send({ engineId: ids.engImproved, runType: "demo" }).expect(202);
    ids.runA = run.body.id;
    // improved: DISCOVERY 全提 + sanity 全提 → 若 sanity 计入则会虚高
    await finishBenchmarkRun(ids.runA, true);
    const report = await owner.post(`/benchmark-runs/${ids.runA}/reports`).send({ analysisVersion: M4 }).expect(201);
    ids.reportA = report.body.id;
    const metrics = await owner.get(`/benchmark-runs/${ids.runA}/metrics?analysisVersion=${M4}`).expect(200);
    // snapshot rows：3 DISCOVERY（eligible）+ 1 CUSTOM 含目标（excluded contaminated）+ 1 BRANDED_SANITY（excluded sanity）
    expect(metrics.body.metricScopeQueryCount).toBe(3);
    expect(metrics.body.excludedSanityCount).toBe(1);
    expect(metrics.body.excludedContaminatedCount).toBe(1);
    expect(metrics.body.excludedQueryCount).toBe(2);
    expect(metrics.body.metricQueryScope).toBe("DISCOVERY_ONLY");
    expect((metrics.body.byQuery as Array<{ queryText: string }>).some(q => q.queryText.includes("AcmeFlow 适合小型销售团队吗"))).toBe(false);
    expect((metrics.body.byQuery as Array<{ queryText: string }>).some(q => q.queryText.includes("AcmeFlow 和 HubSpot"))).toBe(false);
    expect(metrics.body.targetSnapshot.canonicalName).toBe(brandName);
  });

  it("6. Target snapshot 冻结：alias 变更后旧 Run/Evidence snapshot 不变", async () => {
    const run = await owner.get(`/benchmark-runs/${ids.runA}`).expect(200);
    expect(run.body.targetSnapshot.canonicalName).toBe(brandName);
    // 增加 alias 不影响已冻结 evidence entitySnapshot（Analysis 语义历史稳定）
    await owner.post(`/projects/${ids.projectA}/target-aliases`).send({ alias: "ACMEFlow!" }).expect(201);
    const run2 = await owner.get(`/benchmark-runs/${ids.runA}`).expect(200);
    expect(run2.body.targetSnapshot.canonicalName).toBe(brandName);
    expect(run2.body.targetSnapshot.aliases).not.toContain("ACMEFlow!");
  });

  it("7. 历史口径稳定：clone suite 不改变 v1 报告", async () => {
    const before = await owner.get(`/benchmark-runs/${ids.runA}/metrics?analysisVersion=${M4}`).expect(200);
    const clone = await owner.post(`/benchmark-suites/${ids.suiteA}/clone`).send({ version: "2" }).expect(201);
    expect(clone.body.version).toBe("2");
    expect(clone.body.queryCount).toBe(5);
    const after = await owner.get(`/benchmark-runs/${ids.runA}/metrics?analysisVersion=${M4}`).expect(200);
    expect(after.body.overall.visibilityRate).toBe(before.body.overall.visibilityRate);
  });
});
