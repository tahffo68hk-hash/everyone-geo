# GeoLens 开发日志（DEVELOPMENT_LOG）

## 2026-09-05 — M0 环境与骨架

- 环境确认：Node v25.8.2（>=20 ✓）、pnpm 11.1.0、git 2.54.0、V 盘 345GB 可用。
- 创建仓库：`V:\geo-platform`，`git init` 完成。
- 创建目录结构：apps/{web,api,worker}、packages/{ui,shared,config,llm,geo-core,database}、docs、references、scripts。
- 完成根配置：`package.json`、`pnpm-workspace.yaml`、`.npmrc`、`.gitignore`、`README.md`。
- 完成文档：`docs/ARCHITECTURE.md`（V0.1 架构）、`docs/PRODUCT_MAP.md`、`docs/DECISIONS.md`（D-001~D-008）。

## 2026-09-05 — M1 Web/API 骨架与联调

- 初始化 `apps/web`（Next.js 15.5.25，App Router + Tailwind v4，`src/app`）。
- 初始化 `apps/api`（NestJS 11，`GET /health` 返回 `{"status":"ok"}`，监听 3001）。
- 前端首页含 API 连通探测逻辑（fetch localhost:3001/health）。
- 联调验证通过后按流程停止服务。
- 踩坑：V 盘为 exFAT 文件系统，pnpm 默认 symlink 布局安装失败（ERR_PNPM_EISDIR）；已通过 `.npmrc` 设置 `node-linker=hoisted` 解决；且 hoisted 模式下依赖提升至根 `node_modules`，启动 next bin 需使用根路径。

## 2026-09-05 — M2 PostgreSQL/Prisma 数据库层

- 新增 `packages/database`：Prisma 单一事实来源（schema/prisma/schema.prisma），导出全局 PrismaClient 单例。
- 数据模型（8 张表）：User / Organization / OrganizationMember / Project / Brand / Competitor / QuerySet / Query，UUID 主键 + 多租户（Organization 维度）+ 复合唯一约束（slug、OrgMember(userId+organizationId)、Project(organizationId+name)）。
- FK 删除策略：Organization→Project 为 Restrict；Project→Brand/Competitor/QuerySet 为 Cascade；QuerySet→Query 为 SetNull。
- Docker Compose（`docker-compose.yml`）：postgres:17-alpine + named volume `geo_postgres_data` + healthcheck，绑定 127.0.0.1:5432。
- 完成 `prisma migrate dev --name init`→8 张表落库；`prisma db seed` 写入最小种子数据（1 User / 1 Org / 1 Project / 1 Brand / 3 Competitors / 2 QuerySets / 10 Queries），幂等可重入。
- `scripts/verify.ts` 验收全部通过：关系链、唯一约束(P2002)、Restrict(P2003)、SetNull/Cascade 均符合预期。
- `apps/api` 接入数据库：新增 PrismaModule / PrismaService（包装 @geo/database 单例），`GET /health/db` 只读连通检查通过（organizationCount=1）。
- named volume 持久化验证：`docker compose down` 后 `up -d` 数据完整保留。
- 踩坑：
  - **PostgreSQL 事务 aborted 语义**：交互式事务中触发约束错误后，事务进入 aborted 状态，后续命令全部被忽略（25P02）。因此"预期破坏约束"的用例必须独立语句执行验证，不能在同一个事务内 catch 后继续。
  - **exFAT 二次踩坑（workspace 交叉依赖）**：`node-linker=hoisted` 只解决第三方依赖；workspace 内部依赖（`apps/api → @geo/database`）仍走 symlink，V 盘(exFAT) 不支持 → `EISDIR: symlink` 导致 `pnpm install` 失败。已用 `apps/api/scripts/link-database.cjs`（postinstall 自动拷贝 `packages/database` 到 `apps/api/node_modules/@geo/database`）兜底，详见 D-010。**建议将项目迁移到 NTFS 分区以根治。**

