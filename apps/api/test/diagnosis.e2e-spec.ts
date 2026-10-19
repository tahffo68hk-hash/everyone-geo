/**
 * M7A GEO Diagnosis e2e（真实 PostgreSQL geo_test）。
 * fixture 全直连落库（Evidence+Analysis 手工构造），生成 Report 走 API（m4/m6b 均可），
 * Diagnosis 走 API。全程 0 次真实 Provider 调用。
 */
import "../../../packages/database/scripts/test-env.cjs";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";
import { M6B_ANALYSIS_VERSION } from "../src/competitors/competitors.service";

const M4 = "m4-rule-v1";
const DIAG = "geolens-diagnosis-v2";
const SEV_W = { HIGH: 100, MEDIUM: 60, LOW: 30, INFO: 10 } as Record<string, number>;

interface AnalysisSpec {
  version: string;
  brandMentioned: boolean;
  mentionPosition?: number | null;
  recommended?: boolean;
  sentiment?: string;
  competitorSetId?: string | null;
  competitor?: { entityId: string; canonicalName: string; sentiment: string } | null;
}
interface RunSpec {
  projectId: string; taskId: string; bRunId: string; engineId: string; provider: string;
  runStatus?: "SUCCEEDED" | "FAILED";
  sanity?: boolean;
  analyses?: AnalysisSpec[];
}

