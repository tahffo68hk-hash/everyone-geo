# M7D — Optimization Experiment & Re-test（受控复测基础）

> GeoLens 优化闭环最终段：Opportunity → Optimization Experiment → Execution Record →
> **Frozen Re-test** → Evaluation（Metric/Query Delta + Evidence A/B）→ **Observed Outcome**。

## Purpose

回答：“执行之后，重新测试，到底观察到了什么变化？”

完整链路：Benchmark Before → Diagnosis(M7A) → Recommendation(M7B) → Content Opportunity(M7C)
→ **Optimization Experiment** → Execution Record → Re-test → Benchmark After → Compatibility →
Metric Delta → Query Delta → Evidence Before/After → Observed Outcome。

**Observed Outcome ≠ Proven Causal Effect**：GeoLens 展示执行前后复测观察到的变化；生成式
模型、Provider、互联网内容、竞品等外部因素可能同时变化 —— 除非更严格的控制实验设计，
不得把变化解释为单一优化动作的严格因果证明（UI 恒带归因声明）。

## M7C vs M7D boundary

| 层 | 回答的问题 |
| --- | --- |
| M7A Diagnosis | 问题是什么？ |
| M7B Recommendation | 应该往什么方向优化？ |
| M7C Content Opportunity | 应创建/准备什么内容资产？ |
| M7D Experiment & Re-test | 执行后复测，观察到什么变化？ |

M7C 不越过 M7D（不执行、不发布、不证明效果）；M7D 不做因果断言、不替代人工验收。

## Architecture

```
apps/web  /app/experiments(+:id)       优化实验工作区（列表 Table + 详情 10 段式）
          └─ EvidenceDialog(runId)     Evidence A/B → 复用既有 Evidence Drawer
apps/api  experiments/{module,controller,service}     实验生命周期 + 编排
          benchmark.service.startRunFromSnapshot()     冻结快照复测（复用既有 pipeline）
          reports.service（自动 After Report）          复用既有报告生成
packages/geo-core  experiments.ts                       纯函数：fingerprint/compat/deltas/outcome
packages/database  OptimizationExperiment* 模型          migration m7d_experiments
```

## Experiment lifecycle

`PLANNED → EXECUTION_RECORDED → RETEST_RUNNING → EVALUATED`（或 CANCELLED）。不自动“执行完成”：
Execution Record 必须由用户/Agent 明确确认（“这项修改实际上已经完成”）。

- OptimizationExperiment：绑定 ContentOpportunity + Baseline Report（provenance 冻结：
  querySetFingerprint、metricSource、provider、requested/responseModel、analysisVersion、
  competitorSetVersion、suite、plannedQueryCount）。idempotency：同
  (opportunityId, experimentVersion, baselineReportId) 返回既有。
- ExperimentExecution：用户确认的变更记录（executionType/changeSummary/assetType/
  assetReference/executedAt）。时序 guard：Before.generatedAt ≤ executedAt < After.generatedAt，
  否则拒绝。assetReference 仅记录，**不 fetch / 不验证外部页面**。
- ExperimentRetest：#1/#2/#3… 多次复测独立记录，绝不覆盖旧 After。
- ExperimentEvaluation：immutable snapshot（evaluationVersion=geolens-experiment-evaluation-v1；
  未来 v2 并存不重算 v1）。metric/query deltas 随评估冻结。

## Frozen Re-test（最关键架构决策）

`BenchmarkService.startRun` 读取**当前** BenchmarkSuite/BenchmarkQuery —— 若直接用其复测，
Baseline 编辑会造成 **Re-test Query Drift**。M7D 因此新增 `startRunFromSnapshot(userId,
baselineRunId, dto)`：输入为基线 BenchmarkRun 的 **BenchmarkRunQuery 冻结快照**
（queryText/category/intent/locale/weight/sanity/sortOrder 全同），为每个快照语义新建镜像
Query 行，然后仍走既有 BenchmarkRun → MonitorTask → Run → Queue → Worker → Evidence →
Analysis → Report 管线 —— 不建第二套 Worker/Evidence/Metrics。

- Query Fingerprint：`querySetFingerprint = SHA-256(ordered semantic rows)`；语义行只含
  queryText/category/intent/locale/weight/sanity/sortOrder，**不含 DB id / createdAt**。
- Retest 前重算指纹必须与实验基线一致，否则 400 拒绝（宁可拒绝，不制造假 Before/After）。
- 当前 BenchmarkQuery 编辑**不会**漂移复测（已单测+e2e 覆盖）。

## Report Compatibility

Evaluation 复用 M6 口径并更严格：可评估实验至少要求 **same query fingerprint / metricSource /
provider / requestedModel / analysisVersion / competitorSetVersion**（hard）→
CONTROLLED_COMPARABLE；responseModel drift（模型后端升级迹象）→ PARTIALLY_COMPARABLE +
MODEL_DRIFT_WARNING（不把变化完全归因内容）；任一 hard 不一致 → NOT_COMPARABLE →
outcome INCONCLUSIVE。

