---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 15ce975b5f313de8edfa891b974a2219_2842ec25a9fc11f1a393525400f8a581
    ReservedCode1: jr1R4I48qQzqF5oOt7HtQdCEgEoFMRlEEW3m2aaFP1MyViNu4rNs3lnd6ZiwKEWB6ovsS3RJMKGpwkoyH3RD2wGa3gcoBAViBdjZpR4+7k1BzAC1bZSzAtIimdRsJRSK17oeIbywqX9mmPzjCP4Q4dbJMBDcyCnOq8Zwly8Tki7jvudOcXROrBwmbpY=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 15ce975b5f313de8edfa891b974a2219_2842ec25a9fc11f1a393525400f8a581
    ReservedCode2: jr1R4I48qQzqF5oOt7HtQdCEgEoFMRlEEW3m2aaFP1MyViNu4rNs3lnd6ZiwKEWB6ovsS3RJMKGpwkoyH3RD2wGa3gcoBAViBdjZpR4+7k1BzAC1bZSzAtIimdRsJRSK17oeIbywqX9mmPzjCP4Q4dbJMBDcyCnOq8Zwly8Tki7jvudOcXROrBwmbpY=
---

# GeoLens 设计系统（Design System）

> 定位：**Evidence-first GEO Intelligence Console**
> 配套文档：docs/UI_REFERENCE_AUDIT.md（竞品借鉴决策）· docs/UI_COMPONENT_MAP.md（组件契约）
> 状态：设计定稿草案，待用户确认后进入 UI Implementation；本文档不约束后端/采集逻辑

---

## 1. 设计原则

| 原则 | 含义 | 反例（禁止） |
|---|---|---|
| **Evidence-first** | 每个数字都可点击回溯源证据；原始响应只读展示 | 无出处的大数字、不可验证的评分 |
| **专业 (Professional)** | 面向 B 端运营/SEO 从业者，信息密度优先 | 过度卡通化、营销化 |
| **克制 (Restrained)** | 一屏一个主任务，视觉元素为数据服务 | 大面积 AI 紫渐变、过度毛玻璃、满屏阴影 |
| **现代 (Modern)** | 遵循 2026 年数据产品惯例（Command Palette、Skeleton、Sticky Header） | 老式 iframe 套壳 |
| **高信息密度 (Dense but scannable)** | 表格/矩阵密排，但保留视觉层级与焦点 | 空泛留白、不可扫读 |
| **数据可信 (Trustworthy)** | 明确标注数据新鲜度、来源、失败态 | 隐藏更新频率、隐藏错误 |

---

## 2. Design Tokens

### 2.1 颜色体系（避免 "AI 科技紫"，采用"冷静数据蓝绿"）

**中性色（页面骨架，占比最高）**

| Token | 值 | 用途 |
|---|---|---|
| `gray-950` | #0B1220 | 深色文字/强调 |
| `gray-700` | #334155 | 次级文字 |
| `gray-500` | #64748B | 弱文字/占位 |
| `gray-300` | #CBD5E1 | 边框弱 |
| `gray-200` | #E2E8F0 | 分隔线 |
| `gray-50` | #F8FAFC | 页面背景 |
| `white` | #FFFFFF | 卡片/内容背景 |

**主色（用于主操作/选中态/主指标）——青蓝 (Evidence Teal)**

| Token | 值 | 用途 |
|---|---|---|
| `primary-600` | #0F766E | 主按钮/激活态 |
| `primary-500` | #14B8A6 | 主指标/链接 |
| `primary-100` | #CCFBF1 | 浅底/选中高亮 |
| `primary-900` | #134E4A | 深色强调 |

**语义色（低饱和，仅用于状态，不铺底）**

| Token | 值 | 用途 |
|---|---|---|
| `success` | #16A34A | 有提及/被引用/任务成功 |
| `warning` | #D97706 | 部分覆盖/待处理 |
| `danger` | #DC2626 | 未出现/失败/风险 |
| `neutral` | #94A3B8 | 无数据/禁用 |

