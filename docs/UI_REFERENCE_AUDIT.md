---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 15ce975b5f313de8edfa891b974a2219_253c8c0aa9fc11f190de525400461939
    ReservedCode1: S1a4eVNG7X6gdCGuiaxFTHT55DM8f5f4B63T0YrfrAzsZHDXPSVgdkFxDPhxYgAxFEhZ4pMas35NR0Q1QzZZgw8MI8PqhSbvpoGvb9zyZR1dvi/yP3yF/mxURS6iZ7QGhZP5TnsSVahw8jLwuBpHxjdm10eso4WhPD9ULlEKlBkRmv2XkzE+wIzMq5s=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 15ce975b5f313de8edfa891b974a2219_253c8c0aa9fc11f190de525400461939
    ReservedCode2: S1a4eVNG7X6gdCGuiaxFTHT55DM8f5f4B63T0YrfrAzsZHDXPSVgdkFxDPhxYgAxFEhZ4pMas35NR0Q1QzZZgw8MI8PqhSbvpoGvb9zyZR1dvi/yP3yF/mxURS6iZ7QGhZP5TnsSVahw8jLwuBpHxjdm10eso4WhPD9ULlEKlBkRmv2XkzE+wIzMq5s=
---

# GeoLens UI/UX 竞品侦察审计（UI Reference Audit）

> 文档性质：只读审计 + 借鉴决策记录，不含任何代码改动
> 日期：2026-09-06
> 审计对象：
> - GEO 商业系统 `geo.b7u.cn`（18 个页面逐页截图实证）
> - 现代 GEO / AI Visibility 数据产品 9 款（OtterlyAI / Peec AI / Profound / Scrunch AI / Semrush AI Visibility Toolkit / Ahrefs Brand Radar / Search Atlas / Writesonic GEO / Surfer AI Tracker）
> 方法：浏览器逐页截图 → 图像视觉分析 → 联网纵深调研 → 交互模式聚类
> 红线确认：**未复制任何商业网站源码**；本文档只记录信息架构、交互语义与视觉规律，设计成 GeoLens 自己的视觉语言。

---

## 1. 审计范围与方法

| 阶段 | 动作 | 产出 |
|---|---|---|
| 1. UI 逆向审计 | geo.b7u.cn 后台登录，逐页截图 18 页 | 逐页清单 + 信息架构树（见 §2） |
| 2. 设计系统提取 | 对代表性页面做视觉特征标注 | 元素级观测表（见 §3） |
| 3. 借鉴矩阵 | 每个元素标记 A/B/C | 决策矩阵（见 §5） |
| 4. 现代 GEO SaaS 调研 | 9 款真实产品桌面调研 | 产品矩阵 + 通用交互模式（见 §4） |

---

## 2. UI 逆向审计：geo.b7u.cn

### 2.1 整体信息架构（Sidebar 菜单树）

系统为「左侧深色/浅紫侧边栏 + 顶部栏 + 主内容区」经典 SaaS 三栏布局，主内容区大量使用 iframe。完整菜单层级如下：

```
geo.b7u.cn 后台
├── 首页
│   └── /user/dashboard            工作台 Dashboard（账号有效期、合规提示）
├── AI 诊断
│   ├── /user/analyze/add          AI 可见度诊断（输入关键词 → 诊断）
│   ├── /user/analyze              诊断报告（历史列表）
│   ├── /user/company_keyword      关键词管理（蒸馏词，18 条主词）
│   ├── /user/tuozhan              手动拓词工具（ABCDEF 六区组合）
│   └── /user/images_type          企业画像图库
├── AI 创作
│   ├── /user/article              文章管理（分类/待审核列表）
│   ├── /user/ai_task              AI 创作任务（任务队列）
│   ├── /user/zhiling              写作指令（提示词库）
│   ├── /user/weixin_baowen        全网爆文复刻
│   └── /user/draft                个人自媒体发布任务（草稿 3 天清理）
├── 流量 / 分发
│   ├── /user/webmedia             网站媒体（投稿资源市场）
│   ├── /user/b2b                  B2B 行业直投（付费分发）
│   ├── /user/zimedia              自媒体大V
│   ├── /user/weixinapp2           个人自媒体账号授权
│   └── /user/user_site            AI 官网 SEO 站点管理
├── 数据中心
│   ├── /user/tongji → /index/report_v2   AI 收录统计（8 大模型平台报表）
│   └── /user/shoulu_tuozhan       查收录（AI 数据中心查询，计费）
└── 账户 / 计费
    ├── /user/user_score_log       消耗明细（点数）
    ├── /user/quanyi               账号权益（配额总览）
    └── /user/realname             实名认证
```