## 2026-09-05 — 工作区迁移至 NTFS（C:\dev\geo-platform）

- 源 V:\geo-platform（exFAT）→ 目标 C:\dev\geo-platform（NTFS）：`git clone` 保留完整历史（HEAD 8993bd9，worktree clean），同步未跟踪必需文件（.env、空 references/scripts）。
- 数据保留：PostgreSQL named volume `geo_postgres_data` 复用，`docker compose down` 后重建容器，8 张表 + `_prisma_migrations` 完整（无需搬运数据）。
- 移除 exFAT workaround（D-010 废弃，见 D-012）：
  - `.npmrc` 删除 `node-linker=hoisted`（恢复 pnpm 默认 isolated + 原生 symlink）。
  - `apps/api/package.json` 删除 `postinstall: link-database.cjs`，恢复声明 `"@geo/database": "workspace:*"`。
  - 删除 `apps/api/scripts/link-database.cjs`。
- 重新安装与验证：`pnpm install`（471 resolved）→ 根 `.npmrc` `onlyBuiltDependencies` 放行 prisma/esbuild → `prisma generate`（6.19.3，生成于根 node_modules/@prisma/client）→ `@geo/database build`（tsc，dist 正常）。
- M2 回归全部通过：`scripts/verify.ts` 13 项 PASS（关系链/唯一约束 P2002/Restrict P2003/SetNull/Cascade）；`db:seed` 幂等跳过；`@geolens/api` nest build 通过、启动后 `GET /health`=ok、`GET /health/db`=connected（organizationCount=1，与迁移前一致）；`@geolens/web` next build 通过（4 static pages）。
- 关键验证：`apps/api/node_modules/@geo/database` 为标准 NTFS symlink → `packages/database`，exFAT workaround 依据消失。

## 2026-09-05 — isolated/hoisted A/B 实验与工具链固定（D-013 前置）

锁定工具链组合：Windows NTFS / Node 25.8.2 / pnpm 11.1.0 / Next.js 15.5.25 / pnpm workspace。

### A/B 对照实验（隔离复现）
- `isolated`（pnpm 默认 symlink virtual store）：`next build` 在 prerender 内置错误页（_error.js，内联双 React）时崩溃，报 `Cannot read properties of null (reading 'useContext')`。
- `hoisted`（`nodeLinker: hoisted` + 清 `.next`）：`next build` 完整成功，7/7 静态页面正常生成，进程正常退出。
- 结论：可重复构建优先于 node_modules 布局偏好；判定为 **current toolchain compatibility issue**（当前工具链组合兼容性问题），未定位 Next/pnpm 源码前不作"官方 Bug"或"pnpm isolated 必然双 React"的绝对定性。实验可重复：hoisted 恒成功、isolated 恒失败。

### 工具链版本固定（防漂移）
- 根 `package.json`：`engines.node` 固定为 `25.8.2`；`packageManager: pnpm@11.1.0`（精确）。
- `apps/web/package.json`：`next: 15.5.25`、`react: 19.2.8`、`react-dom: 19.2.8`（全部精确版本，去除无上限范围）。
- pnpm 配置入口统一：`pnpm-workspace.yaml`（`nodeLinker: hoisted` + `onlyBuiltDependencies`），移除根 `package.json` 的冗余 `pnpm` 块与废弃的 `allowBuilds` 字段。
- `pnpm why react`：仅 `react@19.2.8` 1 个版本（@geolens/web 依赖；next@15.5.25 引用同一版本）。Found 1 version of react。
- `pnpm why react-dom`：仅 `react-dom@19.2.8` 1 个版本（@geolens/web 依赖；next@15.5.25 引用同一版本）。Found 1 version of react-dom。
- 结论：react / react-dom 无多版本共存，不存在多副本不兼容问题。

