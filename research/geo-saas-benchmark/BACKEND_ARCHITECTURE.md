# 后端架构原理与推测

本报告没有竞品后端源码或内部架构图。公开 API/帮助中心能证明的是外部数据模型、接口字段和状态；实际数据库、队列、调度器和 Provider 执行环境均未还原。下文明确区分文档事实与参考设计。

## 公开事实与推断边界

| 领域 | 可直接/文档确认 | 不能确认的实现 |
|---|---|---|
| 租户模型 | Profound 文档给出 Organization → Category → Asset/Topic/Prompt；Otterly API 有 workspace、brand report、prompts；企业套餐声明 SSO/组织功能 | 真实 SQL schema、所有者/成员 ACL、软删除/审计机制 |
| Prompt 执行 | Profound/Otterly API 返回 model/engine、region、运行日期和 answer 记录；多家说明定期/每日监测 | scheduler 产品、job partition、队列类型、browser farm |
| Provider 适配 | Profound 与 Otterly 文档称按 consumer/public interface 或 API 获取；Peec/Scrunch 等声明多模型监测 | 供应商合同、精确网页操作、反机器人行为、采样/重试 |
| 原始证据 | Profound API 暴露完整回答、mentions、citations；Otterly responses 返回 raw content 和来源；Ahrefs API 有 responses/cited pages | 原始响应保留期限、对象存储、加密、地区驻留 |
| 异步操作 | Profound Agent API 202 queued 和运行状态；Otterly Audit pending + 查询结果，统计有 recalculation flag | 具体任务队列、worker 拓扑、重试退避、DLQ、 exactly-once |
| 汇总指标 | Profound 公布 per-model 计算/等权平均；Scrunch 文档含指标字段和采样门槛 | 内部 SQL/OLAP、缓存和增量刷新策略 |
| Recommendations | Otterly 对最低 prompt/竞品/历史窗口有门槛，Scrunch nightly signals，其他产品说明 action agents | 优先级公式、LLM 提示词、人工审核和监控 |
| 报告/API | Profound 有 REST/SSE、分页/过滤；Otterly 有公开 OpenAPI；Ahrefs 有 Brand Radar API v3 | 私有接口、认证实现细节以外的安全架构、速率共享策略 |
| 计费 | 各家公开 prompts、credits、tasks、checks 等计量单位 | 实际成本分摊、模型调用价、超额计费、预留/结算流程 |

## 七家产品的后端公开迹象

| 产品 | 可确认的接口/数据层迹象 | 合理推断与未知 |
|---|---|---|
| Profound | Organization→Category→Assets/Topics/Prompts；answers API 有逐次响应；Agent run 202 queued；REST 有游标筛选与 SSE。 | 需要运行计划、回答存储和异步 worker；数据库/队列/采集运行环境未知。 |
| Otterly | workspace→brand report→prompt；responses 暴露 runId/runDate/raw content/mentions/citations；audit pending 后查询；MCP/API。 | 异步 audit/recalculation 状态明确，具体 scheduler、queue、重试、DB 未知。 |
| Peec | MCP 有项目作用域权限、读写工具、Chat 级 answer/mention/source/fanout 字段及 count/total 聚合；日志、GA4 referral connector。 | 后端明显暴露 chat/event 型证据接口；数据库、内部 REST、队列和 provider adapter 未知。 |
| Scrunch | API reference 将 mentions/citation rate、SOV 暴露为 metrics fields；帮助中心说 Signals nightly 更新。 | nightly aggregation 需要调度/聚合过程，但计算服务、显著性检验、重试均未知。 |
| AthenaHQ | 公开方案按一次 AI response 计 credit；API/GA4/GSC/MCP 集成；ACE 公开声明 citation probability engine。 | 计量单位与可用集成清晰；ACE 的模型、训练数据、校准和实际精度未知。 |
| AirOps | Workflow step/Grid 文档说明任务节点、human review、GSC、CMS integration。 | 可推断存在 workflow execution 和 connector 层；AI monitoring 的 Provider API、原始 answer retention 和队列拓扑未知。 |
| Ahrefs Brand Radar | Brand Radar API v3 文档列出 22 endpoints，覆盖 AI Responses、Topics、Cited Pages/Domains、impressions/mentions/citations history。 | 支持 API 边界清晰；指数采样 pipeline、底层索引 schema、刷新频率扩展细节需以具体 API 文档为准。 |

## 适合 GeoLens 的参考架构

可渲染 Mermaid 图：[架构图集](diagrams/DIAGRAMS.md)；可单独查看[监测时序源文件](diagrams/monitoring-sequence.mmd)。

推荐将“计划调度”和“模型响应数据”分开：

- 控制面：Organization、Membership、Project、Brand、Competitor、Prompt、PromptVariant、MonitoringPlan。
- 任务面：Schedule/RunBatch → ExecutionAttempt → ProviderAdapter → RawResponse。
- 证据面：Mention、Citation、SourceFetch/ObservedSource、ParserVersion、EntityResolution。
- 分析面：MetricSnapshot、PromptAggregate、CompetitorAggregate、Recommendation、ReportSnapshot。
- 集成面：API tokens、webhook delivery、CMS/export connectors、usage ledger。

一条合理链路是：

