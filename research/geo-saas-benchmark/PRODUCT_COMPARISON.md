# 七家 GEO / AI Search 产品横向对照

观察日期：2026-10-16。矩阵中 **D**=官方明确支持/文档化，**V**=本次直接看到公开页面或材料，**I**=工程推断，**?**=无法确认。产品登录后实用效果不等同官网能力说明；没有把营销描述升级为运行验证。

## 功能与产品能力矩阵

| 产品 | 监测/分析 | Prompt、竞品、引用 | 优化/工作流 | 报告/API/集成 | 主要证据边界 |
|---|---|---|---|---|---|
| Profound | D：Visibility、Sentiment、FactCheck、Citation、Prompt Volume、Shopping、Agent Analytics；每日运行 | D：Topic/Prompt/Persona/Region/Tag；逐次答案、mentions、citations；Citations 分类和关系图 | D：AI Marketer、Agents、AEO Content Scorecard、Shopping 洞察 | D：REST API、SSE、CSV/JSON、PDF dashboards；Enterprise 提供 API | 登录壳 V；应用内实际图表、数据采集和内容结果未验证 |
| Otterly.AI | D：Brand Report、Prompt/Answer/Engine analytics、GEO Audit、Agent Analytics | D：Prompts、Responses、Citations、Domain Sources、Competitors、Recommendations | D：Prompt Research、Query Fan-Out、Content Checker、待办式建议、公开内容生成工具 | D：API、MCP、Looker Studio、CSV/JSON/PDF | 登录后产品未进入；采集途径和公式为官方文档 |
| Peec AI | D/V：Overview、Brand Insights/Perception、Prompts/Discovery、Sources、Ranking/Chats/Fanouts/Ads、Agent Analytics、Shopping | D：Chat 原始回答、mention/position、retrieval URLs、inline citations、fanouts、广告/商品字段；retrieval 与 citation 分开 | D：Actions、分段内容优化、可应用/撤销编辑、HTML/text 导出；未确认 CMS 发布 | D：MCP 51 read / 48 write tools、API/CSV/Looker；权限按项目/组织；Advanced 多国家 | 官网演示 UI V；公开 app bundle 有 React/Vite 线索，登录账户与实际采集未验证 |
| Scrunch AI | D：monitoring/citations、Insights/Signals、AI trends、Agent Traffic/Pages | D：prompt Explorer、9 平台说明、竞争可见性及 citation 字段 | D：Site Optimization、Citation Optimization alpha、Knowledge Studio | D：Enterprise API/SSO；公开价格 Core 有限平台 | Help Center、营销站及截图文档化；统计检测内部实现未知 |
| AthenaHQ | D：Monitor/Understand/Act；Visibility/mentions/citations/sentiment、demand、competitors | D：Prompt demand、source/citation discrepancy、平台响应 credits | D：Action Center、content/outreach/commerce，Enterprise content agent | D：API、GA4、GSC、MCP；API 在 Starter 是付费 add-on | 厂商产品说明；ACE 引擎性能及实际动作效果未独立验证 |
| AirOps | D：Insights Overview/Visibility/Citations/Community，多维筛选 | D：按 prompt / engine / region / topic / persona 分析及 GSC | D：Workflows、Grid 批量处理、人工审核、版本比较、CMS 发布 | D：WordPress/Webflow、GSC 等；按 Tasks 定价 | 官方文档给出用户流程；页面/发布未实际操作 |
| Ahrefs Brand Radar | D：AI Visibility Index、custom prompt、AI/YouTube/Reddit 等搜索可见性 | D：Mentions、citations、impressions、SOV、topics、响应及 source pages | D：API 拉取、主题/内容探索；不是完整内容发布工作流 | D：Brand Radar API v3 有 22 endpoints；导出/API按套餐 | 官网仪表盘截图 V（营销示例）；AI Index 的搜索需求为代理值 |

## 重点横评

等级约定：**高/中/低**是公开能力与可学习价值的相对判断，不是测得的质量排名；“未知”表示缺少能支持比较的证据。

