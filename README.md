---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 15ce975b5f313de8edfa891b974a2219_eb375323a8c311f188bd525400287e28
    ReservedCode1: EvSBdfhDTP9L1m+EJt/VJ5jT9G5ZNdzugqzsXeHptE7vzFTrS81Sf6lIFRrLaNhhAfWB6XWAOXWN92R2MfAOGnN3KCnO8YN15cvD81OnBnKMtQDDg/+deULH8lDOI5BYNLj6WY5FJ6arpDnG62/w3mopN/+aoE8Rj8UhUv6Wr+A+bhxCv9t0TEWGZv8=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 15ce975b5f313de8edfa891b974a2219_eb375323a8c311f188bd525400287e28
    ReservedCode2: EvSBdfhDTP9L1m+EJt/VJ5jT9G5ZNdzugqzsXeHptE7vzFTrS81Sf6lIFRrLaNhhAfWB6XWAOXWN92R2MfAOGnN3KCnO8YN15cvD81OnBnKMtQDDg/+deULH8lDOI5BYNLj6WY5FJ6arpDnG62/w3mopN/+aoE8Rj8UhUv6Wr+A+bhxCv9t0TEWGZv8=
---

# GeoLens — AI Visibility Intelligence

> 开发代号 GeoLens，项目根目录 `D:\dev\geo-platform`

基于 Node.js / TypeScript 自研的 **GEO（Generative Engine Optimization）监测数据平台**。
目标不是复制任何现有商业系统或开源项目，而是吸收已被验证的产品逻辑，
用更清晰的结构、更可信的数据闭环重新实现，并为未来 **GEO Preference Lab / GEO Preference Model** 预留数据基础。

## 非开发者快速启动（One-Click Dev Control Center，DX1）

> 项目负责人/审核人不需要记任何 pnpm 命令，也不需要打开多个终端。

1. **双击** `START_GEOLENS.cmd`
   —— 自动检查 Node 24 / Docker → 启动 PostgreSQL + Redis → 启动 API / Worker / Web
   → 自动打开浏览器：**http://localhost:3000/dev/status**（GeoLens Project Control Center）。
2. 在 Control Center 查看：当前做到哪个 Milestone、各组件是否健康、可演示功能入口、真实验证结论。
3. 停止：双击 `STOP_GEOLENS.cmd`（只停 Web/API/Worker，PostgreSQL/Redis/Docker 保留）。
4. 状态：双击 `STATUS_GEOLENS.cmd`（实时一览 + 按任意键打开 Control Center）。

- 机器可读项目状态：`project-status.json`（根目录，每个 Milestone 完成时由 Agent 更新）。
- 进程/日志管理：`.runtime/`（PID 文件 + `logs/` 详细日志 + `status.json` 快照），已被 .gitignore 忽略。
- 详细设计见 [docs/DX1_CONTROL_CENTER.md](docs/DX1_CONTROL_CENTER.md) 与 [docs/DEVELOPMENT_WORKFLOW.md](docs/DEVELOPMENT_WORKFLOW.md)。

## 产品优先级（自上而下）

1. 真实数据闭环
2. Evidence 可追溯
3. 多模型监测
4. 分析能力
5. 内容优化
6. 渠道投放
7. 营销型功能

## V0.1 核心目标：跑通企业 GEO 监测闭环

```
创建项目(品牌/官网/行业/竞对)
  → 生成 Query → 用户选择
  → 批量询问多个 AI
  → 保存 Raw Response(Evidence)
  → 分析(Mention/Position/Recommendation/Citation/Sentiment)
  → 计算(AI Visibility / Share of Voice / Recommendation Rate / Citation Share)
  → Dashboard → GEO 优化建议
```

## Monorepo 结构

```
D:\dev\geo-platform
├─ apps
│  ├─ web        Next.js 前端
│  ├─ api        NestJS API
│  └─ worker     BullMQ 后台任务
├─ packages
│  ├─ ui
│  ├─ shared
│  ├─ config
│  ├─ llm
│  ├─ geo-core
│  └─ database   PostgreSQL + Prisma
├─ docs
├─ references
└─ scripts
```

## 技术栈

- TypeScript / Node.js 20+ / pnpm workspace
- 前端：Next.js + React + Tailwind CSS + shadcn/ui + ECharts/Recharts
- 后端：NestJS + REST API + OpenAPI
- 数据库：PostgreSQL + Prisma
- 队列：Redis + BullMQ（Repeatable Jobs）
- 认证：NestJS JWT + HttpOnly Cookie + Argon2/Bcrypt
- LLM：统一 Provider Adapter（Mock / DeepSeek / OpenAI-Compatible / Qwen / Kimi / Doubao / Zhipu ...）
- 浏览器自动化：Playwright
- 日志：Pino；测试：Vitest + Playwright

## 文档

- [架构设计](docs/ARCHITECTURE.md)
- [产品地图](docs/PRODUCT_MAP.md)
- [开发日志](docs/DEVELOPMENT_LOG.md)
- [决策记录](docs/DECISIONS.md)
- [数据库说明](docs/DATABASE.md)

## 运行

```bash
pnpm install

# 启动数据库（PostgreSQL，需先安装 Docker Desktop）
docker compose up -d
# 首次：迁移 + 种子（在 packages/database 下执行）
pnpm --filter @geo/database migrate
pnpm --filter @geo/database db:seed

pnpm dev            # 同时启动 web + api
pnpm dev:web        # 仅前端
pnpm dev:api        # 仅后端
```
*（内容由AI生成，仅供参考）*

## 当前开发环境（M2.5）

正式路径 D:\dev\geo-platform。每次 PowerShell 会话先执行：

```powershell
. .\scripts\use-node24.ps1
node -v # v24.20.0
pnpm.cmd -v # 11.1.0
pnpm.cmd install --frozen-lockfile
pnpm.cmd -r build
pnpm.cmd --filter @geolens/api start
# 另一个终端
pnpm.cmd --filter @geolens/web start
```

DATABASE_URL 指向 geo_dev；TEST_DATABASE_URL 指向 geo_test。历史数据库 geolens 保留，迁移不是重新 seed。详见 docs/DATA_HYGIENE.md。
