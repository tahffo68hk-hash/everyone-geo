# GEO Metrics（GeoLens 内部指标定义）

> **状态**：V0.1 / 指标版本 `geolens-v1`
> 这些指标是 **GeoLens 内部定义**，用于在统一口径下比较不同品牌/任务的表现，**不声称是行业统一标准**。UI 中同类指标均标注「GeoLens 内部指标」。
> 分析版本：`m4-rule-v1`（Deterministic Analyzer，规则可版本化演进）。

## 1. 分母（Eligible Runs）

**eligible（进入分析分母）** = `Run.status == SUCCEEDED` **且** 已保存请求的 `analysisVersion` 的 Analysis。

- Provider `FAILED` / `CANCELLED` / `QUEUED` / `RUNNING` / `PENDING` 的 Run **永不进入分析分母**。
- Provider 成功但 Analysis 缺失或版本不匹配 → 计入 `analysisMissingRuns`，**单独上报，不进分母**。
- 目的：避免「Provider 失败被算成 0 提及」这类百分比误导。

## 2. 指标定义

记 `eligible` 集合为 `E`，其中某次分析为 `a ∈ E`。

| 指标 | 公式 | 说明 |
|---|---|---|
| `visibilityRate` 可见率 | `\|{a ∈ E : a.brandMentioned}\| / \|E\|` | 品牌被提及的比例。E 为空 → `null`；提及为 0 → `0`。 |
| `recommendationRate` 推荐率 | `\|{a ∈ E : a.recommended}\| / \|E\|` | 品牌被推荐的比例。 |
| `averageMentionPosition` 平均提及排名 | `mean({a.mentionPosition : a ∈ E ∧ a.brandMentioned})` | **只统计 brandMentioned=true 的分析**；不把「未提及」设为 999。E 空或无人提及 → `null`。 |
| `shareOfVoice` 声量占比 | `brandPresence / (sum over a∈E of distinct configured entity presences in a)` | 每次分析中，每个已配置实体（品牌 + 竞品）最多计 1 次 presence；分子=品牌 presence 次数。无任何实体被提及 → `null`。重复文本出现不增加 presence。 |
| `citationCount` 引用数 | `sum(a.citations.length for a ∈ E)` | 每条分析内去重后的结构化引用计数之和。 |
| `citationDomainCount` 引用域名数 | distinct `domain(a.citations)` over E | 跨分析去重域名。 |
| `sentimentDistribution` 情感分布 | counts of `a.sentiment ∈ {positive,neutral,negative,unknown}` over E | 品牌总体情感（RuleJudge 归因）。 |

## 3. Mention Position（V0.1 定义）

- 按回答中**品牌/竞品实体第一次出现**的顺序（distinct entity 序列）从 1 开始编号。
- 例：回答 `A … ProjectMentor … B`（A、ProjectMentor、B 均为已配置实体）→ A=1, ProjectMentor=2, B=3。
- **不是字符 offset**，也不计算同实体重复出现。
- `brandMentioned=false` 时 `mentionPosition=null`（不做 999 hack）。

## 4. Rate 取值约定

- 0–1 小数；`null` 表示分母不存在（无 eligible / 无提及 / 无任何实体 presence）。
- 接口同时返回 `totalRuns` / `successfulRuns` / `failedRuns` / `cancelledRuns` / `analyzedRuns` / `analysisMissingRuns`，供调用方判断样本量，避免只看到百分比。

## 5. 已知限制（V0.1）

- RuleJudge 为词法启发式：对复杂句法、代词回指、反讽、并列推荐可能漏判/误判（保守策略）。
- SoV 用「每分析每实体 1 次 presence」，不反映多次提及强度。
- 中英文各覆盖常见推荐/否定词表，非语义模型。
- 分析可版本化：同一 Evidence 可追加新 `analysisVersion`；指标按请求版本隔离，混入旧版本会被单独计入 `analysisMissingRuns`。
