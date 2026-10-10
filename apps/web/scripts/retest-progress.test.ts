import assert from "node:assert/strict";
import test from "node:test";
import { deriveRetestProgress } from "../src/lib/retest-progress";
import type { RetestProgressInput } from "../src/lib/retest-progress";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RetestRunSelector } from "../src/components/content/outcome-workspace/retest-run-selector";
import { RetestProgressPanel } from "../src/components/content/outcome-workspace/retest-progress-panel";
import type { AssetOutcomeWorkspace } from "../src/lib/outcome-api";

const base: RetestProgressInput = {
  status: "PENDING",
  totalItems: 4,
  completedItems: 0,
  outcomeCount: null,
  attributionCount: null,
};

const syntheticRun: AssetOutcomeWorkspace["retestRuns"][number] = {
  id: "synthetic-run", sequence: 1, status: "RUNNING", provider: "mock",
  engineKey: "synthetic-engine", engineName: "合成引擎", model: "synthetic-model",
  retrievalMode: "mock", sourceType: "mock", requestedAt: "2026-10-10T00:00:00Z",
  completedAt: null, totalItems: 4, completedItems: 2,
};

function selectorMarkup(runs: AssetOutcomeWorkspace["retestRuns"], selectedRunId: string | null) {
  return renderToStaticMarkup(createElement(RetestRunSelector, { runs, selectedRunId, onChange() {} }));
}

test("selector renders no implicit selection and disables empty lists", () => {
  assert.match(selectorMarkup([], null), /disabled=""/);
  assert.match(selectorMarkup([], null), /暂无复测批次/);
  const invalid = selectorMarkup([syntheticRun], "other-asset-run");
  assert.match(invalid, /value="" selected=""/);
  assert.match(invalid, /尚未选择有效批次/);
  assert.doesNotMatch(invalid, /value="synthetic-run" selected=""/);
});

test("selector timestamp text is stable across server and browser time zones", () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    const serverMarkup = selectorMarkup([syntheticRun], syntheticRun.id);
    process.env.TZ = "Asia/Shanghai";
    assert.equal(selectorMarkup([syntheticRun], syntheticRun.id), serverMarkup);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("selector refuses invalid calendar dates and absent time zones", () => {
  for (const requestedAt of ["2026-02-30T00:00:00Z", "2026-10-10T00:00:00", "bad-date"]) {
    assert.match(selectorMarkup([{ ...syntheticRun, requestedAt }], null), /时间未知/);
  }
});

test("panel exposes real errors as escaped text and announces stage changes", () => {
  const markup = renderToStaticMarkup(createElement(RetestProgressPanel, {
    input: base, error: "<script>合成错误</script>",
  }));
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /role="alert"/);
  assert.match(markup, /&lt;script&gt;合成错误&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /<script>/);
});

function derive(overrides: Partial<RetestProgressInput> = {}) {
  return deriveRetestProgress({ ...base, ...overrides });
}

test("PENDING 和 QUEUED 不宣称执行成功", () => {
  assert.match(derive().executionLabel, /等待执行/);
  assert.match(derive({ status: "QUEUED" }).executionLabel, /已排队/);
  assert.equal(derive({ status: "QUEUED" }).tone, "neutral");
});

test("RUNNING 只描述执行阶段", () => {
  const view = derive({ status: "RUNNING", completedItems: 2 });
  assert.equal(view.tone, "running");
  assert.match(view.executionLabel, /执行中.*2\/4/);
  assert.equal(view.outcomeLabel, "未读取对比结果");
  assert.equal(view.attributionLabel, "未读取归因结果");
});

test("PARTIAL 即使计数相等也不能说已完成", () => {
  const view = derive({ status: "PARTIAL", completedItems: 4 });
  assert.equal(view.tone, "warning");
  assert.match(view.executionLabel, /部分执行/);
  assert.doesNotMatch(view.executionLabel, /执行完成/);
});

test("COMPLETED 只能说复测执行完成，不能说对比或归因完成", () => {
  const view = derive({ status: "COMPLETED", completedItems: 4, outcomeCount: 2, attributionCount: 1 });
  assert.equal(view.tone, "success");
  assert.match(view.executionLabel, /^复测执行完成/);
  assert.match(view.outcomeLabel, /已读取 2 条对比结果/);
  assert.match(view.attributionLabel, /已读取 1 条归因结果/);
  assert.match(view.outcomeLabel, /不代表对比阶段已完成/);
  assert.doesNotMatch(view.executionLabel, /归因已更新|闭环完成/);
});

