import assert from "node:assert/strict";
import test from "node:test";

import {
  buildActivityPath,
  buildBatchRequest,
  buildQueryListPath,
  buildRunPreflightRequest,
  clearProcessedSelection,
  formatPreflightCost,
  getActivityActions,
  getPreflightBlockedReason,
  togglePageSelection,
} from "../src/lib/r2-api.ts";

test("Activity 查询只发送已应用的 R2 筛选条件", () => {
  assert.equal(
    buildActivityPath({
      projectId: "project-1",
      type: "MONITOR",
      status: "SUCCEEDED",
      q: "Nova Flow",
      page: 2,
      pageSize: 20,
    }),
    "/activity?projectId=project-1&type=MONITOR&status=SUCCEEDED&q=Nova+Flow&page=2&pageSize=20",
  );
});

test("Preflight 使用后端阻止原因而不猜 Provider 可用性", () => {
  assert.equal(
    getPreflightBlockedReason({
      suiteId: "suite-1",
      queryCount: 10,
      engineCount: 1,
      estimatedCalls: 10,
      pricing: null,
      currency: null,
      blocked: true,
      blockedReason: "当前 Provider 未启用",
    }),
    "当前 Provider 未启用",
  );
});

test("Preflight 缺少费用时不猜模型价格", () => {
  assert.equal(
    formatPreflightCost({
      suiteId: "suite-1",
      queryCount: 12,
      engineCount: 2,
      estimatedCalls: 24,
      estimatedCost: null,
      pricing: null,
      currency: null,
    }),
    "预计费用：暂不可估算",
  );
});

test("批量成功只清理后端确认已处理的选择", () => {
  assert.deepEqual(
    [...clearProcessedSelection(new Set(["a", "b", "c"]), ["a", "c"])],
    ["b"],
  );
});

test("移动批量请求只包含后端 contract 字段", () => {
  assert.deepEqual(
    buildBatchRequest("project/1", {
      operation: "move",
      queryIds: ["query-1", "query-2"],
      targetSuiteId: "suite-2",
    }),
    {
      path: "/projects/project%2F1/queries/batch",
      body: {
        operation: "move",
        queryIds: ["query-1", "query-2"],
        targetSuiteId: "suite-2",
      },
    },
  );
});

test("Activity 旧字段不会被推断成 capability", () => {
  assert.deepEqual(
    getActivityActions({
      id: "activity-1",
      type: "MONITOR",
      projectId: "project-1",
      projectName: "NovaFlow",
      status: "RUNNING",
      createdAt: "2026-09-09T00:00:00.000Z",
      startable: true,
      resultUrl: "/app/monitor?task=activity-1",
    }),
    [],
  );
});

test("Activity 只消费后端明确提供的 R2 actions", () => {
  assert.deepEqual(
    getActivityActions({
      id: "activity-2",
      type: "MANUAL",
      projectId: "project-1",
      projectName: "NovaFlow",
      status: "AWAITING_MANUAL_INPUT",
      createdAt: "2026-09-09T00:00:00.000Z",
      availableActions: ["VIEW_RESULT", "CONTINUE_MANUAL_INPUT"],
      resultType: "RUN",
      resultId: "run-1",
      resultUrl: "/app/manual-runs/run-1",
    }),
    ["VIEW_RESULT", "CONTINUE_MANUAL_INPUT"],
  );
});

test("Activity 不把未知 action 映射成已有 CTA", () => {
  assert.deepEqual(
    getActivityActions({
      id: "activity-3",
      type: "BENCHMARK",
      projectId: "project-1",
      projectName: "NovaFlow",
      status: "FAILED",
      createdAt: "2026-09-09T00:00:00.000Z",
      availableActions: ["RETRY"],
      resultType: null,
      resultId: null,
      resultUrl: null,
    }),
    [],
  );
});

test("Suite Preflight 只发送 suiteId、engineIds 和 runType", () => {
  assert.deepEqual(
    buildRunPreflightRequest("project/1", {
      suiteId: "suite-1",
      engineIds: ["engine-1"],
      runType: "real",
    }),
    {
      path: "/projects/project%2F1/queries/cost-preflight",
      body: {
        suiteId: "suite-1",
        engineIds: ["engine-1"],
        runType: "real",
      },
    },
  );
});

test("Preflight 仅在 blocked=true 时展示后端原因", () => {
  assert.equal(
    getPreflightBlockedReason({
      queryCount: 10,
      engineCount: 1,
      estimatedCalls: 10,
      estimatedCost: null,
      pricing: null,
      currency: null,
      blocked: false,
      blockedReasonCode: "REAL_PROVIDER_UNAVAILABLE",
      blockedReason: "不应展示",
    }),
    null,
  );
});

test("当前页全选与取消不会清除其他页的选择", () => {
  const selected = new Set(["from-page-1"]);
  assert.deepEqual(
    [...togglePageSelection(selected, ["page-2-a", "page-2-b"], true)].sort(),
    ["from-page-1", "page-2-a", "page-2-b"],
  );
  assert.deepEqual(
    [...togglePageSelection(new Set(["from-page-1", "page-2-a", "page-2-b"]), ["page-2-a", "page-2-b"], false)],
    ["from-page-1"],
  );
});

test("Query 列表查询在集中适配层发送 suite 与服务端分页条件", () => {
  assert.equal(
    buildQueryListPath("project/1", {
      suiteId: "suite-1",
      q: "AI 工具",
      status: "enabled",
      type: "DISCOVERY",
      contamination: "CLEAN",
      sort: "queryText",
      order: "desc",
      page: 3,
      pageSize: 20,
    }),
    "/projects/project%2F1/queries?suiteId=suite-1&q=AI+%E5%B7%A5%E5%85%B7&status=enabled&type=DISCOVERY&contamination=CLEAN&sort=queryText&order=desc&page=3&pageSize=20",
  );
});
