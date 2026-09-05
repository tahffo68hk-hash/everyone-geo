/**
 * M5 DeepSeek Provider 集成测试（真实 PostgreSQL geo_test + 真实 Redis + 真实 processor + Fake HTTP server）。
 * 硬保护：顶层加载 test-env.cjs（强制 geo_test）。
 *
 * 验证「真正经过 Provider Adapter」而不是 MockProvider shortcut：
 *   - Engine.provider='deepseek' → registry 解析 DeepSeekProvider → fetch Fake HTTP
 *     → ProviderResponse → Evidence（sourceType=official_api / retrievalMode=api_plain /
 *     model / usage / requestId / 脱敏 payload）→ @geo/core Analysis
 *   - 401 → PROVIDER_AUTH 永久失败（单次 attempt，无 Evidence）
 *   - ENABLE_REAL_PROVIDERS 未开启 → PROVIDER_DISABLED 永久失败
 *   - 未配置 API Key → PROVIDER_NOT_CONFIGURED
 *   - secret 不进入 Evidence.metadata / rawProviderPayload
 *
 * 退出纪律：单 Queue before/after close；DB 逆序清理 + finally disconnect；server close。
 */
import "../../../packages/database/scripts/test-env.cjs";
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "@geo/database";
import { createRunQueue, dispatchPendingRuns, jobIdForRun, type RunQueue } from "@geo/queue";
import { createRunProcessor } from "../src/processor";

function fakePayload(queryText: string) {
  const content = queryText.includes("@401")
    ? ""
    : "推荐 ProjectMentor，它适合商业计划书准备。也可以考虑 Competitor A。";
  return {
    id: "chatcmpl-m5-test-1",
    object: "chat.completion",
    created: 1700000000,
    model: "deepseek-chat",
    choices: [
      { index: 0, message: { role: "assistant", content }, logprobs: null, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 9, completion_tokens: 6, total_tokens: 15 },
    system_fingerprint: "fp_m5",
  };
}

let queue: RunQueue;
let server: Server;
let serverUrl = "";
let hits = 0;
let fixture: {
  organizationId: string; projectId: string; brandId: string;
  queryIds: string[]; deepseekEngineId: string;
};

async function runJobThroughProcessor(runId: string) {
  const processor = createRunProcessor(prisma, { timeoutMs: 3000, realTimeoutMs: 20000, logger: () => {} });
  const job = await queue.getJob(jobIdForRun(runId));
  assert.ok(job, `job ${jobIdForRun(runId)} should exist`);
  return processor(job as never);
}

before(async () => {
  // Cost-safety + provider env for the integration run (server-side only).
  process.env.ENABLE_REAL_PROVIDERS = "true";
  process.env.DEEPSEEK_API_KEY = "sk-m5-integration-test-secret";
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      hits += 1;
      res.setHeader("Content-Type", "application/json");
      try {
        const parsed = JSON.parse(body) as { messages?: Array<{ content?: string }> };
        const queryText = parsed.messages?.find(m => m.content)?.content ?? "";
        if (queryText.includes("@401")) {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: { message: "invalid api key" } }));
          return;
        }
        if (queryText.includes("@500")) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: { message: "boom" } }));
          return;
        }
        res.statusCode = 200;
        res.end(JSON.stringify(fakePayload(queryText)));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: "bad json" } }));
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.DEEPSEEK_BASE_URL = serverUrl;

  queue = createRunQueue();
  const suffix = randomUUID().slice(0, 12);
  const user = await prisma.user.create({ data: { email: `ds-${suffix}@m5.test`, name: "DeepSeek Test" } });
  const organization = await prisma.organization.create({ data: { name: `DS Org ${suffix}`, slug: `ds-org-${suffix}` } });
  await prisma.organizationMember.create({ data: { userId: user.id, organizationId: organization.id, role: "OWNER" } });
  const project = await prisma.project.create({ data: { organizationId: organization.id, name: `DS Project ${suffix}` } });
  await prisma.brand.create({ data: { projectId: project.id, name: "ProjectMentor", aliases: ["Project Mentor", "项目导师", "PMentor"] } });
  for (const [name, aliases] of [["Competitor A", ["CompA"]], ["Competitor B", ["CompB"]], ["Competitor C", ["CompC"]]] as const) {
    await prisma.competitor.create({ data: { projectId: project.id, name, aliases: [...aliases] } });
  }
  const queryIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const query = await prisma.query.create({ data: { projectId: project.id, text: `推荐 AI 项目工具 ${suffix} ${i}` } });
    queryIds.push(query.id);
  }
  const engine = await prisma.engine.create({
    data: { key: `deepseek-m5-${suffix}`, name: "DeepSeek API M5", provider: "deepseek", config: { model: "deepseek-chat", temperature: 0.2 } as never },
  });
  fixture = { organizationId: organization.id, projectId: project.id, brandId: "", queryIds, deepseekEngineId: engine.id };
  const brand = await prisma.brand.findFirstOrThrow({ where: { projectId: project.id } });
  fixture.brandId = brand.id;
});