**IA 观察**：
- 菜单按业务链路编排：`诊断 → 创作 → 分发 → 数据 → 账户`，即"先分析、再生产内容、再分发、再看数据"的线性漏斗。
- 菜单总数约 30+，层级达 2~3 级，存在功能重叠（诊断 / 拓词 / 查收录都涉及关键词）。

### 2.2 逐页审计清单（18 张截图）

| # | 截图 | 页面名称 | URL | 页面用途 | 主要区域 / 组件 | 用户主要操作 |
|---|---|---|---|---|---|---|
| 01 | geo_b7u_01_首页dashboard | Dashboard/工作台 | /user/dashboard | 全局总览 | 左侧栏 + 功能入口卡片组 + 图文核心模块 + 折线图/柱状图 | 进入各功能模块 |
| 02 | geo_b7u_02_…AI可见度诊断 | AI 可见度诊断 | /user/analyze/add | 关键词可见度分析 | 诊断表单 | 输入关键词发起诊断 |
| 03 | geo_b7u_03_文章管理 | 文章管理 | /user/article | AI 生成内容管理 | 分类筛选 + 列表表格 + 状态标签（待审核等） | 筛选分类、增删文章 |
| 04 | geo_b7u_04_…AI收录统计 | AI 收录统计报表 | /user/tongji | 8 大模型平台收录数据 | KPI 统计数字（问题总量4914/收录0/平台8/蒸馏词18）+ 环形占比 + 面积趋势 | 查看各平台收录 |
| 05 | geo_b7u_05_…AI创作任务 | AI 创作任务（任务队列） | /user/ai_task | AI 写作批处理 | 任务列表 + 状态（9 条记录） | 创建任务、查进度 |
| 06 | geo_b7u_06_网站媒体发布 | 网站媒体投稿市场 | /user/webmedia | 投稿资源选购 | 资源卡片列表（价格/权重/出稿率） | 浏览媒体、投稿 |
| 07 | geo_b7u_07_关键词管理 | 关键词/蒸馏词管理 | /user/company_keyword | 核心关键词维护 | 表格列表（18 条主词）+ 增删 | 新增、编辑、删除关键词 |
| 08 | geo_b7u_08_诊断报告列表 | 诊断报告列表 | /user/analyze | 历史诊断结果 | 空列表 + 删除 | 查看/删除报告 |
| 09 | geo_b7u_09_企业画像图库 | 企业画像图库 | /user/images_type | 企业形象素材 | 空列表 + 增删 | 上传/管理素材 |
| 10 | geo_b7u_10_…发布任务 | 自媒体发布任务 | /user/draft | 发布任务草稿 | 空列表 + 增删 + 3 天清理提示 | 新建/删草稿 |
| 11 | geo_b7u_11_点数明细 | 消耗明细（点数） | /user/user_score_log | 扣点记录 | 明细表格（空态） | 查看点数消耗 |
| 12 | geo_b7u_12_账号权益配额 | 账号权益配额 | /user/quanyi | 套餐总览 | 配额指标组（主关键词/问题/篇数/点数/余额/有效期/各模型收录数） | 查看剩余额度 |
| 13 | geo_b7u_13_手动拓词工具 | 手动拓词工具 | /user/tuozhan | 关键词组合生成 | 六区输入框（ABCDEF）+ 组合方式胶囊复选 + 结果区 + 生成/复制/清空按钮组 | 填词→选组合→生成→复制 |
| 14 | geo_b7u_14_B2B行业直投 | B2B 行业直投 | /user/b2b | 付费 B2B 分发 | 平台卡片网格（¥2/¥6/¥83 每篇 + 规则提示）+ 边框/渐变按钮 | 选平台、立即发布 |
| 15 | geo_b7u_15_…SEO站点 | AI 官网 SEO 站点 | /user/user_site | 官网 SEO 站点配置 | 空列表 + 增删 | 添加/管理站点 |
| 16 | geo_b7u_16_查收录查询 | 查收录（AI 数据中心） | /user/shoulu_tuozhan | 多平台收录查询（计费） | 主词下拉 + 六区输入 + 平台复选（8 模型）+ 计费主按钮 + 结果区 | 配词组→提交查询 |
| 17 | geo_b7u_17_写作指令 | 写作指令（提示词） | /user/zhiling | AI 写作提示词管理 | 增删 + 系统默认指令入口 | 新增/编辑提示词 |
| 18 | geo_b7u_18_…账号授权 | 自媒体账号授权 | /user/weixinapp2 | 账号授权管理 | 删除 + 下载助手 + 设备授权码 | 下载客户端、设备码绑定 |