### 防回归检查（防漂移）
- 后续升级 Node / pnpm / Next.js / React / React DOM **任一**版本前，必须重新执行 isolated/hoisted compatibility check（临时切 `nodeLinker: hoisted` 验证）。
- 当前原则：先稳定开发，**不主动升级**上述任一版本。

## 2026-09-05 — D-013 正式落地：hoisted layout + clean test 回归

### 正式配置落地
- `pnpm-workspace.yaml`：`nodeLinker: hoisted`（正式）+ `verifyDepsBeforeRun: false` + `onlyBuiltDependencies`（7 项）+ `allowBuilds`（对应 7 包显式 true，供 pnpm 11 放行构建脚本）。
- pnpm 配置入口统一至 `pnpm-workspace.yaml`：根 `package.json` 移除冗余 `pnpm.onlyBuiltDependencies` 块；`.npmrc` 恢复原样（无冗余 configure）。
- 版本固定：根 `engines.node: 25.8.2`；`apps/web`: `next 15.5.25`、`react 19.2.8`、`react-dom 19.2.8`。
- workspace:* 继续保留：`apps/api → @geo/database: workspace:*` 不变，仅物理布局为 flat/hoisted。

### Clean test（删除可再生成产物后全新安装）
- 删除：根及各包 `node_modules`、`apps/web/.next`、`apps/api/dist`、`packages/database/dist`（未动 `.env`、Docker named volume `geo_postgres_data`、业务数据）。
- `pnpm install`：779 resolved / 675 added，`@prisma/client`/`@prisma/engines`/`prisma`/`esbuild`/`argon2`/`@parcel/watcher`/`unrs-resolver` 构建脚本全部执行（首轮因 allowBuilds 占位符被忽略，显式置 true 后重装放行）。
- `prisma generate`：client 生成至根 `node_modules/.prisma/client`，`User`/`OrgRole` 等模型类型齐全。

### `pnpm -r build` 回归（全新依赖，非旧缓存）
- `apps/web`（next build）：7/7 静态页生成，进程正常退出。
- `packages/database`（tsc）：Done。
- `apps/api`（nest build）：Done（首次编译报 `@prisma/client` 缺 `OrgRole/User`，为 generate 未针对 schema 生成的空模板，重跑 `prisma generate` 后通过）。
- 关键验证：`apps/api/node_modules/@geo/database` 为标准 SymbolicLink → `packages/database`，从 workspace 正确解析，未误装 registry 同名包。

### 数据与存活回归
- `packages/database/scripts/verify.ts`：13 项全部 PASS（关系链/唯一约束 P2002/Restrict P2003/SetNull/Cascade）。
- api 起服：`GET /health` = `{"status":"ok"}`；`GET /health/db` = `{"status":"ok","database":"connected","organizationCount":11}`。
- PostgreSQL 容器（geo-postgres / named volume）全程 healthy，数据未受影响。

## 下一阶段（M3）

- Redis + BullMQ 队列基础设施与 Worker 骨架。
- Config 包环境校验与 LLM Provider Adapter 骨架。

## 2026-09-05 — M2.5 D 盘迁移收尾

正式目录 D:\dev\geo-platform，Node 24.20.0 / pnpm 11.1.0 / hoisted。标准 Nest 构建排除 test 后恢复 dist/main.js。原 geolens 数据完整复制到 geo_dev，geo_test 独立测试；原卷不变。9 条多余组织来自三轮 auth e2e 的持久注册和不完整清理，详见 DATA_HYGIENE.md。三次 seed、verify、auth 13 项、保护 15 项通过，开发基础表指纹不变。已评审既有 auth/web 实现，单独提交以避免混入基础设施修复。

## 2026-09-05 — M3 Redis + BullMQ + 独立 Worker 完成

M2.5 收尾后接手半成品 M3（Codex 中断）。先做只读接管审计（见 docs/WORKBUDDY_HANDOFF.md），修复后完整收尾：

