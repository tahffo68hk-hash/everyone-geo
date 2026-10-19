import { ReportContentService } from "../src/quick-start/report-content.service";

describe("ReportContentService GEO suggestions", () => {
  it("uses project and brand context, cleans Markdown, and retains the evidence link", async () => {
    const report = {
      id: "report-1",
      projectId: "project-1",
      brandId: "brand-1",
      containsMockData: true,
      brand: {
        name: "Acme",
        website: "https://acme.example",
        description: "客户管理软件",
        products: ["Acme CRM"],
        aliases: [],
      },
      project: {
        industry: "SaaS",
        region: "中国大陆",
        targetAudience: "小型销售团队",
        competitors: [],
      },
      run: {
        provider: "MOCK",
        model: "geolens-mock-v1",
        responses: [{
          id: "response-1",
          queryId: "query-1",
          queryText: "小型销售团队如何选择客户管理软件？",
          rawResponse: "可以先核对团队的日常流程和产品资料。",
          brandMentioned: false,
          isMock: true,
        }],
      },
    };
    const prisma = {
      client: {
        geoReport: { findUnique: jest.fn().mockResolvedValue(report) },
        optimizationSuggestion: { create: jest.fn().mockResolvedValue({}) },
        $transaction: jest.fn().mockResolvedValue([]),
      },
    };
    const tenant = { assertUserInProject: jest.fn().mockResolvedValue({}) };
    const gateway = {
      providerStatus: jest.fn().mockReturnValue([{ provider: "MOCK", configured: true }]),
      complete: jest.fn().mockResolvedValue({
        answer: JSON.stringify({
          suggestions: [{
            title: "**补充客户问题说明**",
            action: "### 下一步\n\n围绕真实团队流程补充客户管理软件的选择条件。",
            responseId: "response-1",
            queryId: "query-1",
          }],
        }),
        provider: "MOCK",
        model: "geolens-mock-v1",
        isMock: true,
        tokens: null,
        latencyMs: 1,
        costEstimate: 0,
      }),
    };
    const service = new ReportContentService(prisma as never, tenant as never, gateway as never);

    await service.generateSuggestions("report-1", "user-1", false);

    expect(gateway.complete.mock.calls[0][0].prompt).toContain("Acme CRM");
    expect(gateway.complete.mock.calls[0][0].prompt).toContain("小型销售团队");
    const savedData = prisma.client.optimizationSuggestion.create.mock.calls[0][0].data;
    expect(savedData.title).toBe("补充客户问题说明");
    expect(savedData.action).not.toContain("###");
    expect(savedData.promptVersion).toBe("geolens-suggestions-v2");
    expect(savedData.evidence.create).toEqual([{ responseId: "response-1" }]);
  });
});
