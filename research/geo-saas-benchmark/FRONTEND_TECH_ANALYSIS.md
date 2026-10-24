# 前端技术与交互研究

研究边界：仅检查公开营销页面、公开登录壳、官方帮助文档与产品示例图；没有登录各家账户或获取私有代码。**公开站点的框架线索不能外推为登录后 SaaS 应用框架。**

## 公开可观察的前端线索

| 产品 | 公开页面观察 | 产品应用技术栈 | 状态 |
|---|---|---|---|
| Profound | 登录壳含 Next.js 静态资源路径与 Turbopack 命名 chunk；有公开 email login/demo 入口 | 未确认；公开壳不代表 dashboard | V（壳）/ ?（app） |
| Otterly.AI | app 公共入口重定向至登录；页面说明需要 JavaScript；marketing 静态资源来自 Webflow CDN，帮助/API 文档有 Mintlify/HubSpot 资源 | 未确认 | V（入口）/ ?（app） |
| Peec AI | 主页由 Framer 提供；公开 app shell bundle 可见 React createRoot/StrictMode、Vite 标记；同时展示产品样例 dashboard | React/Vite 是 app bundle 线索；登录后页面、路由、状态管理和实际请求未确认 | V（壳/bundle）/ ?（登录态） |
| Scrunch | 官网公共 HTML 有 Astro 命名的页面脚本；导航和 audit form 展示在公开营销面 | 未确认 | V（官网）/ ?（app） |
| AthenaHQ | 平台/价格公开页面由 Astro 页面资源构建并经 Vercel 提供 | 未确认 | V（官网）/ ?（app） |
| AirOps | 产品营销页资源来自 Webflow CDN，含 Webflow/jQuery/Swiper 资源 | 未确认 | V（官网）/ ?（app） |
| Ahrefs | Brand Radar 静态页加载 Ahrefs release bundle；公开示例使用 ebuild 编译资源 | 未确认；不能仅凭 bundle 判断 app 框架 | V（公开页）/ ?（app） |

因此，只有 Peec 的公开 app shell 能提供 React/Vite 技术线索；没有足够证据比较各家登录后的组件树、路由、状态管理和性能。本次报告重点比较**可文档化的页面信息架构和交互模式**。

## 交互模式观察

### Profound：过滤、比较、钻取

官方 AEI 文档展示一致的页面骨架：日期与比较日期 → 平台/主题/标签/区域/竞品/语言/Persona 筛选 → 图表按维度切换 → 排名表 → 点击时间点回到 execution/answer 证据。保存视图和分享减少重复配置。引用面提供 domain/path 分类及 citation relationship 图。

前端状态可以合理推测为 URL 或可保存 view 中包含过滤器状态，报表 API 接收 dimension/filter/cursor；这是对产品文档功能的**推断**，不是抓取 API 的实测。GeoLens 可先让筛选状态序列化为 query object，保持表格和图表同源，避免两个视图统计口径漂移。

### Otterly：表格作为工作入口，Prompt Detail 承载证据

官方 help screenshots 记录了 Prompt Monitoring 表格、趋势图、详情页和 Citations。页面最有价值的交互是列表行 → Prompt Detail → Response 原文 → Citations URL 的层级；过滤字段在总览和细节里复用。建议区按 Suggested/To-Do/Archive 将分析转成操作状态。

不要从截图推断其内部组件库、响应式实现或真实 API 请求。收录的截图详见 [screenshots/README.md](screenshots/README.md)。

### Peec：用任务语义组织导航与 dashboard views

官方导航文档包含 Overview、Brand Insights、Brand Perception、Prompts/Discovery、Sources（Gap Analysis/Domains/URLs）、Optimize（Actions/Impact）、Results（Ranking/Chats/Fanouts/Ads）、Agent Analytics（Crawl Insights/Crawlability/AI Referrals）、Shopping、Settings。Overview 的日期、模型、竞品、国家、topic、tag 过滤可保存；日期支持与上一窗口比较，表格支持列选择/排序；Views 可保存多套 dashboard 并分享只读链接或导出 PDF。官网演示的样例数据不能当成客户账户实时数据。

可借鉴：主导航按“先总览、再问句、再来源、再行动”组织；KPI 卡点击后应进入对应 cohort，而不是独立孤岛；区分来源“被使用”与“被明确引用”。MCP 文档公开了 Read/Write 工具和 chat-level evidence fields，也说明写操作有权限要求；这些可用来设计 GeoLens 自身的 API contract，不足以确认其内部组件实现。

### AirOps：表格化批处理与 workflow 化动作

AirOps 文档的 Grid 更像可批处理的内容工作台：每行内容对象，每列为数据或动作，运行 workflow，比较结果，人工审阅后推送 CMS。Workflow step 文档含控制流/人工审阅/外部集成。相比只给建议列表，这种体验能保持内容对象、输入、生成结果与发布状态在一个表面。

## 重要交互的可知调用链

