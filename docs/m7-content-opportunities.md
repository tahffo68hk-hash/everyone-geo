# M7C — Content Opportunities（内容机会）

> Evidence-driven GEO Optimization System：Benchmark → Evidence → Analysis → Report →
> Diagnosis（M7A）→ Recommendation（M7B）→ **Content Opportunity（M7C）** → M7D Experiment / Re-test。

## Purpose

回答产品问题 **“What should we create?”**：根据已有 Diagnosis 与 Recommendation，
告诉用户具体应补哪一种内容资产、覆盖哪些 Query、针对哪些模型、参考哪些已审核竞品信号、
内容结构里必须包含哪些信息块 —— 但**不替用户写完整正文、不发布、不承诺指标提升**。

M7B 与 M7C 的边界：

| 层 | 回答的问题 |
| --- | --- |
| M7A Diagnosis | 问题是什么？ |
| M7B Recommendation | 应该往什么方向优化？ |
| M7C Content Opportunity | 为了落实优化方向，应创建/准备什么内容资产？ |
| M7D Experiment / Re-test | 做了以后有没有真的提升？ |

M7C 语义核心：**Opportunity ≠ Final Content**。ContentOpportunity 是内容机会 / 内容任务
brief foundation：`titleDirection`（标题方向，非最终标题）、`suggested blocks`（建议结构块，
仅 title + purpose）、`expectedSignals`（后续观察信号，非 expectedDelta）。

## Why no LLM / no Embedding / no Full Content

- 机会生成全部为 **deterministic rules**（geo-core 纯函数），0 次真实 AI 调用、0 成本。
- Query clustering 只用已有 canonical 元数据（category / intent / locale / competitor /
  归一化 queryText），**不使用 embedding / 向量数据库**；同组相似 Query 聚合为一个机会
  （Query Cluster → Content Asset），不做 1 Query → 1 页面，也不做 17 个近似 Query → 17 个页面。
- 系统当前**没有可靠 website inventory**，因此只输出“建议资产类型 / 建议内容方向”，
  绝不声称“确认站点缺失 /xxx 页面”。Website inventory / crawler 属未来独立设计。

## Architecture

```
apps/web  /app/opportunities(+:id)         中文机会工作区（Table 干活 / Drawer 看证据）
          └─ EvidenceDialog(runId)         复用既有 Evidence Drawer（rawResponse readonly）
apps/api  opportunities/{module,controller,service}   Auth + Tenant + idempotency + status
packages/geo-core  content-opportunities.ts           纯函数引擎（不 import DB/HTTP/env/LLM）
packages/database  ContentOpportunity* 模型            migration m7c_content_opportunities
```

## Data model

- `ContentOpportunityRun`：绑定 `RecommendationRun`（projectId + recommendationRunId +
  opportunityVersion + status + summarySnapshot + metadata + generatedAt）。
- `ContentOpportunity`：opportunityRunId、opportunityType、titleDirection、summary、rationale、
  priority / priorityScore、category、assetType、contentIntent、effortLevel、
  expectedSignals(String[])、representativeQuery、targetQueryCount / targetEngineCount /
  targetCompetitorCount / evidenceCount / recommendationCount、status(PROPOSED/APPROVED/DISMISSED)、
  dataQualityLimited、targetEngines Json、targetCompetitors Json、metadata Json。
- `ContentOpportunityRecommendation`：(opportunityId, recommendationId) 关联，全保留 source links。
- `ContentOpportunityQuery`：queryTextSnapshot + category/intent/locale（BenchmarkRunQuery 快照
  对齐，取不到为 null 不猜测）+ brandAbsent / competitorPositive / sourceEvidenceCount +
  metadata.engines（该 Query 涉及模型快照）。
- `ContentOpportunityEvidence`：evidenceId/runId/queryTextSnapshot/reason（指向性引用，非 FK；
  **不复制 Evidence**）。
- `ContentOpportunityBlock`：blockType/title/purpose/sortOrder（**禁止存完整正文**）。

## Opportunity version & Snapshot semantics

- 版本集中常量 `geolens-content-opportunity-v1`（geo-core `CONTENT_OPPORTUNITY_VERSION`）。
  未来 clustering / priority / 结构模板 / 映射规则变化 → v2，历史 v1 不变。
