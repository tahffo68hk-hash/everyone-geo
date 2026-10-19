# M7A — GEO Diagnosis Foundation

> GeoLens 第一套**可信、确定性、可解释、Evidence-backed、历史不漂移**的 GEO 问题诊断。
> M7A 只回答：问题是什么、在哪里、多严重、证据是什么。
> 「应该怎么优化」属 M7B，本版本绝不输出优化建议。

## Purpose

把 Benchmark Report 中已冻结的指标（geolens-v1）转成**可以行动的问题诊断**：

1. 品牌整体哪里弱（可见度 / 推荐）
2. 哪些场景最弱（byCategory 缺口）
3. 哪些具体 Query 长期缺失（带竞品/跨模型锚点）
4. 哪个 AI Provider / 模型表现明显更差（跨模型比较）
5. 哪些已审核竞品在品牌缺席时被推荐（CRTA / 竞品曝光优势）
6. 品牌即使出现，位置是否靠后
7. 引用信号缺口（诚实语义，不做因果推断）
8. 负面情感风险（规则版情感，非舆情 AI）
9. 当前样本是否足以支撑结论（DATA_QUALITY_WARNING 总是先出）

## Architecture

```
BenchmarkReport(快照)
   │ 派生事实（API 组装：report + run/evidence/analysis + Competitor Set entries + optional comparison）
   ▼
geo-core diagnosis engine（纯函数 / deterministic）
   │ runDiagnosis(input) → DiagnosisCandidate[] + summary
   ▼
DiagnosisRun ── DiagnosisFinding ── DiagnosisFindingEvidence（只归档链接，不复制 Evidence）
   ▼
/api（GET/POST）+ 中文 UI（/app/diagnosis 列表 / 详情 / Evidence 下钻）
```

- **规则不在** Controller / React / Prisma Service：集中在 `packages/geo-core/src/diagnosis.ts`。
- 每个 Rule 独立函数（`evaluateLowVisibility` / `evaluateCategoryGap` / …），可独立单测。

## Data flow

1. 用户在 Reports 页点「生成 GEO 问题诊断」→ `POST /reports/:reportId/diagnoses`
2. 服务端校验 Report（tenant）→ 组装 `DiagnosisInput`（含既有 Analysis 事实，不重新分析）
3. `runDiagnosis` 纯函数产出 candidates（含 Evidence 链接）→ 事务落库 DiagnosisRun + Findings + EvidenceLinks
4. 读取走**持久化 Findings / snapshot**，GET 不重跑规则（快照语义）

## Data model（M7A）

| 模型 | 说明 |
|---|---|
| `DiagnosisRun` | projectId、reportId（归档引用）、diagnosisVersion、secondaryReportId（可空）、status(READY)、summarySnapshot(Json)、metadata(Json)、generatedAt |
| `DiagnosisFinding` | diagnosisRunId、findingType(String)、severity(enum HIGH/MEDIUM/LOW/INFO)、category、title、summary、explanation、metricName、currentValue、referenceValue、queryCount、evidenceCount、provider、requestedModel/responseModel、competitorName、priorityScore、metadata |
| `DiagnosisFindingEvidence` | findingId、evidenceId(归档 UUID)、runId(归档)、queryTextSnapshot、reason |

- `findingType` 用 String（与 `analysisVersion` 同风格）：诊断版本演进可安全扩展新类型。
- Report / Evidence 引用为**普通 UUID（非 FK，归档语义）**：报告或证据行后续被清理不改变历史诊断的解释；只读路径用 `queryTextSnapshot` 展示。

## Version

- 集中常量：`DIAGNOSIS_VERSION = 'geolens-diagnosis-v2'`（geo-core）。自然发现诊断样本排除品牌校验 Query，历史 v1 诊断快照保留原语义。
- 未来改规则/阈值 → 新增 `geolens-diagnosis-v2`，**不改 v1 历史含义**（旧 DiagnosisRun 保持原 Finding）。

## Finding types（v1）

