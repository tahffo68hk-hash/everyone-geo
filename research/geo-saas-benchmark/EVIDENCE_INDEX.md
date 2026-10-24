# 证据与来源索引

观察/整理日期：2026-10-16（Asia/Shanghai）。除 GeoLens 本地源码外，外部来源均为公开页面。**VERIFIED** 指本次可直接加载/观察公开内容；**DOCUMENTED** 指来源由产品方发布但未在登录后运行验证；**INFERRED** 指本报告根据公开外部行为作出的设计推断；**UNKNOWN** 指没有足够证据。

## 证据使用规则

1. 公共官网或产品示例图能证明“网页展示了什么”，不证明登录后产品使用同一组件/技术栈，也不证明样例数据实时产生。
2. 官方帮助/API 文档可证明厂商公开描述的产品接口、定义或流程，不证明实际数据质量、无故障运行或内部架构。
3. 本次未登录竞品、未访问付费数据、未绕过 403 / 权限控制、未运行对方 API。
4. 本地 GeoLens 代码证据只说明当前 checkout 的文件状态，不说明未提交代码以外的生产环境状态。

## P0：Profound

| ID | 来源 | URL | 状态/支持内容 |
|---|---|---|---|
| PR-01 | 官网 / pricing / 导航 | https://www.tryprofound.com/pricing | DOCUMENTED：Monitor、AI Marketer、套餐和公开功能入口 |
| PR-02 | Public login shell | https://platform.tryprofound.com/ | VERIFIED：公开登录入口；HTML 线索有 Next/Turbopack。登录 app 未验证 |
| PR-03 | AEI interpretation | https://docs.tryprofound.com/answer-engine-insights/interpret | DOCUMENTED：Visibility、Sentiment、FactCheck、Citations、Prompts 页面及筛选/图表钻取 |
| PR-04 | Prompt Designer | https://docs.tryprofound.com/answer-engine-insights/prompt-designer | DOCUMENTED：Prompt 管理、批量编辑/导入流程 |
| PR-05 | Topics and Prompts | https://docs.tryprofound.com/answer-engine-insights/how-tos/create-topics-and-prompts | DOCUMENTED：Prompt 配置、维度与首次运行说明 |
| PR-06 | Data model | https://docs.tryprofound.com/cookbook/setup/data-model | DOCUMENTED：Organization / Category / Assets / Topics / Prompts 外部模型 |
| PR-07 | Metrics definitions | https://docs.tryprofound.com/cookbook/metrics/how-metrics-are-calculated | DOCUMENTED：Visibility、SOV、Position、Citation Share、Sentiment 公式和模型聚合 |
| PR-08 | AEI about | https://docs.tryprofound.com/answer-engine-insights/about | DOCUMENTED：每日运行、answer/execution 数据说明；采集方式为厂商描述 |
| PR-09 | REST API intro | https://docs.tryprofound.com/rest-api/introduction | DOCUMENTED：API base、限额、报表与分页/流式能力 |
| PR-10 | Authentication | https://docs.tryprofound.com/rest-api/authentication | DOCUMENTED：API token 与组织访问说明 |
| PR-11 | Reports v2 overview | https://docs.tryprofound.com/rest-api/reports/reports-v2-overview | DOCUMENTED：筛选、分组、分页等报表查询参数 |
| PR-12 | Custom dashboards | https://help.tryprofound.com/articles/6324319245 | DOCUMENTED：自定义图表、分享、PDF |
| PR-13 | AI Marketer | https://docs.tryprofound.com/aim/about | DOCUMENTED：AI Marketer 任务和工作流 |
| PR-14 | Agent suggestions | https://help.tryprofound.com/articles/2007967041 | DOCUMENTED：基于 insights 的建议 |
| PR-15 | AEO Content Scorecard | https://docs.tryprofound.com/agents/aeo-content-scorecard | DOCUMENTED：内容评分维度 |
| PR-16 | Agent Analytics | https://help.tryprofound.com/articles/2449520166-agent-analytics | DOCUMENTED：CDN/server log 数据源 |
| PR-17 | Shopping | https://docs.tryprofound.com/shopping/about | DOCUMENTED：ChatGPT Shopping 数据与页面 |
| PR-18 | Run Agent | https://docs.tryprofound.com/api-reference/agents/run-an-agent | DOCUMENTED：Agent API 异步创建状态 |
| PR-19 | Get Agent Run | https://docs.tryprofound.com/api-reference/agents/get-an-agent-run | DOCUMENTED：Agent 状态查询 |

