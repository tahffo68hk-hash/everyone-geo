import { describe, it, expect } from "vitest";
import { aliases, mention, metrics } from "./metrics";
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

describe("brand aliases", () => {
  it.each([
    ["瑞幸咖啡", "我常喝瑞幸。", 4],
    ["库迪咖啡", "库迪", 1],
    ["Manner Coffee", "Manner", 1],
    ["Tims天好咖啡", "Tims天好", 1],
  ])("matches %s by its short name", (name, answer, position) => {
    expect(mention(answer, name)).toEqual({ mentioned: true, position });
  });
  it("keeps generic or too-short names intact", () => {
    expect(aliases("咖啡")).toEqual(["咖啡"]);
    expect(mention("普通饮料", "咖啡").mentioned).toBe(false);
    expect(aliases("A Tea")).toEqual(["A Tea"]);
    expect(aliases("好咖啡")).toEqual(["好咖啡"]);
  });
  it("trims spaces, ignores suffix case, and strips only once", () => {
    expect(aliases(" Manner cOfFeE ")).toEqual([" Manner cOfFeE ", "Manner"]);
    expect(aliases("瑞幸咖啡品牌")).toEqual(["瑞幸咖啡品牌", "瑞幸咖啡"]);
    expect(aliases("瑞幸股份有限公司")).toEqual(["瑞幸股份有限公司", "瑞幸"]);
    expect(aliases("Tims天好咖啡")).toEqual(["Tims天好咖啡", "Tims天好"]);
  });
  it("preserves ASCII boundaries and chooses the earliest alias", () => {
    expect(mention("Mannerism", "Manner Coffee").mentioned).toBe(false);
    expect(mention("🌍瑞幸，然后瑞幸咖啡", "瑞幸咖啡").position).toBe(2);
  });
});
