# M8 — Real Optimization Pilot & Production Validation

> 版本：M8 软件实现（m8-site-pilot 数据模型 + geo-core measurement/url-safety/pilot 引擎 + Sites/ChangePlans/PilotReviews API + 中文 UI）
> 状态：随开发更新。本文件为 M8 设计与边界说明。

## 1. Purpose

M7 完成了可控复测闭环（Benchmark → Diagnosis → Recommendation → Content Opportunity → Experiment → Frozen Re-test → Evaluation）。
M8 的目标是在**一个真实项目、真实公开内容、真实模型环境中**验证“GeoLens 优化闭环能否形成可验证的真实试点”。

M8 不是继续堆 Dashboard/Provider/评分，而是把真实世界层补上：

```
Real Site Asset → Real Opportunity Mapping → Change Plan → Before Measurement
→ Human-approved Execution → Change Record → Valid Re-test → Observed Delta
→ Evidence A/B → Pilot Review → Learning
```

## 2. M7C vs M8B boundary（站点资产）

M7C 的 limitation：GeoLens 没有可靠 website inventory，因此“建议资产”≠“确认网站缺失页面”。
M8B 新增 `Site / SiteAsset / SiteAssetSnapshot / OpportunityAssetMapping`：

- `SiteAsset` 只登记**用户项目自己的站点**（同源白名单）；来源 MANUAL / SITEMAP / CRAWLER / IMPORTED。
- Opportunity→Asset 映射必须是 `UPDATE_EXISTING / CREATE_NEW / UNKNOWN` 且**人工确认**
  （`confirmedByUser=true`）；系统不因“没有匹配资产”就自动声称“必须新建页面”。
- `SiteAssetSnapshot` 只保存可审计的 title/text/hash（sha256），**绝不保存页面二进制**；禁止抓取登录后内容 / 第三方私有页。

## 3. Why api_plain is NOT web optimization validation（M8A）

当前 DeepSeek / Qwen Provider 均为 `sourceType=official_api, retrievalMode=api_plain`。
普通模型 API **不等价于** 模型产品 Web Search / Web Retrieval：

> “今天修改公开网页” 与 “今天 api_plain 输出变化” 之间不构成有效网页 GEO 实验结论。

GeoLens 判定只依据 `Evidence.retrievalMode / sourceType`（绝不按 provider 名称猜）：

| retrievalMode / sourceType | verdict | mode |
| --- | --- | --- |
| api_plain / official_api | INVALID_FOR_WEB_CHANGE | MODEL_BEHAVIOR_ONLY |
| manual_verified / manual（含 verifiedBy/verifiedAt/retrievalConfirmed） | VALID_FOR_WEB_CHANGE | MANUAL_VERIFIED |
| api_web_search / official_web_ui / browser_agent + retrievalConfirmed=true | VALID_FOR_WEB_CHANGE | WEB_VALIDATED |
| 同上但无 retrievalConfirmed provenance | PARTIALLY_VALID | WEB_VALIDATED |
| mock / estimated | INVALID_FOR_WEB_CHANGE（演示永不伪装真实） | UNKNOWN |
| unknown | UNKNOWN | UNKNOWN |

聚合规则保守优先：全 VALID ⇒ VALID；全 api_plain ⇒ INVALID；真实网页路径 + api_plain 混合 ⇒ PARTIALLY_VALID；含演示来源 ⇒ INVALID。

**Measurement guard**：实验被标记 `targetChangeType=WEB_CONTENT`（真实网页试点）时，若 After 测量
不是 VALID_FOR_WEB_CHANGE，Evaluation 自动降级 `INCONCLUSIVE` 并附 `INVALID_MEASUREMENT` warning ——
禁止把模型 API 行为变化当作“网页优化已验证”。

## 4. Manual Verified fallback

当前无自动 Web Retrieval Provider，M8 v1 的严谨 fallback 是 **manual_verified**：

