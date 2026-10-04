---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 15ce975b5f313de8edfa891b974a2219_f1d5e49bab7a11f18039525400461939
    ReservedCode1: eAle1bXrwBZtT0K9mVzO/aIHSEQLgvx8m+DyjHRDxGHPAw8sgQPKilaAjZ4MnAmPTvtrVU3I6rOVyYBzyzJF/5UbC/CpkE4CgWkQJ/7d5raLQbP1B+s1EAoPttojyDWHVVYLg6Eq/TZl2l+62ZcmYyKh91Rewb8E0R0fR+D5YISwXJnbYYREKOIUptQ=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 15ce975b5f313de8edfa891b974a2219_f1d5e49bab7a11f18039525400461939
    ReservedCode2: eAle1bXrwBZtT0K9mVzO/aIHSEQLgvx8m+DyjHRDxGHPAw8sgQPKilaAjZ4MnAmPTvtrVU3I6rOVyYBzyzJF/5UbC/CpkE4CgWkQJ/7d5raLQbP1B+s1EAoPttojyDWHVVYLg6Eq/TZl2l+62ZcmYyKh91Rewb8E0R0fR+D5YISwXJnbYYREKOIUptQ=
---

# GeoLens × Reference Product — FUNCTION GAP & PRODUCT ALIGNMENT AUDIT

> 审计性质：**AUDIT ONLY**。不修改代码、不 commit、不 push、不调用真实 Provider、不访问付费功能、不执行外部发布。
> 本文件为分析结论交付物；其中出现的"最小产品模型 / 数据模型建议"均为提议，**不进入实现、不创建 schema、不迁移数据库**。

| 字段 | 值 |
|------|----|
| GeoLens HEAD | `fe022ca` |
| GeoLens 工作区 | `git status --short` 为空（干净） |
| Reference SITE01 | geo.b7u.cn —— **VERIFIED**（商户后台实测，OBSERVED/B/C 证据） |
| Reference SITE02 | djidfbgr.sddianfeng.cn —— **BLOCKED**（当日不可达；BLOCKED ≠ NO） |
| Reference Docs | 飞书 SOP —— **UNKNOWN**（需登录，不猜测） |
| 审计日期 | 2026-09-08 |

---

## 0. 产品定位锚点（一切建议的裁决依据）

GeoLens 定位：**Evidence-first GEO Intelligence & Optimization SaaS**。

- 是：以可追溯证据为核心资产、以"监测 → 诊断 → 建议 → 实验 → 复测"为闭环的 GEO（Generative Engine Optimization）智能体。
- **不是** SEO 工具箱 / 媒体发稿平台 / AI 内容农场 / B2B 营销发布系统。

参考站（geo.b7u.cn，FastAdmin/ThinkPHP/iframe 技术栈）是"内容生产 + 多渠道发布 + 内容农场变现"型产品；GeoLens（Next.js / NestJS / Prisma / BullMQ）是"证据监测 + 优化循环"型产品。两者定位不同，**本报告不以功能数量 parity 为准，而以定位服从为准**。

---

## 1. Reference 证据基线（摘要）

- 路由：SITE01 共 32+ 页（P001–P032），侧栏 47 项入口，全部导航可达（VERIFIED）。
- 功能：33+ 项（03_FUNCTION_INVENTORY），实名/配额/点数/余额/有效期/共享报表/批量操作/OK。
- 用户流程：9 条（F01–F09）。F01 注册登录、F02 关键词→写作→查收录、F08 查收录拓词工具流、F09 账号配额为 VERIFIED；F03–F07 均为付费/破坏性阻断（[STOP-PAID]），报告实质内容与发布执行结果 **UNKNOWN**。
- 任务：异步任务分 AI 诊断（分析中/成功/失败）、AI 写作、B2B/媒体/自媒体排期发布、查收录（可取消）等多类，**入口分散，无统一任务中心**（U007 主站统一入口仍 UNKNOWN）。
- 计费：AI 诊断 6/12 元每次、关键词指数 10 点、AI 蒸馏 10 点、查收录按量、B2B ¥2/¥6/¥83 每篇、媒体/大V 按卡片定价；预扣即时，B2B 有"总预算 10 元达预算自动完成"；权益页一次展示配额全景（P031）。
- UI：AdminLTE 深色侧栏 + Bootstrap 蓝按钮 + bootstrap-table + layer iframe 弹窗 + addtabs；原创性为零，属于可借鉴交互范式但**不可复制视觉**的部分。

---

## 2. Capability Matrix(33 项)

Reference Status 取值：VERIFIED / PARTIAL / UNKNOWN / BLOCKED（SITE02 全部 BLOCKED，本矩阵以 SITE01 证据为准，不虚构 SITE02）。
GeoLens Status 取值：FULL / PARTIAL / NONE（基于 `fe022ca` 当前生产代码与 UI 只读审计，非旧文档）。
Priority：P0（下一迭代即做）/ P1（近期）/ P2（规划中）/ P3（远期或论证）。

