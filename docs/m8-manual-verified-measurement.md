# M8C Readiness Patch — Manual Verified Measurement（人工 Web UI 测量通道）

> GeoLens · M8C-R0 · 2026-09-07
> 状态：manualVerifiedMeasurement=DONE；realPilotReadiness=WAITING_FOR_REAL_BASELINE
> 0 real AI calls · 0 external writes · migration additive

## Why this exists

M8/M8A 曾判定：DeepSeek / Qwen 官方 API 均为 `official_api / api_plain` —— 普通模型 API
**不等价于**模型产品的 Web Search / Web Retrieval，不能把「改了公开网页」与「api_plain 输出
变化」直接当作网页 GEO 实验结论。因此 GeoLens 唯一严谨的 Web GEO Measurement fallback 是：

> 用户在官方 AI Web 产品（Qwen / DeepSeek Web）中实际执行 Query，
> 由用户确认「是否联网检索」后把完整回答人工录入 GeoLens。

此前 `manual_verified` 只存在于数据模型与测量判定引擎（geo-core measurement.ts 识别该值、
Evidence 枚举含 `manual/manual_verified`），**没有任何产品录入通道** —— 用户无法真正使用。
M8C-R0 补齐的就是这条通道：把「数据模型里支持」变成「用户真的可以使用」。

## api_plain limitation（背景）

- DeepSeek provider：`sourceType=official_api / retrievalMode=api_plain`
- Qwen provider：`sourceType=official_api / retrievalMode=api_plain`
- 两者只能做模型行为观察；对「公开网页内容变化」判定为 `INVALID_FOR_WEB_CHANGE`。

## Manual measurement architecture

**不建立第二套平行 Evidence/Session 系统。** 人工测量完整复用现有链路：

```
BenchmarkSuite（Query Set）
  → BenchmarkRun（runType=REAL|DEMO，executionMode=MANUAL_WEB_UI）
    → MonitorTask
      → Run（status=AWAITING_MANUAL_INPUT，engine=manual-web-ui）
        → Evidence（sourceType=manual，retrievalMode=manual_verified|unknown）
          → Analysis（analyzeResponse，与分析 automated 同一规则）
            → Metrics（DISCOVERY-only denominator）
              → BenchmarkReport
                → Diagnosis → Recommendation → Content Opportunity（M7 全链可用）
```

## Evidence provenance（人工溯源）

Evidence.metadata（Json）承载全部人工溯源字段：

- `generatedBy: m8c0-manual-measurement-v1`
- `measurementProduct`：qwen-web / deepseek-web / custom-web（**不是** qwen-api / deepseek-api）
- `displayedModel`：AI Web UI 显示的模型名（无法确认则空，绝不猜测）
- `verifiedByUserId` / `verifiedAt`：录入者与时间
- `verificationSignals` / `verificationNotes`：确认联网的依据与说明
- `retrievalConfirmed`：布尔
- `observedAt`：实际查询时间（非 DB createdAt）
- `structuredCitations`：用户可见引用 URL（Analysis 仍自行做 citation 规范化）
- `demo: true`：演示数据标记（不伪装真实测量）

## Verification rules

| retrievalConfirmed | verificationSignals | retrievalMode |
|---|---|---|
| true | 任意 | `manual_verified` |
| false / 未填 | — | `unknown`（绝不自动 VALID） |

判定只依 retrievalMode/sourceType，不按 provider 名猜。UI 无法确认时显示黄色提示：
「该回答可以用于模型行为观察，但不能作为网页内容变更验证证据。」

## Query snapshots / Target snapshots

- Target Snapshot：创建 Manual BenchmarkRun 时冻结 primary Brand（canonicalName / aliases /
  entityType / productCategory / website）→ `BenchmarkRun.targetSnapshot`。
- Query Snapshot：复制每个启用 Query 的 queryText / category / intent / locale / weight /
  sortOrder / sanity / queryType / contamination → `BenchmarkRunQuery`。
- Query Type 仍遵守 M8E：DISCOVERY / BRANDED_SANITY / CUSTOM；DISCOVERY 且污染非 CLEAN
  不用于 core GEO measurement（guard 在 suite/batch 层已拒绝含品牌 DISCOVERY）。
