# LLM Providers（M5：Real LLM Provider Integration — DeepSeek V1）

> 状态：M5 已实现（2026-09-05）。`packages/llm`（@geo/llm）提供统一 Provider 抽象；
> 首个真实 Provider 为 **DeepSeek 官方 API**。真实调用默认关闭，必须先通过
> 【DeepSeek Real API Smoke Test Ready】暂停点并获用户批准。
> 本文件描述 Provider 架构、DeepSeek V1 配置、sourceType/retrievalMode、
> 错误映射、Timeout、Retry、Cost safety、Mock vs Real、真实 Smoke Test 方法。

## 1. Provider Architecture

```
Engine.provider ──► LLMProviderRegistry.resolve() ──► LLMProvider.execute(ProviderRequest)
                                                        │
                      ┌─────────────────────────────────┴──────────────────────────┐
                      │ MockProvider                     DeepSeekProvider            │
                      │ 本地仿真（scenario/delay/         官方 Chat Completions API    │
                      │ failure），无网络无凭据             fetch + AbortController      │
                      │ sourceType=mock                  sourceType=official_api      │
                      │ retrievalMode=unknown            retrievalMode=api_plain      │
                      └─────────────────────────────────┬──────────────────────────┘
                                                        ▼
                                              ProviderResponse
                                                        ▼
  Worker（apps/worker/src/processor.ts）：不关心任何 Provider HTTP 细节，只
     resolve → execute() → settleRun(persist Evidence) → analyzeEvidence(@geo/core)
```

- **Worker 不直接 fetch 任何模型 API**：只消费 `ProviderRequest` / `ProviderResponse`。
- 新增 Provider（M6: Qwen/Kimi/…）＝实现 `LLMProvider` + `registry.register()` +
  `@geo/queue` 的 `runResultSchema.provider` union 扩一个成员，**不重写 Worker**。
- 实体契约集中在 `packages/llm/src/types.ts`：`ProviderRequest` 至少含
  queryText/engineKey/engineName/engineConfig/attempt/timeoutMs/entities；
  `ProviderResponse` 至少含 provider/model/modelVersion/content/rawPrompt/
  rawProviderPayload/usage/citations/finishReason/requestId/durationMs/sourceType/retrievalMode。

## 2. DeepSeek V1（DeepSeek 官方 API，非 DeepSeek Search）

- HTTP：`POST {baseUrl}/chat/completions`（OpenAI 兼容格式），标准 `fetch`，
  **不引入重型 SDK**。
- 请求体：`{ model, messages, stream:false, temperature?, max_tokens? }`；
  messages 默认 `[{role:'user',content:queryText}]`，Engine.config 可加
  `systemPrompt/temperature/maxTokens/model` 覆盖。
- 模型解析优先级：`Engine.config.model` → `DEEPSEEK_MODEL` → `deepseek-chat`。
- `modelVersion` 取响应 `payload.model`（服务端实际模型）；API 未返回则为 `null`。
- **这是 DeepSeek API 不是联网搜索产品**：Evidence 固定
  `sourceType=official_api`、`retrievalMode=api_plain`；UI 文案用「DeepSeek API Response」，
  不写「搜索收录 / 联网引用结果」。未来若接入官方联网搜索再评估 `api_web_search`。

## 3. 环境变量（server-side only）

| 变量 | 默认 | 说明 |
|---|---|---|
| `ENABLE_REAL_PROVIDERS` | `false` | 真实付费 Provider 总开关；仅 `true` 放行 |
| `DEEPSEEK_API_KEY` | 无（必填） | **不提供默认值**；绝不入库/入 Evidence/入 UI/入日志 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | 可覆盖（测试指向本地 Fake server） |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 请求模型 |
| `DEEPSEEK_TIMEOUT_MS` | `60000` | Provider 单请求超时（5s–120s） |
| `REAL_PROVIDER_TIMEOUT_MS` | `60000` | Worker 侧真实 Provider 请求预算 |
| `REAL_PROVIDER_MAX_RUNS_PER_TASK` | `3` | 单 MonitorTask 真实 Run 上限（Cost safety） |

- `.env` 已被 .gitignore 忽略；`.env.example` 只放空占位。
- 浏览器/API 永不接触 Key：Engine 列表只返回 `configured: boolean`。

## 4. Secret 保护

- Key 只在 Worker 进程 env → 请求 `Authorization: Bearer`，**不进入**：
  Evidence（含 metadata）、`rawProviderPayload`、`Engine.config`、API 响应、日志、Git。
- `rawProviderPayload` 只保存脱敏 JSON（id/object/created/model/system_fingerprint/
  finish_reason/role/usage），剥离 `message.content`（已存 rawResponse）且**无任何 header**。
- Provider 错误消息为固定文案，不回显 Key / 响应原文。
- 单测断言：`JSON.stringify(ProviderResponse)` 与错误消息不含 Key / `Authorization`。

## 5. Error Model & Retry 分类

错误类型（`packages/llm/src/errors.ts`，`LLMProviderError` + `kind`）：