| ID | Capability | Ref Evidence | Ref Status | GeoLens | GeoLens Existing Primitive | Gap | User Value | Recommendation | Priority |
|----|-----------|--------------|------------|---------|----------------------------|-----|------------|----------------|----------|
| C01 | Dashboard / Executive Dashboard | P003 快速导航卡+有效期；P024 数据中心报表 | VERIFIED | PARTIAL | 工作台=组织→项目网格+能力入口；monitor 最新结果卡 | 无跨项目指标聚合、无可下钻执行摘要 | 打开即见全局 GEO 健康度，服务汇报决策 | 建 Executive Dashboard，所有数字可下钻 Reports/Evidence（见 §7） | P1 |
| C02 | Project / Brand Management | P004 关键词内含品牌；单账号模糊多品牌 | PARTIAL | FULL | Project / Brand 实体 + 多品牌多项目隔离 | 无（反向领先，多租户更清晰） | 多项目/多品牌视角 | 维持；补品牌资产汇总视图 | — |
| C03 | Target Profile & Aliases | P004 hit_word 品牌字段 | PARTIAL | FULL | TargetEntity + TargetEntityAlias + `/api/targets/:id/profile` | 无（反向领先） | 同一实体的别名/产品/层级统一口径 | 维持 | — |
| C04 | Query / Suite 管理 | P004 关键词主词 1:N 问题（4914 条） | VERIFIED | FULL | QuerySet（v0.1）/ BenchmarkSuite（v0.2）/ Query / version 快照 | legacy QuerySet 与 Suite 双轨需收敛 | 问题集版本一致、可复用 | 收敛到 Suite 语义，QuerySet 作为别名兼容 | P2 |
| C05 | Query 交互（搜索/筛选/排序/跨页/去重） | P004 工具条：主词搜索+筛选+排序+服务端分页+跨页 | VERIFIED | NONE | queries/[id] 静态只读表格（类型/类别/污染/来源/启停） | 无搜索/筛选/排序/分页/跨页/去重 | 大问题集可检索、可定位 | 表格加服务端搜筛排+分页；批量见 C06 | P0 |
| C06 | Batch Query Operations | P004 批量添加/删除/跨页全选 | VERIFIED | NONE | 无批量行操作 UI（仅文本粘贴批量导入预览/保存） | 缺批量启用/停用/删除/类型修改/移动 Suite | 批量维护成本显著下降 | 跨页选择 + 批量操作条（启用/停用/删除/移动） | P0 |
| C07 | Query 导入导出 | F005 批量导入（一键导入选中关键词问题） | VERIFIED | PARTIAL | 文本粘贴批量导入（预览+保存） | 无导出、无 CSV/模板 | 迁移与备份 | 补 JSON/CSV 导出与模板 | P2 |
| C08 | Query Expansion（拓词） | P025 ABCDEF 六区 13 组合；P027 关键词指数(10点)；P028 AI 蒸馏(10点) | VERIFIED | NONE | Query Builder 确定性模板（非拓词） | 无证据驱动拓词/指数/蒸馏 | 从既有证据挖掘新监测维度，扩大覆盖 | 建"Evidence 驱动"拓词模型，见 §5（不复制 13 组合模板名） | P1 |
| C09 | Query Builder V2（结构化组合生成） | P025 主词→问题批量生成→评估查询→保存词组一体化 | VERIFIED | PARTIAL | Query Builder（category/scenario/intents/audience/modifiers；重名校验+提示） | 批量量小、无生成预览总量、不可直接送测量 | 一次构建一个完整可执行问题集 | Builder 支持批量生成预览 + 一键入 Suite/触发测量 | P1 |
| C10 | AI Diagnosis | P005 Pro 12元 / P006 标准 6元；P007 报告列表状态；付费未执行，报告结构 UNKNOWN | PARTIAL | PARTIAL | DiagnosisRun + Finding（GEO/visibility/presence）+ 规则引擎 + rules 版本 | 无"品牌+行业词"的综合诊断简报 | 一键获得品牌级可见度结论 | 以 Evidence 驱动做品牌级 GEO 诊断简报（非按次收费文本报告） | P1 |
| C11 | Multi-model Selection | P005 诊断可选 8 平台模型 | VERIFIED | FULL | ProviderRegistry（Mock/DeepSeek/Qwen）+ monitor 引擎多选/权重/随机化 | 无（领先） | 引擎可替换、对比可信 | 维持 | — |
| C12 | Task Center（统一活动中心） | 任务分散于 analyze/ai_task/b2b/webmedia/zimedia/user_site_task/shoulu_record；U007 主站统一入口 UNKNOWN | PARTIAL | NONE | monitor/benchmarks/experiments/manual-runs 各独立列表页 | 无跨任务类型统一视图 | 异步任务不再迷失，状态一目了然 | 建最小统一任务中心（见 §4.1） | P0 |
| C13 | Task Lifecycle | 06：诊断 排队→成功/失败；查收录可取消；无统一状态机 | VERIFIED | FULL | BullMQ 状态：PENDING/QUEUED/RUNNING/SUCCEEDED/PARTIAL/FAILED/CANCELLED/AWAITING_MANUAL_INPUT/SKIPPED | 无（更完整，含人工回路态） | 生命周期完备 | 维持 | — |
| C14 | Task / Run Presentation | 列表状态 tag+筛选下拉（F040） | VERIFIED | PARTIAL | monitor 轮询进度；benchmark/manual/experiment 独立报告页 | 无统一"状态徽章+状态筛选+重跑/取消"聚合 | 一眼定位失败/进行中/待人工 | 统一状态徽章组件+状态筛选+行内重跑/取消 | P1 |
| C15 | Reports | P007 报告列表（空态）；报告详情 UNKNOWN | PARTIAL | FULL | BenchmarkReport 不可变版本化 + reports/compare | 无 | 报告可信、可对比 | 维持 | — |
| C16 | Historical Runs / 版本化 | P026 查询记录/取消 | VERIFIED | FULL | Run 不可变历史 + reportVersion 快照 + 版本对比 | 无（领先） | 历史可回溯 | 维持 | — |
| C17 | Evidence | 诊断为静态文本，无逐条证据追溯 | UNKNOWN | FULL | Evidence 全字段持久化（response/snapshot）+ 来源可溯 + 引用计数 | 无（核心强项） | 结论可验证 | 维持，作为一切下钻的锚点 | — |
| C18 | Competitor Analysis | P005 诊断表单含竞品字段输入 | PARTIAL | FULL | CompetitorCandidate/Set（实测证据提取）+ 人工审核 + 竞品语义 | 无（领先：证据驱动 vs 手输竞品） | 竞对结论有据可查 | 维持 | — |
| C19 | AI Writing（正文生成） | P011 AI 写作任务(1780 配额)；P014 文章；P015 全网爆文复刻 | PARTIAL | NONE | 无（仅 Opportunity brief/note 文本） | 无正文生成 | — | **DO_NOT_COPY 参考实现**：通用 AI 写作/爆文复刻偏离定位；未来以 optimization-content（证据引用）形式出现，见 C22 | P3(论证) |
| C20 | Knowledge Base / 素材库 | P009 图库 / P010 企业知识库 / P012 写作指令 / P013 文章分类 | VERIFIED | NONE | Target Profile + SiteAsset（非知识库） | 无企业素材体系 | — | **DO_NOT_COPY**：内容农场素材库与 Evidence-first 冲突；如有需，以"Source/SiteAsset 纳入证据语义"替代 | P3 |
| C21 | Site Management | P021 站点绑定(四框架插件+API key+验证)；付费/脚本未执行 | PARTIAL | PARTIAL | Site / SiteAsset（测量产物）+ ChangePlan（M8 真实优化动作） | 无 CMS 插件式集成；站点资产偏测量侧 | 优化动作落地载体 | 维持自有站点/变更计划路径，不引入框架插件绑定；ChangePlan 支持结构化导出 | P2 |
| C22 | Content Optimization（Brief/Draft/Revision） | 参考站无证据优化概念（UNKNOWN） | UNKNOWN | PARTIAL | ContentOpportunity（优化 brief）+ OptimizationExperiment / Retest | 无 Content Draft / Revision 可执行内容闭环 | 从证据直接到可执行优化内容 | 建"机会→草稿→实验→复测"闭环（草稿标注引用证据与缺证处），见 §6 | P1 |
| C23 | Publishing | P017 B2B / P019 媒体 / P020 大V / P046-48 个人自媒体（草稿箱/设备授权）；付费未执行 | PARTIAL | NONE | 无 | 无发布 | — | **DO_NOT_COPY**：非媒体发稿/B2B 发布平台，且外部发布违背 AUDIT 与自研边界 | P3 |
| C24 | GEO Index / Inclusion Check | P025 查收录入口（余额0禁用）；P024 8 平台收录统计 | PARTIAL | PARTIAL | 可见度监测（多引擎检测 target 是否被 AI 提及/引用）+ ManualVerification | 无结构化"收录检查+问题汇总+拓词联动"一体视图 | 明确"哪些问题已被 AI 引用、哪些未覆盖" | 将"多引擎提及/引用检测"沉淀为收录检查视图（Evidence 驱动，非盲查黑盒） | P1 |
| C25 | Data Center / 共享报表 | P024 tongji 数据报表+共享链接 | VERIFIED | NONE | reports/compare（无跨项目/组织聚合、无对外传播） | 无执行摘要层、无只读共享 | 管理层/客户可看整体 | 数据大屏不复制（噱头）；执行摘要并入 C01；只读共享见 C31 | P2 |
| C26 | Quota / Usage / Cost | P031 权益配额全景（主词 18/99999、点数、余额、有效期、8 平台收录）；P032 点数/余额流水 | VERIFIED | PARTIAL | runType demo/real + 运行确认弹窗（queryIds×engineIds 次数提示） | 无配额/用量/成本账本/月度额度 | 真实 Provider 成本可预期、不失控 | 建 Usage/Cost Center（配额、Run 预估、月度额度、用量账本），见 §4.4 | P0 |
| C27 | Billing / 支付 | P031/P032 充值/购买入口存在但未触发；点数充值 | PARTIAL | NONE | 无 | 无计费 | — | **DO_NOT_COPY 参考实现**（点数/余额内容农场变现）；商业化计费策略（订阅 or 计量）置于真实 Provider 落地后再定 | P3 |
| C28 | Account / Org / 认证 | F001 登录；P030 实名（个人/企业） | VERIFIED | FULL | Organizations / 多租户 / 邀请 / RBAC | 无（领先，认证/授权完整） | 规模化安全 | 维持 | — |
| C29 | Provider Configuration | 诊断 8 平台多选（无运维级配置） | VERIFIED | FULL | provider 配置（engine label/model/provider/token）+ registry 注册 | 无（领先） | 引擎运维可控 | 维持 | — |
| C30 | Run Estimate / Cost Preflight | 表单明示计价（6/12元、10点），无预估器 | PARTIAL | PARTIAL | 运行确认弹窗显示 queryIds×engineIds 次数 | 无成本换算/余额/额度提示；无"此运行将真实调用 N 次"预检 | 执行前成本知情 | 将次数提示升级为成本预估（用量×单价边界）+ 额度检查 | P1 |
| C31 | Shared Reports | P024 分享链接（公开访问行为 U009 UNKNOWN） | PARTIAL | NONE | 无 | 无只读分享 | 向团队/客户传播可信结论 | 短期过期只读分享链（无写权限），放 Later | P2 |
| C32 | Multi-platform Visibility Monitoring | 参考站为诊断时一次性查询多平台（非持续监测） | PARTIAL | FULL | monitor 多引擎可见度监测 + 定时任务 + 随机化 | 无（领先） | 持续观测而非抽样 | 维持 | — |
| C33 | Manual Web UI Measurement | 参考站无人工测量回路 | UNKNOWN | FULL | AWAITING_MANUAL_INPUT + manual measurement UI（M8） | 无（领先） | 对不可自动测量的渠道保留人工回路 | 维持 | — |

