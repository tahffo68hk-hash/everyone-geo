# WorkBuddy M4 接管审计报告

- 审计时间：2026-09-05 21:49–21:55（GMT+8）
- 审计方式：只读（git / 磁盘文件 / 数据库 / 运行态），未修改任何代码
- 基线 commit：`e227dc7`（M3 milestone，未改写）

---

## 1. 现场总览

| 项目 | 实测 |
|---|---|
| branch | `master` |
| HEAD | `e227dc70e99cecec6283222e276b6b6ca41a8ff3`（= M3 `e227dc7`） |
| 未提交内容 | 10 tracked modified + 15 untracked，**全部属于 M4** |
| staged / stash | 无 / 无 |
| Node | `D:\tools\node24\node.exe` = **v24.20.0** ✓ |
| pnpm | 11.1.0（node24 驱动） |
| Redis | `geo-redis` Up 5h **(healthy)**，宿主 16379→容器 6379，PONG ✓ |
| PostgreSQL | `geo-postgres` Up 11h (healthy) ✓ |
| GeoLens node 进程 | **无**（Codex 报告的 PID 156908 已不存在；DLL 锁已自解） |

## 2. Git 改动归属

### tracked modified（10）
| 文件 | 内容 |
|---|---|
| `apps/api/package.json` | 增加 `@geo/core` workspace 依赖 |
| `apps/api/src/app.module.ts` | 注册 `EvidenceModule` |
| `apps/api/tsconfig.build.json` | **`incremental: false`**（§十七 build 技术债修复已落盘） |
| `apps/web/src/app/app/monitor/page.tsx` | Run 表格加「查看证据」列 + `EvidenceDialog`/`TaskMetrics` 挂载 |
| `apps/worker/package.json` | 增加 `@geo/core` 依赖 |
| `apps/worker/src/processor.ts` | `executeMock` 支持 `entities`+`scenario`；成功路径：`snapshotEntities → settleRun(persist: 建 Evidence) → analyzeEvidence`；Analysis 失败不回滚 provider 成功 |
| `apps/worker/src/runtime.ts` | poll 循环追加 `recoverAnalyses()` |
| `packages/database/prisma/schema.prisma` | +4 模型 +4 枚举 +Run 3 字段 |
| `packages/queue/src/state.ts` | `settleRun` 增加 `persist?(tx)` 回调（Evidence 与 Run 终态同事务原子提交） |
| `pnpm-lock.yaml` | 已含 `@geo/core`（2 处 importer） |

### untracked（15）
- `apps/api/src/evidence/`（controller/module/service —— GET /runs/:id、GET /monitor-tasks/:id/metrics，tenant 过滤）
- `apps/api/test/evidence.e2e-spec.ts`（7 个用例已写好）
- `apps/web/src/app/app/monitor/evidence-dialog.tsx`、`task-metrics.tsx`
- `apps/worker/src/evidence.ts`（evidenceData / analyzeEvidence / snapshotEntities / recoverAnalyses）
- `apps/worker/src/mock-response.ts`（10 种确定性 scenario）
- `docs/M4_PLAN.md`
- `packages/database/prisma/migrations/20260905130000_evidence_analysis/migration.sql`
- `packages/geo-core/`（package/tsconfig/README/src/index.ts/test/core.test.ts）

## 3. 九问逐答

### 1) Codex 实际完成了哪些 M4 代码？
**主体全部写完**：
- Prisma schema：`Evidence`（runId 唯一、queryText/rawPrompt/rawResponse/provider/engineKey/engineName/model/modelVersion/retrievalMode/sourceType/metadata/entitySnapshot）+ `Analysis`（@@unique([evidenceId,analysisVersion])，可版本化）+ `Mention` + `Citation` + 4 枚举（AnalysisStatus/SourceType/RetrievalMode/Sentiment）+ Run 加 `analysisStatus/analysisAttempts/analysisErrorCode/evidence`
- migration SQL：与 schema 完全一致（手核 enum/table/index/FK），另含 **Evidence 不可变 trigger**（BEFORE UPDATE 抛 23514）
- `@geo/core`：完整 Deterministic Analyzer（NFKC+Intl.Segmenter 保 offset、最长跨度/配置序消歧、词边界、URL 排除、RuleJudge 中英推荐/否定/情感、citation 结构化+文本提取+去重+域）+ `aggregateMetrics` + 45 个单测 + README（语义文档化极佳）
- Worker：provider 成功与 Evidence **同事务原子提交**（settleRun persist 回调），随后独立 `analyzeEvidence`，失败仅置 analysisStatus=FAILED、**不丢 Raw Evidence**；`recoverAnalyses` 兜底崩溃后重分析（attempts<3）
- API：EvidenceModule（runs/:id 返回 Run+Evidence+全部 Analyses(有序)+Mentions+Citations，且剔除 executionToken/entitySnapshot 内部字段；monitor-tasks/:id/metrics 走 aggregateMetrics，含 totalRuns/successfulRuns/failedRuns/analyzedRuns/analysisMissingRuns 分母透明）
- UI：EvidenceDialog（完整展示 Query/Engine/Model/时间/SourceType/Mock 徽标/Prompt/Response/Mentions/Position/Citations/版本切换）+ TaskMetrics（六指标卡 + SoV 标注「GeoLens 内部指标」）
- build 修复：`tsconfig.build.json incremental:false`