- **P0 blocker**：pnpm-workspace.yaml 第 23 行残留 `msgpackr-extract: set this to true or false` 造成重复 key，pnpm 完全无法运行 —— 删除残行，pnpm 11.1.0 恢复。
- **Redis**：compose 已含 redis 服务但从未启动；6379 落在 Windows 排除端口段（6295-6394），改宿主 16379（容器内 6379）；`.env.example` 补 REDIS_* 示例；容器 healthy + PONG。
- **geo_dev migration**：`20260905090000_monitor_pipeline`（Engine/MonitorTask/Run + PARTIAL）补跑成功；`seed-engines.ts` 写入 5 个 mock engine（alpha/beta/gamma/retry/failure，provider=mock，不伪装真实模型）。
- **构建**：`pnpm -r build` 全绿（database/web 8 页含 /app/monitor/queue/worker/api）。
- **测试**：packages/queue 15、worker 集成 11、API e2e 19（auth 13 + monitor-tasks 6）、database 保护 15 —— 全 PASS。新增 `apps/api/test/monitor-tasks.e2e-spec.ts`、`apps/worker/test/worker.integration.test.ts`。
- **Worker 集成测试 SIGTERM 根因（两个）**：① after 清理顺序撞 `Run_engineId_fkey`(Restrict) 致清理链中断、$disconnect 不执行；② 多处 `createRunQueue()` 从不 close → ioredis 常驻 handle → node:test 子进程永不退出、汇总不打印、被 SIGTERM。修复：逆序清理 + finally 兜底 + 全程单 Queue 共享并在 after close。禁止 process.exit 掩盖。
- **验收**（`apps/worker/e2e/acceptance.mts`，geo_test 真 DB + 真 Redis + 真实 Worker 子进程）：5 Query×3 Engine=15 Runs 全 SUCCEEDED；retry attempt=2；permanent failure attempt=3；PARTIAL；worker 中途 kill 后重启 reconcile 补齐；Redis 不可用时 Run 保持 PENDING、恢复后自动补投 —— 6 场景 26s 全 PASS。
- **Health**：`/health`=`{"status":"ok"}`、`/health/db`=`{"status":"ok","database":"connected"}`；geo_dev 指纹保持 M2.5 基线（orgs 11 含历史 9 条、monitor_tasks 0、runs 0，未污染）。
- **文档**：新增 docs/QUEUE.md（架构/状态机/重试/幂等/reconcile/Mock Engine/日志纪律/验收）。
- **坑位记录**：① 同一消息内对同一文件的多个 Edit 会互相覆盖（必须串行/整写）；② nest build（incremental）陈旧 `tsconfig.build.tsbuildinfo` 与 deleteOutDir 组合会只发 .d.ts 不发 .js —— 删 dist+tsbuildinfo 重建即可；③ Next build 清理旧 `.next` 缓存会触发 safe-delete 批量删除保护 —— 先删 `.next` 再 build。

## 2026-09-05 — M4 GEO Analysis & Evidence Engine 完成

基于 M3（e227dc7），接管 Codex 中断的 M4 半成品（主体代码已写、零测试/零迁移/零验收）。

