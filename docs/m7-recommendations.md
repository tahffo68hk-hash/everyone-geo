# M7B — Optimization Recommendations

> 把 M7A 的 Evidence-backed Diagnosis 转成**少量、清晰、去重、可执行、有优先级、有依据、能验证**的优化行动。
> M7B 只回答「应该优化什么方向、为什么、优先级、适用资产、补哪些信息类型」；
> 具体文章/页面/FAQ 内容属 M7C，M7B 绝不生成最终内容。

## Purpose

- Recommendation = **优化假设 / 行动建议**（hypothesis-backed action）。
- 不是事实诊断（那是 M7A Finding）、不是因果证明、不是效果承诺。
- 每个建议必须 **Diagnosis-backed**：Recommendation→RecommendationFinding→DiagnosisFinding→FindingEvidence→Evidence 全链可回查。

## M7A vs M7B boundary

| | M7A | M7B |
|---|---|---|
| 回答 | 哪里有问题 / 多严重 / 证据 | 优化什么方向 / 为什么 / 优先级 / 资产类型 |
| 输出 | DiagnosisFinding | Recommendation + ActionItems |
| 性质 | 事实诊断 | 优化假设（需 M7D 复测验证） |

## Architecture

```
DiagnosisRun ── DiagnosisFinding[]
        │（API 组装 finding 事实，不重跑诊断）
        ▼
geo-core recommendations engine（纯函数 / deterministic / 不 import DB·HTTP·env）
        │ runRecommendations(input) → RecommendationCandidate[]（含 ActionItemCandidate[]）
        ▼
RecommendationRun ── Recommendation ── (RecommendationFinding → DiagnosisFinding)
                                     └─ ActionItem
        ▼
/api + 中文 UI（/app/recommendations）
```

## Data model（M7B）

| 模型 | 说明 |
|---|---|
| `RecommendationRun` | projectId、diagnosisRunId(FK)、recommendationVersion、status、summarySnapshot、metadata、generatedAt |
| `Recommendation` | recommendationType、title、summary、rationale、priority(HIGH/MEDIUM/LOW)、priorityScore(0–100)、impactArea、targetAssetType、expectedSignal、effortLevel(LOW/MEDIUM/HIGH)、status(PROPOSED/ACCEPTED/DISMISSED)、findingCount、evidenceCount、category、competitorName |
| `RecommendationFinding` | recommendationId + findingId（归档引用，不复制 Finding 内容） |
| `ActionItem` | actionType、title、description、sortOrder、effortLevel、verificationMethod、status(TODO/IN_PROGRESS/DONE/SKIPPED) |

- type/status/priority/effort 均用 String（与 findingType 同风格，版本演进友好），UI 中文映射。
- Migration `20260906143842_m7b_recommendations`（dev + test + generate；无 destructive）。

## Version

- 集中常量：`RECOMMENDATION_VERSION = 'geolens-recommendation-v1'`（geo-core）。
- 规则/行动策略/优先级变化 → v2；历史 RecommendationRun 保持 v1。
- Snapshot + Idempotency：同 `(diagnosisRunId, recommendationVersion)` 重复 POST 返回既有 Run；GET 不重跑。

## Strategy taxonomy

`impactArea` 取值：ENTITY / POSITIONING / CONTENT_COVERAGE / RECOMMENDATION / COMPETITIVE / CITATION / STRUCTURE / PROVIDER / SENTIMENT / DATA_QUALITY（UI 中文映射见 labels IMPACT_AREA）。

## Finding → Recommendation mapping（确定性）

