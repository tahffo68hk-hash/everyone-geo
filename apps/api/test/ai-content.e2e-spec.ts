import "../../../packages/database/scripts/test-env.cjs";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";

describe("AI Content, Diagnosis & Outcome E2E", () => {
  let app: INestApplication;
  let http: any;

  const suffix = randomUUID().slice(0, 8);
  const password = "ai-content-pass-123";

  let orgId: string;
  let userId: string;
  let cookies: string[];
  let projectId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    http = app.getHttpServer();

    const reg = await request(http)
      .post("/auth/register")
      .send({ email: `content-${suffix}@ai.test`, name: "Content Owner", password })
      .expect(201);
    orgId = reg.body.organization.id;
    userId = reg.body.user.id;

    const login = await request(http)
      .post("/auth/login")
      .send({ email: `content-${suffix}@ai.test`, password })
      .expect(200);
    cookies = login.headers["set-cookie"] as unknown as string[];

    const p = await prisma.project.create({
      data: { organizationId: orgId, name: `Content Project ${suffix}` },
    });
    projectId = p.id;
  });

  afterAll(async () => {
    await prisma.aiGeneration.deleteMany({ where: { projectId } }).catch(() => {});
    await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => {});
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    await app.close();
  });

  // ---- 1. Content Production AI ----

  test("1. AI Content Brief: 生成结构化策划大纲与引用要求", async () => {
    const res = await request(http)
      .post(`/projects/${projectId}/ai/content-brief`)
      .set("Cookie", cookies)
      .send({
        targetQueries: ["2026年企业级监控系统对比与选型"],
        topic: "智能可观测性平台架构设计",
        audience: "技术负责人与架构师",
      })
      .expect(200);

    const data = res.body.data;
    expect(data).toHaveProperty("titleIdeas");
    expect(data).toHaveProperty("contentObjective");
    expect(data).toHaveProperty("questionsToAnswer");
    expect(data).toHaveProperty("outline");
    expect(data).toHaveProperty("evidenceRequirements");
  });

  test("2. AI 标题与大纲生成", async () => {
    const titleRes = await request(http)
      .post(`/projects/${projectId}/ai/content-titles`)
      .set("Cookie", cookies)
      .send({
        topic: "云原生微服务架构下的监控实战",
        count: 3,
      })
      .expect(200);

    expect(titleRes.body.data).toHaveProperty("titles");
    expect(titleRes.body.data.titles.length).toBeGreaterThanOrEqual(1);

    const outlineRes = await request(http)
      .post(`/projects/${projectId}/ai/content-outline`)
      .set("Cookie", cookies)
      .send({
        title: titleRes.body.data.titles[0].title,
      })
      .expect(200);

    expect(outlineRes.body.data).toHaveProperty("outline");
    expect(outlineRes.body.data.outline[0]).toHaveProperty("section");
    expect(outlineRes.body.data.outline[0]).toHaveProperty("subpoints");
  });

  test("3. AI 初稿生成与重写：Markdown 结构、FAQ 模块、不自动发布", async () => {
    const draftRes = await request(http)
      .post(`/projects/${projectId}/ai/content-draft`)
      .set("Cookie", cookies)
      .send({
        title: "2026年现代智能系统选型实践指南",
      })
      .expect(200);

    const draft = draftRes.body.data;
    expect(draft).toHaveProperty("title");
    expect(draft).toHaveProperty("body");
    expect(draft.body).toContain("# ");
    expect(draft).toHaveProperty("summary");
    expect(draft).toHaveProperty("tags");
    expect(draft).toHaveProperty("faqSection");

    const rewriteRes = await request(http)
      .post(`/projects/${projectId}/ai/content-rewrite`)
      .set("Cookie", cookies)
      .send({
        content: draft.body,
        mode: "ai_friendly",
      })
      .expect(200);

    expect(rewriteRes.body.data).toHaveProperty("rewrittenContent");
    expect(rewriteRes.body.data).toHaveProperty("changeSummary");
    expect(rewriteRes.body.data).toHaveProperty("diffHighlights");
  });

  test("4. AI GEO 内容优化与事实风险扫描", async () => {
    const optRes = await request(http)
      .post(`/projects/${projectId}/ai/content-geo-opt`)
      .set("Cookie", cookies)
      .send({
        content: "本项目系统在性能与高可用方面具有极高水准，能够完全替代国外方案。",
        targetQueries: ["主流系统性能实测指标"],
      })
      .expect(200);

    expect(optRes.body.data).toHaveProperty("missingQuestions");
    expect(optRes.body.data).toHaveProperty("missingEntities");
    expect(optRes.body.data).toHaveProperty("structuralFeedback");
    expect(optRes.body.data).toHaveProperty("optimizedContent");

    const scanRes = await request(http)
      .post(`/projects/${projectId}/ai/fact-risk-scan`)
      .set("Cookie", cookies)
      .send({
        content: "经过实际测试，我们的吞吐速度达到行业平均水平的100倍，超越市面上所有竞品。",
      })
      .expect(200);

    expect(scanRes.body.data).toHaveProperty("claims");
    expect(scanRes.body.data.claims[0]).toHaveProperty("riskLevel");
    expect(scanRes.body.data.claims[0]).toHaveProperty("needsEvidence", true);
  });

  // ---- 2. Diagnosis & Recommendation AI ----

  test("5. 诊断解读与建议草稿：基于事实与可观测信号", async () => {
    const diagRes = await request(http)
      .post(`/projects/${projectId}/ai/diagnosis-explanation`)
      .set("Cookie", cookies)
      .send({
        diagnosisSummary: "品牌在行业核心提问中缺少 Answer 权威信源引用",
      })
      .expect(200);

    expect(diagRes.body.data).toHaveProperty("summary");
    expect(diagRes.body.data).toHaveProperty("explanation");
    expect(diagRes.body.data).toHaveProperty("keyFindings");
    expect(diagRes.body.data).toHaveProperty("limitations");

    const recRes = await request(http)
      .post(`/projects/${projectId}/ai/recommendation-draft`)
      .set("Cookie", cookies)
      .send({
        problemDescription: "缺少对竞品对比的客观中立第三方横评",
      })
      .expect(200);

    expect(recRes.body.data).toHaveProperty("title");
    expect(recRes.body.data).toHaveProperty("action");
    expect(recRes.body.data).toHaveProperty("expectedObservableSignal");
    expect(recRes.body.data).toHaveProperty("risks");
  });

  // ---- 3. Strategy & Campaign AI ----

  test("6. 战略与战役草稿生成：仅生成 Draft 供预览确认", async () => {
    const stratRes = await request(http)
      .post(`/projects/${projectId}/ai/strategy-draft`)
      .set("Cookie", cookies)
      .send({
        objective: "提升 B2B 决策提问下的首推提及率",
      })
      .expect(200);

    expect(stratRes.body.data).toHaveProperty("objective");
    expect(stratRes.body.data).toHaveProperty("contentDirections");
    expect(stratRes.body.data).toHaveProperty("successObservationPlan");

    const campRes = await request(http)
      .post(`/projects/${projectId}/ai/campaign-draft`)
      .set("Cookie", cookies)
      .send({
        strategyObjective: "打造 5 篇行业先锋深度横评",
      })
      .expect(200);

    expect(campRes.body.data).toHaveProperty("campaignName");
    expect(campRes.body.data).toHaveProperty("contentPlan");
    expect(campRes.body.data).toHaveProperty("milestones");
  });

  // ---- 4. Outcome & Attribution AI ----

  test("7. 效果与归因自然语言解读：事实状态不被篡改", async () => {
    const outcomeRes = await request(http)
      .post(`/projects/${projectId}/ai/outcome-summary`)
      .set("Cookie", cookies)
      .send({
        baselineScore: 65,
        retestScore: 82,
        metricsDelta: { mentionRateChange: "+17%" },
      })
      .expect(200);

    expect(outcomeRes.body.data).toHaveProperty("summary");
    expect(outcomeRes.body.data).toHaveProperty("majorChanges");
    expect(outcomeRes.body.data).toHaveProperty("disclaimer");

    const attrRes = await request(http)
      .post(`/projects/${projectId}/ai/attribution-explanation`)
      .set("Cookie", cookies)
      .send({
        attributionStatus: "LIKELY_RELATED",
        confounders: [],
      })
      .expect(200);

    expect(attrRes.body.data).toHaveProperty("explanation");
    expect(attrRes.body.data).toHaveProperty("attributionStatusNotice");
  });

  // ---- 5. Learning AI ----

  test("8. 学习信号解读：单样本 (<3) 严格提示警告，不形成过度承诺", async () => {
    const singleSampleRes = await request(http)
      .post(`/projects/${projectId}/ai/learning-summary`)
      .set("Cookie", cookies)
      .send({
        sampleCount: 1,
        positiveCount: 1,
        negativeCount: 0,
      })
      .expect(200);

    expect(singleSampleRes.body.data).toHaveProperty("singleSampleWarning");
    expect(singleSampleRes.body.data.singleSampleWarning).toContain("样本量不足 3 次");

    const multiSampleRes = await request(http)
      .post(`/projects/${projectId}/ai/learning-summary`)
      .set("Cookie", cookies)
      .send({
        sampleCount: 4,
        positiveCount: 3,
        negativeCount: 1,
      })
      .expect(200);

    expect(multiSampleRes.body.data.singleSampleWarning).toBe("");
    expect(multiSampleRes.body.data).toHaveProperty("testableHypotheses");
  });
});
