# M8E — Target Entity & Query Workspace

> 通用监测对象 + 自定义 Query 工作区（属于 M8 产品基础增强；不是 M9）。

## 1. Purpose

让 GeoLens 从「围绕 ProjectMentor 固定 Benchmark 做检测」升级为「任意项目自己定义：
我要监测哪个品牌/产品（Target Entity）、属于什么产品类别、希望 AI 回答哪些用户问题，
然后检测回答中是否自然出现目标品牌」。

## 2. 核心产品语义（纠正错误心智）

```
Target Entity  ≠  Query
Target Entity = 我要监测谁（ProjectMentor / AcmeFlow）
Query         = 我要让 AI 回答什么真实用户问题（不含目标品牌）
```

**禁止**把产品表现成「输入品牌，然后一直问 AI：ProjectMentor 好不好/是什么/推荐吗」——
那只属于 BRANDED_SANITY（品牌认知测试），不是主 GEO Visibility Benchmark。
真正核心：**Discovery Query 不包含目标品牌，衡量 AI 是否自然想到我**。

## 3. 架构决定（Gate A 结论，docs 记录）

1. **复用 BenchmarkSuite/BenchmarkQuery 作为 Query Set 载体**（决定①）：
   suite 已具备 version/status/category/intent/locale/weight/enabled/sortOrder/sanity/metadata
   + projectQueryId 镜像 + BenchmarkRunQuery 全快照 —— 完全满足可执行、版本化的 Query Set。
   **不新增第二套 QuerySet/QuerySetItem**；只补字段：
   - `BenchmarkQuery.queryType`（DISCOVERY / BRANDED_SANITY / CUSTOM；String taxonomy，兼容 sanity bool）
   - `BenchmarkQuery.source`（MANUAL / BUILDER / IMPORT / SEED）
   - `BenchmarkQuery.contamination` Json（target 泄漏检查快照）
   - `BenchmarkRunQuery` 增加 queryType/contamination 快照（运行后源行编辑不影响历史）
   - `BenchmarkRun.targetSnapshot` Json（本次测试监测谁；Run 创建时冻结）

2. **监测对象（Target Profile）= 项目 primary Brand**（决定②）：worker `snapshotEntities`
   一直取 brands[0] 为 brand entity —— 即 1 Project = 1 Primary Target 的既有事实。
   - Brand 扩展 `entityType`(BRAND/PRODUCT/SERVICE/ORGANIZATION/OTHER)、`productCategory`。
   - 新增 `TargetEntityAlias`（brandId、alias、aliasType、enabled）—— 按 alias 粒度管理；
     worker 组装 entities 时合并 `brand.aliases`（历史兼容）+ enabled alias 表行。
   - Evidence.entitySnapshot 在 Run 时冻结 → **alias 修改不影响历史 Evidence/Analysis/Report**。
   - 不新增第二套 target 主表（避免 Brand 与 TargetEntityProfile 双源）。

## 4. Target Profile（产品语义）

| 字段 | 说明 |
| --- | --- |
| canonicalName | 监测名称（= primary Brand.name） |
| entityType | BRAND / PRODUCT / SERVICE / ORGANIZATION / OTHER |
| productCategory | 自由文本（大学生创新创业 AI 工具 / CRM SaaS / 洗地机）—— 不做行业树 |
| website / description | 可选 |
| aliases | TargetEntityAlias：OFFICIAL/PRODUCT/ABBREVIATION/LOCALIZED/CUSTOM + enabled |

**UI 提示**：修改只影响之后的新检测；历史 Evidence、Analysis 和报告不会重新计算。

## 5. Target Contamination（确定性，无 LLM）

`geo-core/query-workspace.ts`：
- normalize：NFKC + lowercase + whitespace collapse（dedup/匹配用，保留原文展示）。
- `detectTargetContamination(queryText, {canonicalName, aliases})`：
  - 拉丁/数字别名做词边界匹配（避免 substring 误报："Mentor" vs "ProjectMentorX"）；
  - 中文直接子串（NFKC 后）；
  - longest alias 优先；返回 `matchedAlias`；
  - URL 内命中 → `POSSIBLE_TARGET_MENTION`（提示，不算硬泄漏）。
- `guardQueryType`：
  - DISCOVERY + TARGET_MENTIONED ⇒ **拒绝**（TARGET_PRESENT_IN_DISCOVERY_QUERY，
    建议改 BRANDED_SANITY）——中文提示：该问题包含当前监测品牌，会使自然可见度指标偏高。
  - CUSTOM + TARGET_MENTIONED ⇒ 允许但警告（不计入主指标，contamination 记录）。
  - BRANDED_SANITY ⇒ 允许。

**不静默保存**：createSuite 与 queries/batch 都会走 guard（createSuite 对 queryType=DISCOVERY
含 target 拒绝；无 target 时跳过——无法判断就不猜）。