- **接管审计**：docs/WORKBUDDY_M4_HANDOFF.md。判定无 P0 blocker：schema+migration 一致、geo-core Analyzer/Metrics/45 单测已写、worker evidence 接入、Evidence/Metrics API、UI 组件均存在；worker/queue dist 陈旧需重建；两个库都未跑 evidence_analysis migration。
- **migration**：`20260905130000_evidence_analysis` geo_test 先行应用（Evidence/Analysis/Mention/Citation + 4 枚举 + Run 3 列 + **Evidence 不可变 DB trigger**），验证 UPDATE 被 23514 拒绝；再应用 geo_dev。
- **build 稳定性（§十七 永久修复）**：Codex 已落盘 `apps/api/tsconfig.build.json incremental:false`；实测 **clean→normal→normal 三连 build 均产出 dist/main.js**，不再依赖人工删 tsbuildinfo。
- **测试矩阵（全绿）**：geo-core 49（Codex 已写，首次运行即过）；queue 15；worker 集成 **17**（M3 11 + 新增 evidence.integration.test.ts 6：snapshotEntities/成功写 Evidence+Analysis/DB trigger 拒 UPDATE/负面场景/recoverAnalyses/分析失败不丢 Evidence）；API e2e 26（auth 13 + monitor 7 + evidence 6，首次运行即过）；database guard 15。
- **M3 回归**：M3 acceptance（6 场景真实 worker：15-runs/retry/perm-fail/PARTIAL/restart/Redis-outage recovery）全 PASS —— Evidence 写入未破坏任何 M3 语义。
- **M4 acceptance**（新增 `apps/worker/e2e/acceptance-m4.mts` + `pnpm acceptance:m4`）：[A1] 15 Runs→15 Evidence→15 Analysis（真实 worker，scenario 引擎）；[A2] Evidence UPDATE 被 trigger 拒绝；[A3] 版本化（追加 v2 需 analyzer 声明一致版本，重放 v1 幂等）；[A4] metrics 对账精确（visibility=1, avgPos=20/15≈1.333, reco=1, SoV=0.5, citations=10/2）；[A5] worker restart 后 recoverAnalyses 补齐缺失分析且 Evidence 不被重写。5 场景全 PASS。
- **geo_dev 端到端演示**：seed 幂等重跑补 alice 密码；`seed-demo-m4.ts` 增加 demo-first/second/citation 3 个 scenario mock 引擎（provider=mock，不伪装）；API+Worker（geo_dev）真实链路：alice 登录→POST /monitor-tasks（5 Query × 3 Engine=15 Runs）→ 15/15 SUCCEEDED → `/monitor-tasks/:id/metrics`（visibility 1 / reco 1 / avgPos 1.333 / SoV 0.5 / citation 10/2 / sentiment 全 positive）→ `GET /runs/:id`（Evidence 完整：rawResponse 中文、sourceType=mock、Analysis mentions=[CompA(1),ProjectMentor(2),CompB(3)] 位置序正确）。/health + /health/db PASS。
- **文档**：新增 docs/GEO_METRICS.md（V0.1 公式、分母语义、position 定义、GeoLens 内部指标声明）、docs/EVIDENCE.md（数据模型/不可变/版本化/状态分离/mock 纪律）、docs/WORKBUDDY_M4_HANDOFF.md；DATABASE.md 追加 M4 章节；M4_PLAN.md 保留为设计档案。
- **坑位**：① 追加非默认 Analysis 版本必须传声明同版本的 analyzer（否则 ANALYSIS_VERSION_MISMATCH）；② geo_dev 历史 alice 用户 passwordHash 为 NULL，重跑幂等 seed 修复；③ git-bash 后台 `&` 进程随会话回收，常驻服务需 run_in_background。

## 2026-09-05 — M5 DeepSeek Real Provider（Real LLM Provider Integration）

基于 M4（fc1e909）。接管审计见 docs/WORKBUDDY_M5_HANDOFF.md；目标：把已验证的 Mock Pipeline 接入第一个真实 LLM Provider —— DeepSeek 官方 API（**不是 DeepSeek 搜索**），并在 UI/Metrics 明确区分 Mock 与真实数据。零 migration。

- **packages/llm（@geo/llm）**：统一 `LLMProvider` 接口 + `ProviderRequest/ProviderResponse` +
  `LLMProviderError`（kind 分类：auth/rate_limit/server/network/timeout/bad_request/disabled/
  not_configured/empty/invalid/invalid_config/mock_failure）+ `LLMProviderRegistry` +
  `MockProvider`（自 worker 迁移 scenario/delay/failure 语义）+ `DeepSeekProvider`
  （fetch + AbortController 60s + 响应结构校验 + usage/model 解析 + secret 不入任何返回物）。
  单测 21 全 PASS（含 request/response mapping、401/429/5xx/timeout/malformed/empty、
  脱敏断言：ProviderResponse 与错误消息均不含 Key/Authorization）。
