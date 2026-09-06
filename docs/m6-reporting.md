# M6C — Benchmark Reporting + Model Identity 设计文档

> 里程碑：M6C（Benchmark Reporting + Model Identity）
> 数据权威定义：`packages/llm/src/types.ts`（模型身份接口）+ `apps/api/src/reports/`
> 文档版本：v1（2026-09-06）

---

## 1. 目标与边界

M6C 只解决三件事：
1. **Model Identity**：正式区分 requestedModel（请求时指定的模型）与
   responseModel（Provider 响应中实际声明的模型）——真实 DeepSeek 场景下
   请求 `deepseek-chat`、响应可能为 `deepseek-v4-flash`，两者不得混为一个字段。
2. **Benchmark Report**：把 Benchmark / Evidence / Analysis / Competitor Set / SoV /
   Metrics 组织成**可信、可追溯、版本明确**的不可变 GEO 报告快照。
3. **Historical Comparison Foundation**：支持 本次 vs 上次 / Run A vs Run B 的
   可比性判定 + Δ，并为未来 DeepSeek vs 第二 Provider、Benchmark v1 vs v2 预留。

边界（硬性）：不接第二 Provider、不真实调用 DeepSeek、不产生费用、不进入 M6D。

## 2. Model Identity 语义

### 2.1 审计结论（先读代码，不猜 schema）

M6C 前真实链路：Engine config / env `DEEPSEEK_MODEL=deepseek-chat`（请求）；
`packages/llm/src/deepseek.ts` 把 Provider 响应的 `payload.model`（如
deepseek-v4-flash）写进 `response.model`（缺省回退请求模型）与 `modelVersion`；
Worker 再原样写入 `Evidence.model / modelVersion`。因此**旧 Evidence.model 事实上是
“响应模型优先、缺失回退请求模型”的混合值** —— 这正是要拆分的根源。

### 2.2 最终语义

| 字段 | 语义 |
|------|------|
| `ProviderRequest.requestedModel` | Worker 用 `enginePresentation` 单一解析后传入的请求模型（不再靠 Provider 猜） |
| `ProviderResponse.requestedModel` | 本次调用实际发送的模型（如 `deepseek-chat`） |
| `ProviderResponse.responseModel` | Provider 响应中声明的模型（如 `deepseek-v4-flash`），未声明则为 `null` |
| `Evidence.requestedModel / responseModel` | 逐条 Evidence 的身份落库（M6C 新列，nullable） |
| `Evidence.model / modelVersion`（legacy） | 保留兼容：`model = responseModel ?? requestedModel`；新代码优先读新字段 |

Mock/Fake 也支持：MockProvider 身份恒为 `geolens-mock`（请求与响应同源）；DeepSeek
fake 测试可构造 requested ≠ response。

## 3. 历史数据迁移策略（不猜历史）

- `requestedModel`：历史行只在能从**不可变 rawPrompt JSON**（`{"model":...,...}`，
  DeepSeek 请求体原样保存）中证明实际发送模型时回填；否则保持 `NULL`。
- `responseModel`：历史行只在 `metadata.rawProviderPayload.model == Evidence.model`
  （Provider 回显，可证明）时回填；mock 行按代码常量回填。
- 回填在迁移 SQL 内临时 `DISABLE TRIGGER evidence_immutable` 受控执行并立即恢复；
  绝不用“今天 Engine 配置”猜历史请求模型。
- 旧数据 UI 展示：请求模型 →「历史记录未保存」；响应模型 →「未知」（带说明 tooltip：
  该记录创建于模型身份字段引入之前）。

## 4. legacy model 字段处理（Phase 1 安全兼容）

`Evidence.model / modelVersion` 本轮**保留**，注释标记 `@deprecated legacy`；
`Model Identity API` 返回 requestedModel/responseModel + 保留 legacy 字段供旧消费者。
**legacy model field cleanup** 留到后续 migration/refactor（DEVELOPMENT_LOG 已记录 TODO），
本轮不做 destructive migration。

## 5. BenchmarkReport（快照语义）

`packages/database/prisma/schema.prisma` 新增 `BenchmarkReport`：

```
projectId / benchmarkRunId（FK）
runType · suiteName · suiteVersion        // 测试集快照
provider · engineKey · engineName         // 引擎快照
requestedModel · responseModel            // 模型身份快照（生成时从该 Run Evidence 聚合）
metricSource                              // demo | real | mixed（生成时判定）
analysisVersion                           // 显式选择并冻结（绝不默认漂移）
competitorSetId(Name/Version)             // Competitor Set 快照（nullable；id 非 FK 归档语义）
completedRuns · succeededRuns · failedRuns · analyzedRuns · partial
metricsSnapshot (Json) · metadata · generatedAt · createdAt
```