**统计**：Capabilities Compared = **33**；GeoLens FULL = **13**；PARTIAL = **10**；NONE = **10**。

---

## 3. 分类汇总

| 分类 | 数量 | 条目 |
|------|------|------|
| MUST_ADOPT | 17 | C05 C06 C12 C26（新增采纳 4 项）＋ C02 C03 C04 C11 C13 C15 C16 C17 C18 C28 C29 C32 C33（KEEP 已具备 13 项） |
| ADAPT_TO_GEOLENS | 9 | C01 C08 C09 C10 C14 C21 C22 C24 C30 |
| LATER | 3 | C07 C25 C31 |
| DO_NOT_COPY | 4 | C19 C20 C23 C27 |

说明：13 项 FULL 能力与参考对等或反向领先，标 MUST_ADOPT(KEEP) 表示"维持并持续强化"，不混入新增采纳；真正需要**新增实现**的高优先级采纳为 4 项：查询表格交互、批量操作、统一任务中心、Usage/Cost Center。

---

## 4. 特别评估

### 4.1 Task Center —— 建议做统一"活动中心"，最小产品模型

**结论**：参考站任务入口极其分散（诊断/写作/发布/查收录/SEO 各占一页），审核中明确是常见槽点；GeoLens 已有完整 Run 状态机与 BullMQ，却同样分散在 monitor / benchmarks / experiments / manual-runs 多个页面——**这是当前最大的一致性缺口，应建统一任务中心**。

