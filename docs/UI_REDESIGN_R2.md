# GeoLens UI Product Redesign R2

日期：2026-09-09。START_HEAD：`fe022ca`。先审计、后设计、再实现。

## Audit baseline

开始时已有其他工作的未提交文件：`apps/api/src/app.module.ts`、query-workspace DTO、Prisma schema、activity 目录、query archive migration、prisma_ver.txt、REFERENCE_PRODUCT_GAP_ANALYSIS.md。本轮不覆盖、不提交这些文件，不修改数据库、Worker、Provider 或指标定义。

已登录本地开发环境，浏览工作台、新建项目、Target、问题集及 AcmeFlow 问题详情、Monitor、Benchmark、Reports 及报告详情、Diagnosis、Recommendations、Opportunities、Experiments、Site Assets。Activity 当前 404；其 API 已存在于未提交代码。未发现独立 Settings 路由。截图保存在 `output/ui-redesign/before/`。已有 NovaFlow 项目，PawClean 尚未在当前组织看到。

## Current Problems — Top 10

1. 工作台 12 个彩色模块入口并列，缺少品牌表现与下一步。
2. 没有统一 App Shell，详情只能返回工作台或列表。
3. 各页独立选项目并默认第一个项目，从问题集跳监测会丢上下文。
4. 工作台突出 HttpOnly Cookie；优化页出现 M7A、fingerprint、brief 等工程词。
5. 问题生成器和导入表单占据首屏，核心表格在下方。
6. 查询表格缺搜索、筛选和分页；类型/来源混杂技术值（如 import）。
7. Activity 前端尚不存在，用户必须在不同任务页找运行结果。
8. 报告优先铺模型和版本字段，核心指标没有一键证据下钻。
9. 报告来源徽章存在空 span：样式函数接收文字却不渲染文字，真实/演示标签不可读。
10. 页面最大宽度、留白、状态色和载入提示不同；证据弹窗先展示大量元数据，原始回答靠后。

## Reference Lessons / evidence limits

使用仓库 `docs/REFERENCE_PRODUCT_GAP_ANALYSIS.md`，以及用户提供目录中的 06/08/09/11/12/14 审计文件、P050–P085 全部 36 份 PAGE_SPEC。

参考根目录：`C:/Users/35287/AppData/Roaming/Tencent/Marvis/User/oAN1i2defgBZcm3saenv4eAGB6C0/workspace/conv_17fb117307c244339fb61706fd6bf728/output/reference-audit`。

截图审阅：49 张（商户 13 + 主站 36），逐张编号组成 9 张联系表，另单独放大 P004、P050、P051、P070。多数主站正文泛白/骨架态，无法可靠读取的字段保持 UNKNOWN。P070、P077 清晰显示筛选—表格—分页。截图中商户侧栏实际为浅色、顶栏渐变，与旧审计“深色 AdminLTE”描述不同；以截图为准，不照抄任何一套视觉。文件前缀 SITE02 不代表一定是主站，P001–P031 是商户参考。

主站 F101–F136 为 DISCOVERED_NOT_EXECUTED；API、实际数据流、取消/重试、费用语义、完整侧栏层级仍 UNKNOWN。文档中的 SPA/组件库推断不作为实施依据。

### Reference UI Extraction

