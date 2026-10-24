# GEO SaaS 竞品深度技术研究报告

研究截止：2026-10-16（Asia/Shanghai）

范围：Profound、Otterly.AI、Peec AI（P0）；Scrunch AI、AthenaHQ、AirOps（P1）；Ahrefs Brand Radar（P2）。

证据状态：**VERIFIED** = 本次直接访问并观察到；**DOCUMENTED** = 官方帮助中心、API 文档或定价页明确说明；**INFERRED** = 根据公开行为作出的工程推断；**UNKNOWN** = 无法从允许访问的公开材料确认。

## 执行摘要

### 给 GeoLens 的直接结论

| 问题 | 结论 |
|---|---|
| 最值得学习哪家 | **Profound**：官方提供了细粒度的回答数据模型、API、指标定义、异步 Agent 状态与回答证据钻取；对 GeoLens 的数据契约和可复算测量最有参考价值。它的登录后应用没有在本次研究中进入，因此这里说的是公开文档深度，不是已验证的真实内部实现。 |
| 前端交互最值得看哪家 | **Peec AI**：公开产品演示将 Overview、Prompts、Market Insights、Brand Perception、Sources、Gap Analysis、Domains、URLs、Actions 与 Impact 串成一条清晰的分析路径；导航层级和指标拆分好理解。观察的是官网演示/样例界面，不是登录后真实账户。 |
| GEO 测量最值得研究哪家 | **Profound**：明确区分 Visibility、Share of Voice、Position、Citation Share、Sentiment，并披露按模型分别计算比例后等权汇总等细节。Otterly 对 Coverage 和 Google AI Overviews 未触发样本分母的处理也很值得借鉴。 |
| 内容优化闭环最成熟 | **AirOps**：公开文档覆盖 Insights → 可编排 Workflows → Grid 批量内容操作 → 人工审阅 → CMS 发布，且能结合 GSC 等数据。它更像 SEO/内容运营平台扩展 AI Search，而非纯 GEO 监测器。此结论是对文档能力链的评价，不代表我们执行过客户发布。 |
| GeoLens 当前主要差距 | 当前代码有 Next.js/NestJS/PostgreSQL/Prisma 的 SaaS 基础、注册登录、组织成员和项目隔离；但没有可运行的 GEO 监测任务、Provider 采集、原始回答/引用证据、指标聚合、趋势仪表盘、报告或优化闭环。产品文档中的未来设计不能算已实现能力。 |

### 下一阶段最值得投入的 5 项工作

1. **端到端真实监测纵切片（M，约 2–4 周）**：固定一组 Prompt、一个 Provider 和一个地区；从创建计划、异步执行、保存原始回答到可查看执行详情。验收：每次运行有唯一 id、时间/模型/地区、原始文本、状态和错误；失败可重试且不重复计费。
2. **Evidence 层与来源溯源（M，约 1–2 周）**：保存回答、实体提及、引用 URL、提取版本和来源位置。验收：从任一 KPI 能点到回答和引用原文；解析器重跑不覆盖原始响应。
3. **指标定义与统计边界（S–M，约 1–2 周）**：定义 Brand Coverage、Citation Coverage、SOV、Position，按模型/地区分别呈现，显示样本数和未触发平台响应。验收：公开公式、可复算 SQL/服务逻辑、零分母返回 N/A 而不是 0。
4. **Prompt 管理与监测体验（M，约 2 周）**：Prompt 分组、标签、地区、模型、启停、CSV 导入、运行历史和筛选。验收：用户能从空项目 10 分钟内建立首批跟踪问题，并看到任务状态与首个证据。
5. **建议与复测闭环（M，约 2–3 周）**：先产出有证据的机会卡片（竞品被引用而 GeoLens 客户未被引用、低覆盖 Prompt 等），用户标记待办，修改 URL 后重新检查。验收：每条建议显示触发样本/来源/优先级理由；复测用相同 Prompt/Provider/地区并展示前后变化，但不宣称因果归因。

