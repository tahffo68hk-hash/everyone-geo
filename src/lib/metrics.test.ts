import { describe, it, expect } from "vitest";
import { mention, metrics } from "./metrics";
describe("brand evidence", () => {
  it("matches Chinese and preserves a character offset", () => {
    expect(mention("可以了解飞书。", "飞书")).toEqual({
      mentioned: true,
      position: 5,
    });
  });
  it("matches Latin brand boundaries and ignores case", () => {
    expect(mention("use Notion today", "NOTION").mentioned).toBe(true);
    expect(mention("notional alternatives", "Notion").mentioned).toBe(false);
  });
  it("escapes regex syntax and handles empty names", () => {
    expect(mention("C++ is here", "C++").mentioned).toBe(true);
    expect(mention("any", "").mentioned).toBe(false);
  });
  it("normalizes full-width characters", () =>
    expect(mention("ＡＣＭＥ", "acme").mentioned).toBe(true));
});
it("counts Unicode characters before the mention", () =>
  expect(mention("🌍飞书", "飞书").position).toBe(2));
describe("sample metrics", () => {
  it("keeps empty samples unknown", () => {
    const m = metrics([]);
    expect(m.rate).toBeNull();
    expect(m.discovery.rate).toBeNull();
  });
  it("separates discovery from branded and counts competitors per answer", () => {
    const m = metrics([
      { brand_mentioned: 0, kind: "DISCOVERY", competitors: '["A","A"]' },
      { brand_mentioned: 1, kind: "DISCOVERY", competitors: "[]" },
      { brand_mentioned: 1, kind: "BRANDED", competitors: '["A","B"]' },
    ]);
    expect(m.rate).toBeCloseTo(2 / 3);
    expect(m.discovery.rate).toBe(0.5);
    expect(m.branded.rate).toBe(1);
    expect(m.competitors).toEqual({ A: 2, B: 1 });
  });
});