| 维度 | 判定 | 提取与 GeoLens 处理 |
| --- | --- | --- |
| A 页面壳 | ADAPT | 稳定侧栏/顶栏/内容区；使用 Next layout，拒绝 iframe、多标签堆叠 |
| B Sidebar/Header | ADAPT | 持续显示当前位置；顶栏改为项目、对象、组织/用户 |
| C 导航层级 | ADAPT | 学任务归组，压缩为 7 项；拒绝 36 页业务扩张 |
| D 工作台首屏 | ADAPT | 数据摘要与后续动作分区；拒绝 P003 发光球、广告 banner |
| E 卡片 | ADAPT | 仅指标摘要/行动建议使用卡片；拒绝全彩 KPI |
| F 表格 | ADOPT | P004、P070 行对齐、列标题、底部分页 |
| G 任务列表 | ADAPT | 复用状态与结果操作；统一现有任务类型 |
| H 筛选工具栏 | ADOPT | P070、P077 搜索和筛选紧邻表格，清晰重置 |
| I 状态 Badge | ADOPT | 文字加浅色背景；等待人工突出继续录入 |
| J 空状态 | ADAPT | P007/P077 有表结构；增加原因与下一步 CTA |
| K 表单 | ADAPT | 字段对齐、限制宽度；生成与导入按需展开 |
| L Modal/Drawer | ADAPT | 商户居中弹窗有证据，主站 UNKNOWN；GeoLens 自主设计原生 dialog 右侧抽屉 |
| M 详情页 | ADAPT | 摘要→结果→证据→技术详情；参考报告详情 UNKNOWN |
| N 步骤流 | ADAPT | 学 P025 单页完成配置/预览/保存；优化按洞察→建议→机会→实验 |
| O 费用/调用提示 | ADAPT | 保留本地实际运行确认、调用次数与 Demo 标识；不推断价格 |
| P Dashboard | ADAPT | 学摘要分层；只展示 API 真实快照，不照搬收录数字与大屏 |

## Information Architecture / Navigation

1. 工作台 `/app`：当前项目状态、最近报告、最近任务、下一步。
2. 监测 `/app/benchmark`：问题集检测；二级入口持续监测 `/app/monitor`、竞品 `/app/competitors`；人工运行从问题集发起。
3. 问题集 `/app/queries`：列表与详情工作区。
4. 任务中心 `/app/activity`：现有任务聚合、状态与结果入口。
5. 报告 `/app/reports`：历史快照、详情、对比。
6. 优化 `/app/diagnosis`：二级流程 洞察→建议→优化机会→实验→站点资产/变更计划。
7. 设置 `/app/target`：复用实际监测对象与别名设置；新建项目在项目选择器旁。

## App Shell / Project Context

浅色固定侧栏约 208px，顶部约 72px，右侧内容 max 1440px、24px 桌面内边距。1024px 收窄侧栏；窄屏折为可横向滚动导航。

共享 React context 载入 `/auth/me` 与 `/monitor-tasks/options` 可见项目；项目选择器只有一个。显式 URL project 优先，随后已选项目；不得硬编码默认品牌。切换项目回到对应模块列表，清除旧详情/筛选作用域，内容重挂载，避免显示旧项目数据。深层资源以实际 API 返回的关联项目解析归属；解析未完成显示“正在确认项目”，不猜。顶栏 Target 为当前配置，历史报告仍使用冻结快照。

## Page Hierarchy / five wireframes

```text
工作台
┌ GeoLens / 7项 ┬ 项目选择 ▾ · 监测对象       组织 / 用户 ┐
│ 工作台       │ 工作台                    [运行 AI 检测] │
│ 监测         │ 最近报告 · 时间 · Demo/真实 · 样本范围    │
│ 问题集       │ [可见度] [推荐率] [引用数] [SOV/不适用]  │
│ 任务中心     │ 最近任务表                下一步建议     │
│ 报告         │ 无报告→解释+检测入口；无项目→创建项目     │
└ 优化 / 设置 ┴─────────────────────────────────────────┘

问题集详情（复用同一壳）
项目 / 问题集 / 当前问题集
标题 · 版本 · 问题数                [人工检测] [AI检测]
[搜索问题] [类型] [品牌检查] [状态] [排序]
问题 | 类型 | 品牌检查（可解释） | 来源 | 状态
分页 / 总数
▸ 创建监测问题：谁在问→场景→意图→条件→预览→品牌检查→保存
▸ 批量导入 / 版本操作

任务中心（复用同一壳）
任务中心                                      [刷新]
[搜索] [类型] [状态]
任务 | 项目 | 问题集 | AI/方式 | 状态 | 进度 | 时间 | 结果
等待人工→继续录入；部分完成→查看缺失项；完成→查看结果
分页；数据加载失败→重试（不展示为无任务）

报告详情（复用同一壳）
项目 / 报告 / 问题集版本
报告摘要 · 来源 · 时间 · 完整性
[可见度] [推荐率] [引用] [SOV] → 证据清单 → 右侧抽屉
场景表现 / 问题×引擎结果 / 竞品（无集合显示不适用）
下一步：洞察与优化
▸ 技术详情：模型/版本/快照元信息

优化（复用同一壳）
洞察 — 建议 — 优化机会 — 实验 — 站点资产
标题 / 当前项目
已有诊断、建议或机会列表
详情：问题 / 证据 / 影响 / 建议 / 关联问题 / 实际下一步
▸ 技术详情；无依据的影响或工作量不补造
```

