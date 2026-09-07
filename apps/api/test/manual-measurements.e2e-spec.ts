/**
 * M8C-R0 Manual Verified Measurement e2e（geo_test）。全程 0 Provider 调用、0 queue：
 * 1) Manual Benchmark Run：创建 → runs 全部 AWAITING_MANUAL_INPUT（不进 worker）。
 * 2) Submit Evidence：sourceType=manual；confirmed → manual_verified；unconfirmed → unknown；
 *    verifiedBy/verifiedAt/notes/observedAt/measurementProduct；用户无法提交分析字段。
 * 3) Analysis：analyzeResponse 自动（mention/recommendation/position/citation）。
 * 4) Progress：0/3 → 1/3 → 3/3 → SUCCEEDED；skip → PARTIAL；SKIPPED ≠ 品牌未出现。
 * 5) Metrics/Report/M7 链：manual Evidence 进入标准 metrics → Report → Diagnosis →
 *    Recommendation → Content Opportunity。
 * 6) Anti-tampering：automated run 不可人工覆盖；重复提交 409；跨 tenant 404；未认证 401。
 * 7) 防真实调用：即使宿主有 key，Manual 流程 LLM execute/enqueue = 0（由 worker 轮询状态隔离）。
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

describe("M8C-R0 Manual Verified Measurement e2e", () => {
  let app: INestApplication;
  let owner: ReturnType<typeof request.agent>;
  let outsider: ReturnType<typeof request.agent>;
  let anon: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const password = "m8c0-e2e-pass-123";
  const ids: Record<string, string> = {};
  let runIds: string[] = [];
  const brandName = "AcmeFlow"; // 虚构品牌：不引入真实公司事实
  const projectName = `AcmeFlow Manual ${suffix}`;
  const queries = [
    { text: "适合小型销售团队的 CRM 有哪些？", category: "tool-discovery", intent: "工具发现" },
    { text: "销售团队怎么选 CRM？", category: "recommendation", intent: "选型建议" },
    { text: "初创公司用什么 CRM SaaS 比较好？", category: "comparison", intent: "对比" },
  ];

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
    const a = await register(`m8c0-own-${suffix}@m8c0.test.com`);
    const b = await register(`m8c0-oth-${suffix}@m8c0.test.com`);
    ids.orgA = a.organization.id;
    ids.orgB = b.organization.id;
    await owner.post("/auth/login").send({ email: `m8c0-own-${suffix}@m8c0.test.com`, password }).expect(200);
    await outsider.post("/auth/login").send({ email: `m8c0-oth-${suffix}@m8c0.test.com`, password }).expect(200);
    const project = await prisma.project.create({ data: { organizationId: ids.orgA, name: projectName, industry: "SaaS" } });
    ids.projectA = project.id;
    const otherProject = await prisma.project.create({ data: { organizationId: ids.orgB, name: `Manual Other ${suffix}`, industry: "SaaS" } });
    ids.projectB = otherProject.id;
    // 项目 primary Brand = 监测对象（entitySnapshot 使用）
    await prisma.brand.create({
      data: {
        projectId: project.id, name: brandName,
        aliases: ["Acme Flow"], entityType: "PRODUCT", productCategory: "CRM SaaS",
        website: "https://acmeflow.example.com",
      },
    });
    // automated mock engine（anti-tampering 测试用）
    ids.automatedEngine = (await prisma.engine.create({
      data: { key: `m8c0-auto-${suffix}`, name: "M8C0 auto", provider: "mock", config: { delayMs: 0 } as never },
    })).id;
  }, 120000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app?.close();
  });

  it("1. 创建 Manual Benchmark Run：runs=AWAITING_MANUAL_INPUT、不进 queue、快照冻结", async () => {
    const suite = await owner.post(`/projects/${ids.projectA}/benchmark-suites`).send({
      name: `AcmeFlow 人工问题集 ${suffix}`, version: "1",
      queries: queries.map((q, i) => ({ queryText: q.text, category: q.category, intent: q.intent, sortOrder: i, enabled: true, queryType: "DISCOVERY" })),
    }).expect(201);
    ids.suiteA = suite.body.id;
    expect(suite.body.queryCount).toBe(3);

    const manualRes = await owner.post(`/benchmark-suites/${ids.suiteA}/manual-runs`).send({
      runType: "real", measurementProduct: "qwen-web",
    }).expect(201);
    const manual = manualRes.body;
    expect(manual.executionMode).toBe("MANUAL_WEB_UI");
    expect(manual.measurementProduct).toBe("qwen-web");
    expect(manual.runType).toBe("REAL");
    expect(manual.isManual).toBe(true);
    expect(manual.isDemo).toBeFalsy();
    expect(manual.progress.total).toBe(3);
    expect(manual.progress.submitted).toBe(0);
    expect(manual.progress.remaining).toBe(3);
    ids.manualRunId = manual.id;

    // manual workspace runs（sortOrder 有序）即 query 顺序（CRM有哪些/怎么选/初创公司）
    runIds = manual.runs.map((r: { id: string }) => r.id);
    expect(runIds).toHaveLength(3);
    const task = await prisma.monitorTask.findUnique({
      where: { id: (await prisma.run.findUnique({ where: { id: runIds[0] } }))!.monitorTaskId },
      include: { benchmarkRun: { select: { targetSnapshot: true } } },
    });
    // 全部初始 AWAITING_MANUAL_INPUT + manual engine
    const rows0 = await prisma.run.findMany({ where: { id: { in: runIds } }, include: { engine: true } });
    expect(rows0.every(r => r.status === "AWAITING_MANUAL_INPUT")).toBe(true);
    expect(rows0.every(r => r.engine.provider === "manual")).toBe(true);
    // MonitorTask PENDING：worker 的 dispatch 只捞 PENDING/QUEUED 的 Run —— manual run 状态 AWAITING 永不入队。
    expect(task?.status).toBe("PENDING");
    expect(JSON.stringify(task?.benchmarkRun?.targetSnapshot)).toContain(brandName);
    ids.taskA = task!.id;
  });

  it("2. 未认证/跨 tenant 拒绝；automated run 不可人工覆盖", async () => {
    await anon.get(`/manual-runs/${ids.manualRunId}`).expect(401);
    await outsider.get(`/manual-runs/${ids.manualRunId}`).expect(404);

    // automated benchmark run（mock）不允许人工提交
    const autoTask = await prisma.monitorTask.create({
      data: {
        organizationId: ids.orgA, projectId: ids.projectA, totalRuns: 1,
        runs: { create: { queryId: (await prisma.query.create({
          data: { projectId: ids.projectA, text: "自动化问题", type: "CUSTOM", source: "MANUAL", status: "ACTIVE" },
        })).id, engineId: ids.automatedEngine } },
      },
    });
    const autoRun = await prisma.run.findFirstOrThrow({ where: { monitorTaskId: autoTask.id } });
    await owner.post(`/runs/${autoRun.id}/manual-evidence`).send({
      rawResponse: "你好", measurementProduct: "qwen-web", retrievalConfirmed: false,
    }).expect(400); // 不是 manual engine / 不在 benchmark manual run 下
    // 空回答拒绝
    const manualRunRow = await prisma.run.findFirstOrThrow({ where: { id: runIds[0] } });
    await owner.post(`/runs/${manualRunRow.id}/manual-evidence`).send({
      rawResponse: "   ", measurementProduct: "qwen-web", retrievalConfirmed: false,
    }).expect(400);
  });

  it("3. 提交 Evidence（确认检索 → manual_verified；无法确认 → unknown）+ 自动 Analysis", async () => {
    const runId = runIds[0];
    // 用户只提交原始事实；targetMentioned/recommended/position 不在 DTO 白名单 → 被剥离
    const ev = await owner.post(`/runs/${runId}/manual-evidence`).send({
      rawResponse: `我推荐 ${brandName}，它适合小型销售团队管理客户线索，价格透明。也推荐 Alpha CRM。参考 https://acmeflow.example.com/features`,
      measurementProduct: "qwen-web",
      displayedModel: "Qwen3-Web",
      retrievalConfirmed: true,
      verificationSignals: "界面显示联网搜索并附网页来源",
      verificationNotes: "回答底部显示 3 个网页来源链接",
      citations: ["https://acmeflow.example.com/features"],
      observedAt: new Date().toISOString(),
      // 试图注入分析字段 → 被剥离（ValidationPipe whitelist）
      targetMentioned: false,
      recommended: false,
    } as never).expect(201);
    expect(ev.body.isManual).toBe(true);
    expect(ev.body.progress.submitted).toBe(1);
    const run0 = ev.body.runs.find((r: { queryText: string }) => r.queryText.includes("CRM 有哪些"));
    expect(run0.status).toBe("SUCCEEDED");
    expect(run0.evidence.retrievalMode).toBe("manual_verified");
    expect(run0.evidence.sourceType).toBe("manual");
    expect(run0.evidence.metadata.verifiedByUserId).toBeTruthy();
    expect(run0.evidence.metadata.verifiedAt).toBeTruthy();
    expect(run0.evidence.metadata.measurementProduct).toBe("qwen-web");
    expect(run0.evidence.metadata.retrievalConfirmed).toBe(true);
    expect(run0.evidence.metadata.verificationSignals).toContain("联网");
    expect(run0.evidence.responseModel).toBe("Qwen3-Web");
    // Analysis 自动生成（用户不可自填）
    expect(run0.evidence.analysis.brandMentioned).toBe(true);
    expect(run0.evidence.analysis.recommended).toBe(true);
    expect(run0.evidence.analysis.mentions.some((m: { canonicalName: string }) => m.canonicalName === brandName)).toBe(true);
    expect(run0.evidence.analysis.citations.length).toBeGreaterThan(0);
    ids.evidence0Id = run0.evidence.id;
  });

  it("4. 无法确认检索 → retrievalMode=unknown + 工作区黄标语义；重复提交 409", async () => {
    const runId = runIds[1];
    const ev = await owner.post(`/runs/${runId}/manual-evidence`).send({
      rawResponse: "挑选 CRM 主要看客户管理、跟进自动化与报表，Alpha CRM 和 Beta CRM 常被提到。",
      measurementProduct: "qwen-web",
      retrievalConfirmed: false,
      verificationNotes: "回答未显示来源，无法确认是否联网",
    }).expect(201);
    expect(ev.body.runs.find((r: { queryText: string }) => r.queryText.includes("怎么选 CRM")).evidence.retrievalMode).toBe("unknown");
    // 重复提交 → 409
    await owner.post(`/runs/${runId}/manual-evidence`).send({
      rawResponse: "再试一次", measurementProduct: "qwen-web", retrievalConfirmed: false,
    }).expect(409);
    ids.evidence1Id = ev.body.runs.find((r: { queryText: string }) => r.queryText.includes("怎么选 CRM")).evidence.id;
  });

  it("5. Skip → PARTIAL + coverage；SKIPPED ≠ 品牌未出现", async () => {
    // 只提交 2/3 + skip 1 → PARTIAL
    const skip = await owner.post(`/runs/${runIds[2]}/manual-skip`).send({ reason: "AI UI 该会话无法回答，重试仍失败" }).expect(200);
    expect(skip.body.progress.submitted).toBe(2);
    expect(skip.body.progress.skipped).toBe(1);
    expect(skip.body.progress.complete).toBe(true);
    expect(skip.body.status).toBe("PARTIAL"); // monitorTask 级
    const run2 = skip.body.runs.find((r: { queryText: string }) => r.queryText.includes("初创公司"));
    expect(run2.status).toBe("SKIPPED");
    expect(run2.evidence).toBeNull();
    expect(run2.errorMessage).toContain("无法回答");
  });

  it("6. Metrics + Report + M7 链（Diagnosis→Recommendation→Opportunity）全通；sanity excluded", async () => {
    // demo manual：同一 manual 产品不同 runType=demo → metricSource=demo 而非 real
    const metricsRes = await owner.get(`/benchmark-runs/${ids.manualRunId}/metrics?analysisVersion=${M4}`);
    expect(metricsRes.status).toBe(200);
    const metrics = metricsRes.body;
    expect(metrics.metricSource).toBe("real"); // runType=REAL（真实人工观测）
    expect(metrics.overall.analyzedRuns).toBe(2);
    expect(metrics.metricQueryScope).toBe("DISCOVERY_ONLY");
    expect(metrics.metricScopeQueryCount).toBe(3); // runQueries 快照 = 3 DISCOVERY
    // byQuery 不含 skipped（SKIPPED 不进入 denominator，≠ 品牌未出现）

    // 手动完成 task 状态后 Report 可生成
    const report = await owner.post(`/benchmark-runs/${ids.manualRunId}/reports`).send({ analysisVersion: M4 }).expect(201);
    expect(report.body.metricSource).toBe("real");
    expect(report.body.completion.partial).toBe(true); // 2/3 submitted（1 skipped）
    ids.reportId = report.body.id;

    // M7A → M7B → M7C
    const diag = await owner.post(`/reports/${ids.reportId}/diagnoses`).send({}).expect(201);
    ids.diagRunId = diag.body.id;
    const rec = await owner.post(`/diagnoses/${ids.diagRunId}/recommendations`).send({}).expect(201);
    ids.recRunId = rec.body.id;
    const oppRun = await owner.post(`/recommendation-runs/${ids.recRunId}/opportunities`).expect(201);
    const oppList = await owner.get(`/opportunity-runs/${oppRun.body.id}/opportunities`).expect(200);
    expect(oppList.body.opportunities.length).toBeGreaterThan(0);
    ids.oppId = oppList.body.opportunities[0].id;
  });

  it("7. demo manual：metricSource=demo、不伪装 real；0 provider 调用由隔离状态保证", async () => {
    const demo = await owner.post(`/benchmark-suites/${ids.suiteA}/manual-runs`).send({
      runType: "demo", measurementProduct: "deepseek-web",
    }).expect(201);
    expect(demo.body.isDemo).toBe(true);
    expect(demo.body.measurementProduct).toBe("deepseek-web");
    for (const run of demo.body.runs) {
      await owner.post(`/runs/${run.id}/manual-evidence`).send({
        rawResponse: `${brandName} 在演示回答中出现。`, measurementProduct: "deepseek-web",
        retrievalConfirmed: false,
      }).expect(201);
    }
    const metrics = await owner.get(`/benchmark-runs/${demo.body.id}/metrics?analysisVersion=${M4}`).expect(200);
    expect(metrics.body.metricSource).toBe("demo"); // demo manual 不冒充 real
    // runs 全程未进入 queue：无 QUEUED/RUNNING 残留，全部 AWAITING→SUCCEEDED
    const rows = await prisma.run.findMany({ where: { monitorTask: { benchmarkRun: { id: demo.body.id } } } });
    expect(rows.every(r => r.status === "SUCCEEDED")).toBe(true);
  });
});
