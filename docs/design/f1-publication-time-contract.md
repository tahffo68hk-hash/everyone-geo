# F1 发布资产：实际发布时间、登记身份与兼容边界（设计草案）

> **PROPOSED / DESIGN ONLY — 未实现、未上线、禁止据此打开生产核验表单。**  
> Task ID：WEB-013 · Context：`ctx-v1-3bd61fd3d7c6` · 基准 HEAD：`4652ae647e67385f4732c4a867d764248055c9ea`  
> 实施 Owner：**LOC-002（本地）**。本包只交设计；API、数据库、迁移、鉴权、UI 和运行结果均不能从本文件推定已存在。

## 0. 目标、术语与必须先阻断的风险

核心目标：阻断将**资产登记时间**误认为**真实对外发布时间**，阻断将客户端提交的 `PLATFORM_CONFIRMED` 当成可信平台回执，并阻断同组织跨项目、错误草稿/版本或重复资产的错误血缘。设计必须延续现有的追加式历史记录、不覆写 Evidence、Report、M10/M11 归因与学习快照。

- `createdAt`：数据库创建 PublishedAsset 记录的时间；说明何时登记，不说明平台何时发布。
- `verifiedAt`：服务器记录核验动作完成的时间，当前代码仅在选定核验枚举时设为 `new Date()`；不说明平台何时发布。
- `PublishedAsset.publishedAt`（**LEGACY**）：现为非空 `@default(now())`，当前 DTO 不传、create/confirm 不设置，**不能作为已核实实际发布时间**。旧字段仍可被既有读端消费，但新决策禁止将其当真值。
- `Publication.publishedAt`（**LEGACY 写入行为**）：现 confirm 的 `PLATFORM_CONFIRMED` 分支写 `new Date()`；同样是确认时刻，不等同平台真实发布时间。
- `actualPublishedAt`（**PROPOSED**）：证据支持的对外发布时间；必须显式允许为 `null`，与两类数据库/核验动作时间分离。
- `timeSource`（**PROPOSED**）：说明 `actualPublishedAt` 如何获得，不得由客户端任意自填并直接生效；`PLATFORM_RECEIPT`、`MANUAL_EVIDENCED`、`UNKNOWN` 是候选，不代表已部署的 DB 枚举。
- `assetIdentity`（**PROPOSED**）：用于幂等与冲突处理的版本化外部对象标识，不是 canonical URL 单独构成的唯一键。

**四项发布阻断条件**：① 来源/实际发布时间策略未由 LOC-002 签定；② 平台回执没有可信的服务端验证能力；③关联实体无法确定地证明同项目/同草稿版本血缘；④并发身份键与原子写入未落地。任一未满足不得把“选择 PLATFORM_CONFIRMED”形式的 UI 接入生产。

## 1. 已知事实和现状缺口（EXISTING，不是保证）

仅依据 Context Pack 附带的现有代码片段、路径及行范围，未取得完整仓库或数据库。

### 1.1 已有输入/标量和当前行为

| 位置 | EXISTING 字段/行为 | 可得事实及边界 |
|---|---|---|
| `ConfirmPublishedAssetDto` | 必填 `verificationStatus`；选填 `canonicalUrl`, `externalAssetId`, `title`, `sourceType`, `verificationNote`, `metadata` | **没有**发布时间、证据引用、幂等键；`metadata` 无发布时刻契约。|
| `CreatePublishedAssetDto` | `projectId`, `draftId`, `platform`, `title`, `verificationStatus` 必填；`revisionId`, `publicationId`, `campaignId`, `scheduleItemId`, `planItemId` 等可选 | 手动选择 Publication 时只校验 `projectId`，不核对选中 draft/revision。|
| `PublishedAsset` | `organizationId`, `projectId`, `publicationId?`, `publicationAttemptId?`, `campaignId?`, `scheduleItemId?`, `planItemId?`, `draftId`, `revisionId` | 有血缘标量不代表跨引用验证已经实现。|
| `PublishedAsset` | `platform`, `title`, `canonicalUrl?`, `externalAssetId?`, `verificationStatus`, `sourceType`, `verificationNote?`, `verifiedAt?`, `verifiedById?`, `metadata` | 源码片段没有身份唯一约束；`verificationStatus` 当前按 DTO 请求值写库。|
| `PublishedAsset` | `publishedAt DateTime @default(now())`, `createdAt DateTime @default(now())`, `updatedAt @updatedAt` | `publishedAt` 是数据库插入默认值，**不可自动当作平台时间**。|
| confirm service | Publication `findUnique`，含 draft/revision/attempts；只调用 `assertUserInOrganization` | 组织成员不等于独立的项目 ACL；且没有显式全链血缘一致性检查。|
| confirm service | 选择 `attempts[0]`、从 draft 回退 `sourcePlanItemId`、`findFirst` 补排期 | 最新 attempt 未证实一定是成功/非 Mock/本次版本；`findFirst` 不能消除一对多歧义。|
| confirm/create service | 先 `publishedAsset.create`，后尝试把排期设 `DONE` 并以 `catch` 吞错 | 可能出现“资产已登记、排期未同步”；时间写的是 `new Date()`，还整体覆盖排期 metadata。|
| confirm service | `PLATFORM_CONFIRMED` 时更新 Publication `status=PUBLISHED, publishedAt=new Date()` | 外部已发布与内部更新时间混淆，且更新与资产创建/审计未在所给片段中展示原子事务。|
| create service | draft 检查项目，revision 检查 draft；`planItem` 仅 `organizationId`；publication/campaign/schedule 检查 `projectId` | **同一组织不同项目 planItem 可被错误关联**；同项目的 publication 也可能不匹配 draft/revision。|
| evidence validator | Mock URL/ID 简单拒绝；平台确认仅需 URL 或 ID；人工确认还需 note | URL/ID 非假字串不等于平台回执；普通用户仍可通过枚举声称 `PLATFORM_CONFIRMED`。|
| `TenantService` | `assertUserInOrganization` 查 membership；`assertUserInProject` 先查 project 后查组织 membership | 当前模型是组织 membership；**没有证据显示独立的项目级角色或核验授权**。|
| Controller | `POST publications/:id/confirm-asset` / `POST projects/:id/published-assets` 等 | 路由已存在；本设计给出的新增字段或新路径 **均非现有 API**。|

