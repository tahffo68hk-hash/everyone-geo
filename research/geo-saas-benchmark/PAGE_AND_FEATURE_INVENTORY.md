# 页面与功能清单

证据状态：D = 官方文档明确描述；V = 本次可访问公开页面/素材观察到；I = 推断；? = 未确认。无登录后账户的浏览器访问，因而各产品真实应用交互均不作 VERIFIED 表述。

## P0 产品页面地图

| 产品 | 页面/模块 | 主要数据/组件 | 典型操作/路径 | 证据 |
|---|---|---|---|---|
| Profound | AEI Overview / Visibility | 日期比较、平台/区域/主题/竞品筛选、趋势/排名表 | 筛选 cohort → 切维度 → 点击时间点看 runs | D |
| Profound | Sentiment / FactCheck | claims、情绪、事实核验结果 | 从 aggregate 钻到 answer/claim | D |
| Profound | Citations | 域名/路径类别、citation share/coverage、关系图 | 选日期/平台/主题 → 发现引用域/页面 | D |
| Profound | Prompts / Prompt Designer | Topic、Prompt、Tag、Region、Language、Persona、平台 | 手动/CSV/生成 → 批量编辑/翻译/禁用 | D |
| Profound | Prompt Volume | prompt 搜索需求数据 | 查询/规划主题 | D |
| Profound | Custom Dashboards | 可组合图表与表格、已保存筛选、分享/导出 | 组织内/只读链接分享 → PDF 导出 | D |
| Profound | AI Marketer / Aim | 任务建议、项目、内容简报/文章 | 从指标变化生成行动或启动 Agent | D |
| Profound | AEO Content Scorecard | URL 与目标 prompt 的可读性/结构/时效/可回答性/机器可读性/信息密度 | 输入页面 → 评分 → 调整内容 | D |
| Profound | Shopping | 商品卡、图片/价格/卖家/购买按钮 | 查询品牌/SKU 可见性 | D，主要 ChatGPT Shopping |
| Profound | Agent Analytics | CDN/服务器日志导入、AI crawler 流量 | 接入日志 → 查看 agent/page 访问 | D |
| Otterly.AI | Brand Report Overview | Coverage 趋势、竞品、品牌位置、top/trending prompts | 日期/引擎/国家/tag 筛选 → 发现变化 | D |
| Otterly.AI | Prompt Monitoring | prompt 表、Coverage、Sentiment、Intent Volume、Mentions、Citations、Ads/Shopping | 管理 prompt、tag、批量导入/导出 | D |
| Otterly.AI | Prompt Detail | Overview / Responses / Citations，原文和来源 | 点 prompt → 过滤引擎/国家/广告 → 查看原回答 | D |
| Otterly.AI | Citation Report | 趋势、Top Winners/Losers、域名/URL 表 | 搜索/排序 URL → 查哪些 prompt 引用 | D |
| Otterly.AI | Domain Sources | 自有/竞品域引用、类别图表、引用 prompt | 过滤/星标机会 URL | D |
| Otterly.AI | Recommendations | Suggested / To-Do / Archive、优先级和建议原因 | 查看证据 → 记团队备注 → 待办/归档 | D |
| Otterly.AI | GEO Audit | Crawlability Checker / Content Checker / Query Fan-Out | 输入 URL → 下载 PDF → 选 fan-out prompt 加入监测 | D |
| Otterly.AI | Agent Analytics | Overview / Pages / Agents、日期/引擎筛选 | 看 AI crawler 访问/URL/agent | D |
| Peec AI | Overview | Visibility / Position / Sentiment 趋势与 KPI 卡 | 选择周期/模型 → 识别变化 | D/V（营销演示） |
| Peec AI | Prompts | prompt 维度覆盖、趋势和响应 | 加 prompts → 查有/无提及的问题 | D/V |
| Peec AI | Market Insights | 品牌、主题、竞品市场份额 | 比较市场/主题 | D/V |
| Peec AI | Brand Perception | 品牌情绪/认知分析 | 按回答/主题切片 | D/V |
| Peec AI | Sources / Domains / URLs | 使用或引用来源及来源站点 | 查来源被使用/被引用差别 | D/V |
| Peec AI | Gap Analysis / Actions | 竞争缺口与改善步骤 | 找 prompt/source gap → 形成行动 | D/V |
| Peec AI | Impact | 结果趋势或前后变化样例 | 查看 action 前后指标 | D/V；因果归因未确认 |

