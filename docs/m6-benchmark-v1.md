# M6A — ProjectMentor GEO Benchmark v1 设计文档

> 里程碑：M6A（Real GEO Benchmark Foundation）
> 数据权威定义：`packages/database/scripts/benchmark-queries.ts`
> 文档版本：v1（2026-09-06）

---

## 1. 背景与目标

当前 3-query smoke test 只是「能跑」，不足以支撑跨 Provider / 跨版本的可比结论。
M6A 把 smoke test 升级为**可版本化、可重复、可审计、可比较、可扩展到多 Provider** 的
Benchmark 系统，第一套正式套件为 **ProjectMentor GEO Benchmark v1**。

Benchmark 衡量的是：**在真实大学生创新创业场景的 AI 问答中，ProjectMentor 是否会被
自然提及（可见度）**，而不是「品牌词下模型是否记得该品牌」。

## 2. Benchmark 设计原则

| # | 原则 | 落地 |
|---|------|------|
| 1 | 非品牌查询下的自然可见度 | 24 条主查询不写入 ProjectMentor / 任何目标品牌词 |
| 2 | 覆盖真实用户意图，而不是 SEO 堆词 | 每条查询是「真实大学生会问的话」，口语化、单句、可解释 |
| 3 | 查询之间不是同义改写 | 同一类目内 4 条从不同提问视角切入（见第 4 节每条 intent） |
| 4 | 版本化、不可变 | Suite `name+version` 唯一；历史 Run 快照 `suiteName/suiteVersion`，编辑未来版本不影响历史结论 |
| 5 | Evidence 唯一事实源 | BenchmarkRun 不建第二套证据；复用 MonitorTask → Run → Evidence → Analysis 管线 |
| 6 | 指标不重造 | 复用 geolens-v1：Visibility / Recommendation / Mention Position / SoV / Citation / Sentiment |
| 7 | 诚实标注数据来源 | `metricSource = demo | real | mixed`；mixed 只把 real 子集计入 Real Benchmark |
| 8 | 成本保护优先 | Real Run 创建前可预知 `plannedRuns`；超出 `REAL_PROVIDER_MAX_RUNS_PER_TASK` 直接拒绝 |
| 9 | 不给误导性结论 | M6B 之前竞对 A/B/C 为占位，`Share of Voice` 一律标记 `competitor set pending M6B` |

## 3. 六类用户意图（Category）

主查询恰好 24 条 = 6 类 × 4 条。分类依据：用户提问的**决策阶段/动机**。

| Category | 意图定义 | 判断依据 |
|----------|----------|----------|
| **Tool Discovery**（工具发现） | 用户不知道具体产品，探索「市面上有什么可用工具」 | 疑问词为「有哪些/有没有/都有哪些」，目的是**盘点**而非要结论 |
| **Comparison**（比较/选择） | 在多工具之间、或 AI 与人工之间做**对比取舍** | 出现「哪个/对比/差多少/选哪个」等比较语义 |
| **Workflow / How-to**（任务解决） | 面对明确任务问「怎么做」的过程性问题 | 句式「如何/怎么/要如何准备」，答案形态是步骤或方法 |
| **Recommendation**（明确推荐） | 直接要求给出一个（或几个）适合自己场景的工具 | 动词「推荐/用哪个合适/有什么推荐」，期待**点名**结论 |
| **Pain Point**（痛点驱动） | 先陈述困难/痛点，再问什么工具或方法能解决 | 前半句是问题陈述（不会写/被问住/套模板/反复改） |
| **Competition-specific**（赛事场景） | 围绕大赛具体交付物（材料/PPT/竞品分析/限时路演）的实操问题 | 出现「中国国际大学生创新大赛/答辩/评委/路演」等赛事语境 |

类目间最易混淆的区分示例：
- Tool Discovery vs Recommendation：前者「有哪些」（盘点），后者「推荐/用哪个」（点名）。
- Tool Discovery vs Workflow：前者问「工具存在性」，后者问「任务怎么做」。
- Competition vs Workflow：Competition 强调**赛事评审语境**（评委/创新大赛/限时路演），
  Workflow 是通用任务过程。F2「答辩 PPT 怎么做得清楚又有亮点」落在赛事语境。

## 4. 24 条主查询 + 2 条 Sanity（完整清单）

> Sanity 为**品牌词控制查询**（`enabled=false` 默认不派发、不计入主要 Visibility Benchmark），
> 仅在真实链路建立后用于「品牌词下应能命中品牌」的控制检查。

### A. Tool Discovery（4）
| # | Query | intent |
|---|-------|--------|
| 0 | 大学生参加创新创业比赛一般会用哪些 AI 工具？ | 泛发现：赛事场景常用工具盘点 |
| 1 | 有没有能直接生成商业计划书初稿的 AI 工具？ | 能力发现：计划书生成 |
| 2 | 大学生能免费用的 AI 写作工具都有哪些？ | 约束发现：免费可用 |
| 3 | 除了写文档，还有哪些 AI 平台能帮做比赛路演 PPT？ | 能力发现：路演 PPT |

### B. Comparison（4）
| # | Query | intent |
|---|-------|--------|
| 4 | 几款常见的 AI 商业计划书工具，哪个对新手更友好？ | 横向对比：上手难度 |
| 5 | 用 AI 写计划书和自己写、找老师辅导，哪个更靠谱？ | AI vs 人工辅导 |
| 6 | 能写项目计划书的 AI 工具，模板质量差别大吗？ | 横向对比：输出质量 |
| 7 | 免费的 AI 写作工具和付费 AI 助手差多少，大学生选哪个划算？ | 免费 vs 付费性价比 |

