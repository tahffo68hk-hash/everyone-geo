import {
  cleanPublishText,
  parseGeneratedContent,
} from "../src/quick-start/content-quality";

const validDouyinContent = {
  title: "先把选型问题问清楚",
  body: "选软件时先别急着看功能表，先列出每天要做的事。",
  summary: "从工作场景开始核对软件需求。",
  hashtags: ["#软件选型", "#工作场景"],
  videoScript: {
    voiceover: "选软件时先别急着看功能表，先列出每天要做的事。",
    shotSuggestions: ["镜头展示一张需求清单", "切到逐项核对功能"],
  },
  riskNotes: [],
  metadata: {},
};

describe("publish content normalization and quality checks", () => {
  it("removes markdown emphasis, heading markers, code fences, and a model preface", () => {
    expect(
      cleanPublishText(
        "以下是为你生成的草稿，供参考：\r\n### 选择清单\r\n**型号 A*B** 使用 2**3 台\r\n```text\r\n核对产品资料\r\n```",
      ),
    ).toBe("选择清单\n型号 A*B 使用 2**3 台\n核对产品资料");
    expect(cleanPublishText("当然，以下是为您生成的内容，供参考：\n先核对公开产品说明。"))
      .toBe("先核对公开产品说明。");
  });

  it("preserves legitimate plus, multiplication, and exponent symbols", () => {
    expect(cleanPublishText("C++、A*B 和 2**3 都是资料中的合法符号。"))
      .toBe("C++、A*B 和 2**3 都是资料中的合法符号。");
  });

  it("parses structured platform content and flags unsupported enterprise claims", () => {
    const response = {
      ...validDouyinContent,
      body: "这款软件可用率达到 99.9%，每月只需 99 元。",
      videoScript: {
        ...validDouyinContent.videoScript,
        voiceover: "这款软件可用率达到 99.9%，每月只需 99 元。",
      },
    };
    const result = parseGeneratedContent(JSON.stringify(response), "douyin", {
      brandName: "Acme",
      supportedFacts: "Acme CRM",
      hasEnterpriseDetails: false,
      opportunity: "企业软件选型",
    });

    expect(result.body).toContain("99.9%");
    expect(result.qualityWarnings.join(" ")).toContain("数字或价格");
    expect(result.qualityWarnings.join(" ")).toContain("企业资料不足");
  });

  it("rejects incomplete JSON and platform-specific script contracts", () => {
    expect(() => parseGeneratedContent("{\"title\":", "geo", {
      brandName: "Acme",
      supportedFacts: "",
      hasEnterpriseDetails: false,
      opportunity: "需求",
    })).toThrow("有效 JSON");

    expect(() => parseGeneratedContent(JSON.stringify({
      ...validDouyinContent,
      videoScript: null,
    }), "douyin", {
      brandName: "Acme",
      supportedFacts: "",
      hasEnterpriseDetails: false,
      opportunity: "需求",
    })).toThrow("抖音");

    expect(() => parseGeneratedContent(JSON.stringify({
      ...validDouyinContent,
      videoScript: {
        ...validDouyinContent.videoScript,
        voiceover: "与正文不一致的口播。",
      },
    }), "douyin", {
      brandName: "Acme",
      supportedFacts: "",
      hasEnterpriseDetails: false,
      opportunity: "需求",
    })).toThrow("口播与正文");
  });

  it("rejects JSON that omits required structured content fields", () => {
    const { riskNotes: _riskNotes, ...missingRiskNotes } = validDouyinContent;

    expect(() => parseGeneratedContent(JSON.stringify(missingRiskNotes), "douyin", {
      brandName: "Acme",
      supportedFacts: "Acme CRM",
      hasEnterpriseDetails: true,
      opportunity: "需求",
    })).toThrow("字段不完整");
  });

  it("rejects raw JSON and model error text inside publishable fields", () => {
    expect(() => parseGeneratedContent(JSON.stringify({
      ...validDouyinContent,
      body: "{\"error\":\"rate limit\"}",
      videoScript: {
        ...validDouyinContent.videoScript,
        voiceover: "{\"error\":\"rate limit\"}",
      },
    }), "douyin", {
      brandName: "Acme",
      supportedFacts: "Acme CRM",
      hasEnterpriseDetails: true,
      opportunity: "需求",
    })).toThrow("JSON 或模型错误");

    expect(() => parseGeneratedContent(JSON.stringify({
      ...validDouyinContent,
      title: "HTTP 429: rate limit exceeded",
    }), "douyin", {
      brandName: "Acme",
      supportedFacts: "Acme CRM",
      hasEnterpriseDetails: true,
      opportunity: "需求",
    })).toThrow("JSON 或模型错误");

    expect(() => parseGeneratedContent(JSON.stringify({
      ...validDouyinContent,
      hashtags: ['{"error":"rate limit"}'],
    }), "douyin", {
      brandName: "Acme",
      supportedFacts: "Acme CRM",
      hasEnterpriseDetails: true,
      opportunity: "需求",
    })).toThrow("JSON 或模型错误");
  });

  it("requires a distinct, structured Bilibili script", () => {
    expect(() => parseGeneratedContent(JSON.stringify({
      ...validDouyinContent,
      videoScript: { voiceover: "一段简短口播。", shotSuggestions: ["展示清单"] },
    }), "bilibili", {
      brandName: "Acme",
      supportedFacts: "",
      hasEnterpriseDetails: false,
      opportunity: "需求",
    })).toThrow("B站");

    expect(() => parseGeneratedContent(JSON.stringify({
      ...validDouyinContent,
      videoScript: {
        narration: "完整讲解稿。",
        outline: [
          { heading: "界定需求", keyPoints: ["列出问题"] },
          { heading: "核对资料", keyPoints: ["查看说明"] },
        ],
      },
    }), "bilibili", {
      brandName: "Acme",
      supportedFacts: "",
      hasEnterpriseDetails: false,
      opportunity: "需求",
    })).toThrow("B站");
  });

  it("accepts a complete Bilibili narration and chapter outline", () => {
    const result = parseGeneratedContent(JSON.stringify({
      ...validDouyinContent,
      videoScript: {
        opening: "先从实际需求说起。",
        narration: "先列出要解决的问题，再逐项核对公开说明和适用边界。",
        outline: [
          { heading: "界定需求", keyPoints: ["列出日常问题"] },
          { heading: "核对资料", keyPoints: ["比对公开说明"] },
        ],
        ending: "资料不足的部分应向企业确认。",
      },
    }), "bilibili", {
      brandName: "Acme",
      supportedFacts: "",
      hasEnterpriseDetails: false,
      opportunity: "需求",
    });

    expect(result.videoScript?.outline).toHaveLength(2);
  });

  it("flags repeated paragraphs, boilerplate, and excessive brand repetition", () => {
    const paragraph = "Acme 的客户管理功能应根据公开产品说明逐项核对。";
    const result = parseGeneratedContent(JSON.stringify({
      ...validDouyinContent,
      body: `${paragraph}\n\n${paragraph}\n\nAcme 在当今竞争激烈的市场环境下，随着科技的不断发展，Acme 提供实用建议，Acme 也值得进一步了解 Acme。`,
      videoScript: {
        ...validDouyinContent.videoScript,
        voiceover: `${paragraph}\n\n${paragraph}\n\nAcme 在当今竞争激烈的市场环境下，随着科技的不断发展，Acme 提供实用建议，Acme 也值得进一步了解 Acme。`,
      },
    }), "douyin", {
      brandName: "Acme",
      supportedFacts: "Acme CRM",
      hasEnterpriseDetails: true,
      opportunity: "企业软件选择",
    });

    expect(result.qualityWarnings.join(" ")).toContain("常见套话");
    expect(result.qualityWarnings.join(" ")).toContain("重复段落");
    expect(result.qualityWarnings.join(" ")).toContain("关键词堆砌");
  });

  it("flags excessive repetition of the target question", () => {
    const result = parseGeneratedContent(JSON.stringify({
      ...validDouyinContent,
      body: "客户管理软件要先核对业务需求。选客户管理软件时，对照客户管理软件的公开功能说明。",
      videoScript: {
        ...validDouyinContent.videoScript,
        voiceover: "客户管理软件要先核对业务需求。选客户管理软件时，对照客户管理软件的公开功能说明。",
      },
    }), "douyin", {
      brandName: "Acme",
      supportedFacts: "Acme CRM",
      hasEnterpriseDetails: true,
      opportunity: "客户管理软件",
    });

    expect(result.qualityWarnings.join(" ")).toContain("目标问题关键词");
  });

  it("warns about unsupported pricing, certification, and outcome promises", () => {
    const result = parseGeneratedContent(JSON.stringify({
      ...validDouyinContent,
      body: "月费仅需 99 元，获得行业认证，并保证客户转化提升。",
      videoScript: {
        ...validDouyinContent.videoScript,
        voiceover: "月费仅需 99 元，获得行业认证，并保证客户转化提升。",
      },
    }), "douyin", {
      brandName: "Acme",
      supportedFacts: "Acme CRM",
      hasEnterpriseDetails: true,
      opportunity: "企业软件",
    });

    expect(result.qualityWarnings.join(" ")).toContain("数字或价格");
    expect(result.qualityWarnings.join(" ")).toContain("认证、资质、效果或收益承诺");
  });

  it("warns about unsupported market leadership and uniqueness claims", () => {
    const result = parseGeneratedContent(JSON.stringify({
      ...validDouyinContent,
      body: "Acme 是行业领先的唯一解决方案。",
      videoScript: {
        ...validDouyinContent.videoScript,
        voiceover: "Acme 是行业领先的唯一解决方案。",
      },
    }), "douyin", {
      brandName: "Acme",
      supportedFacts: "Acme CRM",
      hasEnterpriseDetails: true,
      opportunity: "企业软件",
    });

    expect(result.qualityWarnings.join(" ")).toContain("领先/唯一性");

    const variants = parseGeneratedContent(JSON.stringify({
      ...validDouyinContent,
      body: "这是中国第一的最佳解决方案。",
      videoScript: {
        ...validDouyinContent.videoScript,
        voiceover: "这是中国第一的最佳解决方案。",
      },
    }), "douyin", {
      brandName: "Acme",
      supportedFacts: "Acme CRM",
      hasEnterpriseDetails: true,
      opportunity: "企业软件",
    });
    expect(variants.qualityWarnings.join(" ")).toContain("领先/唯一性");

    const ordinaryAdvice = parseGeneratedContent(JSON.stringify({
      ...validDouyinContent,
      body: "第一步先列需求，最好先核对资料，再决定下一步。",
      videoScript: {
        ...validDouyinContent.videoScript,
        voiceover: "第一步先列需求，最好先核对资料，再决定下一步。",
      },
    }), "douyin", {
      brandName: "Acme",
      supportedFacts: "Acme CRM",
      hasEnterpriseDetails: true,
      opportunity: "企业软件",
    });
    expect(ordinaryAdvice.qualityWarnings.join(" ")).not.toContain("领先/唯一性");
  });

  it("checks the video script as well as the publish body for unsupported numbers", () => {
    const result = parseGeneratedContent(JSON.stringify({
      ...validDouyinContent,
      videoScript: {
        voiceover: validDouyinContent.body,
        shotSuggestions: ["展示产品界面", "保证提升 50% 转化"],
      },
    }), "douyin", {
      brandName: "Acme",
      supportedFacts: "Acme CRM",
      hasEnterpriseDetails: true,
      opportunity: "客户管理",
    });

    expect(result.qualityWarnings.join(" ")).toContain("数字或价格");
    expect(result.qualityWarnings.join(" ")).toContain("效果或收益承诺");
  });
});
