import { it, expect } from "vitest";
import {
  channels,
  contentPrompt,
  mockContent,
  validateBody,
  validateSuggestions,
  suggestionsPrompt,
} from "./content";
import { complete, defaults } from "./gateway";
const responses = [
  {
    id: "q-1",
    query: "CRM如何选型？",
    raw_answer: "缺少品牌证据",
    brand_mentioned: 0,
    intent: "方案比较",
    is_mock: 1,
  },
];
it("adapts all ten channels with distinct instructions and stored answer evidence", () => {
  expect(Object.keys(channels)).toHaveLength(10);
  const prompts = Object.keys(channels).map((c) =>
    contentPrompt(c as keyof typeof channels, "CRM", responses, []),
  );
  expect(new Set(prompts).size).toBe(10);
  prompts.forEach((p) => {
    expect(p).toContain("q-1");
    expect(p).toContain("缺少品牌证据");
    expect(p).toContain("storyboard");
  });
  expect(prompts[1]).toContain("20字以内");
  expect(prompts[3]).toContain("横屏");
  expect(prompts[6]).toContain("280字");
});
it("Mock gateway generates valid editable content for every channel, accurately labelled", async () => {
  for (const channel of Object.keys(channels)) {
    const r = await complete(
      { provider: "mock", ...defaults.mock, extra: {} },
      "",
      "content",
      { channel, name: "CRM", responses },
      false,
    );
    expect(r.is_mock).toBe(true);
    expect(r.cost).toBe(0);
    const body = validateBody(JSON.parse(r.answer));
    expect(body.body).toContain("模拟数据/未真实验证");
    expect(body.body).toContain("CRM如何选型");
  }
  expect(mockContent("douyin", "CRM", responses).storyboard).toContain("0–3秒");
  expect(mockContent("geo", "CRM", responses).videoScript).toBe("");
});
it("suggestions accept actual IDs and reject invented or missing evidence", async () => {
  expect(suggestionsPrompt(responses)).toContain("缺少品牌证据");
  const r = await complete(
    { provider: "mock", ...defaults.mock, extra: {} },
    "",
    "suggestions",
    { responses },
    false,
  );
  expect(validateSuggestions(r.answer, responses)[0].queryIds).toEqual(["q-1"]);
  for (const queryIds of [[], ["invented"]])
    expect(() =>
      validateSuggestions(
        JSON.stringify({
          suggestions: [{ title: "t", action: "a", queryIds }],
        }),
        responses,
      ),
    ).toThrow();
});
it("rejects malformed content rather than saving partial provider responses", () => {
  expect(() => validateBody({ title: "ok", body: "ok" })).toThrow();
  const good = mockContent("geo", "CRM", responses);
  expect(() => validateBody({ ...good, title: "" })).toThrow();
  expect(() => validateBody({ ...good, body: "x".repeat(30001) })).toThrow();
});