describe("Diagnosis M7A e2e", () => {
  let app: INestApplication;
  let owner: ReturnType<typeof request.agent>;
  let outsider: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const password = "m7a-e2e-pass-123";
  const ids: Record<string, string> = {};
  const seq = { n: 0 };

  const mkEngine = async (key: string, provider: string, config: Record<string, unknown> = {}) =>
    prisma.engine.create({ data: { key, name: key, provider, config: config as never } });

  async function addRun(spec: RunSpec) {
    const query = await prisma.query.create({ data: { projectId: spec.projectId, text: `q ${seq.n} ${randomUUID()}` } });
    const run = await prisma.run.create({ data: {
      monitorTaskId: spec.taskId, queryId: query.id, engineId: spec.engineId,
      status: spec.runStatus ?? "SUCCEEDED",
      analysisStatus: (spec.analyses?.length ?? 0) > 0 ? "SUCCEEDED" : "PENDING",
      executionToken: randomUUID(),
    } });
    await prisma.benchmarkRunQuery.create({ data: {
      benchmarkRunId: spec.bRunId, benchmarkQueryId: randomUUID(), projectQueryId: query.id,
      queryText: query.text, category: ["tool-discovery", "comparison"][seq.n % 2],
      intent: `intent ${seq.n}`, locale: "zh-CN", sortOrder: seq.n, sanity: spec.sanity ?? false,
    } });
    seq.n += 1;
    const evidence = await prisma.evidence.create({ data: {
      runId: run.id, queryText: query.text, rawPrompt: "{}", rawResponse: `response ${query.text}`,
      provider: spec.provider, engineKey: spec.engineId, engineName: "Engine",
      model: spec.provider === "mock" ? "geolens-mock" : spec.provider === "deepseek" ? "deepseek-v4-flash" : "qwen-plus",
      modelVersion: null, retrievalMode: "unknown", sourceType: (spec.provider === "mock" ? "mock" : "official_api") as never,
      metadata: {}, entitySnapshot: [],
    } });
    for (const a of spec.analyses ?? []) {
      await prisma.analysis.create({ data: {
        evidenceId: evidence.id, analysisVersion: a.version,
        brandMentioned: a.brandMentioned, mentionPosition: a.mentionPosition ?? null,
        recommended: a.recommended ?? false, sentiment: (a.sentiment ?? "neutral") as never,
        competitorSetId: a.competitorSetId ?? undefined,
        competitorSetVersion: a.competitorSetId ? "1" : undefined,
        mentions: a.competitor ? {
          create: [{
            entityType: "competitor", entityId: a.competitor.entityId,
            canonicalName: a.competitor.canonicalName, displayName: a.competitor.canonicalName,
            position: 1, context: "ctx", sentiment: a.competitor.sentiment as never,
            startOffset: 0, endOffset: 1,
          }],
        } : undefined,
      } });
    }
    return { query, run, evidence };
  }

  async function mkBenchmark(args: {
    organizationId: string; projectId: string; engineId: string; provider: string;
    suiteName?: string; suiteVersion?: string; status?: string; count: number;
  }) {
    const suite = await prisma.benchmarkSuite.create({ data: {
      projectId: args.projectId,
      name: args.suiteName ?? `Diagnosis Suite ${randomUUID().slice(0, 6)}`,
      version: args.suiteVersion ?? "1", status: "ACTIVE",
    } });
    const task = await prisma.monitorTask.create({ data: {
      organizationId: args.organizationId, projectId: args.projectId,
      status: (args.status ?? "SUCCEEDED") as never, totalRuns: args.count,
      completedRuns: args.count, failedRuns: 0,
    } });
    const bRun = await prisma.benchmarkRun.create({ data: {
      organizationId: args.organizationId, projectId: args.projectId, suiteId: suite.id,
      suiteName: suite.name, suiteVersion: suite.version,
      runType: args.provider === "mock" ? "DEMO" : "REAL",
      provider: args.provider, engineId: args.engineId, monitorTaskId: task.id,
      status: "SUCCEEDED" as never, plannedRuns: args.count, completedRuns: args.count, failedRuns: 0,
      metadata: {},
    } });
    return { suite, task, bRun };
  }

  const makeReport = (bRunId: string, analysisVersion: string) =>
    owner.post(`/benchmark-runs/${bRunId}/reports`).send({ analysisVersion });

  const makeDiagnosis = (reportId: string, body: Record<string, unknown> = {}) =>
    owner.post(`/reports/${reportId}/diagnoses`).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    owner = request.agent(app.getHttpServer());
    outsider = request.agent(app.getHttpServer());

    const register = async (email: string) => {
      const res = await request(app.getHttpServer()).post("/auth/register").send({ email, name: "D", password });
      expect(res.status).toBe(201);
      return res.body as { user: { id: string }; organization: { id: string } };
    };
    const a = await register(`diag-own-${suffix}@m7a.test.com`);
    const b = await register(`diag-oth-${suffix}@m7a.test.com`);
    ids.orgA = a.organization.id;
    ids.orgB = b.organization.id;
    await owner.post("/auth/login").send({ email: `diag-own-${suffix}@m7a.test.com`, password }).expect(200);
    await outsider.post("/auth/login").send({ email: `diag-oth-${suffix}@m7a.test.com`, password }).expect(200);
    const projectA = await prisma.project.create({ data: { organizationId: ids.orgA, name: `Diag A ${suffix}`, industry: "SaaS" } });
    ids.projectA = projectA.id;
    const projectB = await prisma.project.create({ data: { organizationId: ids.orgB, name: `Diag B ${suffix}`, industry: "SaaS" } });
    ids.projectB = projectB.id;

    // ---- tenant A: m4 demo（6 evidence：4 提及(1 推荐,位置 1/1/5/5) + 2 缺席）----
    const mock = await mkEngine(`m7a-mock-${suffix}`, "mock", { delayMs: 0 });
    ids.engMock = mock.id;
    const demo = await mkBenchmark({ organizationId: ids.orgA, projectId: ids.projectA, engineId: mock.id, provider: "mock", count: 6 });
    ids.runDemo = demo.bRun.id;
    const m4 = (mentioned: boolean, rec: boolean, pos: number | null = null) => ({
      version: M4, brandMentioned: mentioned, mentionPosition: pos, recommended: rec, sentiment: "neutral",
    });
    for (let i = 0; i < 4; i++) await addRun({ projectId: ids.projectA, taskId: demo.task.id, bRunId: demo.bRun.id, engineId: mock.id, provider: "mock", analyses: [m4(true, i === 0, i < 2 ? 1 : 5)] });
    for (let i = 0; i < 2; i++) await addRun({ projectId: ids.projectA, taskId: demo.task.id, bRunId: demo.bRun.id, engineId: mock.id, provider: "mock", analyses: [m4(false, false)] });
    const demoRep = await makeReport(ids.runDemo, M4);
    expect(demoRep.status).toBe(201);
    ids.reportDemo = demoRep.body.id;

    // ---- tenant A: m6b demo（竞品集：3 evidence 品牌缺席但 ChatGPT positive）----
    const set = await prisma.competitorSet.create({ data: {
      projectId: ids.projectA, name: `PM Set ${suffix}`, version: "1", status: "ACTIVE",
      entries: { create: [{ candidateId: randomUUID(), canonicalName: "ChatGPT", aliases: ["ChatGPT"], competitorType: "DIRECT", sortOrder: 0 }] },
    } });
    ids.set1 = set.id;
    const cand = await prisma.competitorCandidate.create({ data: {
      projectId: ids.projectA, canonicalName: "ChatGPT", normalizedName: "chatgpt", aliases: ["ChatGPT"],
      status: "APPROVED", competitorType: "DIRECT", firstSeenAt: new Date(), lastSeenAt: new Date(),
      evidenceCount: 3, queryCount: 3, mentionCount: 3, recommendationCount: 0, metadata: {},
    } });
    ids.cand = cand.id;
    await prisma.competitorSet.update({ where: { id: set.id }, data: { entries: { deleteMany: {}, create: [{ candidateId: cand.id, canonicalName: "ChatGPT", aliases: ["ChatGPT"], competitorType: "DIRECT", sortOrder: 0 }] } } });
    const comp = await mkBenchmark({ organizationId: ids.orgA, projectId: ids.projectA, engineId: mock.id, provider: "mock", count: 3 });
    ids.runComp = comp.bRun.id;
    for (let i = 0; i < 3; i++) {
      await addRun({
        projectId: ids.projectA, taskId: comp.task.id, bRunId: comp.bRun.id, engineId: mock.id, provider: "mock",
        analyses: [{ version: M6B_ANALYSIS_VERSION, brandMentioned: false, recommended: false, sentiment: "positive", competitorSetId: set.id, competitor: { entityId: cand.id, canonicalName: "ChatGPT", sentiment: "positive" } }],
      });
    }
    const compRep = await makeReport(ids.runComp, M6B_ANALYSIS_VERSION);
    expect(compRep.status).toBe(201);
    ids.reportComp = compRep.body.id;

    // ---- tenant A: provider 对比（real）：deepseek vis 0.8 vs qwen vis 0.2（同 suite v1）----
    const ds = await mkEngine(`m7a-ds-${suffix}`, "deepseek", { model: "deepseek-chat" });
    const qw = await mkEngine(`m7a-qw-${suffix}`, "qwen", { model: "qwen-plus" });
    ids.engDs = ds.id; ids.engQw = qw.id;
    const runDs = await mkBenchmark({ organizationId: ids.orgA, projectId: ids.projectA, engineId: ds.id, provider: "deepseek", suiteVersion: "1", count: 5 });
    ids.runDs = runDs.bRun.id;
    for (let i = 0; i < 5; i++) await addRun({ projectId: ids.projectA, taskId: runDs.task.id, bRunId: runDs.bRun.id, engineId: ds.id, provider: "deepseek", analyses: [m4(i < 4, true, i < 4 ? 1 : null)] });
    const runQw = await mkBenchmark({ organizationId: ids.orgA, projectId: ids.projectA, engineId: qw.id, provider: "qwen", suiteVersion: "1", count: 5 });
    ids.runQw = runQw.bRun.id;
    for (let i = 0; i < 5; i++) await addRun({ projectId: ids.projectA, taskId: runQw.task.id, bRunId: runQw.bRun.id, engineId: qw.id, provider: "qwen", analyses: [m4(i < 1, true, i < 1 ? 1 : null)] });
    const dsRep = await makeReport(ids.runDs, M4);
    expect(dsRep.status).toBe(201);
    ids.reportDs = dsRep.body.id;
    const qwRep = await makeReport(ids.runQw, M4);
    expect(qwRep.status).toBe(201);
    ids.reportQw = qwRep.body.id;

    // ---- tenant A: suite v2（口径失配对照）----
    const v2 = await mkBenchmark({ organizationId: ids.orgA, projectId: ids.projectA, engineId: mock.id, provider: "mock", suiteName: "Version2 Suite", suiteVersion: "2", count: 2 });
    ids.runV2 = v2.bRun.id;
    for (let i = 0; i < 2; i++) await addRun({ projectId: ids.projectA, taskId: v2.task.id, bRunId: v2.bRun.id, engineId: mock.id, provider: "mock", analyses: [m4(true, true, 1)] });
    const v2Rep = await makeReport(ids.runV2, M4);
    expect(v2Rep.status).toBe(201);
    ids.reportV2 = v2Rep.body.id;

    // ---- tenant B: m4 demo（隔离对照）----
    const mockB = await mkEngine(`m7a-mockB-${suffix}`, "mock", { delayMs: 0 });
    ids.engMockB = mockB.id;
    const runB = await mkBenchmark({ organizationId: ids.orgB, projectId: ids.projectB, engineId: mockB.id, provider: "mock", count: 2 });
    ids.runB = runB.bRun.id;
    for (let i = 0; i < 2; i++) await addRun({ projectId: ids.projectB, taskId: runB.task.id, bRunId: runB.bRun.id, engineId: mockB.id, provider: "mock", analyses: [m4(true, true, 1)] });
    const repB = await outsider.post(`/benchmark-runs/${ids.runB}/reports`).send({ analysisVersion: M4 });
    expect(repB.status).toBe(201);
    ids.reportB = repB.body.id;
  }, 120000);

  afterAll(async () => {
    try {
      for (const orgId of [ids.orgA, ids.orgB]) {
        if (!orgId) continue;
        await prisma.diagnosisFindingEvidence.deleteMany({ where: { finding: { diagnosisRun: { project: { organizationId: orgId } } } } });
        await prisma.diagnosisFinding.deleteMany({ where: { diagnosisRun: { project: { organizationId: orgId } } } });
        await prisma.diagnosisRun.deleteMany({ where: { project: { organizationId: orgId } } });
        await prisma.competitorSetEntry.deleteMany({ where: { competitorSet: { project: { organizationId: orgId } } } });
        await prisma.competitorSet.deleteMany({ where: { project: { organizationId: orgId } } });
        await prisma.competitorCandidate.deleteMany({ where: { project: { organizationId: orgId } } });
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
      await prisma.engine.deleteMany({ where: { id: { in: [ids.engMock, ids.engMockB, ids.engDs, ids.engQw].filter(Boolean) } } });
      await prisma.user.deleteMany({ where: { email: { contains: "@m7a.test.com" } } });
    } finally {
      await app.close();
      await prisma.$disconnect();
    }
  });

  // ---------------- 生成 / 幂等 / 结构 ----------------
  it("生成 Diagnosis（m4 demo）：201 + diagnosisVersion + DATA_QUALITY 演示提示", async () => {
    const res = await makeDiagnosis(ids.reportDemo);
    expect(res.status).toBe(201);
    const d = res.body;
    ids.diagDemo = d.id;
    expect(d.diagnosisVersion).toBe(DIAG);
    expect(d.status).toBe("READY");
    expect(d.secondaryReportId).toBeNull();
    expect(d.summary.severityCounts).toBeDefined();
    const list = await owner.get(`/reports/${ids.reportDemo}/diagnoses`).expect(200);
    expect(list.body.some((x: any) => x.id === d.id)).toBe(true);
    const get = await owner.get(`/diagnoses/${d.id}`).expect(200);
    expect(get.body.id).toBe(d.id);
  });

  it("幂等：同 report+version 重复 POST 返回既有 DiagnosisRun（不堆叠）", async () => {
    const before = await owner.get(`/reports/${ids.reportDemo}/diagnoses`).expect(200);
    const again = await makeDiagnosis(ids.reportDemo);
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(ids.diagDemo); // 幂等命中（既有 run）
    const after = await owner.get(`/reports/${ids.reportDemo}/diagnoses`).expect(200);
    expect(after.body.length).toBe(before.body.length);
  });

  it("findings：severity 计数一致 + 优先级排序精确 + Evidence 回链（不复制 rawResponse）", async () => {
    const f = await owner.get(`/diagnoses/${ids.diagDemo}/findings`).expect(200);
    const { findings, diagnosisRun } = f.body;
    expect(diagnosisRun.id).toBe(ids.diagDemo);
    const counts = { HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
    for (const item of findings) counts[item.severity as keyof typeof counts] += 1;
    expect(counts).toEqual(diagnosisRun.summary.severityCounts);
    // severity 权重非升序 → 同 severity 内 priority 非升序
    for (let i = 1; i < findings.length; i++) {
      const prev = findings[i - 1], cur = findings[i];
      if (SEV_W[prev.severity] === SEV_W[cur.severity]) {
        expect(cur.priorityScore).toBeLessThanOrEqual(prev.priorityScore);
      } else {
        expect(SEV_W[cur.severity]).toBeLessThanOrEqual(SEV_W[prev.severity]);
      }
    }
    // 至少有一条 finding 带 evidence links；全部不含 rawResponse 字段
    const withLink = findings.find((x: any) => x.evidence.length > 0);
    expect(withLink).toBeDefined();
    for (const item of findings) {
      expect(item).not.toHaveProperty("rawResponse");
      expect(item).not.toHaveProperty("rawPrompt");
      expect(item.explanation.length).toBeGreaterThan(0);
    }
    const detail = await owner.get(`/diagnosis-findings/${withLink.id}`).expect(200);
    expect(detail.body.evidence.length).toBe(withLink.evidence.length);
  });

  it("m4 report：DATA_QUALITY 演示 + LOW_RECOMMENDATION 出现；未启用竞对规则如实说明", async () => {
    const f = await owner.get(`/diagnoses/${ids.diagDemo}/findings`).expect(200);
    const types = f.body.findings.map((x: any) => x.findingType);
    expect(types).toContain("DATA_QUALITY_WARNING");
    expect(types).toContain("LOW_RECOMMENDATION");
    const dq = f.body.findings.find((x: any) => x.findingType === "DATA_QUALITY_WARNING" && x.title === "演示数据诊断");
    expect(dq).toBeDefined();
    expect(dq.severity).toBe("INFO");
    const meta = await owner.get(`/diagnoses/${ids.diagDemo}`).then(r => r.body.metadata);
    const supported = Object.fromEntries((meta.supportedFindingTypes as Array<{ findingType: string; supported: boolean }>).map(x => [x.findingType, x.supported]));
    expect(supported.COMPETITOR_DOMINANCE).toBe(false);
    expect(supported.COMPETITOR_RECOMMENDED_TARGET_ABSENT).toBe(false);
    expect(supported.PROVIDER_GAP).toBe(false);
  });

  it("品牌校验问题不进入自然发现诊断分母", async () => {
    const fixture = await mkBenchmark({
      organizationId: ids.orgA, projectId: ids.projectA, engineId: ids.engMock,
      provider: "mock", count: 5,
    });
    for (let i = 0; i < 3; i++) {
      await addRun({
        projectId: ids.projectA, taskId: fixture.task.id, bRunId: fixture.bRun.id,
        engineId: ids.engMock, provider: "mock", analyses: [
          { version: M4, brandMentioned: false, recommended: false },
        ],
      });
    }
    for (let i = 0; i < 2; i++) {
      await addRun({
        projectId: ids.projectA, taskId: fixture.task.id, bRunId: fixture.bRun.id,
        engineId: ids.engMock, provider: "mock", sanity: true, analyses: [
          { version: M4, brandMentioned: true, recommended: true, mentionPosition: 1 },
        ],
      });
    }
    const report = await makeReport(fixture.bRun.id, M4);
    expect(report.status).toBe(201);
    const diagnosis = await makeDiagnosis(report.body.id);
    expect(diagnosis.status).toBe(201);
    const result = await owner.get(`/diagnoses/${diagnosis.body.id}/findings`).expect(200);
    const visibility = result.body.findings.find((x: any) => x.findingType === "LOW_VISIBILITY");
    const sample = result.body.findings.find((x: any) => x.findingType === "DATA_QUALITY_WARNING" && x.title === "样本量较小");
    expect(visibility.summary).toContain("3 个已分析测试问题");
    expect(visibility.queryCount).toBe(3);
    expect(sample.summary).toContain("仅包含 3 个已分析测试问题");
    expect(sample.queryCount).toBe(3);
  });

  it("m6b report（竞品集）：CRTA + COMPETITOR_DOMINANCE 触发", async () => {
    const res = await makeDiagnosis(ids.reportComp);
    expect(res.status).toBe(201);
    ids.diagComp = res.body.id;
    const f = await owner.get(`/diagnoses/${ids.diagComp}/findings`).expect(200);
    const types = f.body.findings.map((x: any) => x.findingType);
    expect(types).toContain("COMPETITOR_RECOMMENDED_TARGET_ABSENT");
    expect(types).toContain("COMPETITOR_DOMINANCE");
    const crta = f.body.findings.find((x: any) => x.findingType === "COMPETITOR_RECOMMENDED_TARGET_ABSENT");
    expect(crta.competitorName).toBeNull(); // 聚合级（未绑定单一竞品）
    expect(crta.queryCount).toBe(3);
    expect(crta.evidence.length).toBeGreaterThan(0);
    const dom = f.body.findings.find((x: any) => x.findingType === "COMPETITOR_DOMINANCE");
    expect(dom.competitorName).toBe("ChatGPT");
    expect(dom.summary).toContain("ChatGPT");
  });

  it("诊断快照不可漂移：二次生成幂等命中，findings 与先前一致", async () => {
    const before = await owner.get(`/diagnoses/${ids.diagComp}/findings`).expect(200);
    await makeDiagnosis(ids.reportComp).expect(201); // 幂等 → 同一 run
    const after = await owner.get(`/diagnoses/${ids.diagComp}/findings`).expect(200);
    expect(after.body.findings.length).toBe(before.body.findings.length);
    expect(after.body.findings.map((x: any) => x.id).sort()).toEqual(before.body.findings.map((x: any) => x.id).sort());
  });

  // ---------------- Provider Gap ----------------
  it("PROVIDER_GAP：跨 Provider（deepseek 0.8 vs qwen 0.2）→ 触发", async () => {
    const res = await makeDiagnosis(ids.reportDs, { secondaryReportId: ids.reportQw });
    expect(res.status).toBe(201);
    const d = res.body;
    expect(d.secondaryReportId).toBe(ids.reportQw);
    const f = await owner.get(`/diagnoses/${d.id}/findings`).expect(200);
    const pg = f.body.findings.find((x: any) => x.findingType === "PROVIDER_GAP");
    expect(pg).toBeDefined();
    expect(pg.provider).toBe("qwen"); // 低可见率侧（qwen 20%）
  });

  it("invalid comparison：不同 suiteVersion → 400（NOT_COMPARABLE 拒绝）", async () => {
    const res = await makeDiagnosis(ids.reportV2, { secondaryReportId: ids.reportQw });
    expect(res.status).toBe(400);
  });

  it("无 secondary → 无 PROVIDER_GAP（supported=false）", async () => {
    const f = await owner.get(`/diagnoses/${ids.diagComp}/findings`).expect(200);
    expect(f.body.findings.some((x: any) => x.findingType === "PROVIDER_GAP")).toBe(false);
  });

  // ---------------- tenant / auth / isolation ----------------
  it("tenant isolation：outsider 访问 reportA 的诊断 → 404", async () => {
    await outsider.post(`/reports/${ids.reportDemo}/diagnoses`).send({}).expect(404);
    await outsider.get(`/diagnoses/${ids.diagDemo}`).expect(404);
    await outsider.get(`/reports/${ids.reportDemo}/diagnoses`).expect(404);
  });

  it("unauthorized：无登录 → 401", async () => {
    await request(app.getHttpServer()).post(`/reports/${ids.reportDemo}/diagnoses`).send({}).expect(401);
    await request(app.getHttpServer()).get(`/diagnoses/${ids.diagDemo}`).expect(401);
  });

  it("Evidence immutable：诊断生成不修改 Evidence（rawResponse 未变、UPDATE 被拒）", async () => {
    const ev = await prisma.evidence.findFirstOrThrow({ where: { provider: "mock", queryText: { contains: "q " } } });
    const rawBefore = ev.rawResponse;
    await makeDiagnosis(ids.reportDemo).expect(201);
    const evAfter = await prisma.evidence.findUniqueOrThrow({ where: { id: ev.id } });
    expect(evAfter.rawResponse).toBe(rawBefore);
    await expect(prisma.evidence.update({ where: { id: ev.id }, data: { rawResponse: "hacked" } })).rejects.toThrow(/immutable/i);
  });

  it("真实报告无「演示数据诊断」（Demo/Real 隔离）", async () => {
    const res = await makeDiagnosis(ids.reportDs); // real（deepseek）
    expect(res.status).toBe(201);
    const f = await owner.get(`/diagnoses/${res.body.id}/findings`).expect(200);
    expect(f.body.findings.some((x: any) => x.title === "演示数据诊断")).toBe(false);
  });

  it("错误 ID → 400（ParseUUIDPipe）；未知 report → 404", async () => {
    await owner.post(`/reports/not-a-uuid/diagnoses`).send({}).expect(400);
    await owner.post(`/reports/${randomUUID()}/diagnoses`).send({}).expect(404);
  });
});
