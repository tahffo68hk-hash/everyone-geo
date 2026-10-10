import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOutcomeSnapshot } from "../src/lib/outcome-snapshot";

const unknownView = {
  evidenceId: null,
  brandMentioned: null,
  mentionPosition: null,
  recommended: null,
  citationCount: null,
  capturedAt: null,
  competitorsMentioned: null,
};

test("canonical fields map without changing their meaning", () => {
  const snapshot = {
    evidenceId: "evidence-1",
    brandMentioned: true,
    mentionPosition: 3,
    recommended: false,
    citationCount: 0,
    capturedAt: "2026-10-10T08:09:10.123+08:00",
    competitorsMentioned: ["品牌甲", "品牌乙"],
  };
  assert.deepEqual(normalizeOutcomeSnapshot(snapshot), snapshot);
});

test("legacy UI aliases are read only when canonical keys are absent", () => {
  assert.deepEqual(normalizeOutcomeSnapshot({
    evidenceId: "legacy-evidence",
    brandMention: true,
    position: 2,
    recommendation: false,
    timestamp: "2024-02-29T12:45:00Z",
    competitors: ["竞争者甲"],
  }), {
    evidenceId: "legacy-evidence",
    brandMentioned: true,
    mentionPosition: 2,
    recommended: false,
    citationCount: null,
    capturedAt: "2024-02-29T12:45:00Z",
    competitorsMentioned: ["竞争者甲"],
  });
});

test("canonical values beat conflicting legacy aliases, including false and []", () => {
  assert.deepEqual(normalizeOutcomeSnapshot({
    brandMentioned: false, brandMention: true,
    mentionPosition: 4, position: 9,
    recommended: false, recommendation: true,
    capturedAt: "2026-01-01T00:00:00Z", timestamp: "2025-01-01T00:00:00Z",
    competitorsMentioned: [], competitors: ["不应采用"],
  }), {
    ...unknownView,
    brandMentioned: false,
    mentionPosition: 4,
    recommended: false,
    capturedAt: "2026-01-01T00:00:00Z",
    competitorsMentioned: [],
  });
});

test("canonical null, undefined or invalid blocks alias fallback", () => {
  assert.deepEqual(normalizeOutcomeSnapshot({
    brandMentioned: null, brandMention: true,
    mentionPosition: undefined, position: 1,
    recommended: "yes", recommendation: true,
    capturedAt: "invalid", timestamp: "2026-01-01T00:00:00Z",
    competitorsMentioned: ["ok", 2], competitors: ["legacy"],
  }), unknownView);
});

test("false is known false; numeric/string truthiness is not a boolean", () => {
  assert.equal(normalizeOutcomeSnapshot({ brandMentioned: false }).brandMentioned, false);
  assert.equal(normalizeOutcomeSnapshot({ recommended: false }).recommended, false);
  for (const invalid of [0, 1, "false", "true", null, undefined, {}, []]) {
    assert.equal(normalizeOutcomeSnapshot({ brandMentioned: invalid }).brandMentioned, null);
    assert.equal(normalizeOutcomeSnapshot({ recommended: invalid }).recommended, null);
  }
});

test("citationCount accepts zero and finite nonnegative integers only", () => {
  for (const valid of [0, 1, 25]) {
    assert.equal(normalizeOutcomeSnapshot({ citationCount: valid }).citationCount, valid);
  }
  for (const invalid of [-1, 2.5, NaN, Infinity, -Infinity, "0", null, undefined]) {
    assert.equal(normalizeOutcomeSnapshot({ citationCount: invalid }).citationCount, null);
  }
});

test("mentionPosition accepts positive integers only; zero means unknown", () => {
  for (const valid of [1, 5]) {
    assert.equal(normalizeOutcomeSnapshot({ mentionPosition: valid }).mentionPosition, valid);
  }
  for (const invalid of [0, -1, 1.1, Infinity, NaN, "1", false, null]) {
    assert.equal(normalizeOutcomeSnapshot({ mentionPosition: invalid }).mentionPosition, null);
  }
});

