import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAttributionStatus,
  formatBaselineStatus,
  formatVerificationStatus,
  formatObservedChangeType,
  formatReasonCode,
  formatRetestStatus,
  formatConfounderCode,
  formatPlatform,
} from "../src/lib/outcome-api";
import type { ObservedChangeDirection } from "../src/lib/outcome-api";

// Compile-time coverage: the frontend union must accept every backend ObservedChangeType.
const observedDirections: readonly ObservedChangeDirection[] = [
  "POSITIVE", "NEGATIVE", "MIXED", "NEUTRAL", "NO_CHANGE",
];

test("formats all attribution verdicts and retains the cautious default", () => {
  const expected: Record<string, string> = {
    LIKELY_RELATED: "可能相关",
    INSUFFICIENT_EVIDENCE: "证据不足",
    CONFOUNDED: "存在混杂因素",
    NO_OBSERVED_CHANGE: "未观察到明显变化",
  };
  for (const [code, label] of Object.entries(expected)) {
    const result = formatAttributionStatus(code);
    assert.equal(result.label, label, code);
    assert.ok(result.badgeClass.length > 0);
    assert.ok(result.description.length > 0);
  }
  assert.match(formatAttributionStatus("LIKELY_RELATED").description, /不代表严格因果关系/);
  assert.equal(formatAttributionStatus("NEW_VERDICT").label, "待分析");
  assert.equal(formatAttributionStatus().label, "待分析");
});

test("retains baseline comparability mappings and unknowns", () => {
  const expected: Record<string, string> = {
    EXACT_MATCH: "条件一致",
    COMPARABLE: "条件一致",
    COMPARABLE_WITH_WARNING: "可比较（存在差异）",
    INCOMPATIBLE: "不建议直接比较",
    MISSING_BASELINE: "缺少发布前基线",
    MISSING_RETEST_EVIDENCE: "缺少复测结果",
  };
  for (const [code, label] of Object.entries(expected)) {
    const result = formatBaselineStatus(code);
    assert.equal(result.label, label, code);
    assert.ok(result.description.length > 0);
  }
  assert.equal(formatBaselineStatus().label, "未知条件");
  assert.equal(formatBaselineStatus("NEW_COMPATIBILITY").label, "未知条件");
});

test("distinguishes explicit UNVERIFIED from unknown verification states", () => {
  const expected: Record<string, string> = {
    PLATFORM_CONFIRMED: "平台已确认",
    MANUAL_VERIFIED: "人工已核验",
    UNVERIFIED: "未核验",
  };
  for (const [code, label] of Object.entries(expected)) {
    assert.equal(formatVerificationStatus(code).label, label, code);
  }
  for (const code of [undefined, "", "NEW_VERIFICATION", null as unknown as string]) {
    assert.equal(formatVerificationStatus(code).label, "未知状态", String(code));
  }
});

test("supports every backend observed direction including MIXED", () => {
  const expected: Record<string, string> = {
    POSITIVE: "正向变化",
    NEGATIVE: "负向变化",
    MIXED: "变化方向不一致",
    NEUTRAL: "中性变化",
    NO_CHANGE: "无明显变化",
  };
  assert.equal(observedDirections.length, Object.keys(expected).length);
  for (const direction of observedDirections) {
    const result = formatObservedChangeType(direction);
    assert.equal(result.label, expected[direction], direction);
    assert.ok(result.badgeClass.length > 0);
  }
  for (const code of [undefined, "", "NEW_DIRECTION", null as unknown as string]) {
    assert.equal(formatObservedChangeType(code).label, "未知变化", String(code));
  }
});

test("formats all eighteen emitted attribution reason codes without overstating causality", () => {
  const expected: Record<string, string> = {
    MISSING_BASELINE: "缺少发布前的有效基线证据，无法进行前后比较",
    MISSING_RETEST_EVIDENCE: "缺少有效复测证据，无法进行归因评估",
    INCOMPATIBLE_BASELINE: "基线与复测的关键测试条件不兼容，不能直接比较",
    UNVERIFIED_ASSET: "落地资产尚未完成平台或人工核验",
    NO_OBSERVED_CHANGE: "本次复测未观察到明显指标变化",
    MULTIPLE_INTERVENTIONS: "同一观察窗口内存在其他针对该问题的发布内容",
    INVALID_TEMPORAL_ORDER: "基线、发布与复测的时间先后顺序不符合要求",
    DIRECT_ASSET_CITATION: "发布后回答直接引用了本次发布资产",
    EXACT_BASELINE: "Before / After 测试条件完全一致",
    VERIFIED_PUBLICATION: "发布落地资产已完成核验（不代表已被检索）",
    QUERY_EXPLICITLY_TARGETED: "该问题被明确列为本次内容发布的目标问题",
    QUERY_STRATEGY_TARGETED: "该问题被内容策略列为目标问题",
    MODEL_CHANGED: "基线与复测使用的模型发生变化",
    RETRIEVAL_MODE_CHANGED: "基线与复测的检索模式发生变化（不代表实际检索）",
    QUERY_NOT_TARGETED: "该问题未被列为本次发布或策略的目标问题",
    NO_DIRECT_ASSET_CITATION: "回答中未检测到对本次发布资产的直接引用",
    SAME_DOMAIN_OTHER_PAGE: "发布后回答引用了同域名其他页面（非本落地资产）",
    QUERY_TARGETED: "该问题未被明确标记为非目标问题（目标关系可能未知）",
  };
  assert.equal(Object.keys(expected).length, 18);
  for (const [code, label] of Object.entries(expected)) {
    assert.equal(formatReasonCode(code), label, code);
    assert.notEqual(formatReasonCode(code), code, code);
  }
  assert.match(formatReasonCode("QUERY_TARGETED"), /可能未知/);
  assert.match(formatReasonCode("VERIFIED_PUBLICATION"), /不代表已被检索/);
});

