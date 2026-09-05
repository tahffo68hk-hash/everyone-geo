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

## 下一阶段（M2）

- 数据库 schema 与迁移：User / Organization / Project / Brand / Competitor / Query / QuerySet。
- 设置 PostgreSQL 与 Prisma。
