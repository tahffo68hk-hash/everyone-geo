# GeoLens 快速开始

`/app/quick-start` 提供从品牌资料到检测证据、优化建议和分发草稿的向导。它直接使用当前账号的组织和正式项目数据；新建时会在所选组织中复用同名品牌项目，或创建项目、品牌和 Query Set。也可从项目工作台进入，快速开始记录会关联到该项目。

## 流程与数据

1. 填写品牌，按需确认行业、官网和竞品。
2. 生成 8–12 个发现型和品牌型问题，编辑确认后写入正式 Query Set；删除的问题会归档。
3. 逐条执行 Provider 请求并保存原始回答。Mock 不访问外部服务；DeepSeek、Qwen 仅在用户确认后调用。检测失败不会自动重试。
4. 报告统计只使用成功保存的回答；建议和内容生成会保留与回答证据的关联。
5. 保存内容后可创建分发任务。当前任务状态是“待人工复核”，表示草稿已进入工作台，不表示平台已发布。

快速开始的数据存放在 GeoLens 的 PostgreSQL/Prisma 数据库中，与 Project、Brand、Competitor、Query Set 和 Query 关联。工作台在 `/app/projects/:id` 可继续查看正式项目资料。

## Provider 配置

默认 Provider 是 Mock，不需要 API Key。真实模型密钥只在 API 服务环境配置：

- DeepSeek：`DEEPSEEK_API_KEY`
- Qwen / DashScope：`DASHSCOPE_API_KEY`

真实请求使用固定的官方 OpenAI 兼容端点。页面按请求展示确认和调用次数；费用无法预估时显示为未知。真实模型结果不代表联网搜索或公开发布。

## 数据库变更

首次部署时按常规流程应用 `packages/database/prisma/migrations/20261019000000_quick_start/migration.sql`，然后重新生成 Prisma Client 并构建 API。迁移新增快速开始会话、检测运行、原始回答、报告、证据关联、内容生成历史和分发草稿记录；不新增认证、组织、发布执行器或公开发布状态。

## 验证

API 单元与权限测试：

```bash
pnpm --filter @geolens/api test:quick-start
```

测试需要一个独立的测试数据库。不要对生产或含真实用户数据的数据库运行迁移或端到端流程。