### 2) 哪些只是写了但没测试？
**全部**。任何 M4 测试都未运行过（geo-core 单测、evidence e2e、worker 集成对 evidence 的断言、M4 acceptance 均未执行）；migration 未在任何库应用。

### 3) 哪些文件处于半成品？
无截断/残缺文件。风险点是**构建产物陈旧**：
- `apps/worker/dist`（21:00）→ 无 evidence.js/mock-response.js，processor.js 无 M4 代码 → **需重建**
- `packages/queue/dist`（21:00）→ settleRun 无 persist 签名 → **需重建**
- `apps/api/dist`（21:36）→ 已含 evidence ✓（但以旧 tsbuildinfo 生产，需按 §十七 复验多轮 build）
- `packages/geo-core/dist`（21:40）→ 已新 ✓

### 4) Prisma schema 与 migration 是否一致？
**一致**。逐项核对 enum 值、表列、唯一索引、FK 级联、默认值全部对应；Run 新增 3 列带默认值（additive，非破坏）。

### 5) Evidence / Analysis API 是否已接入？
已接入 `AppModule`（EvidenceModule）。路由：`GET /runs/:id`、`GET /monitor-tasks/:id/metrics`（+`analysisVersion` 白名单校验）。tenant 过滤用 `monitorTask.organization.members.some(userId)`。

### 6) Worker 是否在 Provider response 后写 Evidence？
是。流程：`claimRun → snapshotEntities(project 的 brand/competitor) → executeMock(scenario 文案) → settleRun(SUCCEEDED, persist: tx.evidence.create) → analyzeEvidence(读 Evidence + entitySnapshot，事务内建 Analysis/Mentions/Citations，版本冲突/已存在幂等) → recoverAnalyses 周期兜底`。

### 7) Metrics 是否已经实现？
是。`aggregateMetrics`（geo-core 纯函数）：eligible=SUCCEEDED+指定 analysisVersion；Visibility/Recommendation Rate、Avg Mention Position（仅 brandMentioned）、SoV（每实体每次出现 1 次 presence）、Citation Count/Domain Count、Sentiment Distribution；空分母→null；Provider FAILED 不进分母。

### 8) UI 是否已经能查看 Evidence？
代码已具备（monitor 页每 Run「查看证据」→ dialog 全字段展示 + mock 标记；任务级指标卡）。未实测。

### 9) 当前测试新增到什么程度？
- `@geo/core` 单测：~45 用例（已写，未跑）
- `apps/api/test/evidence.e2e-spec.ts`：7 用例（已写，未跑；含 tenant 隔离、版本隔离、immutable snapshot、分母语义）
- worker 集成测试：M3 11 用例在（processor 签名变更需回归确认不破）
- **M4 acceptance 尚无**（需新写：15 Evidence + 15 Analysis + metrics + restart + recovery）

## 4. 数据库 / migration 状态

| 库 | migrations 已应用 | Evidence 表 |
|---|---|---|
| geo_test | init + monitor_pipeline | **无（未应用 evidence_analysis）** |
| geo_dev | init + monitor_pipeline | **无（未应用 evidence_analysis）** |

Prisma Client 已 generate（21:43，`.prisma/client/index.d.ts` 含 Evidence 630 处）✓

## 5. geo_dev 演示实体（Codex 已 seed，未被污染）

`geolens-dev` 组织下已有完整 M4 演示场景：
- Brand：**ProjectMentor**（aliases: Project Mentor/项目导师/PMentor）
- Competitors：Competitor A/B/C（aliases: CompA/B/C）
- Project：ProjectMentor Research（含 10 条真实中文查询）
- Mock Engines：mock-alpha/beta/gamma/retry/failure（geo_test/geo_dev 均就位）

## 6. blocker 与收尾计划

无 P0 blocker。P1 待办按序：
1. **geo_test 应用 migration**（evidence_analysis）→ validate+generate → 验证不可变 trigger
2. **重建 worker/queue dist**（陈旧）+ 复验 API 多轮 build 稳定产出 main.js（incremental:false 已落盘）
3. 跑 geo-core 单测、queue 测试、worker 集成、evidence e2e、M3 全套回归
4. 补 worker evidence 集成断言（失败分析不丢 Evidence）+ 写 **M4 acceptance**（15 Evidence+15 Analysis+metrics+restart）
5. geo_dev 应用 migration（先测后开）
6. 更新 docs（GEO_METRICS.md 新建等）
7. 按自然边界 commit（不 push）
