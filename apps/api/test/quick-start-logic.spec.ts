import {
  analyzeBrandMention,
  assertPaidCallConfirmed,
  calculateVisibilityMetrics,
  isValidQuestionCount,
  parseJsonPayload,
} from "../src/quick-start/quick-start.logic";

describe("quick start GEO logic", () => {
  it("normalizes full-width text and reports the first brand position", () => {
    expect(analyzeBrandMention("这是优秀的ＡＣＭＥ方案", "ACME")).toEqual({
      mentioned: true,
      position: 6,
    });
  });

  it("does not treat a partial English word as a brand mention", () => {
    expect(analyzeBrandMention("Acmeology has several products", "Acme")).toEqual({
      mentioned: false,
      position: null,
    });
  });

  it("reports overall, discovery, branded, and competitor sample metrics", () => {
    expect(
      calculateVisibilityMetrics([
        {
          kind: "DISCOVERY",
          brandMentioned: true,
          competitorMentions: ["Kite", "Kite"],
        },
        {
          kind: "BRANDED",
          brandMentioned: false,
          competitorMentions: ["Kite", "Nova"],
        },
      ]),
    ).toEqual({
      total: 2,
      mentioned: 1,
      rate: 0.5,
      discovery: { total: 1, mentioned: 1, rate: 1 },
      branded: { total: 1, mentioned: 0, rate: 0 },
      competitors: { Kite: 2, Nova: 1 },
    });
  });

  it("requires an explicit confirmation before any real-provider request", () => {
    expect(() => assertPaidCallConfirmed("MOCK", false, 10)).not.toThrow();
    expect(() => assertPaidCallConfirmed("DEEPSEEK", false, 10)).toThrow(
      "确认本次 10 次真实模型请求后才能继续",
    );
    expect(() => assertPaidCallConfirmed("QWEN", true, 1)).not.toThrow();
  });

  it("parses JSON returned inside a fenced model response", () => {
    expect(parseJsonPayload('```json\n{"industry":"SaaS"}\n```')).toEqual({
      industry: "SaaS",
    });
  });

  it("only permits a confirmed monitoring set of 8–12 questions", () => {
    expect(isValidQuestionCount(7)).toBe(false);
    expect(isValidQuestionCount(8)).toBe(true);
    expect(isValidQuestionCount(12)).toBe(true);
    expect(isValidQuestionCount(13)).toBe(false);
  });
});
