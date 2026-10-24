---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 15ce975b5f313de8edfa891b974a2219_271d39eda9fc11f188bd525400287e28
    ReservedCode1: tDgD7PWFC/iay+FRsG3uXQXYv0IDhCvEt7E4EmqRFKbwwfrxUKv61b8XiqUpuNueTQ1iMF0iV4PwWM+3YEvyXVv1Iw3jtS8B3RW3e05FNs1soJnPZJVs03ZNhtGYh/iv6/aOrmFRj5pHA0abodDs8IshR3rq4vXl14ElF4/D4HCyfLVldktYL9w+O40=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 15ce975b5f313de8edfa891b974a2219_271d39eda9fc11f188bd525400287e28
    ReservedCode2: tDgD7PWFC/iay+FRsG3uXQXYv0IDhCvEt7E4EmqRFKbwwfrxUKv61b8XiqUpuNueTQ1iMF0iV4PwWM+3YEvyXVv1Iw3jtS8B3RW3e05FNs1soJnPZJVs03ZNhtGYh/iv6/aOrmFRj5pHA0abodDs8IshR3rq4vXl14ElF4/D4HCyfLVldktYL9w+O40=
---

# GeoLens UI 组件设计蓝图（UI Component Map）

> 配套文档：docs/UI_REFERENCE_AUDIT.md（竞品审计）· docs/DESIGN_SYSTEM.md（设计语言）
> 性质：组件契约与交互蓝图，供 UI Implementation 阶段按 DESIGN_SYSTEM 落地
> 架构约束：V0.1 只做"监测闭环"，组件服务 Evidence-first 的 6~7 页结构，不引入营销/商务/支付组件

每个组件统一说明维度：**用途 / 信息层级 / 交互 / 状态（Loading · Empty · Error）**。

---

## 0. 组件总览

| # | 组件 | 出现页面 | 核心数据 |
|---|---|---|---|
| 1 | AI Visibility Score | AI 可见度 | Visibility% + 置信区间 |
| 2 | Share of Voice | AI 可见度 | SoV% + 竞品对比 |
| 3 | Query × Engine Matrix | Queries | Query×Engine 命中状态 |
| 4 | Evidence Drawer | 全局浮层 | 原始响应/提及/引用 |
| 5 | Citation Table | 引用来源 | 被引域名/URL/频率 |
| 6 | Competitor Ranking | 洞察 | 竞品维度排名 |
| 7 | Action Center | 洞察/Actions | 影响×努力任务队列 |
| 8 | Task Progress | 工作台/任务 | 采集任务进度 |
| 9 | Signal Timeline | 工作台/引用 | 时间轴信号流 |
| 10 | Global Filters | 全局 Header | Engine×Date×Tag |
| 11 | Command Palette | 全局 | 快捷导航/动作 |

---

## 1. AI Visibility Score

**用途**：品牌在指定 Query × Engine 下的 AI 可见度总分与分项（Mention / Citation / Position），Evidence-first 的主指标入口。

**信息层级**：
- 主视觉：环形或大数字 Score（0–100）单一读数
- 次级：拆分为 Mention% / Citation% / 平均 Position 三个小指标
- 上下文：与上次采集对比的 delta（▲/▼）+ 数据新鲜度
- 证据锚点："查看 Evidence"入口（必带）

**交互**：
- 点击 Score 或"查看 Evidence"→ 打开 Evidence Drawer（Query/Engine/模型原始响应）
- 悬停环形图 → tooltip 显示分项贡献
- delta 可点击 → Signal Timeline 定位变化点

**状态**：
- Loading：环形骨架 + 三个指标占位
- Empty：该 Query）×Engine 尚无采集 → Empty 卡带"首次采集"CTA
- Error：采集失败 → 保留上次值并标注"上次更新 YYYY-MM-DD，本次失败"，可重试

---

## 2. Share of Voice

**用途**：在相关答案中品牌 vs 竞品的提及份额，回答"我在这个 Query 上被 AI 记住多少"。

**信息层级**：
- 主：SoV% 大数字 + 堆叠横条（品牌+各竞品占比）
- 次级：Unbranded SoV（品牌未出现但竞品出现的份额，流量损失信号）
- 竞品条目：名称 + 份额 + 趋势 + 出现位置偏好

**交互**：
- 点击某竞品 → 高亮 + 打开竞品证据（该竞品的 Query/答案片段）
- 切换 Engine → 各引擎 SoV 变化
- "Gap"徽标：未出现竞品出现 → 引导到 Action Center

**状态**：Loading 骨架横条；Empty = 无答案数据；Error = 引擎拉取失败，单引擎重试。

---

## 3. Query × Engine Matrix

**用途**：核心监测视图。行=Query，列=Engine（如 ChatGPT/Gemini/Perplexity/DeepSeek/文心），格=该组合可见度状态。

