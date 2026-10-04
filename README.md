<div align="center">

# 🌐 GeoLens (everyone-geo)

### Enterprise AI Visibility Intelligence Platform (GEO — Generative Engine Optimization)
**全流程可追溯的生成式引擎优化（GEO）监测、评测、诊断、内容生成与闭环归因平台**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15.5_(App_Router)-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-11.x-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis & BullMQ](https://img.shields.io/badge/Redis_%26_BullMQ-Async_Queue-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![DeepSeek](https://img.shields.io/badge/DeepSeek-Official_API-0066FF)](https://www.deepseek.com/)
[![Qwen](https://img.shields.io/badge/Qwen-Aliyun_Bailian-615EFF)](https://bailian.console.aliyun.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

<br />

[English Introduction](#key-features) · [功能特性](#-核心功能亮点) · [系统架构](#-系统架构与工作流) · [快速上手](#-快速启动指南) · [路线图](#-项目里程碑) · [文档中心](docs/)

<br />

<img src="docs/images/dashboard.png" alt="GeoLens Dashboard Overview" width="100%" style="border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,0.12);" />

</div>

---

## 📖 项目简介 (Introduction)

在生成式 AI 与 LLM（ChatGPT、DeepSeek、通义千问、Kimi、豆包等）重塑用户搜索与决策习惯的今天，传统基于网页排名的 **SEO（搜索引擎优化）** 正在加速演进为 **GEO（Generative Engine Optimization，生成式引擎优化）**。

当潜在客户向 AI 提问时：
- **AI 引擎是否会提及你的品牌与产品？**
- **提及的次序与推荐度如何？是正面认可还是被竞品截流？**
- **AI 采纳了哪些网页、百科、知识库作为引用证据源（Citations）？**
- **发布新的官网内容或文章后，AI 的认知是否真实发生了积极变化？**

**GeoLens** 是一个企业级、品牌无关（Product-Agnostic）的通用 GEO 监测与运营平台。GeoLens 坚决拒绝业内常见的“伪造提升分”与“黑盒猜测”，坚持**以证据唯一真实源（Immutable Raw Evidence）**驱动，构建了从「基准评测 ➔ 深度诊断 ➔ 优化建议 ➔ AI 内容生产 ➔ 多渠道发布 ➔ 闭环复测归因」的完整数字化生命周期。

---

## ✨ 核心功能亮点

### 1. 🎯 监测对象与智能问题集（Target Profile & Query Intelligence）
- **实体属性与别名映射**：支持管理主品牌名、官网域名、行业品类以及中英文别名/简称，构建高容错识别矩阵。
- **严格的问题语义分流**：
  - **自然发现问题（Discovery Queries）**：模拟真实用户无倾向提问（如“适合小团队的 CRM 工具有哪些？”），评估 AI 自然推荐率。
  - **品牌认知测试（Branded Sanity Queries）**：直接探测 AI 对品牌特性的认知深度与准确性。
- **🛡️ 严格防污染守卫（Target Contamination Guard）**：
  - 自动拦截在“自然发现问题”中误植入品牌词的行为，严防人为制造“虚高可见度”。

<div align="center">
  <img src="docs/images/queries.png" alt="Query Workspace" width="90%" style="border-radius: 8px; border: 1px solid #e5e7eb;" />
</div>

---

### 2. ⚡ 多模型基准监测与统一网关（Multi-Engine Benchmark）
- **真实 Provider 统一网关**：官方对接 **DeepSeek API**、**阿里云通义千问 (Qwen)**，兼容 OpenAI-Compatible 协议与高仿真 Mock 引擎。
- **身份真实解耦**：细分 `requestedModel` 与 `responseModel`，精准追踪路由别名与模型版本漂移。
- **不可变证据链（Immutable Raw Evidence）**：数据库触发器层死锁防护，AI 原始响应入库后严禁任何篡改；分析版本独立演进。
- **成本与安全守卫（Cost & Secret Guards）**：API Key 服务端完全隔离，任务级并发上限防护，杜绝账单爆炸与凭据泄露。

<div align="center">
  <img src="docs/images/benchmark.png" alt="Multi-Engine Benchmark" width="90%" style="border-radius: 8px; border: 1px solid #e5e7eb;" />
</div>

---

### 3. 📊 GEO 深度报告与多维指标体系（Deep Analytics & Reports）
- **五大核心科学指标**：
  - **AI 可见度（AI Visibility）**：品牌在有效发现问题中的出现比例。
  - **声量份额（Share of Voice - SoV）**：品牌与竞品在 AI 回答中提及次数的综合占有率。
  - **强推荐率（Recommendation Rate）**：被 AI 作为首推或重点选项推荐的频次占比。
  - **平均提及位次（Average Position）**：品牌在列表推荐中的排序位置。
  - **权威引用占有率（Citation Share）**：品牌官网及受控资产在 AI 附录参考链接中的占比。
- **竞品自动发现（Competitor Discovery）**：基于真实 AI 回复自动归纳高频同屏竞品，支持人工一键标记与声量矩阵核算。
- **报告版本冻结与跨模型对比**：支持模型横向比对（如 DeepSeek vs Qwen）及不同周期版本的 Delta 差异对账。

<div align="center">
  <img src="docs/images/reports.png" alt="GEO Analytics Report" width="90%" style="border-radius: 8px; border: 1px solid #e5e7eb;" />
</div>

---

### 4. 🩺 GEO 诊断与优化建议工作台（Diagnosis & Recommendations）
- **多维度问题诊断**：自动归类“未提及/可见度低”、“竞品截流严重”、“负面评价/事实偏差”、“权威引用缺失”等典型瓶颈。
- **可落地执行建议**：精准输出高 ROI 的行动方向（官网核心语义增强、权威第三方媒体发稿、结构化问答/Schema 标记沉淀）。
- **行动中心（Action Center）**：为新手与企业运营团队提供直观的任务清单，引导 1 小时内跑通首轮优化。

<div align="center">
  <img src="docs/images/diagnosis.png" alt="GEO Diagnosis" width="90%" style="border-radius: 8px; border: 1px solid #e5e7eb;" />
</div>

---

### 5. ✍️ AI 内容引擎 V2 与多渠道分发（Content Engine & Distribution）
- **事实锚定（Fact Grounding）与声明守卫（Claim Guard）**：确保 AI 生成的营销与技术内容严格基于品牌事实，严控幻觉与虚假承诺。
- **战役日历与生产队列**：支持从 GEO 机会直接立项，管理草稿、评审、定时排期到发布全周期。
- **多平台连接器（Multi-Channel Connectors）**：
  - **WordPress 连接器**：支持文章草稿箱隔离与直接发布。
  - **微信公众号连接器**：官方草稿箱无缝同步、幂等校验防重发。
  - **通用渠道适配器**：预留小红书、知乎、知网等平台扩展接口。
- **视觉 Brief 工作台**：自动为各平台文章配套生成针对性的视觉图片创作提示与排版规范。

<div align="center">
  <img src="docs/images/content.png" alt="AI Content Engine" width="90%" style="border-radius: 8px; border: 1px solid #e5e7eb;" />
</div>

---

### 6. 🔄 闭环复测与科学归因（Retest & Outcome Attribution）
- **基准快照一键复测（Frozen Snapshot Re-run）**：严格锁定前次评测的问题指纹（SHA-256）与配置，杜绝因为问题漂移造成的指标假象。
- **站点资产版本化（Site Asset Before/After Snapshot）**：完整留存内容发布前后的页面快照与哈希值。
- **科学效果对比与归因置信度**：
  - 自动输出真实 Δ 增量（Visibility Δ、Position Δ、Citation Δ）。
  - 诚实输出置信度评级（High / Medium / Low / Inconclusive），坚决不夸大单一发布动作的作用。

<div align="center">
  <img src="docs/images/verification.png" alt="Closed-loop Verification" width="90%" style="border-radius: 8px; border: 1px solid #e5e7eb;" />
</div>

---

## 🏛️ 系统架构与工作流

### 业务数据闭环

```mermaid
flowchart TD
    A[创建项目 & 监测对象<br/>Brand / Domain / Aliases] --> B[智能生成/导入问题集<br/>Discovery vs Branded Sanity]
    B --> C[Target Contamination Guard<br/>防污染中立性审查]
    C --> D[多模型并发监测任务<br/>DeepSeek / Qwen / API-Plain]
    D --> E[(不可变 Raw Evidence<br/>DB Trigger 严格防篡改)]
    E --> F[确定性分析引擎<br/>Mention / Position / Citation / Sentiment]
    F --> G[生成基准报告 & 诊断建议<br/>Visibility / SoV / Recommendations]
    G --> H[AI 内容引擎 V2 & 生产队列<br/>Fact Grounding & Claim Guard]
    H --> I[多渠道发布连接器<br/>WordPress / 微信公众号草稿箱]
    I --> J[冻结基准快照一键复测<br/>Frozen Snapshot Retest]
    J --> K[科学归因与前后效果比对<br/>Outcome Attribution & Delta]
```

### Monorepo 代码架构

```
everyone-geo (geo-platform)
├── apps/
│   ├── web/           # Next.js 15 (App Router) + Tailwind CSS v4 + 响应式精美工作台
│   ├── api/           # NestJS 11 RESTful 后端服务 + OpenAPI / Swagger + JWT 鉴权
│   └── worker/        # BullMQ 异步任务消费 Worker + 自动恢复 + 幂等重试机制
├── packages/
│   ├── database/      # Prisma ORM + PostgreSQL 17 架构 + 数据库触发器 + 种子迁移
│   ├── geo-core/      # 纯函数 GEO 计算核心：指标计算、污染检测、快照对比、中立性审计
│   ├── llm/           # 统一 Provider 抽象网关（DeepSeek, Qwen, Mock Provider）
│   └── queue/         # Redis / BullMQ 强类型任务契约与调度配置
├── docs/              # 完整的架构、设计决策与用户指南文档
│   ├── USER_GUIDE.md  # 详细用户使用手册
│   ├── ARCHITECTURE.md# 架构设计与不可变证据链标准
│   └── images/        # 高清界面展示图
└── scripts/           # 自动化诊断、环境检查与一键启动脚本
```

---

## 🚀 快速启动指南

### 1. 环境准备 (Prerequisites)
- **Node.js**: `24.x`（推荐）或 `>= 20.18.0`
- **Package Manager**: `pnpm >= 10.0.0`
- **Container**: `Docker Desktop`（用于一键启动 PostgreSQL 17 与 Redis 7）

---

### 2. 本地一键启动（全自动开发控制中心）

如果你在 **Windows** 环境下，仓库提供了开箱即用的快捷脚本（无需记忆复杂命令）：

```powershell
# 1. 启动全套服务（自动启动 Docker 容器、后端 API、前端 Web、异步 Worker 并打开控制中心）
.\START_GEOLENS.cmd

# 2. 查看当前运行状态与 Milestone 进度
.\STATUS_GEOLENS.cmd

# 3. 停止前端与后端进程（保持 Docker 数据库持续运行）
.\STOP_GEOLENS.cmd
```

服务就绪后，浏览器将自动打开控制面板：
- **项目控制中心**：`http://localhost:3000/dev/status`
- **GeoLens 工作台**：`http://localhost:3000/app`
- **Swagger API 文档**：`http://localhost:3001/docs`

---

### 3. 标准手动部署流程

```bash
# 1. 克隆代码仓库
git clone https://github.com/tahffo68hk-hash/everyone-geo.git
cd everyone-geo

# 2. 安装项目依赖
pnpm install

# 3. 配置环境变量
cp .env.example .env
# 建议检查并修改 .env 中的 POSTGRES_PASSWORD, JWT_SECRET
# 如需启用真实模型，可填入 DEEPSEEK_API_KEY 或 QWEN_API_KEY

# 4. 启动基础容器（PostgreSQL & Redis）
docker compose up -d

# 5. 执行数据库迁移与初始化种子数据
pnpm --filter @geo/database migrate
pnpm --filter @geo/database db:seed

# 6. 启动所有服务（Web + API + Worker 并发运行）
pnpm dev
```

#### 默认开发演示账号
| 角色 | 邮箱 | 初始密码 |
| :--- | :--- | :--- |
| **项目负责人 / 演示用户** | `alice@geolens.local` | `Password123!` |

---

## ⚙️ 环境变量说明 (.env)

| 变量名 | 默认值 / 示例 | 说明 |
| :--- | :--- | :--- |
| `POSTGRES_DB` | `geo_dev` | 数据库名称 |
| `POSTGRES_USER` | `geolens` | 数据库用户名 |
| `POSTGRES_PASSWORD` | `change_me_to_a_random_dev_password` | 数据库密码 |
| `DATABASE_URL` | `postgresql://geolens:...@127.0.0.1:5432/geo_dev?schema=public` | Prisma 主连接串 |
| `REDIS_URL` | `redis://127.0.0.1:6379` | BullMQ 队列 Redis 连接地址 |
| `JWT_SECRET` | *(64位随机Hex字符串)* | 用户认证 Token 签名密钥 |
| `ENABLE_REAL_PROVIDERS` | `false` | 是否开启真实外联 AI Provider（默认关闭使用 Mock） |
| `REAL_PROVIDER_MAX_RUNS_PER_TASK` | `3` | 单个任务调用真实 API 的上限限制（成本保护） |
| `DEEPSEEK_API_KEY` | *(留空或填入你的 API Key)* | DeepSeek 官方 API 鉴权密钥 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek API 端点 |
| `QWEN_API_KEY` | *(留空或填入你的 DashScope Key)* | 通义千问 DashScope API 密钥 |

---

## 🧪 测试与质量验证

项目遵循严苛的代码测试标准，内置单元测试、集成测试、契约守卫与端到端测试：

```bash
# 运行全库单元测试与核心算法验证 (geo-core: 240+ 单测通过)
pnpm --filter @geo/core test

# 运行后端 API 端到端集成测试 (NestJS e2e)
pnpm --filter @geolens/api test:e2e

# 运行异步 Worker 容错与恢复测试 (30+ 集成测试用例)
pnpm --filter @geolens/worker test

# 前端生产打包验证
pnpm --filter @geolens/web build
```

---

## 🗺️ 项目里程碑进度 (Milestones)

- [x] **M0: Foundation** — Monorepo 骨架、TypeScript 5.5+、配置工程化
- [x] **M1: Web + API** — Next.js 15 App Router 与 NestJS 11 联调底座
- [x] **M2: Database & Multi-Tenant** — PostgreSQL 17 + Prisma 级联外键与多租户隔离
- [x] **M3: Async Worker Engine** — BullMQ + Redis 确定性 JobId、指数退避重试与宕机自愈
- [x] **M4: GEO Analysis & Evidence** — 不可变 Raw Evidence 触发器防护、Mention/Position/Citation 5维算法
- [x] **M5: DeepSeek Real Provider** — 官方 API 直连、真实用量存证、成本守卫与密钥安全隔离保护
- [x] **M6: Benchmark & Multi-Provider** — Qwen 接入、requested vs response 身份解耦、竞品自动发现
- [x] **M7: Diagnosis & Optimization** — 智能 GEO 诊断、结构化建议生成、实验评测体系
- [x] **M8: Target Profile & Pilot Workspace** — 监测对象别名、Target Contamination Guard、站点资产 Before/After 快照
- [x] **M9: AI Content Engine V2** — 事实锚定 (Fact Grounding)、声明守卫、WordPress & 微信多渠道发布
- [x] **M10: Lineage & Outcome Attribution** — 冻结快照一键复测、归因置信度模型、真实增量 Δ 对账
- [x] **M11: Design & UX Polish** — 现代化 Apple 风格交互质感、响应式适配、Action Center 快速上手

---

## 📄 开源许可证 (License)

本项目基于 [MIT 许可证](LICENSE) 开源。欢迎自由学习、研究与商用落地。

---

<div align="center">
  <sub>Built with precision for the Generative Engine Optimization era. 🌟 If you find this project helpful, give it a star!</sub>
</div>
