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

## 下一阶段（M3）

- Redis + BullMQ 队列基础设施与 Worker 骨架。
- Config 包环境校验与 LLM Provider Adapter 骨架。