最小产品模型（不进入实现，仅提议）：
- **聚合对象**：MonitorTask / BenchmarkRun / ManualRun / Experiment 及其 Evaluation、Retest（复用现有实体索引，不新增核心表）。
- **单一日志视图**：统一 Run 卡片流，列 = 类型徽章（benchmark/manual/experiment/monitor）+ 项目 + 问题集 + 引擎 + 状态徽章 + 进度/耗时 + 报告/Evidence 入口 + 创建时间。
- **过滤与操作**：按状态/类型/项目筛选、关键词搜索；行内重跑/取消（复用现有取消语义）；失败/部分成功置顶。
- **状态机**：直接复用现有枚举（PENDING/QUEUED/RUNNING/SUCCEEDED/PARTIAL/FAILED/CANCELLED/AWAITING_MANUAL_INPUT/SKIPPED），不定义新状态。
- **与 Evidence 的关系**：每个 Run 可展开/下钻到 Evidence 面板（复用现有组件），保持"一切指标可下钻证据"。
- **明确不做**：不做 BullMQ job 内部细节透出、不做 WS/SSE（轮询即可）、不做参考站"任务中心+历史任务"分离形态。

### 4.2 Query Operations —— 补搜筛排 + 批量，而非复制细节

参考站关键词页工具条 = 搜索 + 筛选 + 排序 + 服务端分页 + 跨页全选 + 批量添加/删除，是值得借鉴的**交互范式**（不是功能密度）。GeoLens 当前 queries 页为静态只读表格，问题集大了以后无法检索。
建议（对齐 MUST_ADOPT）：
1. 服务端分页 + 关键词搜索 + 状态/类型/污染筛选 + 排序。
2. 跨页选择 + 批量操作条（批量启用/停用/删除/移动 Suite）。
3. 导入已有（文本粘贴预览/保存）→ 补导出与模板（LATER）。
不复制：参考站树形列表/"蒸馏"每词 10 点等运营机制。

### 4.3 Query Expansion —— 提出 GeoLens 模型（Query Builder V2 候选）

参考站 ABCDEF 六区 + 13 组合是模板批发式拓词，其**名字与组合不做**；值得借鉴的是"从既有问题集延伸出更多监测维度"的引擎。
**GeoLens Query Expansion Model（提议）**：
- 维度轴：`Target Context`（实体/别名/产品类别） × `Audience` × `Scenario` × `Intent` × `Decision Stage` × `Constraint` × `Category`。
- 方式：**Evidence 驱动拓词**——扫描既有 Evidence 中未被当前 Query 覆盖的提及/实体/问题模式，生成候选维度并给出"建议原因（来自证据）"+ 预览 + 批量加入 Suite；而不是无证据的模板批发。
- 判定：值得作为 **Query Builder V2** 的核心方向（结合 C09），但放 R3，避免与 R2（任务中心/表格交互）抢资源。
- 与 污染守卫 的关系：拓词候选同样经过 contamination guard 校验（Target 品牌词污染警示）。

### 4.4 Cost / Quota —— 真实 Provider 落地前必做 Usage/Cost Center