test("COMPLETED 但部分条目未处理时保留状态并发出矛盾警告", () => {
  const view = derive({ status: "COMPLETED", completedItems: 1 });
  assert.match(view.executionLabel, /执行完成/);
  assert.equal(view.tone, "warning");
  assert.ok(view.warnings.some((warning) => warning.includes("少于总数")));
});

test("FAILED 与 CANCELLED 不冒充完成", () => {
  const failed = derive({ status: "FAILED", completedItems: 1 });
  const cancelled = derive({ status: "CANCELLED" });
  assert.equal(failed.tone, "error");
  assert.match(failed.executionLabel, /执行失败/);
  assert.equal(cancelled.tone, "warning");
  assert.match(cancelled.executionLabel, /已取消/);
});

test("未知、空状态与 SUCCEEDED 旧枚举均不能证明执行完成", () => {
  const absent = derive({ status: null });
  const blank = derive({ status: "   " });
  const unrecognized = derive({ status: "RETRYING" });
  const legacy = derive({ status: "SUCCEEDED" });
  assert.match(absent.executionLabel, /状态未知/);
  assert.equal(absent.warnings.length, 0);
  assert.match(blank.executionLabel, /状态未知/);
  assert.equal(unrecognized.tone, "warning");
  assert.ok(unrecognized.warnings.some((warning) => warning.includes("RETRYING")));
  assert.equal(legacy.tone, "warning");
  assert.doesNotMatch(legacy.executionLabel, /执行完成/);
  assert.ok(legacy.warnings.some((warning) => warning.includes("旧界面兼容")));
});

test("未知计数不会被默认成 0，0 条与 null 保持区别", () => {
  const unknown = derive({ totalItems: null, completedItems: null });
  const zero = derive({ status: "COMPLETED", totalItems: 0, completedItems: 0, outcomeCount: 0, attributionCount: 0 });
  assert.match(unknown.executionLabel, /计数未知/);
  assert.doesNotMatch(unknown.executionLabel, /0\/0/);
  assert.match(zero.executionLabel, /0 项；无可确认的测量结果/);
  assert.equal(zero.tone, "warning");
  assert.equal(zero.outcomeLabel, "暂无对比结果");
  assert.equal(zero.attributionLabel, "暂无归因结果");
});

test("复测计数必须是非负安全整数，矛盾计数显示未知及警告", () => {
  const invalidCases: Array<Partial<RetestProgressInput>> = [
    { totalItems: -1 },
    { totalItems: NaN },
    { totalItems: Infinity },
    { totalItems: 2.5 },
    { totalItems: Number.MAX_SAFE_INTEGER + 1 },
    { completedItems: -1 },
    { completedItems: NaN },
    { completedItems: 1.25 },
    { completedItems: 5 },
  ];
  for (const value of invalidCases) {
    const view = derive(value);
    assert.match(view.executionLabel, /计数未知/);
    assert.ok(view.warnings.length > 0);
    assert.equal(view.tone, "warning");
  }
});

test("部分缺失的计数也显示未知而不凭空补值", () => {
  assert.match(derive({ totalItems: null }).executionLabel, /计数未知/);
  assert.match(derive({ completedItems: null }).executionLabel, /计数未知/);
});

test("对比和归因结果：未读取、暂无、正数、异常数分别展示", () => {
  const missing = derive();
  assert.equal(missing.outcomeLabel, "未读取对比结果");
  assert.equal(missing.attributionLabel, "未读取归因结果");
  const empty = derive({ outcomeCount: 0, attributionCount: 0 });
  assert.equal(empty.outcomeLabel, "暂无对比结果");
  assert.equal(empty.attributionLabel, "暂无归因结果");
  const positive = derive({ outcomeCount: 7, attributionCount: 3 });
  assert.match(positive.outcomeLabel, /7 条对比结果/);
  assert.match(positive.attributionLabel, /3 条归因结果/);
  const invalid = derive({ outcomeCount: NaN, attributionCount: -2 });
  assert.equal(invalid.outcomeLabel, "对比结果数量未知");
  assert.equal(invalid.attributionLabel, "归因结果数量未知");
  assert.equal(invalid.warnings.length, 2);
});