## 6. Query Types

- **DISCOVERY**：默认类型。query 不含 target；主 GEO Visibility/Recommendation/SoV/Position denominator。
- **BRANDED_SANITY**：品牌认知测试（"AcmeFlow 是什么？"）。单独展示 N/N recognized；
  **不进入主 GEO metrics**（sanity legacy bool 与 queryType 双兼容）。
- **CUSTOM**：用户直接写任意问题。含 target 会警告并记录 contamination；不计入主指标。

历史兼容：24 条 ProjectMentor v1 主 query（可证明不含品牌名，seed 事实）标注 DISCOVERY；
2 条 sanity（enabled=false + 含品牌）标注 BRANDED_SANITY；其他未知 queryType=null 保持
legacy 口径（metrics 端按 sanity 解释），不猜不改历史。

## 7. Query Builder（deterministic，0 LLM / 0 network）

- 输入：category（产品类别）、scenario、intents（RECOMMEND/HOW_TO/COMPARE/
  PROBLEM_SOLVING/INFORMATIONAL）、audience、modifiers、custom。
- 模板集中配置（`QUERY_TEMPLATES`），product category 自然融入，**target 品牌永不进入模板**。
- preview cap（默认 100，防组合爆炸）；先 Preview 再保存，逐条可编辑；不直接运行。
- 无任何 structured 输入时输出兜底模板；custom 直接追加。
- **Builder/Import Preview 一律无副作用**（e2e 断言 preview 前后 DB query 数不变）。
- 保存时 DISCOVERY + 污染 ⇒ 400；UI 提示移除品牌或转 BRANDED_SANITY。

## 8. Metrics Denominator（可审计，不虚高）

- `getMetrics` 输出新增：`metricQueryScope`（DISCOVERY_ONLY）、`metricScopeQueryCount`、
  `excludedSanityCount`、`excludedContaminatedCount`。
- **overall/byCategory/byQuery 只消费 eligible pool**（非 BRANDED_SANITY / 非 legacy sanity /
  非含 target 的 CUSTOM），修复了旧实现 overall 混入 sanity 的潜在虚高。
- `overall.queryEligibleCount` 保持历史语义（analyzedRuns）——与顶层 scope 字段并存；
  历史 Report 快照不重算（metricsSnapshot 冻结），新 Report 记录 scope 元数据。
- Report UI 明确「核心指标样本：DISCOVERY_ONLY（N 个可用问题 · 排除品牌认知测试 X 个）」。
- 品牌认知测试结果单独展示（N/N recognized），不混入 Visibility。

## 9. Prompt Neutrality（已由单测锁定）

- DeepSeek 请求 = `[{role:'user', content: queryText}]`（可选项 systemPrompt 来自 Engine
  config 人工配置）。**target canonical/alias 不注入 prompt**（除非 BRANDED_SANITY 的 query
  本身含品牌名——那是用户明示问题）。
- `llm.test` 新增 M8E-74 系列：Discovery provider prompt 不含 ProjectMentor/项目导师；
  BRANDED_SANITY 允许；systemPrompt 不自动含 target。

## 10. Generic（无品牌硬编码）

- production analyzer/worker/benchmark/reports **不出现 ProjectMentor 常量**（mock fallback
  改为 'TargetBrand'，recommendation 模板示例文案通用化；`benchmark-queries.ts` seed 属
  demo/test 范畴保留）。
- 双 Demo（0 real calls）：ProjectMentor（大学生创新创业 AI 工具）与 **AcmeFlow**（CRM SaaS，
  虚构）用同一 analyzer/benchmark pipeline，无一行代码因品牌不同而改动 —— e2e
  `query-workspace.e2e-spec.ts` 用 AcmeFlow 全流程证明通用性；Branded Sanity 测试证明
  DISCOVERY 拒绝、BRANDED_SANITY 保存且不抬高主 Visibility。

## 11. Historical Stability

- 历史 BenchmarkReport/Diagnosis/Recommendation/Opportunity/Experiment **不改写不重算**
  （metricsSnapshot 快照 + Run 创建即冻结 targetSnapshot/queryType/contamination）。
- 复制为新版本（clone v2）不影响 v1 报告（e2e 验证前后 visibilityRate 相等）。

## 12. Known Limitations

- Query Builder v1 deterministic（不使用 LLM 扩词）；Category 自由文本（无行业 taxonomy）；
  Intent taxonomy 为 GeoLens internal；1 Project = 1 primary target；
- BRANDED_SANITY 不进入主 GEO visibility（单独展示）；CUSTOM 含 target 会警告且不入主指标；
- api_plain 仍不是 Web Search（UI 文案区分「运行 AI 检测」与「联网搜索」）；
  自定义 Query 不代表联网检索；真实 GEO 优化 Pilot 仍受 Measurement Validity 约束。
