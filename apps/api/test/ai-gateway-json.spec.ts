import { BadRequestException } from "@nestjs/common";
import { AiGatewayService } from "../src/quick-start/ai-gateway.service";
import { ContentPlatform } from "../src/quick-start/quick-start.constants";
import { parseGeneratedContent } from "../src/quick-start/content-quality";

describe("AiGatewayService JSON mode", () => {
  const originalApiKey = process.env.DEEPSEEK_API_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalApiKey;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("requests DeepSeek JSON Output for structured content without making a real call", async () => {
    process.env.DEEPSEEK_API_KEY = "unit-test-key";
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "deepseek-chat",
        choices: [{ message: { content: "{\"title\":\"草稿\"}" }, finish_reason: "stop" }],
      }),
    });
    global.fetch = fetchMock as never;
    const gateway = new AiGatewayService();

    const result = await gateway.complete({
      task: "content",
      provider: "DEEPSEEK",
      prompt: "json content",
      context: {},
      confirmed: true,
      requestCount: 1,
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(requestBody.response_format).toEqual({ type: "json_object" });
    expect(result.answer).toBe("{\"title\":\"草稿\"}");
  });

  it("rejects a response truncated at the token limit", async () => {
    process.env.DEEPSEEK_API_KEY = "unit-test-key";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "{\"title\":" }, finish_reason: "length" }],
      }),
    }) as never;

    await expect(new AiGatewayService().complete({
      task: "content",
      provider: "DEEPSEEK",
      prompt: "json content",
      context: {},
      confirmed: true,
      requestCount: 1,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects empty model content", async () => {
    process.env.DEEPSEEK_API_KEY = "unit-test-key";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: " " }, finish_reason: "stop" }] }),
    }) as never;

    await expect(new AiGatewayService().complete({
      task: "content",
      provider: "DEEPSEEK",
      prompt: "json content",
      context: {},
      confirmed: true,
      requestCount: 1,
    })).rejects.toThrow("没有返回可用内容");
  });

  it("rejects a valid HTTP JSON response with an invalid provider envelope", async () => {
    process.env.DEEPSEEK_API_KEY = "unit-test-key";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => null,
    }) as never;

    await expect(new AiGatewayService().complete({
      task: "content",
      provider: "DEEPSEEK",
      prompt: "json content",
      context: {},
      confirmed: true,
      requestCount: 1,
    })).rejects.toThrow("返回结果结构无效");
  });

  it.each(["xiaohongshu", "douyin", "bilibili"] as ContentPlatform[])(
    "returns valid %s structure from the local Mock provider",
    async (platform) => {
      const context = {
        platform,
        brandName: "Acme",
        brandDescription: "为小型销售团队提供客户管理软件",
        products: ["Acme CRM"],
        targetAudience: "小型销售团队",
        opportunity: "小型销售团队如何选择客户管理软件？",
      };
      const result = await new AiGatewayService().complete({
        task: "content",
        provider: "MOCK",
        prompt: "只用于本地 Mock 验证",
        context,
        confirmed: false,
        requestCount: 1,
      });
      const content = parseGeneratedContent(result.answer, platform, {
        brandName: "Acme",
        supportedFacts: "Acme CRM 为小型销售团队提供客户管理软件",
        hasEnterpriseDetails: true,
        opportunity: context.opportunity,
      });

      expect(result.isMock).toBe(true);
      expect(content.title).toBeTruthy();
      expect(content.body).not.toContain("###");
      if (platform === "xiaohongshu") expect(content.hashtags.length).toBeGreaterThan(0);
      if (platform === "douyin") expect(content.videoScript?.shotSuggestions).toHaveLength(2);
      if (platform === "bilibili") expect(content.videoScript?.outline).toHaveLength(2);
    },
  );
});