参考站已验证：Quota 配额全景（P031）、点数/余额双账本（P032）、每操作明示计价、预算自动停止（B2B"达预算自动完成"）。GeoLens 将来真实 Provider 会产生真实调用成本（每次置信度测量 = N query × M engine calls），当前仅有 queryIds×engineIds 次数提示。
建议（MUST_ADOPT）：
- **Run Estimate**：运行前显示"预计引擎调用次数 + 成本上/下界 + 是否超出月度额度"（复用现有确认弹窗升级）。
- **Monthly Quota & 软/硬限制**：demo 运行不耗额度；real 运行计入额度，超限阻断并提示。
- **Usage Ledger**：每 Run 记录调用量与估算成本（不可变，随 Run 历史），支持按项目/引擎/月份聚合。
- **Cost Preflight**：真实 Provider 未配置时保持现有"禁用/不调用"路径（PROVIDER_DISABLED 显式处理），绝不静默调用。
这不复制参考站的"点数/余额/充值"变现模型（见 Do Not Copy）。

### 4.5 Content Workflow —— 增加 Optimization Brief → Content Draft → Content Revision，而非通用 AI Writer

参考站链路：Keyword → Question → AI Writing → Publishing（内容农场）。
GeoLens 链路：Evidence → Diagnosis → Recommendation → Opportunity。
**建议增加（ADAPT_TO_GEOLENS）**：
- **Optimization Brief**：已由 ContentOpportunity 覆盖（含证据引用与机会区分）。
- **Content Draft**：基于 Brief 生成**证据引用的正文草稿**——每个主张标注支撑 Evidence 与缺证处；定位是"把证据翻译成可落地内容"，不是自由写作。
- **Content Revision**：基于 Retest/复测结果对草稿做修订建议。
明确不增加：通用 AI Writer、图库/指令/知识库等素材生产配套（DO_NOT_COPY）。

### 4.6 Publishing —— 均不建议（除轻量导出）

| 发布类型 | 判定 | 原因 |
|---------|------|------|
| Website CMS integration | 不推荐（如需，只做"导出 HTML 片段/结构化变更"，非自动发布） | 侵入式、维护成本高、外部副作用 |
| B2B Publishing | DO_NOT_COPY | 词竞品类内容分销，偏离定位且含大量运营 |
| Media Publishing | DO_NOT_COPY | 资源市场运营成本高、付费墙未验证 |
| Influencer Publishing | DO_NOT_COPY | 达人资源运营，偏离定位 |
| Social Publishing | DO_NOT_COPY | 外部授权/设备绑定，安全与合规风险高 |

### 4.7 Data Center / Executive Dashboard

参考站数据中心=P024 报表 + 分享链接 + 数据大屏；其"共享报表"思想有价值，但大屏与夸饰不复制。
**GeoLens Executive Dashboard 最少应显示**（ADAPT_TO_GEOLENS，并保持全数可下钻 Evidence）：
1. 各项目最新可见度得分与趋势（Sparkline → 点击进 Report）。
2. 近 30 天任务健康度：成功/部分成功/失败/待人工数量（→ Task Center）。
3. 累计 Evidence 规模与引用计数（MAX/RM 来源分布）。
4. 未处理 Top 机会与建议数（→ Recommendations / Opportunities）。
5. 用量与估算成本概览（真实 Provider 上线后；→ Usage Ledger）。
每个数字都是入口，最终落到 Run → Evidence。

### 4.8 UI 借鉴（只借鉴交互范式，不复制视觉/技术）

| 维度 | 参考站范式 | GeoLens 处理 |
|------|-----------|--------------|
| 信息架构 | 47 项左菜单（过度，反例） | 结构化分组导航（监测/分析/优化/设置），工作台按钮一维导航随模块增长需收敛 |
| 表格密度 | bootstrap-table 服务端分页/筛选/跨页 | 采纳该交互范式（搜筛排/分页/跨页全选）——C05/C06 |
| 状态设计 | 状态文字徽章+筛选下拉 | 采纳统一状态徽章+状态筛选聚合视图（C14）；复用现有枚举 |
| 批量操作 | 工具条 添加/删除/跨页 | 采纳批量操作条（启用/停用/删除/移动）——C06 |
| 任务型工作流 | 发布任务统一表单骨架（命名→素材→时间窗→数量→预算→去重） | 借鉴"统一运行表单骨架"提升自定义运行一致性 |
| 成本提示 | 每操作明示计价 | 借鉴"决策前成本提示"，升级为 Run Estimate/额度检查（C30/C26） |
| ❌ 不复制 | AdminLTE/Bootstrap 视觉、iframe addtabs、layer 弹窗、FastAdmin 树表、深蓝侧栏、Logo/颜色/布局 | 保持原创克制 UI（slate/teal/violet 系） |

---

## 5. Reference Strengths Top 10（参考做得比 GeoLens 好的，为什么值得学）

