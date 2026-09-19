import "../../../packages/database/scripts/test-env.cjs";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";

describe("AI Query & GEO Intelligence E2E", () => {
  let app: INestApplication;
  let http: any;

  const suffix = randomUUID().slice(0, 8);
  const password = "ai-query-pass-123";

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
      .send({ email: `query-${suffix}@ai.test`, name: "Query Owner", password })
      .expect(201);
    orgId = reg.body.organization.id;
    userId = reg.body.user.id;

    const login = await request(http)
      .post("/auth/login")
      .send({ email: `query-${suffix}@ai.test`, password })
      .expect(200);
    cookies = login.headers["set-cookie"] as unknown as string[];

    const p = await prisma.project.create({
      data: { organizationId: orgId, name: `GEO Project ${suffix}` },
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

  test("1. AI 创建问题集：严格遵守 Discovery 不含品牌名、Branded 独立归类", async () => {
    const brandName = "NovaMetric";
    const res = await request(http)
      .post(`/projects/${projectId}/ai/query-set`)
      .set("Cookie", cookies)
      .send({
        brandName,
        productName: "NovaPulse",
        category: "智能运维监测",
        targetAudience: "SRE 与 DevOps 工程师",
        queryCount: 5,
      })
      .expect(200);

    expect(res.body.data).toHaveProperty("querySetName");
    expect(res.body.data).toHaveProperty("queries");
    const queries = res.body.data.queries;
    expect(queries.length).toBeGreaterThanOrEqual(3);

    // 核心约束检验：
    for (const q of queries) {
      if (q.queryType === "DISCOVERY") {
        expect(q.text.toLowerCase()).not.toContain(brandName.toLowerCase());
      }
      if (q.queryType === "BRANDED") {
        expect(["品牌基线", "BRANDED", "品牌直接认知"]).toContain(q.category);
      }
    }
  });

  test("2. AI Query 扩展：多维度生成长尾/选型问题", async () => {
    const res = await request(http)
      .post(`/projects/${projectId}/ai/query-expansion`)
      .set("Cookie", cookies)
      .send({
        existingQueries: ["智能运维工具有哪些推荐？", "如何搭建自愈式监控告警系统？"],
        count: 3,
        focusAngle: "偏向中小型团队选型与成本",
      })
      .expect(200);

    expect(res.body.data).toHaveProperty("expandedQueries");
    const expanded = res.body.data.expandedQueries;
    expect(expanded.length).toBeGreaterThanOrEqual(2);
    expect(expanded[0]).toHaveProperty("text");
    expect(expanded[0]).toHaveProperty("rationale");
  });

  test("3. AI Query 重写：提供 natural, decision 等多意图重写建议", async () => {
    const res = await request(http)
      .post(`/projects/${projectId}/ai/query-rewrite`)
      .set("Cookie", cookies)
      .send({
        queryText: "哪家监控告警最好用",
        mode: "decision",
      })
      .expect(200);

    expect(res.body.data).toHaveProperty("originalQuery", "哪家监控告警最好用");
    expect(res.body.data).toHaveProperty("rewrittenQueries");
    expect(res.body.data.rewrittenQueries.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.rewrittenQueries[0]).toHaveProperty("explanation");
  });

  test("4. AI Query 分类：辅助意图与分类判断", async () => {
    const res = await request(http)
      .post(`/projects/${projectId}/ai/query-classify`)
      .set("Cookie", cookies)
      .send({
        queryText: "2026年开源可观测性方案成本对比",
      })
      .expect(200);

    expect(res.body.data).toHaveProperty("intent");
    expect(res.body.data).toHaveProperty("category");
    expect(res.body.data).toHaveProperty("queryType");
    expect(res.body.data).toHaveProperty("confidence");
  });

  test("5. GEO 主题与实体挖掘：严禁伪造虚假搜索量或指数", async () => {
    const res = await request(http)
      .post(`/projects/${projectId}/ai/geo-topics`)
      .set("Cookie", cookies)
      .send({
        brandName: "NovaMetric",
        category: "智能运维监测",
        siteContent: "致力于提供全栈式高可用监控与智能根因定位平台",
      })
      .expect(200);

    const data = res.body.data;
    expect(data).toHaveProperty("coreTopics");
    expect(data).toHaveProperty("geoTopics");
    expect(data).toHaveProperty("entities");
    expect(data).toHaveProperty("comparisonDimensions");
    expect(data).toHaveProperty("decisionDimensions");

    // 关键安全断言：不含伪造的真实搜索量或竞价数字
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("searchVolume");
    expect(serialized).not.toContain("cpcPrice");
    expect(serialized).not.toContain("baiduIndex");
  });

  test("6. GEO 关键词提取与意图分析", async () => {
    const res = await request(http)
      .post(`/projects/${projectId}/ai/geo-keywords`)
      .set("Cookie", cookies)
      .send({
        topic: "云原生环境下的全链路可观测性建设",
        count: 5,
      })
      .expect(200);

    expect(res.body.data).toHaveProperty("keywords");
    const keywords = res.body.data.keywords;
    expect(keywords.length).toBeGreaterThanOrEqual(1);
    expect(keywords[0]).toHaveProperty("keyword");
    expect(keywords[0]).toHaveProperty("importance");
  });

  test("7. GEO 语义覆盖与缺口分析：带有 AI 分析明确声明", async () => {
    const res = await request(http)
      .post(`/projects/${projectId}/ai/keyword-gap`)
      .set("Cookie", cookies)
      .send({
        projectQueries: ["微服务监控告警系统推荐"],
        competitorNames: ["Datadog", "Dynatrace"],
        evidenceNotes: ["竞品在高可用性与自动根因定位方面被高频引用"],
      })
      .expect(200);

    expect(res.body.data).toHaveProperty("gaps");
    expect(res.body.data).toHaveProperty("disclaimer", "AI semantic analysis");
  });

  test("8. 语义智能聚类 (AI Cluster)", async () => {
    const res = await request(http)
      .post(`/projects/${projectId}/ai/cluster`)
      .set("Cookie", cookies)
      .send({
        items: [
          "微服务链路追踪实战",
          "OpenTelemetry 落地避坑指南",
          "企业级监控系统价格对比",
          "自建与商业 SaaS TCO 综合测算",
        ],
        type: "query",
        clusterCount: 2,
      })
      .expect(200);

    expect(res.body.data).toHaveProperty("clusters");
    const clusters = res.body.data.clusters;
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    expect(clusters[0]).toHaveProperty("clusterName");
    expect(clusters[0]).toHaveProperty("members");
    expect(clusters[0]).toHaveProperty("recommendedUse");
  });
});
