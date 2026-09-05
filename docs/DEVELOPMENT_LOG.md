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