## P0：Otterly.AI

| ID | 来源 | URL | 状态/支持内容 |
|---|---|---|---|
| OT-01 | Features | https://otterly.ai/features/ | DOCUMENTED：产品模块 |
| OT-02 | Public app entry | https://app.otterly.ai/ | VERIFIED：公开入口/登录壳可见，登录产品未进入 |
| OT-03 | Signup | https://help.otterly.ai/how-can-i-sign-up-for-otterlyai | DOCUMENTED：注册步骤 |
| OT-04 | Getting started | https://help.otterly.ai/what-is-otterly.ai | DOCUMENTED：首次配置与监测路径 |
| OT-05 | Prompt monitoring | https://help.otterly.ai/search-prompt-monitoring | DOCUMENTED：Prompts 表格/筛选字段 |
| OT-06 | Prompt detail | https://help.otterly.ai/prompt-detail-analysis | DOCUMENTED：Overview/Responses/Citations |
| OT-07 | Citation report | https://help.otterly.ai/how-can-citations-report-help-you-analyze-your-content-gaps | DOCUMENTED：引用趋势/页面 |
| OT-08 | Domain sources | https://help.otterly.ai/what-insights-can-i-gain-from-domain-citations-analysis | DOCUMENTED：域引用分析 |
| OT-09 | Recommendations | https://help.otterly.ai/ai-recommendations | DOCUMENTED：Suggested/To-Do/Archive 与门槛 |
| OT-10 | GEO Audit | https://help.otterly.ai/what-does-the-geo-audit-do | DOCUMENTED：crawlability/content/fan-out |
| OT-11 | AI readiness | https://help.otterly.ai/ai-readiness | DOCUMENTED：内容审计指标 |
| OT-12 | Query Fan-Out | https://help.otterly.ai/query-fan-out-and-how-to-use-it | DOCUMENTED：prompt 扩展流程 |
| OT-13 | Collection method | https://help.otterly.ai/how-otterlyai-collects-data | DOCUMENTED：厂商所述公开 UI/API 采集方法；未经独立复现 |
| OT-14 | KPI definitions | https://help.otterly.ai/brand-report-kpi-definition | DOCUMENTED：Coverage、SOV、Sentiment、BVI 等公式 |
| OT-15 | API introduction | https://docs.otterly.ai/introduction | DOCUMENTED：API base、认证与对象 |
| OT-16 | Responses endpoint | https://docs.otterly.ai/api-reference/brand-reports/list-ai-responses-for-a-prompt-in-a-brand-report | DOCUMENTED：run、engine、raw content、mentions/citations 字段 |
| OT-17 | Audit endpoint | https://docs.otterly.ai/api-reference/audits/create-a-crawlability-check | DOCUMENTED：Audit 异步 pending 状态 |
| OT-18 | Statistics endpoint | https://docs.otterly.ai/api-reference/brand-reports/get-statistics-for-a-brand-report | DOCUMENTED：统计和 recalculation 状态 |
| OT-19 | MCP | https://help.otterly.ai/does-otterlyai-have-an-mcp | DOCUMENTED：MCP 与 OAuth 说明 |
| OT-20 | Export | https://help.otterly.ai/can-i-export-my-data-and-reports | DOCUMENTED：CSV/JSON/PDF 导出 |
| OT-21 | Agent analytics | https://help.otterly.ai/agent-analytics | DOCUMENTED：访问分析和数据接入 |
| OT-22 | Pricing | https://otterly.ai/pricing | DOCUMENTED：公开套餐/价格快照；页面存在计费周期/地区口径差异 |
| OT-23 | Prompt limits | https://help.otterly.ai/amount-searchprompts | DOCUMENTED：prompt 与地区额度 |
| OT-24 | Prompt research | https://help.otterly.ai/relevant-prompts | DOCUMENTED：Prompt Research 与 intent volume 限制 |

## P0：Peec AI