| 比较维度 | Profound | Otterly.AI | Peec AI | Scrunch AI | AthenaHQ | AirOps | Ahrefs Brand Radar |
|---|---|---|---|---|---|---|---|
| 功能覆盖度 | 高：监测+AI Marketer+购物+Agent Analytics | 高：监测+审计+建议+Agent Analytics | 中高：分析+source/gap/action | 高：监测+agent traffic+site optimization | 高：monitor+action center+agents | 高：洞察+内容生产/发布 | 中高：大规模索引+自定义 prompts+API |
| GEO 监测“真实性”可验证性 | 中高：回答层模型及官方采集说明丰富；未独立验证 | 中高：公布采集方法与回答 API；未独立验证 | 中低：有 daily 说明但采集实现/原始证据公开不足 | 中：指标和平台覆盖文档较具体，采集验证不足 | 中低：以 response credits 描述，执行方法未知 | 中：文档解释 Insights；采样方法细节未知 | 中：大量索引，但 AI Index 是代理采样；自定义 prompts 更直接 |
| AI 平台覆盖 | D：最多 9 个，套餐清单存在文档差异 | D：基础模型+附加模型；50+/65+ locale 口径有差异 | D：套餐通常 3 模型；Enterprise 最高 13 LLM | D：9 platforms help center；Core 只列 4 | D：套餐中 4 起，按平台/credits | D：Solo 限 ChatGPT；Pro 7+ | D：AI Index 多平台；Custom Prompt 页面逐模型选择 |
| 指标/证据透明度 | **高**：定义和聚合口径可查 | **高**：Coverage/SOV/位置/情绪和原始回答 API | **高**：count/total 与 sum/count、chat evidence、retrieval/citation 分开；情绪分类器未知 | 中高：Metrics Reference/API 字段与归一化口径 | 中低：ACE、credit 与优先级算法较黑箱 | 中：筛选口径可见，深层 KPI 公式少 | **高**：指标帮助文档与 API schema；Impressions proxy 要特别说明 |
| UI/UX 学习价值 | 高：筛选→趋势→答案钻取（文档） | 高：回答/引用钻取、待办式建议（截图/文档） | **高**：模块信息架构直观（官网示例） | 中高：Explorer/Signals 等任务导航 | 中高：Monitor→Understand→Act 简单 | 高：Grid/Workflow 适合内容操作 | 中高：多资产视图/API 流程成熟 |
| 报告质量 | 高：可定制 dashboard、PDF、只读分享 | 高：Brand Report、GEO Audit、导出 | 中高：Overview/Impact 与导出 | 中：趋势/Insights；细节方案未知 | 中：平台宣称 reports/action insights | 中高：Insights 主题视图；报告导出细节未知 | 高：历史、趋势、API、跨渠道 |
| 内容优化能力 | 高：评分、研究、简报、文章和 Agents | 中高：GEO Audit、内容建议/生成 | 中：Gap Analysis / Actions | 中高：Site Optimization、Citation Optimization alpha | 高（DOCUMENTED）：内容 Agent、动作中心 | **高**：工作流、Grid、审阅、CMS 发布 | 低中：侧重发现和研究，无完整发布闭环 |
| 自动化能力 | 高：每日任务、Agent run queue API | 中高：每日监控、建议重算、审计异步 | 中：每日监控；自动化细节未知 | 中高：nightly Signals、monitoring | 高（宣传/文档）：agents、行动建议 | **高**：Workflow control loops + Grid | 高：大量索引与 API，但自动优化较弱 |
| API/集成能力 | 高：REST v1/v2、SSE、Agent API | 高：公开 REST + MCP + Looker | **高**：MCP 99 tools、批量写操作、GA4/log connectors | Enterprise 高，Core 未公开 | 中高：API/MCP/GA4/GSC | 高：工具和 CMS/分析整合 | **高**：22 个 API endpoints |
| 企业级能力 | 高：SSO/SAML/SOC2/无限席位等 | 高：SSO、企业支持、权限 key | 高（Enterprise）：SSO/API/无限项目 | 高：SSO/API/多 workspace | 高（Enterprise）：content agent/定制 | 高（Enterprise） | 高：Enterprise $1,499/mo 年约页面所列安全能力 |
| 定价模式 | Trial → 企业定制；Agent credits | Prompt/seat tier + Add-ons + Enterprise | 清晰阶梯：$95 / $245 / $495 / Custom | Core $250 + Enterprise 定制 | response credits；Starter $295 | tasks/volume；公布功能包未显示确切价格 | Index 分层 + custom prompts checks 包 |
| GeoLens 最优借鉴 | 数据契约、可复算指标、证据钻取 | Prompt → answer → citation 与可操作建议 | 简洁的分析导航与指标拆分 | 透明份额/样本变化与来源机会 | evidence-to-action 产品叙事 | 内容执行闭环与人工控制 | 搜索需求代理指标与直接 prompt 监测分层 |

## 公开价格快照

| 产品 | 公开价格/额度（2026-10-16页面快照） | 备注 |
|---|---|---|
| Profound | 免费 Trial：50 unique prompts / 7 天；Enterprise custom；Agency Growth 的 credits 页面未显示价格 | API/历史受限，试用限制以当前 pricing 为准 |
| Otterly.AI | Lite 15 prompts；Standard 100；Premium 400；Enterprise custom/from 1,000；月付约 $29/$189/$489，年付约 $25/$160/$422 | 官网同页存在动态周期差异；币种 USD 页面口径 |
| Peec AI | Starter/Pro/Advanced 50/150/350 prompts；浏览器价格快照约 $95/$245/$495；Enterprise custom | 静态公开页面主要稳定显示额度，价格在不同公开页面视图中不一致；Agency 另按 prompt×model×day credit 持续额度计 |
| Scrunch AI | Core $250/mo：125 prompts、5,000 responses、5 audits、1 workspace、5 seats；Enterprise custom | 主定价页；旧 CDN 定价页数字不同 |
| AthenaHQ | Essential $0 + $25 free credit（300 credits）；Starter $295/mo + $300 credit（3,600 credits）；Enterprise custom | 1 credit = 1 AI response；API Starter 是 add-on |
| AirOps | 任务/用量计价；Solo 仅 ChatGPT，Pro 7+ engines，Enterprise custom | 定价页未给出可靠统一美元数值 |
| Ahrefs Brand Radar | AI Index standalone from $199/mo；Custom Prompts Basic $50/2,500 checks、Growth $100/7,000、Scale $250/25,000；Enterprise $1,499/mo 年约 | Brand Radar 是否含在 Ahrefs tier 按套餐变化；以当前账单页为准 |

