import { ReportContentService } from "../src/quick-start/report-content.service";

describe("ReportContentService content generation", () => {
  it("uses the enterprise profile and report evidence, saves cleaned content and risk notes", async () => {
    const report = {
      id: "report-1",
      projectId: "project-1",
      brandId: "brand-1",
      containsMockData: true,
      brand: {
        id: "brand-1",
        name: "Acme",
        website: "https://acme.example",
        description: "为小型销售团队提供客户管理软件",
        products: ["Acme CRM"],
        aliases: [],
      },
      project: {
        name: "Acme GEO",
        description: "官方品牌项目",
        industry: "客户关系管理软件",
        region: "中国大陆",
        targetAudience: "小型销售团队",
        competitors: [],
      },
      run: {
        id: "run-1",
        sessionId: "session-1",
        provider: "MOCK",
        model: "geolens-mock-v1",
        responses: [{
          id: "response-1",
          queryId: "query-1",
          queryText: "小型销售团队如何选择客户管理软件？",
          rawResponse: "比较线索记录、跟进流程和团队使用方式。",
          brandMentioned: false,
          isMock: true,
          intent: "产品比较",
        }],
      },
      suggestions: [],
    };
    const savedAsset = { id: "content-1", channel: "xiaohongshu" };
    const prisma = {
      client: {
        geoReport: {
          findUnique: jest.fn()
            .mockResolvedValueOnce({ id: "report-1", projectId: "project-1" })
            .mockResolvedValueOnce(report),
        },
        contentAsset: { create: jest.fn().mockResolvedValue(savedAsset) },
        quickStartSession: { update: jest.fn().mockResolvedValue({}) },
      },
    };
    const tenant = { assertUserInProject: jest.fn().mockResolvedValue({}) };
    const modelContent = {
      title: "客户资料总要分散找？先看团队每天怎么跟进",
      body: "### 先从跟进动作开始\n\n小团队选客户管理软件时，可以先列出线索记录、跟进提醒和交接方式，再对照产品公开说明逐项确认。\n\n功能和服务范围以企业资料为准。当前可用率为 99.9%，月费 99 元。",
      summary: "从日常线索和跟进流程核对客户管理软件需求。",
      hashtags: ["#客户管理", "#销售团队"],
      videoScript: null,
      riskNotes: [],
      metadata: {},
    };
    const gateway = {
      providerStatus: jest.fn().mockReturnValue([{ provider: "MOCK", configured: true }]),
      complete: jest.fn().mockResolvedValue({
        answer: JSON.stringify(modelContent),
        provider: "MOCK",
        model: "geolens-mock-v1",
        isMock: true,
        tokens: null,
        latencyMs: 1,
        costEstimate: 0,
      }),
    };
    const service = new ReportContentService(prisma as never, tenant as never, gateway as never);

    const result = await service.generateContent("report-1", "user-1", {
      channel: "xiaohongshu",
      enterpriseContext: "主要面向 3 至 10 人销售团队，表达务实，不承诺业绩提升。",
      confirmed: false,
    });

    const request = gateway.complete.mock.calls[0][0];
    expect(request.prompt).toContain("小型销售团队");
    expect(request.prompt).toContain("Acme CRM");
    expect(request.prompt).toContain("主要面向 3 至 10 人销售团队");
    expect(request.prompt).toContain("小型销售团队如何选择客户管理软件？");
    expect(result).toBe(savedAsset);
    const savedData = prisma.client.contentAsset.create.mock.calls[0][0].data;
    expect(savedData.body).toContain("先从跟进动作开始");
    expect(savedData.body).not.toContain("###");
    expect(savedData.body).toContain("功能和服务范围");
    expect(savedData.hashtags).toEqual(["#客户管理", "#销售团队"]);
    expect(savedData.metadata).toEqual(expect.objectContaining({
      summary: modelContent.summary,
      riskNotes: [],
      enterpriseContext: "主要面向 3 至 10 人销售团队，表达务实，不承诺业绩提升。",
      qualityWarnings: expect.arrayContaining([expect.stringContaining("未在企业资料中找到依据的数字")]),
    }));
    expect(savedData.generations.create.promptVersion).toBe("geolens-content-v2-xiaohongshu");
    expect(prisma.client.quickStartSession.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "session-1" },
      data: { currentStep: "CONTENT" },
    }));
  });
});
