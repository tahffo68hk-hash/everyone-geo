/**
 * M7C Content Opportunities e2e（geo_test）。直连 fixture（mock evidence+m4 分析）
 * → 生成 Diagnosis（API）→ 生成 Recommendations（API）→ 生成 ContentOpportunities
 * （API）→ 详情/回链/状态/隔离/快照。全程 0 次真实 Provider 调用。
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

const M4 = "m4-rule-v1";
const REC = "geolens-recommendation-v1";
const OPP = "geolens-content-opportunity-v1";

describe("Content Opportunities M7C e2e", () => {
  let app: INestApplication;
  let owner: ReturnType<typeof request.agent>;
  let outsider: ReturnType<typeof request.agent>;
  let anon: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const password = "m7c-e2e-pass-123";
  const ids: Record<string, string> = {};
  const seq = { n: 0 };
  const queryTexts: string[] = [];

  const mkEngine = async (key: string, provider: string, config: Record<string, unknown> = {}) =>
    prisma.engine.create({ data: { key, name: key, provider, config: config as never } });

  async function addRun(spec: { projectId: string; taskId: string; bRunId: string; engineId: string; mentioned: boolean; recommended: boolean; position: number | null }) {
    const text = `m7c q ${seq.n} ${randomUUID()} 用什么 AI 工具？`;
    const query = await prisma.query.create({ data: { projectId: spec.projectId, text } });
    queryTexts.push(text);
    const run = await prisma.run.create({ data: {
      monitorTaskId: spec.taskId, queryId: query.id, engineId: spec.engineId,
      status: "SUCCEEDED", analysisStatus: "SUCCEEDED", executionToken: randomUUID(),
    } });
    await prisma.benchmarkRunQuery.create({ data: {
      benchmarkRunId: spec.bRunId, benchmarkQueryId: randomUUID(), projectQueryId: query.id,
      queryText: text, category: seq.n % 2 ? "comparison" : "tool-discovery",
      intent: `intent ${seq.n}`, locale: "zh-CN", sortOrder: seq.n, sanity: false,
    } });
    seq.n += 1;
    const evidence = await prisma.evidence.create({ data: {
      runId: run.id, queryText: text, rawPrompt: "{}", rawResponse: `response ${text}`,
      provider: "mock", engineKey: spec.engineId, engineName: "Engine",
      model: "geolens-mock", modelVersion: "1", requestedModel: "geolens-mock", responseModel: "geolens-mock",
      retrievalMode: "unknown", sourceType: "mock", metadata: {}, entitySnapshot: [],
    } });
    await prisma.analysis.create({ data: {
      evidenceId: evidence.id, analysisVersion: M4,
      brandMentioned: spec.mentioned, mentionPosition: spec.position,
      recommended: spec.recommended, sentiment: "neutral",
    } });
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
      const res = await request(app.getHttpServer()).post("/auth/register").send({ email, name: "O", password });
      expect(res.status).toBe(201);
      return res.body as { organization: { id: string } };
    };
    const a = await register(`opp-own-${suffix}@m7c.test.com`);
    const b = await register(`opp-oth-${suffix}@m7c.test.com`);
    ids.orgA = a.organization.id;
    ids.orgB = b.organization.id;
    await owner.post("/auth/login").send({ email: `opp-own-${suffix}@m7c.test.com`, password }).expect(200);
    await outsider.post("/auth/login").send({ email: `opp-oth-${suffix}@m7c.test.com`, password }).expect(200);

    const project = await prisma.project.create({ data: { organizationId: ids.orgA, name: `Opp A ${suffix}`, industry: "SaaS" } });
    ids.projectA = project.id;
    const engine = await mkEngine(`m7c-mock-${suffix}`, "mock", { delayMs: 0 });
    ids.engMock = engine.id;

    const suite = await prisma.benchmarkSuite.create({ data: { projectId: project.id, name: `Opp Suite ${suffix}`, version: "1", status: "ACTIVE" } });
    const task = await prisma.monitorTask.create({ data: {
      organizationId: ids.orgA, projectId: project.id, status: "SUCCEEDED",
      totalRuns: 6, completedRuns: 6, failedRuns: 0,
    } });
    const bRun = await prisma.benchmarkRun.create({ data: {
      organizationId: ids.orgA, projectId: project.id, suiteId: suite.id,
      suiteName: suite.name, suiteVersion: "1", runType: "DEMO", provider: "mock",
      engineId: engine.id, monitorTaskId: task.id, status: "SUCCEEDED",
      plannedRuns: 6, completedRuns: 6, failedRuns: 0, metadata: {},
    } });
    ids.runA = bRun.id;
    for (let i = 0; i < 4; i++) await addRun({ projectId: project.id, taskId: task.id, bRunId: bRun.id, engineId: engine.id, mentioned: true, recommended: i < 2, position: i < 2 ? 1 : 5 });
    for (let i = 0; i < 2; i++) await addRun({ projectId: project.id, taskId: task.id, bRunId: bRun.id, engineId: engine.id, mentioned: false, recommended: false, position: null });

    const report = await owner.post(`/benchmark-runs/${bRun.id}/reports`).send({ analysisVersion: M4 });
    expect(report.status).toBe(201);
    ids.reportA = report.body.id;
    const diag = await owner.post(`/reports/${ids.reportA}/diagnoses`).send({});
    expect(diag.status).toBe(201);
    ids.diagA = diag.body.id;
    const rec = await owner.post(`/diagnoses/${ids.diagA}/recommendations`).send({});
    expect(rec.status).toBe(201);
    ids.recRun = rec.body.id;

    const projectB = await prisma.project.create({ data: { organizationId: ids.orgB, name: `Opp B ${suffix}` } });
    ids.projectB = projectB.id;
  }, 120000);

  afterAll(async () => {
    try {
      for (const orgId of [ids.orgA, ids.orgB]) {
        if (!orgId) continue;
        await prisma.contentOpportunityBlock.deleteMany({ where: { opportunity: { opportunityRun: { project: { organizationId: orgId } } } } });
        await prisma.contentOpportunityQuery.deleteMany({ where: { opportunity: { opportunityRun: { project: { organizationId: orgId } } } } });
        await prisma.contentOpportunityEvidence.deleteMany({ where: { opportunity: { opportunityRun: { project: { organizationId: orgId } } } } });
        await prisma.contentOpportunityRecommendation.deleteMany({ where: { opportunity: { opportunityRun: { project: { organizationId: orgId } } } } });
        await prisma.contentOpportunity.deleteMany({ where: { opportunityRun: { project: { organizationId: orgId } } } });
        await prisma.contentOpportunityRun.deleteMany({ where: { project: { organizationId: orgId } } });
        await prisma.actionItem.deleteMany({ where: { recommendation: { recommendationRun: { project: { organizationId: orgId } } } } });
        await prisma.recommendationFinding.deleteMany({ where: { recommendation: { recommendationRun: { project: { organizationId: orgId } } } } });
        await prisma.recommendation.deleteMany({ where: { recommendationRun: { project: { organizationId: orgId } } } });
        await prisma.recommendationRun.deleteMany({ where: { project: { organizationId: orgId } } });
        await prisma.diagnosisFindingEvidence.deleteMany({ where: { finding: { diagnosisRun: { project: { organizationId: orgId } } } } });
        await prisma.diagnosisFinding.deleteMany({ where: { diagnosisRun: { project: { organizationId: orgId } } } });
        await prisma.diagnosisRun.deleteMany({ where: { project: { organizationId: orgId } } });
        const projects = await prisma.project.findMany({ where: { organizationId: orgId }, select: { id: true } });
        for (const p of projects) {
          await prisma.benchmarkReport.deleteMany({ where: { projectId: p.id } });
          await prisma.analysis.deleteMany({ where: { evidence: { run: { monitorTask: { projectId: p.id } } } } });
          await prisma.evidence.deleteMany({ where: { run: { monitorTask: { projectId: p.id } } } });
          await prisma.run.deleteMany({ where: { monitorTask: { projectId: p.id } } });
          await prisma.benchmarkRun.deleteMany({ where: { projectId: p.id } });
          await prisma.monitorTask.deleteMany({ where: { projectId: p.id } });
          await prisma.benchmarkSuite.deleteMany({ where: { projectId: p.id } });
          await prisma.query.deleteMany({ where: { projectId: p.id } });
          await prisma.project.deleteMany({ where: { id: p.id } });
        }
        await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
        await prisma.organization.deleteMany({ where: { id: orgId } });
      }
      await prisma.engine.deleteMany({ where: { id: ids.engMock } });
      await prisma.user.deleteMany({ where: { email: { contains: "@m7c.test.com" } } });
    } finally {
      await app.close();
      await prisma.$disconnect();
    }
  });

  it("生成 ContentOpportunityRun：201 + version + summary + demo 标注", async () => {
    const res = await owner.post(`/recommendation-runs/${ids.recRun}/opportunities`).expect(201);
    const run = res.body;
    ids.oppRun = run.id;
    expect(run.opportunityVersion).toBe(OPP);
    expect(run.recommendationRunId).toBe(ids.recRun);
    expect(run.status).toBe("READY");
    expect(run.metadata.metricSource).toBe("demo");
    expect(run.summary).toBeDefined();
    expect(run.summary.opportunityCount).toBeGreaterThan(0);
  });

  it("幂等：同 recommendationRun 重复 POST → 既有 Run", async () => {
    const before = await owner.get(`/recommendation-runs/${ids.recRun}/opportunities`).expect(200);
    const again = await owner.post(`/recommendation-runs/${ids.recRun}/opportunities`).expect(201);
    expect(again.body.id).toBe(ids.oppRun);
    expect(again.body.reused).toBe(true);
    const after = await owner.get(`/recommendation-runs/${ids.recRun}/opportunities`).expect(200);
    expect(after.body.length).toBe(before.body.length);
  });

  it("list opportunities：run 快照 + 内容机会行（含全部必填字段）", async () => {
    const r = await owner.get(`/opportunity-runs/${ids.oppRun}/opportunities`).expect(200);
    const { contentOpportunityRun, opportunities } = r.body;
    expect(contentOpportunityRun.id).toBe(ids.oppRun);
    expect(opportunities.length).toBeGreaterThan(0);
    for (const o of opportunities) {
      expect(o.opportunityType).toBeTruthy();
      expect(o.titleDirection).toBeTruthy();
      expect(o.summary).toBeTruthy();
      expect(o.rationale).toBeTruthy();
      expect(["HIGH", "MEDIUM", "LOW"]).toContain(o.priority);
      expect(o.priorityScore).toBeGreaterThanOrEqual(0);
      expect(o.assetType).toBeTruthy();
      expect(o.contentIntent).toBeTruthy();
      expect(o.effortLevel).toBeTruthy();
      expect(o.expectedSignals.length).toBeGreaterThan(0);
      expect(o.status).toBe("PROPOSED");
      expect(o.dataQualityLimited).toBe(false);
      expect(o.engines.length).toBeGreaterThan(0);
      // 不携带效果承诺
      expect(o).not.toHaveProperty("expectedDelta");
    }
    const sorted = opportunities.map((x: any) => x.priorityScore);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i - 1]).toBeGreaterThanOrEqual(sorted[i]);
  });

  it("summary 计数与列表一致（priorityCounts 合计 + queryLink/evidence 计数）", async () => {
    const runRes = await owner.get(`/opportunity-runs/${ids.oppRun}`).expect(200);
    const list = await owner.get(`/opportunity-runs/${ids.oppRun}/opportunities`).expect(200);
    const counts = runRes.body.summary.priorityCounts;
    expect(counts.HIGH + counts.MEDIUM + counts.LOW).toBe(list.body.opportunities.length);
    expect(runRes.body.summary.opportunityCount).toBe(list.body.opportunities.length);
  });

  it("opportunity 详情：blocks + queries + engines/competitors 快照解码", async () => {
    const list = await owner.get(`/opportunity-runs/${ids.oppRun}/opportunities`).expect(200);
    const oppId = list.body.opportunities[0].id;
    const detail = await owner.get(`/content-opportunities/${oppId}`).expect(200);
    expect(detail.body.blocks.length).toBeGreaterThan(0);
    expect(detail.body.blocks[0].title).toBeTruthy();
    expect(detail.body.blocks[0].purpose).toBeTruthy();
    expect(detail.body.blocks[0]).not.toHaveProperty("body");
    expect(detail.body.queries.length).toBe(detail.body.targetQueryCount);
    expect(detail.body.queries.length).toBeGreaterThan(0);
    for (const q of detail.body.queries) {
      expect(q.queryText).toBeTruthy();
      expect(q.sourceEvidenceCount).toBeGreaterThan(0);
      expect(q.engines.length).toBeGreaterThan(0);
    }
    expect(detail.body.engines.length).toBe(detail.body.targetEngineCount);
    // blocks sortOrder 稳定 0..n-1
    detail.body.blocks.forEach((b: any, i: number) => expect(b.sortOrder).toBe(i));
  });

  it("source recommendation links：全部保留（count 一致 + recommendationType 中文可映射原值）", async () => {
    const list = await owner.get(`/opportunity-runs/${ids.oppRun}/opportunities`).expect(200);
    const opp = list.body.opportunities.find((x: any) => x.recommendationCount > 0);
    expect(opp).toBeDefined();
    const src = await owner.get(`/content-opportunities/${opp.id}/recommendations`).expect(200);
    expect(src.body.recommendations.length).toBe(opp.recommendationCount);
    for (const r of src.body.recommendations) {
      expect(r.recommendationType).toBeTruthy();
      expect(r.id).toBeTruthy();
    }
  });

  it("queries endpoint：queryTextSnapshot 为冻结快照（当前 Query 编辑不影响历史）", async () => {
    const list = await owner.get(`/opportunity-runs/${ids.oppRun}/opportunities`).expect(200);
    const opp = list.body.opportunities.find((x: any) => x.targetQueryCount > 0);
    expect(opp).toBeDefined();
    const qs = await owner.get(`/content-opportunities/${opp.id}/queries`).expect(200);
    const first = qs.body.queries[0];
    expect(queryTexts).toContain(first.queryText);
    // 编辑底层项目 Query 文本（模拟未来 Query 改动）→ 快照不变
    const oldText = first.queryText;
    await prisma.query.updateMany({ where: { text: oldText }, data: { text: `${oldText} [已编辑]` } });
    const after = await owner.get(`/content-opportunities/${opp.id}/queries`).expect(200);
    expect(after.body.queries[0].queryText).toBe(oldText);
  });

  it("evidence endpoint：指向性链接（runId/evidenceId），不复制 rawResponse", async () => {
    const list = await owner.get(`/opportunity-runs/${ids.oppRun}/opportunities`).expect(200);
    const opp = list.body.opportunities.find((x: any) => x.evidenceCount > 0);
    expect(opp).toBeDefined();
    const ev = await owner.get(`/content-opportunities/${opp.id}/evidence`).expect(200);
    expect(ev.body.evidence.length).toBe(opp.evidenceCount);
    for (const row of ev.body.evidence) {
      expect(row.evidenceId).toBeTruthy();
      expect(row.runId).toBeTruthy();
      expect(row.queryText).toBeTruthy();
      expect(row).not.toHaveProperty("rawResponse");
      expect(row).not.toHaveProperty("rawPrompt");
    }
  });

  it("opportunity detail 不含正文（无 body/fullText/finalTitle）", async () => {
    const list = await owner.get(`/opportunity-runs/${ids.oppRun}/opportunities`).expect(200);
    for (const o of list.body.opportunities) {
      expect(o).not.toHaveProperty("body");
      expect(o).not.toHaveProperty("fullText");
      expect(o).not.toHaveProperty("finalTitle");
      expect(o).not.toHaveProperty("expectedDelta");
    }
  });

  it("status 流转：PROPOSED→APPROVED→PROPOSED（人工）", async () => {
    const list = await owner.get(`/opportunity-runs/${ids.oppRun}/opportunities`).expect(200);
    const oppId = list.body.opportunities[0].id;
    const ok = await owner.patch(`/content-opportunities/${oppId}/status`).send({ status: "APPROVED" }).expect(200);
    expect(ok.body.status).toBe("APPROVED");
    const back = await owner.patch(`/content-opportunities/${oppId}/status`).send({ status: "PROPOSED" }).expect(200);
    expect(back.body.status).toBe("PROPOSED");
  });

  it("status 流转：PROPOSED→DISMISSED 允许", async () => {
    const list = await owner.get(`/opportunity-runs/${ids.oppRun}/opportunities`).expect(200);
    const oppId = list.body.opportunities[1].id;
    const dismissed = await owner.patch(`/content-opportunities/${oppId}/status`).send({ status: "DISMISSED" }).expect(200);
    expect(dismissed.body.status).toBe("DISMISSED");
  });

  it("invalid status rejected：EXECUTING 与非法值 400", async () => {
    const list = await owner.get(`/opportunity-runs/${ids.oppRun}/opportunities`).expect(200);
    const oppId = list.body.opportunities[0].id;
    await owner.patch(`/content-opportunities/${oppId}/status`).send({ status: "EXECUTING" }).expect(400);
    await owner.patch(`/content-opportunities/${oppId}/status`).send({ status: "COMPLETED" }).expect(400);
    await owner.patch(`/content-opportunities/${oppId}/status`).send({ status: "NONSENSE" }).expect(400);
  });

  it("非法流转拒绝：APPROVED 不能直接 DISMISSED（400）", async () => {
    const list = await owner.get(`/opportunity-runs/${ids.oppRun}/opportunities`).expect(200);
    const oppId = list.body.opportunities[0].id;
    await owner.patch(`/content-opportunities/${oppId}/status`).send({ status: "APPROVED" }).expect(200);
    await owner.patch(`/content-opportunities/${oppId}/status`).send({ status: "DISMISSED" }).expect(400);
    await owner.patch(`/content-opportunities/${oppId}/status`).send({ status: "PROPOSED" }).expect(200);
  });

  it("tenant isolation：outsider 无法读/改他人的内容机会（404）", async () => {
    const run = await owner.get(`/opportunity-runs/${ids.oppRun}`).expect(200);
    await outsider.get(`/opportunity-runs/${run.body.id}`).expect(404);
    await outsider.get(`/opportunity-runs/${run.body.id}/opportunities`).expect(404);
    const list = await owner.get(`/opportunity-runs/${ids.oppRun}/opportunities`).expect(200);
    const oppId = list.body.opportunities[0].id;
    await outsider.get(`/content-opportunities/${oppId}`).expect(404);
    await outsider.patch(`/content-opportunities/${oppId}/status`).send({ status: "APPROVED" }).expect(404);
    await outsider.post(`/recommendation-runs/${ids.recRun}/opportunities`).expect(404);
  });

  it("unauthorized：未登录 401", async () => {
    await anon.get(`/opportunity-runs/${ids.oppRun}`).expect(401);
    await anon.post(`/recommendation-runs/${ids.recRun}/opportunities`).expect(401);
  });

  it("Demo/Real 隔离：demo 来源 run 标注 demo（不伪装真实策略）", async () => {
    const run = await owner.get(`/opportunity-runs/${ids.oppRun}`).expect(200);
    expect(run.body.metadata.metricSource).toBe("demo");
    expect(run.body.metadata.suiteName).toContain("Opp Suite");
  });

  it("snapshot stability：重复生成不新增行；旧/新版本并存可读", async () => {
    const before = await owner.get(`/recommendation-runs/${ids.recRun}/opportunities`).expect(200);
    await owner.post(`/recommendation-runs/${ids.recRun}/opportunities`).expect(201);
    const after = await owner.get(`/recommendation-runs/${ids.recRun}/opportunities`).expect(200);
    expect(after.body.length).toBe(before.body.length);

    // 手动制造一个「旧版本」run（模拟未来 v2 并存场景）
    const legacy = await prisma.contentOpportunityRun.create({
      data: {
        projectId: ids.projectA, recommendationRunId: ids.recRun,
        opportunityVersion: "geolens-content-opportunity-v0-test",
        status: "READY", summarySnapshot: { opportunityCount: 0 }, metadata: { legacy: true }, generatedAt: new Date(),
      },
    });
    const rows = await owner.get(`/recommendation-runs/${ids.recRun}/opportunities`).expect(200);
    const versions = rows.body.map((x: any) => x.opportunityVersion);
    expect(versions).toContain(OPP);
    expect(versions).toContain("geolens-content-opportunity-v0-test");
    await prisma.contentOpportunityRun.delete({ where: { id: legacy.id } });
  });

  it("DATA_COLLECTION 不产生普通机会（该 fixture 中机会数 < 建议数）", async () => {
    const run = await owner.get(`/opportunity-runs/${ids.oppRun}`).expect(200);
    const recList = await owner.get(`/recommendation-runs/${ids.recRun}/recommendations`).expect(200);
    const recTypes = recList.body.recommendations.map((x: any) => x.recommendationType);
    expect(recTypes).toContain("DATA_COLLECTION");
    const oppList = await owner.get(`/opportunity-runs/${ids.oppRun}/opportunities`).expect(200);
    for (const o of oppList.body.opportunities) {
      expect(o.opportunityType).not.toBe("DATA_COLLECTION");
    }
    expect(run.body.summary.opportunityCount).toBeLessThan(recTypes.length);
  });
});
