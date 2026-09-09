# GeoLens R2 前端集成就绪设计

## 目标与范围

本轮只让现有 Activity Center、Query Workspace 和 Run Preflight 准备好接入 R2 API。保留现有 App Shell 和 Project Context，不重新设计产品，不修改后端，也不新增页面。

## 方案选择

采用集中、强类型的 R2 API 适配层。页面只维护交互状态，URL 参数构造、请求体、响应类型和批量结果统一放在 `apps/web/src/lib/r2-api.ts`。这比继续在页面中拼接请求更易适应 WorkBuddy 的 contract 变更，也比通用资源框架更小、更符合当前范围。

## Activity Center

`ActivityItem` 覆盖当前字段和未来字段：`id`、`type`、项目与问题集信息、`engineLabel`、`status`、`completed`、`total`、时间、`resultUrl`、`resultType`、`resultId`、`availableActions`。当前 `progress` 仅作为现有响应的显示兼容字段，不推断 capability。

筛选参数由 `listActivity` 统一序列化：`projectId`、`type`、`status`、`q`、`page`、`pageSize`。页面保留 Loading、Empty、Error，并继续使用统一 Project Context。

`availableActions` 缺失时不显示 capability CTA，不根据 `status`、`type`、`startable` 或 `resultUrl` 推断“继续录入”“重新运行”“取消”等权限。`resultUrl` 只作为后端已经给出的只读“查看”链接展示，不等同于 capability。

需要后端补充的 contract：

【Frontend → Backend Contract】

- Feature: Activity Center Actions
- Current: `startable`, `resultUrl`
- Missing: `availableActions`, `resultType`, `resultId`
- Frontend Need: 由后端返回明确 capability，前端只负责展示
- Priority: P1，不阻塞本轮其他 R2 前端开发

## Query Workspace

问题集详情继续由现有 suite endpoint 提供标题和统计元数据；表格改用 R2 服务端列表能力。当前观察到的 `GET /projects/:projectId/queries` 仅为 **PROVISIONAL CONTRACT**，实施时以 WorkBuddy 当前 controller / DTO 中实际存在的 endpoint 为准。请求参数为 `suiteId`、`q`、`status`、`type`、`contamination`、`sort`、`order`、`page`、`pageSize`，表格不再基于一次加载的全部 Query 做本地搜索、筛选、排序或分页。

`QueryListItem` 和 `QueryListResponse` 明确描述服务端返回。类型与污染状态仍用中文主语义，原始 enum 只放在折叠技术详情中。请求失败显示统一安全错误；404 或尚未提供能力时显示“后端服务暂未提供该能力”，不显示原始 JSON、`Failed to fetch` 或 `undefined`。

## 跨页选择与批量操作

页面持有 `Set<string>` 作为跨页选择源。当前页全选只增删当前页 ID；换页和改筛选不清空已有选择；提供“已选 N 条”和清空选择。

批量工具栏只提供启用、停用、归档、移动。归档说明明确“不修改历史运行、报告或 Evidence”。当前观察到的 `POST /projects/:projectId/queries/batch` 仅为 **PROVISIONAL CONTRACT**；实际请求路径由集中适配层封装，页面不依赖具体 URL。

成功后按响应中的 `queryIds` 清理已处理选择并刷新当前页；若当前页因操作变空且页码大于 1，则回到上一页。失败时展示后端安全错误信息，不吞掉跨项目、重复 Query、Suite 归属等错误。

移动弹窗的候选问题集来自当前项目已有 suite endpoint，排除当前 suite，不加载其他项目。前端只负责候选范围，最终隔离由后端校验。

## Run Preflight

打开运行确认弹窗后调用 R2 suite-scoped preflight 能力，前端提交 `suiteId`、`engineIds`、`runType`，由后端计算 enabled + non-archived Query 数 × engine 数，并返回 provider availability / blocked reason。当前观察到的 `POST /projects/:projectId/queries/cost-preflight` 仅为 **PROVISIONAL CONTRACT**；实际请求路径由集中适配层封装，页面不依赖具体 URL。弹窗展示问题数、引擎数、预计调用次数、运行类型和预计费用。`pricing` 或 `estimatedCost` 为 `null` 时显示“预计费用：暂不可估算”，不写死模型价格。

演示模式显示“不会产生真实 Provider 调用”；真实模式显示“将调用已启用 Provider”。若选中引擎未配置，或未来 preflight 返回 `providerDisabled`、`providerUnavailable`、`blocked`，禁止提交并显示中文原因。

当前 preflight contract 未提供 suite-scoped 请求和 provider 阻塞详情。前端通过集中适配层支持目标请求/响应类型；若真实 endpoint 尚未就绪，弹窗展示 Pending / Error 状态并记录 blocker。前端不分页枚举全部 Query ID，不自行计算费用，也不猜真实 Provider 是否允许执行。

需要后端确认的 contract：

【Frontend → Backend Contract】

- Feature: Run Preflight Scope and Provider Availability
- Endpoint: suite-scoped preflight endpoint（PROVISIONAL CONTRACT，实际路由以 WorkBuddy controller / DTO 为准）
- Missing Field: `suiteId`/运行范围、`runType`、`providerDisabled`、`providerUnavailable`、`blocked`、中文安全原因
- Frontend Need: 精确限定当前 suite，并由后端决定真实 Provider 是否允许提交
- Required/Optional: suite 范围与 blocked 原因为 Required；其他 provider 细分为 Optional

## 错误处理与测试

集中适配层负责参数编码、空值省略、错误归一化和 contract 类型。纯函数用 Node 内置测试覆盖：Activity 查询序列化、Query 查询序列化、批量选择更新、批量成功选择清理、preflight 阻塞原因与费用文案。页面通过浏览器 smoke 覆盖 Activity、Query 服务端交互、跨页选择、批量弹窗和 Run Preflight 的 Loading/Error/Empty/成功呈现；最终执行 `tsc --noEmit`、Next build 和 `check-ui-zh`。

## 非目标

- 不实现后端 capability 或批量逻辑。
- 不根据旧字段猜 Activity 权限。
- 不物理删除 Query。
- 不新增 Dashboard、图表或第二轮视觉美化。
- 不修改或暂存 `apps/api/**`、worker、数据库、队列、LLM 或 GEO Core。
