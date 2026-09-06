/**
 * ProjectMentor GEO Benchmark v1 —— 查询集唯一权威定义（single source of truth）。
 *
 * 本文件同时被以下消费：
 *   - packages/database/scripts/seed-benchmark-v1.ts   （写入 geo_dev 种子）
 *   - apps/api/test/benchmark.e2e-spec.ts              （验证 24 query seed 精确性）
 *   - docs 生成/审计（可选）
 *
 * 设计原则（详见 docs/m6-benchmark-v1.md）：
 *   1. 24 条主查询全部为“非品牌”中文自然语言提问 —— 衡量品牌在真实用户
 *      意图下的自然可见度；不在查询里写 ProjectMentor。
 *   2. 6 类意图每类恰好 4 条：tool-discovery / comparison / workflow /
 *      recommendation / pain-point / competition。
 *   3. 2 条 branded sanity query（sanity=true, enabled=false）默认不派发、
 *      不计入主要 Visibility Benchmark，仅作为未来真实链路品牌词控制检查。
 *   4. 每条查询带 category + intent，能解释它为什么属于该类。
 */

export type BenchmarkCategory =
  | "tool-discovery"
  | "comparison"
  | "workflow"
  | "recommendation"
  | "pain-point"
  | "competition"
  | "sanity-control";

export const BENCHMARK_CATEGORIES: ReadonlyArray<{
  id: BenchmarkCategory;
  label: string;
  short: string;
  description: string;
}> = [
  {
    id: "tool-discovery",
    label: "Tool Discovery",
    short: "工具发现",
    description: "用户在不知道具体产品时，探索“有什么工具可以用”的泛发现 / 能力发现意图。",
  },
  {
    id: "comparison",
    label: "Comparison",
    short: "比较 / 选择",
    description: "用户在多个工具、AI 与人工方式之间对比并做选择决策。",
  },
  {
    id: "workflow",
    label: "Workflow / How-to",
    short: "任务解决",
    description: "用户面对明确任务，询问“怎么做 / 如何准备”的过程性问题。",
  },
  {
    id: "recommendation",
    label: "Recommendation",
    short: "明确推荐",
    description: "用户直接要求推荐一个（或几个）适合自己场景的工具。",
  },
  {
    id: "pain-point",
    label: "Pain Point",
    short: "痛点驱动",
    description: "用户先陈述痛点（不会写、被问住、没头绪），再问什么工具/方法能解决。",
  },
  {
    id: "competition",
    label: "Competition-specific",
    short: "赛事场景",
    description: "围绕中国国际大学生创新大赛等赛事的具体准备任务（材料/路演/答辩/PPT/分析）。",
  },
];

export interface BenchmarkQuerySeed {
  queryText: string;
  category: BenchmarkCategory;
  intent: string;
  locale: string;
  weight: number;
  enabled: boolean;
  sortOrder: number;
  sanity: boolean;
}

export const BENCHMARK_V1_SUITE = {
  name: "ProjectMentor GEO Benchmark",
  version: "1",
  description:
    "衡量 ProjectMentor 在大学生创新创业场景 AI 问答中的自然可见度。24 条非品牌主查询覆盖 6 类真实用户意图；每条最终仍可追溯到 Query → Run → Evidence → Analysis。",
} as const;