1. **一体化关键词工具（查收录+拓词 ABCDEF 13 组合+评估查询+省钱开关，P025）**：面向一个任务把所有步骤做成一个页面闭环。值得学：避免 GeoLens"builder 生成问题集但无法直接送测量/无法评估规模"的断层。
2. **表格批量操作与跨页选择（P004）**：高频工作流的效率交互打磨成熟。值得学：GeoLens 当前是静态只读表格。
3. **权益配额全景页（P031）**：一次看全额度/点数/余额/有效期/平台收录。值得学：成本与额度透明化，用户可预期。
4. **数据中心共享报表 + 分享链接（P024）**：把数据变成可对外传播的资产。值得学（放 Later）：可信数据的传播价值。
5. **每操作明示计价**（诊断/指数/蒸馏/发布表单都标价）：决策前成本知情。值得学：升级 GeoLens 的 Run 成本预估。
6. **任务表单统一骨架**（任务名→素材→时间窗→数量→预算→去重，09 章）：表单模板化保证一致性。值得学：统一 GeoLens 自定义运行表单。
7. **素材分层组织**（写作标题/图库/知识库/指令/分类的配置化，P008–P013）：把"生产资料"组织成可复用结构。值得学的是"组织方式"，本体（内容农场素材）不学。
8. **状态标签 + 筛选下拉的统一列表范式**（P007 等）：状态可读性。值得学：GeoLen 已有完整枚举，补统一展示与筛选。
9. **自媒体发布闭环状态流**（订单/设备授权/草稿箱/文章列表，F046-48）：端到端状态一致性。值得学的是"发布管道状态机"的工程思想，不是发布功能。
10. **集市多维筛选面板**（媒体/达人筛选+价格排序+收藏，P018/P020）：高维筛选 UX。值得学：GeoLens 竞品/问题集管理可借鉴筛选侧栏范式，不抄卡片集市。

---

## 6. GeoLens Strengths（源码支持，不为抬高而虚构）

1. **Evidence-first 不可变证据**：Evidence 全字段持久化（response/snapshot、来源、页码、引用模式），一切结论可逐条回溯——参考站无对等物。
2. **Run/Report 不可变快照与版本化历史**：历史不可篡改 + reportVersion 对比——参考站只有可变文本记录。
3. **Query contamination guard**：污染检测与"改测品牌认知"建议——参考站无此概念。
4. **真实竞品发现**：CompetitorCandidate/Set 从实测证据提取 + 人工审核语义，而非手动手输竞品（P005 的做法）。
5. **受控实验与复测**：OptimizationExperiment / Retest / Evaluation / PilotReview——参考站没有实验层。
6. **Manual Web UI Measurement**：AWAITING_MANUAL_INPUT 人工回路（M8）——参考站无人工验证态。
7. **Analysis provenance**：diagnosis/recommendation 带规则版本，结论可追溯——参考站为一次性文本报告。
8. **多租户组织与 RBAC**：Org/邀请/角色——参考站为单账号 + 实名，无团队隔离。
9. **多 Provider/多引擎抽象**：Mock/DeepSeek/Qwen 注册 + 引擎随机化/权重 + demo/real 运行类型隔离，真实调用可显式拦截（PROVIDER_DISABLED/NOT_CONFIGURED 显式处理）——参考站仅表单多选。
10. **多引擎持续可见度监测 + 真实变更管理**：monitor 定时监测 + SiteAsset/ChangePlan 承载真实优化动作（M8）——参考站为一次性诊断与侵入式 SEO 插件。

---

## 7. Gap Matrix（决策汇总）