- OpportunityRun 生成即冻结；GET 不实时重跑引擎。
- 幂等：同 `(recommendationRunId, opportunityVersion)` 重复 POST 返回既有 Run（findFirst +
  reused 标记）。已通过 e2e 验证重复生成不新增行、新旧版本可并存。

## Recommendation mapping（§16）

| RecommendationType | Opportunity 主类型 | 备选资产 | ContentIntent |
| --- | --- | --- | --- |
| ENTITY_CLARITY | ENTITY_OVERVIEW | PRODUCT_PAGE | INFORMATIONAL |
| POSITIONING_CLARITY | PRODUCT_PAGE | CONTENT_REFRESH | RECOMMENDATION |
| CATEGORY_COVERAGE | USE_CASE_PAGE | GUIDE | DISCOVERY |
| QUERY_COVERAGE | USE_CASE_PAGE | FAQ_PAGE / GUIDE | INFORMATIONAL |
| RECOMMENDATION_READINESS | USE_CASE_PAGE | COMPARISON_PAGE | RECOMMENDATION |
| COMPETITOR_DIFFERENTIATION | COMPARISON_PAGE | — | COMPARISON |
| CITATION_READINESS（<6 Query） | DATA_REFERENCE | CASE_STUDY / DOCUMENTATION | AUTHORITY |
| CITATION_READINESS（≥6 Query） | DOCUMENTATION | DATA_REFERENCE / CASE_STUDY | AUTHORITY |
| PROVIDER_COVERAGE | ENTITY_OVERVIEW | PRODUCT_PAGE | INFORMATIONAL |
| SENTIMENT_RESPONSE | CLARIFICATION_CONTENT | FAQ_PAGE | CLARIFICATION |
| STRUCTURED_INFORMATION | FAQ_PAGE | DOCUMENTATION | INFORMATIONAL |
| DATA_COLLECTION | **不生成普通机会** | — | — |

内部启发式备注：CITATION_READINESS 覆盖 Query ≥ 6 时“可引用内容中心”偏向大型文档
（DOCUMENTATION，effort HIGH），否则建议轻量 DATA_REFERENCE —— 这是 geo-core
`resolveRecommendationMapping` 的确定性分支（internal heuristic，非行业标准）。

### DATA_COLLECTION 特殊规则（重要 guard）

`DATA_COLLECTION` 本质是“先补数据”，不是“去写内容”。默认**不**从 DATA_COLLECTION
生成内容机会；OpportunityRun summary 置 `blockedByDataQuality=true` / `dataQualityLimited=true`，
UI 显示：“当前诊断数据不足，建议先补充真实检测样本，再决定高成本内容建设。”
不为了“每条 Recommendation 都有机会”硬造内容任务。

## Query clustering & Dedup

- 聚类键：`opportunityType | category | competitor | contentIntent`（§18）。同键建议合并
  （保留全部 recommendation ids / finding ids / evidence ids）。
- Dedup：`canonicalQueryKey = NFKC + trim + toLowerCase`（仅用于去重键）；`queryTextSnapshot`
  原样展示，不改写历史。
- Representative Query：确定性 —— evidence count 高 → lexical 稳定兜底（无随机）。
- 覆盖潜力记录为 `targetQueryCount`（“覆盖 N 个 Benchmark Query”），不承诺 N 个 Query 一定提升。

## Opportunity types / Content intents

- Types：ENTITY_OVERVIEW、PRODUCT_PAGE、FEATURE_PAGE、USE_CASE_PAGE、COMPARISON_PAGE、
  FAQ_PAGE、GUIDE、CASE_STUDY、DATA_REFERENCE、DOCUMENTATION、CLARIFICATION_CONTENT、
  CONTENT_REFRESH、OTHER（DB 存英文原值；中文映射归 UI labels）。
- Intents：DISCOVERY、RECOMMENDATION、COMPARISON、EVALUATION、HOW_TO、PROBLEM_SOLVING、
  AUTHORITY、CLARIFICATION、INFORMATIONAL（UI 中文：工具发现/推荐选择/横向对比/…）。

## Target queries / engines / competitors

- Queries：来源 = Recommendation → RecommendationFinding → DiagnosisFinding →
  DiagnosisFindingEvidence.queryTextSnapshot；category/intent/locale 从来源
  BenchmarkRunQuery 快照对齐补全。**不实时 join 当前 Project Query**（历史不漂移，e2e 已验证
  编辑当前 Query 不影响机会快照）。