- **queue 契约放宽**：`runResultSchema.provider` 由 `z.literal('mock')` → `z.enum(['mock','deepseek'])`。
- **Worker 执行链**：processor 经 registry.resolve(engine.provider) 替换 `provider!=='mock'` 硬分支；
  错误映射：可重试(429/5xx/timeout/network/mock_failure)→ QUEUED 交 BullMQ，永久(401/403/
  disabled/not_configured/empty/invalid)→ 单 attempt FAILED + UnrecoverableError；
  `evidenceData` 改收 ProviderResponse（sourceType/retrievalMode/model/modelVersion/usage/
  metadata/rawPrompt/脱敏 rawProviderPayload）；runtime 增 `REAL_PROVIDER_TIMEOUT_MS`(60s)。
- **集成测试**（Fake DeepSeek HTTP server，真 DB geo_test + 真 Redis + 真 processor）5/5 PASS：
  成功链 Evidence(official_api/api_plain/model/usage/requestId)+Analysis（无 provider 特判）；
  401→PROVIDER_AUTH attempt=1 FAILED 无 Evidence；500 重试耗尽 FAILED；disabled/not_configured。
- **API**：`GET /monitor-tasks/options` 返回全部启用 Engine + provider/configured/sourceType/model
  （无 secret）；create 对真实 Provider 校验：未配置/未启用明确 400，real-runs 超
  `REAL_PROVIDER_MAX_RUNS_PER_TASK`(3) 明确拒绝（不 silent truncate）；metrics 增加
  `metricSource=demo|real|mixed`（mixed 只基于真实子集，Demo 不污染真实指标）。API e2e 6 新增。
- **UI**：Engine 徽标 Mock/Demo vs「REAL · Official API/未配置」；Evidence Drawer Official API 徽标 +
  Retrieval Mode 文案 + Token 用量 + Citation 来源区分（结构化 vs 正文 URL 提取，不伪造）；
  TaskMetrics 数据源标签。文案不使用「搜索收录/联网引用」。
- **seed**：`seed-engine-deepseek.ts`（geo_dev 幂等注册 `deepseek-api` Engine，config 无 Key）。
- **回归全绿**：geo-core 49 / llm 21 / queue 15 / worker 22（M3 11 + M4 6 + M5 5）/ API e2e 32 /
  database guard 15；M3 acceptance 6 场景、M4 acceptance 5 场景全 PASS；`pnpm -r build` Done；
  /health + /health/db PASS（org 11 不变）；geo_dev 指纹保持（demo 任务验证后清理）。
- **文档**：新增 docs/LLM_PROVIDERS.md、docs/WORKBUDDY_M5_HANDOFF.md；更新 ARCHITECTURE /
  EVIDENCE / QUEUE / DECISIONS(D-015/016/017 含 Engine org 技术债)。
- **暂停点**：真实 DeepSeek 调用未经用户批准不执行 —— 代码/测试/构建全绿后停在
  【DeepSeek Real API Smoke Test Ready】，等待「允许真实测试」。
- **坑位**：3001 被上轮会话遗留 API 进程占用致 EADDRINUSE —— netstat 定位 PID 后 taskkill 再起；
  queue 旧测试断言 deepseek 被 runResultSchema 拒绝，需随契约放宽同步更新。

## 2026-09-06 — DX1 One-Click Dev Control Center（Developer Experience）

基于 M5（1137d23）。不改 GEO 产品核心、不接新 Provider、不进入 M6。

- **启动器**：根目录 `START_GEOLENS.cmd` / `STOP_GEOLENS.cmd` / `STATUS_GEOLENS.cmd` →
  `scripts/dev-control.ps1`（start/stop/stop-all/status/restart/help）。