价格是公开网页快照，不是采购报价。Prompts、responses、credits、checks 定义不同，不能只按标价横比单位经济。

## AI 平台覆盖快照

| 产品 | 官方当前公开的模型/平台口径 | 研究注记 |
|---|---|---|
| Profound | Trial 文档列 ChatGPT、Gemini、Google AI Overviews；Enterprise 最多 9 个 Answer Engines。文档不同页的清单含 Grok 或 Exa Search，存在不一致。 | 只将试用套餐三项作为明确名单；企业覆盖标为最多 9、具体名单待账户确认。[Pricing](https://www.tryprofound.com/pricing) |
| Otterly.AI | 基础 ChatGPT、Google AI Overviews、Perplexity、Copilot；Claude、Google AI Mode、Gemini 为套餐 Add-on。 | 国家/语言覆盖在官网 50+ 与 65+ 文案间不一致。[Pricing](https://otterly.ai/pricing) |
| Peec AI | 套餐可选 3 个 models；Enterprise 可选全部模型，最高 13 个 LLM；各 project 的可用 model channel 与地区能力另有区别。 | 当前公开定价层显示的 3 models 不等于所有引擎；未公开调用方式。[Pricing](https://peec.ai/pricing) · [MCP tools](https://docs.peec.ai/mcp/tools) |
| Scrunch AI | Help Center 列 ChatGPT、Perplexity、Google AI Overviews、AI Mode、Gemini、Claude、Copilot、Grok、Meta AI 共 9 项；Core 价格页列 4 项。 | 上层产品范围与 Core 套餐覆盖必须区分。[Platforms](https://helpcenter.scrunchai.com/en/articles/15863866-what-platforms-does-scrunch-monitor) |
| AthenaHQ | Essential 示例列 ChatGPT、Perplexity、AI Overviews、Gemini、Copilot；按套餐额度/credit 运行。 | 精确全量平台列表与 Starter 可选配置未由公开文档完全确认。[Plans](https://athenahq.ai/plans) |
| AirOps | AI search 页面列 ChatGPT、Perplexity、Claude、Gemini、Google AI Overviews/AI Mode；Pro 宣称覆盖 7+ answer engines。 | 官网列举与 7+ 总数是 DOCUMENTED 产品声明，采集模式和完整引擎名单需账户验证。[AI Search Visibility](https://www.airops.com/ai-search-visibility) |
| Ahrefs Brand Radar | AI Index 支持多种 AI 搜索产品；Custom Prompts 有独立可选平台及 Claude 入口。 | 大规模 index 的覆盖平台与自定义 prompts 的可用模型应分别查看；不把索引量当模型支持列表。[Brand Radar](https://ahrefs.com/brand-radar?app=1) |

## 哪些产品实际验证了什么

| 证据级别 | 本次确认内容 | 不能据此声称 |
|---|---|---|
| VERIFIED | Peec 官网公开演示页及其样例界面；Peec 定价页；Ahrefs Brand Radar 公共示例图；若干官网 HTML/公开 JS 线索；Otterly app 登录壳 | 登录用户工作区行为、真实客户数据、Provider 采集是否准确 |
| DOCUMENTED | 官方帮助中心和 API 文档描述的页面、数据模型、指标、定价、工作流与端点 | 内部数据库、私有服务拓扑、队列具体产品、模型准确率 |
| INFERRED | 将异步任务、原始 answer、parsed mentions、citation 和聚合表组织成参考 SaaS 架构 | 竞品真实使用该架构 |
| UNKNOWN | 登录后前端框架和运行态网络调用、真实采样率、重试/幂等、所有模型的采集适配、内部 KPI 实现未披露部分 | 任何“我们还原了真实后端/算法”的结论 |

## 来源索引

完整 URL 与证据条目按产品编号见 [EVIDENCE_INDEX.md](EVIDENCE_INDEX.md)。关键官方入口：

- [Profound API/指标文档](https://docs.tryprofound.com/cookbook/metrics/how-metrics-are-calculated)
- [Otterly 指标定义](https://help.otterly.ai/brand-report-kpi-definition)
- [Peec 定价](https://peec.ai/pricing) · [MCP tools](https://docs.peec.ai/mcp/tools) · [Peec metrics](https://docs.peec.ai/metrics-overview)
- [Scrunch Metrics Reference](https://helpcenter.scrunchai.com/en/articles/16823372-scrunch-metrics-reference-explorer-names-and-api-fields)
- [Athena Plans](https://athenahq.ai/plans)
- [AirOps Insights Docs](https://docs.airops.com/insights)
- [Ahrefs AI visibility metrics](https://help.ahrefs.com/en/articles/15501968-ai-visibility-metrics)