- 用户从官方 AI Web UI 完成真实查询后，经 `SiteAssetSnapshot`（manual 通道）与 Experiment Execution
  人工记录查询结果与变更事实。
- sourceType=`manual` / retrievalMode=`manual_verified`，必须记录 `verifiedBy / verifiedAt / verificationNotes`
  与 `retrievalConfirmed`；无法证明联网 ⇒ retrievalMode=`unknown`（不强行标 manual_verified）。
- 人工快照同样是 Evidence-first：一旦写入历史不可修改；纠错用新的 replacement 记录，不 UPDATE 历史。
- 本轮不实现 Browser Agent（M8 的重点是真实试点，不是浏览器自动化项目）；如现有 browser
  infrastructure 可用再升级测量路径。

## 5. Site inventory（URL safety / SSRF）

站点读取 GET-only；同站点域名白名单（`Site.baseUrl` host）。geo-core `url-safety.ts` 纯函数负责判定：

- 只允许 http/https；拒绝 `file://`、`ftp://`
- 拒绝 loopback（localhost/127.0.0.1/::1）、private IPv4（10/172.16-31/192.168）、link-local
  （169.254、fe80::/10）、unique-local（fc00::/7）、云 metadata（169.254.169.254、metadata.google.internal）
- redirect 逐跳复查；DNS 解析后对每个地址做 `assertPublicIp` 复查（域名指向私网也拒绝）
- sitemap/页面抓取限制：max 500 URLs、3MB 响应、10s 超时、5 次重定向上限、并发低

## 6. Change Plan（编辑说明，不是正文、不自动发布）

`OptimizationChangePlan / OptimizationChangeItem`：

- 生成自 ContentOpportunity 的建议结构块（title/purpose → section/instruction/reason），回链
  source Recommendation（普通 uuid 归档，可继续回溯到 Diagnosis/Evidence）。
- 字段无 `finalPublishedText`；ChangeItem 是“在哪里放什么类型真实信息”的编辑说明。
- 状态仅人工推进：`DRAFT → APPROVED → EXECUTED_MANUALLY`（或 CANCELLED）。**不自动发布**。
- 禁止 SEO spam / 编造事实 / 伪造引用；内容必须真实、可验证、结构化。

## 7. Real Pilot lifecycle（M8C）

1. 从真实 M7C Opportunity 选 1 个（Evidence 足、Query cluster 清晰、工作量 LOW/MEDIUM、measurement path 有效）。
2. 绑定 SiteAsset 映射 → 生成/批准 Change Plan → 创建 Experiment（`targetChangeType=WEB_CONTENT`）。
3. Baseline freeze：report snapshot + query fingerprint + measurement validity 冻结在 Experiment。
4. 用户人工执行（GeoLens 不自动改站）→ 记录 Execution（时序 guard：Before ≤ executedAt < After）。
5. 抓取/人工录入 AFTER SiteAssetSnapshot；**hash 与 BEFORE 一致 ⇒ CHANGE_NOT_OBSERVED**（不假装已执行）。
6. Frozen Re-test（同基线 BenchmarkRunQuery 快照 + 同 Provider/模型/分析口径）。
7. Evaluation → Measurement guard → Pilot Review（snapshot 化）。

**Real Pilot 允许失败**：NO_CLEAR_CHANGE / NEGATIVE / INCONCLUSIVE 都是合法诚实结果。
成功 = 实验是真的、能审计、可追溯，而不是“必然上涨”。

## 8. Pilot Review（M8D）

`PilotReview`（reviewVersion=`geolens-pilot-review-v1`，生成即 immutable，多次生成幂等复用）：

- measurementValidity / executionValidity（CHANGE_VERIFIED / CHANGE_NOT_OBSERVED / NOT_RECORDED）
- comparisonValidity（M7D verdict 快照）
- observedOutcome：VALIDATED_OBSERVATION / MIXED_OBSERVATION / NO_CLEAR_OBSERVATION /
  NEGATIVE_OBSERVATION / INCONCLUSIVE / INVALID_MEASUREMENT / CHANGE_NOT_VERIFIED
