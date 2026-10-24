# GEO 指标与算法研究

**规则**：产品有公开公式才称为厂商公式（DOCUMENTED）；未公开处只提供“GeoLens 参考定义”，不声称是竞品真实算法。

## 指标定义比较

| 指标 | 业务含义 | 厂商公开定义/差异 | 输入数据与局限 | GeoLens 建议 |
|---|---|---|---|---|
| Brand Mention Rate / Coverage | 固定 prompt 运行中品牌被提及的频率 | Profound Visibility：提及品牌的回答 / 至少有任一品牌的回答，按模型先算再等权平均。Otterly Brand Coverage：提及品牌的 runs / eligible runs；Google AI Overview 未触发时排除。Scrunch mentions rate：提及品牌响应 / 全响应。口径不等价。 | 每条 execution 的品牌 entity resolution；品牌别名、拼写、语义误判会影响分子。Provider/地区/时间会变。 | 发布 GeoLens Coverage：品牌匹配响应数 / eligible response 数；分母类别明确，按模型和地区拆开，不把无响应当未提及。 |
| Share of Voice (SOV) | 品牌在竞品相关回答中占有的讨论份额 | Profound：自身 mentions / 所有 brands mentions；Otterly 类似。Scrunch 的 SOV fields 可能按 normalized entity slice；Ahrefs AI SOV 用 impressions share。直接 mentions share 与搜索量加权不是同一口径。 | 回答级 mentions share 偏向包含更多实体的回答；不同产品对同响应多品牌/重复提及处理不同。Ahrefs 的 impressions 是搜索量 proxy，不是 AI 答案次数。 | GeoLens 至少给 Response SOV 和 Mention SOV 两种清晰名称；默认 response-level 每个品牌一次，避免长回答/重复提及放大。 |
| Citation Rate / Coverage | 回答中是否有来源引用自有页面 | Otterly Domain Coverage：自有域被引用的 eligible runs / runs；Profound Citation Share：自有域 citations / all citations；Scrunch citation rate 和 citation SOV 区分 cited responses 与 citation-containing responses。 | Citation URL 需规范化域名、重定向/子域、来源类别；有的模型可能不给来源或只给 Search snippets。 | 双指标：Owned Citation Coverage = 含自有 URL 的回答数/eligible answers；Owned Citation Share = 自有 citation count/所有 citation count。 |
| Prompt Coverage | 关键词/意图问题库的覆盖程度 | 跨产品没有统一可确认定义；有些把 brand coverage 误用成 prompt coverage。 | Prompt 库代表用户设定，不代表全体真实查询分布；用户新增 prompt 会改变总体。 | 定义 tracked prompt set coverage：至少有 1 个成功 run 的 active prompts / active prompts；与品牌提及率分开。 |
| Average Position | 品牌在回答中的推荐/提及先后顺序 | Profound/Otterly 文档按品牌首次出现排序/位置平均；不等于 SERP rank。 | Position parser 需文本结构化；顺序对答案模板敏感，跨 Provider 可比性弱。 | 返回中位数和分位数，提供 rankable sample n；不把“靠前”叫 Google 排名。 |
| Competitor Ranking | 对比品牌与竞品回答中的出现顺序或份额 | 各产品都有竞品面板；公开聚合权重公式普遍不足。 | 品牌实体大小、别名和竞品集组成影响排名；每个回答可能提及多个品牌。 | 固定品牌集合、按同 prompt+model+region cohort 做 per-response 排序，再汇总分布。 |
| Sentiment | AI 对品牌/产品的表达倾向 | Profound 的 Positive claims / total brand claims；Otterly NSS=(positive-negative)/total；Scrunch 有 brand sentiment metrics。分类器与人工校验普遍未公开。 | sarcasm、比较句、引用第三方、局部 claim 极性易错；每品牌/产品/claim 粒度不同。 | 保留 claim span + label + classifier version/confidence；先不将整体 sentiment 当真值，支持抽样人工审核。 |
| AI Visibility Index / Impressions | 把 AI 答案出现映射为“可见度”或潜在曝光 | Ahrefs Impressions 把 prompts 映射到最高搜索量的相关关键词，SOV 按 impressions；这不是该 AI 服务真实 prompt 搜索次数。Otterly 有 visibility index 的位置/coverage 合成公式；具体单值 API 口径未完全公开。 | 代理关键词搜索量造成大词权重偏差；搜索量和模型答案频率并非同一变量。 | 单独命名为 Search Demand Proxy，不并入 answer-level coverage；披露映射方法/时间和误差限制。 |
| Multi-model aggregate | 形成跨平台总分 | Profound 对有品牌数据的模型比例等权平均；计数相加。其他产品具体权重多未公开。 | 等权能避免单一大流量平台主导，但小样本平台噪声更大；按运行量加权则规模大的平台主导。 | 同时提供 macro average（模型等权）和 pooled aggregate；显示每平台样本数，用户不能只看无解释的综合分。 |
| Outcome Attribution | 衡量优化后点击/转化变化 | 各产品有 impact/traffic/agent analytics 叙事；未发现可验证的 GEO 改动→收入因果定义。 | 需要 GSC、GA4、CRM、内容发布时间、control/seasonality；引用与转化不是同义。 | 第一阶段叫 before/after monitoring；只有有对照/实验时才标 incrementality/causal attribution。 |

