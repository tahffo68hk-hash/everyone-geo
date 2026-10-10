import "../../../packages/database/scripts/test-env.cjs";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { prisma, Channel } from "@geo/database";
import { AppModule } from "../src/app.module";

process.env.ENABLE_REAL_PROVIDERS = "false";
process.env.EXTERNAL_PUBLISHING_ENABLED = "false";

describe("LOC-002 & LOC-003 核心真实性与执行幂等 E2E", () => {
  let app: INestApplication;
  let http: any;
  let ownerAgent: ReturnType<typeof request.agent>;
  const suffix = randomUUID().slice(0, 8);
  const password = "loc-trust-pass-123";

  let orgId: string;
  let userId: string;
  let projA: string;
  let projB: string;
  let draftAId: string;
  let revAId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    http = app.getHttpServer();

    // 注册所有者用户与组织
    const regRes = await request(http)
      .post("/auth/register")
      .send({ email: `loc-owner-${suffix}@geo.test`, name: "LOC Owner", password })
      .expect(201);

    orgId = regRes.body.organization.id;
    userId = regRes.body.user.id;

    // 建立持久 cookie agent
    ownerAgent = request.agent(http);
    await ownerAgent
      .post("/auth/login")
      .send({ email: `loc-owner-${suffix}@geo.test`, name: "LOC Owner", password })
      .expect(200);

    // 建立两个同组织项目：A 和 B
    const pa = await prisma.project.create({
      data: { organizationId: orgId, name: `LOC Project A ${suffix}` },
    });
    projA = pa.id;

    const pb = await prisma.project.create({
      data: { organizationId: orgId, name: `LOC Project B ${suffix}` },
    });
    projB = pb.id;
  });

  afterAll(async () => {
    await prisma.monitorTask.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.retestRun.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.publishedAsset.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.contentPlanItem.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.contentStrategy.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.publication.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.channelAccountConnection.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.contentDraft.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.query.deleteMany({ where: { project: { organizationId: orgId } } }).catch(() => {});
    await prisma.brand.deleteMany({ where: { project: { organizationId: orgId } } }).catch(() => {});
    await prisma.project.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    await app.close();
  });

  describe("LOC-002: F1 真实发布资产与身份核验", () => {
    beforeAll(async () => {
      const d = await prisma.contentDraft.create({
        data: {
          organizationId: orgId,
          projectId: projA,
          title: `Draft A ${suffix}`,
          createdById: userId,
          generationMode: "AI_GENERATED",
        },
      });
      draftAId = d.id;

      const r = await prisma.contentRevision.create({
        data: {
          draftId: d.id,
          version: 1,
          body: JSON.stringify({ text: "内容正文" }),
          generatedById: userId,
        },
      });
      revAId = r.id;
    });

    test("1. 正常登记并记录真实发布时间 (actualPublishedAt) 与来源", async () => {
      const actualTime = "2026-10-01T15:30:00Z";
      const res = await ownerAgent
        .post(`/projects/${projA}/published-assets`)
        .send({
          projectId: projA,
          draftId: draftAId,
          revisionId: revAId,
          platform: "WECHAT",
          title: "微信已发布文章",
          canonicalUrl: "https://mp.weixin.qq.com/s/real-valid-article-123",
          verificationStatus: "MANUAL_VERIFIED",
          verificationNote: "人工确认文章在微信公众号公开发布",
          actualPublishedAt: actualTime,
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.verificationStatus).toBe("MANUAL_VERIFIED");
      expect(res.body.actualPublishedAt).toBe(new Date(actualTime).toISOString());
      expect(res.body.publicationTimeSource).toBe("MANUAL_EVIDENCED");
      expect(res.body.verifiedAt).toBeDefined();

      // 验证数据库直读
      const saved = await prisma.publishedAsset.findUnique({ where: { id: res.body.id } });
      expect(saved?.actualPublishedAt?.toISOString()).toBe(new Date(actualTime).toISOString());
      expect(saved?.publicationTimeSource).toBe("MANUAL_EVIDENCED");
    });

    test("2. 缺发布时间时保持明确的未知状态 (null)，不以 now 伪造 (F1-006)", async () => {
      const res = await ownerAgent
        .post(`/projects/${projA}/published-assets`)
        .send({
          projectId: projA,
          draftId: draftAId,
          revisionId: revAId,
          platform: "XIAOHONGSHU",
          title: "小红书未核验资产",
          verificationStatus: "UNVERIFIED",
          // 未提供 actualPublishedAt
        })
        .expect(201);

      expect(res.body.actualPublishedAt).toBeNull();
      expect(res.body.publicationTimeSource).toBe("UNKNOWN");

      const saved = await prisma.publishedAsset.findUnique({ where: { id: res.body.id } });
      expect(saved?.actualPublishedAt).toBeNull();
      expect(saved?.publicationTimeSource).toBe("UNKNOWN");
    });

    test("3. 拒绝未来时间与无时区非法时间", async () => {
      // 未来时间
      const futureRes = await ownerAgent
        .post(`/projects/${projA}/published-assets`)
        .send({
          projectId: projA,
          draftId: draftAId,
          revisionId: revAId,
          platform: "WECHAT",
          title: "未来时间资产",
          canonicalUrl: "https://example.com/asset-future",
          verificationStatus: "UNVERIFIED",
          actualPublishedAt: "2099-01-01T00:00:00Z",
        });
      expect(futureRes.status).toBe(400);

      // 无时区时间
      const badTzRes = await ownerAgent
        .post(`/projects/${projA}/published-assets`)
        .send({
          projectId: projA,
          draftId: draftAId,
          revisionId: revAId,
          platform: "WECHAT",
          title: "无时区资产",
          canonicalUrl: "https://example.com/asset-bad-tz",
          verificationStatus: "UNVERIFIED",
          actualPublishedAt: "2026-10-10 12:00:00",
        });
      expect(badTzRes.status).toBe(400);
    });

    test("4. 严格阻断跨项目规划项注入 (F1-001)", async () => {
      // 在项目 B 中创建策略与规划项
      const stratB = await prisma.contentStrategy.create({
        data: {
          organizationId: orgId,
          projectId: projB,
          title: `Strategy B ${suffix}`,
          geoGap: "Missing comparison content",
          targetAudience: "Developers",
          perceptionGoal: "Thought leader",
          createdById: userId,
        },
      });

      const planB = await prisma.contentPlanItem.create({
        data: {
          organizationId: orgId,
          projectId: projB,
          strategyId: stratB.id,
          title: `Plan B ${suffix}`,
          platform: "WECHAT",
          format: "ARTICLE",
          objective: "SEO",
          geoTarget: "CN",
        },
      });

      // 尝试在项目 A 登记资产时绑定项目 B 的 planItemId
      const res = await ownerAgent
        .post(`/projects/${projA}/published-assets`)
        .send({
          projectId: projA,
          draftId: draftAId,
          revisionId: revAId,
          platform: "WECHAT",
          title: "跨项目注入尝试",
          verificationStatus: "UNVERIFIED",
          planItemId: planB.id,
        });

      // 必须被 404/400 拒绝，不能接受
      expect(res.status).toBe(404);

      // 确认数据库没有被跨项目关联的记录
      const illegal = await prisma.publishedAsset.findFirst({
        where: { projectId: projA, planItemId: planB.id },
      });
      expect(illegal).toBeNull();
    });

    test("5. 发布记录与草稿/版本错配拦截 (F1-002)", async () => {
      // 创建渠道连接
      const conn = await prisma.channelAccountConnection.create({
        data: {
          organizationId: orgId,
          channel: Channel.WECHAT,
          displayName: `WeChat Conn ${suffix}`,
          createdById: userId,
        },
      });

      // 创建草稿 2 和版本 2
      const d2 = await prisma.contentDraft.create({
        data: { organizationId: orgId, projectId: projA, title: `Draft 2 ${suffix}`, createdById: userId },
      });
      const r2 = await prisma.contentRevision.create({
        data: {
          draftId: d2.id,
          version: 1,
          body: "{}",
          generatedById: userId,
        },
      });

      // 创建一个绑定草稿 2 的 Publication
      const pub2 = await prisma.publication.create({
        data: {
          organizationId: orgId,
          projectId: projA,
          draftId: d2.id,
          revisionId: r2.id,
          channel: Channel.WECHAT,
          connectionId: conn.id,
          payload: "{}",
          idempotencyKey: `pub-${randomUUID()}`,
          createdById: userId,
        },
      });

      // 尝试为草稿 A 登记资产，但传入 pub2
      const res = await ownerAgent
        .post(`/projects/${projA}/published-assets`)
        .send({
          projectId: projA,
          draftId: draftAId, // 草稿 A
          revisionId: revAId,
          publicationId: pub2.id, // 草稿 2 的发布记录
          platform: "WECHAT",
          title: "错配草稿资产",
          verificationStatus: "UNVERIFIED",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("不一致");
    });

    test("6. 拦截伪造 PLATFORM_CONFIRMED (F1-003, F1-004, F1-005)", async () => {
      // 手工录入时直接声称 PLATFORM_CONFIRMED 无有效平台回执 -> 拒绝
      const fakeRes = await ownerAgent
        .post(`/projects/${projA}/published-assets`)
        .send({
          projectId: projA,
          draftId: draftAId,
          revisionId: revAId,
          platform: "WECHAT",
          title: "伪造平台确认",
          canonicalUrl: "https://example.com/asset-fake",
          verificationStatus: "PLATFORM_CONFIRMED",
        });
      expect(fakeRes.status).toBe(400);

      // 拒绝 Mock URL
      const mockUrlRes = await ownerAgent
        .post(`/projects/${projA}/published-assets`)
        .send({
          projectId: projA,
          draftId: draftAId,
          revisionId: revAId,
          platform: "WECHAT",
          title: "Mock URL 资产",
          canonicalUrl: "mock://fake-url",
          verificationStatus: "UNVERIFIED",
        });
      expect(mockUrlRes.status).toBe(400);
    });

    test("7. 重复登记幂等性防护", async () => {
      const idempotencyKey = `idem-${randomUUID()}`;
      const payload = {
        projectId: projA,
        draftId: draftAId,
        revisionId: revAId,
        platform: "BILIBILI",
        title: "幂等测试视频",
        canonicalUrl: "https://www.bilibili.com/video/BV1xx411c7X1",
        verificationStatus: "UNVERIFIED" as const,
        idempotencyKey,
      };

      const res1 = await ownerAgent.post(`/projects/${projA}/published-assets`).send(payload).expect(201);
      const res2 = await ownerAgent.post(`/projects/${projA}/published-assets`).send(payload).expect(201);

      // 返回同一个资产 ID，不产生新资产
      expect(res1.body.id).toBe(res2.body.id);

      const count = await prisma.publishedAsset.count({
        where: { projectId: projA, idempotencyKey },
      });
      expect(count).toBe(1);
    });
  });

  describe("LOC-003: F2 Retest 执行幂等与 Evidence 历史保护", () => {
    let assetId: string;
    let queryId: string;

    beforeAll(async () => {
      // 为项目 A 创建一个 Brand 和 Query
      await prisma.brand.create({
        data: { projectId: projA, name: "Brand Alpha" },
      });

      const q = await prisma.query.create({
        data: {
          projectId: projA,
          text: `Alpha 品牌推荐评测 ${suffix}`,
        },
      });
      queryId = q.id;

      // 创建一个落地资产
      const asset = await prisma.publishedAsset.create({
        data: {
          organizationId: orgId,
          projectId: projA,
          draftId: draftAId,
          revisionId: revAId,
          platform: "WECHAT",
          title: "落地评测资产",
          canonicalUrl: "https://mp.weixin.qq.com/s/alpha-retest-target",
          verificationStatus: "MANUAL_VERIFIED",
          actualPublishedAt: new Date("2026-10-01T00:00:00Z"),
          publicationTimeSource: "MANUAL_EVIDENCED",
        },
      });
      assetId = asset.id;
    });

    test("8. RetestRun 正常执行并生成证据", async () => {
      const res = await ownerAgent
        .post(`/published-assets/${assetId}/retests`)
        .send({
          provider: "mock",
          queryIds: [queryId],
          autoExecute: true,
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe("COMPLETED");
      expect(res.body.completedItems).toBe(1);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].evidenceId).toBeDefined();
    });

    test("9. 终态 COMPLETED 重放幂等：零副作用，不创建新 MonitorTask", async () => {
      const list = await ownerAgent.get(`/published-assets/${assetId}/retests`).expect(200);
      const completedRun = list.body[0];
      expect(completedRun.status).toBe("COMPLETED");

      const monitorTasksBefore = await prisma.monitorTask.count({
        where: { metadata: { path: ["retestRunId"], equals: completedRun.id } },
      });
      const evidencesBefore = await prisma.evidence.count();

      // 再次请求执行该已完成的 Run
      const rerunRes = await ownerAgent
        .post(`/retest-runs/${completedRun.id}/execute`)
        .expect(200);

      expect(rerunRes.body.status).toBe("COMPLETED");

      const monitorTasksAfter = await prisma.monitorTask.count({
        where: { metadata: { path: ["retestRunId"], equals: completedRun.id } },
      });
      const evidencesAfter = await prisma.evidence.count();

      // 零副作用断言：没有创建新的 MonitorTask，没有创建新的 Evidence
      expect(monitorTasksAfter).toBe(monitorTasksBefore);
      expect(evidencesAfter).toBe(evidencesBefore);
    });

    test("10. 历史成功 Evidence 保护：部分失败后重试不覆写已有成功 Evidence", async () => {
      // 创建第二个 Query
      const q2 = await prisma.query.create({
        data: {
          projectId: projA,
          text: `Alpha 备用问题 ${suffix}`,
        },
      });

      // 创建一个包含两个 Query 的 Run，模拟 q2 注入故障
      const runRes = await ownerAgent
        .post(`/published-assets/${assetId}/retests`)
        .send({
          provider: "mock",
          queryIds: [queryId, q2.id],
          autoExecute: true,
          forceNew: true,
          simulateFailureQueryId: q2.id,
        })
        .expect(201);

      expect(runRes.body.status).toBe("PARTIAL");
      const item1Success = runRes.body.items.find((i: any) => i.queryId === queryId);
      const item2Failed = runRes.body.items.find((i: any) => i.queryId === q2.id);

      expect(item1Success.status).toBe("SUCCEEDED");
      expect(item1Success.evidenceId).toBeDefined();
      expect(item2Failed.status).toBe("FAILED");

      const initialSuccessEvidenceId = item1Success.evidenceId;
      const initialEvidence = await prisma.evidence.findUnique({
        where: { id: initialSuccessEvidenceId },
      });

      // 现在对该 Run 进行再次执行（重试未完成的项，不注入故障）
      const retryRes = await ownerAgent
        .post(`/retest-runs/${runRes.body.id}/execute`)
        .expect(200);

      expect(retryRes.body.status).toBe("COMPLETED");
      const retriedItem1 = retryRes.body.items.find((i: any) => i.queryId === queryId);
      const retriedItem2 = retryRes.body.items.find((i: any) => i.queryId === q2.id);

      // 已成功项断言：evidenceId 严格保持一致，原 Evidence 绝不被覆写！
      expect(retriedItem1.evidenceId).toBe(initialSuccessEvidenceId);
      const postEvidence = await prisma.evidence.findUnique({
        where: { id: initialSuccessEvidenceId },
      });
      expect(postEvidence?.createdAt.toISOString()).toBe(initialEvidence?.createdAt.toISOString());
      expect(postEvidence?.rawResponse).toBe(initialEvidence?.rawResponse);

      // 失败项成功修复并获得新 evidenceId
      expect(retriedItem2.status).toBe("SUCCEEDED");
      expect(retriedItem2.evidenceId).toBeDefined();
    });

    test("11. 并发双进程执行防护", async () => {
      // 创建一个新的待执行 Run (autoExecute: false)
      const newRun = await ownerAgent
        .post(`/published-assets/${assetId}/retests`)
        .send({
          provider: "mock",
          queryIds: [queryId],
          autoExecute: false,
          forceNew: true,
        })
        .expect(201);

      expect(newRun.body.status).toBe("PENDING");

      // 并发触发两个执行请求
      const [res1, res2] = await Promise.all([
        ownerAgent.post(`/retest-runs/${newRun.body.id}/execute`),
        ownerAgent.post(`/retest-runs/${newRun.body.id}/execute`),
      ]);

      expect([200, 201]).toContain(res1.status);
      expect([200, 201]).toContain(res2.status);

      // 验证生成的 MonitorTask 数量至多为 1，没有双倍执行冲突
      const tasks = await prisma.monitorTask.findMany({
        where: { metadata: { path: ["retestRunId"], equals: newRun.body.id } },
      });
      expect(tasks.length).toBeLessThanOrEqual(1);

      // 最终状态稳定为 COMPLETED
      const finalRun = await ownerAgent.get(`/retest-runs/${newRun.body.id}`).expect(200);
      expect(finalRun.body.status).toBe("COMPLETED");
    });
  });
});
