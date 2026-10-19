import { ContentStrategyEngine } from "../src/content-strategy/content-strategy-engine";

describe("ContentStrategyEngine evidence-safe copy", () => {
  it("does not turn provider objects or absent competitor evidence into confident market claims", () => {
    const output = ContentStrategyEngine.generateStrategy({
      targetEntity: "武汉大鱼轮毂修复钣喷工厂店",
      projectName: "武汉大鱼轮毂修复 GEO 试点",
      industry: "汽车后市场 / 轮毂修复 / 汽车维修美容",
      opportunity: {
        id: "opportunity-1",
        titleDirection: "品牌实体与能力总览内容",
        assetType: "ENTITY_OVERVIEW",
        contentIntent: "INFORMATIONAL",
        representativeQuery: "武汉轮毂改色翻新有哪些店？",
        targetEngines: [{ provider: "deepseek", engineName: "DeepSeek API" }],
        targetCompetitors: null,
        queries: [{
          queryTextSnapshot: "武汉轮毂改色翻新有哪些店？",
          intent: "服务需求",
          brandAbsent: true,
        }],
      },
    });

    expect(JSON.stringify(output)).not.toContain("[object Object]");
    expect(output.geoGap).toContain("本轮问答测试");
    expect(output.geoGap).toContain("未提供已审核竞品");
    expect(output.geoGap).not.toContain("凭借更早布局");
    expect(output.targetAudience).not.toContain("重度依赖 AI 搜索");
    expect(output.perceptionGoal).not.toContain("最具技术透明度");
    expect(output.perceptionGoal).not.toContain("首选可信知识源");
    expect(output.planItems.map((item) => item.title).join(" ")).not.toMatch(/真实使用体验|硬核横评实测/);
  });
});