## 采样设计与误差

AI 搜索回答不是稳定的静态数据库值。主要方差源：模型版本、provider UI/API、地区与语言、时间、账号/会话个性化、web search 状态、prompt 写法、来源索引刷新、回答随机性、平台变化、实体解析错误。

简单的回答级覆盖率可用：

    coverage = positive_brand_responses / eligible_successful_responses
    se ≈ sqrt(p * (1 - p) / n)

这是 GeoLens 的统计参考公式，不是任何竞品公式。它假设样本近似独立；重复每日同一 prompt 的运行往往相关，因此朴素标准误会低估波动。可将 prompt 作为 cluster，对同一 cohort 多次采样并按 prompt 聚类 bootstrap；样本不足时显示 n 与“方向性结果”，不做强结论。

建议分层：

1. 固定 prompt set、provider/model、locale、区域、执行环境和周期。
2. 将 no response / refusal / provider unavailable / AI Overview not triggered 分开存储。
3. 报告成功执行率与覆盖率，不因缺失 run 造成指标假升降。
4. 记录品牌/竞品实体 alias 集和解析版本。
5. 展示每个聚合指标定义、eligible denominator、样本数量和置信区间/波动范围。

## GeoLens 参考公式建议

### 1. Mention Coverage

对模型 m、地区 r、固定时间窗 t：

    MC(m,r,t) = 成功且可判定的回答中，至少出现自有品牌一次的回答数
                / 成功且可判定的回答数

若平台未触发（例如某类搜索 Overview 未显示）不进入 eligible denominator；若 Provider 请求失败也不进入分母，但要单独显示 provider availability。

### 2. Response SOV

    ResponseSOV(brand) = 包含该 brand 的回答数
                         / 包含比较集合中任意品牌的回答数

同一回答同一 brand 只计一次，避免重复 mentions 长文本放大。

### 3. Citation Coverage 与 Citation Share

    CitationCoverage = 含 owned-domain citation 的 eligible answers / eligible answers
    CitationShare = owned-domain citation entries / all citation entries

两个结果面向不同问题；必须分开展示。

### 4. Position

当回答中有明确品牌比较序列时记录首次提及的序号；否则 position 为 null。显示 median/mean 和样本 n，若答案中品牌未出现，不编码成低排名。

### 5. Cross-model aggregate

同时显示 macro mean（各有数据模型的 MC 算术平均）和 pooled MC（所有 eligible answers 合并计算）；不要把 Ahrefs 的搜索量加权指标直接与回答覆盖率混加。

## Optimization Suggestions 与 Retest

可解释建议的参考优先级，不是竞品公式：

    priority = evidence_strength × opportunity_size × actionability × freshness

其中 evidence_strength 可以使用观测次数、模型一致性和来源引用强度；必须展示各输入，避免黑箱分数。

操作前后应复用完全相同的 prompt cohort、模型/地区、周期间隔和采样策略。更换内容后重测仅可报告“观测到的前后变化”。只有随机/匹配对照或可靠差分设计才支持归因因果。

## 差异与结论

- **Profound** 公开的公式和 per-model averaging 规则最适合研究统计口径；用户也能点到回答级证据。
- **Otterly** 对 eligibility（尤其 AI Overviews 未触发）和覆盖指标拆分很值得学习；单一 Visibility API 字段仍有定义缺口。
- **Scrunch** 公开 API metric fields、mention rate/citation rate 和 normalize 说明有助于防止把 mention 与 cited 混为一谈。
- **Ahrefs** 用大规模 AI Index 与直接自定义 prompt 两种视角解决不同问题；Impressions 是估算需求 proxy。
- **Peec** 命名清楚但公式材料较少；**AthenaHQ** 强调 response credits 和 ACE 引擎，但外部无法独立验证；**AirOps** 更强于把 insight 接入内容 workflow，而不是完整披露 GEO 公式。

全部原始来源列在 [EVIDENCE_INDEX.md](EVIDENCE_INDEX.md)。
