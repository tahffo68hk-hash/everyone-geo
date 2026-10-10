# GeoLens 逆向成果收敛、功能验收与交接记录 (HANDOFF.md)

- **交接日期**: 2026-10-11
- **当前 Git HEAD**: `e731f92` (基线: `a7f210a`)
- **Git 状态**: 本地已提交 (Local Commits Only, **STRICTLY NO PUSH**)

---

## 一、真实 REA 证据与竞品逆向核实结论

依据已有分析文件、脚本运行输出与本地实际拉取工程对上一轮逆向声明进行严格核验：

| 目标名称 / 声明项 | 原始声明内容 | 证据等级 | 真实核实证据与结论说明 |
| :--- | :--- | :---: | :--- |
| **`geo.b7u.cn`** | 20 个后台页面与功能结构 | **VERIFIED** | 实际存在 `scratch/crawled_pages.json`（274KB，20 个页面 HTML）与 `inspected_pages_data.json`。经核对包含 AI 诊断 V1/V2、自动品牌解析 (`/user/analyze_v2/pingpai_jiexi`)、拓词收录 (`/user/shoulu_tuozhan/`)。后端算法为闭源 PHP 服务端渲染，未取得其内部核心权重算法。 |
| **`geo.zhuxiaotui.cn`** | 52 条路由、21 个 API 端点 | **VERIFIED** | 通过 REA `analyze_web_bundle` 工具反编译提取自前端 Webpack/Vite Bundle AST。实际包含 `/h5/geo-brand-diagnosis` 移动端诊断报告、大屏展示、RPA 下载等路由，证明其商业模式高度依赖移动端免登诊断分享获客。后端接口源码未泄露。 |
| **飞书两大 SOP** | 全流程 GEO 落地手册 | **DOCUMENTED** | 来源于公开飞书 Wiki 页面抓取（`scratch/full_geo_sop.txt`、`scratch/full_user_sop.txt`），包含规范的 Discovery 提问非污染原则、8 大主流模型对比矩阵及 Answer-First 官网结构化改造指南。 |
| **Gitee `geosystem`** | Java Spring Boot 商业源码 | **VERIFIED** | 已通过 `git clone` 拉取至 `scratch/geosystem_repo`。实测代码证实其为开源引流工程，`cxlaike-module-cxlaike-biz` 核心业务逻辑故意留空，README 引导微信付费购买商业代码。 |
| **刀客源码网** | FastAdmin GEO 优化系统 | **DOCUMENTED / INFERRED** | 已提取 `skpan.cn` 44.95MB `GEO优化系统源码.zip` 页面与技术说明。对比页面截图与 FastAdmin 架构，推断其与 `geo.b7u.cn` 线上实例为同源商业程序。 |

---

## 二、三项核心功能验收与交付状态

### 1. 国产模型适配 (`packages/llm`) — 【部分完成 / 分级收敛】
明确区分四个层级，不为了凑齐八个引擎提供虚假支持状态：
- **A. 已实现并经过全面测试**: `mock`, `deepseek`, `qwen`。
- **B. 已实现标准适配并具备优雅回退，但未配置真实收费 Key 实测**: `doubao` (火山引擎), `kimi` (月之暗面), `zhipu` (智谱 GLM)。在 InteractiveRuntime 中实现了 OpenAI-compatible 端点及环境变量回退；当未配置 Key 时统一抛出 `ProviderNotConfiguredError`。
- **C. 仅预留配置、需专用鉴权 SDK 接入**: `yuanbao` (腾讯混元), `baidu` (文心千帆)。因需要特殊签名算法或非标鉴权，目前作为预留配置，调用时抛出未配置异常，不在未经测试下假装可用。
- **D. 消费者搜索产品监测属性**: 竞品宣传的“元宝、豆包、千问”在实际业务中主要指客户端/RPA 消费者 AI 搜索端收录检测，而非纯企业大模型文本生成。