> 语义色只出现在 Tag、状态点、趋势箭头等小面积；指标大数字一律走中性色+主色，避免彩虹面板。

**图表色板**（离散、可区分、非彩虹）：teal `#0D9488` / blue `#3B82F6` / amber `#F59E0B` / slate `#64748B` / coral `#F9776B`，面积图用 10%~30% 透明度渐变。

### 2.2 字体

| Token | 字体 | 用途 |
|---|---|---|
| UI | system-ui / Inter Natural，无衬线 | 界面全部文本 |
| Mono | 系统等宽（JetBrains Mono / ui-monospace） | Raw Response、URL、时间戳、代码证据 |

**Type Scale（6 级）**

| 级别 | 字号/行高 | 用途 |
|---|---|---|
| display | 40/48 · 600 | 页面主指标（Score） |
| h1 | 28/36 · 600 | 页面标题 |
| h2 | 20/28 · 600 | 区块标题 |
| body | 14/22 · 400 | 正文/表格 |
| caption | 12/18 · 400 | 辅助说明 |
| micro | 11/16 · 500 | Tag/徽标/表头小字 |

数字类（Score/指标）统一用 **tabular-nums** 对齐。

### 2.3 间距 / 圆角 / 阴影 / 边框

- **间距**：4px 基准，步进 4/8/12/16/24/32/48；卡片 padding 16；区块间距 24。
- **圆角**：控件 8px · 卡片 12px · Tag 999px（胶囊）。
- **阴影（3 级）**：`sm` 卡片常态（0 1px 2px rgba(15,23,42,.06)）；`md` 悬停/浮层；`lg` Drawer/Modal。避免大面积投影。
- **边框**：1px solid var(--gray-200)（卡片、表格分隔）；选中行列主色边框。
- **栅格**：主内容区 12 列栅格，max-width 1440px 居中；卡片按 3/4/6/12 列自适应。

---

## 3. 基元组件规范（Select）

| 组件 | 规范 |
|---|---|
| Button | 主按钮=实心 primary（16px padding 横，圆角 8），次按钮=描边 primary，文字按钮=灰色；禁用态降透明度；危险操作=红字 |
| Tabs / Segmented | 分段控件为主（引擎/时段切换）；页面级用秒下划线 tab |
| Table | 高密度（行高 40px），表头 caption 灰色大写，行悬停高亮，可点击行带主色左指示条，支持排序/分页 |
| Filter Bar | 全局 Header 常驻（Engine × Date × Tag × 项目），Tag 化显示当前筛选可一键清除 |
| Badge / Tag | 语义色胶囊，仅小面积；收录=success，未收录=neutral，引用=danger 高亮需求 |
| Modal | 少用；仅确认类（删除/批量操作），详情一律 Drawer |
| Drawer | Evidence Drawer 核心容器：右侧 480px，遮罩背景，Esc 关闭 |
| Empty | 3 态：无数据(可建) / 未监测(提示设定 Query) / 已过期(数据刷新 CTA)，均给下一步行动 |
| Loading | 骨架屏 Skeleton（区块/表格近似形），局部操作内联 spinner；禁止全屏转圈 |
| Charts | 趋势=面积/折线（带数据新鲜度标注）；对比=条形；占比=环形（≤2 个）；禁止装饰性雷达/动画 |

---

## 4. 页面框架（Layout System）

### 4.1 Global Sidebar（240px 固定）

- 顶部：产品 Logo（GeoLens）+ 版本号
- 主导航 ≤7 项（见下），一级扁平，无二级菜单堆叠
- 底部：设置入口 + 用户/项目信息

### 4.2 Global Header（56px 固定，sticky）

- 左侧：Project Switcher（当前项目/品牌，下拉切换）
- 中部：Date Range + Engine Filter（Global Filters）
- 右侧：Compare Mode 开关 · ⌘K 唤起 Command Palette · 数据新鲜度状态点 · 设置

