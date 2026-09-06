# M6D — Second Provider（Qwen）+ Multi-Provider Comparison 设计文档

> 里程碑：M6D（Second Provider + Multi-Provider Comparison）
> 数据权威定义：`packages/llm/src/qwen.ts` + `apps/api/src/reports/`
> 文档版本：v1（2026-09-06）· 状态：IMPLEMENTATION_DONE / REAL_SMOKE_PENDING

---

## 1. Provider Abstraction（审计结论：可复用）

M6D 前审计确认统一抽象已足够支撑第二 Provider：
`ProviderKind` union + `LLMProviderRegistry` + `ProviderRequest`（含
requestedModel）/`ProviderResponse`（含 requestedModel/responseModel）→ Worker 只依赖
接口。DeepSeek 代码**未被复制改名**：Qwen Adapter 独立实现同一接口（OpenAI-compatible
协议由其自身 HTTP 层承载），Registry 增加一条注册。

## 2. Qwen（通义千问）Adapter 语义

- 官方模型 API（DashScope OpenAI-compatible mode），默认
  `QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`、
  `QWEN_MODEL=qwen-plus`、`QWEN_TIMEOUT_MS`。
- **总开关仍是 `ENABLE_REAL_PROVIDERS`**（与 DeepSeek 同一开关）；未开或
  `QWEN_API_KEY` 缺失 → ProviderDisabled / ProviderNotConfigured。
- Model Identity 延续 M6C：`requestedModel` 以 Worker 注入为准（enginePresentation），
  `responseModel` = API 回显 model（如 qwen-plus-latest），不回显则 `null`，
  绝不拿 requested 冒充 response。
- Evidence：sourceType=**official_api**、retrievalMode=**api_plain**（官方模型 API，
  非 Web Search 产品 —— 禁止把“可联网产品”标成 web search）；provenance 含 provider /
  engine / requestedModel / responseModel / rawPrompt / rawResponse / usage / 时间戳。
- 不做官方 Web UI / 浏览器自动化 / 假 Web Search（以后独立 milestone）。

## 3. Provider Error Model（复用，不新建第二套）

Qwen 映射与 DeepSeek 完全同一套 `LLMProviderError` 分类：
401/403 → `auth`（永久）；429 → `rate_limit`（可重试）；5xx → `server`（可重试）；
timeout → `timeout`；network → `network`；invalid JSON/结构 → `invalid_response`
（永久）；空输出 → `empty_response`。Worker 的重试/永久策略无需改动。

## 4. Engine 配置与 seed

新增 `qwen-api` Engine（displayName 通义千问 Qwen API，provider=qwen）——
`packages/database/scripts/seed-engine-qwen.ts` 幂等 upsert；不破坏 mock/deepseek 旧行。
API `enginePresentation('qwen')` 只回 `configured` 布尔；Key 仅服务端 env。

## 5. Multi-Provider Benchmark（Run 分离）

保持 **Run = 1 Provider**：同一 Suite 分别 DeepSeek / Qwen 运行（Benchmark Run A/B），
provenance 最清晰；由 Report Comparison 做 A vs B。UI/规划信息明示「N 问题 × Provider」；
真实 Multi-Provider 计划与费用（N×M real calls）在界面上明示 + guard 拒绝，绝不
“点一下背后偷偷发 N×M 个付费请求”。`startRun` 允许 real provider = {deepseek, qwen}，
未配置即 400（中文），超过 `REAL_PROVIDER_MAX_RUNS_PER_TASK` → 400 且明示计划真实
调用数（错误文案：计划执行 N 次真实模型调用，超过当前安全上限）；不自动拆批绕过。

## 6. Cross-Provider Comparison（PARTIALLY_COMPARABLE）

M6C 的 compatibility 升级为 M6D 语义：

- **hard**（任一失配 → NOT_COMPARABLE）：suiteVersion、metricSource、analysisVersion、
  competitorSetVersion
- **provider 不同但其余 hard 一致 → PARTIALLY_COMPARABLE**（不是 NOT）：跨模型比较是
  GEO 核心价值；UI 说明「测试问题、分析规则和竞品口径一致，但模型服务不同，因此结果
  用于比较不同 AI 引擎的品牌表现」
- **soft**：requested/responseModel（未知 vs 值降级）
- 全部一致 → COMPARABLE

对比展示：Provider A/B、Requested/Response Model A/B、Benchmark Suite + Version、
Analysis Version、Competitor Set Version、Metric Source。

## 7. 指标与 denominator

对比至少展示：品牌可见率 / 推荐率 / 平均提及位置 / AI 声量份额 / 引用次数 /
引用域名数；按场景 A/B/Δ。**率用百分点 pp**（25%→35% 显示 +10pp，不是 +40%）。
Failed run 不进 successful denominator；对比页展示成功样本（如 DeepSeek 24/24 ·
Qwen 23/24）；样本数不同给出「样本完整性不同，比较需谨慎」警告；部分可比时绝不做
“无警告 +12%”。

## 8. Provider Matrix 与 Evidence A/B

- Benchmark / Reports 对比页提供基础矩阵（第一版不做复杂图表）：行=场景分类，
  列=A/B Provider 的品牌可见率与推荐率 + Δ。
- **Evidence A/B**：同一 suite 的 queryText 对齐，Compare 页每个测试问题给出两个
  Provider 的「查看原始回答」（Report→Run→Evidence），回答“为什么 A 推荐了品牌而 B
  没有”。

## 9. Security

- Key 只读标准 Server env（QWEN_API_KEY/DEEPSEEK_API_KEY）；禁止扫描文件、shell
  history、其他项目 .env、浏览器。
- Key 不进 DB/UI/Evidence/日志/Git/.runtime；status snapshot 只写
  qwenConfigured:true/false。
- rawProviderPayload 不含请求 Authorization 头与任何 secret（含单测扫描）。

## 10. Real Smoke 策略

- 开发顺序：unit → fake → worker integration → evidence → analysis → benchmark →
  report → comparison 全过。
- **默认 NO REAL CALL**；QWEN_API_KEY 未配置 → 进入 REAL_SMOKE_PENDING（不失败）。
- 若用户明确授权：先 1 Query×1 Provider 验证（HTTP 200/Evidence/identity/
  sourceType/retrievalMode/Analysis），再最多 3 Query；24 Query 正式 Benchmark 需再次
  单独确认。

## 11. 测试

- llm 35（qwen 13：request/auth header/requestedModel/responseModel/requested≠response/
  null response/timeout/429/500/401/invalid JSON/empty/usage/rawProviderPayload/secret
  不泄）
- worker 31（qwen 7：fake 成功→Run/Evidence/Analysis、official_api/api_plain、身份、
  retryable 500、non-retryable 401、disabled/not_configured、restart 幂等）
- API e2e 88（新增 multi-provider 6：同 suite 双 Provider 报告、PARTIALLY_COMPARABLE +
  口径说明、样本完整性警告、矩阵/证据回链、cost guard 中文、401/404）
- 回归：core 64 / queue 15 / worker 31 / llm 35 / api 88 / web tsc+build / check-ui-zh。