### C. Workflow / How-to（4）
| # | Query | intent |
|---|-------|--------|
| 8 | 大学生创新创业项目的路演答辩要怎么准备？ | 流程指引：答辩准备 |
| 9 | 怎么用 AI 一步步完成参赛用的商业计划书？ | 任务拆解：计划书全流程 |
| 10 | 比赛前一周，如何快速打磨路演 PPT 和讲稿？ | 时效任务：临赛打磨 |
| 11 | 创新创业大赛计划书里的财务预测部分怎么写？ | 模块方法：财务预测 |

### D. Recommendation（4）
| # | Query | intent |
|---|-------|--------|
| 12 | 推荐几个适合大学生创新创业项目的 AI 助手。 | 直接推荐：工具清单 |
| 13 | 预算有限的大学生参加创新大赛，用哪个 AI 工具合适？ | 定向推荐：预算约束 |
| 14 | 想要一个能全程陪跑比赛材料的 AI 应用，有什么推荐？ | 场景推荐：全程陪跑 |
| 15 | 团队里没人会做市场分析，可以推荐相关的 AI 工具吗？ | 缺口推荐：补能力短板 |

### E. Pain Point（4）
| # | Query | intent |
|---|-------|--------|
| 16 | 商业计划书不会写，该用什么 AI 工具辅助？ | 写作困难求助 |
| 17 | 路演答辩总被评委问住，AI 能帮忙模拟提问吗？ | 答辩准备不足 |
| 18 | 写市场分析只会套模板，怎么让 AI 做得更专业？ | 内容深度不足 |
| 19 | 比赛材料反复改还没有头绪，AI 帮忙整理项目有没有用？ | 反复打磨低效 |

### F. Competition-specific（4）
| # | Query | intent |
|---|-------|--------|
| 20 | 中国国际大学生创新大赛的参赛材料要如何准备？ | 赛事材料准备 |
| 21 | 创新创业比赛答辩 PPT 怎么做得清楚又有亮点？ | 答辩 PPT 呈现 |
| 22 | 比赛评委看项目计划书里的竞品分析，主要看什么？ | 竞品分析写法 |
| 23 | 路演时间只有几分钟，讲稿怎么压缩才不丢重点？ | 限时路演表达 |

### Sanity（2，不计入主指标）
| # | Query | intent | 说明 |
|---|-------|--------|------|
| 24 | ProjectMentor 怎么样，适合大学生准备创新创业比赛吗？ | 品牌词直接询问 | 控制组：应命中品牌 |
| 25 | ProjectMentor 和其它 AI 项目工具有什么区别？ | 品牌对比询问 | 控制组：应命中品牌 |

**为什么是这 24 条：**
1. 全部是**模拟真实大学生提问**的口语化中文，无 SEO 堆词、无「2026 最新推荐」式关键词堆砌。
2. 赛事任务关键词（计划书/路演/答辩/PPT/市场分析/竞品分析/财务预测）被**自然分布**在
   6 类中，而不是集中成一批行业词。
3. 每条都能用 Category + Intent 解释归属，且同类别内部视角不同（盘点/能力/约束/免费 vs
   对比/取舍/质量/性价比 vs …）。

## 5. 哪些计入主要指标

| 指标域 | 是否计入 | 说明 |
|--------|----------|------|
| 24 条主查询（enabled=true, sanity=false） | ✅ 计入 | overall / category / query 三级聚合的唯一来源 |
| 2 条 Sanity（enabled=false） | ❌ 不计入 | 仅作为品牌词控制检查保留，不派发、不进 metrics |
| Demo（mock provider）Run | ⚠️ 单独标记 | `metricSource=demo`，可看演示链路，**不是 Real Benchmark** |
| Real（deepseek）Run | ✅ Real Benchmark | 受 `REAL_PROVIDER_MAX_RUNS_PER_TASK` 上限保护 |
| Mixed 任务 | ✅ 只取 real 子集 | 与 M5 语义一致：demo 数据永不污染 real metrics |

## 6. 运行模式与成本保护

- `POST /benchmark-suites/:id/runs` 携带 `runType: demo | real` + `engineId`。
- demo 只允许 mock 引擎；real 只允许 deepseek 引擎且必须已配置。
- 创建前可预知：`plannedRuns = enabledQueries × 1 provider`（M6A 单 Provider）。
  v1 为 **24 queries × 1 provider = 24 runs**。
- real 且 `plannedRuns > REAL_PROVIDER_MAX_RUNS_PER_TASK` → **拒绝创建**并报出计划数。
- M6A 开发与测试默认只用 Mock/Fake Provider，**不产生真实 DeepSeek 费用**。

## 7. 版本化与历史不变性

- Suite：`BenchmarkSuite(name, version)` 在项目内唯一；同名新版本是**新 Suite 行**。
- 历史 Run：`BenchmarkRun.suiteName / suiteVersion` 为**创建时快照**；Suite 后续改名/增删
  Query 不影响历史 Run 的指标解释（worker 集成测试已断言）。
- 想迭代 v2：新建 `version: "2"` 的 Suite（可复制 v1 查询再编辑），历史 v1 Run 结论不变。

## 8. M6B / M6C / M6D 预告（不在 M6A 范围）

- **M6B Competitor Discovery**：真实竞对发现取代 A/B/C 占位；在此之前
  `Share of Voice` 一律标记 `competitor set pending M6B`，不作为对外结论。
- **M6C Benchmark Reporting + Model Identity**：技术债 `requestedModel`（deepseek-chat）
  vs `responseModel`（响应上报 deepseek-v4-flash）的 schema 拆分；周期报告。M6A **不做**
  schema migration，也不回填历史 Evidence。
- **M6D Second Provider**：第二个 Provider 接入与横向对比。