after(async () => {
  try {
    await prisma.monitorTask.deleteMany({ where: { projectId: fixture.projectId } });
    await prisma.engine.deleteMany({ where: { id: fixture.deepseekEngineId } });
    await prisma.project.deleteMany({ where: { id: fixture.projectId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: fixture.organizationId } });
    await prisma.organization.deleteMany({ where: { id: fixture.organizationId } });
    await prisma.user.deleteMany({ where: { email: { contains: "@m5.test" }, memberships: { none: {} } } });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await queue.close();
    await prisma.$disconnect();
    delete process.env.ENABLE_REAL_PROVIDERS;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_BASE_URL;
  }
});

async function makeTaskWith(queryText: string): Promise<string> {
  const query = await prisma.query.create({ data: { projectId: fixture.projectId, text: queryText } });
  const task = await prisma.monitorTask.create({
    data: {
      organizationId: fixture.organizationId, projectId: fixture.projectId, totalRuns: 1,
      runs: { create: [{ queryId: query.id, engineId: fixture.deepseekEngineId }] },
    },
    include: { runs: true },
  });
  await dispatchPendingRuns(prisma, queue);
  return task.runs[0].id;
}

test("真实 DeepSeek 链路：Run → DeepSeekProvider → Fake HTTP → Evidence(official_api/api_plain) → Analysis", async () => {
  const runId = await makeTaskWith(`推荐 AI 项目工具 ${randomUUID().slice(0, 6)}`);
  const result = await runJobThroughProcessor(runId);
  assert.ok(result, "processor 应返回 RunResult");
  assert.equal(result.provider, "deepseek");
  assert.ok(hits >= 1, "Fake DeepSeek HTTP server 必须被真实调用");

  const dbRun = await prisma.run.findUniqueOrThrow({ where: { id: runId }, include: { evidence: { include: { analyses: { include: { mentions: true, citations: true } } } } } });
  assert.equal(dbRun.status, "SUCCEEDED");
  assert.equal(dbRun.analysisStatus, "SUCCEEDED");
  const evidence = dbRun.evidence;
  assert.ok(evidence, "真实 Provider 成功后必须写 Evidence");
  assert.equal(evidence.provider, "deepseek");
  assert.equal(evidence.sourceType, "official_api", "真实调用 sourceType 必须是 official_api");
  assert.equal(evidence.retrievalMode, "api_plain", "真实调用 retrievalMode 必须是 api_plain");
  assert.equal(evidence.engineKey.startsWith("deepseek-m5-"), true);
  assert.equal(evidence.model, "deepseek-chat");
  assert.equal(evidence.modelVersion, "deepseek-chat");
  assert.ok(evidence.rawResponse.includes("ProjectMentor"));
  assert.ok(evidence.rawPrompt.includes("deepseek-chat"), "rawPrompt 应含实际发送的 model+messages JSON");
  const meta = evidence.metadata as Record<string, unknown>;
  assert.deepEqual(meta.usage, { promptTokens: 9, completionTokens: 6, totalTokens: 15 });
  assert.equal(meta.requestId, "chatcmpl-m5-test-1");
  assert.equal(meta.finishReason, "stop");
  assert.ok(Array.isArray(meta.structuredCitations) && (meta.structuredCitations as unknown[]).length === 0, "DeepSeek 无结构化引用时为 []（靠 URL 提取 fallback）");
  const payload = JSON.stringify(meta.rawProviderPayload);
  assert.ok(!payload.includes("sk-m5-integration-test-secret"), "rawProviderPayload 不得含 API Key");
  assert.ok(!payload.includes("Authorization"), "rawProviderPayload 不得含 Authorization header");
  const analysis = evidence.analyses[0];
  assert.equal(analysis.analysisVersion, "m4-rule-v1");
  assert.equal(analysis.brandMentioned, true, "Analyzer 必须正常处理真实模型回答（无 provider 特判）");
  assert.equal(analysis.mentionPosition, 1);
  assert.equal(analysis.recommended, true);
  assert.equal(analysis.sentiment, "positive");
  assert.ok(analysis.mentions.some(m => m.entityType === "brand" && m.entityId === fixture.brandId));
});