### 2.3 设计规律提取（基于截图视觉分析）

**布局骨架**
- 三栏：左侧 Sidebar（约占屏宽 1/5，浅紫/深色底，多级菜单 + 选中态指示）+ 顶部栏 + 右主内容区。
- 列表页 = 主内容区 + 顶部筛选 / 操作条 + 表格；表单工具页 = 分区块纵向堆叠 + 底部主操作。

**视觉风格特征**（代表性页面观察）
- 主色：蓝紫渐变（主按钮/选中态/图表）；辅助色：马卡龙系（浅蓝/浅绿/浅粉/浅橙）用于指标卡与图表分区。
- 卡片：圆角约 12px + 柔和阴影，白底/浅灰底。
- 字体层级：核心数据大号加粗 → 标题中号深色 → 说明小号浅灰，三级分明。
- 按钮：渐变填充主按钮 + 描边次按钮 + 功能色按钮（绿色复制 / 红色清空），主次明确。
- 图表：垂直柱状图、多色环形占比图、折线/面积趋势图、雷达扫描动画（装饰性）。

**组件复用模式**
- 「六区关键词组合器（ABCDEF）+ 组合方式胶囊复选 + 生成/复制/清空按钮组 + 使用说明块」是多页复用的核心范式（拓词、查收录共用）。
- 「空列表 + 添加/删除按钮组 + 一句说明文案」是全站统一空状态。
- 「资源市场卡片 = Logo + 价格 + 状态标签 + 双操作按钮」是商业密度最高的列表形态。
- 计费前置可见：主按钮直接标注成本（"提交查收录（余额：0.00 元）"、"¥2/篇"）。

**数据展示模式**
- KPI 大数字指标卡（问题总量/收录总量/训练平台/蒸馏词）+ 环形占比 + 面积趋势的组合。
- 按 8 大 AI 平台分维度展开收录报表。

---

## 3. 设计系统元素观测（geolens 启示推导）

> 目的：识别设计规律，而非像素级还原。下表左列是审计项，中间是对 geo.b7u.cn 的观测，右列是 GeoLens 的启示（最终取舍见 §5 借鉴矩阵）。

| 元素 | geo.b7u.cn 观测 | GeoLens 启示 |
|---|---|---|
| Sidebar | 宽约屏 1/5，浅紫底，多级菜单，选中态变色 | 固定宽 240px，浅色/深色统一底，一级主导航 ≤7 项 |
| Header | 顶部栏较薄，含产品名与快捷入口 | 固定高 56px，放全局筛选与 Project Switcher |
| 页面最大宽度 | 未约束，内容撑满 | 主内容区 max-width 1440px，超大屏留白居中 |
| Grid | Dashboard 功能区卡片 + 下方图表两栏分栏 | 12 列栅格，卡片按 3/4/6 列自适应 |
| Card | 白底圆角 ~12px + 柔和阴影 | 1px 边框 + 细阴影为主，少大面积投影 |
| Border | 细边框，Baibli 划分区块 | 1px rgba(0,0,0,0.06)；分隔线用 8px 间距替代线框 |
| Radius | 约 12px，胶囊按钮 | 统一 8px（控件）/ 12px（卡片）/ 999px（Tag） |
| Shadow | 柔和阴影 | 3 级（sm/md/lg），仅浮层与悬停使用 |
| Spacing | 区块紧凑，信息密度偏高 | 4px 基准，8/16/24 步进；行距保证可扫读 |
| 字体层级 | 三级（数据/标题/说明） | 6 级 Type Scale（40/28/20/16/14/12），等宽字体渲染原始证据 |
| 颜色 | 蓝紫渐变 + 马卡龙辅助 | 中性灰阶底 + 单一冷静主色 + 语义色（绿/橙/红 慎用） |
| 按钮 | 渐变主按钮 + 描边次按钮 + 功能色 | 实心主按钮（主色）、描边次按钮、文字按钮；禁用态明确 |
| Tabs | 顶部 tab 切换（URL ?ref=addtabs） | 分段控件 Segmented + 每页可 sub-tab |
| Table | 传统表格，行高较密 | 高密度表格，但保留行悬停高亮与可点击行 |
| Filter | 分类筛选条 | 全局 Filter Bar（Engine × Date × Tag × Region），可存视图 |
| Badge | 圆角状态标签（待审核、已开通） | 语义色 Tag：收录/未收录/引用/未引用/风险 |
| Modal | 常规居中弹窗 | 少用 Modal，优先 Drawer（证据/详情） |
| Drawer | 未见 | Evidence Drawer 为核心容器（见 UI_COMPONENT_MAP.md） |
| Empty | 统一"空列表 + 添加按钮 + 说明文案" | 3 态 Empty：无数据 / 未监测 / 已过期，均给下一步 CTA |
| Loading | 页面级转圈 | 骨架屏 Skeleton 为主，增量区域用内联 spinner |
| Charts | 柱/环/面积 + 装饰性扫描动画 | 面积趋势 + 柱/条形为主；圆环仅用于占比；禁止无意义动画 |