### 1.2 当前缺失的契约

| 缺失项（CURRENT MISSING） | 风险/约束 | PROPOSED 最小补充（待 LOC-002 决议） |
|---|---|---|
| DTO 不接受真实发布时间及来源证明 | 自动变成登记时刻 | `actualPublishedAt?: ISO8601\|null`、时间证据引用；服务端计算来源 |
| 不存在 nullable 可信时间字段 | 旧 `publishedAt` 非空且语义不可信 | 新增 `actualPublishedAt DateTime?`，不改旧值 |
| 缺时间证据来源与核验等级 | 无法区分平台/人工/未知 | `publicationTimeSource`、`publicationTimeEvidenceRef?` 等可审计元数据或显式列 |
| 缺平台可信回执通路 | 枚举自证 | 服务端验证 receipt 与账号、外部对象、时间、版本匹配；未具备则不允许平台确认 |
| 缺人工审核者及核验凭据关联规则 | 备注随意填写可伪造 | 审核权限+审核记录+证据引用+实际时间；`verificationNote` 仍必须存在 |
| 缺 project/plan/pub/draft/revision/attempt 完整血缘校验 | 跨项目和错版本 | 对照第 4 节逐项读取并一致性验证 |
| 缺外部身份唯一键及幂等提交机制 | 重复请求/并发多行 | 第 6 节候选 Identity + request idempotency ledger + DB 唯一仲裁（方案未定） |
| 写资产/排期/Publication/审计分散 | 局部成功、审计缺口 | 第 7 节本地事务和最终态策略 |
| 未知时间及旧数据表现契约 | 旧记录被误用作复测 cutoff | `actualPublishedAt: null`、`LEGACY_UNDETERMINED` 读时推导，旧记录只读 |

### 1.3 字段候选（PROPOSED；非现有 DTO/schema）

| 层级 | 候选字段 | 类型/写入责任 | 语义与 NULL 原则 |
|---|---|---|---|
| v2 请求 | `actualPublishedAt` | `string (RFC3339 with timezone) \| null`；人工申报 | 人工核验必须提交实际时刻，未知只能 `null` 且状态不可变可信；不接受无时区文本 |
| v2 请求 | `publicationTimeEvidenceRef` | 受控证据引用；服务端归属校验 | 指向平台回执或人工可复核依据，不在公开 metadata 放密钥、隐私原文 |
| v2 请求 | `verificationIntent` | `RECORD_UNVERIFIED`/`REQUEST_MANUAL_VERIFICATION`/`VERIFY_PLATFORM_RECEIPT` | 仅为请求意图，**不是最终** `verificationStatus`；服务端按授权及验证生成状态 |
| v2 请求 | `publicationAttemptId` | 可选 UUID；服务端复查 | 只认匹配本次 Publication、版本且非 Mock 的 attempt；不能选择任意记录 |
| v2 请求 | `idempotencyKey` | 业务请求唯一字符串；服务端 hash/作用域隔离 | 相同 key+相同规范化 payload 返回原结果；不同 payload 冲突 |
| 新 PublishedAsset | `actualPublishedAt` | `DateTime?`；服务端证据判定后写 | 缺时间保留 NULL；不能使用 `publishedAt`/`verifiedAt`/`createdAt` 代填 |
| 新 PublishedAsset 或受控证明表 | `publicationTimeSource` | 服务端 `PLATFORM_RECEIPT` / `MANUAL_EVIDENCED` / `UNKNOWN` | 不允许普通请求通过 `metadata.timeSource` 自证；具体表/列由 LOC-002 选 |
| 新 PublishedAsset 或受控证明表 | `publicationTimeEvidenceRef` | 限制访问的外键/引用 | 关联核验工作流与证明；旧记录为 NULL |
| 新资产身份索引/表 | `assetIdentityScope`, `assetIdentityKey`, `assetVersionKey` | 服务端由平台账号/版本/Publication 等归一化推导 | 不允许 `canonicalUrl` 单独代表唯一资产身份；在确定键模型前不建 unique index |
| 读 DTO | `publicationTimeState` | 服务端派生 `KNOWN`/`UNKNOWN`/`LEGACY_UNDETERMINED` | 旧行不落库假时间，读端明确标未知 |

`verifiedAt`/`verifiedById`/`createdAt` 沿用原含义；`publishedAt` 维持旧存储兼容，仅打上 `LEGACY_REGISTRATION_FALLBACK` 语义标识（此标识为文档约定，并非新增现有字段）。

## 2. 时间模型：方案权衡与首选决策

### 2.1 两条可选路径

| 方案 | 好处 | 隐患与上线限制 | 建议 |
|---|---|---|---|
| A：给原 DTO 直接加 `publishedAt` + `metadata.timeSource` | 侵入较小、短期无需增加模型列 | 旧 `PublishedAsset.publishedAt` 默认 now；metadata 可由用户伪造，无法可靠区分来源和历史脏值；下游可能继续直接消费旧字段；无来源验证与审计 | **不作为可信上线方案**。仅可用于明确“用户申报、尚未核验”的隔离草稿数据；不得参与复测 cutoff/归因。 |
| B：添加 nullable `actualPublishedAt` + 服务端控制的来源和证据；旧字段保持 | 可信/未知分离，允许兼容迁移，便于阻断历史误用；WEB-004 名称更直观 | 需要数据库迁移、新读写协议和下游消费检查；需真正完成权限、验证和幂等 | **首选待审批设计**。LOC-002 决定时间来源字段存列还是受控证明表。 |