- **启动流程**：Node 24（固定 D:\tools\node24\node.exe，临时前置 PATH，不改系统 PATH）→ Docker
  Engine 探测（Desktop 未启动则中文提示等任意键重试，不 taskkill/不删数据）→ docker compose up -d
  → 等 geo-postgres/geo-redis healthy + redis PONG → 冷启动前先清 dist 再 build API/Worker
  （杜绝 stale build）→ next dev → /health、/health/db、Web 200 全等 → 自动打开 /dev/status。
- **幂等与进程安全**：只管理 `.runtime/{api,worker,web}.pid` 且命令行带启动标记
  （API/Worker 追加 `dx-geolens-api/-worker` argv；Web 认 `next\dist\bin\next`）的 node 进程；
  停止前 Get-CimInstance 核对进程名+命令行，不匹配安全忽略；重复 START 不建第二套；
  Worker 另做 foreign-instance 检测（同队列 dist/main.js 非本工具实例 → 拒绝启动防双消费）。
  吸取事故教训：绝不扫描 Redis/PG TCP PID 乱杀、绝不 taskkill 全 node、绝不杀 Docker。
- **Control Center 页面** `/dev/status`：SYSTEM STATUS（Web/API/Worker/PG/Redis/DB Health 实时
  探活；Worker=实时 PID+日志 READY；DeepSeek/Real Providers 只读布尔）、PROJECT PROGRESS
  （M0~M6 可展开 timeline + gates 三检查 + checkpoints + verification 证据 + tests）、
  Quick Actions（仅观察入口，无危险按钮）、M5 Real verified 横幅、进度条按 status 计算不硬编码。
  production（NODE_ENV=production）→ notFound()。
- **project-status.json**（根目录，机器可读）：M0~M6 全量含 commit/completedAt/summary/
  dataType/demoRoute/gates/checkpoints/verification/tests + realRunEvidence
  （4 Real Runs、ProjectMentor 3-Query visibility 0%、标注 Small sample / baseline only）。
- **规则落地**：docs/DEVELOPMENT_WORKFLOW.md ——【Milestone 未更新 project-status.json 不得宣布 DONE】。
- **坑位（重要）**：
  - Next dev RSC 内 readFile('.env') 会把整份 .env 当文本注入页面响应（实测泄漏 API Key）。
    修复：Web 永不读 .env，DeepSeek/Real Providers 布尔改由 ps1 服务端脱敏后写
    .runtime/status.json 快照，页面只消费快照。
  - Start-Process 文件重定向（非 .NET Process 异步管道）：父进程退出后子进程日志不 EPIPE。
  - .cmd 首行不得有 BOM（否则首条命令报错）；PowerShell 脚本须 UTF-8 with BOM 中文才不乱码。
  - JS 对象字面量 `N/A:` 非法标识符，需写成 `"N/A":`。

## 2026-09-06 — DX1 Launcher Fix：PowerShell 5.1 native stderr 安全处理（fix 独立 commit）

真机 START_GEOLENS.cmd 失败根因：脚本顶部 `$ErrorActionPreference='Stop'` + 对 native 命令
使用 `2>&1` / `*>&1` 合并输出。PS 5.1 会把 native stderr **逐行包装成 ErrorRecord**，即使进程
ExitCode=0（如 `docker compose up -d` 正常把 progress/status 写到 stderr：
"Container geo-redis Running"）也被误判为终止错误（NativeCommandError）→ launcher 中途退出。

