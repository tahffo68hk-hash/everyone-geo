# GeoLens 逆向成果收敛、功能验收与交接记录 (HANDOFF.md)

- **交接日期**: 2026-10-11
- **当前 Git HEAD**: `b9399fb` (基线: `a7f210a`)
- **Git 状态**: 本地已全部提交，工作区干净 (Local Commits Only, **STRICTLY NO PUSH**)

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

## 二、核心功能验收与交付状态

### 1. 国产模型适配 (`packages/llm`) — 【已验证 / 分级收敛】
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

### 4. 短视频脚本生成 AI (`video_script`) — 【已验证可用】
- 针对用户对于自媒体辅助能力的扩展需求，在 AI 领域服务中扩展了短视频脚本生成能力（`GenerateVideoScriptDto`, `video-script-v1`, `POST /projects/:id/ai/video-script`），支持视频号、抖音、小红书的 3 秒黄金悬念 Hook、分镜口播与 CTA 转化脚本生成，与现有 `content-execution` 多渠道分发架构保持无缝协同。

### 5. LOC-002: 真实发布时间与资产身份核验 — 【已验证交付】
- **真实时间确权**: 在资产登记中严格落地 `actualPublishedAt`，当外部渠道尚未返回真实发布时间时，显式保持为 `null`，严禁用当前系统时间（`now`）伪造已发布状态。
- **防伪造与边界防护**: 拒绝未来时间、无时区非法时间；严格拦截跨项目计划注入与内容版本错配；未接入官方开放平台授权凭证时拦截伪造 `PLATFORM_CONFIRMED`。
- **重复登记幂等性**: 对相同外部 URL / 资产 ID 的重复登记操作提供幂等保护。

### 6. LOC-003: Retest 执行幂等、并发防护与 Evidence 历史保护 — 【已验证交付】
- **终态幂等**: 对已处于 `COMPLETED` 状态的 Retest 任务，重放调用零副作用，不产生冗余 MonitorTask。
- **原子并发锁**: 采用乐观原子更新机制防护多客户端/进程并发触发重测。
- **成功 Evidence 保护与增量重试**: 当重测任务部分失败并重新触发时，严格保留已有成功的 `evidenceId` 和 `runId`，绝不覆写历史有效证据；仅对尚未成功的条目进行增量调度。
- **Web 端协同**: Outcome Workspace 中 `retest-progress-panel` 与 `retest-run-selector` 完整呈现执行进度、部分失败提示及历史运行切换。

---

## 三、测试与构建验证结果

1. **`@geo/llm` 单元测试**:
   - `node --test packages/llm/test/*.test.ts` -> **55/55 passed (100%)**
2. **`@geolens/api` 单元与 E2E 测试**:
   - `jest test/reports.e2e-spec.ts` -> **18/18 passed (包含新增公开分享令牌、白名单字段与撤销 404 验证)**
   - `jest test/ai-gateway.e2e-spec.ts` -> **4/4 passed**
   - `jest test/schema-validator.e2e-spec.ts` -> **5/5 passed**
   - `jest test/ai-brand-resolution.e2e-spec.ts` -> **6/6 passed (AI 解析、Discovery 词非污染、候选隔离与短视频脚本)**
   - `jest test/loc002-loc003-trust.e2e-spec.ts` -> **11/11 passed (LOC-002 真实资产身份与 LOC-003 执行幂等)**
3. **全栈生产构建**:
   - `pnpm build:api` (`nest build`) -> **成功，0 错误**
   - `pnpm build:web` (`next build`) -> **成功，全站 25 个静态与动态页面编译完成，0 报错**

---

## 四、本地 Commit 记录 (NO PUSH)

```
b9399fb feat(retest): complete LOC-002 real published assets and LOC-003 retest execution idempotency
1517fa6 test(ai): add e2e test suite for brand resolution, discovery query integrity and video script
1c09d6a docs: add handoff document for rea technical verification and acceptance
e731f92 feat(reports): secure h5 report sharing with cryptographic tokens and field whitelisting
d5a6294 feat(ai): add brand auto-resolution with schema validation and video script generation
083a1dd feat(llm): adapt domestic model configs and execution fallbacks
a7f210a feat(web,docs): integrate WEB-004, WEB-007, WEB-008, WEB-013 within safety boundaries
```

---

## 五、当前系统状态与后续建议 (Next Steps)

1. **Git 仓库状态**: 所有新功能与 LOC-002/003 均已完成本地 Commit，工作区干净，严格遵守 **NO PUSH** 规则。
2. **生产部署准备**: 前后端构建产物已完整生成（Next.js 15 生产优化产物与 NestJS dist 包）。
3. **真实模型密钥上线 (可选)**: 如需将 `doubao` 或 `kimi` 升级为 A 级已测状态，在生产/预发环境变量中配置对应 API Key 即可，代码适配与兜底均已就绪。