**建议规则**：

1. `PLATFORM_RECEIPT`：服务端使用授权的真实回执/平台查询验证账号、资源 ID、时间和内容版本，确实提供发布事件时刻才写 `actualPublishedAt`。平台返回“已发布”却不给时间，则保持 `null`；不能用服务器当前时间代替。
2. `MANUAL_EVIDENCED`：授权核验员审查可定位的依据（如带发布时间的原始页面留痕/经审查的外部凭据），输入有时区的真实时间；保存依据、审核者、审核时刻和来源层级。**人工证实不等于平台签发回执**，对复测基线可否用该时间须有明示策略和 warning。
3. `UNKNOWN`：用户未提供/无法验证/外部接口缺字段，保留 `actualPublishedAt=null`。允许创建 `UNVERIFIED` 隔离记录供补证；不触发 `DONE`，不作为新一轮可信复测/归因的发布时间锚点。
4. **未来时间**：`actualPublishedAt > serverNow` 默认拒绝。若平台存在已测得的时钟偏差，需由 LOC-002 书面批准可配置容差、记录原始回执时间与服务器时间；无批准不默许分钟级容差。拒绝计划发布时间冒充真实发布时间。
5. **时间顺序**：证据事件时间不能晚于服务器接受核验的时间（除已审批时钟策略）；不能从最晚 attempt/最近更新时间倒推出真实发布时刻。若存在可确认的矛盾（例如 receipt 比其所指发布 attempt 早），进入冲突复核，不能静默调整。
6. **旧数据**：现存 `publishedAt` 无法区分“数据库默认 now”与真实事件；除非逐条取得新可验证原始证明并经审批执行单独补证流程，否则不回填。旧数据可原样读取，但新功能使用 `actualPublishedAt` 时其值为 `null`。

### 2.2 时间和核验状态的允许组合（PROPOSED）

| 来源/核验情况 | `actualPublishedAt` | 可存储状态 | 后续是否可把该时间用于正式比较 |
|---|---|---|---|
| 平台可信回执含明确发布时间且匹配对象 | 平台时间 | `PLATFORM_CONFIRMED` | 通过 baseline/time ordering 其余条件后才可；回执并不证明 AI 网页检索 |
| 平台回执能证明发布但缺真实事件时间 | `null` | 建议 `UNVERIFIED` 或独立“待补发布时间”状态（须本地决定） | **不可**；不得填 `now()` |
| 有权人工审核了依据并确认发布时间 | 审核记录中的事件时间 | `MANUAL_VERIFIED` | 须依据本地确认的风险策略，可标明“人工来源/存在比较限制” |
| 只有用户文字自述/普通 URL/裸 external ID | `null` | `UNVERIFIED` | **不可** |
| 失败/Mock/未知外部成功的 attempt | `null` | `UNVERIFIED` / 待核实 | **不可**；Mock 不能升级成平台回执 |
| 旧记录未补证 | `null`（新字段） | **保留原 verificationStatus 原值，不重写** | **不可基于旧 `publishedAt` 开启新可信复测** |

**待决断**：平台证实发布但无发布时间时若业务坚持展示平台已确认，必须用独立 `publicationTimeState=UNKNOWN` 和所有消费者严格阻断使用时间；在联动状态未全面审查前采用更保守的 `UNVERIFIED`/待补证表现，不虚构新已存在的状态枚举。

## 3. 候选请求、返回协议（全部 PROPOSED，尚不可调用）

以下 JSON 均为**合成示例**；端点 `/v2/...` 仅示意版本隔离，不表示 controller 已声明该路由。LOC-002 可保留现有路径并通过明确能力开关/契约版本实现，但不得在旧接口静默放宽可信核验。

### 3.1 平台发布确认（服务端持有 receipt，不能让浏览器伪造）

```json
{
  "_contract": "PROPOSED-v2-confirm",
  "publicationId": "11111111-1111-4111-8111-111111111111",
  "publicationAttemptId": "22222222-2222-4222-8222-222222222222",
  "verificationIntent": "VERIFY_PLATFORM_RECEIPT",
  "publicationTimeEvidenceRef": "receipt-ref:server-owned-001",
  "idempotencyKey": "confirm:synthetic-001",
  "title": "合成发布资产"
}
```

平台流程的 `actualPublishedAt` **应由服务端从经过验证的 receipt 取得**，不接受调用者自行声称时间或 `PLATFORM_CONFIRMED`。`receipt-ref` 是概念示例，真实格式、鉴权和存储均 UNKNOWN。

### 3.2 人工审核申请与未核验登记

```json
{
  "_contract": "PROPOSED-v2-manual",
  "projectId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "draftId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "revisionId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "publicationId": null,
  "platform": "WECHAT",
  "title": "合成公众号内容",
  "canonicalUrl": "https://content.invalid.test/article/42",
  "verificationIntent": "REQUEST_MANUAL_VERIFICATION",
  "actualPublishedAt": "2026-09-18T08:10:00+08:00",
  "publicationTimeEvidenceRef": "manual-evidence:synthetic-002",
  "verificationNote": "核验员需核查外部发布时间和版本证明；本句仅是合成描述",
  "idempotencyKey": "manual:synthetic-002"
}
```

**注意**：上例是请求候选，不代表普通用户可直接核准。最终 `MANUAL_VERIFIED` 须由具授权的审核者完成审核并由服务器记录，送审数据不得直接写为核验通过。`*.invalid.test` 仅是合成占位，**不是**可访问真实证据；不会用于真实核验。

```json
{
  "_contract": "PROPOSED-v2-unverified",
  "projectId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "draftId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "platform": "OTHER",
  "title": "发布时间尚未知的资产",
  "verificationIntent": "RECORD_UNVERIFIED",
  "actualPublishedAt": null,
  "publicationTimeEvidenceRef": null,
  "idempotencyKey": "record:synthetic-003"
}
```

