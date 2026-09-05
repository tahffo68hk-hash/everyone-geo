# WorkBuddy 接管审计报告（HANDOFF）

> 接管时间：2026-09-05 ｜ 审计方式：**只读**（git / 磁盘 / docker / psql / 源码阅读），未修改任何代码
> 正式目录：`D:\dev\geo-platform`（C 盘与 V 盘版本不修改）
> 结论先行：**M3 代码完成度约 85%，但存在 1 个 P0 blocker（pnpm-workspace.yaml 损坏导致 pnpm 完全不可用）+ 若干环境缺口，任何 build/test 目前都无法执行。**

---

## 1. 当前 branch / HEAD / commit

| 项 | 值 |
|---|---|
| branch | `master` |
| HEAD | `97814ce19de692d2c4c0c9e0489e3d5225113490` |
| 与 origin 关系 | 领先 `origin/master` 4 个 commit（无 push 需求） |
| stash | 空 |
| staged | 空（`git diff --cached` 无输出） |
| 工作区 | 9 个 modified + 16 个 untracked（详见 §6/§7） |

最近 7 个 commit（自旧到新）：

```
6e600c1 M0+M1: GeoLens monorepo 骨架与前后端联调
804b831 chore: 移除误生成的 .npmrc 副本
8993bd9 M2: PostgreSQL + Prisma 数据库层（schema/migrate/seed/verify）+ 接入 API
6ea45f7 chore: migrate workspace to NTFS (C:\dev\geo-platform), drop exFAT workarounds (D-010 deprecated, D-012)
72cb6d8 chore: adopt hoisted pnpm layout for stable Next builds
c853354 chore: finalize runtime and database hygiene          ← M2.5 commit #1
97814ce feat: preserve reviewed authentication and tenant access with isolated tests   ← M2.5 commit #2
```

## 2. M2.5 的两个实际 commit hash

- **`c853354`** `chore: finalize runtime and database hygiene` — .node-version、use-node24.ps1、test-env 硬保护、db-snapshot、DATA_HYGIENE.md 等
- **`97814ce`** `feat: preserve reviewed authentication and tenant access with isolated tests` — auth 评审落地 + 双租户 seed + e2e 隔离

> 判断依据：docs/DEVELOPMENT_LOG.md 末条「已评审既有 auth/web 实现，单独提交以避免混入基础设施修复」+ DATA_HYGIENE 实测记录与两 commit 内容吻合。如需更精确可核对 `git show c853354 --stat` / `git show 97814ce --stat`。

## 3. Node / pnpm 现场（实测）

| 检查 | 结果 |
|---|---|
| `D:\tools\node24\node.exe -v` | **v24.20.0** ✅ 存在 |
| 系统默认 node（PATH 首位） | v22.22.2（managed），不符合要求 → 必须显式前置 node24 |
| pnpm CLI 位置 | `D:\aconda\node_modules\pnpm\bin\pnpm.mjs`（pnpm 本体 11.1.0） |
| `pnpm -v` 实际输出 | **失败** — `[ERROR] duplicated mapping key (23:3)` |
| `scripts/use-node24.ps1` | 已读，内容安全：会话级 PATH 前置 + pnpm 函数包装 + 版本断言；未发现危险操作 |

## 4. Git 工作区未提交内容

### 属于原 auth/web 的改动
**没有。** auth/web 的评审工作已全部在 `97814ce` 中提交。工作区当前无 auth 相关未提交文件。

### 属于 M3 的改动（全部未提交）
**modified（9）：**
```
apps/api/package.json            +@geo/queue workspace 依赖
apps/api/src/app.module.ts       +MonitorTasksModule
apps/api/src/main.ts             +enableShutdownHooks
apps/web/src/app/app/page.tsx    +「创建监测任务」入口链接
docker-compose.yml               +redis 服务（详见 §5.1）
package.json                     +dev:worker / start:* scripts
packages/database/prisma/schema.prisma   +Engine / MonitorTask / Run / 2 enum（详见 §5.2）
pnpm-lock.yaml                   +bullmq/zod/tsx 等（说明曾成功 install 过一次）
pnpm-workspace.yaml              ❌ 损坏（残渣行 + 重复 key，P0 blocker）
```

**untracked（16）：**
```
apps/api/src/monitor-tasks/            create-monitor-task.dto / controller / module / service
apps/web/src/app/app/monitor/page.tsx  最小任务页（polling）
apps/worker/                           package.json / tsconfig.json / src/{main,runtime,processor}.ts
packages/queue/                        package.json / tsconfig.json / src/{index,state}.ts
packages/database/prisma/migrations/20260905090000_monitor_pipeline/migration.sql
packages/database/scripts/seed-engines.ts
```