1. scheduler 按 tenant/project/model/region/prompt 生成预期 executions，写库后发队列；先用 PostgreSQL outbox 保证 run 记录与队列消息原子一致。
2. worker 使用 provider adapter 取结果，记录请求配置与版本；每次 attempt 独立状态。供应商 429/5xx 可退避，永久参数错误进入失败状态。
3. 原始 answer 先持久化并计算内容 hash，再异步解析 entities/citations。解析产物写 parser version，允许之后重跑。
4. 以 stable cohort 对 executions 聚合 KPI；每次指标版本包含公式版本、范围、样本量和缺失执行说明。
5. UI 通过查询 API 读 dashboard 与 evidence；需要长任务时返回 task id，用轮询/SSE/WebSocket 读状态。
6. 定时或触发式报告创建 immutable snapshot。重算新数据不会悄悄修改已分享报告。

## 参考租户与证据数据关系

数据模型图：[参考数据模型图](diagrams/DIAGRAMS.md)和[独立源文件](diagrams/reference-data-model.mmd)。

主键建议 UUID/ULID；每条领域实体强制有 organization_id/project_id，服务端从认证上下文校验权限，不相信请求体传来的 tenant id。查询索引含 project_id + occurred_at，原始回答可另存对象存储，数据库放 URI、hash 和最小元数据。

建议核心约束：

- PromptDefinition 表示用户语义，PromptVariant 表示语言/区域/受众版本。
- Execution 的幂等键 = plan revision + prompt variant + provider/model + region + scheduled window。
- 同一 Execution 允许多次 ExecutionAttempt；终态成功/失败不能被后续重试覆盖成重复结果。
- RawResponse append-only；Mentions/Citations 含 extraction_run_id、extractor_version 和 evidence span。
- MetricSnapshot 用 metric_name + definition_version + cohort key 唯一定位。
- UsageLedger 以 execution、重试、模型、tokens/credits、workspace 映射计费事件，幂等入账。

## Provider Adapter 与 AI Gateway

参考 Provider interface：

    execute(prompt, context) -> ProviderResult
    ProviderResult = { status, raw_text, citations?, provider_request_id?, usage?, latency, metadata }

统一 Gateway 负责 credentials、限流、超时、成本额度、日志脱敏和重试分类；adapter 负责某家 API/Web 集成的协议差异。不要先把不同 Provider 原文归一化后丢弃差异：保留原始响应，再做 canonical fields。某些公开网页端采集有服务条款和权限限制，只有明确获得允许的接入方式才能上线；本研究没有执行自动化采集。

## 建议的 GeoLens API 契约

接口是参考设计，非竞品真实 API：

| 方法与路由 | 请求/响应重点 |
|---|---|
| POST /v1/projects/{projectId}/monitoring-plans | 请求含 promptVariantIds、modelChannels、cadence、timezone；要求 Idempotency-Key；响应 202 + runBatchId/status |
| GET /v1/projects/{projectId}/run-batches/{batchId} | 返回 queued/running/partial/succeeded/failed、expected/succeeded/failed counts、nextPollAt |
| GET /v1/projects/{projectId}/metrics/visibility | 接收 dateFrom/dateTo/model/region/topic/tags；返回每个分组 value、numerator、denominator、sampleCount、definitionVersion |
| GET /v1/projects/{projectId}/executions | cursor 分页返回 prompt/model/region/status/capturedAt/brandMentioned/citationCount |
| GET /v1/projects/{projectId}/executions/{executionId}/evidence | 返回 rawAnswerRef、raw hash、mention spans、citations、extractor version 与失败/未触发原因 |
| POST /v1/projects/{projectId}/reports | 固化 filters/cohort/metric definitions，响应 snapshot id 和可分享权限配置 |

响应字段应保留 provider/model channel/version 和可选的 provider request id；分页使用 opaque cursor；错误包括稳定 error code、retryable、retryAfterSeconds。服务端按认证用户 membership 解析 project 范围，不能只相信请求体 projectId。

内容工作流若后续做：POST action 创建一个有触发 evidence 的任务；content draft 存 revision/hash/author；apply/revert 使用 tracked edit；CMS publish 是单独的连接器状态机。重新监测引用同一 cohort id，不能把不同 Prompt/模型/地区的前后窗口混在一起。

## 证据、算法和成本控制

- Provenance：记录原始响应、抓取时间、公开页面/Provider、解析器版本、span offset 与 citation URL，支持从派生指标反查。
- 置信与采样：同一 prompt 按模型/区域构成 cohort；缺失、拒答、平台未触发单独记录，不强行记为 no mention。
- 并发：按 provider/project/tenant 设 token bucket；全局 concurrency cap；429 Retry-After；指数退避加 jitter；不可重试错误快速终止。
- 定价：建立 usage ledger，run 创建前检查 quota，成功/失败重试规则统一；执行前预估、完成后核算，不能把 credits 简单当成模型成本。
- 归因：API 可报告变化趋势；若要声称优化带来点击/收入，需要 GSC/GA4 等外部数据、匹配窗口和反事实设计，单纯前后比较不能证明因果。

## 与当前 GeoLens 源码的落地映射

已存在的可复用底座：Next.js/NestJS/PostgreSQL/Prisma monorepo；User/Organization/OrganizationMember/Project 等租户基础模型；认证、组织/项目 API 和 membership 检查；前端共享 API helper。

当前 schema 没有 Execution/Attempt/RawResponse/Mention/Citation/MetricSnapshot/Recommendation/ReportSnapshot/UsageLedger，app 页面也尚无监测任务/证据详情。建议新增独立模块和迁移，以 Project 为核心外键；不要把未来设计文档中的表误认为运行代码已经存在。
