import assert from "node:assert/strict";
import test from "node:test";
import {
  getMeasurementLimitsCopy,
  type MeasurementLimitsInput,
} from "../src/lib/measurement-limits-copy";

const verdict = (
  value: NonNullable<MeasurementLimitsInput["measurement"]>["verdict"],
  mode: NonNullable<MeasurementLimitsInput["measurement"]>["mode"] = "UNKNOWN",
  reasons: string[] = [],
): NonNullable<MeasurementLimitsInput["measurement"]> => ({ verdict: value, mode, reasons });

const combinedText = (input: MeasurementLimitsInput): string =>
  getMeasurementLimitsCopy(input).messages.join("\n");

test("VALID uses the supplied authority, but never asserts causal improvement", () => {
  const result = getMeasurementLimitsCopy({
    sourceType: "official_api",
    retrievalMode: "api_web_search",
    attributionStatus: "OBSERVED",
    measurement: verdict("VALID_FOR_WEB_CHANGE", "WEB_VALIDATED", ["确认存在真实检索 provenance。"]),
  });
  assert.equal(result.tone, "info");
  assert.match(result.messages.join(" "), /服务端判定可用于网页变化测量/);
  assert.match(result.messages.join(" "), /不代表优化动作已经产生因果效果/);
  assert.ok(result.messages.some((message) => message.includes("确认存在真实检索 provenance。")));
});

test("PARTIALLY_VALID warns that retrieval confirmation is missing", () => {
  const result = getMeasurementLimitsCopy({
    sourceType: "official_api",
    retrievalMode: "official_web_ui",
    measurement: verdict("PARTIALLY_VALID", "WEB_VALIDATED", ["未提供 retrievalConfirmed。"]),
  });
  assert.equal(result.tone, "warning");
  assert.match(result.messages.join(" "), /尚缺必要的网页检索或核验确认/);
  assert.match(result.messages.join(" "), /未提供 retrievalConfirmed/);
});

test("mock takes priority over contradictory VALID verdict", () => {
  const result = getMeasurementLimitsCopy({
    sourceType: "MOCK",
    retrievalMode: "api_web_search",
    measurement: verdict("VALID_FOR_WEB_CHANGE", "WEB_VALIDATED"),
  });
  assert.equal(result.tone, "warning");
  assert.equal(result.title, "模拟/估算来源限制");
  assert.match(result.messages.join(" "), /模拟\/估算结果不能证明真实效果/);
  assert.match(result.messages.join(" "), /来源与服务端测量判定存在矛盾/);
});

test("estimated is treated as simulated even when authority reports VALID", () => {
  const result = getMeasurementLimitsCopy({
    sourceType: " estimated ",
    retrievalMode: "browser_agent",
    measurement: verdict("VALID_FOR_WEB_CHANGE", "WEB_VALIDATED"),
  });
  assert.equal(result.tone, "warning");
  assert.match(result.messages.join(" "), /模拟\/估算结果不能证明真实效果/);
  assert.match(result.messages.join(" "), /存在矛盾/);
});

test("mock plus api_plain keeps both warnings without changing the verdict", () => {
  const text = combinedText({
    sourceType: "mock",
    retrievalMode: "api_plain",
    measurement: verdict("INVALID_FOR_WEB_CHANGE", "MODEL_BEHAVIOR_ONLY"),
  });
  assert.match(text, /模拟\/估算结果不能证明真实效果/);
  assert.match(text, /api_plain 仅模型行为观测，不能证明读取公开网页改动/);
});

test("api_plain always warns even with a matching invalid measurement", () => {
  const result = getMeasurementLimitsCopy({
    sourceType: "official_api",
    retrievalMode: "API_PLAIN",
    measurement: verdict("INVALID_FOR_WEB_CHANGE", "MODEL_BEHAVIOR_ONLY"),
  });
  assert.equal(result.tone, "warning");
  assert.equal(result.title, "仅模型行为观测");
  assert.match(result.messages.join(" "), /不能证明读取公开网页改动/);
});

test("api_plain conflicts with VALID even when the server mode says WEB_VALIDATED", () => {
  const text = combinedText({
    sourceType: "official_api",
    retrievalMode: "api_plain",
    measurement: verdict("VALID_FOR_WEB_CHANGE", "WEB_VALIDATED"),
  });
  assert.match(text, /api_plain 仅模型行为观测/);
  assert.match(text, /存在矛盾/);
  assert.match(text, /不能直接据此确认网页实验有效/);
});

test("api_plain conflicts with PARTIALLY_VALID web measurement", () => {
  const result = getMeasurementLimitsCopy({
    sourceType: "official_api",
    retrievalMode: "api_plain",
    measurement: verdict("PARTIALLY_VALID", "WEB_VALIDATED"),
  });
  assert.equal(result.tone, "warning");
  assert.match(result.messages.join(" "), /存在矛盾/);
});