### 4.3 主导航（≤7）

| # | 导航 | 内容 |
|---|---|---|
| 1 | 工作台 | 全局 KPI + 最新信号 + Action 摘要 |
| 2 | AI 可见度 | Visibility Score · SoV · Position · 诊断 |
| 3 | Queries | Query×Engine Matrix · Query 管理 |
| 4 | 引用来源 | Citation Table · Source Graph |
| 5 | 洞察 / Actions | Action Center · Competitor Ranking |
| 6 | 报告 | 数据报表（导出：CSV / 预留） |
| 7 | 设置 | 项目 · 采集任务 · 消耗配额 |

> 不超过 7 项；"账号/消费中心"等重资产不计入主导航（V0.1 从设置进入）。

---

## 5. 页面 Wireframe

> 布局示意，用于确认信息架构，非高保真。

### 5.1 工作台 Dashboard

```
┌──────┬────────────────────────────────────────────────────────┐
│ Sidebar │ Header: [Project v] [Date/Engine Filters] [⧉比对] [⌘K] │
│ 240px  ├────────────────────────────────────────────────────────┤
│        │  AI Visibility Score            Share of Voice          │
│ 工作台 ●│  ┌────────────────────┐      ┌──────────────────┐       │
│ AI可见度 │  │ 84/100  ▲3        │      │ 我 41% ▓▓▓▓▓      │       │
│ Queries │  │ Mention 62%        │      │ 竞A 22% ▓▓        │       │
│ 引用来源 │  │ Citation 48%       │      │ 竞B 19% ▓         │       │
│ 洞察/Act │  │ Position 2.1      │      │ [查看Evidence]    │       │
│ 报告    │  └──────────┬─────────┘      └──────────────────┘       │
│        │             ▼ [查看Evidence]                            │
│ 设置   │  Visibility 趋势(面积图,delta)     新信号 Timeline        │
│        │  ╭──────────────────────╮   ● 新 Citation g.com (2h)   │
│ -------│  │  ┌━━━┐  ┌━━━┐  ┌━━┓  │   ● Position ↑ to 1 (1d)    │
│ LitePro│  │  └━━━┘  封 ┘  └━━┛  │   ● Mention 首现 WeChat (1d) │
│        │  ╰──────────────────────╯   [全部→洞察]                 │
│        │  Action 摘要: 2 项高影响待办 → 查看                    │
└────────┴────────────────────────────────────────────────────────┘
```

### 5.2 Queries：Query × Engine Matrix

```
┌──────┬────────────────────────────────────────────────────────┐
│ Sidebar │ Header: [Project] [Filters ▾]           [导出] [⧉]  │
│        ├────────────────────────────────────────────────────────┤
│        │  Query × Engine Matrix          ┌ 仅看缺口 □          │
│        │  ┌──────────┬──────┬──────┬──────┬──────┐              │
│        │  │ Query    │ChatGPT│ Gemini│Perpxl│DeepSk│ 聚合        │
│        │  ├──────────┼──────┼──────┼──────┼──────┤              │
│        │  │"CRM 软件" │ ●      │ ●    │ ○    │ ●    │ 82         │
│        │  │"ERP 选型" │ ○      │ ●    │ ○    │ ●    │ 55 ←缺口   │
│        │  │ ...      │       │      │      │      │             │
│        │  └──────────┴panel──┴──────┴──────┴──────┘              │
│        │   ●=提及+引用 ○=未出现（点击任意格 → Evidence Drawer）    │
└────────┴────────────────────────────────────────────────────────┘
```

### 5.3 引用来源 Citation Table + Source Graph

```
┌──────┬────────────────────────────────────────────────────────┐
│ Sidebar │ Header: [Project] [Filters ▾] [导出CSV]             │
│        ├────────────────────────────────────────────────────────┤
│        │  来源域名        | 引用次数 | 最近引用 | 涉及Query | 归属 │
│        │  g.com/page-x   | 12      | 2h     | 5      | 我方  │
│        │  rival.com/y    | 9       | 8h     | 3      | 竞品  │──点击
│        │  ...            |         |        |        |      │   │
│        │  ── 右侧：Source Graph（域名节点 + 引用边，可下钻）    │<┘
└────────┴────────────────────────────────────────────────────────┘
```

