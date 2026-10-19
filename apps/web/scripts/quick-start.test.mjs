import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBenchmarkQueries,
  extractQuickStartRecommendations,
  normalizeGeneratedQuestions,
  replaceQuickStartQuestions,
  selectReportAnalysis,
  quickStartPendingProjectKey,
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
  assert.equal(quickStartPendingProjectKey("user-1"), "geolens:quick-start:user-1:pending-project");
});

test("正式 Recommendation 响应会提取建议记录并保留血缘 ID", () => {
  const recommendations = extractQuickStartRecommendations({
    recommendationRun: { id: "recommendation-run-1" },
    recommendations: [{ id: "recommendation-1", title: "补充品牌案例" }],
  });

  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].id, "recommendation-1");
});

test("Evidence 分析按报告冻结的 analysisVersion 选择", () => {
  const analysis = selectReportAnalysis([
    { analysisVersion: "m4-rule-v1", brandMentioned: false },
    { analysisVersion: "m6b-competitors-v1", brandMentioned: true },
  ], "m6b-competitors-v1");

  assert.equal(analysis?.brandMentioned, true);
  assert.equal(selectReportAnalysis([{ analysisVersion: "m4-rule-v1" }], "m6b-competitors-v1"), null);
});

test("问题增删改会使旧 Benchmark Suite 失效", () => {
  const current = { suiteId: "suite-old", questions: [{ id: "q1", text: "旧问题" }] };
  const updated = replaceQuickStartQuestions(current, [{ id: "q1", text: "新问题" }]);

  assert.equal(updated.suiteId, "");
  assert.equal(updated.questions[0].text, "新问题");
});
