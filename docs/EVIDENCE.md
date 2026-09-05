# Evidence & Analysis 数据模型（M4）

> 状态：M4 已落地。核心不变量：
> **Raw Evidence 不可变**；**Analysis 可版本化**；**Provider 状态与 Analysis 状态分离**。

## 1. 设计目标

原始 AI 回答是 GEO 业务唯一可信的「现场记录」。任何分析/指标都只是对该记录的**一次解读**，可能随规则演进而改变。因此：

1. `Run`（Provider 执行）→ 成功后**原子写入 1 条 `Evidence`**（不可变快照）。
2. 分析在 Evidence 之上进行，产出**版本化 `Analysis`**（可多条共存）。
3. 分析失败**绝不回滚** Provider 成功，也**绝不删除** Evidence。

## 2. 实体关系

```
Run (1) ──1:1── Evidence (1) ──1:N── Analysis ──1:N── Mention
                                        │
                                        └───1:N── Citation
```

- `Evidence.runId` 唯一；`Run.evidence` 反向 1:1。
- `Analysis` 唯一键 `@@unique([evidenceId, analysisVersion])` —— 同版本幂等，可加新版本。
- `Mention` 唯一键 `@@unique([analysisId, entityType, entityId])`。
- `Citation` 唯一键 `@@unique([analysisId, url])`。
- 删除：`MonitorTask → Run → Evidence → Analysis → Mention/Citation` 全 Cascade。

## 3. Evidence 字段（Raw Evidence，不可变）

| 字段 | 说明 |
|---|---|
| `queryText` | 原始 Query 快照（提交时文本） |
| `rawPrompt` | 实际发送给 Provider 的 Prompt |
| `rawResponse` | Provider 原始回答全文 |
| `provider` | Provider 标识（mock 或 deepseek；未来 Qwen/Kimi 扩展） |
| `engineKey` / `engineName` | Engine 注册信息快照 |
| `model` / `modelVersion` | 模型标识（mock = `geolens-mock` / `1`；deepseek = 请求模型 / 服务端实际模型） |
| `retrievalMode` | 检索模式枚举（mock=`unknown`；deepseek API=`api_plain`） |
| `sourceType` | **`mock` 或 `official_api`** —— mock 明确标注 Demo，deepseek 明确标注官方 API，绝不伪装/混淆 |
| `metadata` | JSON：`durationMs`、`usage`（真实 token）、`requestId`、`finishReason`、`structuredCitations`、`rawProviderPayload`（脱敏，无 secret） |
| `entitySnapshot` | JSON：分析所用的品牌/竞品配置快照（分析可复现） |
| `createdAt` | 写入时间 |

**不可变保证**：DB 层 trigger `evidence_immutable` 拒绝任何 `UPDATE "Evidence"`（`BEFORE UPDATE ... RAISE EXCEPTION`，errcode 23514）。应用层也从不在成功写入后修改 Evidence。追加信息走新 Analysis 版本。

## 4. Analysis 字段（版本化解读）

| 字段 | 说明 |
|---|---|
| `analysisVersion` | 规则版本（当前 `m4-rule-v1`） |
| `brandMentioned` | 配置品牌是否被提及 |
| `mentionPosition` | 品牌在 distinct 实体首现序中的排名（1-based，未提及为 null） |
| `recommended` | 品牌是否被推荐（RuleJudge 词法判定） |
| `sentiment` | `positive / neutral / negative / unknown`（枚举，与 geo-core 对齐） |
| `mentions` | Mention[]（每条：entityType/entityId/canonicalName/displayName/position/context/sentiment/startOffset/endOffset） |
| `citations` | Citation[]（url/domain/title/position） |
| `createdAt` | 写入时间 |

- `Run.analysisStatus` ∈ `PENDING/SUCCEEDED/FAILED`，独立于 `Run.status`。
- `Run.analysisAttempts` 有界（<3），超出不再自动重试，避免崩溃风暴。

## 5. Provider 状态 vs Analysis 状态（关键语义）

| Run.status | Run.analysisStatus | 含义 |
|---|---|---|
| RUNNING | PENDING | Provider 执行中 |
| SUCCEEDED | PENDING | 刚成功，分析尚未跑（可被 recoverAnalyses 补齐） |
| SUCCEEDED | SUCCEEDED | 完整：有 Evidence + 当前版本 Analysis |
| SUCCEEDED | FAILED | **Provider 成功但分析失败 —— Evidence 必须保留**，不可回滚为「什么都没发生」 |
| FAILED | PENDING | Provider 永久失败，无 Evidence（不产生伪造记录） |

## 6. 写入时序（Worker）

1. `claimRun`（fencing token）→ `snapshotEntities(projectId)` 取 brand(首)+competitors。
2. `executeMock` → 返回 `result.text`（确定性 scenario 文案）。
3. `settleRun(SUCCEEDED, { persist: tx => tx.evidence.create(...) })` —— **Run 终态 + Evidence 同事务原子提交**（fencing token 保证旧进程无法写入）。
4. `analyzeEvidence(evidenceId)`：读 Evidence + entitySnapshot → `analyzeResponse` → 事务内建 `Analysis + Mentions + Citations`，同时置 `analysisStatus=SUCCEEDED`。
5. 分析抛错 → 仅 `analysisStatus=FAILED`（attempts++），Evidence 原样保留。
6. `recoverAnalyses`（worker poll 每 2s）：兜底把 `SUCCEEDED + analysisStatus∈{PENDING,FAILED} + attempts<3` 且有 Evidence 的 Run 补分析。

## 7. 幂等与并发

- Evidence：`runId` unique + settleRun 的 fencing token + 同事务 → 单次成功只写 1 条。
- Analysis：`@@unique([evidenceId, analysisVersion])` + 事务内 `SELECT ... FOR UPDATE`（MonitorTask 行锁）双保险；重复投递/jobId 幂等不会双写。
- 版本重放：同一 Evidence 追加 `analysisVersion` 需分析器声明一致版本，否则返回失败（`ANALYSIS_VERSION_MISMATCH`），防止「改版本号但跑旧规则」的静默污染。

## 8. 数据可信纪律（Mock 与真实 Provider）

- Mock：Provider=`mock`、`sourceType=mock`、Engine key 命名 `mock-*`/`demo-*`；UI 展示
  「Mock / Demo · 模拟数据」徽标，任何 mock Evidence 都不得伪装成真实模型输出。
- DeepSeek 官方 API（M5）：Provider=`deepseek`、`sourceType=official_api`、
  `retrievalMode=api_plain`；UI 展示「DeepSeek API Response · Official API 真实调用」。
  该来源是 DeepSeek API 而非 DeepSeek 搜索产品，UI/文档不使用「搜索收录/联网引用」措辞。
- 真实与 Demo 的混合任务：GEO Metrics 只基于真实子集计算，并以 `metricSource` 标注
  （demo / real / mixed），Demo 数据永不污染真实指标。
- 更新约束：真实 Evidence 与 mock 完全一致 —— `runId` unique + trigger 拒 UPDATE；
  分析失败不删 Evidence；模型重试不覆盖前一次成功 Evidence。