### 5.4 洞察 / Actions：Action Center

```
┌──────┬────────────────────────────────────────────────────────┐
│ Sidebar │ Header: [Filters]                [批量生成方案]      │
│        ├────────────────────────────────────────────────────────┤
│        │  Action Center   未决 12 · 进行中 3 · 已解决 8         │
│        │  ┌──────────────────────────────────────────────┐      │
│        │  │ [Critical] Mention Gap 竞品在17个Query领先你   │      │
│        │  │  为什么: 竞品被提及品牌未出现(17/48)           │      │
│        │  │  影响: ≈12% SoV / 35% Query 受影响             │      │
│        │  │  [查看Evidence]  [生成优化方案]  [标记完成]     │      │
│        │  └──────────────────────────────────────────────┘      │
│        │  ┌──────────────────────────────────────────────┐      │
│        │  │ [High] Citation Gap: 引用竞品未引用你的域名×6  │      │
│        │  │  ...                                        │      │
│        │  └──────────────────────────────────────────────┘      │
└────────┴────────────────────────────────────────────────────────┘
```

### 5.5 全局浮层：Evidence Drawer（右侧 480px）

```
┌────────────────────────────────────────┬─────────────┐
│ 主内容（被暗化）                           │  Evidence    │
│                                         │  Drawer      │
│                  ← 任意指标点击            │ ───────────  │
│                                         │ Query:  CRM  │
│                                         │ Engine: ChatGPT│
│                                         │ Model: GPT-4  │
│                                         │ 时间戳: 今天06:00│
│                                         │ Retrieval: Web│
│                                         ├───────────────┤
│                                         │ Visibility 84  │
│                                         │ Position 2   │
│                                         │ Mention ✓    │
│                                         │ Sentiment 正   │
│                                         ├───────────────┤
│                                         │ Raw Response   │
│                                         │ (Mono,高亮)    │
│                                         ├───────────────┤
│                                         │ Citations[3]   │
│                                         │ 竞品: A,B      │
│                                         │ [推荐内容]      │
└────────────────────────────────────────┴─────────────┘
```

### 5.6 页面清单（V0.1 共 6~7 页 + 1 全局浮层）

| 页面 | 主组件组合 |
|---|---|
| 工作台 | Global KPI · Signal Timeline · Action 摘要 |
| AI 可见度 | Visibility Score · SoV · Gap 诊断 · Crawlability 摘要 |
| Queries | Query×Engine Matrix · Query 管理（Query Builder） |
| 引用来源 | Citation Table · Source Graph |
| 洞察 / Actions | Action Center · Competitor Ranking |
| 报告 | 报表视图 · 导出 |
| 设置 | 项目设置 · 采集任务(Task Progress) · 消耗配额 |
| 全局浮层 | **Evidence Drawer · Command Palette** |

---

## 6. 反模式红名单（Do Not）

- 大面积 AI 紫渐变、全屏毛玻璃背景
- 满屏 Drop Shadow、3D 元素
- 多个彩环图并排（最多 2 个占比环）
- 无意义入场动画 / 常驻 marquee / 雷达扫描装饰
- 30+ 侧边栏菜单、深层嵌套导航
- iframe 内容区、模态套模态

---

## 7. 待确认事项

1. **浅色 vs 深色主题**：当前按浅色主文档风格规划；如需深色控制台风（更情报台感）请指示。
2. **主色确认**：青蓝 teal（当前默认）是否合适，或偏好其余冷静色（蓝 #2563EB / 蓝绿 #0D9488）。
3. **Wireframe 布局**：上述 5 页布局是否符合预期，可提出调整后再进入 UI Implementation。
*（内容由AI生成，仅供参考）*
