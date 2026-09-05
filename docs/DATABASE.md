# GeoLens 数据库说明（DATABASE）

## 概览

- 引擎：PostgreSQL 17（Docker Compose，镜像 `postgres:17-alpine`）
- ORM：Prisma（schema 单一事实来源：`packages/database/prisma/schema.prisma`）
- 客户端：`@geo/database` 导出的全局 PrismaClient 单例

## 启动数据库

```bash
docker compose up -d
```

- 服务名 `db`，容器名 `geo-postgres`，映射 `127.0.0.1:5432`
- 数据保存在 named volume `geo_postgres_data`，`docker compose down` **不会**删除数据
  （如需重置数据：`docker compose down -v`，此操作会清空数据库，谨慎使用）

## 环境变量

根目录 `.env`（已被 .gitignore 忽略，模板见 `.env.example`）：

```
DATABASE_URL=postgresql://geolens:<password>@127.0.0.1:5432/geolens?schema=public
```

## 常用命令（在 packages/database 目录）

```bash
# 生成 Prisma Client（schema 变更后执行）
pnpm generate

# 开发迁移（创建或应用 migration，自动触发 generate）
pnpm migrate -- --name <migration_name>

# 生产/部署迁移（只应用已有 migration）
pnpm deploy

# 种子数据（最小演示数据，幂等可重入）
pnpm db:seed

# 验收/回归验证（关系链 + 唯一约束 + FK 删除策略）
pnpm verify
```

> 注：`prisma migrate dev` 与 `prisma db seed` 需在本地 shell 中注入 `DATABASE_URL`（从根 `.env` 读取）。

## 数据模型（M2 迁移 init，8 张表）

| 模型 | 说明 | 关键约束 |
|---|---|---|
| User | 用户 | email 唯一 |
| Organization | 组织（多租户边界） | slug 唯一 |
| OrganizationMember | 成员关系 | (userId, organizationId) 唯一；role=OWNER/ADMIN/MEMBER |
| Project | 项目（品牌官网/行业等） | (organizationId, name) 唯一 |
| Brand | 品牌 | 唯一名称约束 |
| Competitor | 竞对 | 唯一约束（名称+所属组） |
| QuerySet | 查询组 | — |
| Query | 查询词 | type=BRAND/COMPETITOR/CUSTOM；text 唯一 |

### FK 删除策略

- Organization → Project：**Restrict**（存在项目时禁止删除组织）
- Project → Brand / Competitor / QuerySet：**Cascade**（删除项目级联删除）
- QuerySet → Query：**SetNull**（删除查询组保留历史 Query）

## 访问方式（apps/api）

`@geo/database` 提供全局单例（`packages/database/src/index.ts`）：

```ts
import { prisma, PrismaClient } from "@geo/database";
// 或经 NestJS 注入：constructor(private readonly prisma: PrismaService) {}
```

> 注意：V 盘为 exFAT，workspace 交叉依赖（apps/api → @geo/database）无法使用 symlink，
> 已通过 `apps/api/scripts/link-database.cjs`（postinstall 自动拷贝）解决，详见 DECISIONS D-010。
> 本适配仅影响包安装方式，不影响上述 import 用法。