test("keeps old valid reason code mappings and preserves future raw codes", () => {
  const expected: Record<string, string> = {
    NO_ASSET_CITATION: "回答中未检测到该资产或相关链接",
    TEMPORAL_ORDER_VALID: "复测时间晚于内容发布时间",
    TEMPORAL_ORDER_INVALID: "复测时间早于发布时间，时间序列不成立",
    TARGETED_QUERY: "该问题属于内容策划时的目标定向问题",
    NON_TARGETED_QUERY: "该问题非内容策划目标问题",
    ASSET_VERIFIED: "发布落地资产已通过核验（凭证有效）",
    ASSET_UNVERIFIED: "发布落地资产尚未完成核验",
    NO_INTERVENTIONS_DETECTED: "观察窗口内未检测到其他针对相同问题的发布干预",
    NO_OBSERVED_DELTA: "在基线与复测之间未观察到显著数值变化",
    NEGATIVE_DELTA_OBSERVED: "观察到负向变化（品牌提及/引用下降或位次后移）",
    INSUFFICIENT_EVIDENCE_REASONS: "当前证据条件不足以支撑关联推断",
  };
  for (const [code, label] of Object.entries(expected)) {
    assert.equal(formatReasonCode(code), label, code);
  }
  for (const code of ["FUTURE_REASON", "", "futureReason", "providerChanged"]) {
    assert.equal(formatReasonCode(code), code, code);
  }
});

test("retains retest states, adds partial/cancelled/queued, and never invents pending", () => {
  const expected: Record<string, string> = {
    COMPLETED: "已完成",
    SUCCEEDED: "已完成",
    RUNNING: "进行中",
    FAILED: "执行失败",
    PARTIAL: "部分完成",
    CANCELLED: "已取消",
    PENDING: "排队中",
    QUEUED: "排队中",
  };
  for (const [code, label] of Object.entries(expected)) {
    const result = formatRetestStatus(code);
    assert.equal(result.label, label, code);
    assert.ok(result.badgeClass.length > 0);
  }
  for (const code of [undefined, "", "FUTURE_RETEST", null as unknown as string]) {
    assert.equal(formatRetestStatus(code).label, "未知状态", String(code));
  }
});

test("maps every confounder and camelCase aliases, preserving unknown raw codes", () => {
  const expected: Array<[string, string, string]> = [
    ["MULTIPLE_INTERVENTIONS", "multipleInterventions", "同一观察窗口内有多篇针对该问题的发布内容同时生效"],
    ["MODEL_CHANGED", "modelChanged", "前后两次测试所用模型不一致"],
    ["RETRIEVAL_MODE_CHANGED", "retrievalModeChanged", "前后两次测试的检索模式不一致"],
    ["PROVIDER_CHANGED", "providerChanged", "基线与复测使用的模型服务提供方发生变化"],
    ["SOURCE_TYPE_CHANGED", "sourceTypeChanged", "基线与复测的证据来源类型发生变化"],
    ["BASELINE_WARNING", "baselineWarning", "基线与复测存在可比性提示，解读结果需谨慎"],
    ["UNVERIFIED_ASSET", "unverifiedAsset", "该落地资产尚未完成平台或人工核验"],
  ];
  for (const [snake, camel, label] of expected) {
    assert.equal(formatConfounderCode(snake), label, snake);
    assert.equal(formatConfounderCode(camel), label, camel);
  }
  for (const code of ["FUTURE_CONFOUNDER", "futureConFounder", "", "api_plain"]) {
    assert.equal(formatConfounderCode(code), code, code);
  }
});

test("does not alter the unrelated platform formatter", () => {
  assert.equal(formatPlatform("WECHAT_OFFICIAL_ACCOUNT"), "微信公众号");
  assert.equal(formatPlatform("OTHER"), "其他平台");
  assert.equal(formatPlatform(), "未指定平台");
});