Warnings 覆盖：QUERY_SET_CHANGED / PROVIDER_CHANGED / REQUESTED_MODEL_CHANGED /
MODEL_DRIFT_WARNING / ANALYSIS_VERSION_CHANGED / COMPETITOR_SET_CHANGED /
METRIC_SOURCE_CHANGED / SUCCESS_COVERAGE_CHANGED / EXECUTION_TIME_INVALID / PARTIAL_RUN /
UNKNOWN_MODEL_IDENTITY 等。

## Metric Delta（pp / 位 / count 语义）

- visibilityRate / recommendationRate / shareOfVoice：Δ 用 **pp**（0-1 内部 → ×100 展示），
  绝不显示相对 %（25%→40% = **+15pp**，不是 +60%）。
- averageMentionPosition：Δ 用“位”；**数字越小越好**（5→2 = 提升 3 位，direction=IMPROVED）。
- citationCount / citationDomainCount：Δ 用 count（+4/+2）。
- threshold（EXPERIMENT_EVALUATION_V1_RULES，internal heuristic）：率类 |Δ|<3pp NEUTRAL、
  3–5 SMALL、≥5 MEANINGFUL；位置 <0.5 位 NEUTRAL、0.5–1.0 SMALL、≥1.0 MEANINGFUL；
  引用 0 NEUTRAL、1–2 SMALL、≥3 MEANINGFUL。

## Query Delta（最有产品价值层）

每个 Query 计算 before/after Mentioned / Recommended / Position / CitationCount，transition：
GAINED_VISIBILITY / LOST_VISIBILITY / GAINED_RECOMMENDATION / LOST_RECOMMENDATION /
POSITION_IMPROVED / POSITION_DECLINED / CITATION_GAINED / CITATION_LOST / UNCHANGED /
NOT_EVALUABLE。Before/After 按冻结快照 sortOrder 对齐（queryText 以快照展示）。

**Failed run ≠ brand missing**：任一测 provider 失败/分析缺失 → NOT_EVALUABLE（“After 数据
不可用，不等于品牌缺席”），绝不把 failed 当 LOST_VISIBILITY。

## Evidence A/B

Query Delta 提供 before/after evidence 链接（evidenceId/runId/queryText），点击经既有
EvidenceDialog 查看 Raw Response / 模型身份 / Mention / Citation。历史 Evidence immutable：
本层只做链接，绝不复制/改写 rawResponse。

## Outcome

IMPROVED_SIGNALS / MIXED_SIGNALS / NO_CLEAR_CHANGE / REGRESSED_SIGNALS / INCONCLUSIVE。
只在 Compatibility 足够 + Coverage 足够（after 成功样本 ≥ before 的 90%）时计算；不足一律
INCONCLUSIVE。规则：主信号（机会 expectedSignals 映射：VISIBILITY→visibilityRate、
RECOMMENDATION→recommendationRate、MENTION_POSITION→averageMentionPosition、
COMPETITOR_SOV→shareOfVoice、CITATION→citationCount；无映射则回退 visibility+recommendation）
的 MEANINGFUL 改善数 > 下降数且无下降 → IMPROVED；同有正/负 → MIXED；仅有下降 → REGRESSED；
无 meaningful → NO_CLEAR_CHANGE。**不使用 causal 措辞**（不是 PROVEN_EFFECTIVE）。

## Demo / Real isolation & Real cost guard

- Demo Opportunity → 只能 Demo Experiment（metricSource=demo，Mock engine，0 cost）；
  Real 同理；mixed 基线 v1 直接拒绝。
- Real Re-test 必须同一 provider/requestedModel（更干净对照）；planned call count =
  queryCount × 1 provider ≤ REAL_PROVIDER_MAX_RUNS_PER_TASK（M6 cost guard 复用，
  禁止拆批绕过）；Real UI 需要显式危险确认。
- Demo 数据永不进入 Real 结论。Demo Outcome 不要求一定“变好”（验收重点：闭环正确）。

## Evaluation version & snapshot

`geolens-experiment-evaluation-v1`；Evaluation 生成即 immutable；重复评估同
(retestId, evaluationVersion) 幂等返回既有；未来规则变化 → v2 并存、Re-evaluate 生成 v2，
v1 保留不漂移。

## Future Preference Dataset Foundation

schema 已能形成：Opportunity → Execution → Before Evidence → After Evidence → Metric Delta →
Query Delta → Outcome（多轮 Retest 随时间变化）。为未来 GEO Preference Dataset 提供原始来源；
**本轮不训练/不导出任何模型与数据集**。

## Known Limitations（诚实声明）

- M7D v1 不是 randomized controlled trial / statistical causal inference / control group。
- 不自动验证外部页面是否真的按计划修改 —— Execution Record 是用户确认。
- 模型输出存在随机性；Provider 可能模型漂移；Web retrieval 结果可能变化。
- Meaningful thresholds 是 GeoLens internal heuristic。
- 单次 Before/After 不代表长期稳定效果；正式结论应结合多次 Re-test。

## Future Improvements（只记录，不实现）

Repeated Retest Trend / Control Query Group / Holdout Queries / Website Change Verification /
CMS Integration / Experiment Scheduling / Statistical Confidence / Preference Dataset Export /
Preference Model。
