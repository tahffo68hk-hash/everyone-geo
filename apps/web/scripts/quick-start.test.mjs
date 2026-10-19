import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBenchmarkQueries,
  normalizeGeneratedQuestions,
  quickStartStorageKey,
} from "../src/lib/quick-start.ts";

test("生成问题去重并把包含品牌名的问题标记为品牌认知测试", () => {
  const questions = normalizeGeneratedQuestions([
    { text: "适合小团队的项目管理工具有哪些？", category: "discovery", intent: "工具发现" },
    { text: "星河项目管理的价格是多少？", category: "comparison", intent: "价格了解" },
    { text: " 适合小团队的项目管理工具有哪些？ ", category: "workflow", intent: "重复" },
  ], "星河");

  assert.equal(questions.length, 2);
  assert.equal(questions[0].category, "tool-discovery");
  assert.equal(questions[0].queryType, "DISCOVERY");
  assert.equal(questions[1].queryType, "BRANDED_SANITY");
});

test("正式 Benchmark 查询保留发现与品牌认知语义并使用现有查询 contract", () => {
  const payload = buildBenchmarkQueries([
    { id: "q1", text: "适合小团队的项目管理工具有哪些？", category: "tool-discovery", intent: "工具发现", queryType: "DISCOVERY", rationale: "" },
    { id: "q2", text: "星河项目管理的价格是多少？", category: "comparison", intent: "价格了解", queryType: "BRANDED_SANITY", rationale: "" },
  ]);

  assert.equal(payload[0].queryText, "适合小团队的项目管理工具有哪些？");
  assert.equal(payload[0].source, "BUILDER");
  assert.equal(payload[0].sanity, false);
  assert.equal(payload[1].sanity, true);
  assert.equal(payload[1].queryType, "BRANDED_SANITY");
});

test("向导进度按用户与项目隔离保存", () => {
  assert.equal(quickStartStorageKey("user-1", "project-1"), "geolens:quick-start:user-1:project-1");
  assert.notEqual(quickStartStorageKey("user-1", "project-1"), quickStartStorageKey("user-1", "project-2"));
});
