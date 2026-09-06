/**
 * M6D Qwen Provider 集成测试（真实 PostgreSQL geo_test + 真实 Redis + 真实 processor + Fake HTTP server）。
 * 硬保护：test-env.cjs 强制 geo_test；0 次真实 Qwen API 调用。
 * 覆盖（M6D 清单 16-26）：fake 成功 → Run SUCCEEDED / Evidence(official_api/api_plain) /
 * Analysis / requestedModel+responseModel 落库；retryable(500) / non-retryable(401)；
 * disabled / not_configured；restart 幂等。
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

let queue: RunQueue;
let server: Server;
let serverUrl = "";
let hits = 0;
let fixture: { organizationId: string; projectId: string; queryIds: string[]; qwenEngineId: string };

function fakePayload(queryText: string, model = "qwen-plus") {
  const content = queryText.includes("@401") || queryText.includes("@500")
    ? ""
    : "推荐 ProjectMentor，它适合商业计划书准备。也可以考虑 Competitor A。";
  return {
    id: "chatcmpl-qwen-test-1", object: "chat.completion", created: 1700000000, model,
    choices: [{ index: 0, message: { role: "assistant", content }, logprobs: null, finish_reason: "stop" }],
    usage: { prompt_tokens: 9, completion_tokens: 6, total_tokens: 15 },
  };
}

async function runJobThroughProcessor(runId: string) {
  const processor = createRunProcessor(prisma, { timeoutMs: 3000, realTimeoutMs: 20000, logger: () => {} });
  const job = await queue.getJob(jobIdForRun(runId));
  assert.ok(job, `job ${jobIdForRun(runId)} should exist`);
  return processor(job as never);
}

before(async () => {
  process.env.ENABLE_REAL_PROVIDERS = "true";
  process.env.QWEN_API_KEY = "sk-qwen-integration-test-secret";
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      hits += 1;
      res.setHeader("Content-Type", "application/json");
      try {
        const parsed = JSON.parse(body) as { messages?: Array<{ content?: string }> };
        const queryText = parsed.messages?.find(m => m.content)?.content ?? "";
        if (queryText.includes("@401")) { res.statusCode = 401; res.end(JSON.stringify({ error: { message: "invalid" } })); return; }
        if (queryText.includes("@500")) { res.statusCode = 500; res.end(JSON.stringify({ error: { message: "boom" } })); return; }
        if (queryText.includes("@alias")) { res.statusCode = 200; res.end(JSON.stringify(fakePayload(queryText, "qwen-plus-latest"))); return; }
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
  process.env.QWEN_BASE_URL = serverUrl;
  process.env.QWEN_MODEL = "qwen-plus";

  queue = createRunQueue();
  const suffix = randomUUID().slice(0, 12);
  const user = await prisma.user.create({ data: { email: `qw-${suffix}@m6d.test`, name: "Qwen Test" } });
  const organization = await prisma.organization.create({ data: { name: `Qwen Org ${suffix}`, slug: `qwen-org-${suffix}` } });
  await prisma.organizationMember.create({ data: { userId: user.id, organizationId: organization.id, role: "OWNER" } });
  const project = await prisma.project.create({ data: { organizationId: organization.id, name: `Qwen Project ${suffix}` } });
  await prisma.brand.create({ data: { projectId: project.id, name: "ProjectMentor", aliases: ["项目导师"] } });
  const queryIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    const query = await prisma.query.create({ data: { projectId: project.id, text: `推荐 AI 工具 ${suffix} ${i}` } });
    queryIds.push(query.id);
  }
  const engine = await prisma.engine.create({
    data: { key: `qwen-api-${suffix}`, name: "通义千问 M6D", provider: "qwen", config: { model: "qwen-plus", temperature: 0.2 } as never },
  });
  fixture = { organizationId: organization.id, projectId: project.id, queryIds, qwenEngineId: engine.id };
});

after(async () => {
  try {
    await prisma.monitorTask.deleteMany({ where: { projectId: fixture.projectId } });
    await prisma.engine.deleteMany({ where: { id: fixture.qwenEngineId } });
    await prisma.project.deleteMany({ where: { id: fixture.projectId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: fixture.organizationId } });
    await prisma.organization.deleteMany({ where: { id: fixture.organizationId } });
    await prisma.user.deleteMany({ where: { email: { contains: "@m6d.test" }, memberships: { none: {} } } });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await queue.close();
    await prisma.$disconnect();
    delete process.env.ENABLE_REAL_PROVIDERS;
    delete process.env.QWEN_API_KEY;
    delete process.env.QWEN_BASE_URL;
    delete process.env.QWEN_MODEL;
  }
});

async function makeTaskWith(queryText: string): Promise<string> {
  const query = await prisma.query.create({ data: { projectId: fixture.projectId, text: queryText } });
  const task = await prisma.monitorTask.create({
    data: {
      organizationId: fixture.organizationId, projectId: fixture.projectId, totalRuns: 1,
      runs: { create: [{ queryId: query.id, engineId: fixture.qwenEngineId }] },
    },
    include: { runs: true },
  });
  await dispatchPendingRuns(prisma, queue);
  return task.runs[0].id;
}

test("Qwen fake 成功：Run SUCCEEDED + Evidence(official_api/api_plain + identity) + Analysis", async () => {
  const runId = await makeTaskWith(`推荐项目工具 ${randomUUID().slice(0, 6)}`);
  const result = await runJobThroughProcessor(runId);
  assert.equal(result.provider, "qwen");
  assert.ok(hits >= 1, "Fake Qwen HTTP server 必须被真实调用");

  const dbRun = await prisma.run.findUniqueOrThrow({ where: { id: runId }, include: { evidence: { include: { analyses: true } } } });
  assert.equal(dbRun.status, "SUCCEEDED");
  assert.equal(dbRun.analysisStatus, "SUCCEEDED");
  const evidence = dbRun.evidence;
  assert.ok(evidence, "Qwen 成功后必须写 Evidence");
  assert.equal(evidence.provider, "qwen");
  assert.equal(evidence.sourceType, "official_api", "Qwen 官方 API → official_api");
  assert.equal(evidence.retrievalMode, "api_plain", "模型 API（非 Web Search）→ api_plain");
  assert.equal(evidence.requestedModel, "qwen-plus");
  assert.equal(evidence.responseModel, "qwen-plus");
  assert.equal(evidence.model, "qwen-plus"); // legacy = responseModel ?? requestedModel
  assert.ok(evidence.rawResponse.includes("ProjectMentor"));
  assert.ok(evidence.rawPrompt.includes("qwen-plus"));
  const meta = evidence.metadata as Record<string, unknown>;
  assert.deepEqual(meta.usage, { promptTokens: 9, completionTokens: 6, totalTokens: 15 });
  const raw = JSON.stringify(meta.rawProviderPayload ?? {});
  assert.ok(!raw.includes("sk-qwen-integration-test-secret"), "rawProviderPayload 不得含 Key");
  assert.ok(!raw.includes("Authorization"), "rawProviderPayload 不得含 Authorization");
  assert.equal(JSON.stringify(evidence).includes("sk-qwen-integration-test-secret"), false, "Evidence 整体不得含 secret");
  const analysis = evidence.analyses[0];
  assert.equal(analysis.analysisVersion, "m4-rule-v1");
  assert.equal(analysis.brandMentioned, true, "Analyzer 无 provider 特判地处理 Qwen 回答");
});

test("Qwen requested ≠ response（API 回显别名模型）→ 身份分离落库", async () => {
  const runId = await makeTaskWith(`@alias ${randomUUID().slice(0, 6)}`);
  await runJobThroughProcessor(runId);
  const dbRun = await prisma.run.findUniqueOrThrow({ where: { id: runId }, include: { evidence: true } });
  assert.equal(dbRun.status, "SUCCEEDED");
  assert.equal(dbRun.evidence?.requestedModel, "qwen-plus");
  assert.equal(dbRun.evidence?.responseModel, "qwen-plus-latest");
  assert.notEqual(dbRun.evidence?.requestedModel, dbRun.evidence?.responseModel);
});

test("401 → PROVIDER_AUTH 永久失败（attempt=1，无 Evidence 不伪造）", async () => {
  const runId = await makeTaskWith(`@401 ${randomUUID().slice(0, 6)}`);
  await assert.rejects(() => runJobThroughProcessor(runId), /PROVIDER_AUTH/);
  const dbRun = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  assert.equal(dbRun.status, "FAILED");
  assert.equal(dbRun.attempt, 1);
  assert.equal(dbRun.errorCode, "PROVIDER_AUTH");
  assert.equal(await prisma.evidence.count({ where: { runId } }), 0);
});

test("500 → PROVIDER_SERVER 可重试：耗尽后 FAILED(PROVIDER_SERVER)", async () => {
  const runId = await makeTaskWith(`@500 ${randomUUID().slice(0, 6)}`);
  for (let i = 0; i < 3; i++) {
    try {
      await runJobThroughProcessor(runId);
      break;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      assert.ok(!msg.includes("sk-qwen-integration-test-secret"), "错误消息不得含 secret");
    }
  }
  const dbRun = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  assert.equal(dbRun.status, "FAILED");
  assert.equal(dbRun.errorCode, "PROVIDER_SERVER");
  assert.equal(await prisma.evidence.count({ where: { runId } }), 0);
});

test("ENABLE_REAL_PROVIDERS 关 → PROVIDER_DISABLED（Qwen 同样遵守总开关）", async () => {
  process.env.ENABLE_REAL_PROVIDERS = "false";
  const runId = await makeTaskWith(`disabled ${randomUUID().slice(0, 6)}`);
  await assert.rejects(() => runJobThroughProcessor(runId), /PROVIDER_DISABLED/);
  process.env.ENABLE_REAL_PROVIDERS = "true";
  const dbRun = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  assert.equal(dbRun.errorCode, "PROVIDER_DISABLED");
});

test("未配置 QWEN_API_KEY → PROVIDER_NOT_CONFIGURED", async () => {
  delete process.env.QWEN_API_KEY;
  const runId = await makeTaskWith(`nokey ${randomUUID().slice(0, 6)}`);
  await assert.rejects(() => runJobThroughProcessor(runId), /PROVIDER_NOT_CONFIGURED/);
  process.env.QWEN_API_KEY = "sk-qwen-integration-test-secret";
  const dbRun = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  assert.equal(dbRun.errorCode, "PROVIDER_NOT_CONFIGURED");
});

test("restart 幂等：已 SUCCEEDED+分析完成的 run 重放不重复创建/改动", async () => {
  const runId = await makeTaskWith(`idem ${randomUUID().slice(0, 6)}`);
  await runJobThroughProcessor(runId);
  const first = await prisma.evidence.count({ where: { runId } });
  const beforeAnalysis = await prisma.analysis.count({ where: { evidence: { runId } } });
  // 模拟重启恢复：再次喂同一 job（replay 语义：已完成 run 为 no-op 或幂等）
  try { await runJobThroughProcessor(runId); } catch { /* replay may no-op */ }
  const second = await prisma.evidence.count({ where: { runId } });
  const afterAnalysis = await prisma.analysis.count({ where: { evidence: { runId } } });
  assert.equal(first, 1);
  assert.equal(second, 1, "Evidence 不因重放重复");
  assert.equal(afterAnalysis, beforeAnalysis, "Analysis 不因重放重复");
});