/** 24 条主查询 + 2 条 branded sanity（sanity=true 且 enabled=false）。 */
export const BENCHMARK_V1_QUERIES: BenchmarkQuerySeed[] = [
  // ============ A. Tool Discovery（4） ============
  {
    sortOrder: 0, category: "tool-discovery", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "泛发现：探索赛事场景下大学生常用的 AI 工具类型",
    queryText: "大学生参加创新创业比赛一般会用哪些 AI 工具？",
  },
  {
    sortOrder: 1, category: "tool-discovery", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "能力发现：寻找能直接生成商业计划书初稿的工具",
    queryText: "有没有能直接生成商业计划书初稿的 AI 工具？",
  },
  {
    sortOrder: 2, category: "tool-discovery", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "约束发现：寻找大学生可免费使用的 AI 写作工具",
    queryText: "大学生能免费用的 AI 写作工具都有哪些？",
  },
  {
    sortOrder: 3, category: "tool-discovery", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "能力发现：除文档外能辅助路演 PPT 的 AI 平台",
    queryText: "除了写文档，还有哪些 AI 平台能帮做比赛路演 PPT？",
  },
  // ============ B. Comparison（4） ============
  {
    sortOrder: 4, category: "comparison", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "横向对比：新手视角的上手难度",
    queryText: "几款常见的 AI 商业计划书工具，哪个对新手更友好？",
  },
  {
    sortOrder: 5, category: "comparison", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "对比：AI 工具与老师辅导 / 自己写的可靠性",
    queryText: "用 AI 写计划书和自己写、找老师辅导，哪个更靠谱？",
  },
  {
    sortOrder: 6, category: "comparison", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "横向对比：不同工具输出模板的质量差异",
    queryText: "能写项目计划书的 AI 工具，模板质量差别大吗？",
  },
  {
    sortOrder: 7, category: "comparison", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "对比：免费与付费工具的性价比选择",
    queryText: "免费的 AI 写作工具和付费 AI 助手差多少，大学生选哪个划算？",
  },
  // ============ C. Workflow / How-to（4） ============
  {
    sortOrder: 8, category: "workflow", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "流程指引：路演答辩的整体准备方法",
    queryText: "大学生创新创业项目的路演答辩要怎么准备？",
  },
  {
    sortOrder: 9, category: "workflow", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "任务拆解：借助 AI 完成商业计划书的全流程",
    queryText: "怎么用 AI 一步步完成参赛用的商业计划书？",
  },
  {
    sortOrder: 10, category: "workflow", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "时效任务：赛前一周打磨路演 PPT 与讲稿",
    queryText: "比赛前一周，如何快速打磨路演 PPT 和讲稿？",
  },
  {
    sortOrder: 11, category: "workflow", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "模块方法：财务预测部分的写法",
    queryText: "创新创业大赛计划书里的财务预测部分怎么写？",
  },
  // ============ D. Recommendation（4） ============
  {
    sortOrder: 12, category: "recommendation", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "直接推荐：给出适用工具清单",
    queryText: "推荐几个适合大学生创新创业项目的 AI 助手。",
  },
  {
    sortOrder: 13, category: "recommendation", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "定向推荐：预算约束下的单个选择",
    queryText: "预算有限的大学生参加创新大赛，用哪个 AI 工具合适？",
  },
  {
    sortOrder: 14, category: "recommendation", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "场景推荐：能全程陪跑比赛材料的工具",
    queryText: "想要一个能全程陪跑比赛材料的 AI 应用，有什么推荐？",
  },
  {
    sortOrder: 15, category: "recommendation", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "缺口推荐：补团队市场分析能力短板",
    queryText: "团队里没人会做市场分析，可以推荐相关的 AI 工具吗？",
  },
  // ============ E. Pain Point（4） ============
  {
    sortOrder: 16, category: "pain-point", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "痛点驱动：计划书写作困难求助",
    queryText: "商业计划书不会写，该用什么 AI 工具辅助？",
  },
  {
    sortOrder: 17, category: "pain-point", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "痛点驱动：答辩被问住、缺乏演练",
    queryText: "路演答辩总被评委问住，AI 能帮忙模拟提问吗？",
  },
  {
    sortOrder: 18, category: "pain-point", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "痛点驱动：市场分析只会套模板、深度不足",
    queryText: "写市场分析只会套模板，怎么让 AI 做得更专业？",
  },
  {
    sortOrder: 19, category: "pain-point", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "痛点驱动：材料反复修改仍无头绪",
    queryText: "比赛材料反复改还没有头绪，AI 帮忙整理项目有没有用？",
  },
  // ============ F. Competition-specific（4） ============
  {
    sortOrder: 20, category: "competition", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "赛事：中国国际大学生创新大赛材料准备",
    queryText: "中国国际大学生创新大赛的参赛材料要如何准备？",
  },
  {
    sortOrder: 21, category: "competition", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "赛事：答辩 PPT 的信息呈现与亮点",
    queryText: "创新创业比赛答辩 PPT 怎么做得清楚又有亮点？",
  },
  {
    sortOrder: 22, category: "competition", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "赛事：评委视角下竞品分析的写法",
    queryText: "比赛评委看项目计划书里的竞品分析，主要看什么？",
  },
  {
    sortOrder: 23, category: "competition", locale: "zh-CN", weight: 1, enabled: true, sanity: false,
    intent: "赛事：限时路演的讲稿压缩与表达",
    queryText: "路演时间只有几分钟，讲稿怎么压缩才不丢重点？",
  },
  // ============ Sanity（2，不计数） ============
  {
    sortOrder: 24, category: "sanity-control", locale: "zh-CN", weight: 1, enabled: false, sanity: true,
    intent: "品牌控制（不计数）：品牌词直接询问",
    queryText: "ProjectMentor 怎么样，适合大学生准备创新创业比赛吗？",
  },
  {
    sortOrder: 25, category: "sanity-control", locale: "zh-CN", weight: 1, enabled: false, sanity: true,
    intent: "品牌控制（不计数）：品牌与同类工具的差异",
    queryText: "ProjectMentor 和其它 AI 项目工具有什么区别？",
  },
];

/** 分类统计（供 seed 与测试断言类别分布用）。 */
export function benchmarkCategoryCounts(queries: ReadonlyArray<{ category: BenchmarkCategory; enabled: boolean; sanity: boolean }>) {
  const counts = new Map<BenchmarkCategory, number>();
  for (const query of queries) {
    if (!query.enabled || query.sanity) continue;
    counts.set(query.category, (counts.get(query.category) ?? 0) + 1);
  }
  return counts;
}

export const BENCHMARK_V1_MAIN_QUERY_COUNT = BENCHMARK_V1_QUERIES.filter(q => q.enabled && !q.sanity).length;
