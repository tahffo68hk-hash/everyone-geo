# GeoLens — AI Visibility Intelligence

> 开发代号 GeoLens，项目根目录 `V:\geo-platform`

基于 Node.js / TypeScript 自研的 **GEO（Generative Engine Optimization）监测数据平台**。
目标不是复制任何现有商业系统或开源项目，而是吸收已被验证的产品逻辑，
用更清晰的结构、更可信的数据闭环重新实现，并为未来 **GEO Preference Lab / GEO Preference Model** 预留数据基础。

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
V:\geo-platform
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

## 运行

```bash
pnpm install
pnpm dev            # 同时启动 web + api
pnpm dev:web        # 仅前端
pnpm dev:api        # 仅后端
```