## P1 / P2 产品页面地图

| 产品 | 页面/模块 | 组件/交互与目标 | 证据 |
|---|---|---|---|
| Scrunch | Agent Pages / Agent Traffic | AI 代理访问和页面表现 | D |
| Scrunch | Site Optimization | crawlability、页面优化和建议 | D |
| Scrunch | Monitoring & Citations / Explorer | prompt 运行、提及率、引用率/份额、实体比较 | D |
| Scrunch | Insights / Signals | 重大变化 insight card、置信/样本门槛、反馈 | D；内部显著性算法未知 |
| Scrunch | Shopping / AI Search Trends | 购物和品类趋势 | D |
| AthenaHQ | Monitor | visibility、mentions、citations、sentiment、competitors | D |
| AthenaHQ | Understand / Insights | prompt/demand、source claims、变化原因 | D |
| AthenaHQ | Act / Action Center | 内容、媒体/外联、commerce 相关行动 | D |
| AthenaHQ | Integrations / API / MCP | GA4、GSC、外部工具和 API | D |
| AirOps | Insights: Overview / Visibility / Citations / Community | 日期、region、prompt type、platform、topic、persona 筛选 | D |
| AirOps | Workflows | 集成、生成内容、循环、人工审阅步骤 | D |
| AirOps | Grids | 表格化批处理、版本比较、审核和发布 | D |
| AirOps | CMS / GSC integrations | WordPress、Webflow、GSC 等任务数据/发布 | D |
| Ahrefs | AI Visibility Index | mentions/citations/impressions/SOV 趋势、平台比较 | D/V（公共样例图） |
| Ahrefs | Custom Prompts | 用户问题监测、模型和周期配置 | D |
| Ahrefs | Topics / Cited pages / Cited domains | 主题、引用页面/域分析 | D |
| Ahrefs | Brand Radar API | responses、topics、pages/domains、历史/概览 endpoints | D |

## 典型使用路径

### Prompt 监测产品（Profound / Otterly / Peec / Scrunch）

配置 Brand 与别名 → 录入竞品 → 建立 Prompt 集和标签 → 选地区/语言/模型 → 等待异步监测 → 总览看覆盖趋势 → 点击 Prompt 查看答案 → 检查品牌位置、引用与来源 → 生成建议/内容动作 → 在固定 cohort 上复测。

这条路径是各家文档共同指向的产品模型，不代表每家 UI 细节完全相同。Profound 与 Otterly 的指标和证据 API 文档较完整；Peec 的可见 demo 对路径呈现较明确。

### 内容工作流产品（AirOps / Profound AI Marketer）

发现问题或内容缺口 → 选择页面/主题 → 研究/简报 → 生成或刷新草稿 → 人工审核/版本比较 → CMS 发布 → 再次监测。只有 AirOps 文档明确给出 Grid、human review 和 WordPress/Webflow 发布连接；Profound AI Marketer 文档说明内容 agent，但本次未确认同样的 CMS 发布覆盖。

### 采集、审核与优化路径（Otterly）

注册 → 输入域名/品牌/竞品/prompt → 首份 Brand Report → 选择国家 → 等待数据 → Citation/Prompt Detail 发现缺口 → GEO Audit/Recommendations → 待办与复测。注册后的实际使用未操作。

## 页面状态与交互证据缺口

本次不能对七家登录产品的 Empty/Loading/Error 状态、响应式断点、键盘/无障碍、前端性能、请求重试或状态管理作结论。官方文档/API 只证明所描述的功能和字段；文档截图可能是某个时间点的示例数据。公开站点技术栈不等于产品 app 技术栈。