### 3.3 返回协议（PROPOSED）

```json
{
  "_contract": "PROPOSED-v2-response",
  "id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "projectId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "publicationId": null,
  "revisionId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "verificationStatus": "MANUAL_VERIFIED",
  "actualPublishedAt": "2026-09-18T00:10:00.000Z",
  "publicationTimeSource": "MANUAL_EVIDENCED",
  "publicationTimeState": "KNOWN",
  "verifiedAt": "2026-09-19T05:30:00.000Z",
  "createdAt": "2026-09-19T05:30:00.000Z",
  "legacyPublishedAt": "2026-09-19T05:30:00.000Z",
  "isLegacyTimeAuthoritative": false,
  "idempotencyReplay": false,
  "warnings": ["MANUAL_TIME_SOURCE_NOT_PLATFORM_RECEIPT"]
}
```

这里的时间都是**合成示例**。真实响应用持久化结果生成，不能简单用此示例代替。旧版 API 的字段名保留兼容时，可继续返回 `publishedAt`（旧语义），但新增端点/读 DTO 必须标记其非权威性；字段是否采用 `legacyPublishedAt` 别名由 LOC-002 决定。

## 4. 逐关联血缘/授权校验表（所有关联都要校验）

**总规则**：先授权目标项目与操作能力，再查对象并防越权，再验整个候选关系图，再验回执和时间；任何失败在副作用发生前结束。`assertUserInProject` 的现状仅实现组织 membership，不能声称已有细粒度权限。跨项目关联，包含同组织不同项目，建议统一返回 404 以避免对象存在性泄漏。

| 关联 | 必须检查的断言（PROPOSED） | 当前证据/特殊失败 |
|---|---|---|
| `project` | 输入 path `:id` 与 body `projectId` 如同时出现必须相同；project 存在；user 为组织成员，且具**可用的核验能力授权**（具体角色机制待定） | 当前控制器 `paramProjectId || dto.projectId` 不检查矛盾；组织 membership 不足以授予确认权限 |
| `draft` | `draft.projectId === project.id`，`draft.organizationId`（若存在）匹配；不得跨项目 | create 已检查 draft.projectId；confirm 以 pub.draft 推导但仍须复查 |
| `revision` | revision 存在、`revision.draftId === draft.id`，由 draft 追溯项目；当与 publication 绑定时选定 revision 必须与 `publication.revisionId` 一致（含空值处理政策） | create 只校验 rev 归属 draft；confirm 采用 pub.revisionId，但 pub 可能未绑定明确版本。若 pub.revisionId 为 NULL，**不能默默替代 latestRevision** |
| `publication` | `pub.projectId === project.id`，`pub.draftId === draft.id`，`pub.revisionId === selectedRevision.id`；如 revisionId 在历史模型可空，要求可靠版本证据，否则拒绝可信确认；`pub.channel === platform` 或显式批准的规范化映射 | 当前 create 对 pub 只查 project；**同项目不表示选中的草稿/版本正确** |
| `attempt` | attempt `publicationId === pub.id`，尝试版本/账号/平台必须与此次对象相容；类型、模拟标记、成功状态、回执 ID 与时间要可验证；不允许失败/Mock 或“最近一次”自然升级为真实 | confirm 取 `pub.attempts[0]` 且未见回执/状态校验；attempt 的完整模型和可信字段 **UNKNOWN** |
| `campaign` | `campaign.projectId === project.id`；与 pub、schedule、plan 的战役绑定一致；不能借同项目无关 campaign 假造归属 | create 仅查项目 |
| `scheduleItem` | `scheduleItem.projectId === project.id`；如有 `planItemId`/`campaignId` 必须与候选一致；如由 plan 推导有多个匹配不能 `findFirst` 任意选一个 | 当前 create 查项目；后置 `DONE` 更新吞错、覆盖 metadata |
| `planItem` | 必须能通过自身 `projectId` **或**可验证且唯一的 owning campaign/strategy/plan 关系证明归属于目标 project；若 Schema 无可走的项目血缘，则拒绝绑定并登记阻塞，不可只看 `organizationId` | 当前 create 只检查组织相等；**字段/关系完整 Schema 未提供**，不能声称存在可直接查询的 projectId |
| `draft.sourcePlanItemId` | 若存在，回溯并证明同项目；与显式传入 `planItemId`、pub.planItemId 必须相容；不允许“无计划”静默抹去矛盾 | confirm/create 均用此字段回退；当前无回溯证明 |
| `publishedAsset` | 写入的每个 foreign ID 与确认过的候选图一致，跨组织、跨项目、跨草稿版本均不接受；同一物理资产身份并发由持久化唯一仲裁 | 目前仅普通索引的上下文，具体所有 indexes/constraints **UNKNOWN** |

**空值/歧义判定**：可选的 campaign/schedule/plan 可以是真正的 `null`，但当已提供不一致关联时不能靠删除该字段让核验通过；自动回填只允许关系唯一且被验证的情况。未知关系不能填猜测的版本、项目或时间。未提供 revisionId 时自动选“最新版本”仅适用于无 Publication 绑定且业务确实允许该时刻候选版本的低信任登记；用于可信发布身份前必须固定版本快照。

**授权区分**：`org membership` → 可否读取/创建未验证资产，`manual reviewer` → 可否批准人工核验，`trusted platform verifier` → 服务器端服务凭证+账号授权，可否认定平台回执。具体角色和现有 IAM 实现 UNKNOWN；在该能力未落实前，**不允许普通项目成员自行提交即成为 VERIFIED**。对存在性和授权失败统一掩蔽，机密凭证不得进入 metadata、浏览器或审计原文。

