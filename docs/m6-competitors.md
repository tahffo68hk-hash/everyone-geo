# M6B — Competitor Discovery 设计文档

> 里程碑：M6B（Competitor Discovery）
> 数据权威定义：`packages/geo-core/src/index.ts`（提取器）+ `apps/api/src/competitors/`
> 文档版本：v1（2026-09-06）

---

## 1. 背景与目标

M6A 冻结前，竞对是 A/B/C 占位、Share of Voice 一律 `competitor set pending M6B`。
M6B 用**真实 Evidence 语料**做「被提及品牌 → Competitor Candidate」的发现、人工评审与
版本化集合，闭环到 **SoV = 绑定显式 Competitor Set 版本的真实竞对声量**：

```
REAL Evidence → 确定性提取 → Candidate(DISCOVERED/UNKNOWN)
  → 人工 Approve(DIRECT/ADJACENT/SUBSTITUTE) → Competitor Set vN (DRAFT)
  → Activate(冻结) → m6b-competitors-v1 本地重分析 → SoV（显式绑定 Set 版本）
```

边界（硬性）：
- **只消费 REAL Evidence**：`sourceType ∈ {official_api, browser, third_party_api, manual}`
  且 `provider ≠ mock`（Evidence.provider 与 Run.engine.provider 均非 mock）。
  mock / demo / estimated 一律排除 —— 24 条 M6A Demo Benchmark Evidence 为 0 输入。
- **Mentioned Brand ≠ Competitor**：发现结果只能是 Candidate（status=DISCOVERED、
  competitorType=UNKNOWN）。DIRECT/ADJACENT/SUBSTITUTE **只能由人工 Approve 时显式选择**，
  系统永不把 UNKNOWN 自动推断为 DIRECT。
- **0 次 DeepSeek 请求**：M6B 全链路（发现 + 重分析 + SoV）均为本地确定性词法。
- **禁止改写历史**：Evidence 不可变（DB trigger）；m4-rule-v1 Analysis 永不删除；
  m6b 重分析只新增/替换 `m6b-competitors-v1` 行；A/B/C legacy 占位只保留、不再进入任何新分析。

## 2. 候选发现（确定性提取器，无概率）

`discoverCandidates(raw, opts, lexicon)`（@geo/core）为确定性规则，跨 Evidence 用
`lexicon` 累积身份；**不硬编码任何品牌**，也不输出「92% 竞对概率」类信号。

| 步骤 | 规则 | 说明 |
|------|------|------|
| 1 大写 token | `UPPER_TOKEN` 命中、去 URL 域内、去 <2 字母 | 起点候选（"ChatGPT" / "Bing"） |
| 2 lexicon/排除命中 | 对既有候选别名 + 自身品牌/占位名做大小写不敏感命中 | 小写变体（"chatgpt"）跨证据续命 |
| 3 相邻组装 | 仅空格/`-–—/·&+` 分隔或英文连接词（and/of/vs…）合并；≤6 token | "OpenAI ChatGPT"→一个 run；中文顿号/逗号**不**拼接 |
| 4 suffix 归并 | token 后缀相等即同身份（lexicon 长 key 为基） | "ChatGPT" ⊂ "OpenAI ChatGPT" → 同一候选 |
| 排除 | run 与排除名（自身品牌 + A/B/C 占位）整体命中重叠 → 整段丢弃 | 品牌 ≠ 竞对；占位 ≠ 竞对 |
| 停用词 | `DEFAULT_CANDIDATE_STOP_WORDS`（含 AI/API 等泛词） | 拒绝把泛化词当候选 |
| 推荐信号 | `judgeRecommendationSignal` 复用 m4 RuleJudge | 词法 cue，非概率 |

候选命名以 **extractor 最终词表**为准（跨 Evidence 归并结束后按变体出现次数取
canonical；同数取长名；再同按字典序）。实现注意：逐条 Evidence 处理期间归并状态会随
计数翻转（如 ChatGPT ↔ chatgpt），服务端聚合**不得**用逐条结果自建 canonical，必须回读
lexicon 最终组 —— 这是本里程碑修复过的一个真实缺陷。

## 3. 数据模型（版本化、可审计）

新增（`packages/database/prisma/schema.prisma`，迁移 `m6b_competitors`）：

| 模型 | 要点 |
|------|------|
| `CompetitorCandidate` | 项目级候选；normalizedName(分词 key)、aliases[]、status、competitorType、first/lastSeenAt、evidenceCount/queryCount/mentionCount/recommendationCount、metadata |
| `CompetitorCandidateEvidence` | 候选↔Evidence 链接（**非 Evidence 副本**）：candidateId + evidenceId + runId + queryText 快照 + mentionText + mentionPosition + occurrenceCount + recommended；`@@unique(candidateId, evidenceId)` |
| `CompetitorSet` | name+version 唯一；status DRAFT/ACTIVE/ARCHIVED；activatedAt |
| `CompetitorSetEntry` | 快照行：candidateId(普通 UUID，非 FK)、canonicalName、aliases、competitorType、sortOrder（**激活即冻结语义**） |
| `Analysis` 扩展 | `competitorSetId` / `competitorSetVersion`（非 FK 归档，索引） |