## Component System / Design Tokens

复用 React、Tailwind v4；仓库未安装 shadcn，不另引 UI framework。新增 AppShell、ProjectContext、PageHeader、StatusBadge、MetricCard、FilterBar、EmptyState、ErrorState、LoadingSkeleton、Pagination。表格使用语义 table；弹窗保留原生 dialog 的 Esc、焦点限制与焦点恢复。

| token | value |
| --- | --- |
| background / surface | #f5f7f9 / #ffffff |
| border / text / muted | #e2e8f0 / #172b36 / #64748b |
| primary / primary-subtle | #0f766e / #edf8f5 |
| success / warning / danger | #047857 / #92400e / #b91c1c |
| radius / shadow | 10px / 0 1px 2px rgba(15,23,42,.04) |
| spacing | 4 / 8 / 12 / 16 / 24 |
| type | title 26px; section 17px; body 14px; secondary 13px; meta 12px |
| row | 48px minimum; long questions wrap |

## Do Not Copy

不复制 Logo、icon 组合、渐变、banner、发光 AI 球、旧弹窗像素、多标签导航；不扩展写文/发稿/数字人/媒体/CMS/计费。无新 Provider、无真实调用、无外部写入。无竞品不显示 SOV 100%；始终称“首次提及位次”。

## Implementation Plan

使用 writing-plans 方法，按依赖在当前会话执行。

- [ ] 1. 新建 app/layout.tsx、components/app-shell.tsx、components/project-context.tsx、components/ui.tsx；收敛 globals.css token；迁移现有页面项目选择到共享上下文，移除各页独立返回导航。验证跨页面/刷新/深链归属。
- [ ] 2. 重做 app/page.tsx，以当前项目现有 reports API 和 activity API 读摘要；没有数据明确下一步，失败单独显示。
- [ ] 3. queries/[id] 表格置前，搜索筛选排序分页；生成器与导入折叠，不覆盖正在开发的 query API/批量操作。保留污染规则、人工/API 检测确认。
- [ ] 4. 新建 activity/page.tsx 使用现有 GET /activity 合约，分页/筛选/状态/结果入口；不调用执行 API。对后端尚未可用的响应显示加载失败。
- [ ] 5. reports/[id] 摘要与四主指标先行，修复空来源 Badge；证据列表下钻复用 EvidenceDrawer。保留冻结指标语义与版本。
- [ ] 6. 重组 monitor/evidence-dialog.tsx 为右抽屉，保留原始证据/所有分析版本/来源/检索/模型/引用；技术详情折叠，原始回答优先。
- [ ] 7. 稳定后统一优化二级流程与中文说明；Target/Wizard/Monitor/Settings 跟随壳验证。
- [ ] 8. web tsc、web build、check-ui-zh。浏览器两项目上下文、核心路由、抽屉关闭与键盘、1024/1280/1440/1920 视口、控制台；保存 After 与记录实际限制。
- [ ] 9. 仅提交本轮 web 与设计文档，按逻辑 commit；不 push。

## Proposal self-review

PASS：主导航 7；第一批页面明确；项目上下文与深链必须取真实归属；指标下钻证据；原创克制视觉；不扩展业务范围。按用户第 54 条直接继续实施，无需再次确认。