## 5. 确认/创建校验顺序（PROPOSED 伪代码）

```text
1. 识别明确版本/能力开关；不开启时拒绝新可信确认写入。读取 path/body 项目并检查一致。
2. 使用目标 project 读取其 organization；检查用户 membership 与操作能力（核验需额外授权）。
3. 验证 DTO 的 strict 类型、长度、URL 和时间格式；禁止客户端直接指定可信 status/source。
4. 在 project 范围内加载 draft、revision、publication、attempt、campaign、schedule、plan 的候选图。
5. 执行第 4 节所有 project / org / draft / revision / publication / attempt / plan 回溯断言；任何 UNKNOWN 关键关系终止可信确认。
6. 在服务器上审查 receipt/人工依据与来源、外部身份、账号、发布版本、时间；检测 Mock、失败和未知外部成功态。
7. 按第 2 节确定 actualPublishedAt（可以为 null）和最终 verificationStatus；完成未来时间和时间顺序校验。
8. 规范化 identity + payloadHash + scoped idempotencyKey；检查既有结果/冲突；并发进入 DB 唯一/事务仲裁。
9. 开启事务：追加资产（或读取幂等原结果）、写核验审计、按条件原子更新 publication/schedule 的状态和保留旧 metadata；不吞异常。
10. 提交成功后返回服务端真实快照；外部任务仅通过独立出箱/协调流程触发，绝不把“请求成功”当“平台已发布”。
```

第 6 步不允许随意访问提供的 URL 当作可靠平台证明；如果存在访问外部 URL 的实现，需要 SSRF 防护、超时、重定向、私网/本地地址阻断和域名归属政策。该能力本包不实现，也不假设存在。

## 6. 外部对象身份、重复提交和并发

### 6.1 身份键候选（均未实施）

| 候选 | 构成 | 适用前提与限制 |
|---|---|---|
| A：平台对象 | `projectId + platform + platformAccountId + externalAssetId + externalVersionKey` | 最可靠的独立平台身份，要求验证账号/ID/版本含义；`externalAssetId` 是否稳定/全局唯一 **UNKNOWN**。若平台编辑只更新同一 ID，应定义版本快照规则 |
| B：本系统 Publication | `projectId + publicationId + publicationAttemptId + revisionId + confirmedExternalVersion` | 适合由内部发布尝试确认的对象；attempt 可能重试、多次真发，不能简单把 attemptNo 视为外部资源版本；需可信外部回执 |
| C：人工导入 | `projectId + importSourceId + importerProvidedStableObjectId + versionEvidenceKey` 或受控人工审核记录 ID | 没有外部稳定 ID 时只保证请求幂等；**不能声称不同请求必然是同一物理资产**，有歧义应人工复核 |
| D：规范化 URL | `canonicalUrl` | **仅用于检索/冲突提示，不可单独做唯一键**。同 URL 可对应重发/版本、路径别名/重定向、平台同域重用 |

身份 key 的唯一约束应在数据库事务层生效；具体是条件唯一 index、单独 AssetIdentity 表还是 versioned composite unique，必须先在 `geo_test` 对实际 Schema、NULL、历史重复和多平台行为完成数据审计后由 LOC-002 决定。**本设计不要求也不提供任何 SQL patch。**

### 6.2 冲突判定（PROPOSED）

1. 相同作用域 `idempotencyKey` 且 canonical payload hash 完全一致：返回既有资产，建议 `200 OK` + `idempotencyReplay=true`；不得追加第二条资产/审计成功事件或重复触发排期。首次创建返回 `201 Created`。
2. 相同 key、不同 payload：`409 IDEMPOTENCY_KEY_REUSED`；绝不能用后一次请求覆盖旧记录。
3. 不同 key、同已验证外部对象/同版本身份：`409 ASSET_IDENTITY_CONFLICT`（或仅在完全一致时返回受控既有对象；默认按冲突处理）；相同 URL 但不同已验证对象 ID/版本**不自动合并**。
4. 不同 key、无可靠外部对象身份：不能自动判重为同一物理资产；可先保留为 `UNVERIFIED` 并进人工查重队列，禁止生成“平台已确认”的结论。
5. 两个请求同时进入：事务+持久化唯一仲裁，捕获唯一冲突后重新查询同 scope 的既有 identity / request hash；若同一请求则重放，否则 409。仅应用层先查询再创建**不能**防 race。
6. 同一已发布 URL 在不同项目可作为各自线索，但物理平台对象归属与授权还需验证；即使两者组织相同也不能绑定跨项目的 draft/plan/publication。

`@unique` 组合、隔离级别（必要时 SERIALIZABLE）、冲突重试上限、idempotency key 保存时限应基于实际业务和数据库设计评审，不在文档中假称已选定。对重试应避免重复平台副作用；外部提交超时但可能成功时标记 `EXTERNAL_OUTCOME_UNKNOWN`，先通过服务端平台查询 reconcile，不立刻另发一次。

## 7. 数据库事务、审计、状态更新边界（PROPOSED）

**一致性目标**：在本地 DB 中，(1)身份占位/幂等结果，(2)资产新记录，(3)证据来源/审核日志，(4)必要的 Publication 与 Schedule 状态更新，(5)审计记录——要么作为同一逻辑提交完成，要么按显式状态机等待，不允许以 `catch(logger.warn)` 吞掉排期失败并报告整体成功。当前片段没有证明现有 `audit` 能接收 Prisma transaction client，LOC-002 必须检查；若不能进入同一事务，不应宣称原子性已满足。

