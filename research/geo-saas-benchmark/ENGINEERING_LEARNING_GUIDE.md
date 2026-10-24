# GEO SaaS 工程学习指南

以下 12 项都能独立做成练习。建议沿着一次 Prompt Execution 构建，最终形成一个小型、可审计的 GEO 监测闭环。

## 1. SaaS 多租户架构

- **解决什么**：多个组织共享服务和数据库，但数据与权限互相隔离。
- **为什么重要**：品牌、Prompt、证据和账单都属于客户组织；错误租户过滤是严重数据泄露。
- **典型架构**：用户通过 Membership 加入 Organization；Project 隶属 Organization；服务端从认证上下文取得 tenant scope，查询必须附带 organization/project 条件。高敏企业可采用 schema/db-per-tenant，但通常先共享库加行级租户键。
- **关键结构**：Organization、Membership(role)、Project、AuditEvent、邀请/权限表。
- **难点**：跨租户 IDOR、共享对象、后台 worker 没有用户上下文、导出和 webhook 越权。
- **最小练习**：建立两组织和两项目；写 API list/get；用组织 A 的 session 请求组织 B 的 project 必须 404/403，日志不泄露资源名。

## 2. Prompt 与监测计划建模

- **解决什么**：把一个用户意图拆成模型、地区、语言、persona 等可重复运行的变体。
- **为什么重要**：每日执行必须保持 cohort 稳定，用户编辑 prompt 也不能悄悄改变历史含义。
- **典型架构**：PromptDefinition → PromptVariant → MonitoringPlan(revision/cadence) → scheduled windows。
- **关键结构**：prompt text、topic/tag、locale、region、engine、active interval、revision。
- **难点**：文本变更历史、重复变体、不同国家是否消耗单独配额、迁移和比较。
- **最小练习**：CSV 导入 prompts，按 prompt+model+region 生成唯一 execution key；编辑 prompt 后出现新 revision，旧 run 保留原版本。

## 3. GEO 异步任务队列

- **解决什么**：provider 响应耗时且限流，不让请求卡住 HTTP server。
- **为什么重要**：一天的 prompt 批次可能包含数千个任务，需调度、并发控制、重试和进度反馈。
- **典型架构**：API 写 Execution 和 Outbox → queue → worker → Provider → result store → aggregator；API 返回 task/run id。
- **关键结构**：Execution(status)、Attempt(number,error_code,next_retry_at)、OutboxMessage、dead letter。
- **难点**：消息至少一次投递、幂等、重试边界、取消、worker 崩溃、部分失败。
- **最小练习**：用 Postgres outbox + 本地 worker 执行 20 条 mock prompts；强制 20% 第一次失败；任务最终成功或清楚失败且不重复写答案。

## 4. API 幂等与任务状态机

- **解决什么**：网络重试/重复 webhook 不产生双重执行、重复费用或重复结果。
- **为什么重要**：队列通常是 at-least-once；用户刷新页面也会重复提交。
- **典型架构**：caller idempotency key + 数据库 unique constraint；Execution 与多个 Attempt 分离，状态只沿合法边迁移。
- **关键结构**：idempotency_key、state version、provider request id、attempt status、usage event id。
- **难点**：成功但 ACK 丢失、超时结果迟到、多个 worker 并发处理同 job。
- **最小练习**：同一个 POST 连发 10 次，只创建一个 execution；重试新增 attempt，但 answer/usage 只入账一次。

## 5. AI Provider Adapter / Gateway

- **解决什么**：屏蔽不同模型 API 的请求/响应差异，集中处理凭据、超时、配额和成本。
- **为什么重要**：GEO 需要跨平台比较，provider 每个都有不同字段、错误和速率规则。
- **典型架构**：统一 interface + per-provider adapter；gateway 负责 secrets、token bucket、timeout、Retry-After、cost ledger。
- **关键结构**：ProviderConfig、ModelVersion、RequestContext、ProviderResult、UsageRecord。
- **难点**：不能损失原始字段；不同 API 返回 citation 来源能力不同；模型版本变化。
- **最小练习**：实现两个 mock adapter，一个有 citations、另一个没有；保存统一字段和原始 payload，遇 429 正确延迟重试。

## 6. Evidence Provenance

- **解决什么**：让用户知道一个 KPI 或建议来自哪次回答、哪段文本、哪个 citation。
- **为什么重要**：AI 回答解析不完美，用户需要核实；解析器升级后还需重跑历史。
- **典型架构**：RawResponse append-only → ExtractionRun(version) → Mentions/Citations with spans → aggregate metrics。
- **关键结构**：raw_text_uri/hash、captured_at、provider/model/region、parser_version、start/end offsets、canonical URL。
- **难点**：长文本储存、保留/删除政策、URL redirect/parameter 清洗、证据过期。
- **最小练习**：保存一段 answer JSON；解析品牌名和两条 URL；打开 evidence drawer 能跳到原文命中片段；换解析器仍可比较两个版本。