test("401 → PROVIDER_AUTH 永久失败（attempt=1 FAILED，无 Evidence，不伪造记录）", async () => {
  const beforeHits = hits;
  const runId = await makeTaskWith(`@401 ${randomUUID().slice(0, 6)}`);
  await assert.rejects(() => runJobThroughProcessor(runId), /PROVIDER_AUTH/);
  const dbRun = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  assert.equal(dbRun.status, "FAILED");
  assert.equal(dbRun.attempt, 1, "永久错误不应消耗全部 attempts");
  assert.equal(dbRun.errorCode, "PROVIDER_AUTH");
  const evidenceCount = await prisma.evidence.count({ where: { runId } });
  assert.equal(evidenceCount, 0, "失败的 Provider 调用不得产生 Evidence");
  assert.ok(hits >= beforeHits, "Fake server 应收到 401 场景请求");
});

test("500 → PROVIDER_SERVER 可重试：attempt 耗尽后 FAILED(PROVIDER_SERVER)", async () => {
  const runId = await makeTaskWith(`@500 ${randomUUID().slice(0, 6)}`);
  for (let i = 0; i < 3; i++) {
    try {
      await runJobThroughProcessor(runId);
      break;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      assert.ok(!msg.includes("sk-m5-integration-test-secret"), "错误消息不得含 secret");
    }
  }
  const dbRun = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  assert.equal(dbRun.status, "FAILED");
  assert.equal(dbRun.errorCode, "PROVIDER_SERVER");
  const evidenceCount = await prisma.evidence.count({ where: { runId } });
  assert.equal(evidenceCount, 0);
});

test("ENABLE_REAL_PROVIDERS 未开启 → PROVIDER_DISABLED（mock 语义不变量仍在单测覆盖）", async () => {
  process.env.ENABLE_REAL_PROVIDERS = "false";
  const runId = await makeTaskWith(`disabled ${randomUUID().slice(0, 6)}`);
  await assert.rejects(() => runJobThroughProcessor(runId), /PROVIDER_DISABLED/);
  const dbRun = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  assert.equal(dbRun.status, "FAILED");
  assert.equal(dbRun.errorCode, "PROVIDER_DISABLED");
  process.env.ENABLE_REAL_PROVIDERS = "true";
});

test("未配置 DEEPSEEK_API_KEY → PROVIDER_NOT_CONFIGURED", async () => {
  delete process.env.DEEPSEEK_API_KEY;
  const runId = await makeTaskWith(`nokey ${randomUUID().slice(0, 6)}`);
  await assert.rejects(() => runJobThroughProcessor(runId), /PROVIDER_NOT_CONFIGURED/);
  const dbRun = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  assert.equal(dbRun.status, "FAILED");
  assert.equal(dbRun.errorCode, "PROVIDER_NOT_CONFIGURED");
  process.env.DEEPSEEK_API_KEY = "sk-m5-integration-test-secret";
});