- 先取得可信外部回执并解析结果（纯外部 API 操作不放入长数据库事务）；只有服务器确认身份、版本与真实时间后进入 DB 事务。若外部操作结果未知，写/保留**待协调**状态而非 `PUBLISHED`；是否有专门持久化状态和队列 **UNKNOWN**，若缺则阻断该场景上线。
- DB 内校验仍需 race 防护：对候选 graph 的可变版本/排期状态重查或乐观并发控制；锁顺序固定，避免两个并发确认交叉互写。所有写入遵守项目和身份唯一键。
- `PublishedAsset` 追加记录；保留旧 Evidence、Report、M10/M11 快照，不将旧数据按新规则重算为“因果”。成功后新消费端基于 `actualPublishedAt` 和原始证据状态进行判断。
- 只有满足真实证据、授权、关系图和**已知真实时间**的确认才允许按策略推进 `ContentScheduleItem.productionStatus=DONE`；更新时**合并**已存在 metadata 而非整体覆盖，记录 `publishedAssetId` 及 `actualPublishedAt` 的来源说明，并检查该 schedule 尚关联正确资产。多资产共享一个排期时不得任意覆盖前一资产绑定。
- Publication 状态与对外事件时间分离：`PUBLISHED` 的触发需真实平台或已批准人工核验语义；不能把 Publication 的 `publishedAt = new Date()` 输出成平台事件时间。对旧字段改动仅可在 LOC-002 明确兼容和下游检查后实施。
- `verifiedAt` 使用可信服务器审核完成时间；`createdAt` 使用数据库插入时间；`actualPublishedAt` 使用事件依据时间。审计记录应包含 actor / project / publication / revision / attempt / identityKey hash / evidenceRef / timeSource / eventTime / verificationTime / before→after / idempotency decision，不记录令牌、完整隐私原文。
- 如审计、排期或 Publication 更新失败：同一事务回滚，返回明确失败，不得出现“资产验证成功但其它不一致”的成功响应。若要求不同事务可靠异步执行，必须有耐久 outbox + reconcile 状态并调整 UI 展示；该设施当前 **UNKNOWN**。

## 8. 错误契约、兼容和部署开关（PROPOSED）

| 场景 | 建议 HTTP / 机器码 | 安全要求 |
|---|---|---|
| 输入时间无时区、非法格式、path/body 项目不一致 | `400 INVALID_INPUT` / `400 PROJECT_ID_MISMATCH` | 不执行副作用；不猜 UTC |
| 当前用户无组织/项目访问、关联外部项目对象 | `404 RESOURCE_NOT_FOUND` | 不泄漏他项目 ID 是否存在 |
| 组织成员缺人工核验操作权限 | `403 VERIFICATION_PERMISSION_DENIED`（如项目本身不可见先 404） | 前提是 LOC-002 实现/审定细粒度授权 |
| 同项目内部血缘不匹配、身份冲突、幂等冲突 | `409 LINEAGE_MISMATCH` / `409 ASSET_IDENTITY_CONFLICT` / `409 IDEMPOTENCY_KEY_REUSED` | 不允许默默采用另一个 revision |
| 人工凭据或事件时间不足、未来时间、Mock/失败 attempt | `422 INSUFFICIENT_PUBLICATION_PROOF` / `422 INVALID_PUBLICATION_TIME` / `422 UNTRUSTED_ATTEMPT` | 不提升核验等级；可另提供 UNVERIFIED 登记入口 |
| 可信平台回执查询不可用/能力未配置 | `503 PLATFORM_VERIFIER_UNAVAILABLE` 或明确定义的 `422 PLATFORM_VERIFIER_NOT_SUPPORTED` | 配置可用不等于实际调用成功；不能回退“凭 URL 自证” |
| 外部请求有可能成功但未确认 | `202 EXTERNAL_OUTCOME_PENDING` **仅当存在耐久协调记录时**；否则明确失败/阻断 | 不重试真实发布，不输出已确认事实 |
| 审计/排期/事务提交失败 | `503 ATOMIC_PERSISTENCE_FAILED`（实际错误映射按本地规范） | 整体回滚；保留错误追踪，避免泄漏内部查询 |
| 完整幂等重放 | `200` + `idempotencyReplay=true` | 返回同一资产 ID，不再变更状态 |

这些错误码是**拟议**而非现有实现；实际NestJS exception、Controller Response 类型和 validation pipe 需本地核对。所有生产表单必须等“谁能核验、凭什么、事件时间怎样验证、幂等 identity 如何约束”的决策通过后再接入。

### 8.1 当前 API 的兼容策略

- 阶段 0：部署设计/监控不改行为；已有 POST 接口的**风险依然存在**，不能声称只加新 UI 就修好老接口。
- 阶段 1：在现有服务端入口或网关加独立**可信写入功能开关**（如未实现须由 LOC-002 设计）；默认阻断普通客户端直接提交 `PLATFORM_CONFIRMED`、`MANUAL_VERIFIED`，不应悄悄把其改为 `UNVERIFIED`；`UNVERIFIED` 只按明确现存兼容政策保存。若需要保留旧客户端，仅限已授权的低信任登记读取/写入，避免 silent break。
- 阶段 2：新增后端契约与迁移，开放经过授权和审查的 v2 输入/读 DTO；旧 `publishedAt` 保留原样，新读者消费 nullable `actualPublishedAt`；新表单在服务端 gate 全绿前不得出现可信确认操作。
- 阶段 3：下游 Publication → Retest → Outcome → Attribution → Learning 逐点核查时间 cutoff，阻断旧时间冒充真实；分批上线，复测只针对已确认时间的新资产；既有结果只读保留。
- 回滚时可关闭 v2 写入口、新表单、状态推进，保留已新增 nullable 列与审计数据，不降级地重用旧不可信确认入口；不要 drop 新列或回填历史为 now。若旧读端仍引用旧时间，保持清晰风险提示/功能隔离直到消费端修复。

## 9. 历史资产策略和数据库演进（仅计划，不提供 SQL）