规模仅为单人熟悉现有代码条件下的工程粗估，不含采购 Provider 数据源、合规审查、生产监控和客户级 SLA；应按 GeoLens 目标 Provider 调整。

### 个人最值得掌握的 10 项工程技术

1. 多租户数据隔离；2. Prompt 与监测计划建模；3. 异步队列、幂等与重试；4. AI Provider/Gateway 适配；5. 原始证据和 Provenance；6. 指标的 cohort 与分母定义；7. 统计波动和置信区间；8. 可钻取的仪表盘；9. 报告快照与分享权限；10. GEO Retest 与变化归因边界。每项的练习、数据结构、难点见 [工程学习指南](ENGINEERING_LEARNING_GUIDE.md)。

## 研究方法与证据边界

- 先检查了当前工作区文档和实现，再查产品官网、官方文档、帮助中心、定价页和公开产品演示。完整来源、状态和用途在 [证据索引](EVIDENCE_INDEX.md)。
- 对公开官网页面、登录壳、帮助中心图像和 API 文档进行只读访问；未登录竞品账户、未绕过拦截、未请求付费数据、未调用付费 API。页面素材下载到本目录的 screenshots，逐图来源和“营销示意/文档截图”标记见 [screenshots/README.md](screenshots/README.md)。
- 官网营销页的功能描述只标记为 DOCUMENTED；只有本次实际看到的公开页面/静态资产才标记 VERIFIED。登录后交互、内部网络请求和私有代码均未验证。
- 对所谓“消费者视角采集”“实时准确”“AI Visibility”采用厂商自述口径，不等同于本次独立复验。指标公式只在官方公开定义时写作厂商定义；建议公式在算法文档中另标为 GeoLens 参考设计。
- 观察日为 2026-10-16。价格、平台名单和套餐额度可能按地区、周期和页面动态变化；来源页面偶有相互冲突，报告指出了已见差异。

## P0：三家核心研究

### Profound

**定位与价值（DOCUMENTED）**：企业级 Answer Engine Insights + AI Marketer。Monitor 侧有 Visibility、Prompt Volumes、Shopping、Agent Analytics；AI Marketer 侧有 Agents、Context Manager、AI Marketer 项目工作流。目标是从品牌/竞品在 AI 回答中的表现，延伸到内容建议与生成。

**可见页面和路径（DOCUMENTED，非登录验证）**：注册/登录壳可访问；官网文档描述 AEI 的 Visibility、Sentiment、FactCheck、Citations、Prompts 视图。通用路径是创建组织和品牌 Category，配置 Topic/Prompt/Region/Language/Persona，等待首次每日执行，再从聚合图表筛选到时间点执行记录和原始回答。Prompt Designer 支持手动、CSV、生成式创建和批量编辑；新 Prompt 首批指标约需 24–48 小时。视图可保存、分享、导出 PDF；图表或时间区间可发给 AI Marketer 解释。

**页面体验（DOCUMENTED）**：日期与比较区间、模型、Topic、标签、区域、竞品、语言、Persona 多维过滤；图表可切维度并配排名表；点击时间点可查看执行证据。Citations 支持域名/路径分类和关系图。对工程学习而言，最有价值的是从趋势到可解释的底层样本钻取，而非图表本身。

**内容工作流**：AEO Content Scorecard 用 URL 与目标 Prompt 评分可读性、时效性、结构、可回答性、机器可读性和信息密度；Agent 能做研究、简报、文章生成、引用分析与内容评分。建议/生成能力来自官方文档，内容质量和 CMS 发布闭环未本次验证。Shopping 主要披露 ChatGPT Shopping 商品卡、价格、图片、购买链接等；不要泛化成所有引擎。

**工程证据**：API 的数据层级为 Organization → Category → Assets/Topics/Prompts；Answer API 暴露逐次执行的模型、地区、Prompt、原始回答、mentions、citations、sentiment claims。REST API 有游标分页、筛选、分组、SSE 流式接口及 600 次/小时默认限额；Agent run 返回 202 queued 并提供 queued/running/succeeded/failed/cancelled 状态。厂商称采集来自消费者浏览体验而不是模型 API，但采集具体自动化机制未公开。

