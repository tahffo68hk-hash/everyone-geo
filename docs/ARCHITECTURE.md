---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 15ce975b5f313de8edfa891b974a2219_e76797d8a8c311f1be88525400aeaaa3
    ReservedCode1: SPWN5FQ1ee5ENaq027fFz23fXnsFn107llVzj2MpO5USzmAtirQRA9eeVOwKHX3Zp/b6Jtz7plyA+WoYLPXmdyP7FAwtIVGBlfALxe+lb2MTcsB0WAa0EBwiDeBxY6D31ISRn9bROdBujwoHcMMpDj/BhRIaOCnrxmePZX3yn2TYsYY2hGCI6dAGlgE=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 15ce975b5f313de8edfa891b974a2219_e76797d8a8c311f1be88525400aeaaa3
    ReservedCode2: SPWN5FQ1ee5ENaq027fFz23fXnsFn107llVzj2MpO5USzmAtirQRA9eeVOwKHX3Zp/b6Jtz7plyA+WoYLPXmdyP7FAwtIVGBlfALxe+lb2MTcsB0WAa0EBwiDeBxY6D31ISRn9bROdBujwoHcMMpDj/BhRIaOCnrxmePZX3yn2TYsYY2hGCI6dAGlgE=
---

# GeoLens 架构设计（第一版）

> 项目：D:\dev\geo-platform ｜ 代号：GeoLens: AI Visibility Intelligence
> 技术决策以 docs/DECISIONS.md 为准，本文件为总体架构视图。

## 1. 设计目标

- **数据可信**：一切 GEO 结论可追溯到原始 Evidence（Raw Prompt / Raw Response / 元数据）。
- **结构清晰**：Monorepo 分层，业务逻辑与基础设施解耦。
- **演进友好**：为 GEO Preference Lab（Experiment / PreferencePair / Preference Model）预留数据基础。
- **Clean-room**：仅吸收竞品/开源项目的已验证逻辑，用 TypeScript 独立重写，不复制商业源码。

## 2. 系统拓扑（V0.1）

```
[Next.js Frontend apps/web]
        │ REST / JSON
        ▼
[NestJS API apps/api] ────────► PostgreSQL (Prisma)
        │                        ▲
        │ JWT / HttpOnly Cookie  │
        ▼                        │
[BullMQ Queue (Redis)]
        │
        ▼
[Worker apps/worker] ──► LLM Providers (Adapter)
        │                        │
        ▼                        ▼
  Response 持久化          Mock / DeepSeek / OpenAI-Compatible / Qwen / Kimi ...
        │
        ▼
  分析层（规则 + LLM Judge）→ Mention/Position/Recommendation/Citation/Sentiment
        │
        ▼
  ESG 指标（AI Visibility / SoV / Recommendation Rate / Citation Share）→ Dashboard
```

## 3. 分层职责

| 层 | 位置 | 职责 |
|---|---|---|
| apps/web | Next.js | 页面、Dashboard、Evidence Drawer、图表（ECharts/Recharts） |
| apps/api | NestJS | 业务 API、认证、任务编排入口、OpenAPI 文档 |
| apps/worker | NestJS/BullMQ | 消费队列、调用 LLM、执行分析、持久化响应 |
| packages/shared | TS | DTO、枚举、类型共享 |
| packages/config | TS | 环境配置装载、校验 |
| packages/llm | TS | LLMProvider 统一接口 + 各 Provider 实现 |
| packages/geo-core | TS | GEO 指标计算、分析规则、Query 生成逻辑 |
| packages/database | TS/Prisma | Schema、Prisma Client、migration、seed（M2 已落地）；api/worker 统一经 `@geo/database` 全局单例访问 |
| packages/ui | React | shadcn/ui 基础组件（供 web 复用） |

## 4. 核心架构决策摘要

1. **统一 LLM Provider Interface**，业务代码不直接 `fetch` 任何模型 API。
2. **Run / Response 不可变**：每次监测是独立 Observation，旧结果永不覆盖。
3. **Evidence 全字段持久化**：raw_prompt / raw_response / citations / retrieval_mode / source_type 等。
4. **retrieval_mode 与 AI Engine 分离**：`DeepSeek Web ≠ DeepSeek API`，model 与 engine 分开建模。
5. **任务异步化**：批量监测走 Queue → Worker，前端轮询进度（Pending/Running/Completed/Failed/Partial）。
6. **分析层先规则 + LLM Judge**，暂不引入复杂模型。
7. **GEO Score 标注为"平台内部评估指标"**，不声称行业标准。

## 5. 数据模型总览（详见 packages/database/schema.prisma）

`User, Organization, OrganizationMember, Project, Brand, Competitor, Query, QuerySet, Engine, Model,
MonitorTask, Run, Response, Mention, Citation, ContentAsset, Experiment, PreferencePair,
Report, PromptTemplate, CreditLedger`

> **M2 已落地（迁移 `init`）**：`User / Organization / OrganizationMember / Project / Brand / Competitor / QuerySet / Query` 共 8 张表；
> 其余为后续里程碑规划，统一按 D-009 补充 schema 后迁移。

核心链路：

```
User ─ Organization ─ Project ─ Brand / Competitor
        │
        ├─ QuerySet ─ Query
        │
        ├─ MonitorTask ─ Run ─ Response ─ Mentions / Citations
        │
        └─ Experiment ─ PreferencePair
```

## 6. 关键链路：一次 GEO 监测

1. 用户创建 Project/Brand，生成 QuerySet（Mock 或 LLM）。
2. 创建 MonitorTask（Query × Engine 组合）。
3. API 写入 MonitorTask 与 Run 记录 → 入 BullMQ。
4. Worker 消费任务，经 LLMProviderAdapter 调用模型，得到 Raw Response。
5. Worker 执行分析（规则 + LLM Judge），生成 Mention / Citation 记录。
6. 更新 Run 状态与 MonitorTask 进度。
7. 前端轮询 → 计算指标 → Dashboard / Insights / Reports。

## 7. 安全与合规

- 密码 Argon2/Bcrypt；JWT 走 HttpOnly Cookie。
- API Key 只存环境变量，`.env` 加入 `.gitignore`，提供 `.env.example`。
- 不调用未授权的付费 API；默认 Mock Provider。
- 不保存商业网站私有代码；references/ 仅存公开资料与自研分析。

## 8. 未来方向（GEO Preference Lab）

- Experiment → ContentAsset(A/B) → Run → Response → PreferencePair(A>B)。
- 目标：构建 GEO Preference Dataset 与 GEO Preference Model。
- 当前只需保证数据模型与 Evidence 结构能承载该演进。
## 9. M5 更新（Real LLM Provider Integration，2026-09-05）

- `packages/llm`（@geo/llm）正式落地：`LLMProvider` 统一接口 + `LLMProviderRegistry`
  + `MockProvider`（本地仿真，自 worker 迁移）+ `DeepSeekProvider`（官方 API，V1）。
- Worker 只 `resolve → execute → persist Evidence`；Provider 具体 HTTP 协议不再外泄。
- DeepSeek V1：`sourceType=official_api`、`retrievalMode=api_plain`（DeepSeek API ≠ 搜索产品）；
  真实调用默认关闭（`ENABLE_REAL_PROVIDERS=false`）+ 单任务真实 Run 上限。
- Metrics 数据完整性：`metricSource=demo|real|mixed`，Demo 数据不污染真实 GEO 指标。
- 详见 `docs/LLM_PROVIDERS.md`、`docs/WORKBUDDY_M5_HANDOFF.md`。
*（内容由AI生成，仅供参考）*