test("null measurement stays unknown; no default valid verdict", () => {
  const result = getMeasurementLimitsCopy({
    sourceType: "official_api",
    retrievalMode: "api_web_search",
    measurement: null,
  });
  assert.equal(result.tone, "warning");
  assert.match(result.messages.join(" "), /尚缺权威测量判定/);
  assert.doesNotMatch(result.messages.join(" "), /服务端判定可用于网页变化测量/);
});

test("UNKNOWN measurement is explicitly shown as unknown", () => {
  const result = getMeasurementLimitsCopy({
    sourceType: "official_api",
    retrievalMode: "api_web_search",
    measurement: verdict("UNKNOWN", "UNKNOWN"),
  });
  assert.equal(result.tone, "warning");
  assert.match(result.messages.join(" "), /服务端测量判定为未知/);
});

test("missing source and retrieval provenance does not turn a supplied VALID into confirmed browsing", () => {
  const result = getMeasurementLimitsCopy({
    measurement: verdict("VALID_FOR_WEB_CHANGE", "WEB_VALIDATED"),
  });
  assert.equal(result.tone, "warning");
  assert.equal(result.title, "测量来源信息不完整");
  assert.match(result.messages.join(" "), /缺少完整的 sourceType 或 retrievalMode/);
  assert.match(result.messages.join(" "), /不能直接据此确认网页实验有效/);
});

test("manual_verified tag without verdict does not say manual verification passed", () => {
  const result = getMeasurementLimitsCopy({
    sourceType: "manual",
    retrievalMode: "manual_verified",
    measurement: null,
  });
  assert.equal(result.tone, "warning");
  assert.match(result.messages.join(" "), /来源标记不等于人工核验通过/);
  assert.match(result.messages.join(" "), /尚缺权威测量判定/);
});

test("manual PARTIALLY_VALID still requires authoritative verification", () => {
  const result = getMeasurementLimitsCopy({
    sourceType: "manual",
    retrievalMode: "manual_verified",
    measurement: verdict("PARTIALLY_VALID", "MANUAL_VERIFIED"),
  });
  assert.equal(result.tone, "warning");
  assert.match(result.messages.join(" "), /需要实际的服务端核验判定及 provenance/);
});

test("manual VALID with MANUAL_VERIFIED mode attributes verification only to the server", () => {
  const result = getMeasurementLimitsCopy({
    sourceType: "manual",
    retrievalMode: "manual_verified",
    measurement: verdict("VALID_FOR_WEB_CHANGE", "MANUAL_VERIFIED"),
  });
  assert.equal(result.tone, "info");
  assert.match(result.messages.join(" "), /服务端提供了人工核验有效判定/);
  assert.match(result.messages.join(" "), /本组件不独立验证/);
});

test("LIKELY_RELATED is described as correlation, never causation", () => {
  const text = combinedText({
    sourceType: "manual",
    retrievalMode: "manual_verified",
    attributionStatus: "likely_related",
    measurement: verdict("VALID_FOR_WEB_CHANGE", "MANUAL_VERIFIED"),
  });
  assert.match(text, /LIKELY_RELATED 表示可能相关/);
  assert.match(text, /不是因果关系或优化效果已被证明/);
});

test("no attribution status does not infer a causal result", () => {
  const text = combinedText({ sourceType: "official_api", retrievalMode: "browser_agent", measurement: null });
  assert.match(text, /不能仅凭时间先后或相关性证明因果关系/);
  assert.doesNotMatch(text, /LIKELY_RELATED/);
});

test("server reasons remain plain text values, including HTML-shaped content", () => {
  const reason = '<img src=x onerror="alert(1)">';
  const result = getMeasurementLimitsCopy({
    sourceType: "official_api",
    retrievalMode: "api_plain",
    measurement: verdict("INVALID_FOR_WEB_CHANGE", "MODEL_BEHAVIOR_ONLY", [reason]),
  });
  assert.ok(result.messages.includes(`服务端测量原因：${reason}`));
  // The notice renders each message as a React text child, not as HTML.
});

test("frozen inputs and reason arrays are not mutated", () => {
  const reasons: string[] = ["记录的来源原因"];
  Object.freeze(reasons);
  const measurement: NonNullable<MeasurementLimitsInput["measurement"]> = {
    verdict: "UNKNOWN", mode: "UNKNOWN", reasons,
  };
  Object.freeze(measurement);
  const input: MeasurementLimitsInput = { sourceType: "official_api", retrievalMode: "api_plain", measurement };
  Object.freeze(input);
  const first = getMeasurementLimitsCopy(input);
  const second = getMeasurementLimitsCopy(input);
  assert.deepEqual(first, second);
  assert.deepEqual(reasons, ["记录的来源原因"]);
});

test("provider name is not read or used as retrieval evidence", () => {
  const input: MeasurementLimitsInput & { provider: string } = {
    provider: "Example Search Provider",
    measurement: null,
  };
  const result = getMeasurementLimitsCopy(input);
  assert.equal(result.tone, "warning");
  assert.doesNotMatch(result.messages.join(" "), /Example Search Provider/);
  assert.match(result.messages.join(" "), /尚缺权威测量判定/);
});