**Report = snapshot**：生成后 BenchmarkQuery 被编辑、Competitor Set 更新到 v2、
出现新的 Analysis version，都**不会改变历史报告**。

## 6. metricsSnapshot

冻结 geolens-v1 聚合结果（不重造指标）：
`overall`（Visibility / Recommendation / Avg Mention Position / SoV / Citation Count /
Citation Domain Count / Sentiment Distribution）+ `byCategory` + `byQuery`；
M6B 竞对分析就绪时（analysisVersion=m6b-competitors-v1）追加
`competitor { competitorSet, competitors[mentionCount/evidenceCount/shareOfVoice], note }`。

## 7. Analysis Version 与 Competitor Set 绑定

- 生成必须**显式选择 analysisVersion**；不填时按确定性规则：优先
  `m6b-competitors-v1`（若该 Run 有对应分析），否则 `m4-rule-v1`；版本不存在 → 400。
- Competitor Set：仅当所选版本分析行带唯一 competitorSetId 时快照；多个 → 400 需显式。
- 同一 BenchmarkRun 可生成多份报告（m4 / m6b 各一份），**绝不覆盖旧报告**。

## 8. 报告生成资格

- 必须已完成（终态：SUCCEEDED / FAILED / PARTIAL / CANCELLED）；运行中 → 400。
- PARTIAL：允许生成，`partial=true`，UI 显著标注「部分完成」，保留成功/失败样本分母；
  全失败（0 成功）也允许出报告（保留失败分母）。
- Demo/Real 强隔离：顶部显示「数据类型：演示/真实/混合」；mixed 只把真实子集计入
  Real Benchmark；Demo 报告绝不伪装真实结论。

## 9. API

| 方法 | 路径 | 语义 |
|------|------|------|
| POST | `/benchmark-runs/:id/reports` | 生成不可变快照（不覆盖） |
| GET | `/projects/:projectId/reports` | 报告列表（最新优先） |
| GET | `/reports/:id` | 报告详情（含 metricsSnapshot） |
| GET | `/reports/:id/evidence` | Report→Run→Evidence 回链行 |
| POST | `/reports/compare` | 可比性判定 + Δ |

## 10. Comparison Compatibility Rules

先比较维度再给 Δ：
- **hard**：suiteVersion、metricSource、provider、analysisVersion、competitorSetVersion
- **soft**：requestedModel / responseModel（未知 null vs 值 → 部分可比降级）
- verdict：`COMPARABLE`（全一致）/ `PARTIALLY_COMPARABLE` / `NOT_COMPARABLE`
- 任意 non-comparable 都给中文警告「比较口径不同，结果仅供参考 —— 不要无警告解读 Δ」；
  null 指标 → Δ=null（不 NaN）。

## 11. 报告 UI（中文）

- `/app/reports`：报告列表（测试集/报告时间/数据类型/模型服务/请求模型/响应模型/
  品牌可见率/状态）
- `/app/reports/:id`：报告头 → 核心指标 → 按场景 → 竞品表现（如有）→ 问题级结果
  （可下钻 Query→Run→Evidence→Analysis）→ 证据说明
- `/app/reports/compare`：选 A/B → 可比性 → A/B/Δ（总体 + 按场景）
- `/app/benchmark`：已完成 Run 下方「生成 GEO 基准测试报告」（analysisVersion 显式选）
- Evidence 弹窗展示 请求模型/响应模型（legacy 提示），技术字段「中文（raw）」并列。

## 12. 测试与验收

- Model identity：llm 22（含 requested≠response fake）、worker 24、API e2e 82
  （新增 reports 17：资格守卫/PARTIAL/快照/不覆盖/回链/Demo-Real/legacy 不伪造/
  immutable/compare 各维度/隔离/401）。
- 回归：geo-core 64、queue 15、API e2e 82、worker 24、web tsc + next build PASS、
  check-ui-zh PASS（17 文件）。
- 真机 Demo（geo_dev，新 dist + 临时 Worker）：现场 Demo Run 24/24 →
  生成 m4 报告 ×2（多快照不覆盖）→ 详情（可见率/byCategory 6/byQuery 24）→
  Evidence 回链 24 行 → Compare（COMPARABLE）→ 全程 0 次真实 DeepSeek。
- M6D（Second Provider）留待下一步，对比 API 已为其预留跨口径能力。