| ID | Capability | Reference | GeoLens | Gap | Classification | Priority | Reason |
|----|-----------|-----------|---------|-----|----------------|----------|--------|
| C01 | Dashboard/Executive Dashboard | Dashboard+报表 | 项目网格工作台 | 无全局摘要/下钻 | ADAPT_TO_GEOLENS | P1 | 决策价值高；需按证据下钻原则重做 |
| C02 | Project/Brand Management | 隐含单账号+品牌字段 | 多租户 Project/Brand | 无 | MUST_ADOPT (KEEP) | — | 已领先 |
| C03 | Target Profile & Aliases | 品牌字段 | Target+Aliases+profile | 无 | MUST_ADOPT (KEEP) | — | 已领先 |
| C04 | Query/Suite 管理 | 主词1:N问题库 | QuerySet+Suite | suite/querySet 双轨收敛 | MUST_ADOPT (KEEP) | P2 | 核心资产，收敛即事半功倍 |
| C05 | Query 交互搜筛排/跨页 | 成熟工具条 | 静态表格 | 无检索/筛选 | MUST_ADOPT | P0 | 监测工作流高频瓶颈 |
| C06 | Batch Query Ops | 跨页批量增删 | 无批量行操作 | 批量启停/删/移动缺失 | MUST_ADOPT | P0 | 批量维护效率，直接节省工时 |
| C07 | Query 导入导出 | 批量导入 | 文本导入 | 无导出/模板 | LATER | P2 | 低频，迁移场景 |
| C08 | Query Expansion | ABCDEF13组合+指数+蒸馏 | 无拓词 | 无证据驱动拓词 | ADAPT_TO_GEOLENS | P1 | 思想值得借，需按证据逻辑重做 |
| C09 | Query Builder V2 | 一体生成/评估/保存 | 确定性模板 | 批量小/不可直连测量 | ADAPT_TO_GEOLENS | P1 | 与 C08 合并成 V2 方向 |
| C10 | AI Diagnosis | 按次付费品牌诊断 | 规则诊断+Finding | 无综合简报 | ADAPT_TO_GEOLENS | P1 | 用证据驱动简报取代按次文本 |
| C11 | Multi-model Selection | 8平台多选 | 多引擎注册/随机 | 无 | MUST_ADOPT (KEEP) | — | 已领先 |
| C12 | Task Center | 分散任务列表 | 各自独立列表页 | 无统一视图 | MUST_ADOPT | P0 | 一致性缺口最大，复用现有状态机成本低 |
| C13 | Task Lifecycle | 零散状态 | 完整 BullMQ 状态机 | 无 | MUST_ADOPT (KEEP) | — | 已领先 |
| C14 | Task/Run Presentation | 状态tag+筛选 | 分散报告页 | 无统一徽章/筛选聚合 | ADAPT_TO_GEOLENS | P1 | 与 C12 一起做 |
| C15 | Reports | 列表+空态 | 不可变版本报告 | 无 | MUST_ADOPT (KEEP) | — | 已领先 |
| C16 | Historical Runs | 查询记录 | 不可变历史+版本对比 | 无 | MUST_ADOPT (KEEP) | — | 已领先 |
| C17 | Evidence | 无证据概念 | 不可变证据全字段 | 无 | MUST_ADOPT (KEEP) | — | 核心差异化 |
| C18 | Competitor Analysis | 手输竞品字段 | 证据驱动竞品 | 无 | MUST_ADOPT (KEEP) | — | 已领先 |
| C19 | AI Writing | AI写作+爆文复刻 | 无 | 无正文生成 | DO_NOT_COPY | P3 | 偏离定位（非内容农场）；未来入 C22 优化内容 |
| C20 | Knowledge Base/素材库 | 图库/知识库/指令 | 无素材体系 | 无企业素材库 | DO_NOT_COPY | P3 | 内容农场生产资料，冲突；Source 语义另行论证 |
| C21 | Site Management | 插件绑定站点 | 站点资产+ChangePlan | 无 CMS 插件集成 | ADAPT_TO_GEOLENS | P2 | 维持自有路径；导出而非插件 |
| C22 | Content Optimization | 无证据优化概念 | Opportunity+实验 | 无 Draft/Revision 闭环 | ADAPT_TO_GEOLENS | P1 | 定位差异化闭环关键 |
| C23 | Publishing | 全渠道发布 | 无 | 无发布 | DO_NOT_COPY | P3 | 非发稿/B2B 平台；外部副作用 |
| C24 | GEO Index/Inclusion | 查收录一体工具 | 可见度监测 | 无收录检查视图 | ADAPT_TO_GEOLENS | P1 | 把监测沉淀为收录/提及视图 |
| C25 | Data Center/共享报表 | 数据中心+分享 | 无跨项目数据层 | 无执行摘要/传播 | LATER | P2 | 执行摘要已并 C01；分享见 C31 |
| C26 | Quota/Usage/Cost | 配额全景+双账本 | 仅次数提示 | 无配额/账本/额度 | MUST_ADOPT | P0 | 真实 Provider 成本前置控制 |
| C27 | Billing/支付 | 点数/余额/充值 | 无 | 无计费 | DO_NOT_COPY | P3 | 参考变现模型不适用于证据引擎；商业化另行设计 |
| C28 | Account/Org/认证 | 单账号+实名 | 多租户 RBAC | 无 | MUST_ADOPT (KEEP) | — | 已领先 |
| C29 | Provider Config | 表单多选 | registry+配置 | 无 | MUST_ADOPT (KEEP) | — | 已领先 |
| C30 | Run Estimate/Preflight | 明示计价 | 次数提示 | 无成本预估/额度 | ADAPT_TO_GEOLENS | P1 | 与 C26 一起做 |
| C31 | Shared Reports | 分享链接 | 无 | 无只读分享 | LATER | P2 | 可信数据传播，短期只读 |
| C32 | Multi-platform Monitoring | 一次性多平台 | 持续定时监测 | 无 | MUST_ADOPT (KEEP) | — | 已领先 |
| C33 | Manual Web UI Measurement | 无人工回路 | 人工测量 UI | 无 | MUST_ADOPT (KEEP) | — | 已领先 |

**分类计数**：MUST_ADOPT = 17（其中 KEEP 13）；ADAPT_TO_GEOLENS = 9；LATER = 3；DO_NOT_COPY = 4。

---

## 8. Top 5 Product Gaps（按 用户价值 × 商业价值 × 实现收益）

1. **统一任务中心 / Activity Center（C12）** — 用户价值：异步任务全部可见、可筛选、可操作；商业价值：产品一致性与专业度直接体现；实现收益：复用现有 Run 状态机与页面组件，成本低。→ R2 首个落地。
2. **Query 表格交互 + 批量操作（C05/C06）** — 用户价值：问题集大之后运维不再痛苦；商业价值：监测是核心工作流，效率即留存；实现收益：表格层迭代，无新后端模型。→ R2。
3. **Usage/Cost Center（C26/C30）** — 用户价值：真实 Provider 调用成本透明、可防失控；商业价值：商业化（按量/订阅）的计费前提；实现收益：消费 Run 现有字段做聚合与预估，中等。→ R3（至少 Run 预估先到 R2 后段）。
4. **Executive Dashboard（C01）** — 用户价值：管理层/客户打开即见全局与下钻证据；商业价值：售前与续费决策场景；实现收益：基于现有 Report/Run 聚合，中等。→ R2/R3 过渡。
5. **Content Optimization 闭环 Draft/Revision（C22）** — 用户价值：从"看到结论"到"拿到可执行优化内容"；商业价值：差异化定位（合约证据的优化内容）落地点；实现收益：基于现有 Opportunity/Retest 扩展。→ Later 试点。

---

## 9. Do Not Copy 清单及原因

