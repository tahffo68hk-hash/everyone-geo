import { it, expect, vi } from "vitest";
import {
  complete,
  defaults,
  infer,
  parseQuestions,
  questionsPrompt,
} from "./gateway";
it("Mock is deterministic and category aware", async () => {
  for (const name of ["CRM助手", "大学计算机专业"]) {
    const b = { name, category: infer(name) };
    const cfg = { provider: "mock" as const, ...defaults.mock, extra: {} };
    const a = await complete(cfg, questionsPrompt(b), "questions", b, false);
    const z = await complete(cfg, questionsPrompt(b), "questions", b, false);
    expect(a.answer).toBe(z.answer);
    expect(a.is_mock).toBe(true);
    const p = parseQuestions(a.answer);
    expect(p.questions).toHaveLength(10);
    expect(p.questions[0].text).toContain(b.category);
    expect(
      p.questions
        .filter((q) => q.kind === "DISCOVERY")
        .every((q) => !q.text.includes(name)),
    ).toBe(true);
  }
});
it("blocks unconfirmed real calls without any network", async () => {
  const f = vi.fn();
  await expect(
    complete(
      {
        provider: "deepseek",
        ...defaults.deepseek,
        key: "fake-test-secret",
        extra: {},
      },
      "q",
      "answer",
      {},
      false,
      f,
    ),
  ).rejects.toThrow("确认");
  expect(f).not.toHaveBeenCalled();
});
it("sends compatible requests with protected model and exposes only returned citations", async () => {
  const f = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "response-model",
          choices: [{ message: { content: "A factual answer" } }],
          usage: { total_tokens: 12 },
          citations: ["https://example.org/source", "javascript:alert(1)"],
        }),
      ),
    );
  const r = await complete(
    {
      provider: "qwen",
      ...defaults.qwen,
      key: "fake-test-secret",
      extra: {
        model: "override",
        stream: true,
        max_tokens: 99999,
        temperature: 0.3,
      },
    },
    "question",
    "answer",
    {},
    true,
    f,
  );
  const [url, req] = f.mock.calls[0];
  expect(url).toContain("/compatible-mode/v1/chat/completions");
  const body = JSON.parse(req.body);
  expect(body.model).toBe("qwen-plus");
  expect(body.max_tokens).toBe(2400);
  expect(body.stream).toBe(false);
  expect(r.model).toBe("response-model");
  expect(r.citations).toEqual(["https://example.org/source"]);
  expect(r.is_mock).toBe(false);
  expect(JSON.stringify(r)).not.toContain("fake-test-secret");
});
it("does not leak provider error body", async () => {
  const f = vi
    .fn()
    .mockResolvedValue(new Response("fake-test-secret", { status: 401 }));
  await expect(
    complete(
      {
        provider: "deepseek",
        ...defaults.deepseek,
        key: "fake-test-secret",
        extra: {},
      },
      "q",
      "answer",
      {},
      true,
      f,
    ),
  ).rejects.toThrow("HTTP 401");
});

it("sanitizes optional inferred competitors and excludes the brand", () => {
  const questions = Array.from({ length: 10 }, () => ({
    text: "Which brand?",
    kind: "DISCOVERY",
    intent: "comparison",
  }));
  const parse = (competitors?: unknown) =>
    parseQuestions(
      JSON.stringify({ category: "software", questions, competitors }),
      "My Brand",
    );
  expect(parse().competitors).toEqual([]);
  expect(parse("invalid").competitors).toEqual([]);
  expect(
    parse([
      null,
      123,
      {},
      "",
      "  ",
      " my BRAND ",
      "x".repeat(41),
      " Rival ",
      "x".repeat(40),
    ]).competitors,
  ).toEqual(["Rival", "x".repeat(40)]);
  expect(
    parse(Array.from({ length: 12 }, (_, i) => `Rival ${i}`)).competitors,
  ).toEqual(Array.from({ length: 8 }, (_, i) => `Rival ${i}`));
});

it("uses the server env key when no config key exists and prefers explicit keys", async () => {
  vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
  try {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Test answer" } }],
        }),
      ),
    );
    const cfg = {
      provider: "deepseek" as const,
      ...defaults.deepseek,
      extra: {},
    };
    await complete(cfg, "q", "answer", {}, true, fetcher);
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer test-key",
    );
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Test answer" } }],
        }),
      ),
    );
    await complete(
      { ...cfg, key: "explicit-test-key" },
      "q",
      "answer",
      {},
      true,
      fetcher,
    );
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe(
      "Bearer explicit-test-key",
    );
    await expect(
      complete({ ...cfg, key: "" }, "q", "answer", {}, true, fetcher),
    ).rejects.toThrow("API Key");
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllEnvs();
  }
});
