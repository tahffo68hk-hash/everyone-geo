import "../../../packages/database/scripts/test-env.cjs";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { prisma } from "@geo/database";
import { AppModule } from "../src/app.module";

process.env.ENABLE_REAL_PROVIDERS = "false";
process.env.EXTERNAL_PUBLISHING_ENABLED = "false";

describe("LOC-004 & LOC-005: 可信证据血缘与 Outcome/Attribution 多版本隔离 E2E", () => {
  let app: INestApplication;
  let http: any;
  let ownerAgent: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const password = "loc-outcome-pass-123";

  let orgId: string;
  let userId: string;
  let projId: string;
  let brandId: string;
  let query1Id: string;
  let query2NoBaselineId: string;
  let draftId: string;
  let revId: string;
  let assetId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    http = app.getHttpServer();

    // 1. 注册组织和用户
    const regRes = await request(http)
      .post("/auth/register")
      .send({ email: `loc-outcome-${suffix}@geo.test`, name: "LOC Outcome Owner", password })
      .expect(201);

    orgId = regRes.body.organization.id;
    userId = regRes.body.user.id;

    ownerAgent = request.agent(http);
    await ownerAgent
      .post("/auth/login")
      .send({ email: `loc-outcome-${suffix}@geo.test`, name: "LOC Outcome Owner", password })
      .expect(200);

    // 2. 项目与基础数据
    const proj = await prisma.project.create({
      data: { organizationId: orgId, name: `LOC Outcome Project ${suffix}` },
    });
    projId = proj.id;

    const brand = await prisma.brand.create({
      data: { projectId: projId, name: `Brand Outcome ${suffix}` },
    });
    brandId = brand.id;

    const q1 = await prisma.query.create({
      data: { projectId: projId, text: `最佳方案评测 ${suffix}` },
    });
    query1Id = q1.id;

    const q2 = await prisma.query.create({
      data: { projectId: projId, text: `无基线孤立问题 ${suffix}` },
    });
    query2NoBaselineId = q2.id;

    // 3. 草稿与版本
    const draft = await prisma.contentDraft.create({
      data: { organizationId: orgId, projectId: projId, title: `Outcome Draft ${suffix}`, createdById: userId },
    });
    draftId = draft.id;

    const rev = await prisma.contentRevision.create({
      data: { draftId: draft.id, version: 1, body: JSON.stringify({ content: "正文" }), generatedById: userId },
    });
    revId = rev.id;

    // 4. 落地资产 (已核验，发布时间为 2026-10-01)
    const asset = await prisma.publishedAsset.create({
      data: {
        organizationId: orgId,
        projectId: projId,
        draftId: draft.id,
        revisionId: rev.id,
        platform: "WECHAT",
        title: `Outcome Asset ${suffix}`,
        canonicalUrl: `https://mp.weixin.qq.com/s/outcome-${suffix}`,
        verificationStatus: "MANUAL_VERIFIED",
        actualPublishedAt: new Date("2026-10-01T12:00:00Z"),
        publicationTimeSource: "MANUAL_EVIDENCED",
      },
    });
    assetId = asset.id;

    // 5. 为 query1 创建基线 Evidence (发布前 2026-09-20)
    let engine = await prisma.engine.findFirst({ where: { provider: "mock" } });
    if (!engine) {
      engine = await prisma.engine.create({
        data: {
          key: `mock-engine-${suffix}`,
          name: "Mock Baseline Engine",
          provider: "mock",
          config: {},
        },
      });
    }

    const baselineTask = await prisma.monitorTask.create({
      data: {
        organizationId: orgId,
        projectId: projId,
        totalRuns: 1,
        status: "SUCCEEDED",
        completedRuns: 1,
      },
    });

    const baselineRun = await prisma.run.create({
      data: {
        monitorTaskId: baselineTask.id,
        queryId: query1Id,
        engineId: engine.id,
        status: "SUCCEEDED",
      },
    });

    const baselineEvidence = await prisma.evidence.create({
      data: {
        runId: baselineRun.id,
        queryText: `最佳方案评测 ${suffix}`,
        rawPrompt: `Query: 最佳方案评测 ${suffix}`,
        rawResponse: "历史基线内容：未提及该品牌",
        provider: "mock",
        engineKey: engine.key,
        engineName: engine.name,
        model: "mock-model",
        retrievalMode: "api_plain",
        sourceType: "mock",
        metadata: {},
        entitySnapshot: {},
        createdAt: new Date("2026-09-20T10:00:00Z"),
      },
    });

    await prisma.analysis.create({
      data: {
        evidenceId: baselineEvidence.id,
        analysisVersion: "v1",
        brandMentioned: false,
        recommended: false,
        sentiment: "neutral",
      },
    });
  });

  afterAll(async () => {
    await prisma.outcomeAttribution.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.outcomeComparison.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.retestItem.deleteMany({ where: { retestRun: { organizationId: orgId } } }).catch(() => {});
    await prisma.retestRun.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.analysis.deleteMany({ where: { evidence: { run: { monitorTask: { organizationId: orgId } } } } }).catch(() => {});
    await prisma.evidence.deleteMany({ where: { run: { monitorTask: { organizationId: orgId } } } }).catch(() => {});
    await prisma.run.deleteMany({ where: { monitorTask: { organizationId: orgId } } }).catch(() => {});
    await prisma.monitorTask.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.publishedAsset.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.contentRevision.deleteMany({ where: { draftId } }).catch(() => {});
    await prisma.contentDraft.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.query.deleteMany({ where: { projectId: projId } }).catch(() => {});
    await prisma.brand.deleteMany({ where: { projectId: projId } }).catch(() => {});
    await prisma.project.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    await app.close();
  });

  describe("LOC-004: 可信 Retest Evidence 来源防护与真实血缘 (Provenance)", () => {
    test("1. F1-009 拦截：Mock 提供商不可伪造 official_api 来源", async () => {
      const res = await ownerAgent
        .post(`/published-assets/${assetId}/retests`)
        .send({
          provider: "mock",
          sourceType: "official_api",
          queryIds: [query1Id],
          autoExecute: false,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Mock Provider 仅允许 mock 来源类型");
    });

    test("2. F1-009 拦截：Mock 提供商不可伪造 browser 来源", async () => {
      const res = await ownerAgent
        .post(`/published-assets/${assetId}/retests`)
        .send({
          provider: "mock",
          sourceType: "browser",
          queryIds: [query1Id],
          autoExecute: false,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Mock Provider 仅允许 mock 来源类型");
    });

    test("3. F1-010 拦截：普通纯模型 API (api_plain) 不可伪造 browser 来源", async () => {
      process.env.ENABLE_REAL_PROVIDERS = "true";
      try {
        const res = await ownerAgent
          .post(`/published-assets/${assetId}/retests`)
          .send({
            provider: "deepseek",
            retrievalMode: "api_plain",
            sourceType: "browser",
            queryIds: [query1Id],
            autoExecute: false,
          });

        expect(res.status).toBe(400);
        expect(res.body.message).toContain("普通模型 API (api_plain) 文本输出不能冒充真实网页浏览器或消费者搜索端来源 (F1-010)");
      } finally {
        process.env.ENABLE_REAL_PROVIDERS = "false";
      }
    });

    test("4. 合法执行并持久化可信 Provenance 元数据与 isSynthetic 标识", async () => {
      const res = await ownerAgent
        .post(`/published-assets/${assetId}/retests`)
        .send({
          provider: "mock",
          sourceType: "mock",
          queryIds: [query1Id],
          autoExecute: true,
          forceNew: true,
        })
        .expect(201);

      expect(res.body.status).toBe("COMPLETED");
      expect(res.body.items).toHaveLength(1);
      const item = res.body.items[0];
      expect(item.evidenceId).toBeDefined();

      // 验证生成的证据中的元数据
      const evidence = await prisma.evidence.findUnique({
        where: { id: item.evidenceId },
      });
      expect(evidence).toBeDefined();
      expect(evidence?.sourceType).toBe("mock");

      const meta = (evidence?.metadata as Record<string, any>) || {};
      expect(meta.publishedAssetId).toBe(assetId);
      expect(meta.retestRunId).toBe(res.body.id);
      expect(meta.retestItemId).toBe(item.id);
      expect(meta.verifiedSource).toBe("mock");
      expect(meta.provenance).toBe("MOCK_SYNTHETIC");

      // 验证 structuredCitations 带有 isSynthetic 标识
      if (meta.structuredCitations) {
        const citations = meta.structuredCitations as any[];
        expect(citations.length).toBeGreaterThan(0);
        expect(citations[0].isSynthetic).toBe(true);
      }
    });
  });

  describe("LOC-005: Outcome/Attribution 多版本隔离与指标纯净性", () => {
    let retestRunId: string;
    let v1ComparisonId: string;
    let v2ComparisonId: string;

    beforeAll(async () => {
      // 创建一个完成的 RetestRun 供对比和归因使用
      const runRes = await ownerAgent
        .post(`/published-assets/${assetId}/retests`)
        .send({
          provider: "mock",
          sourceType: "mock",
          queryIds: [query1Id],
          autoExecute: true,
          forceNew: true,
        })
        .expect(201);

      retestRunId = runRes.body.id;
    });

    test("5. 生成默认版本 (v1) 的 OutcomeComparison 与 OutcomeAttribution", async () => {
      // 生成 Comparison
      const compRes = await ownerAgent
        .post(`/retests/${retestRunId}/outcomes`)
        .send({ comparisonVersion: "v1" })
        .expect(200);

      expect(compRes.body.comparisonVersion).toBe("v1");
      expect(compRes.body.items).toHaveLength(1);
      v1ComparisonId = compRes.body.items[0].id;
      expect(compRes.body.items[0].comparisonVersion).toBe("v1");

      // 生成 Attribution
      const attrRes = await ownerAgent
        .post(`/outcomes/${v1ComparisonId}/attribution`)
        .send({ attributionVersion: "v1" })
        .expect(200);

      expect(attrRes.body.id).toBeDefined();
      expect(attrRes.body.attributionVersion).toBe("v1");
      expect(attrRes.body.outcomeComparisonId).toBe(v1ComparisonId);
    });

    test("6. 生成版本 v2，验证双版本严格隔离与防重复统计 (F2-009)", async () => {
      // 生成 v2 Comparison
      const compResV2 = await ownerAgent
        .post(`/retests/${retestRunId}/outcomes`)
        .send({ comparisonVersion: "v2" })
        .expect(200);

      expect(compResV2.body.comparisonVersion).toBe("v2");
      expect(compResV2.body.items).toHaveLength(1);
      v2ComparisonId = compResV2.body.items[0].id;
      expect(v2ComparisonId).not.toBe(v1ComparisonId);

      // 生成 v2 Attribution
      const attrResV2 = await ownerAgent
        .post(`/outcomes/${v2ComparisonId}/attribution`)
        .send({ attributionVersion: "v2" })
        .expect(200);

      expect(attrResV2.body.attributionVersion).toBe("v2");

      // 按版本单独查询 Comparison
      const v1QueryRes = await ownerAgent
        .get(`/retests/${retestRunId}/outcomes?version=v1`)
        .expect(200);
      expect(v1QueryRes.body.comparisonVersion).toBe("v1");
      expect(v1QueryRes.body.items).toHaveLength(1);
      expect(v1QueryRes.body.items[0].id).toBe(v1ComparisonId);

      const v2QueryRes = await ownerAgent
        .get(`/retests/${retestRunId}/outcomes?version=v2`)
        .expect(200);
      expect(v2QueryRes.body.comparisonVersion).toBe("v2");
      expect(v2QueryRes.body.items).toHaveLength(1);
      expect(v2QueryRes.body.items[0].id).toBe(v2ComparisonId);

      // 验证 Workspace 聚合统计：指定版本时统计总数严格为 1，杜绝笛卡尔积膨胀
      const wsV1Res = await ownerAgent
        .get(`/published-assets/${assetId}/outcome-workspace?retestRunId=${retestRunId}&comparisonVersion=v1&attributionVersion=v1`)
        .expect(200);

      expect(wsV1Res.body.activeRetestRun).toBeDefined();
      expect(wsV1Res.body.activeRetestRun.comparabilitySummary.totalItems).toBe(1);
      expect(wsV1Res.body.activeRetestRun.attributionSummary.totalOutcomes).toBe(1);
      expect(wsV1Res.body.activeRetestRun.queryRows).toHaveLength(1);
      expect(wsV1Res.body.activeRetestRun.queryRows[0].outcome.comparisonVersion).toBe("v1");
      expect(wsV1Res.body.activeRetestRun.queryRows[0].attribution.attributionVersion).toBe("v1");

      // 验证 v2 Workspace 单版本纯净
      const wsV2Res = await ownerAgent
        .get(`/published-assets/${assetId}/outcome-workspace?retestRunId=${retestRunId}&comparisonVersion=v2&attributionVersion=v2`)
        .expect(200);

      expect(wsV2Res.body.activeRetestRun.comparabilitySummary.totalItems).toBe(1);
      expect(wsV2Res.body.activeRetestRun.attributionSummary.totalOutcomes).toBe(1);
      expect(wsV2Res.body.activeRetestRun.queryRows).toHaveLength(1);
      expect(wsV2Res.body.activeRetestRun.queryRows[0].outcome.comparisonVersion).toBe("v2");
      expect(wsV2Res.body.activeRetestRun.queryRows[0].attribution.attributionVersion).toBe("v2");
    });

    test("7. F2-010 保护：无基线 (MISSING_BASELINE) 时严禁伪造正向改善，归因为 INSUFFICIENT_EVIDENCE", async () => {
      // 为 query2NoBaselineId 执行 Retest
      const runRes = await ownerAgent
        .post(`/published-assets/${assetId}/retests`)
        .send({
          provider: "mock",
          sourceType: "mock",
          queryIds: [query2NoBaselineId],
          autoExecute: true,
          forceNew: true,
        })
        .expect(201);

      // 生成对比
      const compRes = await ownerAgent
        .post(`/retests/${runRes.body.id}/outcomes`)
        .send({ comparisonVersion: "v1" })
        .expect(200);

      const comparison = compRes.body.items[0];
      expect(comparison.baselineCompatibility).toBe("MISSING_BASELINE");
      expect(comparison.comparisonStatus).toBe("MISSING_BASELINE");

      // 生成归因
      const attrRes = await ownerAgent
        .post(`/outcomes/${comparison.id}/attribution`)
        .send({ attributionVersion: "v1" })
        .expect(200);

      // 必须归因为 INSUFFICIENT_EVIDENCE，绝不能误判为 LIKELY_RELATED
      expect(attrRes.body.status).toBe("INSUFFICIENT_EVIDENCE");
      expect(attrRes.body.observedChangeType).toBe("NO_CHANGE");
    });
  });
});