1. `geo_test` 先采集**非敏感聚合**：各 verificationStatus 的历史数、真实时间字段缺失率、同平台外部 ID 重复、URL 重用、跨项目关联、实际索引和 NULL 行为；现有影响规模 **UNKNOWN**。不要把这些操作冒称本包执行过。
2. 可选 nullable 字段/来源审计表采用 additive migration；新 `actualPublishedAt` 对**所有旧行默认 NULL**，来源 `UNKNOWN`/派生 `LEGACY_UNDETERMINED`；禁止 SQL `UPDATE actualPublishedAt = publishedAt` 或复制 verifiedAt/createdAt。
3. 建兼容读 API：旧 `publishedAt` 原样留给遗留消费者；新 `publicationTimeState` 标识旧时间**不可信**。不覆盖旧发布、Evidence、Outcome、Attribution、Learning 任何快照。
4. 通过对合成数据验证 migration 的 forward/backward 应用、NULL/时区行为、ORM 生成/类型；数据库唯一键方案在数据 profile 和业务 identity 决策后单独评审，必要时先清理未来写路径，不删除历史重复。
5. `geo_test` 测试新/旧记录混读、竞争写入、回滚策略、后端多入口（含 confirm / create 路由）是否一致受 gate 保护。测试完成再拟生产迁移；不得推测生产 DB 当前状态。
6. 若要逐条补证历史资产，需另立显式 correction/supplement workflow，链接到旧 asset 的只读原记录与证据，记录时间来源及操作者；不得直接把过去归因改写成“已证实”。

## 10. 拒绝/兼容矩阵（**PROPOSED 合成场景**；全部未在仓库运行）

| # | 合成场景 | 预期判定及副作用 |
|---:|---|---|
| 01 | `actualPublishedAt=null`，请求 `RECORD_UNVERIFIED` | **接受**低信任登记（201），新可信时间 NULL，排期不 `DONE`，不启动复测 |
| 02 | 人工核验申请不给发布时间 | **拒绝核准** 422；可显式转未核验登记，不能悄悄升级 |
| 03 | 带时区的过去发布时间+可复核凭据+授权审核员 | **允许进入人工审核流程**；核准后才 MANUAL_VERIFIED，保存依据和审核事件 |
| 04 | 时间为明天/未来 > serverNow | **拒绝** 422，不得作为“已发布”时间；无预设容差 |
| 05 | `2026-09-18 10:00` 无时区 | **拒绝** 400，不能猜本地时区 |
| 06 | `actualPublishedAt` 空字符串、无效日期或 `NaN` | **拒绝** 400，不能改成当前时间 |
| 07 | 组织成员访问别的组织 project | **拒绝** 404，无写入 |
| 08 | 同组织项目 A 的 asset 使用项目 B 的 planItem | **拒绝** 404；不因组织一致放行 |
| 09 | 项目 A 的 draft + 项目 B 的 revision | **拒绝** 404/409（按泄漏边界），不落库 |
| 10 | 同项目 publication 对应 draft X，请求指定 draft Y | **拒绝** 409 LINEAGE_MISMATCH |
| 11 | 同项目 publication 的 revision R1，请求选 R2 | **拒绝** 409；不能用 latest revision 覆盖冲突 |
| 12 | Publication revision 为 NULL 且无可信版本回溯 | **阻断可信核验** 422；可按隔离政策保留未核验记录 |
| 13 | Attempt 属于另一 Publication 或账号/版本不符 | **拒绝** 404/409；不能选最近 attempt 顶替 |
| 14 | latest attempt 为 Mock / 失败 / 仅模拟发布成功 | **拒绝平台核验** 422，不把 Mock 变真实回执 |
| 15 | Mock URL/ID 或隐含私网资源当证明 | **拒绝核验** 422；原 Mock 规则不可视为完整防护 |
| 16 | 只有真实格式 URL+客户端勾选 PLATFORM_CONFIRMED | **拒绝** 422/503；必须服务端可信 receipt |
| 17 | MANUAL_VERIFIED 带备注，但无审查依据引用/非授权人员 | **拒绝核准** 403/422；`verificationNote` 不等于凭据 |
| 18 | 同项目 planItem 与 schedule/campaign 关联矛盾 | **拒绝** 409；不得 `findFirst` 随机绑定 |
| 19 | `draft.sourcePlanItemId` 回溯到其它项目 | **拒绝** 404；不能只靠组织成员权限 |
| 20 | 同 planItem 有多个可推导的 schedule 项且请求未指定 | **拒绝** 409 AMBIGUOUS_RELATION，不任意选第一条 |
| 21 | 同 idempotencyKey 同 payload 重试 | **幂等返回** 200、原 asset ID，无第二条审计成功/排期推进 |
| 22 | 同 idempotencyKey 改了 revision/time/payload | **拒绝** 409，不覆盖原记录 |
| 23 | 两个并发请求同外部 identity + 同版本、不同 key | **仅一个创建成功**；另一个 409 或受控重放，靠 DB 仲裁 |
| 24 | 两次发布 canonicalUrl 相同，但 external ID/版本不同且证明合法 | **允许独立身份**，不能用 URL 强行合并 |
| 25 | 同平台 external ID 声称相同，但平台账号/作用域未知 | **阻断可信判重/核验**，进入冲突复核而非静默唯一化 |
| 26 | 外部平台超时，是否发布成功 UNKNOWN | **不标已确认/不盲重发**；有耐久协调机制才 202，否则阻断 |
| 27 | 资产创建成功但 schedule 写失败（模拟） | **整个可信业务事务回滚**，不得吞错并返回成功 |
| 28 | 审计写失败（模拟） | **整个可信业务事务回滚**，不产生无审计的 verified 资产 |
| 29 | 老 PublishedAsset 的 `publishedAt` 是旧 default now | **只读兼容**；`actualPublishedAt=null`，显示未知，禁止作为新复测锚点 |
| 30 | 老记录 `verificationStatus=PLATFORM_CONFIRMED` 但无时间回执 | **保留历史状态文本**，但不据此新生成可信事件时间/补写 Evidence |
| 31 | path `projectId=A`，body `projectId=B` | **拒绝** 400，不以任一侧覆盖另一侧 |
| 32 | 同项目关联都正确，但当前用户只有普通组织 membership | 允许的**低信任**写入取决于既有权限；可信核验必须先有专属能力授权，否则拒绝 403 |
| 33 | 平台 receipt 证明发布，却无事件时间字段 | **不填 now**；保留未知并阻断依赖真实时间的状态推进/复测 |
| 34 | 与 WEB-004 候选 `actualPublishedAt` 名称相同但前端自行放入 metadata | **拒绝当作已生效接口**；必须经 LOC-002 DTO/schema/Service 映射确认 |