**指标定义**：Visibility 是某模型中出现品牌的回答数 / 至少出现任一品牌的回答数；SOV 是品牌 mentions / 所有品牌 mentions；平均位置按品牌首次出现位置；Citation Share 是自有域名引用 / 全部引用。比例先按模型分别算，再对有品牌数据的模型等权平均；计数跨模型求和。这种聚合方式会让小样本模型与大样本模型权重相同，产品报告应明确展示该口径和各模型样本数。

**商业模式**：公开试用 7 天、50 个唯一 Prompt、每日跟踪 ChatGPT/Gemini/AI Overviews；无历史、导出或 API。企业版按定制报价，列出最多 9 个引擎、CSV/JSON/API、购物监测、SSO/SAML、SOC2、支持；Agent 使用 credits。实际收费、可选席位和配额结算未购买验证。

**技术边界**：公开登录壳的 Next.js/Turbopack 文件是 VERIFIED 的页面线索，不可据此认定登录后产品技术栈。数据库、队列、浏览器采集、重试、去重、解析置信度、情绪模型及成本路由均 UNKNOWN；参考架构见 [后端架构研究](BACKEND_ARCHITECTURE.md)。核心来源：[AEI 交互文档](https://docs.tryprofound.com/answer-engine-insights/interpret)、[数据模型](https://docs.tryprofound.com/cookbook/setup/data-model)、[指标公式](https://docs.tryprofound.com/cookbook/metrics/how-metrics-are-calculated)、[API](https://docs.tryprofound.com/rest-api/introduction)。

### Otterly.AI

**定位与价值（DOCUMENTED）**：面向营销/SEO 团队和代理商的 Prompt Research、AI Search Analytics、Citation Analysis、Recommendations、GEO Audit、Agent Analytics。突出可操作的答案和引用分析。

**首次使用和页面**：官方入门流程为注册/验证 → 输入品牌域名、竞品、Prompt → 自动创建 Brand Report → 选择国家 → 几分钟内收到首批数据 → 后续每日监测，再运行 GEO Audit。此流程来自帮助文档而非本次亲自注册。Brand Report 有总览、Prompts、Prompt Detail、Citation Report、Domain Sources、Recommendations、GEO Audit、Agent Analytics。Prompts 行包含覆盖、情绪、估算 intent volume、mentions、domain citations、Ads、Shopping、竞品和标签；Prompt Detail 有 Overview/Responses/Citations，可看完整回答、引用及导出。Citation Report 有趋势、赢家/输家和可搜索 URL 表；建议区有 Suggested/To-Do/Archive。

**数据与采集**：官方称除 Claude 外主要通过各平台公开 Web UI 送入问题，Claude 走 API；每天采集，受国家/地区/个性化影响。此为厂商方法说明，未独立测量。API 暴露 workspace、prompt、report、statistics、responses、citations、recommendations 和 audits；响应含 runId、runDate、engine、原始内容、mentions、citations、rank、ads/shopping 等。审计端点先返回 pending，统计有 isRecalculating，可确认异步状态字段存在，但不能推断内部使用哪种队列。

**指标定义**：官方定义 Brand Coverage 为被提及的执行数 / 执行数，Google AI Overview 未触发时排除出分母；SOV 为自身 mentions / 所有品牌 mentions；平均位置；Sentiment NSS=(正−负)/总提及；Domain Coverage 类似但看自有域名引用。Visibility Index 组合 coverage 与 likelihood-to-buy，并对后者提供公式；API 单一 visibilityScore 的合成方式未说明。部分 KPI 文档称只对 API/MCP 可用，与 UI 指标文档有措辞差异。

**优化能力**：Prompt Research 可生成建议问题和厂商估算的 intent volume（真实 AI 搜索量无法直接观察）；GEO Audit 包含可抓取性、内容可读性和 Query Fan-Out；Recommendations 提供机会到待办的轻量流程。内容生成器页面公开可用，但真实内容表现与 CMS 发布未验证。Agent Analytics 用服务器/CDN 日志查看 AI crawler/agent 对网站的访问，不等于证明优化带来转化。

**商业模式**：公开定价列 Lite 15、Standard 100、Premium 400 prompts，Enterprise 定制；月/年价格页面同时呈现不同数值，且 50+/65+ 国家/语言页面口径不一。基础引擎含 ChatGPT、AI Overviews、Perplexity、Copilot；其他模型可作付费 add-on。API、MCP、Looker Studio 和 Agent Analytics 按套餐提供，7 天/50 prompts 试用。

**前端边界**：公开 app 入口转至登录，页面提示需 JavaScript 加载仪表盘；Marketing 网站 Webflow 资源、帮助中心 Mintlify 均不代表登录应用框架。登录后路由、组件、数据请求和状态管理 UNKNOWN。公开帮助中心截图作为带来源的文档证据收录。核心来源：[指标定义](https://help.otterly.ai/brand-report-kpi-definition)、[采集说明](https://help.otterly.ai/how-otterlyai-collects-data)、[Responses API](https://docs.otterly.ai/api-reference/brand-reports/list-ai-responses-for-a-prompt-in-a-brand-report)、[API 介绍](https://docs.otterly.ai/introduction)。

### Peec AI

**定位与价值（DOCUMENTED + 公开演示）**：面向品牌营销、SEO/内容团队与代理商，聚焦跨模型可见度、竞争份额、品牌认知、引用来源与内容机会。官方更完整的导航还列出 Brand Insights、Prompts/Discovery、Sources（Gap Analysis/Domains/URLs）、Optimize（Actions/Impact）、Results（Ranking/Chats/Fanouts/Ads）、Agent Analytics（Crawl Insights/Crawlability/AI Referrals）、Shopping 与 Settings；参见 [Sidebar navigation](https://docs.peec.ai/sidebar-navigation)。

**页面与路径（官网公开示例 + 官方文档，未登录实测）**：Quickstart 建议先录入约 10 个 prompts，系统给出建议并识别竞品；再设别名、正则匹配、国家/主题/标签等，文档称约 10 分钟完成初始化，首批 visibility 在 24 小时内出现。一个 Chat 表示某 prompt 在某日期某 engine 的回答。Overview 支持日期/模型/竞品/国家/topic/tag 过滤、与上一等长窗口比较、AND/OR tags、保存筛选；图表可拖拽/缩放/添加/删除并保存为项目 View，公开只读分享可设密码或导出 PDF。参见 [Quickstart](https://docs.peec.ai/quickstart-guide) 和 [performance filters](https://docs.peec.ai/understanding-your-performance)。营销演示页面能看到样例数据、图表和步骤，不能当作客户账户中真实数据。

**交互与图表**：演示界面把三项指标 Visibility、Position、Sentiment 分开；Sources 可区分 AI 回答“使用”的来源与明确引用的来源。提示词列表、趋势图和竞品对比的结构清楚，模块名称能解释分析任务。无法验证真实应用的加载/空/错误状态、交互响应、移动端或内部 API。

**监测与证据**：MCP tools 文档暴露了比营销站更多的证据字段：Chat 可返回 prompt/原始回答、品牌 mention 与排名、retrieved URLs、inline citation 数、query fanouts、产品、广告、地图结果及 Web Search 标记；指标报告保留 numerator/denominator 类原始聚合字段。稳定的 model_channel_id 用来标识渠道，渠道的底层模型升级不必换 ID；部分不支持国家的组合不创建 Chat。参见 [MCP tool reference](https://docs.peec.ai/mcp/tools)。官方说明覆盖多引擎并按天跟踪，但是否通过浏览器还是供应商 API、采样次数、重试策略、实际结果复现性仍 UNKNOWN。

**内容优化/集成**：Sources 区分模型检索到的来源与最终回答中明确 citation；Actions 分 Site audit、Owned、Earned、Correct content 等类型并带 evidence。Content Optimization 可读取 URL/Markdown，逐段提供建议，应用/忽略/撤销/编辑并导出 HTML/纯文本；未见直接发布客户 CMS 的证据。Agent Analytics 将 robots.txt crawlability、服务器日志中的 crawler visits 与 GA4 AI referrals 分开；GA4 的 Direct/Organic 漏记使 referral 是下界而非完整归因。GA4/日志路径见 [data connection](https://docs.peec.ai/connecting-your-data)。

**定价**：公开品牌套餐上限：Starter 50 prompts、Pro 150、Advanced 350；均可选 3 models、每日跟踪，分别 1/2/5 projects。Advanced 增加 multi-country/Looker Studio；Enterprise custom，含 API、SSO、全部模型（最多 13 个）、daily/weekly。浏览器的公开价格视图显示 Starter $95/月、Pro $245/月、Advanced $495/月；本次能读取的静态页面不总暴露金额，故把额度列为较稳定页面证据、美元金额列为观察快照。Agency 页面按持续额度 credits 计费，1 prompt × 1 model × 1 day = 1 credit；不同计划 API/MCP 档位与品牌版 Enterprise 口径有差异。见 [brand pricing](https://peec.ai/pricing) 和 [agency pricing](https://peec.ai/pricing-agencies)。

**前端线索**：官网有 Framer 资源；公开 app shell bundle 中可见 React createRoot/StrictMode 与 Vite 标记，因此应用前端使用 React、Vite 是较强公开线索（VERIFIED），但没有登录后页面/网络请求，路由、状态管理、图表库、错误处理均 UNKNOWN。当前 MCP 文档列 51 个只读和 48 个写入工具（写操作依权限；删除标 destructive），体现了广泛的工具表面，但不等于后端源码。Peec 是对 GeoLens 最值得学习的公开信息架构、可钻取证据接口与清晰指标命名案例，仍不据此断言应用质量优于未开放的内部实现。

**指标定义（DOCUMENTED）**：Visibility = 提及品牌的 AI 回答比例；SOV = 品牌 mentions / 被追踪品牌 mentions；Position 是品牌出现时的平均排名；Sentiment 标尺 0–100。报告暴露 visibility_count/visibility_total、sentiment_sum/sentiment_count、position_sum/position_count。Domain retrieved_percentage 是含来源域名的 chats 比例；retrieval_rate 是每 chat 平均 URL 数，可大于 1；citation_rate 是检索到该域名的 chat 中每 chat 平均 inline citation 数，也可大于 1，不能当百分比。来源：[Metrics Overview](https://docs.peec.ai/metrics-overview)、[MCP Tools](https://docs.peec.ai/mcp/tools)。

## P1/P2 扩展结论

| 产品 | 核心定位和公开证据 | 对 GeoLens 的具体借鉴 | 关键限制 |
|---|---|---|---|
| Scrunch AI | Help Center 描述 9 个 AI 搜索平台、Prompt/Explorer、引用、Signals、Agent Pages/Traffic、Site Optimization、AI Search Trends 和购物；公开 metrics reference 列出 Mentions Rate、Citation Rate、Citation SOV 等字段；Core 官网 $250/月、125 prompts、5,000 responses、5 audits、1 workspace、5 seats，受限模型；Enterprise 自定义。[平台清单](https://helpcenter.scrunchai.com/en/articles/15863866-what-platforms-does-scrunch-monitor) · [metrics reference](https://helpcenter.scrunchai.com/en/articles/16823372-scrunch-metrics-reference-explorer-names-and-api-fields) · [pricing](https://scrunch.com/pricing/) | 明确区分品牌提及与自有来源被引用；把归一化的竞争份额、样本量和统计显著变化纳入分析；先用可解释 Signals 生成洞察。 | 数学细节虽比大多数厂商公开，但实际平台采集质量、统计显著性检验实现、企业控制台和模型解释器未验证。旧 CDN 定价页与主定价页数字不同，以主站为准并记为内容冲突。 |
| AthenaHQ | 官网描述 Monitor → Understand → Act，覆盖品牌/引用/情绪、prompt demand、竞争分析、行动中心、内容/外联/电商；套餐 credits 按 AI response 计量；API、GA4/GSC、MCP 集成有公开说明；ACE 引擎称预测引用概率。[Platform](https://athenahq.ai/platform/) · [Plans](https://athenahq.ai/plans) | 把“观察指标”与“推荐动作”衔接；按响应数而非模糊 credits 解释成本；若做建议排序，应显示证据。 | 引用概率引擎属于厂商声明，无法验证模型性能；登录应用、计量细节及内容代理执行效果 UNKNOWN。 |
| AirOps | SEO+AI 搜索内容运营。Docs 描述 Insights（Overview/Visibility/Citations/Community）、Workflows、Grid 表格批处理、human review、WordPress/Webflow 发布和 GSC 查询数据。定价按任务/用量；Solo ChatGPT only、Pro 7+ engines、Enterprise custom。[Insights](https://docs.airops.com/insights) · [Grids](https://docs.airops.com/actions/grids) | Grid 与 Workflow 的人工审核、版本对比、批量任务和 CMS 发布，是内容优化闭环最完整的参考；把 GSC 与 AI visibility 放在共同工作区。 | 官网宣传平台覆盖与 attribution 不是因果实验；精确套餐价格、监测采样和应用技术栈未确认。 |
| Ahrefs Brand Radar | 以大规模 AI Visibility Index 与自定义 Prompt 监测并行，覆盖 AI/YouTube/Reddit 等 Brand Radar 数据；有公开 API v3 文档（22 endpoints），含 AI responses、topics、cited pages/domains、impressions/SOV history。[AI metrics](https://help.ahrefs.com/en/articles/15501968-ai-visibility-metrics) · [API](https://docs.ahrefs.com/en/api/reference/brand-radar) | 将大规模搜索需求代理指标与用户自定义 prompt 监测分开；API 与来源域名/页面分析适合做证据探索。 | Impressions 基于 prompt 对应搜索词搜索量代理，不等于真实 AI 查询量；平台索引样本量和覆盖偏差大；月度 prompt pool 不能直接代表目标用户询问。 |

## 跨产品工程结论

1. **真正能复核的数据单位是一次 answer execution，而不是一个汇总分数。** 应保留输入 prompt、model/provider、region、采集时间、原始 answer、引用 URL、实体匹配及解析器版本。
2. **同名 KPI 不一定同口径。** Profound 的 Visibility 分母排除“无任何品牌”回答；Otterly Coverage 的分母一般是运行数，但 AI Overviews 未触发时剔除；Ahrefs AI Visibility Index 用 impressions proxy；直接对比分数会误导。
3. **趋势首先需要稳定 cohort。** Prompt、地区、平台和时间窗改变时，应分 cohort 或标注断点；品牌别名和竞品集合更新也可能重算历史。
4. **证据链比更花哨的评分更有产品价值。** 让用户从总览点到 Prompt，再到原始答案和 citation URL；显示 sample n 和 missing runs。
5. **“被引用”与“带来业务结果”是两层测量。** 来源被引用、AI crawler 访问、站点 sessions、转化需要独立数据源与匹配规则，不能直接宣传成因果归因。

## 图表与后续阅读

- Mermaid 可渲染架构图：[diagrams/DIAGRAMS.md](diagrams/DIAGRAMS.md)
- 监测时序源文件：[diagrams/monitoring-sequence.mmd](diagrams/monitoring-sequence.mmd)；数据模型源文件：[diagrams/reference-data-model.mmd](diagrams/reference-data-model.mmd)；证据流源文件：[diagrams/evidence-dataflow.mmd](diagrams/evidence-dataflow.mmd)
- [横向对比](PRODUCT_COMPARISON.md) · [页面与功能清单](PAGE_AND_FEATURE_INVENTORY.md) · [前端分析](FRONTEND_TECH_ANALYSIS.md) · [后端架构](BACKEND_ARCHITECTURE.md) · [指标与算法](GEO_METRICS_AND_ALGORITHMS.md) · [GeoLens 差距](GEOLENS_GAP_ANALYSIS.md) · [工程学习](ENGINEERING_LEARNING_GUIDE.md)。