---

## 4. 现代 GEO / AI Visibility 产品调研

### 4.1 产品定位矩阵

| 产品 | 定位 | 核心用户 | 平台覆盖 | Action Center |
|---|---|---|---|---|
| OtterlyAI | 纯 GEO 监控 + 审计 | 营销经理/SEO/代理 | 6 引擎 | ◐ 审计式 |
| Peec AI | AI 搜索分析（简单循环） | 营销团队/代理 | 6 引擎 | ✓ Actions |
| Profound | 企业级 AI 可见度平台 | 大型企业/品牌战略 | 9–11 引擎 | ◐ Aim |
| Scrunch AI | 企业 GEO + Agent 体验平台 | 企业增长/技术 SEO | 7 引擎 | ◐ Insights |
| Semrush AI Visibility Toolkit | SEO 套件 GEO 模块 | 已有 Semrush 团队 | 7 引擎 | ◐ Opportunities |
| Ahrefs Brand Radar | 基于索引的 AI 份额研究 | 已有 Ahrefs 团队 | 6 引擎 + 社媒 | ✗ |
| Search Atlas | 执行型 GEO 自动化 | 代理/企业 | 4 引擎 | ✓ Agentic |
| Writesonic GEO | 追踪→行动→结果闭环 | 内容团队/代理 | 10+ 引擎 | ✓ 核心差异化 |
| Surfer AI Tracker | 内容优化 + AI 追踪 | 内容团队 | 5 引擎 | ◐ Optimize |

### 4.2 通用交互模式（12 条，跨产品反复出现，是设计系统依据）

1. **三核心指标恒定锚点**：Visibility / Position / Sentiment 贯穿全局，同一视觉语义复用（Peec、OtterlyAI、Semrush 为范本）。
2. **Prompt 为中心的信息架构**：数据组织原子是 Prompt（Query），按 Prompt × Engine × Day 三维展开。
3. **提及 vs 引用分离**：Brand Mention（品牌被命名）与 Source Citation（页面被引用）是两个独立指标，并派生出"被命名未引用=流量损失"的差距信号。
4. **Citation Gap → Content Gap 漏斗**：竞品被引域名而品牌缺失 → 内容更新/外联/社区运营（OtterlyAI Citation Gap、Peec Source Analysis、Writesonic Citation Opportunities 同源）。
5. **Action Center 优先级队列**：影响 × 努力排序 + 状态机（Unresolved/In progress/Resolved）+ 一键修复/草稿生成（Writesonic 最成熟）。
6. **多维过滤标准化**：Engine × Region IP × Prompt Tag（Persona/Funnel）× Time，可保存视图（Scrunch、Peec 标杆）。
7. **来源图谱**：答案 → 引用 URL → 域名权威 的网络可视化，可下钻（Semrush Source Graph、Ahrefs AI Sources）。
8. **自动 Prompt 建议降冷启动**：输入域名/品牌 → 生成建议 Prompt → 用户接受/修改/驳回（Peec、OtterlyAI、Profound Volumes）。
9. **趋势 + 数据新鲜度**：日更 cadence 显式可视化，标注上次/下次刷新时间，降低"数字为何变了"困惑。
10. **工作区隔离**：Workspace/项目切换 + RBAC，多品牌/多客户数据隔离（Scrunch、Semrush、OtterlyAI）。
11. **导出与集成层**：CSV / Looker Studio / REST API / MCP 作为每个视图标准出口（MCP 已成 2026 标准）。
12. **Crawlability 前置诊断**：robots.txt / schema / AI bot 抓取可达性作为可见度前提，而非孤立 SEO 审计。

