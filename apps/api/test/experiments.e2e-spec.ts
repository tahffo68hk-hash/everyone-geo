/**
 * M7D Experiment & Re-test e2e（geo_test）。mock fixture + 正式 API 编排：
 * suite → before run（absent 场景）→ report → diagnosis → recommendations →
 * content opportunities → experiment → execution → frozen retest（mock 场景推荐品牌）
 * → 复测 run 完成（DB fixture 替代 worker）→ report → evaluation。
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

process.env.ENABLE_REAL_PROVIDERS = "false";
process.env.DEEPSEEK_API_KEY = "";
process.env.QWEN_API_KEY = "";

const M4 = "m4-rule-v1";
const OPP = "geolens-content-opportunity-v1";
const EXP = "geolens-experiment-v1";
const EVAL = "geolens-experiment-evaluation-v1";

const ABSENT_TEXT = (brand: string) => `推荐 Alpha 和 Beta，都不错。`;
const IMPROVED_TEXT = (brand: string) => `推荐 ${brand}，它适合商业计划书和答辩准备。也可以考虑 Alpha。`;

describe("Experiments M7D e2e", () => {
  let app: INestApplication;
  let owner: ReturnType<typeof request.agent>;
  let outsider: ReturnType<typeof request.agent>;
  let anon: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const password = "m7d-e2e-pass-123";
  const ids: Record<string, string> = {};
  const brand = "ProjectMentor";
  const queries = [
    { text: "创新创业比赛可以用什么 AI 工具？", category: "competition", intent: "工具发现" },
    { text: "商业计划书 AI 工具推荐", category: "workflow", intent: "场景推荐" },
    { text: "写商业计划书的 AI 有哪些", category: "tool-discovery", intent: "工具发现" },
  ];

  const mkEngine = async (key: string, scenario: string) =>
    prisma.engine.create({ data: { key: `m7d-${key}-${suffix}`, name: `M7D ${key}`, provider: "mock", config: { delayMs: 0, scenario } as never } });

  /** 完成一条 run：evidence + m4 analysis（flag 由调用方确定性给出）。 */
  async function completeRun(runId: string, opts: { text: string; brandMentioned: boolean; recommended: boolean; position: number | null; citations?: number }) {
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
        citations: {
          create: Array.from({ length: opts.citations ?? 0 }, (_, i) => ({ url: `https://example.com/${i}`, domain: "example.com", title: null, position: i + 1 })),
        },
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
      const mentioned = improved;
      await completeRun(taskRun.id, {
        text: mentioned ? IMPROVED_TEXT(brand) : ABSENT_TEXT(brand),
        brandMentioned: mentioned,
        recommended: mentioned && (improved || row.sortOrder % 2 === 0) ? true : mentioned,
        position: mentioned ? (row.sortOrder === 0 ? 3 : 1) : null,
        citations: mentioned ? 1 : 0,
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
    const a = await register(`exp-own-${suffix}@m7d.test.com`);
    const b = await register(`exp-oth-${suffix}@m7d.test.com`);
    ids.orgA = a.organization.id;
    ids.orgB = b.organization.id;
    await owner.post("/auth/login").send({ email: `exp-own-${suffix}@m7d.test.com`, password }).expect(200);
    await outsider.post("/auth/login").send({ email: `exp-oth-${suffix}@m7d.test.com`, password }).expect(200);

    const project = await prisma.project.create({ data: { organizationId: ids.orgA, name: `Exp A ${suffix}`, industry: "SaaS" } });
    ids.projectA = project.id;
    await prisma.brand.create({ data: { projectId: project.id, name: brand, aliases: [] } });
    const engAbsent = await mkEngine("alpha", "absent");
    const engImproved = await mkEngine("beta", "first");
    ids.engAbsent = engAbsent.id;
    ids.engImproved = engImproved.id;

    // suite（3 queries，含镜像 Query 行）
    const suite = await prisma.benchmarkSuite.create({ data: { projectId: project.id, name: `Exp Suite ${suffix}`, version: "1", status: "ACTIVE" } });
    ids.suite = suite.id;
    const querySet = await prisma.querySet.create({ data: { projectId: project.id, name: `Benchmark Auto: Exp Suite ${suffix} v1` } });
    for (const [i, q] of queries.entries()) {
      const query = await prisma.query.create({ data: { projectId: project.id, querySetId: querySet.id, text: q.text, type: "CUSTOM", source: "IMPORTED", status: "PAUSED", language: "zh-CN" } });
      await prisma.benchmarkQuery.create({ data: { suiteId: suite.id, projectQueryId: query.id, queryText: q.text, category: q.category, intent: q.intent, locale: "zh-CN", sortOrder: i, enabled: true, sanity: false } });
    }

    // Before run（正式 API 编排）+ 完成
    const beforeRun = await owner.post(`/benchmark-suites/${suite.id}/runs`).send({ engineId: engAbsent.id, runType: "demo" }).expect(202);
    ids.runBefore = beforeRun.body.id;
    await finishBenchmarkRun(ids.runBefore, false);
    const reportA = await owner.post(`/benchmark-runs/${ids.runBefore}/reports`).send({ analysisVersion: M4 }).expect(201);
    ids.reportBefore = reportA.body.id;

    const diag = await owner.post(`/reports/${ids.reportBefore}/diagnoses`).send({}).expect(201);
    ids.diag = diag.body.id;
    const rec = await owner.post(`/diagnoses/${ids.diag}/recommendations`).send({}).expect(201);
    ids.recRun = rec.body.id;
    const opp = await owner.post(`/recommendation-runs/${ids.recRun}/opportunities`).expect(201);
    const oppList = await owner.get(`/opportunity-runs/${opp.body.id}/opportunities`).expect(200);
    ids.oppId = oppList.body.opportunities[0].id;

    // tenant B project（隔离对照）
    const projectB = await prisma.project.create({ data: { organizationId: ids.orgB, name: `Exp B ${suffix}` } });
    ids.projectB = projectB.id;
  }, 120000);

  afterAll(async () => {
    try {
      for (const orgId of [ids.orgA, ids.orgB]) {
        if (!orgId) continue;
        const projects = await prisma.project.findMany({ where: { organizationId: orgId }, select: { id: true } });
        // 先删 experiments（opp FK Restrict 需要实验先清）
        await prisma.optimizationExperiment.deleteMany({ where: { project: { organizationId: orgId } } });
        await prisma.experimentEvaluation.deleteMany({ where: { experiment: { project: { organizationId: orgId } } } });
        await prisma.experimentRetest.deleteMany({ where: { experiment: { project: { organizationId: orgId } } } });
        await prisma.experimentExecution.deleteMany({ where: { experiment: { project: { organizationId: orgId } } } });
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
        for (const p of projects) {
          await prisma.benchmarkReport.deleteMany({ where: { projectId: p.id } });
          await prisma.analysis.deleteMany({ where: { evidence: { run: { monitorTask: { projectId: p.id } } } } });
          await prisma.evidence.deleteMany({ where: { run: { monitorTask: { projectId: p.id } } } });
          await prisma.run.deleteMany({ where: { monitorTask: { projectId: p.id } } });
          await prisma.benchmarkRun.deleteMany({ where: { projectId: p.id } });
          await prisma.monitorTask.deleteMany({ where: { projectId: p.id } });
          await prisma.benchmarkSuite.deleteMany({ where: { projectId: p.id } });
          await prisma.benchmarkQuery.deleteMany({ where: { suite: { projectId: p.id } } });
          await prisma.query.deleteMany({ where: { projectId: p.id } });
          await prisma.querySet.deleteMany({ where: { projectId: p.id } });
          await prisma.brand.deleteMany({ where: { projectId: p.id } });
          await prisma.project.deleteMany({ where: { id: p.id } });
        }
        await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
        await prisma.organization.deleteMany({ where: { id: orgId } });
      }
      await prisma.engine.deleteMany({ where: { id: { in: [ids.engAbsent, ids.engImproved] } } });
      await prisma.user.deleteMany({ where: { email: { contains: "@m7d.test.com" } } });
    } finally {
      await app.close();
      await prisma.$disconnect();
    }
  });

  it("create experiment：201 + version + baseline + fingerprint + demo 标注", async () => {
    const res = await owner.post(`/content-opportunities/${ids.oppId}/experiments`).expect(201);
    const exp = res.body;
    ids.exp = exp.id;
    expect(exp.experimentVersion).toBe(EXP);
    expect(exp.status).toBe("PLANNED");
    expect(exp.baselineReportId).toBe(ids.reportBefore);
    expect(exp.metricSource).toBe("demo");
    expect(exp.provider).toBe("mock");
    expect(exp.querySetFingerprint).toBeTruthy();
    expect(exp.plannedQueryCount).toBe(3);
    expect(exp.hypothesis).toContain("可能");
    expect(exp.hypothesis).not.toContain("一定提升");
  });

  it("create experiment 幂等：同 opportunity+version+baseline 返回既有", async () => {
    const again = await owner.post(`/content-opportunities/${ids.oppId}/experiments`).expect(201);
    expect(again.body.id).toBe(ids.exp);
    expect(again.body.reused).toBe(true);
  });

  it("execution：早于 baseline 被拒（时序 guard）", async () => {
    const before = await owner.get(`/experiments/${ids.exp}`).expect(200);
    await owner.post(`/experiments/${ids.exp}/executions`).send({
      executionType: "MANUAL_CONTENT_UPDATE",
      changeSummary: "过早的执行记录",
      executedAt: new Date(Date.now() - 3600_000).toISOString(),
    }).expect(400);
    expect(before.body.status).toBe("PLANNED");
  });

  it("record execution → EXECUTION_RECORDED（用户确认语义）", async () => {
    const at = new Date(Date.now() + 60_000).toISOString();
    const res = await owner.post(`/experiments/${ids.exp}/executions`).send({
      executionType: "MANUAL_CONTENT_UPDATE",
      changeSummary: "演示：补充工具发现类产品定义与场景说明。",
      assetType: "USE_CASE_PAGE",
      assetReference: "https://example.com/use-cases",
      executedAt: at,
    }).expect(201);
    expect(res.body.status).toBe("RECORDED");
    expect(res.body.assetReference).toContain("https://example.com");
    const exp = await owner.get(`/experiments/${ids.exp}`).expect(200);
    expect(exp.body.status).toBe("EXECUTION_RECORDED");
    expect(exp.body.executionRecordedAt).toBeTruthy();
  });

  it("retest before execution rejected（独立 opp 的新实验）", async () => {
    // 用第二个内容机会建实验（无执行）
    const runs = await owner.get(`/recommendation-runs/${ids.recRun}/opportunities`).expect(200);
    const otherOppList = await owner.get(`/opportunity-runs/${runs.body[0].id}/opportunities`).expect(200);
    const otherOpp = otherOppList.body.opportunities.find((x: any) => x.id !== ids.oppId) ?? otherOppList.body.opportunities[0];
    const exp2 = await owner.post(`/content-opportunities/${otherOpp.id}/experiments`).expect(201);
    ids.expNoExec = exp2.body.id;
    const retest = await owner.post(`/experiments/${exp2.body.id}/retests`).expect(400);
    expect(retest.body.message).toContain("先记录");
    // 无效流转：直接 EVALUATED → 400
    await owner.patch(`/experiments/${exp2.body.id}/status`).send({ status: "EVALUATED" }).expect(400);
    // cancel
    const cancelled = await owner.patch(`/experiments/${exp2.body.id}/status`).send({ status: "CANCELLED" }).expect(200);
    expect(cancelled.body.status).toBe("CANCELLED");
    // 再取消 → 400
    await owner.patch(`/experiments/${exp2.body.id}/status`).send({ status: "CANCELLED" }).expect(400);
  });

  it("retest-plan 只读预览：queryCount/provider/expected calls", async () => {
    const plan = await owner.post(`/experiments/${ids.exp}/retest-plan`).expect(201);
    expect(plan.body.queryCount).toBe(3);
    expect(plan.body.expectedCallCount).toBe(3);
    expect(plan.body.provider).toBe("mock");
    expect(plan.body.metricSource).toBe("demo");
    expect(plan.body.querySetFingerprint).toBe(plan.body.querySetFingerprint);
  });

  it("frozen retest：复用基线快照（指纹一致），状态 RUNNING", async () => {
    const res = await owner.post(`/experiments/${ids.exp}/retests`).expect(201);
    const retest = res.body;
    ids.retest1 = retest.id;
    ids.runAfter = retest.benchmarkRunId;
    expect(retest.sequence).toBe(1);
    expect(retest.status).toBe("RUNNING");
    expect(retest.runType).toBe("DEMO");
    expect(retest.provider).toBe("mock");
    expect(retest.expectedCallCount).toBe(3);
    expect(retest.querySetFingerprint).toBeTruthy();
    const exp = await owner.get(`/experiments/${ids.exp}`).expect(200);
    expect(exp.body.status).toBe("RETEST_RUNNING");
    // 基线快照未变：当前 BenchmarkQuery 即便被编辑，复测仍用快照（下一测试覆盖 run 完成后）
    const beforeFp = await owner.post(`/experiments/${ids.exp}/retest-plan`).expect(201);
    expect(beforeFp.body.querySetFingerprint).toBeTruthy();
  });

  it("multiple retests allowed（第二次复测独立记录）", async () => {
    const res = await owner.post(`/experiments/${ids.exp}/retests`).expect(201);
    ids.retest2 = res.body.id;
    expect(res.body.sequence).toBe(2);
    expect(res.body.id).not.toBe(ids.retest1);
  });

  it("完成复测 run（worker 由测试替身推进 mock Evidence/Analysis）后 terminal", async () => {
    await finishBenchmarkRun(ids.runAfter, true);
    const detail = await owner.get(`/experiment-retests/${ids.retest1}`).expect(200);
    expect(detail.body.live.terminal).toBe(true);
    expect(detail.body.live.succeededRuns).toBe(3);
  });

  it("evaluate：自动生成 After Report + Evaluation（CONTROLLED / IMPROVED_SIGNALS / pp 语义）", async () => {
    const res = await owner.post(`/experiment-retests/${ids.retest1}/evaluate`).expect(201);
    const ev = res.body;
    ids.eval = ev.id;
    expect(ev.evaluationVersion).toBe(EVAL);
    expect(ev.beforeReportId).toBe(ids.reportBefore);
    expect(ev.afterReportId).toBeTruthy();
    expect(ev.outcome).toBe("IMPROVED_SIGNALS");
    expect(ev.verdict).toBe("CONTROLLED_COMPARABLE");
    expect(ev.metricSource).toBe("demo");
    expect(ev.summary.queryCounts.gainedVisibility).toBe(3);
    const exp = await owner.get(`/experiments/${ids.exp}`).expect(200);
    expect(exp.body.status).toBe("EVALUATED");
    expect(exp.body.completedAt).toBeTruthy();
  });

  it("evaluation 幂等：同 retest+version 返回既有", async () => {
    const again = await owner.post(`/experiment-retests/${ids.retest1}/evaluate`).expect(201);
    expect(again.body.id).toBe(ids.eval);
    expect(again.body.reused).toBe(true);
  });

  it("metric deltas：visibility 用 pp（0 → 1.0 → +100pp），position direction 正确", async () => {
    const res = await owner.get(`/experiment-evaluations/${ids.eval}/metric-deltas`).expect(200);
    const deltas = res.body.metricDeltas;
    const vis = deltas.find((d: any) => d.metricName === "visibilityRate");
    expect(vis.deltaUnit).toBe("pp");
    expect(vis.deltaValue).toBe(100);
    expect(vis.beforeValue).toBe(0);
    expect(vis.direction).toBe("IMPROVED");
    const pos = deltas.find((d: any) => d.metricName === "averageMentionPosition");
    if (pos.beforeValue != null && pos.afterValue != null && pos.deltaValue != null) {
      expect(pos.direction).toBe("IMPROVED"); // 数字变小 = 提升
    }
    // 不存在相对 % 的单元
    for (const d of deltas) expect(["pp", "position", "count"]).toContain(d.deltaUnit);
  });

  it("query deltas：3 条 GAINED_VISIBILITY + Evidence A/B 链接", async () => {
    const res = await owner.get(`/experiment-evaluations/${ids.eval}/query-deltas`).expect(200);
    const qs = res.body.queryDeltas;
    expect(qs.length).toBe(3);
    for (const q of qs) {
      expect(q.transitionType).toBe("GAINED_VISIBILITY");
      expect(q.beforeEvidenceId).toBeTruthy();
      expect(q.afterEvidenceId).toBeTruthy();
      expect(q.beforeMentioned).toBe(false);
      expect(q.afterMentioned).toBe(true);
    }
    const qd = qs[0];
    const ev = await owner.get(`/experiment-query-deltas/${qd.id}/evidence`).expect(200);
    expect(ev.body.before.evidenceId).toBe(qd.beforeEvidenceId);
    expect(ev.body.after.evidenceId).toBe(qd.afterEvidenceId);
    expect(ev.body.before).not.toHaveProperty("rawResponse");
    expect(ev.body.after).not.toHaveProperty("rawResponse");
  });

  it("Evidence immutable：before/after rawResponse 未被评估链路改写", async () => {
    const qs = await owner.get(`/experiment-evaluations/${ids.eval}/query-deltas`).expect(200);
    const qd = qs.body.queryDeltas[0];
    const pair = await owner.get(`/experiment-query-deltas/${qd.id}/evidence`).expect(200);
    const before = await prisma.evidence.findUnique({ where: { id: pair.body.before.evidenceId } });
    const after = await prisma.evidence.findUnique({ where: { id: pair.body.after.evidenceId } });
    expect(before?.rawResponse).toContain("Alpha");
    expect(before?.rawResponse).not.toContain(brand);
    expect(after?.rawResponse).toContain(brand);
    expect(after?.sourceType).toBe("mock");
    expect(after?.retrievalMode).toBe("unknown");
  });

  it("evaluations list + get + counts", async () => {
    const list = await owner.get(`/experiments/${ids.exp}/evaluations`).expect(200);
    expect(list.body.evaluations.length).toBe(1);
    const one = await owner.get(`/experiment-evaluations/${ids.eval}`).expect(200);
    expect(one.body.metricDeltaCount).toBeGreaterThan(0);
    expect(one.body.queryDeltaCount).toBe(3);
  });

  it("tenant isolation：outsider 404；unauthorized 401", async () => {
    await outsider.get(`/experiments/${ids.exp}`).expect(404);
    await outsider.post(`/experiments/${ids.exp}/executions`).send({ executionType: "MANUAL_OTHER", changeSummary: "x", executedAt: new Date().toISOString() }).expect(404);
    await outsider.get(`/experiment-evaluations/${ids.eval}`).expect(404);
    await anon.get(`/experiments/${ids.exp}`).expect(401);
    await anon.post(`/content-opportunities/${ids.oppId}/experiments`).expect(401);
  });
});