## 5. M3 关键组件逐一核对

### 5.1 Redis / docker-compose
- **compose 已写 Redis** ✅：`redis:7.4-alpine`、容器名 `geo-redis`、仅绑定 `127.0.0.1:${REDIS_PORT:-6379}`、AOF、`geo_redis_data` named volume、healthcheck（redis-cli ping，5s/3s/12）
- **Redis 未运行** ❌：`docker inspect geo-redis` → `Status: created, Running: false`；无日志；宿主机 6379 空闲（无监听）
- **.env / .env.example 无任何 REDIS_ 配置** ❌（需补 `REDIS_HOST/REDIS_PORT/REDIS_URL` 示例值）

### 5.2 Prisma schema（M3 三模型已齐）
`packages/database/prisma/schema.prisma` 已新增（与任务书要求逐条对照）：

| 要求 | 状态 |
|---|---|
| Engine（key/name/provider/config/enabled） | ✅ `provider default "mock"` |
| MonitorTask（org/project/status/total/completed/failed/createdAt/startedAt/completedAt/metadata） | ✅ TaskStatus 含 **PARTIAL** |
| Run（monitorTaskId/queryId/engineId/status/attempt/startedAt/completedAt/errorCode/errorMessage/createdAt） | ✅ 另有 `executionToken`（fencing）、`result Json?` |
| RunStatus 6 态 | ✅ PENDING/QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED |
| 幂等约束 | ✅ `@@unique([monitorTaskId, queryId, engineId])` |
| Evidence 预留 | ⚠️ 仅 `result Json?`；**Response 独立表 / rawPrompt / rawResponse / mention 字段尚未建模**（M4 前需决定是否落表） |

**Migration 状态（关键）：**
- `geo_dev`：仅应用 `20260905011541_init` ❌ → **monitor_pipeline migration 未在开发库执行**，Engine/MonitorTask/Run 表在 geo_dev **不存在**
- `geo_test`：init + monitor_pipeline **均已应用** ✅（Codex 曾在测试库验证过 schema）

### 5.3 packages/queue（存在且质量高）
- `QUEUE_NAME='monitor-runs'`、`JOB_NAME='execute-run'`、`jobId='run-{runId}'`（确定性 id → 天然幂等去重）
- `runJobSchema = { runId: uuid }`（zod strict）；`RunResult` mock 结构
- `queueOptions()`：prefix=`geo-{database}` 隔离 dev/test、rediss 支持、worker `maxRetriesPerRequest:null`
- `state.ts`：**状态机完备** —— aggregateRunStatuses（PARTIAL 逻辑正确）、**fencing token（executionToken）防重复投递**、FOR UPDATE 行锁、claim/settle/recover、attempt≥MAX 判 RETRY_EXHAUSTED
- `dispatchPendingRuns`（DB→queue，即 outbox 模式）/ `reconcileRuns`（queue→DB 修复丢失 job）——**PENDING re-enqueue 方案已在代码层实现**

### 5.4 API
- `MonitorTasksModule` 已挂载 AppModule ✅
- `POST /monitor-tasks`（202）：租户校验（auth.guard JWT Cookie + tenant.assertUserInProject）→ 校验 Query 归属与 Engine mock 可用 → 事务建 task + Query×Engine 生成 Run → **DB 先落 PENDING** → 后台 `dispatchPendingRuns`（enqueue 失败仅告警，不阻塞返回）✅
- `GET /monitor-tasks/options`：项目+启用 mock engine 列表（前端选单用）
- `GET /monitor-tasks/:id`：任务摘要 + runs 明细 ✅
- 注意：`monitor-tasks.service.ts` 中 `db.client` 为 getter（无 `@Injectable` 注入问题）；API dist **尚未包含 monitor-tasks**（从未用新代码 build 过）

### 5.5 Worker
- 独立 `apps/worker`：`dev`(tsx watch) / `build`(tsc) / `start`(node dist) ✅
- BullMQ `Worker` + `concurrency/lockDuration/stalledInterval/maxStalledCount` 可配
- 处理器：claim→RUNNING（fencing token）→ executeMock → settle SUCCEEDED/FAILED/QUEUED(retry) → 日志含 taskId/runId/jobId/attempt/duration/status/errorCode（无敏感字段）✅
- Mock 引擎：`delayMs/failuresBeforeSuccess/permanentFailure` 确定性配置，可复现成功/失败/超时/限流 ✅
- worker 自身每 2s 轮询执行 reconcile + dispatch（Redis 重启/进程崩溃自愈）✅
- **worker dist 不存在**（从未 build）