- Fingerprint：runQueries 行序稳定 → 复用 BenchmarkRun 快照语义即可追溯。

## No provider execution（安全核心）

Manual run 初始 `status=AWAITING_MANUAL_INPUT`（新增 RunStatus 值）：

- worker `dispatchPendingRuns` 只捞 `PENDING/QUEUED` → manual run **永不入 BullMQ**；
- worker `reconcileRuns` 捞 `RUNNING/QUEUED/PENDING` → 同样不触碰；
- `claimRun` 只由 job 触发 → manual run 无 job；
- 双保险：engine `manual-web-ui` 的 `provider='manual'` 不在 worker provider registry，
  即使被误入队也 resolve 失败 → `UNSUPPORTED_PROVIDER`，绝不调用任何真实 Provider。

用户提交 Evidence 后 run 收敛为 `SUCCEEDED`（本地 analyze，analysisStatus=SUCCEEDED）；
跳过则为 `SKIPPED`（SKIPPED ≠ 品牌未出现，M7D 语义）。全部提交/跳过后 MonitorTask 收敛
`SUCCEEDED / PARTIAL`，进入 Report 资格判定（TERMINAL_TASK）。

## Metrics reuse

- 无 `manualMetricsService`。人工 Evidence 进入标准 `benchmark.getMetrics`。
- DISCOVERY-only denominator（M8E scope 逻辑）不区分采集方式。
- `metricSource`：real manual（真实人工观测）→ `REAL`；demo manual（metadata.demo=true +
  runType=DEMO）→ `demo` —— REAL 表示真实观测，manual 表示采集方式，二者不混淆。
- getMetrics 的 realRows 判定扩展：`engineProvider==='manual'` 且 `runType=DEMO` 的 run
  归 demo 侧（demo manual 不伪装 real）。

## Report integration

Manual Benchmark 完成后直接 `POST /benchmark-runs/:id/reports` → 复用 ReportsService 生成
不可变 BenchmarkReport（无采集方式分支），可继续走 Diagnosis → Recommendation → Opportunity。

## Measurement validity

接入既有 `geolens-measurement-v1`：

- Evidence `manual_verified`（confirmed + signals）→ `VALID_FOR_WEB_CHANGE`
- Evidence `unknown`（retrievalConfirmed=false）→ `INVALID/UNKNOWN`
- demo manual 不能伪装 real（runType=DEMO → metricSource=demo）

## Security

- 不保存 AI Web UI Cookie / Session Token / 账号密码 / Authorization header —— 用户只粘贴
  公开回答内容。
- Anti-tampering：只能给 `executionMode=MANUAL_WEB_UI` 且尚无 Evidence 的 Run 提交；
  automated run 禁止人工覆盖（400）；重复提交 409；Evidence immutable（DB trigger，禁 UPDATE）。
- AuthGuard + Tenant scope + Project ownership：跨 tenant 404、未认证 401。
- 无 SSRF（不抓任何页面，纯人工粘贴）；无自动浏览器操作。

## Pilot usage（真实试点如何用）

1. 用户在 Query Set 详情点「人工 Web UI 检测」→ 选 AI 产品（Qwen/DeepSeek Web）→ 创建。
2. 打开 /app/manual-runs/:id 工作区，逐条复制 Query → 在官方 AI Web UI 新开会话原样发送
   （不添加品牌名）→ 粘贴完整回答 → 确认联网检索 → 提交。
3. GeoLens 自动完成 Analysis → 全部提交后生成 Metrics / Report → M7 链继续。
4. 只有 `metricSource=real + sourceType=manual + retrievalMode=manual_verified +
   DISCOVERY CLEAN` 的证据才可作为 M8C Real Pilot 的真实基线。
5. REAL_BASELINE 尚未执行：等待用户在官方 AI Web UI 完成第一组真实 Discovery Query。

## Limitations

- 人工录入依赖用户真实操作官方 AI Web UI；retrieval 判定依赖用户诚实确认。
- 不能证明模型「必然」读取了修改后的页面（changed asset retrieval 仍为观察级）。
- manual_verified 不构成严格因果证明；attribution 仍 LOW/MEDIUM。
- Demo 数据永远标记 demo（metadata.demo=true），绝不冒充真实测量。
