# GeoLens 差距分析与路线建议

本分析以当前工作区源代码和文档为准，观察日期 2026-10-16。设计文档中的未来目标不视作实现功能；竞争产品文档描述也不视作独立实测。

## 当前可验证状态

GeoLens 目前是 Next.js 15 / React 19 / Tailwind 4 + NestJS 11 + PostgreSQL/Prisma 的 monorepo。已有注册/登录、JWT cookie、组织成员关系、项目读 API 与租户成员校验。数据库实体覆盖 User、Organization、OrganizationMember、Project、Brand、Competitor、QuerySet、Query 等基础配置对象。

现有产品 UI 主要位于 /app，展示组织、成员和项目上下文。API 侧有 auth、organizations、projects、health；前端使用集中式 API helper。

当前 schema/运行模块未找到 GEO Execution/Run、原始 AI Answer、Mention、Citation、Source、Metric Snapshot、Recommendation、Report、Content Workflow、Usage Ledger、Provider Worker 等已实现部分。文档中的产品图和目标模型是规划材料，不能当作功能已交付。

关键源码和文档路径：

- 数据库模型：[schema.prisma](../../packages/database/prisma/schema.prisma)
- 组织与项目首页：[app/page.tsx](../../apps/web/src/app/app/page.tsx)
- 前端 API helper：[api.ts](../../apps/web/src/lib/api.ts)
- 组织控制器：[organizations.controller.ts](../../apps/api/src/organizations/organizations.controller.ts)
- 租户校验：[tenant.service.ts](../../apps/api/src/common/tenant.service.ts)
- 架构现状：[ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- 产品地图：[PRODUCT_MAP.md](../../docs/PRODUCT_MAP.md)

## 与竞品的差距

### 1. GeoLens 已具备哪些成熟能力？

- 有生产产品常用的组织/成员/项目租户骨架与服务端 membership 校验。
- 认证有 password hashing/JWT cookie 的基础；组织/项目 API 具备访问边界。
- 前后端分层明确，类型化 monorepo、Prisma schema、API fetch 封装已建立。
- 这构成了 Profound/Otterly 等产品租户与项目层的初始底座，但还不是完整多租户企业能力（角色、审计、邀请、SSO、用量隔离等仍需逐步建设）。

### 2. 与 Profound 相比缺少什么？

- Prompt/Topic/Persona/Region/Model 维度和真实周期任务。
- 每次 answer execution 的原始文本、mentions、citations、情绪 claim、提取版本。
- Visibility/SOV/Citation Share 的正式定义与按模型拆分/聚合。
- 趋势→样本→引用证据的钻取和可复算仪表盘。
- API/异步执行状态、报表快照、导出分享。
- 从分析数据进入内容建议/任务/复测的闭环。

### 3. 与 Otterly 相比，真实 GEO 测量还有哪些差距？

GeoLens 当前仅有 Query/QuerySet 配置模型，没有真实 prompt provider 执行与采集，因此缺少一个实际 answer-level 数据集；无法计算覆盖率、情绪、引用或位置。还需要处理平台未触发、provider 失败和地区差异，保留原文，及把域名引用与品牌提及区分。

### 4. 与 Peec 相比，前端交互和可视化有什么不足？

GeoLens 当前没有分析型信息架构或 KPI、趋势图、维度筛选、Prompt 列表、来源域名分析、答案详情面板、动作队列。Peec 的可见优势在于把 Overview→Prompts→Sources/Gap→Actions/Impact 连贯组织；应把同一 filter state 贯穿这些页面，并让图表支持 evidence drill-down。

## 5 项改进方向：范围、工时、验收标准

粗略工时以单人开发估计，按现有代码熟悉程度调整；如果缺少合法 Provider 数据接入，第一项先做可插拔 adapter + 沙箱 fake provider，而不是伪造真实测量。

| 优先级 | 功能与实现方式 | 规模 | 验收标准 |
|---|---|---:|---|
| P0-1 | **真实监测纵切片**：新增 MonitoringPlan、Execution、ExecutionAttempt，provider adapter 接口，定时/手动触发，worker 异步保存结果。初期仅接一个可合法使用的模型 API 或人工导入路径。 | M，2–4 周 | 创建一条 prompt 后看到 queued/running/succeeded/failed；每条执行有模型、region、scheduled window、raw answer、时间和错误；重复消息不产生重复执行或重复记账。 |
| P0-2 | **Evidence Provenance**：RawResponse append-only，解析器输出 BrandMention、CompetitorMention、Citation；保存解析版本、原文 span 和来源 URL。 | M，1–2 周 | 任一 KPI 可钻取到 answer 原文及引用；解析器重新运行可留旧版本并比较；原始文本不被派生字段覆盖。 |
| P0-3 | **指标契约与可信总览**：先发布 Coverage、Response SOV、Owned Citation Coverage/Share、Position，按模型/地区拆分，显示 eligible denominator、n、失败率。 | S–M，1–2 周 | 每指标有版本化定义；零样本返回 N/A；AI Overview 未触发和 provider failed 被不同状态处理；前后端结果可复算。 |
| P0-4 | **Prompt 运维 UI**：Prompt 分组、CSV 导入、标签、语言/region/model、启停、运行历史、搜索/筛选。 | M，约 2 周 | 新用户能创建品牌/竞品/Prompt 并成功启动首个执行；每行展示最近执行时间、错误和样本数；过滤条件可刷新/分享。 |
| P1-5 | **证据驱动建议与 Retest**：生成“竞争品牌在该 cohort 被提及/引用而自有品牌未出现”等简单规则，建立 Action item，修改页面后同 cohort 复测。 | M，2–3 周 | 每条建议显示触发样本、来源 URL、规则版本、优先级理由；Action 状态可追踪；复测前后使用完全相同 cohort，文案明确为关联变化而非因果。 |

## 功能难度分层

**可快速实现（在已有底座上）**：指标契约文档、静态/手工导入 answer evidence、Prompt 列表与 filters、指标样本数、Evidence drawer、报告快照基础版、建议状态管理。

**依赖真实数据或供应商授权**：高频多模型监测、稳定的消费级 UI 采集、地区执行、模型版本识别、完整 shopping cards、检索来源细节、足够统计样本。

**需要长期积累**：可靠品牌 entity resolution、多语言 claim sentiment、行业 prompt demand 基准、跨平台可比性、行动建议效果排序、因果 Outcome Attribution。

**需要外部授权或客户数据接入**：GSC/GA4 转化闭环、CMS 发布、SSO/SAML、代理商多客户管理、CDN/服务器日志 Agent Analytics。

## 功能取舍

### 值得借鉴

- Profound：回答级证据、清楚指标定义、模型维度聚合、API 对账与异步状态。
- Otterly：Prompt 到 answer 到 citation 的细节浏览；不将未触发的 AI Overview 误判成无提及。
- Peec：可读的导航和 KPI 分拆；来源“used”与“cited”分开。
- AirOps：有审核状态与版本历史的批量内容工作流；连接实际 CMS 之后再构建。
- Ahrefs：AI Index 的搜索需求代理信号与直接 Prompt 采样分开。

### 不建议初期复制

- 无样本量说明的综合 Visibility score；同一数字混合不同指标和权重。
- 声称“优化带来收入”的 before/after 图表，缺少控制组/归因设计。
- 尚无稳定 evidence 时，用 LLM 生成大量建议并显示精确的高优先级分数。
- 早期就做 9+ Provider、Agent Analytics、Shopping SKU、SSO、CMS 发布等昂贵边缘模块。
- 把 AI Visibility Index proxy 当真实用户 AI 查询次数。

## 下一阶段的产品顺序

建议先可复核后可扩展：一组固定 prompts → 一个可合法接入 Provider → immutable answers/citations → 指标定义和 UI drill-down → action/retest → 多 provider 与集成。此顺序最直接回答“我们的 GEO 分数来自哪里”，也形成工程学习闭环。