| findingType | 触发规则（概要） |
|---|---|
| `LOW_VISIBILITY` | overall.visibilityRate < 60%（高 <20 / 中 <40 / 低 <60） |
| `LOW_RECOMMENDATION` | 品牌被提及样本 ≥3，且其中推荐占比 <60%（高 <20 / 中 <40）—— 区别于可见性问题 |
| `CATEGORY_GAP` | category 可见率 =0（样本≥2 且 overall>0）→ HIGH；低于 overall ≥15pp → MEDIUM/LOW |
| `QUERY_GAP` | 品牌缺席且带锚点：(A) 已审核竞品被正面提及/被推荐，或 (C) 跨 Provider 对比两侧均缺席；无锚点缺席归入 CATEGORY_GAP/LOW_VISIBILITY |
| `PROVIDER_GAP` | 需 compatible `secondaryReportId`；可见率差 ≥15pp 且较高侧 ≥20%、低/高 ≤50% → HIGH(≤25%)/MEDIUM —— 标注为跨模型服务比较 |
| `COMPETITOR_DOMINANCE` | 需激活 Competitor Set 快照；竞品 SoV ≥15% 且明显高于目标、目标可见率 ≤50%（≥50% SoV HIGH / ≥25% MEDIUM） |
| `COMPETITOR_RECOMMENDED_TARGET_ABSENT` | 需激活集内已审核竞品；品牌缺席而竞品在该回答被正面提及（存储 mention 情感 = positive，来自同一确定性词法规则） |
| `POOR_MENTION_POSITION` | 仅品牌被提及样本；平均提及位置 ≥5 HIGH / ≥3.5 MEDIUM / ≥2.6 LOW（需 ≥2 个位置样本） |
| `CITATION_GAP` | 样本 ≥5 且引用总数 =0 → INFO；诚实语义：仅「未观察到引用信号」，不做「官网权威性不足」因果推断 |
| `SENTIMENT_RISK` | 仅当负面 Analysis 存在；负面占比 ≥30% HIGH / ≥12% MEDIUM —— 标注为「基于当前规则版情感分析」，非舆情 AI |
| `DATA_QUALITY_WARNING` | **总是最先评估**：小样本（<5 HIGH / <10 MEDIUM / <16 LOW）、0 成功样本、成功率 <80%、PARTIAL、演示/混合数据提示 |

> v1 无法可靠支持的场景如实说明：`supportedFindingTypes`（随 DiagnosisRun.metadata 返回）。
> 例如无 Competitor Set 时 `COMPETITOR_*` supported=false；无 comparison 时 `PROVIDER_GAP` supported=false。

## Severity

`HIGH / MEDIUM / LOW / INFO`（Prisma enum）。UI：高优先级 / 中优先级 / 低优先级 / 提示。
Severity **必须 deterministic** —— 全部由阈值配置决定，禁止 LLM 决定。

## Priority Score（GeoLens 内部优先级评分，0–100）

确定性公式：

```
severityWeight(HIGH=100,MEDIUM=60,LOW=30,INFO=10) × 0.5
+ 受影响比例(受影响query/eligible query, 封顶1) × 100 × 0.25
+ 证据信号(min(1, evidenceCount/12)) × 100 × 0.25
```

- 无伪机器学习、无「AI 判断严重度 92%」输出；UI 明确显示「GeoLens 内部优先级评分（0–100，确定性规则）」。

## Threshold config

集中常量 `DIAGNOSIS_V1_RULES`（geo-core `diagnosis.ts`），规则体不散落 magic number。
这些阈值属于 **GeoLens internal heuristic**，**不是行业标准**；解释文案与 UI 恒带此声明。

## Evidence linkage

- 每个 Finding 落 `DiagnosisFindingEvidence`（evidenceId / runId / queryTextSnapshot / reason）。
- 规则只**引用**既有 Evidence；不复制 rawPrompt/rawResponse。
- Evidence 保持 immutable（M4 DB trigger 未被破坏，e2e 断言 UPDATE 被拒）。
- UI：Finding → 展开「查看证据」→ 「查看原始回答」→ EvidenceDialog（rawResponse 原样展示）。

## Snapshot semantics

- DiagnosisRun 生成时冻结：绑定 Report（其自身已冻结 suite/provider/analysisVersion/Competitor Set/metrics）；
  输出 Findings + summarySnapshot 一次性落库。
- 之后 Report 被新版本替代 / Set v2 激活 / Analysis v2 / Diagnosis v2：**旧 DiagnosisRun 保持原 Finding**，GET 不重跑规则。
- 幂等：同 `(reportId, diagnosisVersion, secondaryReportId(null 等价))` 重复 POST → 返回既有 DiagnosisRun（不无限堆快照）。

## Demo / Real 隔离

- Demo（mock）报告的诊断首条恒含「演示数据诊断」（INFO）提示；UI 标注「演示诊断——不伪装真实结论」。
- Real 报告无该提示；mixed 仅真实子集口径并提示。
- 真机验收全程 0 次真实 AI 请求（fixture 直连落库 mock Evidence/Analysis）。

## Provider Gap

- 复用 M6 Reports `compare` 语义判定可比性：`NOT_COMPARABLE` → 400 拒绝；
  仅 `COMPARABLE` 或「仅 Provider/模型差异」的 `PARTIALLY_COMPARABLE` 才允许产出 `PROVIDER_GAP`。
- Finding 明确标注「跨模型服务比较」，并给出双方可见率/模型身份。

## Limitations（must-read）

1. 当前 Diagnosis 属 **deterministic rules**，非 LLM 因果推断。
2. 阈值属 **GeoLens internal heuristic**，非行业标准。
3. 样本量直接影响结论可靠性：小样本只作为初步信号（DATA_QUALITY_WARNING 前置）。
4. 情感为**规则版词法情感**（非舆情分析 AI）；引用仅在 api_plain 下提示「未观察到信号」，不做权威性推断。
5. SoV / 竞品信号仅代表**已审核竞品集**与当前测试集，不代表市场占有率。

## M7B boundary（不在 M7A 做）

- 优化建议（FAQ / 内容 / 官网 / schema / 投放 / SEO）
- 内容机会与实验设计（M7C / M7D）
- 本轮只诊断，不给方案。