**信息层级**：
- 单元格最小化：Color（绿=有提及/蓝=被引用/灰=未出现）+ 状态字标
- 行尾：Query 聚合分；列头：Engine 聚合分
- 全矩阵缩略图（热力小方块）作为导航

**交互**：
- 点单元格 → Evidence Drawer（该 Query×Engine 的答案、提及、位置、引用）
- 行可展开 → 单 Query 的 XV 引擎并排对比
- 列筛选 → 只看某引擎
- 排序：按分数 / 缺口 / 变化
- 缺口高亮：品牌未出现的单元格默认弱提示，可切换"仅缺口"

**状态**：Loading 矩阵骨架；Empty = 无 Query → 引导建立 Query 集；Error = 列（引擎）级标记失败，不影响其他列。

---

## 4. Evidence Drawer （核心容器，见 §12 Evidence First）

**用途**：任何指标的"为什么"——点击后展示原始证据。全局右侧 Drawer。

**信息层级（自上而下）**：
1. 标头：Query + Engine + 采集时间戳（Data Freshness）
2. 指标摘要条：Visibility / Position / Mention / Sentiment 一行
3. Retrieval Mode + Source Type + Model
4. Raw Response（原始 AI 答案，可展开，等宽字体 + 高亮）
5. Mention 定位：品牌提及句 + 上下文前后文
6. Competitors（同答案中的竞品）
7. Recommendation（AI 给出的建议/推荐，若有）
8. Citations（被引 URL 列表 → 跳 Citation Table）

**交互**：
- 右滑抽屉，遮罩背景；支持键盘 Esc 关闭
- Raw Response 内关键词高亮（品牌/竞品/引用 URL）
- 每条证据可"置为已阅读"（更新 Signal Timeline 状态）

**状态**：Loading 抽屉骨架；Empty = 该次无响应（显示"未捕获"）；Error = 证据缺失/源不可用，显示原因与重取。

---

## 5. Citation Table

**用途**：Queries 中被引用来源的汇总表，回答"AI 回答引用谁的页面"。

**信息层级**：
- 列：来源域名 / 引用次数 / 最近引用时间 / 涉及 Query 数 / 权威性（internal）
- 行分类：我的域名 vs 竞品 vs 第三方
- 顶部：总计 + 唯一域名数 + 新增 vs 流失

**交互**：
- 点行 → Evidence Drawer（该 URL 被哪些 Query×Engine 引用、上下文片段）
- 筛选：Engine / 时间 / 是否我的域名
- 导出 CSV（预留入口）

**状态**：Loading 表格骨架；Empty = 无引用记录；Error = 部分 Query 引用数据缺失，标注并重试。

---

## 6. Competitor Ranking

**用途**：竞品在监测 Query 集上的综合表现排名。

**信息层级**：
- 表：排名 / 竞品 / Visibility 均分 / 被引 Query 数 / 领先我的 Query 数 / 趋势
- Own 品牌以分隔行锚定，直观看到"谁在我前面"
- 顶部总结："竞争对手在 N 个 Query 领先"

**交互**：
- 点击行 → 竞品 Matrix 视图 + Evidence Drawer 证据
- "领先我的 Query 数" → 跳 Action Center 生成缺口任务
- 对比模式：Compare Mode 下并排展示两个品牌曲线

**状态**：Loading 排名骨架；Empty = 未配置竞品；Error = 竞品数据引擎源失败，提示重试。

---

## 7. Action Center

**用途**：把数据差距转成可执行任务队列（差异化核心）。卡片结构见 §13。

**信息层级**：
- 顶部：问题/机会卡片队列，按 影响 × 努力 排序
- 卡片：问题标题 + 状态机（Unresolved / In progress / Resolved）+ 影响描述 + 建议行动按钮
- 过滤器：按类型（Mention Gap / Citation Gap / Position 下降 / 新颖性问题）/ 状态 / Engine

**交互**：
- 卡片展开 → 详情：为什么（Evidence）/ 影响多少（数据）/ 应该做什么（步骤）
- 按钮："查看 Evidence" + "生成优化方案"（跳内容建议）
- 勾选完成 → 状态流转 → 更新顶部计数
- 一键批量："生成优化方案"对选中的多项

**状态**：Loading = 队列骨架 + 计数占位；Empty = "暂无待处理问题，监控中"；Error = 差距计算失败，提示重试。

---

## 8. Task Progress

**用途**：展示采集任务（Query×Engine×品牌）的运行进度，建立在 Redis+BullMQ 异步任务上（D-008）。

**信息层级**：
- 总览：总任务 / 完成 / 运行中 / 失败 + 完成率进度条
- 列表：任务名（Query×Engine）+ 状态徽标 + 起止时间 + 失败原因（可重试）

**交互**：
- 失败任务 → 单独重试 / 批量重试
- 运行中任务 → 内联 spinner + 当前步骤文案
- 完成 → 点击直达该 Query 的 Matrix 视图

**状态**：无独立 Empty（队列运行中永有总览）；Error = worker 中断 → 全页错误态 + 重试连接。