test("evidenceId must be a nonblank string; the original ID is preserved", () => {
  assert.equal(normalizeOutcomeSnapshot({ evidenceId: " e-1 " }).evidenceId, " e-1 ");
  for (const invalid of ["", "   ", 5, {}, [], null, undefined]) {
    assert.equal(normalizeOutcomeSnapshot({ evidenceId: invalid }).evidenceId, null);
  }
});

test("ISO timestamps accept Z / explicit offsets and retain their original text", () => {
  for (const valid of [
    "2024-02-29T12:30:59Z",
    "2026-10-10T08:09Z",
    "2026-10-10T08:09:10.987654+08:00",
    "2026-10-10T08:09:10-07:30",
  ]) {
    assert.equal(normalizeOutcomeSnapshot({ capturedAt: valid }).capturedAt, valid);
  }
});

test("invalid ISO timestamps never fall back to a current time", () => {
  for (const invalid of [
    "2025-02-29T00:00:00Z", // not a leap year
    "2026-02-30T00:00:00Z", // Date.parse may roll over this day
    "2026-04-31T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T23:60:00Z",
    "2026-01-01T23:59:60Z",
    "2026-01-01T00:00:00+24:00",
    "2026-01-01T00:00:00+08:60",
    "2026-01-01T00:00:00", // missing explicit time zone
    "2026-01-01", "not-a-date", "", 0, null,
  ]) {
    assert.equal(normalizeOutcomeSnapshot({ capturedAt: invalid }).capturedAt, null);
  }
});

test("competitor arrays preserve an empty list and strings; mixed arrays are unknown", () => {
  assert.deepEqual(normalizeOutcomeSnapshot({ competitorsMentioned: [] }).competitorsMentioned, []);
  assert.deepEqual(normalizeOutcomeSnapshot({
    competitorsMentioned: ["甲", "甲", ""],
  }).competitorsMentioned, ["甲", "甲", ""]);
  for (const invalid of [["甲", null], [5], "甲", {}, null, undefined]) {
    assert.equal(normalizeOutcomeSnapshot({ competitorsMentioned: invalid }).competitorsMentioned, null);
  }
});

test("missing keys, arrays, null and non-object inputs are all unknown", () => {
  for (const invalid of [null, undefined, [], [1], "", "string", 0, false, {}]) {
    assert.deepEqual(normalizeOutcomeSnapshot(invalid), unknownView);
  }
  assert.deepEqual(normalizeOutcomeSnapshot({ irrelevant: 1 }), unknownView);
});

test("input is not mutated, even when deeply frozen", () => {
  const competitors = Object.freeze(["竞品A", "竞品B"]);
  const snapshot = Object.freeze({
    evidenceId: "evidence-frozen",
    brandMentioned: false,
    citationCount: 0,
    competitorsMentioned: competitors,
  });
  const output = normalizeOutcomeSnapshot(snapshot);
  assert.deepEqual(output, {
    ...unknownView,
    evidenceId: "evidence-frozen",
    brandMentioned: false,
    citationCount: 0,
    competitorsMentioned: ["竞品A", "竞品B"],
  });
  assert.notStrictEqual(output.competitorsMentioned, competitors);
  output.competitorsMentioned?.push("结果数组可独立修改");
  assert.deepEqual(competitors, ["竞品A", "竞品B"]);
  assert.deepEqual(snapshot.competitorsMentioned, ["竞品A", "竞品B"]);
});

test("inherited keys are not mistaken for persisted snapshot keys", () => {
  const inherited = Object.create({ brandMentioned: true, position: 1 });
  assert.deepEqual(normalizeOutcomeSnapshot(inherited), unknownView);
  inherited.brandMention = false;
  assert.deepEqual(normalizeOutcomeSnapshot(inherited), {
    ...unknownView,
    brandMentioned: false,
  });
});
test("sparse competitor arrays are unknown and canonical invalid arrays block legacy fallback", () => {
  const sparse = new Array<string>(1);
  const withHole = ["first", "last"];
  delete withHole[0];
  for (const competitors of [sparse, withHole]) {
    assert.equal(normalizeOutcomeSnapshot({ competitors }).competitorsMentioned, null);
    assert.equal(
      normalizeOutcomeSnapshot({ competitorsMentioned: competitors, competitors: ["legacy"] }).competitorsMentioned,
      null,
    );
  }
});