| DiagnosisFindingType | RecommendationType |
|---|---|
| LOW_VISIBILITY | ENTITY_CLARITY + CATEGORY_COVERAGE(整体) |
| LOW_RECOMMENDATION | RECOMMENDATION_READINESS |
| CATEGORY_GAP | CATEGORY_COVERAGE（保留 category） |
| QUERY_GAP | QUERY_COVERAGE（按 category 聚合） |
| PROVIDER_GAP | PROVIDER_COVERAGE |
| COMPETITOR_DOMINANCE | COMPETITOR_DIFFERENTIATION（按竞品分离） |
| COMPETITOR_RECOMMENDED_TARGET_ABSENT | COMPETITOR_DIFFERENTIATION + RECOMMENDATION_READINESS |
| POOR_MENTION_POSITION | POSITIONING_CLARITY |
| CITATION_GAP | CITATION_READINESS |
| SENTIMENT_RISK | SENTIMENT_RESPONSE |
| DATA_QUALITY_WARNING | DATA_COLLECTION |

## Dedup / Merge（deterministic clustering）

- 聚类键：`recommendationType | category | competitorName`。
- 同键多条 Finding 合并为一条 Recommendation（findingIds 全保留、findingCount 累计）。
- 同 category 多个 QUERY_GAP 聚为一条（非逐条建页）；不同 category / 不同竞品不合并。
- ENTITY_CLARITY 只来自 LOW_VISIBILITY，与 CATEGORY_GAP 建议不重复。

## Priority（GeoLens internal prioritization heuristic）

```
priorityScore = typeWeight×0.35 + avg(finding.priorityScore)×0.35
              + min(25, findingCount×6)×0.8 + (含 HIGH finding ? 8 : 0)
clamp 0–100；label：≥70 HIGH / ≥45 MEDIUM / 其余 LOW
```

- deterministic；同输入同输出；无伪 ML。
- DataQualityGuard：DiagnosisRun 含 HIGH/MEDIUM 的 DATA_QUALITY_WARNING 时，高成本（effort=HIGH）建议自动压至 ≤49（不会小样本驱动大改造）；DATA_COLLECTION 建议总会出现。

## Effort

LOW / MEDIUM / HIGH 粗粒度（不假装精确工时）。由 `RECOMMENDATION_TYPE_RULES.effort` 决定。

## Expected Signal

记录「希望改善的 GEO signal」（VISIBILITY / RECOMMENDATION / MENTION_POSITION / CITATION / COMPETITOR_SOV / ENTITY_UNDERSTANDING / CATEGORY_COVERAGE）。
**不等于 expectedDelta —— 不承诺「提升 +N%」**。

## Action Items（checklist，不直接执行）

- 每类 Recommendation 内置确定性 Action 模板（actionType/title/description/sortOrder/effort）。
- 每项携带 `verificationMethod`（默认：完成后用相同 Benchmark Suite 复测对应测试问题，M7D 验证）。
- 状态：TODO / IN_PROGRESS / DONE / SKIPPED（轻量，M7D 再升级实验生命周期）。

## Evidence linkage

- Recommendation→RecommendationFinding→DiagnosisFinding（含其 evidenceLinks）→Evidence。
- API 提供聚合 evidence 端点（仅链接 + queryText 快照），**不复制 rawResponse/不复制 Finding**。

## Snapshot semantics

- 生成即冻结；幂等命中既有 Run。
- 后续 Diagnosis 增补 / 规则变化 / v2 / Report v2 不改变历史 Recommendation。

## Demo / Real

- RecommendationRun 继承来源 Diagnosis 数据类型（metadata.metricSource）；UI 显示「演示数据优化建议 / 真实数据优化建议」。
- Demo 不伪装真实策略报告。

## Limitations（must-read）

1. Recommendation 是 **deterministic rules**（无 LLM consulting）。
2. Priority/Effort 为 **GeoLens internal heuristic**（非行业标准）。
3. **非因果证明、非效果承诺**；效果必须经 M7D 复测验证。
4. Content 具体方案（文章/页面/FAQ/Schema）留给 M7C，本版本只给行动 plan。
5. v1 未产出 STRUCTURED_INFORMATION（无 Finding 映射源）；如后续需要可经 v2 或专门 Finding 引入。

## M7C boundary（不在 M7B 做）

- 具体内容 opportunity（哪一篇文章/页面/FAQ/brief）、最终文案、Schema、发布。