## 7. GEO 指标和 cohort 统计

- **解决什么**：把大量回答变成稳定、可解释的 coverage/份额/排名指标。
- **为什么重要**：不同分母、平台权重、缺失响应处理会让同一数据得出相反故事。
- **典型架构**：固定 cohort → eligibility classifier → per-execution observations → versioned aggregate。
- **关键结构**：MetricDefinition(version/formula/denominator)、CohortKey、eligible flag、sample count、coverage value。
- **难点**：无响应与未提及区别、平台未触发、宏平均/合并比例差异、相关样本。
- **最小练习**：给 50 个模拟答案；计算 per-model Coverage、pooled Coverage 和 macro average；显示 n 和 N/A 规则。

## 8. Brand Entity Resolution 与 Sentiment

- **解决什么**：识别回答中简称、别名、产品名、竞品、褒贬 claim。
- **为什么重要**：误把泛词/同名实体识为客户品牌会污染所有指标。
- **典型架构**：Brand alias registry → exact/pattern matching → model-assisted resolution → human review queue → sentiment claim labels。
- **关键结构**：EntityAlias、Mention span、entity_id、method、confidence、reviewed_by。
- **难点**：跨语言、否定、对比、引用别人意见、品牌与普通名词重叠。
- **最小练习**：构造 30 条含别名/同名/否定/竞品对比的样例；计算 precision/recall，人工修订后记录 entity resolution version。

## 9. Dashboard 数据可视化与状态

- **解决什么**：用户从趋势图找到具体 prompt、answer 与 source。
- **为什么重要**：单一总分不可诊断；分析 SaaS 需要 filter、table、chart 同源并展示缺数据原因。
- **典型架构**：canonical filter DTO → query cache key → KPI/series/list API；详情通过 drawer 懒加载。
- **关键结构**：date window、model/region/topic filters、cursor、sample size、partial status。
- **难点**：race conditions、缓存失效、图表和表格口径漂移、空/错误/部分失败。
- **最小练习**：建一个 Coverage time-series 页面，切日期/model 后 KPI 和表格同步；将筛选放在 URL，刷新可恢复。

## 10. 报告快照、导出与分享

- **解决什么**：把一个时刻的 dashboard 结果留存和分享。
- **为什么重要**：基础数据会迟到或被重新解析；旧的客户报告不能无提示地变化。
- **典型架构**：Report definition + selected cohort → immutable snapshot (data + formula version) → signed/permissioned share link。
- **关键结构**：report_id、created_by、filters、metric versions、evidence refs、snapshot time、access token/expiry。
- **难点**：敏感信息权限、链接过期、快照成本、数据删除合规。
- **最小练习**：保存一次报告 snapshot，之后新增回答但旧 PDF/JSON snapshot 内容不变；撤销分享令牌后无法读。

## 11. GEO Retest 与 Outcome Attribution

- **解决什么**：观察优化后的回答/引用变化，并区分相关变化和因果结果。
- **为什么重要**：客户希望知道行动有没有帮助，但模型随机性、季节和内容外部变化会混淆结果。
- **典型架构**：Action item → content revision + publish timestamp → same cohort retest → before/after report；后续才接 matched control / difference-in-differences。
- **关键结构**：Action、URL version、cohort snapshot、retest batch、control group、GSC/GA4 conversions。
- **难点**：同一模型状态不可控，prompt 随时间变，未干预页面也变化。
- **最小练习**：对 5 个处理 prompts 和 5 个控制 prompts 做模拟前后数据，分别报告变化，不把纯前后变化说成因果。

## 12. AI 调用成本和租户配额

- **解决什么**：控制每个 Provider/模型/客户的执行开销并避免超额。
- **为什么重要**：每个 prompt × model × locale × frequency 都会产生费用/计算负担。
- **典型架构**：预估 quota → reserve usage → execute → settle/rollback → tenant usage dashboard；并发限制和预算告警。
- **关键结构**：UsageLedger、rate plan、credit conversion、reservation id、retry charge policy。
- **难点**：重试收费规则、外部账单延迟、额度并发竞争、用户看到的 credits 是否等同成本。
- **最小练习**：提供 100 credit 项目额度，两 worker 同时运行任务；原子扣额，失败不收费或按规则回退，账本可审计。

## 建议的个人练习顺序

先完成 1、2、3、4、5 组成一次可重复执行；再做 6、7、9 组成可追溯指标；最后完成 10、11、12。每个练习都留 JSON fixture 和 API contract，这样以后换 provider 或 UI 时不必推倒数据层。