---

## 9. Signal Timeline

**用途**：时间轴呈现可见度/提及/引用的历史变化事件（谁、何时、发生什么）。

**信息层级**：
- 垂直时间轴，节点 = 事件（Visibility 变化 / 新 Citation / Mention 首次出现 / Position 变化）
- 节点内容：图标 + 标题 + 摘要 + 事件背后证据

**交互**：
- 点节点 → Evidence Drawer 展开当时证据
- 拖拽 / 区间选择 → 联动其他视图时间范围
- 类型筛选器（仅看 Citation / 仅看 Position 变化）

**状态**：Loading 时间轴骨架；Empty = 该时间窗无事件；Error = 时间线数据源失败。

---

## 10. Global Filters（Header 级）

**用途**：全局上下文控制，贯穿所有数据视图。

**组成**：
- Project Switcher（项目/品牌切换）
- Date Range（预设：7d/30d/90d/自定义）
- Engine Filter（多选 AI 引擎）
- Compare Mode 开关（对比竞品/时段）

**交互**：
- 任意变更 → 全页视图重新查询并保留当前页
- 当前筛选状态以 Tag 驻留 Header 可一键清除
- 视图记忆：切页保持筛选不变

**状态**：加载中 → 页面级骨架；无数据 → 筛选结果 Empty；Error → 筛选维度服务失败。

---

## 11. Command Palette

**用途**：⌘K/Ctrl+K 全局命令面板，快速导航与动作。

**信息层级**：
- 输入框 + 命令分组（跳转页面 / 打开某 Query / 运行诊断 / 导出 / 切换项目）
- 最近使用优先排序

**交互**：
- 键盘驱动（上下选择、Enter 执行、Esc 关闭）
- 结果可预览（如选中 Query 直接打开 Matrix）
- 空输入时展示常用命令与快捷入口

**状态**：无数据 → 显示"无匹配命令"；Error → 静默降级为纯站点导航。

---

## 12. Evidence First（GeoLens 最重要设计特点）

**原则**：任何指标（Visibility / Rank / Mention / Recommendation / Citation）都必须是"可验证的数据"，点击后必须看到证据。绝不展示无法解释的数字。

**Evidence Drawer 数据契约**（对应 apps/worker 每轮采集的 Evidence 全字段持久化）：

| 字段 | 类型 | 来源 |
|---|---|---|
| Query | text | 监测 Query |
| Engine | enum | 引擎标识 |
| Model | text | 具体模型版本 |
| Timestamp | datetime | 采集时间 |
| Retrieval Mode | enum | 抓取方式/是否带网络 |
| Source Type | enum | 品牌/竞品/第三方 |
| Raw Response | text | 原始 AI 回答（只读不可变） |
| Mention | bool+text | 是否提及 + 提及上下文 |
| Position | number | 答案中位置 |
| Competitors | list | 同答案竞品 |
| Recommendation | text | AI 推荐/建议（若有） |
| Sentiment | enum | 描述品牌的情感倾向 |
| Citations | list[url] | 被引来源 URL |

**交互流**：指标 → 点击 → Drawer 逐条证据 → 阅读原始响应 → 可点击引用跳转 Citation Table → 关联 Action Center。

**视觉**：Raw Response 用等宽字体 + 高亮（品牌/竞品/URL），保持"证据原件"可信感；只读，不可编辑（D-003 Run/Response 不可变）。

---

## 13. Action Center 卡片结构（问题 → Evidence → 影响 → 建议）

> 非纯数据展示，建立"问题驱动"卡片架构。

```
┌──────────────────────────────────────────────────────────────┐
│ [Mention Gap]  竞品在 17 个 Query 领先你       状态：Unresolved │
│ ───────────────────────────────────────────────────────────── │
│ 为什么    Assessment：17 个 Query 中竞品被提及而品牌未出现        │
│           （点击"查看 Evidence"逐条核对原始回答）               │
│ 影响多少  预估受影响：17/48 Query（35%）；平均 Position 2.1      │
│           → 对应可见度损失约 12% SoV                           │
│ 应该做什么 ① 优先补齐 5 个高流量 Query 的答案覆盖               │
│           ② 在缺少引用处构建可被引用的内容锚点                  │
│           ③ 对未收录 URL 触发重新抓取                          │
│ ───────────────────────────────────────────────────────────── │
│ [查看 Evidence]  [生成优化方案]  [标记完成]                     │
└──────────────────────────────────────────────────────────────┘
```

**类型分组**：Mention Gap / Citation Gap / Position 下降 / 覆盖率缺口 / 数据异常（采集失败）。
**优先级**：影响（受影响 Query 数 × 流量权重）× 努力（低/中/高）→ 二维排序，Critical / High / Normal 三档色。
**闭环**：标记完成 → 回看 Signal Timeline 验证方案前后变化 → 若未改善自动重开。

---
*（内容由AI生成，仅供参考）*