---

## 5. 借鉴矩阵（A / B / C）

> 判定标准：**A** = 直接借鉴交互思想；**B** = 改造后使用；**C** = 不推荐（视觉或交互方向与 GeoLens 定位冲突）。

### 5.1 geo.b7u.cn 元素

| 元素 | 评级 | 说明 |
|---|---|---|
| 左侧 Sidebar + 顶部栏 + 主内容三栏骨架 | A | 业界标准，直接采用（交互思想层面） |
| 业务链路菜单编排（诊断→创作→分发→数据→账户） | B | 保留"分析→行动"链路，但 GeoLens 重组为 ≤7 项 |
| Dashboard KPI 大数字 + 趋势图组合 | A | 标准数据产品形态，直接采用 |
| 六区关键词组合器 + 胶囊复选 | B | 保留"组合生成"交互思想，重设计为 Query Builder |
| 空状态"空列表+CTA+说明" | A | 直接采用 |
| 计费前置（按钮标注成本） | B | GeoLens 换成"配额/消耗"轻提示，不搞复杂计费中心 |
| 列表-详情复用模式 | A | 直接采用 |
| 30+ 菜单、多层嵌套 | C | 信息负担过重，拒绝 |
| 大面积营销 Banner / 合规强制横幅 | C | 破坏数据可信氛围，拒绝 |
| 蓝紫渐变 + 马卡龙 + 装饰动画 | C | 过度炫技，与"专业克制"冲突 |
| 复杂消费中心（权益/点数/实名） | C | GeoLens 不设商品化权益中心 |
| iframe 嵌套内容区 | C | 破坏路由与状态共享，拒绝 |

### 5.2 现代 GEO 产品模式

| 元素 / 模式 | 评级 | 说明 |
|---|---|---|
| 三核心指标恒定锚点（Visibility/Position/Sentiment） | A | 直接采用，作为全局 KPI Token |
| Prompt 为中心 IA + Query×Engine Matrix | A | GeoLens 核心视图，直接采用 |
| 提及 vs 引用分离 + 差距信号 | A | Evidence-first 数据模型基石 |
| Citation Gap → 行动漏斗 | A | 采用，接入 Action Center |
| Action Center（影响×努力 + 状态机） | A | 差异化重点，直接采用 |
| Evidence / Source Graph 下钻 | A | GeoLens 灵魂功能，直接采用 |
| 自动 Prompt 建议降冷启动 | B | 采用但要克制，避免向导化 |
| 多维 Filter Bar + 保存视图 | B | 采用，但 V0.1 仅 Engine×Date×Tag 三维 |
| 数据新鲜度提示（下次刷新倒计时） | B | 采用轻量版（显示"更新于 X，下次 Y"） |
| Workspace 切换 + RBAC | B | 采用 Project Switcher（团队版再细化 RBAC） |
| CSV/Looker/API/MCP 导出 | B | 预留导出入口，V0.1 先 CSV + API |
| Crewlability/技术审计 | B | 作为可见度前置诊断进入"AI 可见度"页 |
| 大量彩色圆环图 / 3D 可视化 | C | 数据可信优先，拒绝装饰性图表 |
| 无意义动画/渐变过度 | C | 拒绝 |

---

## 6. 结论与边界

1. **geo.b7u.cn 的价值在"业务链路"与"组件范式"，不在视觉**：其 Info-Architecture（分析→生产→分发→数据）与工具形态（组合生成、空状态、资源卡片）值得借鉴；其营销化视觉与 30+ 菜单是反面教材。
2. **现代 GEO 产品的价值在"数据交互语义"**：三指标锚点、Prompt×Engine 矩阵、提及/引用分离、Action Center、Evidence 下钻是成熟共识，直接决定 GeoLens 信息架构。
3. **GeoLens 视觉语言独立原创**：所有借鉴均收敛为交互契约，最终视觉按 docs/DESIGN_SYSTEM.md 的"专业/克制/高信息密度"方向实现，不复制任何竞品视觉。
4. **界限**：本审计只读、不落地；UI Implementation 需待用户确认 DESIGN_SYSTEM.md 后另行启动。
*（内容由AI生成，仅供参考）*
