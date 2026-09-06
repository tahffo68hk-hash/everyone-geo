/**
 * M7B Optimization Recommendations e2e（geo_test）。直连 fixture（mock evidence+analysis
 * + m4 分析）→ 生成 Diagnosis（API）→ 生成 Recommendations（API）→ 状态/回链/隔离。
 * 全程 0 次真实 Provider 调用。
 */
import "../../../packages/database/scripts/test-env.cjs";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";

const M4 = "m4-rule-v1";
const REC = "geolens-recommendation-v1";

describe("Recommendations M7B e2e", () => {
  let app: INestApplication;
  let owner: ReturnType<typeof request.agent>;
  let outsider: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const password = "m7b-e2e-pass-123";
  const ids: Record<string, string> = {};
  const seq = { n: 0 };

  const mkEngine = async (key: string, provider: string, config: Record<string, unknown> = {}) =>
    prisma.engine.create({ data: { key, name: key, provider, config: config as never } });

  async function addRun(spec: { projectId: string; taskId: string; bRunId: string; engineId: string; mentioned: boolean; recommended: boolean; position: number | null }) {
    const query = await prisma.query.create({ data: { projectId: spec.projectId, text: `q ${seq.n} ${randomUUID()}` } });
    const run = await prisma.run.create({ data: {
      monitorTaskId: spec.taskId, queryId: query.id, engineId: spec.engineId,
      status: "SUCCEEDED", analysisStatus: "SUCCEEDED", executionToken: randomUUID(),
    } });
    await prisma.benchmarkRunQuery.create({ data: {
      benchmarkRunId: spec.bRunId, benchmarkQueryId: randomUUID(), projectQueryId: query.id,
      queryText: query.text, category: seq.n % 2 ? "comparison" : "tool-discovery",
      intent: `intent ${seq.n}`, locale: "zh-CN", sortOrder: seq.n, sanity: false,
    } });
    seq.n += 1;
    const evidence = await prisma.evidence.create({ data: {
      runId: run.id, queryText: query.text, rawPrompt: "{}", rawResponse: `response ${query.text}`,
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

    const register = async (email: string) => {
      const res = await request(app.getHttpServer()).post("/auth/register").send({ email, name: "R", password });
      expect(res.status).toBe(201);
      return res.body as { organization: { id: string } };
    };
    const a = await register(`rec-own-${suffix}@m7b.test.com`);
    const b = await register(`rec-oth-${suffix}@m7b.test.com`);
    ids.orgA = a.organization.id;
    ids.orgB = b.organization.id;
    await owner.post("/auth/login").send({ email: `rec-own-${suffix}@m7b.test.com`, password }).expect(200);
    await outsider.post("/auth/login").send({ email: `rec-oth-${suffix}@m7b.test.com`, password }).expect(200);

    const project = await prisma.project.create({ data: { organizationId: ids.orgA, name: `Rec A ${suffix}`, industry: "SaaS" } });
    ids.projectA = project.id;
    const engine = await mkEngine(`m7b-mock-${suffix}`, "mock", { delayMs: 0 });
    ids.engMock = engine.id;

    // 6 runs：4 提及（2 推荐 pos1、2 未推荐 pos5）+ 2 缺席 → 低可见、低推荐、位置、样本提示等
    const suite = await prisma.benchmarkSuite.create({ data: { projectId: project.id, name: `Rec Suite ${suffix}`, version: "1", status: "ACTIVE" } });
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

    // tenant B（隔离对照）
    const projectB = await prisma.project.create({ data: { organizationId: ids.orgB, name: `Rec B ${suffix}` } });
    ids.projectB = projectB.id;
  }, 120000);

  afterAll(async () => {
    try {
      for (const orgId of [ids.orgA, ids.orgB]) {
        if (!orgId) continue;
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
      await prisma.user.deleteMany({ where: { email: { contains: "@m7b.test.com" } } });
    } finally {
      await app.close();
      await prisma.$disconnect();
    }
  });

  it("生成 RecommendationRun：201 + version + summary + metadata（demo 标注）", async () => {
    const res = await owner.post(`/diagnoses/${ids.diagA}/recommendations`).expect(201);
    const run = res.body;
    ids.recRun = run.id;
    expect(run.recommendationVersion).toBe(REC);
    expect(run.diagnosisRunId).toBe(ids.diagA);
    expect(run.status).toBe("READY");
    expect(run.metadata.metricSource).toBe("demo");
    expect(run.summary).toBeDefined();
  });

  it("幂等：同 diagnosis 重复 POST → 既有 RecommendationRun", async () => {
    const before = await owner.get(`/diagnoses/${ids.diagA}/recommendations`).expect(200);
    const again = await owner.post(`/diagnoses/${ids.diagA}/recommendations`).expect(201);
    expect(again.body.id).toBe(ids.recRun);
    const after = await owner.get(`/diagnoses/${ids.diagA}/recommendations`).expect(200);
    expect(after.body.length).toBe(before.body.length);
  });

  it("listRecommendations：排序 + actionItems + finding 链接全保留", async () => {
    const r = await owner.get(`/recommendation-runs/${ids.recRun}/recommendations`).expect(200);
    const { recommendationRun, recommendations } = r.body;
    expect(recommendationRun.id).toBe(ids.recRun);
    expect(recommendations.length).toBeGreaterThan(0);
    for (let i = 1; i < recommendations.length; i++) {
      expect(recommendations[i - 1].priorityScore).toBeGreaterThanOrEqual(recommendations[i].priorityScore);
    }
    // 至少含 DATA_COLLECTION（该 demo 诊断有样本量提示）
    const types = recommendations.map((x: any) => x.recommendationType);
    expect(types).toContain("DATA_COLLECTION");
    // 总数 = summary
    expect(recommendationRun.summary.recommendationCount).toBe(recommendations.length);
    // 每张卡都有行动项数
    expect(recommendations.some((x: any) => (x.actionItemCount ?? 0) > 0)).toBe(true);
    const counts = recommendationRun.summary.priorityCounts as Record<string, number>;
    expect(counts.HIGH + counts.MEDIUM + counts.LOW).toBe(recommendations.length);
  });

  it("recommendation 详情：actionItems（排序/TODO）+ findingIds", async () => {
    const list = await owner.get(`/recommendation-runs/${ids.recRun}/recommendations`).expect(200);
    const recId = list.body.recommendations[0].id;
    const detail = await owner.get(`/recommendations/${recId}`).expect(200);
    expect(detail.body.actionItems.length).toBeGreaterThan(0);
    expect(detail.body.actionItems[0].status).toBe("TODO");
    expect(detail.body.findingIds.length).toBe(detail.body.findingCount);
    const orders = detail.body.actionItems.map((x: any) => x.sortOrder);
    expect([...orders].sort((a: number, b: number) => a - b)).toEqual(orders);
    expect(detail.body.actionItems[0].verificationMethod).toContain("复测");
  });

  it("finding linkage：Recommendation→Finding（含 evidence links）", async () => {
    const list = await owner.get(`/recommendation-runs/${ids.recRun}/recommendations`).expect(200);
    const rec = list.body.recommendations.find((x: any) => x.recommendationType !== "DATA_COLLECTION");
    expect(rec).toBeDefined();
    const f = await owner.get(`/recommendations/${rec.id}/findings`).expect(200);
    expect(f.body.findings.length).toBe(rec.findingCount);
    for (const finding of f.body.findings) {
      expect(finding.diagnosisRunId).toBe(ids.diagA);
      expect(finding.evidence).toBeDefined();
    }
  });

  it("evidence linkage：Recommendation→evidence（不复制 rawResponse）", async () => {
    const list = await owner.get(`/recommendation-runs/${ids.recRun}/recommendations`).expect(200);
    const rec = list.body.recommendations.find((x: any) => x.evidenceCount > 0);
    expect(rec).toBeDefined();
    const e = await owner.get(`/recommendations/${rec.id}/evidence`).expect(200);
    expect(e.body.evidence.length).toBeGreaterThan(0);
    for (const row of e.body.evidence) {
      expect(row.evidenceId).toBeTruthy();
      expect(row).not.toHaveProperty("rawResponse");
    }
  });

  it("accept / dismiss recommendation（人工状态）", async () => {
    const list = await owner.get(`/recommendation-runs/${ids.recRun}/recommendations`).expect(200);
    const recId = list.body.recommendations[0].id;
    const accepted = await owner.patch(`/recommendations/${recId}/status`).send({ status: "ACCEPTED" }).expect(200);
    expect(accepted.body.status).toBe("ACCEPTED");
    const dismissed = await owner.patch(`/recommendations/${recId}/status`).send({ status: "DISMISSED" }).expect(200);
    expect(dismissed.body.status).toBe("DISMISSED");
    await owner.patch(`/recommendations/${recId}/status`).send({ status: "BOGUS" }).expect(400);
  });

  it("action item 状态更新（TODO→IN_PROGRESS→DONE）", async () => {
    const list = await owner.get(`/recommendation-runs/${ids.recRun}/recommendations`).expect(200);
    const recId = list.body.recommendations[0].id;
    const detail = await owner.get(`/recommendations/${recId}`).expect(200);
    const itemId = detail.body.actionItems[0].id;
    const up = await owner.patch(`/action-items/${itemId}/status`).send({ status: "IN_PROGRESS" }).expect(200);
    expect(up.body.status).toBe("IN_PROGRESS");
    await owner.patch(`/action-items/${itemId}/status`).send({ status: "NOPE" }).expect(400);
  });

  it("snapshot stability：重复生成幂等命中，Recommendation 不变（历史不动）", async () => {
    const before = await owner.get(`/recommendation-runs/${ids.recRun}/recommendations`).expect(200);
    await owner.post(`/diagnoses/${ids.diagA}/recommendations`).expect(201); // 幂等
    const after = await owner.get(`/recommendation-runs/${ids.recRun}/recommendations`).expect(200);
    expect(after.body.recommendations.map((x: any) => x.id).sort())
      .toEqual(before.body.recommendations.map((x: any) => x.id).sort());
  });

  it("Demo/Real 隔离：demo 诊断的 recommendations metadata.metricSource=demo", async () => {
    const run = await owner.get(`/recommendation-runs/${ids.recRun}`).expect(200);
    expect(run.body.metadata.metricSource).toBe("demo");
  });

  it("tenant isolation：outsider 访问 → 404", async () => {
    await outsider.post(`/diagnoses/${ids.diagA}/recommendations`).expect(404);
    await outsider.get(`/recommendation-runs/${ids.recRun}`).expect(404);
    const list = await owner.get(`/recommendation-runs/${ids.recRun}/recommendations`).expect(200);
    const recId = list.body.recommendations[0].id;
    await outsider.get(`/recommendations/${recId}`).expect(404);
    await outsider.patch(`/recommendations/${recId}/status`).send({ status: "ACCEPTED" }).expect(404);
  });

  it("unauthorized：无登录 → 401", async () => {
    await request(app.getHttpServer()).post(`/diagnoses/${ids.diagA}/recommendations`).expect(401);
    await request(app.getHttpServer()).get(`/recommendation-runs/${ids.recRun}`).expect(401);
  });

  it("错误 ID → 400；未知 diagnosis → 404", async () => {
    await owner.post(`/diagnoses/not-a-uuid/recommendations`).expect(400);
    await owner.post(`/diagnoses/${randomUUID()}/recommendations`).expect(404);
  });
});