- 修复（scripts/dev-control.ps1）：新增统一 helper `Invoke-NativeProcess`，全部 native 调用
  （docker version / compose up / inspect / exec / compose stop、node -v、pnpm build/-v）一律改为
  `& exe args 1> StdoutFile 2> StderrFile`——PS 5.1 中 native stderr 经 `2>` 直接落文件、
  **不产生 ErrorRecord**（只有 2>&1 合并才包装）；成败只依据 ExitCode；stderr 有内容但
  ExitCode=0 视为成功。详细 stdout/stderr 写 .runtime/logs，主窗口只显示 [n/8] 状态。
  删除全部旧 `2>&1/*>&1` 调用（git grep 验证清零）。
- 顺带发现并规避：PS 5.1 的 Start-Process(UseShellExecute=$false) 会用大小写不敏感字典重建
  子进程环境，环境块里若同时存在 http_proxy / HTTP_PROXY 之类大小写重复变量会抛
  "已添加项 / Item has already been added"（PowerShell 已知缺陷）。短命令 helper 因此不用
  Start-Process；仅常驻进程 Start-App-Background 保留 Start-Process（需脱离父进程+日志文件），
  加 catch 给出可操作中文指引。
- 其他加固：`$LASTEXITCODE` 读取包 try/catch（StrictMode 下未定义时避免抛错）；
  Remove-IfExists 失败静默（删除失败不应中断启动流程）。
- 三个 .cmd wrapper 保留用户真机调优后的 ASCII 版（无 chcp/中文，纯 ASCII、无 BOM、CRLF）。
- 沙箱验证受限说明：本沙箱 PowerShell 对 native 输出捕获/Start-Process 均有宿主层限制，
  无法端到端模拟真机双击；已做语法回归（help/status 控制流）+ 全量静态复核，真机 A-E 验收
  需用户执行。未产生任何真实 API 费用。

## 2026-09-06 — DX1 Launcher Fix #3：容器健康探测确定性（fix 独立 commit）

真机 [3/8] PostgreSQL FAILED，异常消息 = compose 正常进度行 "Container geo-postgres Running"。
即使 a0ad7b3 已改用 2> 文件重定向，部分 PS 5.1 宿主仍会把 native stderr 提升为终止错误
（NativeCommandError，消息=stderr 原文），叠加 $ErrorActionPreference='Stop' → launcher 中断。

- Invoke-NativeProcess v3（层层设防，native stderr 永远不可能终止流程）：
  a. 每次调用生成唯一 stdout/stderr 文件 `.runtime/tmp/native-<guid>.*`，读后即删——
     绝不复用固定路径，杜绝上一次调用残留被下次读取（stale 串数据）；
  b. 调用前函数内 $ErrorActionPreference 临时降级 'Continue'（提升成 ErrorRecord 也只非终止）；
  c. 调用包 try/catch，残余提升吞掉并附 stderr 摘要，不向上抛；
  d. ExitCode 在调用结束后立即捕获（读取文件/恢复目录之前），成败只看 ExitCode；
  e. exe 缺失直接返回 127 + 明确 stderr。
- 容器健康探测确定性重构：新增 Get-ContainerStatus —— 用
  `docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}'`
  机器可解析输出（不解析 compose ps 人类表格 / "Container xxx Running" 进度文案），归一化为
  healthy|starting|unhealthy|running|exited|missing|unknown。Wait-ContainerHealthy：healthy→PASS、
  starting/unknown/unhealthy→2s 重试、missing/exited→快速 FAIL、超时→FAIL，失败带真实
  status+inspect exit+本次 stderr 摘要。Get-RedisPong 改返回 {ok,exitCode,stdout,stderr}，
  PONG 判定 = ExitCode 0 且 stdout(trim)=PONG，不因 stderr 判失败。Postgres 120s / Redis 60s。
- 真机验证仍待用户执行（START 8/8 → 幂等 START → STATUS → STOP → 再 START）；沙箱内已做
  help/status 语法回归 + 健康函数 StrictMode harness 冒烟（逻辑无崩溃；native 不真正执行故
  status=unknown/exit=-1 属沙箱宿主限制，非脚本缺陷）。未产生任何真实 API 费用。
