# Queue & Worker（M3：Redis + BullMQ + 独立 Worker）

> 状态：M3 完成（2026-09-05）。API 只创建任务并入队，耗时 GEO 查询由 `apps/worker` 后台执行。

## 1. 架构

```
Next.js Web ──> NestJS API ──> PostgreSQL        （同步：任务 CRUD）
NestJS API ──> BullMQ ──> Redis ──> apps/worker ──> PostgreSQL（异步：Run 执行）
```

- **PostgreSQL 是 source of truth**：MonitorTask / Run 先落库，Redis 只承载 `{ runId }` 标识。
- **HTTP 永不等待执行**：`POST /monitor-tasks` 提交事务后即返回 202；入队是 fire-and-forget（`kickDispatch`），Redis 短暂不可用不影响 API 响应。

## 2. 队列与包边界

| 层 | 位置 | 职责 |
|---|---|---|
| 契约 | `packages/queue` | QUEUE_NAME / JOB_NAME / payload schema / 状态机聚合 / jobId 规则 |
| 生产者 | `apps/api`（MonitorTasksService） | 创建 task+runs → `dispatchPendingRuns` |
| 消费者 | `apps/worker`（BullMQ Worker） | claim → executeMock → settle；每 2s reconcile+dispatch |
| 存储 | `packages/database` | Engine / MonitorTask / Run schema 与 migration |

- `QUEUE_NAME = monitor-runs`、`JOB_NAME = execute-run`
- **队列前缀按数据库隔离**：`geo-{database}`（`queueOptions` 从 `DATABASE_URL` 推导）→ geo_dev 与 geo_test 互不串扰。
- Redis 连接统一走环境变量：`REDIS_URL`（默认 `redis://127.0.0.1:6379`），host/port 拆分见 compose。
- `runJobSchema = { runId: uuid }`（strict），`runResultSchema = { provider: 'mock', text, durationMs }`。

## 3. 数据模型（PENDING 优先，DB 为事实源）

- **MonitorTask**：`status`（TaskStatus：PENDING/QUEUED/RUNNING/PARTIAL/SUCCEEDED/FAILED/CANCELLED）、`totalRuns/completedRuns/failedRuns`、`startedAt/completedAt`、`metadata`。
- **Run**：`status`（RunStatus：PENDING/QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED）、`attempt`、`executionToken`（fencing，防双执行）、`errorCode/errorMessage`、`result Json?`（Evidence 预留：M4/M5 的 Response 将挂 Run.id，rawPrompt/rawResponse/citations/sentiment 等走独立扩展表，不在 Run 上堆字段）。
- 幂等约束：`@@unique([monitorTaskId, queryId, engineId])`，同一任务不会重复生成同一 Query×Engine 的 Run。

## 4. 状态机

Run：`PENDING → QUEUED → RUNNING → SUCCEEDED | FAILED`
- `PENDING`：已落库，未投递（Redis down / 进程崩溃后待恢复）。
- `QUEUED`：已投递（`markRunQueued`）。
- `RUNNING`：worker `claimRun` 成功（事务置 RUNNING + 写 executionToken + attempt+1）。
- `FAILED`：attempt 耗尽或永久错误（`UnrecoverableError`）。

Task 聚合（`refreshTask`，基于 Run 数据，不信 Redis）：全成 → `SUCCEEDED`；有失败且未全败 → `PARTIAL`；全败 → `FAILED`；进行中 → `RUNNING`；未开始 → `PENDING/QUEUED`。

## 5. Retry / Backoff

- BullMQ job：`attempts = MAX_RUN_ATTEMPTS(3)`、`backoff = exponential 500ms`。
- 错误分类：
  - 可重试（MOCK_FAILURE 且 attempt < MAX）→ settle `QUEUED` + `throw Error` → BullMQ 重投，下次 `claimRun` attempt+1。
  - 永久（attempt ≥ MAX / UnrecoverableError / INVALID_JOB_PAYLOAD）→ settle `FAILED` + `throw UnrecoverableError`，不再重试。