- Engines：来自 Evidence provenance 快照（provider / engineKey / engineName /
  requestedModel / responseModel），冻结于 `targetEngines`。不做“为某模型写专属 SEO”这类操纵声明。
- Competitors：只允许**已审核竞品语义**（来源 Report Competitor Set entries 的 approved
  canonicalName ∩ 成员建议/诊断的 competitorName）；DISCOVERED 未审核候选一律不算正式目标。
  无关联时显示“无已审核竞品关联”。

## Suggested content blocks（模板，仅结构）

各 opportunityType 有确定性结构模板（如 USE_CASE_PAGE：用户场景 / 核心任务 / 适用对象 /
产品能力 / 使用流程 / 可验证事实 / 常见问题；COMPARISON_PAGE：对比范围 / 功能维度 /
差异说明 / 可验证证据 / 选择建议 / FAQ；DATA_REFERENCE：事实定义 / 数据来源 / 方法说明 /
更新时间 / 引用方式…）。Block 只存 `blockType + title + purpose`，**禁止完整正文/营销标题/
虚假案例/伪造引用/“行业第一”等无法验证表述**。

## Evidence linkage

Opportunity → ContentOpportunityEvidence → runId → 既有 Evidence Dialog（Query / Engine /
Model / Timestamp / RetrievalMode / SourceType / Mention / Position / Recommendation /
Sentiment / Raw Response / Competitors / Citations）。机会生成只在链接行存
evidenceId/runId/queryTextSnapshot/reason，**绝不复制 rawPrompt/rawResponse**；
Evidence immutable 语义不受影响。

## Priority（GeoLens internal heuristic）

```
score = round( 0.45×avg(memberRec.priorityScore)
             + 0.25×queryCoverage( min(targetQueryCount,8)×12.5 → 0–100 )
             + 0.15×competitorSignal(竞品相关 finding severity / 是否 target competitor )
             + 0.15×engineCoverage( ≥2 engines=100 / 1=60 / 0=0 ) )
clamp 0–100；priority: ≥70 HIGH / ≥45 MEDIUM / else LOW
dataQualityPenalty: hasDataQualityIssue && effort=HIGH → score=min(score,49)，
                    opportunity.dataQualityLimited=true（小样本不驱动大改造）
```
权重与阈值集中常量；文档公开；已单测覆盖（更多 query 提高 coverage、DQ 压制高成本、
clamp、deterministic、无 expectedDelta）。

## Data quality guard

- Service 侧判定 `hasDataQualityIssue`（诊断内存在 HIGH/MEDIUM DATA_QUALITY_WARNING，规则同 M7B）。
- 高成本（effort HIGH，如 DOCUMENTATION 中心）机会自动降级 ≤49；同时鼓励“先补数据 /
  低风险实体清晰度内容”。DATA_COLLECTION 建议不产出内容机会。

## Demo / Real isolation

OpportunityRun.metadata.metricSource 继承来源 Report（demo/real/mixed）。demo run 的
Opportunities UI 显示“演示内容机会 —— 不伪装真实客户策略”。禁止 Demo Opportunity 伪装真实策略。

## Status lifecycle

仅人工：PROPOSED → APPROVED / DISMISSED；APPROVED → PROPOSED（撤回）；DISMISSED → PROPOSED。
无 EXECUTING / COMPLETED（属 M7D）。非法/越级流转后端 400 拒绝。

## Limitations（诚实声明）

- M7C 是 deterministic rules，不是 LLM content strategist。
- Query clustering 不使用 embeddings。
- Title Direction 不是最终标题；Content Blocks 不是完整正文；Priority 是 GeoLens internal
  heuristic；Effort 是粗粒度估计；Expected Signals 不是效果承诺（无 expectedDelta）。
- 系统没有可靠 website inventory，因此“建议资产”≠“确认网站缺失”。
- 真正效果必须 M7D 以相同 Benchmark 复测验证（Opportunity 可保留 APPROVED + source
  Benchmark 信息作为 M7D foundation，但 M7C 不建 Experiment/Execution 表、不跑复测）。

## M7D boundary（下一步，未实现）

Opportunity → Execution → Before Benchmark → After Benchmark → Delta。M7D 再建
Experiment / After-Benchmark 生命周期。M7C 只到“brief foundation”。