### 5.6 前端
- `apps/web/src/app/app/monitor/page.tsx` 完整：选项目/查询/引擎、POST 创建、polling 1s（指数退避）、进度条（completed/失败/partial）、URL 带 `?task=` 刷新可续看 ✅
- app/page.tsx 已有入口链接 ✅
- 由 middleware 保护（/app 前缀需 cookie）✅

### 5.7 Mock Engine seed
- `seed-engines.ts`：mock-alpha/beta/gamma + mock-retry(failuresBeforeSuccess:1) + mock-failure(permanentFailure:true)，upsert 幂等 ✅
- ⚠️ 未接入 `prisma db seed`（seed.ts 不含 engine，seed.ts 中 grep "engine" = 0）；需单独执行或并入

## 6. 上一个被拒命令的逐项核查

| 被拒命令声称的操作 | 实际状态 |
|---|---|
| 修改 pnpm-workspace.yaml | ⚠️ 改了，但改**坏了**（第 15 行 `'msgpackr-extract': false` + 第 23 行垃圾 `msgpackr-extract: set this to true or false` → 重复 key，pnpm 拒绝解析） |
| 修改 docker-compose.yml | ✅ 已发生（Redis 服务已写入） |
| 修改 .env | ❌ 未发生（无 REDIS 键） |
| 修改 .env.example | ❌ 未发生（无 REDIS 键，注释还停留在 "Auth (M3)"） |
| pnpm install | ⚠️ lock + node_modules 证据表明 install 曾成功（bullmq@5.81.4 已 hoisted）；但 yaml 损坏发生在之后 → 现在无法再 install |
| 启动 Redis | ❌ 未发生（容器 created 未运行） |

## 7. build / test 现状

| 项 | 结果 |
|---|---|
| `pnpm ...`（任意） | ❌ **全部失败**：`duplicated mapping key (23:3)` |
| queue / worker 测试 | ❌ **目录存在但为空**（`test/` 下 0 文件） |
| api e2e（auth 13 项） | 通过记录在 M2.5；当前依赖可跑，但 pnpm 不可用 |
| database 保护测试 15 项 | 通过记录在 M2.5；同上 |
| 递归 build | 无法运行（pnpm blocker）；且 api/worker/queue 产物均为旧或缺失 |

## 8. 数据现场

| 库 | 内容 |
|---|---|
| geo_dev | Organization=11 / User=12 / Project=5 / QuerySet=2 / Query=10（与 DATA_HYGIENE 审计一致，属已知历史）；**无 Engine/MonitorTask/Run 表** |
| geo_test | 已应用两条 migration，隔离正确 |

## 9. 已知 Blocker（按优先级）

| # | 级别 | 描述 | 处置 |
|---|---|---|---|
| B1 | **P0** | `pnpm-workspace.yaml` 重复 mapping key → pnpm 全挂 | 删第 23 行垃圾，保留第 15 行 `'msgpackr-extract': false` |
| B2 | P1 | geo_dev 未应用 monitor_pipeline migration | `prisma migrate deploy`（dev） |
| B3 | P1 | Redis 容器未启动、.env/.env.example 无 REDIS 配置 | 补 env 示例键 + `docker compose up -d redis` + healthcheck 验证 |
| B4 | P1 | queue/worker 测试缺失（空 test 目录） | 按任务书 §25 补测试 |
| B5 | P2 | Evidence 预留仅为 `Run.result Json`，无独立 Response 模型 | M3 文档中记录，M4 前决策 |
| B6 | P2 | docs 未更新：缺 QUEUE.md/API.md；ARCHITECTURE/DATABASE/DEVELOPMENT_LOG 尚未记录 M3 | 收尾补齐 |

## 10. 结论与建议执行顺序

未发现数据破坏风险、未知大规模改动、Git 冲突、系统级依赖缺失。M3 主体代码（schema/queue/API/worker/web/seed）已由上一任完成且质量良好；剩余工作集中在 **修复阻断 → 落库 → 补测试 → 联调验收 → 文档/提交**。

建议顺序：
1. 修复 `pnpm-workspace.yaml`（B1）→ `pnpm install` 验证
2. `.env.example` 补 REDIS 示例 + `.env` 补本地值 → 启动 Redis（B3）
3. geo_dev `prisma migrate deploy` + engine seed（B2）
4. 递归 build（database→queue→worker→api→web）
5. 补 queue/worker 单测 + 验收场景（15 Runs / retry / 永久失败 / restart / 重复 job / PENDING re-enqueue / PARTIAL）
6. geo_test 跑测试并验证 geo_dev 指纹不变
7. 更新 docs（QUEUE.md 新增 + 既有文档）→ 分 4 个 commit 提交（不 push）
