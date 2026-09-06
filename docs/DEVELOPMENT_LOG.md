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

## 2026-09-06 — DX1 Launcher Fix #4：PowerShell PID automatic variable 冲突（fix 独立 commit）

真机 [4/8] Redis HEALTHY (PONG) 后 launcher 报
`无法覆盖变量 Pid，因为该变量为只读变量或常量。` 并 exit 1。
根因：`$PID` 是 PS 内置只读 automatic variable，变量名大小写不敏感（`$pid/$Pid/$PID` 同一变量）；
dev-control.ps1 中 4 个函数以 `[int]$Pid` 命名参数，PS 5.1 调用时参数绑定赋值命中只读变量即终止。

- 审计（词边界 grep 全 repo *.ps1/*.cmd）：冲突仅 4 个函数参数——Test-Alive、
  Write-PidFile、Get-ProcessCmdline、Test-GeoLensProcess。
  未误判项（保持不动）：`$pidPath`/`$pidVal`（不同标识符，非 automatic variable）、
  hashtable key `pid`、`.runtime/*.pid` 文件名与内容格式。三个 .cmd 无 $pid 用法。
- 统一重命名：4 个函数参数 `$Pid` → `$ProcessId`（含函数体内 5 处引用）；
  调用点均为位置传参，无需改。git diff 9+/9- 仅此 18 行，无行为变化。
- 沙箱验证：全 repo 词边界 grep 无 `$PID/$Pid/$pid` 残留；PS Parser 语法回归通过；
  StrictMode AST harness（抽取 4 函数 dot-source）冒烟全过——Test-Alive(0)=False、
  Test-Alive($PID)=True、Write-PidFile 写读回一致（ASCII 无换行格式不变）、
  Get-ProcessCmdline 非空、Test-GeoLensProcess 对非 node 进程=False；
  修复后参数绑定不再抛只读冲突。
- 真机验收仍待用户执行：START 8/8 → 幂等 START → STATUS → STOP → restart。

## 2026-09-06 — DX1 Control Center Data Fix：repo root 解析 + 双 JSON 读取修复（fix 独立 commit）

DX1 launcher 主链真机打通（8/8 全绿 + 自动打开 /dev/status），但 Control Center 数据全空
（0/1 DONE、milestones 只有空列表、Current/Next=?、#ms-、DeepSeek/RealProviders Unknown）。
实测真机根因是两个独立缺陷叠加：

- 根因 A（数据文件）—— project-status.json 第 284 行 summary 字符串跨物理行（JSON 字符串内裸
  换行，非法 JSON）→ JSON.parse 直接抛错 → 页面 project=null（milestones/current/nextUp 全空、
  Overall Progress 0/1、锚点 #ms-）。词法扫描仅此 1 处跨行；程序化修复为单行（换行→空格、
  吃掉续行缩进），JSON.parse 复验 8 milestones / 7 DONE / 88%。
- 根因 B（页面读取）—— .runtime/status.json 由 ps1 写入带 UTF-8 BOM（PS 5.1
  Set-Content -Encoding UTF8），readJson 裸 JSON.parse 遇 BOM 失败 → snapshot=null →
  config（DeepSeek/RealProviders）Unknown、infra 无快照回退。页面 readJson 增加 BOM 剥离。
- 根因 C（路径健壮性）—— 原 REPO_ROOT=resolve(cwd,'../../') 依赖“从 apps/web 执行 next dev”
  的偶然 cwd（cwd 在 repo root 时 ../../ 会指到 D:\）。新增 resolveRepoRoot()：
  GEOLENS_REPO_ROOT env → 从 cwd 向上逐级找 workspace marker（project-status.json 且存在
  pnpm-workspace.yaml / package.json）→ 最后回退 ../../。
- 安全：Web 仍永不读 .env；快照只展示布尔。泄漏自动测试 GET /dev/status 扫
  DEEPSEEK_API_KEY|sk-|Authorization|DATABASE_URL|REDIS_URL|JWT_SECRET|POSTGRES_PASSWORD = 0 命中。
- 真机 curl 验证（next dev 热更新后）：System Status 全绿（Web Running / API Healthy / Worker
  Ready / PostgreSQL Healthy / Redis Healthy / DB Pass / DeepSeek Configured (YES) / Real Providers
  Enabled）；Overall Progress 7/8 DONE 88%；milestones M0~M6（含 M2.5→#ms-M25）；Current M5 →
  Next M6（不自动开始）；View Latest Milestone → #ms-M5；project-status.json 更新时间正常显示。

## 2026-09-06 — M6A Real GEO Benchmark Foundation（分 4 个 feat/docs commit，未 push）

正式进入 M6（M6 NOT_STARTED → IN_PROGRESS），本轮只做 M6A Benchmark Foundation，不接第二
Provider、不大规模真实调用、不进 M6B/M6C/M6D。

- 数据模型（migration 20260906060807_m6a_benchmark）：BenchmarkSuite（projectId+name+version
  版本化唯一）/ BenchmarkQuery（自包含 queryText + category/intent/locale/weight/enabled/
  sortOrder/sanity + projectQueryId 执行镜像）/ BenchmarkRun（suiteName/suiteVersion 版本快照 +
  provider + 关联的 monitorTaskId；真实进度以 MonitorTask 为准实时计算）。
- 执行复用而非重写：Benchmark Run 只创建一条 MonitorTask（启用查询镜像 × 1 engine），
  Evidence/Analysis 由既有 Worker 写入 —— Evidence 仍是唯一事实源。
- ProjectMentor GEO Benchmark v1：26 行 = 24 主查询（6 类 × 4：tool-discovery/comparison/
  workflow/recommendation/pain-point/competition，全为非品牌自然提问）+ 2 branded sanity
  （enabled=false 不派发不计主指标）。权威定义 packages/database/scripts/benchmark-queries.ts，
  设计文档 docs/m6-benchmark-v1.md。
- 指标：复用 geolens-v1 aggregateMetrics，overall/category/query 三级聚合；metricSource
  demo/real/mixed（mixed 仅 real 子集为 Real Benchmark）；competitorScope=pending-m6b 诚实标记
  SoV（M6B 前 A/B/C 占位不输出误导性结论）。
- 成本保护：plannedRuns 预知（v1=24×1=24）；real 超过 REAL_PROVIDER_MAX_RUNS_PER_TASK 直接
  400 拒绝；demo 只允许 mock 引擎。
- API（auth/org ownership/DB isolation 全部经 TenantService，跨租户 404）：
  GET|POST /projects/:projectId/benchmark-suites、GET /benchmark-suites/:id、
  POST /benchmark-suites/:id/runs、GET /benchmark-runs/:id、GET /benchmark-runs/:id/metrics。
  Swagger /docs 仅非 production 环境启用（@nestjs/swagger@12 为 ESM-only，只允许 main.ts 引入，
  避免 jest CJS 链路被拖入）。
- UI /app/benchmark（auth 由 middleware 保护）：Suite/Version/Query Count/Categories/Run Type/
  Status、按 category 的 query 列表、Planned/Completed/Succeeded/Failed/Analyzed、overall+category
  +query 结果、Real/Demo badge、competitorScope pending 提示、点击 Query 钻取 Evidence（复用
  /runs/:id EvidenceDialog）。
- 测试：api benchmark e2e 15/15（401/404 跨租户、suite 版本化重复 400、v1 seed exact 24+2、
  6×4 分布、create run 202 + plannedRuns=24、重复派发独立 run、real guard 未配置 400 + cap 400、
  evidence linkage、overall/category/byQuery 聚合、failed denominator、demo/real isolation、
  competitorScope、DTO 400）；worker benchmark.integration 2/2（真实 processor 走完 SUCCEEDED →
  Evidence → Analysis 断言 brandMentioned/mentions；Suite 改名不影响历史 Run 快照）。
  回归：api e2e 全套 46/46（含 M3 monitor-tasks / M4 evidence / M5 deepseek）、worker 全套 24/24、
  geo-core 49 / llm 21 / queue 15、api/worker/database tsc 全过。
- 技术债记录（M6C TODO，本轮不做）：requestedModel（请求 deepseek-chat）与 responseModel
  （响应上报 deepseek-v4-flash）的 schema 拆分——不做 schema migration、不回填历史 Evidence。
- Control Center：M6 = IN_PROGRESS，checkpoints M6A DONE / M6B NEXT / M6C、M6D NOT_STARTED；
  Overall Progress 维持 7/8（M6 未 DONE 不计）；nextUp=M6B Competitor Discovery。

## 2026-09-06 — M6A Versioning Semantic Audit（fix(m6) snapshot，未 push）

M6A 最终验收前版本化语义审计。结论：原实现存在真实漂移风险 —— GET
/benchmark-runs/:id 与 /metrics 的 byCategory/byQuery 按 suiteId live-join 当前
BenchmarkQuery 行（queryText/category/intent/sortOrder/sanity 全部取当前值），
只有 suiteName/suiteVersion 是快照；一旦未来编辑 Suite/Query（甚至直接改库），
历史 Run 的解释与分类指标就会漂移。

采用方案 B（Run 创建时完整 snapshot），而非 freeze：
- 新增 migration 20260906071539_m6a_benchmark_run_query_snapshot：BenchmarkRunQuery
  归档表（benchmarkRunId FK Cascade；benchmarkQueryId/projectQueryId/queryText/
  category/intent/locale/weight/sortOrder/sanity 为纯归档列、非 FK —— 源行即使被
  删除快照仍完整自包含；@unique(benchmarkRunId, sortOrder) + (benchmarkRunId,
  projectQueryId)）。
- startRun 在创建 BenchmarkRun 的同一事务内为每个启用 query 写一条快照（24 queries
  → 24 条，事务原子）。
- getRun / getMetrics 改为只读快照（Map by projectQueryId），不再触碰 BenchmarkQuery；
  顺带修复原 sanity 排除逻辑（原代码用 benchmarkQueryId 查 projectQueryId 为 key 的
  Map，是死代码——现改为基于快照 sanity 字段）。
- 一次性回填脚本 backfill-benchmark-run-queries.ts（幂等，仅补 runQueries 为空的
  run；geo_dev 实测 0 条需回填——migration 前尚无任何 BenchmarkRun）。
- 测试：新增 2 项版本化语义 e2e ——(a) 编辑 v1 的 BenchmarkQuery(queryText/category/
  intent) + 镜像 Query 后，GET run 的 runs[] 与 GET metrics 的 overall/byQuery/
  byCategory 逐字段不变（toEqual 基线）；(b) 创建 v2 用新 query/category 跑 Run 后
  v2 指标显示新语义、v1 历史 Run 报告仍等于基线。Demo Run 测试补快照计数断言
  （startRun 后 BenchmarkRunQuery = 24）。benchmark e2e 17/17；全套 api e2e 49/49
  （M3/M4/M5 回归）；worker 24/24（含 benchmark.integration 2/2）。
- geo_dev + geo_test 均已 migrate deploy。未进 M6B、无真实 DeepSeek 调用。

## 2026-09-06 — M6A Final Acceptance Hotfix（fix(m6) swagger peer align，未 push）

M6A 真机最终验收（重启 API 使新代码生效）时暴露启动期崩溃：
@nestjs/swagger@12.0.1 的 peerDependencies 要求 @nestjs/common ^12，而项目实际为
@nestjs/common@11.2.3 / core@11.2.3 —— swagger 12 的 ESM 入口 import
loadPackageSync from @nestjs/common/utils/load-package.util.js 在 common 11 上无此导出，
任何 Node 版本下真实 boot 都会 SyntaxError 崩溃（api/worker dist 已在 14:2x 构建，但
13:58 用户 START 的进程跑的是 M6A 之前的旧 dist，无 swagger import，故此前未暴露；
e2e 全部通过是因为测试经 TestingModule 绕过 main.ts，从未加载 swagger）。

修复：@nestjs/swagger 从 ^12.0.1 降级到 ^11（实际解析 11.4.7，peer 为
@nestjs/common ^11.0.1），与项目 Nest 11 对齐，改动仅 apps/api/package.json +
pnpm-lock.yaml。

真机全链路验收（本机即真机，会话内临时起停 api/worker）：
- API 以新 dist boot：/health 200（1s）、Swagger /docs 200（swagger 11 生效）。
- 登录 alice@geolens.local → POST /benchmark-suites/23fb7de6…/runs demo(mock-alpha)
  → 返回 plannedRuns=24、status=PENDING。
- Worker 消费：poll RUNNING → SUCCEEDED（约 6s），runs 24/24 SUCCEEDED、
  analysisStatus 24/24 SUCCEEDED、24 行均含 benchmarkQueryId（快照回链）、
  sanity 行 0（2 条 sanity 未派发，正确）。
- GET /benchmark-runs/:id/metrics：metricSource=demo；overall
  {totalRuns:24, successfulRuns:24, analyzedRuns:24, visibilityRate:0,
  recommendationRate:0, citationCount:0}（mock-alpha 不自然提及品牌——
  visibility 0 为诚实 demo 口径）；byCategory 6 类各 queryEligibleCount=4/
  queryMentionedCount=0；byQuery 24 行（category 分布 6×4，含 intent/sortOrder）；
  competitorScope={status:pending-m6b}（M6B 前不输出 SoV 结论）。
- 本次 Demo BenchmarkRun：843626da-c514-46ec-8eff-b2c33d95f327（已入库，含 24
  Evidence + 24 Analysis，重启后可于 UI 直接查看）。
- 会话内注意：工具宿主以 job object 回收子进程，Bash/PS 工具无法留驻常驻服务；
  验证用进程随命令退出。持久启动仍走 START_GEOLENS.cmd（用户双击）。

## 2026-09-06 — M6B Competitor Discovery（feat(m6)/test(m6)/docs(m6)，未 push）

在 M6A 冻结（e754670）之上完成 M6B 闭环：REAL Evidence → Candidate 发现 → 人工评审 →
版本化 Competitor Set → m6b 重分析 → SoV 显式绑定版本。全程 0 次 DeepSeek 请求、不进入
M6C、不引入第二 Provider。

- 数据模型（迁移 20260906084138_m6b_competitors，geo_dev + geo_test 已 deploy）：
  CompetitorCandidate / CompetitorCandidateEvidence（候选↔Evidence 链接，非副本，
  @@unique(candidateId,evidenceId)）/ CompetitorSet(name+version 唯一，DRAFT/ACTIVE/
  ARCHIVED) / CompetitorSetEntry（canonicalName/aliases/type/sortOrder 快照，candidateId
  为非 FK 归档）；Analysis 增 competitorSetId/competitorSetVersion（非 FK，索引）。
- @geo/core 提取器 discoverCandidates + createDiscoveryLexicon：确定性、无概率；uppercase
  token 起步 → lexicon/排除名大小写命中（小写变体续命）→ 相邻组装（≤6 token，仅英文
  连接词/ASCII 间隔，中文顿号不拼）→ suffix 归并（"ChatGPT"⊂"OpenAI ChatGPT"）→
  自身品牌/A/B/C 占位整段排除；推荐信号复用 m4 RuleJudge。新增 15 项单测，
  geo-core 合计 64/64。
- API（apps/api/src/competitors，auth+租户隔离+swagger）：discovery(幂等 refresh，
  REJECTED 跳过、0 命中 DISCOVERED 清理)、candidates 列表/详情(evidenceLinks 回链
  Evidence→Run→Query)、review(Approve 必须显式 DIRECT/ADJACENT/SUBSTITUTE、Reject→
  NON_COMPETITOR、改名/aliases 冲突 400)、sets 创建(默认=全部 APPROVED 快照)/列表/详情/
  activate(冻结+同 name 旧 ACTIVE 自动归档)、reanalysis(m6b-competitors-v1，本地
  RuleJudge，Evidence 不可变、m4 保留、幂等)、sov(显式绑定 Set 版本；未 ACTIVE/未
  重分析 → pending)。发现只消费 REAL Evidence（sourceType∈official_api/browser/
  third_party_api/manual 且 provider≠mock）：fixture 中 24 条 mock Demo Evidence = 0 输入、
  estimated 排除、ProjectMentor 自身品牌与 A/B/C 占位均不入候选。
- 修复的关键缺陷：候选 canonical/aliases 以 extractor 跨 Evidence 最终词表为准（逐条
  Evidence 处理期间归并 canonical 会随计数在 ChatGPT↔chatgpt 翻转，服务端自建计数会
  选错小写形式）；e2e 另修正两处断言（B 项目自身语料不含 "ChatGPT" 以真正测无泄漏；
  activate 为 POST 默认 201）。
- 测试：competitor e2e 16 项全绿；API 全量 6 套件 65/65（M3/M4/M5/M6A 回归）；worker
  24/24；queue 15/15；geo-core/database/llm/web tsc 全绿。真机验收：/app/competitors
  闭环（Discovery → Approve/DIRECT → Set v1 → Activate → Re-analysis → SoV ready），
  0 次 DeepSeek 调用；诚实口径：真实语料为小样本，SoV 仅为绑定版本集的发现信号。
- 提交序列：b52d4e8（candidates，schema/迁移/core）+ feat(m6) api 模块 + feat(m6) review
  UI + test(m6) e2e + docs(m6)（本日志 + docs/m6-competitors.md + project-status.json：
  M6B DONE、M6C=NEXT、Overall 7/8 DONE · 88%）。未 push；M6C 待用户指令后启动。

## 2026-09-06 — UX-CN 全站中文化（feat(ui)/feat(dx)/test(ui)，未 push，非正式 milestone）

产品体验清理阶段：GEO 核心算法 / API contract / DB enum / Evidence 原始数据一律未动，
仅前端展示层中文优先。M6 完成度不变（M6A/B DONE、M6C NEXT、7/8 DONE · 88%）。

- 统一字典 apps/web/src/lib/labels.ts（集中文案，Server/Client 均可引入）：run/analysis
  状态、milestone/gate 状态、candidate/competitorType/set 状态、sourceType/retrievalMode/
  runType/metricSource、场景分类、指标名、情感/实体类型、导航、空状态、友好错误映射
  friendlyError（原始英文错误保留 console，UI 只显示中文）。withRaw() 支持「中文（raw）」。
- 页面：/login、/register、/（根）、/app 工作台、/app/monitor（含 Evidence dialog 与指标卡）、
  /app/benchmark、/app/competitors、/dev/status Control Center 全部改中文主界面；状态类展示
  走 formatter（formatStatus/formatAnalysisStatus/formatSourceType/formatCompetitorType/
  formatProgressStatus 等），不再各页自建英文映射；metricSource=demo/real/mixed → 演示/真实/混合。
- 保留英文（有意）：GeoLens/ProjectMentor/DeepSeek 等品牌与模型名、DeepSeek API 技术标识、
  canonicalName/aliases/sourceType/rawPrompt/rawResponse 等字段并列展示、commit hash、Run ID/
  PID/HTTP 状态码、m4-rule-v1 等分析版本；技术字段用「中文（raw）」并列保留原始事实。
- 竞品/SoV 页恒定提示「样本量较小，仅作为竞品发现信号，不代表稳定行业结论」。
- 测试：web tsc PASS；next build PASS（隔离 NEXT_DIST_DIR=.next-zh 验证，因本地 dev 占用默认
  .next 且 safe-delete 守卫拦截构建产物清理，已验证 compile+typecheck+静态页 10/10+路由表）；
  新增 scripts/check-ui-zh.mjs（纯英文 UI 节点回归守卫）与 scripts/smoke-pages.mjs（核心 6 页
  200/307 冒烟），web package.json 增 check:zh / smoke:pages；真机抽查 /dev/status、/login 中文
  渲染确认，无 System Status/Quick Actions 等残留。

## 2026-09-06 — M6C Benchmark Reporting + Model Identity（feat(m6)/docs(m6)，未 push）

M6C 只做三件事：Model Identity（requestedModel/responseModel 分离）、不可变
Benchmark Report 快照、Historical Comparison Foundation。0 次真实 DeepSeek、未接第二
Provider、未进入 M6D。M6A/M6B/UX-CN 全部回归通过。

- Model identity：审计确认旧链路把 Provider 响应 model（如 deepseek-v4-flash）直接写入
  Evidence.model/modelVersion（缺省回退请求模型），需拆分。ProviderRequest 增
  requestedModel（Worker 以 enginePresentation 单一解析注入）；ProviderResponse 增
  requestedModel/responseModel；mock 恒 geolens-mock；deepseek fake 支持 requested≠response
  （请求 deepseek-chat / 响应 deepseek-v4-flash）。Evidence 增 requestedModel/responseModel
  （nullable，immutable trigger 未破坏）。旧 model/modelVersion 保留 legacy 注释。
- 迁移 20260906105856_m6c_reporting（geo_dev+geo_test）：新增列 + BenchmarkReport 表；
  受控历史回填（临时 DISABLE TRIGGER evidence_immutable）：deepseek 行 requestedModel 只从
  不可变 rawPrompt JSON 证明时回填、responseModel 仅 rawProviderPayload 回显证明时回填；
  mock 常量回填。实测 geo_dev：deepseek 4 行 requested=deepseek-chat/response=deepseek-v4-flash，
  mock 78 行常量身份。严禁用当前 Engine 配置猜历史 —— 不可证明保持 NULL（UI：历史记录未保存）。
- BenchmarkReport（快照）：suiteName/Version、engine、requestedModel/responseModel、
  metricSource、analysisVersion、Competitor Set(id/name/version 非FK归档)、完成度计数、
  partial、metricsSnapshot(overall/byCategory/byQuery + M6B 竞对明细) 全部生成时冻结；
  同 run 允许多份（m4/m6b），绝不覆盖；Set v2 激活/新分析出现不改变旧报告。
- 生成资格：须终态；PARTIAL→partial=true + 保留成功/失败分母；analysisVersion 显式选择
  （默认规则：有 m6b 分析则优先 m6b-competitors-v1，否则 m4-rule-v1）；Demo/Real 隔离。
- API（apps/api/src/reports，auth+tenant+swagger 链路同既有）：POST
  /benchmark-runs/:id/reports、GET /projects/:projectId/reports、GET /reports/:id、
  GET /reports/:id/evidence（回链行）、POST /reports/compare。
- Compare：先判维度（suiteVersion/metricSource/provider/analysisVersion/competitorSetVersion
  =hard；requested/responseModel=soft 未知降级）→ COMPARABLE/PARTIALLY/NOT_COMPARABLE +
  口径警告；Δ 与 null 安全。为 M6D 跨 Provider 对比预留。
- UI（中文优先）：/app/reports 列表、/app/reports/:id 详情（报告头/核心指标/场景/竞品/
  问题级+Evidence 下钻）、/app/reports/compare；/app/benchmark 完成 Run 下新增「生成 GEO
  基准测试报告」（analysisVersion 显式）；Evidence 弹窗展示 请求/响应模型 + legacy 提示；
  工作台加「GEO 基准测试报告」入口。
- 测试：llm 22（含 requested≠response、mock identity、responseModel null 回退）；API e2e
  82（7 suites，新增 reports 17：guard/PARTIAL/快照/多版本不覆盖/v1 冻结/回链/Demo-Real/
  legacy 不伪造/immutable/compare 各维度/隔离/401）；worker 24 / queue 15 / core 64；
  web tsc + next build（隔离 dist）+ check-ui-zh PASS。真机 Demo（geo_dev + 临时 Worker）：
  现场 Demo Run 24/24 → 报告 ×2 → 详情（可见率 1/byCategory 6/byQuery 24/引用 48）→
  Evidence 回链 24 行 → Compare COMPARABLE；0 次真实 DeepSeek。
- project-status.json：M6C DONE、M6D=NEXT、Overall 仍 7/8 DONE · 88%（M6 未 DONE）。
- TODO（后续 migration/refactor）：Evidence.model/modelVersion legacy 字段清理
  （Phase 1 保留兼容，新代码已优先读 requestedModel/responseModel）。

## 2026-09-06 — M6D Second Provider（Qwen）+ Multi-Provider Comparison（feat(m6)/docs(m6)，未 push，REAL_SMOKE_PENDING）

接入第二真实 Provider（通义千问 Qwen，DashScope OpenAI-compatible）并通过统一 Provider
接口完成 Multi-Provider Benchmark Comparison。**默认 NO REAL CALL**（QWEN_API_KEY 未配置，
停留在 REAL_SMOKE_PENDING，不失败、不自行调用）；未接其他 Provider、未进下一里程碑。

- Provider abstraction 审计：接口已可复用（Kind union + registry + requested/response
  identity）；Qwen Adapter 独立实现不复制 DeepSeek。配置 QWEN_API_KEY/QWEN_BASE_URL/
  QWEN_MODEL/QWEN_TIMEOUT_MS；总开关仍 ENABLE_REAL_PROVIDERS；enginePresentation/
  qwenConfigured 只回布尔。Engine seed：seed-engine-qwen.ts（qwen-api，幂等 upsert）。
- 错误模型复用：401/403→auth、429→rate_limit、5xx→server、timeout/network→可重试、
  invalid/empty→协议错误永久。sourceType=official_api / retrievalMode=api_plain
  （官方模型 API，不冒充 Web Search）。
- Multi-Provider Benchmark：Run 仍 = 1 Provider（同 Suite 分别 DeepSeek/Qwen）；UI 明示
  计划（N 问题 × Provider）；startRun 允许 real={deepseek,qwen}，未配置 400 中文；
  超过 REAL_PROVIDER_MAX_RUNS_PER_TASK → 400 明示「计划 N 次真实调用…超过当前安全上限」，
  不自动拆批。
- 跨 Provider 对比语义升级：provider 不同但 suite/metricSource/analysisVersion/
  competitorSetVersion 一致 → PARTIALLY_COMPARABLE（跨模型是 GEO 核心价值，含中文口径
  说明）；模型身份 unknown 降级 soft；全一致 COMPARABLE；硬失配 NOT。对比展示 A/B
  Provider 与模型身份、成功样本（样本数不同给「样本完整性不同，比较需谨慎」）。
- UI（中文）：reports/compare 显示模型服务 A/B + 请求/响应模型 + 判定说明；率用
  百分点 pp（+10pp 而非 +40%）；场景对比矩阵；问题级 Evidence A/B（同 queryText 对齐，
  两个 Provider 各「查看原始回答」）；成功样本与警告。
- queue/worker schema：RunResult provider enum 增加 qwen（z.enum）。worker 31/31（qwen
  fake 成功→Run/Evidence/Analysis/身份、401/500/disabled/not_configured、幂等重放）。
- 测试：llm 35（qwen 13）、API e2e 88（新增 multi-provider 6：同 suite 双 Provider 报告、
  PARTIALLY_COMPARABLE、样本警告、证据回链、cost guard、401/404）；core 64 / queue 15 /
  web tsc+build / check-ui-zh PASS。安全：QWEN_API_KEY/Authorization 不进 Evidence/API
  响应/日志/payload（单测 + e2e 断言）。
- project-status：M6D checkpoint=IN_PROGRESS（IMPLEMENTATION_DONE / REAL_SMOKE_PENDING）；
  Overall 仍 7/8 DONE · 88%。真实 Qwen smoke：PENDING USER APPROVAL —— 授权后先 1 Query
  （HTTP 200/Evidence/identity）→ ≤3 Query → 24 Query 正式 Benchmark 需再次单独确认。

## 2026-09-06 — M6D 真实 Qwen Real Smoke #1 PASS（REAL_SMOKE_PENDING → REAL_SMOKE_1Q_PASS）

用户明确授权 1 Query × Qwen = 1 次真实模型调用；全程恰 1 次真实 HTTP，未跑 DeepSeek、
未跑 3Q/24Q、未进入下一里程碑。QWEN_API_KEY 由用户本机配置（不落库/不落日志/不入 git）。

- Pre-flight：HEAD=8a660e7、workspace clean、ENABLE_REAL_PROVIDERS=true、
  REAL_PROVIDER_MAX_RUNS_PER_TASK=3、QWEN configured=YES、Postgres/Redis healthy。
- 环境修正（非代码）：geo_dev 补 seed qwen-api Engine（seed-engine-qwen.ts，幂等）；
  运行中的旧 worker 为 M6D 前 dist（无 qwen 注册）且早于 Key 配置启动 → 停旧进程并以
  M6D 新 dist 重启（读 root .env 含 QWEN_API_KEY）。
- 单次调用守卫：默认 MAX_RUN_ATTEMPTS=3 会因 retryable 失败产生多次真实调用 → 在
  startRun 创建 run 后、worker 消费前，将该 run attempt 预置为 2；claimRun 唯一一次
  递增到 3（=MAX），retryable 失败也直接 FAILED 不再重排 → 真实调用恰 1 次（worker
  日志仅一条 RUNNING→SUCCEEDED→ANALYZED，attempt=3）。
- Query：大学生参加创新创业比赛可以使用哪些 AI 工具？（中性非 branded）
- 结果：Run SUCCEEDED；Evidence provider=qwen / sourceType=official_api /
  retrievalMode=api_plain / requestedModel=qwen-plus / responseModel=qwen-plus
  （API 回显）/ rawPrompt+rawResponse 已存 / usage{20,1355,1375} / durationMs=30241 /
  requestId / finishReason=stop；Analysis m4-rule-v1 SUCCEEDED（brandMentioned=false，
  0 mention 属有效结果）。secret leakage = PASS（Evidence/metadata/rawProviderPayload/
  日志均无 Key/Authorization；payload 键仅 id/model/usage/object/choices/created）。
- 环境备注：smoke 数据保留在 geo_dev（smoke 组织 + 1 project + 1 suite + benchmarkRun
  52a5445d... + Evidence e57f9e44...）；失败尝试遗留的 2 个空组织已清理；临时 API 已停、
  脚本已删。新 worker 以 M6D dist 后台运行中（用户栈如需持久化请重启 START_GEOLENS.cmd，
  届时 API/Web 也会一并升级到 M6D）。
- project-status：M6D IMPLEMENTATION_DONE + REAL_SMOKE_1Q_PASS；Overall 仍 7/8 DONE ·
  88%。3 Query smoke 与 24 Query 正式 Qwen Benchmark 由用户决定后再执行。

## 2026-09-06 — M7 启动 + M7A GEO Diagnosis Foundation（feat(m7)/docs(m7)，未 push）

M6 用户正式验收（含 M6D 真实 Qwen Smoke #1）→ project-status：M6 DONE，M7 正式启动，
M7A DONE、M7B NEXT。M7A 全程 0 次真实 AI 调用、未进入 M7B。

- M7A 架构（design decisions）：
  1) Diagnosis 绑定 BenchmarkReport（快照）而非项目实时数据 —— report.analysisVersion 指定
     读取既有 Analysis 事实，规则不重算指标；快照不漂移 + GET 不重跑。
  2) 规则引擎 = geo-core 纯函数（src/diagnosis.ts，deterministic）：11 类 Finding +
     DIAGNOSIS_V1_RULES 集中阈值（internal heuristic，非行业标准）+ Severity 由阈值决定 +
     PriorityScore = severityWeight×0.5 + 受影响比例×0.25 + 证据信号×0.25（0–100，无伪 ML）。
  3) findingType 用 String（版本演进可扩展，同 analysisVersion 风格）；severity 用 enum；
     Report/Evidence 引用为普通 UUID 归档（不级联、只引用不复制 rawResponse —— Evidence 仍唯一事实源）。
  4) DATA_QUALITY_WARNING 总是最先（样本/成功率/PARTIAL/demo/混合提示）；同 severity 内恒排最前。
  5) Provider Gap 复用 M6 Reports compare：NOT_COMPARABLE → 400；仅 COMPARABLE 或仅
     Provider/模型差异的 PARTIALLY 才输出 PROVIDER_GAP（跨模型标注）。
  6) 幂等：同 (reportId, diagnosisVersion, secondaryReportId[null 等价]) 返回既有 DiagnosisRun。
- 模型/迁移：20260906135242_m7a_diagnosis（新增 DiagnosisRun/DiagnosisFinding/
  DiagnosisFindingEvidence + enum DiagnosisSeverity），geo_dev migrate dev + geo_test deploy
  + client generate（dll lock 按既有方法处理）；无 destructive。
- 引擎测试（geo-core）：diagnosis 29/29（severity boundary/priority 确定性/相同输入相同输出/
  DQ 恒先/CRTA/dominance/position/citation/sentiment/provider gap/comparison/无输入突变）；
  geo-core 合计 93/93。API e2e：diagnosis 14/14；全量 API e2e 102/102（9 suites）。
  修复 1 例环境耦合测试：multi-provider guard 的「未配置 400」前提在宿主 .env 已配置真实
  QWEN_API_KEY 时不成立 → 测试断言前显式清空 env（不是放宽业务断言）。
- UI（中文，check-ui-zh PASS）：/app/diagnosis 列表（测试集/数据类型/诊断版本/时间/计数/
  高·中·低·提示）+ /app/diagnosis/:id 详情（报告头/优先级分布/Finding 卡：标题/类型/场景/
  事实/解释/影响问题数/证据数/优先级分数/查看证据→EvidenceDialog rawResponse 下钻）；
  /app/reports 列表每行「生成 GEO 问题诊断」（幂等 POST → 跳详情）；工作台加入口；
  labels.ts 增 FINDING_TYPE/SEVERITY/DIAGNOSIS_NAV。web tsc + next build（隔离 .next-m7a）PASS。
- 真机 Demo（geo_dev，0 real calls，Engine duration 2ms）：6 条 mock Evidence(m4 分析) →
  Report → Diagnosis（6 findings：样本量较小 MEDIUM / 演示数据提示 INFO / 低推荐 LOW /
  位置偏后 LOW / comparison 场景缺口 LOW / 引用信号说明 INFO）→ Finding Evidence 下钻
  rawResponse 可读。demo 数据保留（m7a-demo-* 用户可登录查看），临时脚本/API 已清理。
- secret 扫描：仅单元测试占位符（sk-test-*/sk-m6d-e2e-fake-key）；无真实 Key/DB URL 入库、
  无 .env 入库（tracked 仅 .env.example）→ PASS。
- M7B TODO（下一里程碑，未开始）：Optimization Recommendations —— 基于诊断生成建议；
  届时可能引入 diagnosis v2 扩展类型；M7A 阈值 internal heuristic disclaimer 延续。