| kind | HTTP/场景 | Worker 行为（errorCode / 是否重试） |
|---|---|---|
| `auth` | 401/403 | `PROVIDER_AUTH`，**永久 FAILED**（单次 attempt，不烧重试） |
| `rate_limit` | 429 | `PROVIDER_RATE_LIMIT`，可重试（交 BullMQ backoff） |
| `server` | 5xx | `PROVIDER_SERVER`，可重试 |
| `network` | fetch TypeError / 连接失败 | `PROVIDER_NETWORK`，可重试 |
| `timeout` | AbortController 超时 | `PROVIDER_TIMEOUT`，可重试 |
| `bad_request` | 400 等 4xx | `PROVIDER_BAD_REQUEST`，永久 |
| `disabled` | ENABLE_REAL_PROVIDERS≠true | `PROVIDER_DISABLED`，永久（Cost-safety 兜底） |
| `not_configured` | 无 API Key | `PROVIDER_NOT_CONFIGURED`，永久 |
| `empty_response` | choices 空 / content 空白 | `PROVIDER_EMPTY_RESPONSE`，永久 |
| `invalid_response` | 非 JSON / 结构不符 | `PROVIDER_INVALID_RESPONSE`，永久 |
| `invalid_config` | Engine.config 非法 | mock: `INVALID_ENGINE_CONFIG`；real: `PROVIDER_CONFIG` |

- **Provider 内不重试**：只分类。主重试走 BullMQ（attempts=3，exponential 500ms）。
- Run 落到现有状态机：可重试 → QUEUED + job 重投；永久 → FAILED + `UnrecoverableError`。
- 用户可见 `errorMessage` 不含 secret。

## 6. Timeout & Response Validation

- `DeepSeekProvider.execute` 内 `AbortController` + `DEEPSEEK_TIMEOUT_MS`（默认 60s），
  超时 → `timeout` 可重试；**不会让 BullMQ job 永久 RUNNING**。
- Worker runtime：mock 用 `WORKER_TIMEOUT_MS`（3000），真实 Provider 用
  `REAL_PROVIDER_TIMEOUT_MS`（60000）；BullMQ lock 自动续期兼容长请求。
- Response 结构校验：非 JSON / choices 非数组 / message.content 缺失或空白 →
  相应永久错误；**绝不保存 undefined 后把 Run 标 SUCCEEDED**。
- usage 解析：`prompt_tokens/completion_tokens/total_tokens` 三值齐全才保存
  `{promptTokens,completionTokens,totalTokens}`（无价格换算，不显示 ¥）。

## 7. Evidence 与不可变原则（与 Mock 完全一致）

- 成功即写 1 条 Evidence：`runId` unique + settleRun fencing 同事务；
  DB trigger 拒绝 UPDATE —— DeepSeek Evidence 同样不可变。
- Evidence 字段：provider=`deepseek`、sourceType=`official_api`、
  retrievalMode=`api_plain`、model/modelVersion、metadata{usage, requestId,
  finishReason, structuredCitations, rawProviderPayload, durationMs}。
- rawResponse=模型回答正文；rawPrompt=实际发送的 model+messages JSON。
- 分析复用 **@geo/core Analyzer（m4-rule-v1）**，无 `if provider===deepseek` 特判解析。
- Citation：DeepSeek chat API 不返回结构化引用 → 不伪造；正文 URL 走 M4 fallback
  URL 提取。UI 用 `metadata.structuredCitations` 长度区分
  「Provider 结构化引用」与「正文 URL 提取」。

## 8. Cost Safety

- 默认 `ENABLE_REAL_PROVIDERS=false`；显式 `true` 才允许真实调用。
- API 创建任务时校验并**明确拒绝**（不 silent truncate）：
  - 真实 Provider 未配置/未启用 → 400「…DeepSeek Provider 未配置或未启用…」；
  - `realRuns(=Query数×真实Engine数) > REAL_PROVIDER_MAX_RUNS_PER_TASK` → 400 说明上限。
- Worker 侧兜底：flag 关闭/无 Key → 对应永久错误 FAILED。
- 健康/展示：Engine 列表 `configured` 只代表「配置完整」，**不代表 API 可达**；
  真实连通性只通过用户触发的 Smoke Test 验证。

## 9. Mock vs Real（UI 与 Metrics）

- Engine 选择：Mock 徽标「Mock / Demo」；DeepSeek API 徽标
  「REAL · Official API」/「REAL · 未配置（禁用选择）」。
- Evidence Drawer：Official API（蓝）vs Mock / Demo（琥珀）徽标；
  展示 Provider / Engine / Model / Source Type / Retrieval Mode / Token 用量。
- Metrics 数据完整性：`/monitor-tasks/:id/metrics` 返回 `metricSource`：
  - `demo`（全 mock）、`real`（全真实）、`mixed`（混选，**指标只基于真实子集**）；
  Demo 数据永不污染真实 GEO 指标。

## 10. 真实 Smoke Test 方法（仅批准后执行）

1. `.env` 配 `ENABLE_REAL_PROVIDERS=true` + `DEEPSEEK_API_KEY`（真实 Key）。
2. 第一轮：**1 Query × 1 DeepSeek Engine = 1 Run**，用无争议简单问题
   （如「请简要介绍生成式人工智能是什么。」）验证 Auth/HTTP/Response/Evidence/Analysis/DB/UI 全通。
3. 第二轮（第一轮成功且获准后，最多 3 Query × 1 DeepSeek Engine）：
   Demo Project（ProjectMentor）GEO 问题，观察真实模型是否 mention/recommend/cite；
   未提到品牌也是有效 GEO 数据，**绝不篡改结果**。
4. 完成后记录 Run ID / Evidence / Analysis / Metrics / Token usage（不进 Git Key）。

## 11. 已知限制与技术债（M5）

- Engine.key 全局唯一、无 Organization ownership（M4 债务，M5 不解决）；未来多租户
  BYOK 引入 ProviderCredential / OrganizationEngine。
- 单全局 Key，无 per-org 隔离 / Vault；付费 API 有 cap 但无月度额度账单。
- Citation provenance 未加 schema 字段（用 metadata 区分来源）；DeepSeek 无结构化引用。
- 只实现 DeepSeek；M6 候选：OpenAI-compatible 泛化 / Qwen / Kimi（按用户批准推进）。
