# 数据库卫生审计（2026-09-05）

审计来自原 geolens 的只读查询及当前 seed/auth/verify 源码。原库保留，全部数据复制至 geo_dev；没有清除任何历史开发数据。

## 11 个组织

时间为 PostgreSQL 存储的 UTC；下表所有记录的 updatedAt 与 createdAt 相同。

| id | name | slug | createdAt = updatedAt | 来源判断 |
|---|---|---|---|---|
| 80c955fd-ba65-4a28-ad96-b669d2a6432e | GeoLens Dev Org | geolens-dev | 2026-09-05 01:16:17.160 | M2 seed，固定 slug |
| d96d6c24-3ca8-4069-bb8d-bdbb5ab0f474 | Acme Test Org | acme-dev | 2026-09-05 03:15:19.315 | 双租户 seed，固定 slug |
| a34f354f-88a0-4746-843d-1dd53f013693 | Org A 2rpg8o4w | org-a-2rpg8o4w | 2026-09-05 03:40:34.204 | 第一轮 auth e2e，a-2rpg8o4w@m3.test |
| 6ded9398-a7f0-488a-985d-716395a0bde2 | Org B 2rpg8o4w | org-b-2rpg8o4w | 2026-09-05 03:40:34.298 | 第一轮 auth e2e，b-2rpg8o4w@m3.test |
| 0dae28a1-f081-4354-a197-5ea3417db9ce | Carol Org | carol-org | 2026-09-05 03:40:34.358 | 第一轮 auth e2e，c-2rpg8o4w@m3.test |
| f484c2be-894a-4292-b882-6c494f4d09f3 | Org A 4ufzp8uu | org-a-4ufzp8uu | 2026-09-05 04:36:33.675 | 第二轮 auth e2e，a-4ufzp8uu@m3.test |
| fa32410e-ab47-42b5-a732-d972cd71d77d | Org B 4ufzp8uu | org-b-4ufzp8uu | 2026-09-05 04:36:33.736 | 第二轮 auth e2e，b-4ufzp8uu@m3.test |
| c1d33a91-b36c-4486-9030-5cf3cf592a1c | Carol Org | carol-org-79rj | 2026-09-05 04:36:33.803 | 第二轮 auth e2e，c-4ufzp8uu@m3.test |
| 339764ed-3f8f-4be3-95c8-7608c567ee41 | Org A uk6fg3f6 | org-a-uk6fg3f6 | 2026-09-05 06:03:19.371 | 第三轮 auth e2e，a-uk6fg3f6@m3.test |
| f6667bbd-2dbf-4c1d-9d91-86be1745a600 | Org B uk6fg3f6 | org-b-uk6fg3f6 | 2026-09-05 06:03:19.432 | 第三轮 auth e2e，b-uk6fg3f6@m3.test |
| fe31031f-1353-4c11-8a8c-6572acac8ea8 | Carol C uk6fg3f6 | carol-c-uk6fg3f6 | 2026-09-05 06:03:19.496 | 第三轮 auth e2e，c-uk6fg3f6@m3.test |

## 根因与证据边界

- 数量吻合：2 个 seed 组织 + 3 轮 × 3 个注册组织 = 11。seed 的 3 个用户 + 9 个测试用户 = 12。2 个 seed 项目 + 三轮遗留的 Project B = 5。
- `auth/register` 在一个事务内创建 User、Organization 和 OWNER membership。事务成功会提交，不会因为调用方是测试自动回滚。
- 原 `auth.e2e-spec.ts` 明确直连开发库，beforeAll 经 HTTP 注册 A/B，测试用例注册 C，另在事务外创建 A/B 项目。afterAll 只删除 Project A，然后断开连接；其余数据留下。
- 第一、二轮 Carol 名称与当前源码不同，但邮箱随机后缀、时间相邻、A/B 项目名形成一致证据，极可能来自较早版本的同一测试。没有执行审计日志，不能证明具体由哪位人或哪个终端运行；没有证据表明这些是手动业务数据。
- `verify.ts` 的重复 slug 插入预期失败，临时关联数据在事务末尾回滚。它不是这 9 条组织的来源，但原来直接使用 DATABASE_URL，且独立约束探针在约束失效时可能真的写入、删除开发数据，因此必须隔离。
- seed 以固定 email/slug 和组织内项目名复用记录，连续正常运行数量应保持不变；旧实现并非整段事务，异常中断可能留下不完整子数据。本次增加原子事务并使用项目复合唯一键。密码 hash 会刷新，因此“幂等”指记录集合/数量而非所有字节不变。

## 隔离约定

开发只用 DATABASE_URL → geo_dev；测试必须显式配置 TEST_DATABASE_URL → geo_test。测试入口先加载硬保护，拒绝缺失、无效或非 geo_test URL，再创建 Prisma 客户端。严格等于 geo_test 比仅包含 _test 更强。不得回退到开发 URL。

原 geolens 保留为迁移时数据副本；geo_postgres_data 卷保持不变。测试使用自己创建的 fixture，清理限定于该次运行的 ID。verify、测试 seed 和集成测试不能指向 geo_dev。

验证记录追加于本文末尾；开发库前后以八张基础表的 count + 完整行 SHA-256 对比，避免仅数量一致掩盖数据修改。

## M2.5 实测结果

- Node 24.20.0、pnpm 11.1.0，冻结安装与干净递归构建通过。API 排除 test 编译后产物为 dist/main.js。
- geo_test seed 三次均为 Organization=2 / User=3 / Project=2；其余记录数也不增长。verify 全部通过，auth 13/13，URL 保护 15/15。
- geo_dev 测试前后八张基础表 count 与 SHA-256 完全相同（Organization=11 / User=12 / Project=5）。
- geo_dev migration status 为 up to date。React 与 ReactDOM 均唯一版本 19.2.8。
- 现有系统 pnpm.cmd 内部绑定相邻 Node 25，需 dot-source scripts/use-node24.ps1；函数用项目 Node 24 调用现有 pnpm CLI，不改系统安装。