矩阵是**设计验收集**而非测试执行报告。要在 `geo_test` 将 01–34 展开为隔离 E2E（supertest/Prisma/并发），覆盖 confirm/create 两路，并核验 4xx/5xx zero side effects、跨项目 404、回滚和 replay 后相同 ID。外部真实平台不作为自动化测试的隐含前提；使用合成 receipt 驱动负例，不将其作为生产真实性证明。

## 11. 与 WEB-004 / LOC-002 的契约接力

- WEB-004 的候选 `actualPublishedAt` **只有候选名称**，不代表已加入当前 `ConfirmPublishedAssetDto`/`CreatePublishedAssetDto`。LOC-002 需要显式决定：字段名、输入位置、Null 约定、时区格式、验证层级、来源及存储映射；`publishedAt` 不能被偷偷重命名为真实时间。
- LOC-002 决议需包括：平台回执服务能力、审核角色、受控证据存储、Identity/版本唯一性、历史时间隔离、事务审计、排期状态边界、读 DTO 兼容、幂等语义和迁移/回滚。未决策的项不能凭 WEB-013 自动实现。
- 任何 Web 表单都只能在后端 contract + feature gate + 有效角色/可信来源 + `geo_test` 强制负例验证通过后接入；不能先做“选择 PLATFORM_CONFIRMED”并在后台写现有 DTO。
- 当前 W3 不修改 Service、DTO、controller、schema、SQL、前端，也不代表已进入部署状态。

## 12. UNKNOWN / 外部阻塞清单

| 未知/阻塞 | 具体原因与本地解锁方式 | 没解锁前的行为 |
|---|---|---|
| 平台真实回执能力、事件时间字段、签名/账号域 | Context Pack 没有 Provider 回执或查询实现；需 LOC-002 按平台审定 | 禁止 `PLATFORM_CONFIRMED` 用户枚举自证 |
| PublicationAttempt 全模型及“真实成功/Mock”字段 | 仅看到 `pub.attempts[0]`；需检查 schema/service/worker 的真实字段 | 不借 latest attempt 升级核验 |
| Draft/Revision/Plan/Campaign/Schedule 的完整关系链 | 缺完整 `schema.prisma` / Service 依赖；需本地逐关联合约核验 | 不能确定回溯则阻断可信绑定 |
| 细粒度用户角色/审核权 | 仅知 TenantService 组织 membership；需审定是否已有权限模型 | 无权角色不得直接核准 |
| PublishedAsset 现存唯一索引/重复率/生产 DB 实态 | 提供的 Schema 片段不包含完整索引及数据画像 | 不擅自选 new unique index；先 `geo_test` 画像 |
| Prisma transaction / audit 可否同一 client 运行 | 没有 audit 实现和全文件依赖 | 不声明原子事务已实现 |
| 外部成功 UNKNOWN 协调工作流/outbox | 未展示 Durable 状态表/队列与幂等恢复机制 | 不把网络超时视为平台失败或成功 |
| M10/M11 下游如何使用 `publishedAt` | 没有完整 Retest/Outcome/Attribution/Learning 消费代码 | 不使旧 time 成为新可信 cutoff，不篡改旧快照 |
| WEB-004 `actualPublishedAt` 候选最终映射 | 只有未来工作包名，没有已落地新 API | 不往 metadata 塞字段声称生效 |
| geo_test / Redis / 历史污染规模 / 生产索引 | 本任务不连本地库、不给 SQL patch | 保持 UNKNOWN；由 LOC-002 落地后验证 |

## 13. 可检验的完成定义

- 文档完成 != 功能完成。**本包完成**仅意味着现状风险、拟议字段、时间策略、全血缘矩阵、幂等/事务边界、兼容/回滚和 34 项合成验收场景均可交由本地审查。
- **生产解锁**要求 LOC-002 真实实现、`geo_test` 通过上述场景、明确新版读写与旧版 gate，不引入跨项目关联、不将 `now()` 当实际发布时间、不由普通用户伪造平台核验、不覆盖任何历史 Evidence/M10/M11。
- 如果任何本地实际 Schema/DTO/Service 与摘录冲突，**以本地检查为准**，在决策记录中注明差异，不要修改旧证据去迎合本设计。

### 溯源

EXISTING 基于 WEB-013 Context Pack 内嵌的：`apps/api/src/content-execution/dto/content-execution.dto.ts`（L410–534）、`apps/api/src/content-execution/content-execution.service.ts`（L1841–2134）、`packages/database/prisma/schema.prisma`（L1818–1845）、`apps/api/src/content-execution/content-execution.controller.ts`（L356–430）、`apps/api/src/common/tenant.service.ts`（L1–37）、测试参考 `apps/api/test/retest-orchestration.e2e-spec.ts`（L1–8）。规范参考路径 `docs/DEVELOPMENT_WORKFLOW.md`、`docs/DECISIONS.md`、`docs/EVIDENCE.md` 和 schema M11 注释由 Context Pack 指定，**文件全文未获取/未核验**。本文件其余 PROPOSED 内容为基于这些边界的设计，不是已存在的系统能力。
