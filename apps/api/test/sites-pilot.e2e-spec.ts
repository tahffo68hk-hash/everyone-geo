/**
 * M8 Site/Pilot e2e（geo_test）。mock fixture + 正式 API 编排：
 * suite → before run → report → diagnosis → recommendations → opportunities
 * → site+asset（manual）→ mapping(UPDATE_EXISTING) → BEFORE snapshot(manual)
 * → change plan（DRAFT→APPROVED）→ experiment（WEB_CONTENT target）
 * → execution → AFTER snapshot（hash 变化）→ frozen retest → evaluation
 * （measurement guard：演示/unknown 测量 ⇒ INCONCLUSIVE + INVALID_MEASUREMENT）
 * → pilot review（诚实 outcome，不伪装提升）。
 * 全程 0 次真实 Provider 调用 / 0 外部站点抓取（快照走 manual 通道）。
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
const EXP = "geolens-experiment-v1";
const EVAL = "geolens-experiment-evaluation-v1";
const PLAN = "geolens-change-plan-v1";
const REVIEW = "geolens-pilot-review-v1";

const ABSENT_TEXT = () => `推荐 Alpha 和 Beta，都不错。`;
const IMPROVED_TEXT = (brand: string) => `推荐 ${brand}，它适合商业计划书和答辩准备。也可以考虑 Alpha。`;

describe("M8 Site Asset & Real Pilot e2e", () => {
  let app: INestApplication;
  let owner: ReturnType<typeof request.agent>;
  let outsider: ReturnType<typeof request.agent>;
  let anon: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const password = "m8-e2e-pass-123";
  const ids: Record<string, string> = {};
  const brand = "ProjectMentor";
  const queries = [
    { text: "创新创业比赛可以用什么 AI 工具？", category: "competition", intent: "工具发现" },
    { text: "商业计划书 AI 工具推荐", category: "workflow", intent: "场景推荐" },
    { text: "写商业计划书的 AI 有哪些", category: "tool-discovery", intent: "工具发现" },
  ];

  const mkEngine = async (key: string, scenario: string) =>
    prisma.engine.create({ data: { key: `m8-${key}-${suffix}`, name: `M8 ${key}`, provider: "mock", config: { delayMs: 0, scenario } as never } });

  async function completeRun(runId: string, opts: { text: string; brandMentioned: boolean; recommended: boolean; position: number | null }) {
    const run = await prisma.run.findUnique({ where: { id: runId }, select: { queryId: true, engineId: true } });
    if (!run) throw new Error(`run missing ${runId}`);
    const query = await prisma.query.findUnique({ where: { id: run.queryId }, select: { text: true } });
    const engine = await prisma.engine.findUnique({ where: { id: run.engineId }, select: { key: true, name: true, provider: true } });
    const text = opts.text;
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
        brandMentioned: opts.brandMentioned, mentionPosition: opts.position,
        recommended: opts.recommended, sentiment: opts.brandMentioned ? "positive" : "neutral",
        mentions: {
          create: opts.brandMentioned
            ? [{ entityType: "brand", entityId: "brand-1", canonicalName: brand, displayName: brand, position: opts.position ?? 1, context: text, sentiment: "positive", startOffset: 3, endOffset: 3 + brand.length }]
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
      await completeRun(taskRun.id, {
        text: improved ? IMPROVED_TEXT(brand) : ABSENT_TEXT(),
        brandMentioned: improved,
        recommended: improved,
        position: improved ? (row.sortOrder === 0 ? 3 : 1) : null,
      });
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
    const a = await register(`m8-own-${suffix}@m8.test.com`);
    const b = await register(`m8-oth-${suffix}@m8.test.com`);
    ids.orgA = a.organization.id;
    ids.orgB = b.organization.id;
    await owner.post("/auth/login").send({ email: `m8-own-${suffix}@m8.test.com`, password }).expect(200);
    await outsider.post("/auth/login").send({ email: `m8-oth-${suffix}@m8.test.com`, password }).expect(200);

    const project = await prisma.project.create({ data: { organizationId: ids.orgA, name: `M8 A ${suffix}`, industry: "SaaS" } });
    ids.projectA = project.id;
    const otherProject = await prisma.project.create({ data: { organizationId: ids.orgB, name: `M8 B ${suffix}`, industry: "SaaS" } });
    ids.projectB = otherProject.id;
    await prisma.brand.create({ data: { projectId: project.id, name: brand, aliases: [] } });
    const engAbsent = await mkEngine("alpha", "absent");
    const engImproved = await mkEngine("beta", "first");
    ids.engAbsent = engAbsent.id;
    ids.engImproved = engImproved.id;

    const suite = await prisma.benchmarkSuite.create({ data: { projectId: project.id, name: `M8 Suite ${suffix}`, version: "1", status: "ACTIVE" } });
    ids.suite = suite.id;
    const querySet = await prisma.querySet.create({ data: { projectId: project.id, name: `Benchmark Auto: M8 ${suffix} v1` } });
    for (const [i, q] of queries.entries()) {
      const query = await prisma.query.create({ data: { projectId: project.id, querySetId: querySet.id, text: q.text, type: "CUSTOM", source: "IMPORTED", status: "PAUSED", language: "zh-CN" } });
      await prisma.benchmarkQuery.create({ data: { suiteId: suite.id, projectQueryId: query.id, queryText: q.text, category: q.category, intent: q.intent, locale: "zh-CN", sortOrder: i, enabled: true, sanity: false } });
    }

    // Before（absent 场景）
    const beforeRun = await owner.post(`/benchmark-suites/${suite.id}/runs`).send({ engineId: engAbsent.id, runType: "demo" }).expect(202);
    ids.runBefore = beforeRun.body.id;
    await finishBenchmarkRun(ids.runBefore, false);
    const reportA = await owner.post(`/benchmark-runs/${ids.runBefore}/reports`).send({ analysisVersion: M4 }).expect(201);
    ids.reportBefore = reportA.body.id;

    // M7A 诊断 → M7B 建议 → M7C 机会
    const diag = await owner.post(`/reports/${ids.reportBefore}/diagnoses`).send({}).expect(201);
    ids.diagRun = diag.body.id;
    const rec = await owner.post(`/diagnoses/${ids.diagRun}/recommendations`).send({}).expect(201);
    ids.recRun = rec.body.id;
    const oppRun = await owner.post(`/recommendation-runs/${ids.recRun}/opportunities`).expect(201);
    const oppList = await owner.get(`/opportunity-runs/${oppRun.body.id}/opportunities`).expect(200);
    ids.oppId = oppList.body.opportunities[0].id;
  }, 120000);

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
      console.error("sites-pilot teardown error", e);
    } finally {
      await prisma.$disconnect();
      await app?.close();
    }
  });

  it("1. sites: create + list + tenant isolation + 401", async () => {
    const bad = await owner.post(`/projects/${ids.projectA}/sites`).send({ name: "S", baseUrl: "file:///etc/passwd" }).expect(400);
    expect(JSON.stringify(bad.body.message)).toContain("baseUrl");
    const created = await owner.post(`/projects/${ids.projectA}/sites`).send({ name: "ProjectMentor 官网", baseUrl: "https://projectmentor.example.cn" }).expect(201);
    ids.siteA = created.body.id;
    expect(created.body.baseUrl).toBe("https://projectmentor.example.cn/");
    const list = await owner.get(`/projects/${ids.projectA}/sites`).expect(200);
    expect(list.body.length).toBe(1);
    await anon.get(`/projects/${ids.projectA}/sites`).expect(401);
    await outsider.post(`/projects/${ids.projectA}/sites`).send({ name: "x", baseUrl: "https://a.example.com" }).expect(404);
  });

  it("2. assets: manual import + canonical dedup + snapshot", async () => {
    const asset = await owner.post(`/sites/${ids.siteA}/assets`).send({
      url: "https://projectmentor.example.cn/guide",
      assetType: "USE_CASE_PAGE",
      title: "工具发现指南",
    }).expect(201);
    ids.assetA = asset.body.id;
    // dedup（同 canonical）
    const dup = await owner.post(`/sites/${ids.siteA}/assets`).send({ url: "https://projectmentor.example.cn/guide/" }).expect(201);
    expect(dup.body.id).toBe(asset.body.id);
    // snapshot: BEFORE（manual 通道 —— 不抓外网）
    const before = await owner.post(`/site-assets/${ids.assetA}/snapshots/manual`).send({ snapshotType: "BEFORE_CHANGE", title: "工具发现指南", text: "旧版：无国创赛场景说明" }).expect(201);
    ids.snapBefore = before.body.id;
    expect(before.body.contentHash).toBeTruthy();
    const snapshots = await owner.get(`/site-assets/${ids.assetA}/snapshots`).expect(200);
    expect(snapshots.body.snapshots.length).toBe(1);
  });

  it("3. opportunity mapping: UPDATE_EXISTING 确认", async () => {
    const map = await owner.post(`/content-opportunities/${ids.oppId}/asset-mappings`).send({
      mappingType: "UPDATE_EXISTING", siteAssetId: ids.assetA, note: "更新现有指南页",
    }).expect(201);
    ids.mappingId = map.body.id;
    expect(map.body.confirmedByUser).toBe(true);
    const maps = await owner.get(`/content-opportunities/${ids.oppId}/asset-mappings`).expect(200);
    expect(maps.body.mappings.length).toBe(1);
    expect(maps.body.mappings[0].siteAsset.id).toBe(ids.assetA);
    // tenant isolation
    await outsider.get(`/content-opportunities/${ids.oppId}/asset-mappings`).expect(404);
  });

  it("4. change plan: create from opportunity blocks + evidence linkage + status", async () => {
    const plan = await owner.post(`/content-opportunities/${ids.oppId}/change-plans`).send({ siteAssetId: ids.assetA }).expect(201);
    ids.planA = plan.body.id;
    expect(plan.body.changePlanVersion).toBe(PLAN);
    expect(plan.body.status).toBe("DRAFT");
    expect(plan.body.itemCount).toBeGreaterThan(0);
    expect(plan.body.items.length).toBeGreaterThan(0);
    // no final article body / no auto publish status semantics
    expect(JSON.stringify(plan.body)).not.toMatch(/finalPublishedText/);
    expect(JSON.stringify(plan.body)).not.toContain("AUTO_PUBLISHED");
    expect(JSON.stringify(plan.body)).not.toMatch(/已自动发布/);
    const item = plan.body.items[0];
    expect(item.sourceRecommendationId).toBeTruthy();
    // status 流转：DRAFT → APPROVED
    const approved = await owner.patch(`/change-plans/${ids.planA}/status`).send({ status: "APPROVED" }).expect(200);
    expect(approved.body.status).toBe("APPROVED");
    // 非法状态
    await owner.patch(`/change-plans/${ids.planA}/status`).send({ status: "AUTO_PUBLISHED" }).expect(400);
    // item 勾选
    const done = await owner.patch(`/change-plans/${ids.planA}/items/${item.id}/status`).send({ status: "DONE" }).expect(200);
    expect(done.body.status).toBe("DONE");
    // tenant
    await outsider.get(`/change-plans/${ids.planA}`).expect(404);
  });

  it("5. experiment measurement validity + WEB_CONTENT target", async () => {
    const exp = await owner.post(`/content-opportunities/${ids.oppId}/experiments`).expect(201);
    ids.expA = exp.body.id;
    // 演示 mock baseline → measurementValidity=INVALID_FOR_WEB_CHANGE（mock 不能当真实网页验证）
    expect(exp.body.measurementValidity).toBe("INVALID_FOR_WEB_CHANGE");
    expect(exp.body.measurementMode).toBe("UNKNOWN");
    const mv = await owner.get(`/experiments/${ids.expA}/measurement-validity`).expect(200);
    expect(mv.body.measurementValidity).toBe("INVALID_FOR_WEB_CHANGE");
    expect(mv.body.targetChangeType).toBe("MODEL_BEHAVIOR");
    // 置为 WEB_CONTENT（PLANNED 允许）
    const web = await owner.patch(`/experiments/${ids.expA}/measurement-target`).send({ targetChangeType: "WEB_CONTENT" }).expect(200);
    expect(web.body.metadata.targetChangeType).toBe("WEB_CONTENT");
  });

  it("6. execution + AFTER snapshot（hash 变化 → change verified）", async () => {
    const execAt = new Date(Date.now() + 1000).toISOString();
    const exec = await owner.post(`/experiments/${ids.expA}/executions`).send({
      executionType: "MANUAL_CONTENT_UPDATE",
      changeSummary: "演示：在指南页补充国创赛场景说明与 FAQ（用户确认已完成）",
      assetType: "USE_CASE_PAGE",
      assetReference: "https://projectmentor.example.cn/guide",
      executedAt: execAt,
    }).expect(201);
    expect(exec.body.status).toBe("RECORDED");
    // AFTER snapshot（内容有变 → hash 不同）
    const after = await owner.post(`/site-assets/${ids.assetA}/snapshots/manual`).send({ snapshotType: "AFTER_CHANGE", title: "工具发现指南", text: "新版：含国创赛场景说明、产品能力与 FAQ（示例文本）" }).expect(201);
    expect(after.body.contentHash).not.toBe(ids.snapBefore);
  });

  it("7. retest before execution guard & frozen retest demo", async () => {
    const plan = await owner.post(`/experiments/${ids.expA}/retest-plan`).expect(201);
    expect(plan.body.queryCount).toBe(queries.length);
    expect(plan.body.expectedCallCount).toBe(queries.length);
    const retest = await owner.post(`/experiments/${ids.expA}/retests`).expect(201);
    ids.retestA = retest.body.id;
    expect(retest.body.status).toBe("RUNNING");
    await finishBenchmarkRun(retest.body.benchmarkRunId, true);
  });

  it("8. evaluation：WEB_CONTENT target + 演示测量 ⇒ outcome INCONCLUSIVE + INVALID_MEASUREMENT（不伪装提升）", async () => {
    const ev = await owner.post(`/experiment-retests/${ids.retestA}/evaluate`).expect(201);
    ids.evalA = ev.body.id;
    // 演示 mock 环境下即使指标变好，也不能输出网页优化验证结论
    expect(ev.body.outcome).toBe("INCONCLUSIVE");
    expect(ev.body.measurementGuard).toBeTruthy();
    expect(ev.body.measurementGuard.blocked).toBe("INVALID_MEASUREMENT");
    expect(JSON.stringify(ev.body.warnings)).toContain("INVALID_MEASUREMENT");
  });

  it("9. pilot review：诚实 outcome（INVALID_MEASUREMENT / lessons 记录测量限制）", async () => {
    const review = await owner.post(`/experiments/${ids.expA}/pilot-review`).expect(201);
    ids.reviewA = review.body.id;
    expect(review.body.reviewVersion).toBe(REVIEW);
    expect(review.body.measurementValidity).toBe("INVALID_FOR_WEB_CHANGE");
    // 演示 mock → 不能输出 VALIDATED_OBSERVATION
    expect(review.body.observedOutcome).not.toBe("VALIDATED_OBSERVATION");
    expect(review.body.attributionConfidence).toBe("LOW");
    expect(review.body.lessons.length).toBeGreaterThan(0);
    // immutable：重复生成返回同一 review
    const again = await owner.post(`/experiments/${ids.expA}/pilot-review`).expect(201);
    expect(again.body.id).toBe(review.body.id);
    const get = await owner.get(`/pilot-reviews/${ids.reviewA}`).expect(200);
    expect(get.body.summarySnapshot.contentHashChanged).toBe(true);
  });

  it("10. API 非法输入/隔离：snapshot 不可变更、外租户不可见", async () => {
    await anon.get(`/sites/${ids.siteA}/assets`).expect(401);
    await outsider.get(`/site-assets/${ids.assetA}`).expect(404);
    await outsider.post(`/experiments/${ids.expA}/pilot-review`).expect(404);
    await owner.patch(`/experiments/${ids.expA}/measurement-target`).send({ targetChangeType: "HACK" }).expect(400);
    // 状态已 EVALUATED → 不再允许改 target
    await owner.patch(`/experiments/${ids.expA}/measurement-target`).send({ targetChangeType: "MODEL_BEHAVIOR" }).expect(400);
  });
});