| ID | 来源 | URL | 状态/支持内容 |
|---|---|---|---|
| PE-01 | 官网公开演示 | https://peec.ai/ | VERIFIED：官网/样例 dashboard 示意；不代表客户实时数据 |
| PE-02 | Public app shell | https://app.peec.ai/ | VERIFIED：公开 bundle 可见 React/createRoot/Vite 线索；登录应用未验证 |
| PE-03 | Quickstart | https://docs.peec.ai/quickstart-guide | DOCUMENTED：首次设置、建议 prompt、dashboard、views |
| PE-04 | Sidebar navigation | https://docs.peec.ai/sidebar-navigation | DOCUMENTED：产品导航和页面模块 |
| PE-05 | Understanding performance | https://docs.peec.ai/understanding-your-performance | DOCUMENTED：Overview 筛选、图表、prompt 表行为 |
| PE-06 | Sources | https://docs.peec.ai/understanding-sources | DOCUMENTED：retrieval 与 citation 来源分析 |
| PE-07 | Metric overview | https://docs.peec.ai/metrics-overview | DOCUMENTED：Visibility、SOV、Sentiment、Position 定义 |
| PE-08 | MCP intro | https://docs.peec.ai/mcp/introduction | DOCUMENTED：MCP 地址、认证、权限、写入工具 |
| PE-09 | MCP tools reference | https://docs.peec.ai/mcp/tools | DOCUMENTED：读/写工具、聊天数据、来源和聚合字段 |
| PE-10 | Actions | https://docs.peec.ai/actions | DOCUMENTED：行动类型及证据流程 |
| PE-11 | Content optimization | https://docs.peec.ai/content-optimization | DOCUMENTED：编辑、review、tracked changes 与导出 |
| PE-12 | Data connection | https://docs.peec.ai/connecting-your-data | DOCUMENTED：GA4、bot log 等数据输入 |
| PE-13 | AI referrals | https://docs.peec.ai/ai-referrals | DOCUMENTED：referral 识别和归因下界限制 |
| PE-14 | Brand pricing | https://peec.ai/pricing | DOCUMENTED：套餐上限；本次浏览器公开价格视图见正文，静态页面美元价格存在可见性差异 |
| PE-15 | Agency pricing | https://peec.ai/pricing-agencies | DOCUMENTED：agency credits 和额度规则 |
| PE-16 | Views release | https://peec.ai/blog/introducing-views-a-custom-dashboards-ready-to-share | DOCUMENTED：Views 和 dashboard 功能公告 |

## P1：Scrunch AI

| ID | 来源 | URL | 状态/支持内容 |
|---|---|---|---|
| SC-01 | Public homepage | https://scrunch.com/ | VERIFIED：公开营销页面/导航示意 |
| SC-02 | Platform overview | https://scrunch.com/platform/monitoring/citations/ | DOCUMENTED：Monitor/Citations 模块入口 |
| SC-03 | Platforms monitored | https://helpcenter.scrunchai.com/en/articles/15863866-what-platforms-does-scrunch-monitor | DOCUMENTED：9 个平台名单 |
| SC-04 | Metrics guide | https://helpcenter.scrunchai.com/en/articles/13566677-scrunch-metrics-guide | DOCUMENTED：mentions rate 和时间粒度 |
| SC-05 | Metrics reference/API fields | https://helpcenter.scrunchai.com/en/articles/16823372-scrunch-metrics-reference-explorer-names-and-api-fields | DOCUMENTED：citation/mention/SOV 字段 |
| SC-06 | Competitive presence | https://helpcenter.scrunchai.com/en/articles/13642392-understanding-competitive-presence-in-scrunch | DOCUMENTED：归一化竞争指标与样本显示 |
| SC-07 | Adding prompts | https://helpcenter.scrunchai.com/en/articles/11943981-how-to-add-prompts-in-scrunch | DOCUMENTED：prompt 配置/导入 |
| SC-08 | Signals tab | https://helpcenter.scrunchai.com/en/articles/15879296-understanding-the-signals-tab | DOCUMENTED：夜间洞察与反馈流程 |
| SC-09 | Citation Optimization | https://helpcenter.scrunchai.com/en/articles/17508043-set-up-your-brand | DOCUMENTED：Citation Optimization alpha 条件 |
| SC-10 | Pricing | https://scrunch.com/pricing/ | DOCUMENTED：Core 和 Enterprise 主站价格快照 |

## P1：AthenaHQ