### 2. AI 品牌全景智能解析 (`BRAND_RESOLUTION`) — 【已验证可用】
- **实现范围**: Prompt Registry (`brand-resolution-v1`)、DTO (`ResolveBrandDto`)、Schema 合约校验 (`CAPABILITY_SCHEMAS.brand_resolution`)、Mock 离线确定性 Fixture、NestJS Gateway 与 Controller 路由 (`POST /projects/:id/ai/resolve-brand`)。
- **业务边界**: 前端 `/app/target` 中明确标注为 AI 推荐候选；用户输入品牌名触发解析后，只填充候选字段，用户必须主动确认保存 (`PUT /projects/:id/target-profile`) 才会写入真实监测对象；候选别名提供一键采纳交互；Discovery Queries 严格遵循非品牌词污染规则。

### 3. 移动端 H5 分享报告安全机制 — 【已验证可用 / 安全加固】
- **关键漏洞修复**: 杜绝了任何外部匿名用户直接凭借猜测的内部 Report UUID 遍历读取私有租户报告或原始证据的安全漏洞。
- **最小可行安全方案**:
  - **授权创建**: 必须由项目租户成员通过 `POST /reports/:id/share` 主动生成 48 位强随机不可猜测的 `shareToken`。
  - **公开白名单投影**: `GET /public/reports/:shareToken` 仅暴露报告聚合得分、雷达图与已脱敏指标快照 (`metricsSnapshot`)，绝不泄露内部租户 ID、组织 ID、数据库连接或原始敏感 Evidence 记录。
  - **即时撤销机制**: 租户可通过 `POST /reports/:id/revoke-share` 一键撤销分享，撤销后公开链接立刻返回 404。
  - **前端协同**: 在 `/app/reports/[id]` 内部报告详情页提供「复制安全链接」、「📱 预览 H5」与「撤销分享」按钮；在 `/share/report/[token]` 提供适配移动端与微信环境的公开诊断页面。

### 4. 增量支持：短视频脚本生成 AI (`video_script`) — 【已验证可用】
- 针对用户对于自媒体辅助能力的扩展需求，在 AI 领域服务中扩展了短视频脚本生成能力（`GenerateVideoScriptDto`, `video-script-v1`, `POST /projects/:id/ai/video-script`），支持视频号、抖音、小红书的 3 秒黄金悬念 Hook、分镜口播与 CTA 转化脚本生成，与现有 `content-execution` 多渠道分发架构保持无缝协同。

---

## 三、测试与构建验证结果

1. **`@geo/llm` 单元测试**:
   - `node --test packages/llm/test/*.test.ts` -> **55/55 passed (100%)**
2. **`@geolens/api` 端到端与安全测试**:
   - `jest test/reports.e2e-spec.ts` -> **18/18 passed (包含新增公开分享令牌、白名单字段与撤销 404 验证)**
   - `jest test/ai-gateway.e2e-spec.ts` -> **4/4 passed**
   - `jest test/schema-validator.e2e-spec.ts` -> **5/5 passed**
3. **全栈生产构建**:
   - `nest build` -> **成功，0 错误**
   - `next build` -> **成功，全站 25 个静态与动态页面编译完成，0 报错**

---

## 四、本地 Commit 记录 (NO PUSH)

```
083a1dd feat(llm): adapt domestic model configs and execution fallbacks
d5a6294 feat(ai): add brand auto-resolution with schema validation and video script generation
e731f92 feat(reports): secure h5 report sharing with cryptographic tokens and field whitelisting
```

---

## 五、下一条可执行任务 (Next Steps)

1. **真实模型联调准备 (可选)**: 如需将 `doubao` 或 `kimi` 升级为 A 级已测状态，在预发环境提供真实 API Key 并编写集成测试。
2. **RPA / 消费者 AI 搜索端收录采集**: 竞品针对元宝与文心一言的监测采用的是模拟客户端/网页端查询，若需要对齐此项能力，需评估部署轻量级无头浏览器抓取 Worker。
3. **保护未提交的并行分支任务**: 工作区中保留的其他 Agent 修改（`retest-orchestration` 相关文件及 `loc002-loc003-trust.e2e-spec.ts`）请勿覆盖，继续由对应负责人推进。