- 真实 Provider（M5）：`packages/llm` 负责错误分类，Worker 映射——
  可重试（429/5xx/timeout/network）→ `QUEUED`；永久（401/403/未配置/未启用/空响应/坏响应）→ 单次 attempt 即 `FAILED`（`PROVIDER_AUTH/PROVIDER_NOT_CONFIGURED/PROVIDER_DISABLED/...`）。详见 docs/LLM_PROVIDERS.md。
- Worker 超时保护：`WORKER_TIMEOUT_MS`（默认 3000，executeMock 可中断）、`WORKER_LOCK_DURATION_MS`(10000)、`WORKER_STALLED_INTERVAL_MS`(5000)、`maxStalledCount=1`。

## 6. 幂等（数据库是唯一事实）

- **jobId 规则**：`jobIdForRun(runId) = run-{runId}` —— 同一 Run 永远对应同一 job；BullMQ 对重复 jobId 在 waiting/active 态均为覆盖更新（已实测），不会产生双 job。
- **claimRun 只允许非终态**：Run 已 SUCCEEDED/FAILED → 返回 null → processor 视作 replay no-op。
- Worker 重启 / Redis retry / duplicate delivery / API enqueue retry 全部收敛到上述两条，不重复执行。

## 7. 可恢复性（PENDING re-enqueue / reconcile）

- API `kickDispatch`：失败只记日志，Run 保持 PENDING。
- Worker 每 2s 轮询：
  - `dispatchPendingRuns`：扫描 PENDING/QUEUED → `queue.add`（幂等 jobId）→ `markRunQueued`。
  - `reconcileRuns`：RUNNING/QUEUED/PENDING 且 Redis job 已终态/丢失 → 移除旧 job → `recoverRun` 回 QUEUED 待重投（覆盖 worker 崩溃、Redis flush 等场景）。
- 因此 **Redis 短暂不可用不会丢任务**：DB 中 PENDING/QUEUED 的 Run 会在恢复后被自动补投。

## 8. Mock Engine（M3 不调真实模型）

- Seed（`packages/database/scripts/seed-engines.ts`）只写 geo_dev；geo_test 由测试自行创建。
- Engine：`provider='mock'`、`config` 支持 `delayMs`（0–5000）、`failuresBeforeSuccess`、`permanentFailure`；所有配置受 `executeMock` 校验（非法 → `INVALID_ENGINE_CONFIG`）。
- 刻意不伪装真实模型：`provider='mock'`，sourceType/metadata 中明确 mock 语义，M4 接真实 Provider 时按 provider 分支扩展。

## 9. 日志纪律

Worker 结构化 JSON 日志必须带：`taskId/runId/queryId/engineId/jobId/attempt/duration/status/errorCode`。
禁止输出：密码、JWT、API Key、.env 内容（代码中无任何此类字段）。

## 10. 验收（2026-09-05，geo_test 全绿）

| 场景 | 结果 |
|---|---|
| 5 Query × 3 Engine = 15 Runs 全链路 | SUCCEEDED，task SUCCEEDED（completed=15） |
| retry then success | attempt=2 SUCCEEDED |
| permanent failure | attempt=3 FAILED（MOCK_FAILURE），task FAILED |
| 混合成功+失败 | task PARTIAL（completed=1/failed=1） |
| worker 中途 kill → 重启 | kill 于 {QUEUED:11,RUNNING:2,SUCCEEDED:2} → 补齐 15 SUCCEEDED |
| Redis 不可用（enqueue 失败） | Run 保持 PENDING 不丢 → 恢复后自动补投 SUCCEEDED |

相关测试：`packages/queue/test/state.test.ts`（15）、`apps/worker/test/worker.integration.test.ts`（11）、`apps/api/test/monitor-tasks.e2e-spec.ts`（6）、`apps/worker/e2e/acceptance.mts`（6 场景验收脚本，`pnpm acceptance`）。

## 11. 已知注意点

- `apps/worker/e2e/acceptance.mts` 顶层带 geo_test guard，且开头幂等清理历史 `acc-` fixture（防中断残留干扰 dispatch 计数）。
- Worker 集成测试进程退出纪律：全程单 Queue，after 逆序清理 + finally close/disconnect；不要在测试里 `process.exit()` 掩盖残留 handle。
