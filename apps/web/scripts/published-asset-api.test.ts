import assert from "node:assert/strict";
import test from "node:test";
import { API_BASE } from "../src/lib/api";
import {
  confirmPublishedAsset,
  createPublishedAsset,
  getPublishedAsset,
  getPublishedAssetLineage,
  type CreatePublishedAssetInput,
  type PublishedAssetLineage,
  type PublishedAssetRecord,
} from "../src/lib/published-asset-api";

/** 全部为合成数据；不连接 API、DB、Provider 或外部平台。 */
const record: PublishedAssetRecord = {
  id: "asset-synthetic",
  organizationId: "organization-synthetic",
  projectId: "project-synthetic",
  publicationId: "publication-synthetic",
  publicationAttemptId: null,
  campaignId: null,
  scheduleItemId: null,
  planItemId: null,
  draftId: "draft-synthetic",
  revisionId: "revision-synthetic",
  platform: "TEST_PLATFORM",
  title: "合成发布资产",
  canonicalUrl: null,
  externalAssetId: null,
  verificationStatus: "UNVERIFIED",
  sourceType: "IMPORTED",
  verifiedAt: null,
  verifiedById: null,
  verificationNote: null,
  publishedAt: "2026-01-01T00:00:00.000Z",
  metadata: { synthetic: true },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const createInput: CreatePublishedAssetInput = {
  projectId: "project-synthetic",
  draftId: "draft-synthetic",
  platform: "TEST_PLATFORM",
  title: "合成发布资产",
  verificationStatus: "UNVERIFIED",
  metadata: { synthetic: true },
};

type CapturedRequest = { url: string; init: RequestInit | undefined };

function firstRequest(requests: CapturedRequest[]): CapturedRequest {
  const request = requests[0];
  assert.ok(request, "expected a captured request");
  return request;
}

async function withFakeFetch<T>(
  reply: (request: CapturedRequest, callNo: number) => Response,
  run: (requests: CapturedRequest[]) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const requests: CapturedRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = {
      url: input instanceof Request ? input.url : String(input),
      init,
    };
    requests.push(request);
    return reply(request, requests.length);
  }) as typeof fetch;
  try {
    return await run(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function assertJsonRequest(request: CapturedRequest, method: "POST" | "GET"): void {
  assert.equal(request.init?.credentials, "include");
  assert.equal(request.init?.method ?? "GET", method);
  assert.equal(
    (request.init?.headers as Record<string, string>)?.["Content-Type"],
    "application/json",
  );
  assert.equal(
    (request.init?.headers as Record<string, string>)?.Authorization,
    undefined,
  );
}

test("confirm: URL 编码、Cookie、DTO JSON 白名单，不把 publishedAt 写入请求", async () => {
  await withFakeFetch(
    () => Response.json(record, { status: 201 }),
    async (requests) => {
      const input = Object.assign(
        {
          verificationStatus: "MANUAL_VERIFIED" as const,
          canonicalUrl: "https://example.invalid/synthetic",
          verificationNote: "合成核验备注",
          metadata: { tag: "test" },
        },
        { publishedAt: "2099-01-01T00:00:00.000Z", unexpected: "discard" },
      );
      const result = await confirmPublishedAsset("pub /?%", input);
      assert.deepEqual(result, record);
      assert.equal(requests.length, 1);
      assert.equal(firstRequest(requests).url, `${API_BASE}/publications/pub%20%2F%3F%25/confirm-asset`);
      assertJsonRequest(firstRequest(requests), "POST");
      assert.deepEqual(JSON.parse(String(firstRequest(requests).init?.body)), {
        verificationStatus: "MANUAL_VERIFIED",
        canonicalUrl: "https://example.invalid/synthetic",
        verificationNote: "合成核验备注",
        metadata: { tag: "test" },
      });
    },
  );
});

test("create: body 包含当前 DTO 字段、编码项目路径且不添加 publishedAt", async () => {
  await withFakeFetch(
    () => Response.json(record, { status: 201 }),
    async (requests) => {
      const projectId = "project /?%";
      const input = Object.assign(
        {
          ...createInput,
          projectId,
          revisionId: "revision-synthetic",
          publicationId: "publication-synthetic",
          campaignId: "campaign-synthetic",
          scheduleItemId: "schedule-synthetic",
          planItemId: "plan-synthetic",
          canonicalUrl: "https://example.invalid/item",
          externalAssetId: "external-synthetic",
          sourceType: "IMPORTED_NON_ENUM_STRING",
          verificationNote: "合成备注",
        },
        { publishedAt: "2099-02-01T00:00:00.000Z" },
      );
      const result = await createPublishedAsset(projectId, input);
      assert.deepEqual(result, record);
      assert.equal(requests.length, 1);
      assert.equal(firstRequest(requests).url, `${API_BASE}/projects/project%20%2F%3F%25/published-assets`);
      assertJsonRequest(firstRequest(requests), "POST");
      assert.deepEqual(JSON.parse(String(firstRequest(requests).init?.body)), {
        projectId,
        draftId: "draft-synthetic",
        revisionId: "revision-synthetic",
        publicationId: "publication-synthetic",
        campaignId: "campaign-synthetic",
        scheduleItemId: "schedule-synthetic",
        planItemId: "plan-synthetic",
        platform: "TEST_PLATFORM",
        title: "合成发布资产",
        canonicalUrl: "https://example.invalid/item",
        externalAssetId: "external-synthetic",
        verificationStatus: "UNVERIFIED",
        sourceType: "IMPORTED_NON_ENUM_STRING",
        verificationNote: "合成备注",
        metadata: { synthetic: true },
      });
    },
  );
});

test("create: 不同项目在发请求前抛错且零 fetch", async () => {
  await withFakeFetch(
    () => { throw new Error("不应调用 fetch"); },
    async (requests) => {
      await assert.rejects(
        () => createPublishedAsset("project-other", createInput),
        { message: "项目标识不一致" },
      );
      assert.equal(requests.length, 0);
    },
  );
});

test("get: 返回标量及精确的 draft/revision/publication 关联", async () => {
  const detail = {
    ...record,
    draft: { id: "draft-synthetic", title: "草稿", status: "DRAFT" },
    revision: { id: "revision-synthetic", version: 3, summary: null },
    publication: null,
  };
  await withFakeFetch(
    () => Response.json(detail),
    async (requests) => {
      assert.deepEqual(await getPublishedAsset("asset /?%"), detail);
      assert.equal(requests.length, 1);
      assert.equal(firstRequest(requests).url, `${API_BASE}/published-assets/asset%20%2F%3F%25`);
      assertJsonRequest(firstRequest(requests), "GET");
      assert.equal(firstRequest(requests).init?.body, undefined);
    },
  );
});

test("lineage: 保留未知 JSON、null 和血缘发布时刻，资产投影无 publishedAt", async () => {
  const { publishedAt: omittedPublishedAt, ...assetProjection } = record;
  void omittedPublishedAt;
  const lineage: PublishedAssetLineage = {
    publishedAsset: assetProjection,
    lineage: {
      diagnosis: { summarySnapshot: { unknownKind: ["a", 1, null] } },
      strategy: {
        id: "strategy-synthetic",
        title: "策略",
        status: "ACTIVE",
        platformPriorities: { opaque: ["x"] },
        sourceDiagnosisId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      campaign: {
        id: "campaign-synthetic",
        name: "战役",
        status: "ACTIVE",
        startDate: "2026-01-01T00:00:00.000Z",
        endDate: "2026-01-31T00:00:00.000Z",
      },
      planItem: {
        id: "plan-synthetic",
        title: "选题",
        platform: "TEST_PLATFORM",
        format: "ARTICLE",
        objective: "合成战役目标",
        status: "PLANNED",
      },
      scheduleItem: {
        id: "schedule-synthetic",
        scheduledDate: "2026-01-01T00:00:00.000Z",
        scheduledTime: null,
        timezone: "Asia/Shanghai",
        productionStatus: "PENDING",
        assignedToId: null,
      },
      draft: {
        id: "draft-synthetic",
        title: "草稿",
        status: "DRAFT",
        topic: null,
        generationMode: "MANUAL",
      },
      revision: {
        id: "revision-synthetic",
        version: 3,
        summary: null,
        changeNote: null,
      },
      publication: {
        id: "publication-synthetic",
        channel: "TEST_PLATFORM",
        status: "DRAFT",
        title: null,
        publishedAt: null,
      },
      publicationAttempt: {
        id: "attempt-synthetic",
        attemptNo: 1,
        status: "PENDING",
        publisher: "SYNTHETIC",
        externalId: null,
        externalUrl: null,
      },
    },
    provenance: {
      platform: record.platform,
      sourceType: record.sourceType,
      verificationStatus: record.verificationStatus,
      canonicalUrl: null,
      externalAssetId: null,
      verifiedAt: null,
      verifiedById: null,
      verificationNote: null,
    },
  };
  await withFakeFetch(
    () => Response.json(lineage),
    async (requests) => {
      const actual = await getPublishedAssetLineage("asset /?%");
      assert.deepEqual(actual, lineage);
      // These scalars are required by the real Prisma schema, even when the relation is optional.
      assert.ok(actual.lineage.campaign);
      assert.ok(actual.lineage.planItem);
      const campaignStart: string = actual.lineage.campaign.startDate;
      const campaignEnd: string = actual.lineage.campaign.endDate;
      const objective: string = actual.lineage.planItem.objective;
      assert.equal(campaignStart, "2026-01-01T00:00:00.000Z");
      assert.equal(campaignEnd, "2026-01-31T00:00:00.000Z");
      assert.equal(objective, "合成战役目标");
      assert.equal(Object.hasOwn(actual.publishedAsset, "publishedAt"), false);
      assert.equal(actual.lineage.publication?.publishedAt, null);
      assert.deepEqual(actual.lineage.diagnosis, lineage.lineage.diagnosis);
      assert.equal(requests.length, 1);
      assert.equal(firstRequest(requests).url, `${API_BASE}/published-assets/asset%20%2F%3F%25/lineage`);
      assertJsonRequest(firstRequest(requests), "GET");
      assert.equal(firstRequest(requests).init?.body, undefined);
    },
  );
});

test("400/404/409/500 错误透传，不吞错、不重试 POST", async () => {
  const scenarios: Array<{
    name: string;
    response: Response;
    invoke: () => Promise<unknown>;
    message: string;
  }> = [
    {
      name: "400 - array message",
      response: Response.json({ message: ["参数无效", "第二条"] }, { status: 400 }),
      invoke: () => confirmPublishedAsset("p-synthetic", { verificationStatus: "UNVERIFIED" }),
      message: "参数无效",
    },
    {
      name: "404 - not found",
      response: Response.json({ message: "发布资产不存在" }, { status: 404 }),
      invoke: () => getPublishedAsset("missing-synthetic"),
      message: "发布资产不存在",
    },
    {
      name: "409 - conflict",
      response: Response.json({ message: "资产已存在" }, { status: 409 }),
      invoke: () => createPublishedAsset(createInput.projectId, createInput),
      message: "资产已存在",
    },
    {
      name: "500 - invalid JSON",
      response: new Response("Synthetic server error", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      }),
      invoke: () => getPublishedAssetLineage("asset-synthetic"),
      message: "请求失败 (500)",
    },
  ];

  for (const scenario of scenarios) {
    await withFakeFetch(
      () => scenario.response,
      async (requests) => {
        await assert.rejects(scenario.invoke, { message: scenario.message }, scenario.name);
        assert.equal(requests.length, 1, `${scenario.name} must not retry`);
      },
    );
  }
});

test("可选字段缺失时 JSON 不添加 null、伪时间或自动确认状态", async () => {
  await withFakeFetch(
    () => Response.json(record, { status: 201 }),
    async (requests) => {
      await createPublishedAsset(createInput.projectId, {
        projectId: createInput.projectId,
        draftId: createInput.draftId,
        platform: createInput.platform,
        title: createInput.title,
        verificationStatus: "UNVERIFIED",
      });
      assert.deepEqual(JSON.parse(String(firstRequest(requests).init?.body)), {
        projectId: "project-synthetic",
        draftId: "draft-synthetic",
        platform: "TEST_PLATFORM",
        title: "合成发布资产",
        verificationStatus: "UNVERIFIED",
      });
      assert.equal(requests.length, 1);
    },
  );
});
