# WORKBUDDY M5 接管审计与实施计划（DeepSeek Provider V1）

> 基线：`fc1e909`（M4 完成）｜工作区 clean｜branch master
> 审计方式：只读。已核对 docs/ARCHITECTURE、DATABASE、EVIDENCE、GEO_METRICS、QUEUE、DEVELOPMENT_LOG、DECISIONS 与 packages/queue、packages/geo-core、packages/database、apps/worker、apps/api、apps/web 关键源码。

## 1. 八个审计问题

### Q1 当前 Provider abstraction 在哪里？
**没有正式抽象。** `apps/worker/src/processor.ts` 硬编码：

```ts
if (run.engine.provider !== 'mock') throw new ExecutionError('UNSUPPORTED_PROVIDER');
result = await executeMock({ ... });
```

`executeMock` 也在 processor.ts（本地仿真，无网络）。`apps/worker/src/evidence.ts::evidenceData` 硬编码 `provider:'mock' / model:'geolens-mock' / sourceType:'mock' / retrievalMode:'unknown'`。`packages/queue` 的 `runResultSchema` 硬编码 `provider: z.literal('mock')`。引擎选择：`apps/api/src/monitor-tasks/monitor-tasks.service.ts` options/create 均过滤 `provider:'mock'`。

### Q2 Mock Provider 如何选择？
靠 `Engine.provider === 'mock'` 列值 + processor 内 `if` 分支；无注册表、无统一接口。`Engine.config`（Json）驱动延迟/失败/场景：
`{ delayMs, failuresBeforeSuccess, permanentFailure, scenario }`；`evidenceData` 还读 `config.citations` 作为 structured citations。

### Q3 Engine.config 当前存什么？
仅 Mock 执行参数（见 Q2）+ 演示引擎 scenario。**不含** model/temperature/provider —— 这些未来字段可直接放进同一 Json，无需 migration（Engine.config 是自由 Json 列）。

### Q4 DeepSeek Provider 放哪个 package？
**新建 `packages/llm`（@geo/llm）** —— ARCHITECTURE.md 分层表早已预留该包。放置：LLMProvider 接口、ProviderRequest/ProviderResponse、错误模型与分类、ProviderRegistry、MockProvider（自 worker 迁移语义）、DeepSeekProvider、环境配置读取与 real-provider guards。worker/api 仅依赖 @geo/llm，永不直接 fetch 模型 API。

### Q5 不修改 M4 Evidence 契约接入真实 Provider？
可行，**零 schema 改动**：Evidence 的 `provider/model/modelVersion/sourceType/retrievalMode/metadata` 全部现成；`sourceType` 枚举已含 `official_api`；`retrievalMode` 已含 `api_plain`。只改 Worker 内部：processor 经 registry 解析 provider → ProviderResponse → 同一 `evidenceData` 路径写 Evidence → 同一 `analyzeEvidence` 跑 @geo/core Analyzer（**不写 provider 特判解析**）。不可变 trigger / runId unique / fencing 语义对 DeepSeek Evidence 同等生效。

### Q6 API Key 安全管理？
- 只存在 **server-side environment（Worker 进程）**，不进 DB / Engine.config / Evidence.metadata / API 响应 / UI / 日志。
- `.env` 已 ignored；`.env.example` 只给空占位。
- Provider 层错误消息与 metadata 构造时剥离 header/secret；raw provider payload 只取响应 JSON body 的脱敏字段。
- 浏览器永远接触不到 key（Engine 列表只回 configured 布尔）。

### Q7 Engine 是否需要 Organization ownership？
**M5 不做**。Engine.key 全局唯一、无 org 归属是 M4 技术债；当前 API Key 是全局开发环境配置，不影响单用户 Prototype。记录为债务（见 DECISIONS 追加），未来多租户 BYOK 再引入 ProviderCredential / OrganizationEngine。不因此扩大 M5 范围。

### Q8 是否需要 migration？
**不需要。** Evidence/Analysis/Mention/Citation schema（M4）+ SourceType/RetrievalMode 枚举已覆盖 DeepSeek V1 需求；model/usage 走 Evidence.model/modelVersion/metadata；Run.errorCode/errorMessage 走现成列。若未来要区分 structured citation provenance（§19）再加最小字段并先 geo_test。

## 2. 核心设计

```
Engine.provider ──► ProviderRegistry.resolve() ──► LLMProvider.execute(ProviderRequest)
                                                        │
                                  MockProvider（scenario/delay/failure 语义自 worker 迁移）
                                  DeepSeekProvider（fetch + AbortController + 分类，transport 可注入）
                                                        ▼
                                             ProviderResponse
                                                        ▼
                       worker: evidenceData → Evidence（sourceType/retrievalMode/model/usage/metadata）
                                                        ▼
                       worker: analyzeEvidence → @geo/core Analyzer（不特判 provider）→ Analysis/Metrics
```

- **错误模型**：`LLMProviderError` + kind ∈ {invalid_config, mock_failure, timeout, rate_limit, server, network, auth, bad_request, disabled, not_configured, empty_response, invalid_response}；可重试（timeout/rate_limit/server/network/mock_failure）交回 BullMQ；永久（auth/bad_request/disabled/not_configured/empty/invalid/invalid_config）→ 直接 FAILED + UnrecoverableError。
- **Worker 超时**：mock 沿用 WORKER_TIMEOUT_MS（默认 3000）；真实 Provider 用 REAL_PROVIDER_TIMEOUT_MS（默认 60000，上限 120000），DeepSeekProvider 内部 AbortController 兜底。
- **Cost safety**：`ENABLE_REAL_PROVIDERS=false` 默认；`REAL_PROVIDER_MAX_RUNS_PER_TASK=3` 默认，API create 超限直接 400 拒绝（不 silent truncate）；Worker 侧 provider 未启用 → PROVIDER_DISABLED 永久失败兜底。
- **sourceType/retrievalMode**：deepseek → `official_api` / `api_plain`（UI 文案「DeepSeek API Response」，不写「搜索收录/联网引用」）。
- **Metrics 不污染**：metrics API 检测 task 内 engine provider：全 mock → `demo`；全 real → `real`；mixed → 只基于 real runs 计算 + `metricSource:'mixed'` 标注。

## 3. 实施顺序（Goal mode）

1. packages/llm：types/errors/config/registry + MockProvider + DeepSeekProvider + 单元测试（含 fake fetch）。
2. queue：runResultSchema provider 放宽（mock|deepseek）。
3. worker：processor 注册表解析 + 错误映射 + evidenceData 接收 ProviderResponse；runtime 读 real timeout。
4. api：options 返回 provider/configured/sourceType/model；create guards；metrics metricSource。
5. web：Engine REAL/未配置 UI、Evidence Drawer Official API 徽标 + usage、Metrics 数据源标签。
6. seed-engine-deepseek.ts（幂等，geo_dev）。
7. Fake DeepSeek HTTP 集成测试（真 DB/Redis/processor）+ API e2e。
8. 回归矩阵 + acceptance + build + health + docs。
9. **暂停点**：输出【DeepSeek Real API Smoke Test Ready】等待批准，才发真实请求。

## 4. 禁止 / 边界

- 不接 Qwen/Kimi/Doubao/OpenAI/Claude/Gemini；不把 DeepSeek API 当 DeepSeek Search；不做 Provider 内无限重试；不伪造 citation；不保存/打印 secret；不改 Evidence 不可变 trigger；不碰 M4/M3 已验证语义。