没有观察到竞品登录态的浏览器网络请求；下表把公开说明和推断拆开。API 返回形式仅在官方 API 文档存在同类字段时标 D，其余为 I。

| 产品/操作 | 用户操作 → 前端事件/状态 | API → 响应 → 页面更新 | 证据标签 |
|---|---|---|---|
| Profound 过滤并钻取 | 选日期、模型、主题/区域等 → 页面更新筛选条件；点击 chart point → 进入该时间点 runs | 公开 UI/API 内部连接未实测；合理推断带 filters/grouping 请求报表，响应聚合序列/排行，点击后请求对应 answers/executions → 更新图表和证据表 | UI 操作 D；请求关联 I；API filters/answers D |
| Otterly 查看回答 | 在 Prompt 列表选择一条 → 打开 Overview/Responses/Citations；选择 engine/Ads/Shopping 过滤器 | 官方公开 API 有按 prompt 列 answer runs 的端点及 raw content/mentions/citations；应用前端是否调用同一 API 未知。预期响应填充详情表，点击 answer 打开原文和 URL | 页面/数据字段 D；前端事件到实际 API I/? |
| Peec 保存筛选/查看 chat | Overview 选择 date/model/country/topic/tag；保存个人 filter；点击 prompt 进入分析；公开 docs 说明 prompt × 日期 × engine 产生 chat | MCP 暴露项目级读工具和 chats/metrics 字段，但未证明页面走 MCP；内部 app request/state cache 未知。参考推断为 filters → aggregate endpoint → KPI/series，click prompt → chat list/detail | 文档交互/数据模型 D；实际 UI API I/? |
| AirOps 批量更新内容 | Grid 选择 rows/运行 workflow → step / human review 状态变化 | Docs 明确 Grid/workflow/CMS 操作，但实际后台 API endpoint 未公开；参考推断异步 batch job 返回 row status/preview，审阅后 connector publish | 用户工作流 D；内部请求/响应 I/? |

**工程结论**：不应把厂商 API 文档等同于其前端实际使用 API。GeoLens 可以自行采用透明契约：filter action 生成 canonical filter object；报表 endpoint 回传 value、numerator、denominator、sampleCount 和 partial status；证据抽屉通过 execution id 加载 append-only raw answer 与 citations。

## 前端数据加载的参考调用链

下列是**GeoLens 参考实现**，不是竞品已验证内部实现：

1. 用户选择项目、日期、平台、区域或标签。
2. 页面把筛选状态更新到 URL/search params 和本地 query state。
3. Query key 由 projectId + canonical filters + page cursor 构成。
4. 前端调用同一 report endpoint 取 KPI、series、sample size；表格 endpoint 使用相同 filter contract。
5. 请求取消/竞态控制避免旧筛选响应覆盖新状态；loading skeleton、empty reason、partial provider failures 分别呈现。
6. 点图表 data point 将时间窗和过滤条件带到 prompt executions 页面。
7. 打开 answer detail drawer，懒加载原文、extracted mentions 与 citations；原始 evidence 可以复制/导出。

建议错误模型：请求失败显示可重试的错误 banner；单个 Provider 失败呈 partial 数据并保留成功 Provider；没有执行记录显示“尚无样本/等待首次任务”，而不是 0% visibility。

## 与 GeoLens 当前前端的对照

仓库源代码显示 web 使用 Next.js 15 / React 19 / Tailwind 4；当前有首页、登录、注册和 /app 组织/项目界面。apps/web/src/lib/api.ts 集中处理 API base、credentials 和 JSON 错误；app 页面当前主要展示组织、成员和项目，没有 GEO 报表/图表、prompt 表、execution 详情或 citations drill-down。

适合沿用的基础是统一 API helper、登录态与组织/项目上下文。要避免在正式 dashboard 中将 demo 数值写在页面组件里；应先定义带时间/样本口径的 query DTO 和空状态，再实现视觉组件。

## 可学习的 UI 组件与验收点

| 组件/模式 | 借鉴对象 | GeoLens 最小实现验收 |
|---|---|---|
| Filter bar + saved view | Profound | date/model/region/tag 状态可分享；切换筛选同时更新图表和表格 |
| Prompt execution table | Otterly / Peec | 按 prompt、引擎、地区、状态筛选；行显示 sample n 与最后运行时间 |
| Answer evidence drawer | Profound / Otterly | 展示原始回答、mention span、citation URL 和运行元数据 |
| Used vs cited source split | Peec | 作为不同事件/指标存储和显示，不混成 citation |
| Action queue | Otterly / Scrunch / Athena | 可追踪 Suggested→In progress→Done→Retest，每项展示证据 |
| Batch content grid | AirOps | 多 URL 执行、状态/错误列、人工审批、版本对比；后续再接 CMS |
| Empty/partial/error states | 全产品均无法从登录态验证 | 空项目解释如何开始；单 Provider 失败可见；失败有 retry；无样本不显示假零值 |