- attributionConfidence：只有 LOW / MEDIUM（无 control group / repeat / stable measurement 之前不做 HIGH）
- lessons（PRODUCT/DIAGNOSIS/RECOMMENDATION/CONTENT_OPPORTUNITY/MEASUREMENT/UX/DATA/EXECUTION/ATTRIBUTION 分类）

**Observed Outcome ≠ proven causal effect**：模型版本、Provider 行为、训练数据、联网检索、竞品、
公开互联网内容都可能变化。M8 v1 不是随机对照因果实验（无 control group、无统计推断）。

## 9. Measurement provenance（保留 Evidence-first）

After Evidence 继续保留：Query / Engine / Model(requested/response) / Timestamp / RetrievalMode /
SourceType / RawResponse / Citations / Mention / Recommendation / Position。绝不复制 rawResponse 进 Review。
changedAssetCited v1 如实为 null（不猜测），留待 v2 做 citations 匹配。

## 10. Cost / Authorization guard

- Real Provider calls 必须有用户明确授权（本提示词不是无限授权）；授权数 = Before+After+retry 总预算。
- retry 算调用；每 Query 默认 1 attempt（maxRealAttempts）。
- Demo/Real 隔离：metricSource=demo 的实验只能产生演示 Review；real 机会才能绑 real 基线。
- Real Pilot 前置条件（全 TRUE 才自动执行）：REAL_PROVIDER_CALLS_APPROVED、call budget、
  measurementValidity 允许、opportunity/baseline 来自 REAL、site asset 确认、change plan APPROVED、
  （如需外改）EXTERNAL_SITE_WRITE_APPROVED 或用户已人工执行、（如需发布）PUBLICATION_APPROVED 或已完成。
- 任何授权缺失 ⇒ `REAL_PILOT_PENDING_USER_APPROVAL`；measurement 路径无效 ⇒ `REAL_PILOT_BLOCKED_BY_MEASUREMENT`。

## 11. Demo/Real isolation

- Demo（mock）：`Site → Asset → Mapping → ChangePlan → Experiment → Measurement Validity → Before Snapshot
  → Execution → After Snapshot → Mock Re-test → Pilot Review` 全链 0 real calls；UI 恒显“演示试点”。
- Demo evidence（sourceType=mock）经 measurement guard 自动判 INVALID_FOR_WEB_CHANGE ⇒ 不伪装真实 Pilot。

## 12. Attribution limitations（必须展示）

复测观察到的变化不能单独归因本次优化。实验详情显著展示归因说明；
技术页注明 “Observed change ≠ proven causal effect”。

## 13. Preference dataset foundation（不训练）

M8 完成后 schema 已能形成：Query → Before Evidence → Diagnosis → Recommendation → Content Opportunity
→ Site Asset → Change Plan → Execution → After Evidence → Metric/Query Delta → Pilot Review。
这将是未来 GEO Preference Dataset 的重要原始来源；**本轮不训练模型、不导出数据集**。

## 14. Known limitations

- api_plain 不能验证公开网页变化；无自动 Web Retrieval path（manual_verified 是 v1 fallback）
- 无 website crawler：本轮 inventory 以 manual + sitemap 为主（sitemap 依赖站点公开 robots/sitemap.xml）
- Manual execution 记录是用户确认，GeoLens 不自动修改/验证外部页面
- attribution confidence 仅 LOW/MEDIUM；单次 Before/After 不代表长期稳定效果
- Review lessons 是确定性模板 + 有限规则，不是 LLM 总结
- changedAssetCited / retrievalObservedForChangedAsset v1 从 hash 对照推导，不做 citations 深层匹配

## 15. Real pilot result

随授权/执行情况更新：
- REAL_OPTIMIZATION_EXPERIMENT = NOT_RUN（截至本实现；REAL_PILOT_PENDING_USER_APPROVAL /
  BLOCKED_BY_MEASUREMENT 视授权与测量路径而定）
- Real AI Calls during implementation = 0