状态机：
```
DISCOVERED/UNKNOWN ──Approve(DIRECT|ADJACENT|SUBSTITUTE)──> APPROVED/type
        │                                                        │
        └────Reject──> REJECTED/NON_COMPETITOR（可再 Approve）    │
                                                                 ▼
              CompetitorSet DRAFT ──Activate──> ACTIVE（冻结；同 name 旧 ACTIVE 自动 ARCHIVED）
```

## 4. API

| 方法 | 路径 | 语义 |
|------|------|------|
| POST | `/projects/:projectId/competitor-discovery` | 幂等 refresh：DISCOVERED/APPROVED 重建计数；REJECTED 跳过；本轮 0 命中的 DISCOVERED 清理 |
| GET | `/projects/:projectId/competitor-candidates` | 候选列表（status/type/计数/示例 Evidence） |
| GET | `/competitor-candidates/:id` | 详情 + evidenceLinks（可回 Chain: Evidence→Run→rawResponse） |
| PATCH | `/competitor-candidates/:id` | Approve(需显式类型)/Reject/改名/aliases（重名 400） |
| GET/POST | `/projects/:projectId/competitor-sets` | 默认=全部 APPROVED 快照，或显式 entries |
| GET | `/competitor-sets/:id` | 含 entries 快照 |
| POST | `/competitor-sets/:id/activate` | ACTIVE 冻结 + 同 name 旧版本归档 |
| POST | `/projects/:projectId/competitor-reanalysis` | 要求 ACTIVE；本地 RuleJudge(m6b-competitors-v1)；幂等 |
| GET | `/projects/:projectId/competitor-sov` | `?competitorSetId=` 显式绑定；默认取最新 ACTIVE |

全部经 AuthGuard + 租户断言；SoV 未激活/未重分析一律 `pending`，不输出结论。

## 5. 版本不可变与 re-analysis

- ACTIVE 无修改端点：改内容 = 新建 vN+1（`name+version` 唯一即天然防同版本重造）。
  激活把同 name 旧 ACTIVE 自动 ARCHIVED（保留语义冻结，历史 Run/报告不受影响）。
- Re-analysis 只对 ACTIVE Set 开放：对每条 REAL Evidence 删除旧 `m6b-competitors-v1`
  行后重建（带 `competitorSetId/Version`），`m4-rule-v1` 与 Evidence 本身不动；
  同一 Set 重复跑 → skippedExisting 幂等。
- 不把旧 Analysis 解释为 v1：旧 m4-rule-v1 与 m6b-competitors-v1 在
  `analysisVersion` 上物理隔离，可同时存在。

## 6. Share of Voice（显式绑定版本）

`ready` 的前提 = 存在 **ACTIVE Set** 且该 Set 已跑 `m6b-competitors-v1`。
返回 `competitorSet {name, version, status}` + `analysisVersion=m6b-competitors-v1`，
口径 `real-evidence-only`；每个 entry 输出 mentionCount/evidenceCount/queryCount +
shareOfVoice（Σ=1）。未满足 → `pending`（`no-active-competitor-set` / `not-reanalyzed`），
并提示先人工评审 + 激活。UI 恒定展示 **「Small evidence base / discovery signal only」**。

## 7. 测试与验收

- @geo/core 单测：64/64（含 competitors 15：suffix 归并、URL/自身品牌/占位排除、
  大小写变体、中文不瞎猜、空/纯 URL/纯自身 → 0）。
- API e2e：6 套件 65/65（competitor 16 项：demo/mock/estimated 排除、24 Demo=0 输入、
  REAL 纳入、ProjectMentor 自排除、归一化与别名归并、linkage 回链、幂等 refresh、
  租户隔离、Approve/Reject/手工类型、v1 创建+激活冻结、语义快照、v2 归档、re-analysis
  幂等与 old/new 并存、competitorSetVersion 落库、SoV 显式绑定、401、A/B/C 不入新分析）。
- worker 24/24、queue 15/15、web tsc / database tsc / llm tsc 全绿（M3/M4/M5/M6A 回归）。

真机验收（本会话）：登录 → /app/competitors → Run Discovery（REAL only）→ 展开 Evidence
→ Approve/Reject + 类型 → 建 Set v1 → Activate → Re-analysis → SoV。全程 0 次 DeepSeek。

## 8. 诚实边界

当前真实 Evidence 是小样本（fixture/早期 demo 语料），M6B 的产出是
**「发现信号 + 人工可审的候选集合」**，不是稳定行业结论；不因样本小而自动 Approve。
成功标准 = 闭环正确（发现→评审→版本化→重分析→SoV 显式绑定），而非竞对数量。
