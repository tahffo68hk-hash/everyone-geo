# GeoLens 关键架构决策记录（DECISIONS）

> 每做关键架构/产品决策即追加一行，做反向决策时标注"已废弃"。

## D-001 技术栈锁定（2026-09-05）
- 决策：TypeScript + Node.js 20+ + pnpm workspace + Next.js + NestJS + PostgreSQL/Prisma + Redis/BullMQ。
- 理由：全栈 TS 统一心智；结构化后端适合数据平台；不选 PHP/Java/Django/WordPress/低代码。
- 影响：整个 monorepo 围绕该栈搭建。

## D-002 Clean-room 实现（2026-09-05）
- 决策：吸收竞品与开源项目的**已验证产品逻辑**，不复制任何商业源码；GPL/AGPL 项目只研究架构。
- 理由：规避 License 风险与法律风险，且能按自身架构重构。

## D-003 Evidence 全字段持久化（2026-09-05）
- 决策：Run/Response 不可变，保存 raw_prompt/raw_response/citations/retrieval_mode/source_type 等全部证据字段，旧结果不覆盖。
- 理由：产品差异化核心；为 GEO Preference Lab 提供可追溯数据底座。

## D-004 Engine 与 Model 分离建模（2026-09-05）
- 决策：AI Engine（DeepSeek Web）与 Underlying Model（DeepSeek API / deepseek-chat）作为不同维度建模。
- 理由：同引擎可能经不同 retrieval_mode 访问（Web UI / API / Browser Agent），结果口径不同。

## D-005 分析策略：规则 + LLM Judge（2026-09-05）
- 决策：V0.1 用规则 + LLM Judge 实现 Mention/Position/Competitor/Citation/Sentiment/Recommendation 解析，不引入 XGBoost/Ranking/Fine-tune。
- 理由：数据积累前避免过度工程；后续基于实验数据再演进。

## D-006 GEO Score 定位（2026-09-05）
- 决策：GEO Score 由 Visibility/Rank/Recommendation/Sentiment/Citation 构成，UI 明确标注"平台内部评估指标"。
- 理由：不假装行业标准，权重待实验数据调整。

## D-007 V0.1 功能边界（2026-09-05）
- 决策：只做 GEO 监测闭环，6~7 个页面；剔除营销/商务/支付/渠道类功能。
- 理由：先跑通"真实数据→Evidence→分析"可信闭环，再扩展。

## D-008 任务异步化（2026-09-05）
- 决策：批量监测走 Redis+BullMQ，Worker 消费，支持 Retry/Rate Limit/Timeout/Concurrency。
- 理由：批量 AI 查询不能同步阻塞 API。
