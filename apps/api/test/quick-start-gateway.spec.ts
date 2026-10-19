import { AiGatewayService } from "../src/quick-start/ai-gateway.service";

describe("AiGatewayService", () => {
  it("generates ten clearly marked Mock questions without a network call", async () => {
    const gateway = new AiGatewayService();
    const result = await gateway.complete({
      task: "questions",
      provider: "MOCK",
      model: "geolens-mock-v1",
      prompt: "generate questions",
      context: { brandName: "Acme", industry: "SaaS" },
      confirmed: false,
      requestCount: 1,
    });
    const payload = JSON.parse(result.answer) as {
      questions: Array<{ kind: string; text: string }>;
    };

    expect(result.isMock).toBe(true);
    expect(result.provider).toBe("MOCK");
    expect(payload.questions).toHaveLength(10);
    expect(payload.questions.filter((question) => question.kind === "DISCOVERY")).toHaveLength(7);
    expect(payload.questions.filter((question) => question.kind === "BRANDED")).toHaveLength(3);
  });
});