| ID | 来源 | URL | 状态/支持内容 |
|---|---|---|---|
| AH-01 | Platform | https://athenahq.ai/platform/ | DOCUMENTED：Monitor/Understand/Act 产品说明 |
| AH-02 | Plans | https://athenahq.ai/plans | DOCUMENTED：credits、套餐和 API add-on |
| AH-03 | Integrations | https://athenahq.ai/integrations/ | DOCUMENTED：GA4、GSC、MCP 集成说明 |
| AH-04 | Athena Citation Engine | https://athenahq.ai/blog/announcing-athena-citation-engine-ace | DOCUMENTED：厂商关于 ACE 引擎的声明；性能未验证 |
| AH-05 | Public platform page | https://athenahq.ai/ | VERIFIED：营销站公共内容及 Astro/Vercel 资源线索 |

## P1：AirOps

| ID | 来源 | URL | 状态/支持内容 |
|---|---|---|---|
| AI-01 | AI search visibility page | https://www.airops.com/ai-search-visibility | DOCUMENTED：AI visibility 定位和平台说明 |
| AI-02 | Insights docs | https://docs.airops.com/insights | DOCUMENTED：Insights 页面与筛选维度 |
| AI-03 | Main docs | https://docs.airops.com/ | DOCUMENTED：Insights/Workflows/content 产品结构 |
| AI-04 | Grids | https://docs.airops.com/actions/grids | DOCUMENTED：批处理、review、版本和 CMS 工作流 |
| AI-05 | Workflow steps | https://docs.airops.com/actions/workflow-concepts/workflow-steps | DOCUMENTED：控制流、人工审核、集成节点 |
| AI-06 | Google Search Console action | https://docs.airops.com/actions/workflow-concepts/workflow-steps/seo-research/google-search-console | DOCUMENTED：GSC 数据操作 |
| AI-07 | Pricing | https://www.airops.com/pricing | DOCUMENTED：task/volume 计价和套餐模型；未显示统一价格 |

## P2：Ahrefs Brand Radar

| ID | 来源 | URL | 状态/支持内容 |
|---|---|---|---|
| BR-01 | Brand Radar overview | https://ahrefs.com/brand-radar?app=1 | DOCUMENTED：AI Index/custom prompts、可见模块、平台说明 |
| BR-02 | AI visibility metrics | https://help.ahrefs.com/en/articles/15501968-ai-visibility-metrics | DOCUMENTED：mentions/citations/impressions/SOV 定义 |
| BR-03 | Brand Radar API | https://docs.ahrefs.com/en/api/reference/brand-radar | DOCUMENTED：API v3 endpoints 和响应能力 |
| BR-04 | Pricing | https://ahrefs.com/pricing | DOCUMENTED：AI Index/custom prompts 公开套餐快照 |
| BR-05 | Academy overview | https://ahrefs.com/academy/how-to-use-brand-radar/overview | DOCUMENTED：仪表盘和跨渠道说明 |
| BR-06 | Official screenshot asset | https://ahrefs.com/assets/esbuild/ai-visibility-5OHJ3NGT.png | VERIFIED：公共图片素材；营销/示例 UI，非账户实时数据 |

## GeoLens 本地证据

| ID | 本地文件（相对仓库根） | 可证明的内容 |
|---|---|---|
| GL-01 | packages/database/prisma/schema.prisma | 当前 schema 中已建实体及缺少 GEO execution/evidence/metric 表 |
| GL-02 | apps/web/src/app/app/page.tsx | 当前 app 页面组织/项目 UI |
| GL-03 | apps/web/src/lib/api.ts | 前端 API helper、credentials 和错误处理 |
| GL-04 | apps/api/src/organizations/organizations.controller.ts | 组织 API controller |
| GL-05 | apps/api/src/common/tenant.service.ts | tenant membership 校验 |
| GL-06 | apps/api/src/auth/auth.service.ts | 认证实现线索 |
| GL-07 | apps/api/src/main.ts | Nest 应用启动配置 |
| GL-08 | docs/ARCHITECTURE.md | 架构文档中的当前状态与计划边界 |
| GL-09 | docs/PRODUCT_MAP.md | 产品范围规划 |
| GL-10 | docs/DATABASE.md | 数据库设计文档 |
| GL-11 | docs/UI_REFERENCE_AUDIT.md | 既有 UI 参考审计，2026-09-06 |

## 页面与素材文件

本次收录的公开页面图像和来源细节见 [screenshots/README.md](screenshots/README.md)。所有图像均注明页面示意或帮助中心截图，不把营销图片当成实时产品验证。
