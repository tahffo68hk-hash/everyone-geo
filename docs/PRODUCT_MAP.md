---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 15ce975b5f313de8edfa891b974a2219_e923ef7aa8c311f1be88525400aeaaa3
    ReservedCode1: ONO9cH+W6eon8Ia/RUKZ2JptYfySW5N7WbQt8JmvzLqePEnOqehvCPc4a9vggNp4vqzJv1CK+KLG+p6dgukbwhumhii/YiHdFb87hmLgyXf4HxPNLEhCoUb8FcCn5JeUuEB03Vh1zfoMBW70K6U2R06isi+oZ47n74cmbFaOt/i7gHYu3fXJyGHrwKU=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 15ce975b5f313de8edfa891b974a2219_e923ef7aa8c311f1be88525400aeaaa3
    ReservedCode2: ONO9cH+W6eon8Ia/RUKZ2JptYfySW5N7WbQt8JmvzLqePEnOqehvCPc4a9vggNp4vqzJv1CK+KLG+p6dgukbwhumhii/YiHdFb87hmLgyXf4HxPNLEhCoUb8FcCn5JeUuEB03Vh1zfoMBW70K6U2R06isi+oZ47n74cmbFaOt/i7gHYu3fXJyGHrwKU=
---

# GeoLens 产品地图（第一版）

> 依据对 GEO 商业系统（中网智达、geo.b7u.cn 等在线 SaaS）与开源项目（Gego、GEORank、OneGlanse、E-GEO、geolook 等）的功能调研整理。
> 用途：界定"哪些功能竞品都有（市场已验证）"，并明确我们 V0.1 的实现边界。

## 1. GEO 市场已验证功能全景（调研来源）

| 模块 | 商业系统出现 | 开源出现 | 说明 |
|---|---|---|---|
| AI 可见度诊断 | ✓ | ✓ | 核心价值点 |
| 诊断报告 | ✓ | ✓ | 报告化输出 |
| AI 查询 | ✓ | ✓ | 交互查询面板 |
| 关键词管理 | ✓ | ✓ | 上游需求入口 |
| 关键词指数 | ✓ | 部分 | 依赖词频/BrandData 类数据源 |
| 关键词拓展 | ✓ | 部分 | LLM 生成扩展词 |
| 品牌扫描 | ✓ | ✓ | 批量扫描 |
| 竞品分析 | ✓ | 部分 | Mention/Position 对比 |
| AI 写作 | ✓ | 部分 | 内容侧能力 |
| 提示词管理 | ✓ | 部分 | PromptTemplate |
| 爆文复刻 | ✓ | ✗ | 内容工厂型功能 |
| 知识库 | ✓ | 部分 | RAG 基础 |
| AI 官网 SEO | ✓ | ✗ | 站外 SEO |
| 网站媒体发布 | ✓ | ✗ | 发布渠道（4W+ 官媒等） |
| B2B 发布 | ✓ | ✗ | 商务资源型 |
| 自媒体发布/大V | ✓ | ✗ | 渠道采购型 |
| 地图发布 | ✓ | ✗ | 本地商家 GEO |
| 数据报表/分享 | ✓ | 部分 | 报表链路 |
| 账号权益/余额/消耗 | ✓ | 部分 | 商业化计费 |
| 实名认证 | ✓ | ✗ | 合规（渠道相关） |
| 任务队列 | ✓ | 部分 | 批量处理底座 |

## 2. V0.1 实现边界（明确取舍）

**V0.1 只做"企业 GEO 监测闭环"六步：**

```
项目/品牌创建 → Query 生成与选择 → 多 AI 监测 → Evidence 保存 → 分析与指标 → Dashboard/Reports
```

**V0.1 页面（6~7 个）：**

1. 登录
2. Dashboard（项目/Query/监测次数 + AI Visibility / SoV / Recommendation / Citation + 趋势）
3. Projects / Brands（项目、品牌、官网、行业、目标用户、产品、地区、竞争对手）
4. Queries（AI 生成 / 手动添加 / 分类：品牌词、行业词、推荐词、对比词、购买意图、问题解决、地域词）
5. AI Visibility（Query × Engine 矩阵，点开 Evidence Drawer 展示完整原始证据）
6. Insights（SoV、竞对排名、Citation Domains/Gap、Query Gap、Content Gap、Recommendation Gap）
7. Reports（品牌 GEO 报告，先页面展示，PDF/分享后续）

**V0.1 明确不做（一期排除）：**

数字人、AI 视频、短视频、地图标记、媒体采购、大V采购、B2B 商务资源、实名认证、
复杂会员、支付/微信/支付宝、短信、公众号、代理商、三级分销。

## 3. 核心产品差异化：Evidence 数据设计

竞品普遍只存 `included=true/false`。我们要求每个指标可追溯：

- Query / Engine / Provider / Model / Model Version / Timestamp
- Raw Prompt / Raw Response / Citations
- Mention / Position / Recommendation / Sentiment / Retrieval Mode / Source Type

未来 Preference Lab 将在此数据底座上进行实验（Experiment / PreferencePair / Run）。

## 4. 产品名

- 开发代号：GeoLens
- 展示名：GeoLens — AI Visibility Intelligence
- 不复制任何竞品 Logo / 品牌 / 图片 / 配色 / 布局 / 文案。

## 5. License 合规基线

研究开源项目时必记录：解决问题、可参考模块、License（尤其 GPL/AGPL 仅研究架构不复制代码；Apache-2.0/MIT 可按条款使用）。
目标：Clean-room implementation。

## 6. V0.1 验收标准（文档 §19）

- 创建品牌 ProjectMentor，竞对 A/B/C，生成 10 个 Query，选 3 个 AI Engine。
- 运行监测，数据库产出 30 条独立 Run/Response。
- 分析 Mention/Rank/Recommendation/Citation。
- Dashboard 展示 Share of Voice，点任意数据可看到完整 Raw Response Evidence。
*（内容由AI生成，仅供参考）*