1. **AI 内容写作任务 / 全网爆文复刻（C19 参考实现）** — 通用 AI Writer 与爆文复刻会让 GeoLens 滑向内容农场；以"证据→优化内容（C22）"替代。
2. **多渠道发布全家桶（B2B 集市/网站媒体/自媒体大V/个人自媒体/微信设备授权/草稿箱，C23）** — 必须是媒体发稿/B2B 平台才成立；运营与合规成本高，且外部发布与 AUDIT 边界冲突；GeoLens 至多提供"导出优化片段"。
3. **点数/余额/充值变现模型（C27 参考实现）** — 内容农场计费形态（每操作扣点、实名强制、余额充值）；GeoLens 商业化应走订阅 + 计量，且必须在真实 Provider 落地后设计。
4. **内容农场素材库（图库/知识库/写作指令/文章分类树形，C20）** — 服务于批量生成正文，与 Evidence-first 冲突；若未来需要"源材料"，应以 Source/SiteAsset 并入证据语义。
5. **SEO 插件式站点绑定（四框架插件下载 + 后台账号/API key 验证，C21 参考路线）** — 侵入式 CMS 集成，维护面与安全面大、无法扩展生态；GeoLens 走自有站点 + 结构化导出/API。
6. **参考站技术视觉与框架（AdminLTE/Bootstrap 蓝、iframe addtabs、layer 弹窗、FastAdmin 树表单、数据大屏跳转）** — 与 GeoLens 原创克制 UI 冲突；只借鉴交互范式（表格/筛选/状态徽章），不借任何像素与布局。

---

## 10. 建议 Roadmap（R2 / R3 / Later）

**R2 — 用户体验 / Task / Query Operations（地基，不做新后端模型）**
- C12 统一任务中心（最小模型：聚合视图 + 状态筛选 + 行内重跑/取消）。
- C05 表格服务端搜筛排 + 分页；C06 批量启停/删/移动。
- C14 统一状态徽章与状态筛选组件。
- C30 运行前成本预估升级（次数 → 成本上下界 + 额度占位）。

**R3 — Usage / Cost / Query Expansion / Dashboard**
- C26 Usage/Cost Center：配额、月度额度、用量账本、成本聚合。
- C08/C09 Query Expansion Model（Evidence 驱动拓词）+ Query Builder V2 批量生成预览与一键入 Suite。
- C01 Executive Dashboard（全数可下钻 Evidence）。
- C10 品牌级 GEO 诊断简报（Evidence 驱动）。

**Later — Optimization Content Execution / 传播**
- C22 Optimization Content Draft 试点（机会→证据引文草稿→实验→复测）。
- C31 短期只读共享报表；C07 导入导出模板；C25 轻量跨项目数据视图。
- C21 ChangePlan 结构化导出（取代 CMS 插件设想）。

**明确不排期 / 不做**：C19（参考实现）、C20、C23、C27（参考实现）；C27 商业化计费策略会在真实 Provider 落地时重新评估。

---

## 11. 最终汇报

【GeoLens × Reference Product Gap Audit】

- **GeoLens HEAD**: `fe022ca`
- **Reference**: SITE01 geo.b7u.cn **VERIFIED** ｜ SITE02 djidfbgr.sddianfeng.cn **BLOCKED**（BLOCKED ≠ NO）｜ 飞书 SOP **UNKNOWN**
- **Capabilities Compared**: **33**
- **GeoLens FULL**: **13**（Project/Brand、Target+Aliases、Query/Suite、Multi-model、Task Lifecycle、Reports、Historical Runs、Evidence、Competitor、Account/Org、Provider Config、Multi-platform Monitoring、Manual Web UI Measurement）
- **GeoLens PARTIAL**: **10**（Dashboard、Query 导入、Query Builder、AI Diagnosis、Task/Run Presentation、Site Mgmt、Content Optimization、GEO Index、Quota/Usage/Cost、Run Estimate）
- **GeoLens NONE**: **10**（Query 交互、Batch Query Ops、Query Expansion、Task Center、AI Writing、Knowledge Base、Publishing、Data Center/共享报表、Billing、Shared Reports）
- **MUST_ADOPT**: **17**（新增采纳 4：Query 表格交互 C05 / 批量 Query 操作 C06 / 统一任务中心 C12 / Usage-Cost Center C26；KEEP 已具备 13）
- **ADAPT_TO_GEOLENS**: **9**（C01 C08 C09 C10 C14 C21 C22 C24 C30）
- **LATER**: **3**（C07 C25 C31）
- **DO_NOT_COPY**: **4**（C19 AI Writing、C20 素材库、C23 Publishing、C27 Billing 参考实现）

**Top 5 Gaps**:
1. 统一任务中心 / Activity Center（C12）
2. Query 表格交互 + 批量操作（C05/C06）
3. Usage/Cost Center（C26/C30）
4. Executive Dashboard（C01）
5. Content Optimization 闭环 Draft/Revision（C22）

**Reference Top Strength**: 一体化关键词工具（查收录 + GEO 拓词 + 评估 + 保存词组单页闭环，P025）——"面向一个任务把步骤做成一个页面"的工程思想最值得 GeoLens 学习。

**GeoLens Top Strength**: Evidence-first 不可变证据与溯源体系（Evidence/Snapshot/Report 版本化 + 污染守卫 + 受控实验复测）——参考站完全缺失，是 GeoLens 的差异化护城河。

**Recommended Next Sprint**: 统一任务中心（C12）+ 问题集表格交互与批量操作（C05/C06）——均复用现有 Run 状态机与现有表，属高收益低风险的地基迭代；顺带完成运行成本预估占位（C30）。

**Code Changes**: 0
**Real Provider Calls**: 0
**External Writes**: 0
**Push**: NO
*（内容由AI生成，仅供参考）*
