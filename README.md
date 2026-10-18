# GeoLens Mini

中文 GEO MVP：品牌输入 → 监测问题 → 模型回答 → 证据报告 → 优化建议 → 多渠道内容草稿 → 浏览器准备填写 → 人工审核。

五个主页面已可运行，Mock 全流程验收通过。报告由存储的回答实时计算；本次验收回答均为 **模拟数据/未真实验证**。DeepSeek、Qwen/DashScope、通用 OpenAI-compatible 已实现，**真实模型 API 验证为 0 次**。真实平台均未登录验收，未执行公开发布或 Git push。

## 安装与启动

需要 Node **24.x**，SQLite 使用内置 `node:sqlite`，无需额外数据库服务。

```bash
export PATH=$HOME/.local/node24/bin:$PATH
npm ci --cache /tmp/geolens-npm-cache
npm run db:init
PLAYWRIGHT_BROWSERS_PATH=$PWD/data/browsers npx playwright install chromium
npm run dev
# http://localhost:3100
```

系统缺少浏览器运行库时可使用 Playwright 的 `install-deps chromium`（需要系统管理权限）。浏览器执行器优先使用 `data/browsers` 下的 Chromium。端口固定 **3100**；不要关闭或占用现有 3000/3001 服务。

生产模式：先停止本项目 dev，再运行 `npm run build && npm start`。不要让 dev 与 start 同时占用 3100。

`npm run db:init` 按 `scripts/schema.sql` 幂等初始化 `data/geolens.db`；API 首次访问也会初始化。发布账号与任务表由 `scripts/publisher/store.mjs` 首次使用时创建。数据库、`uploads/` 和 `data/profiles/` 为本地持久数据，不进入 Git。备份时停止本项目和执行器，整体保存这些目录；Profile 包含敏感登录态，不应分享。

## API Key 配置

顶部「模型设置」选择 Provider，填写 Base URL、Model、API Key，保存后主动点击「测试连接」。真实连接测试、生成问题、检测、建议和内容生成均需用户确认潜在费用。默认显式使用 Mock，不自动切换到付费模型。

| Provider               | Base URL                                            | 默认 Model      | 实际验证                        |
| ---------------------- | --------------------------------------------------- | --------------- | ------------------------------- |
| DeepSeek               | `https://api.deepseek.com`                          | `deepseek-chat` | 未验证，无 Key                  |
| Qwen / DashScope       | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus`     | 未验证，无 Key                  |
| 通用 OpenAI-compatible | 用户可信 HTTPS 地址，可含 `/v1`                     | 用户填写        | 未验证，无 Key                  |
| MockTransport          | 本地，无网络调用                                    | Mock            | 全流程通过；模拟数据/未真实验证 |

适配器追加 `/chat/completions`，不跟随重定向，拒绝明文 HTTP、URL 内凭据和查询参数。支持 temperature、top_p、max_tokens、presence_penalty、frequency_penalty、seed。每请求输出最多 2,400 Token，45 秒超时，无自动重试。生成问题/建议/单份内容/测试连接各一次请求，N 道检测问题为 N 次请求；费用未知时存 NULL。

Key 仅保存到服务端进程内存，24 小时过期，不进入 SQLite、Git、日志或 localStorage，不回传客户端；保存后清空输入框。重启后 Provider 配置恢复 Mock。HttpOnly、SameSite=Strict Cookie 标识本地会话，生产开启 Secure。Cookie 有效时可继续访问持久数据，Cookie 丢失/过期后 UI 无找回机制。

## 产品使用

1. 首页只输入品牌名即可建任务；确认可编辑的行业推断（未经核实），生成 8–12 个监测问题，可编辑、删除和保存。
2. 确认 Provider 和调用数量，执行检测。保留问题、原始回答、Provider、响应模型、prompt 版本、时间、Token、延迟、引用和 `is_mock`。中断检测保留证据并标为失败，不自动重试付费请求。
3. 报告显示本次样本提及率，DISCOVERY 与 BRANDED 分开计算；建议关联实际问题和回答 ID。
4. 内容中心支持 SEO/GEO、小红书、抖音、B站、视频号、快手、微博、公众号、知乎、今日头条/百家号十种渠道内容。标题、正文、标签、封面/配图建议、脚本和分镜均可编辑保存。重新生成创建新稿，保留原始生成证据。
5. 内容卡片有明确标注的 CC0 演示图片/视频（许可见 `public/demo/LICENSE.txt`），支持上传真实 PNG/JPEG/WebP/MP4（每文件 25MB）。视频脚本不会自动生成成片，演示素材不会自动进入发布任务。

## 浏览器执行器

在「内容发布」选择草稿 → 添加平台本地账号 → 勾选平台 → 选择目标账号、类型及用户素材 → 编辑适配内容 →「保存独立平台任务」→「检查登录」或「开始自动填写」。API 启动独立 Node Playwright 进程，任务和每个平台独立记录。每个账号 Profile 位于 `data/profiles/<platform>/<随机账号ID>`，不索取密码或聊天 Cookie。

有可交互 DISPLAY 时，浏览器可等待官方登录 5 分钟，填写后保留 15 分钟供云桌面审核；能否从用户端实际接管仍待用户验证。没有 DISPLAY 或登录态时返回 `NEEDS_LOGIN`，可在本机有桌面环境运行同一仓库，或下载人工发布 ZIP 包。账号 Profile 同时只允许一个执行器，关闭其浏览器后再重试。独立执行器入口：

```bash
# 通常由发布页面自动启动；调试时仅对本地已有且空闲的任务执行
node scripts/publisher/runner.mjs <jobId> check
node scripts/publisher/runner.mjs <jobId> fill
```

唯一执行模式为 **PREPARE_ONLY**，不会点击最终发布。成功上传、填写并回读后为 `FILLED_AWAITING_REVIEW`；不等于公开发布。封面、分类、原创/AI 声明和部分标签需要人工确认。重启后 Profile、任务和回读记录保留，死进程恢复为失败供手动重试，不自动重新上传。每个任务支持导出包含正文、manifest 和所选媒体的 ZIP 人工包。

WordPress 走 REST API，只创建 `status=draft` 的文章；站点、用户名、应用密码仅本次后端请求使用，不持久化应用密码。媒体、分类需在后台人工设置。用户手动发布后，可明确确认并回填真实 URL，记录 `USER_PROVIDED_URL`；服务端未独立核验公开链接。测试平台禁止登记真实发布结果。

| 平台               | 本版接入类型     | 执行方式                     | 真实平台验证状态                         |
| ------------------ | ---------------- | ---------------------------- | ---------------------------------------- |
| 小红书             | 图文             | Playwright 准备填写          | 未验证-待用户登录                        |
| 抖音               | 视频             | Playwright 准备填写          | 未验证-待用户登录                        |
| B站                | 视频             | Playwright 准备填写          | 未验证-待用户登录                        |
| 微信视频号         | 视频             | Playwright 准备填写          | 未验证-待用户登录                        |
| 快手               | 视频             | Playwright 准备填写          | 未验证-待用户登录                        |
| 微博               | 图文、文章       | Playwright 准备填写          | 未验证-待用户登录                        |
| 微信公众号         | 文章             | Playwright；需人工进入编辑器 | 未验证-待用户登录                        |
| 知乎               | 文章             | Playwright 准备填写          | 未验证-待用户登录                        |
| 今日头条           | 文章             | Playwright 准备填写          | 未验证-待用户登录                        |
| 百家号             | 文章             | Playwright 准备填写          | 未验证-待用户登录                        |
| WordPress          | 文章             | REST 草稿，无浏览器执行器    | 未验证-待用户登录（另需应用密码授权）    |
| 本地 test-platform | 图文、文章、视频 | Playwright 测试页面          | 本地图片上传、填写、回读通过，非真实平台 |

选择器移植与许可见 `NOTICE`，原版 GeoLens 仓库只读参考，未修改。没有任何真实平台完成已登录媒体上传验收；规格十五 H 仍待授权账号验证。

## 验证与截图

```bash
npm test                  # 16 项：指标、Gateway、内容、浏览器上传/回读/恢复
npm run build             # 生产构建和 TypeScript
npm start                 # 另一个终端，3100
npm run test:e2e           # 完整 Mock UI → API → 独立执行器闭环
npm run screenshots       # 同一闭环重新生成五页桌面/移动截图
npm run test:cloud         # DISPLAY/有界面、隔离 Profile 重开、文件字节和任务恢复
npm run test:publish       # 发布 API、ZIP、禁止测试任务登记发布、跨会话隔离
```

`test:browser` 是 `test:e2e` 的兼容入口。E2E 默认使用 `/opt/google/chrome/chrome`，可通过 `CHROME_PATH` 指定。执行器/云验证使用安装的 Playwright Chromium。测试会新增本地 Mock 数据，不调用真实模型或访问真实发布平台。E2E 浏览器拦截非 localhost 请求，检查页面异常、console.error、五页移动端横向溢出；覆盖三类内容生成/编辑持久化及十渠道生成，PNG/MP4 上传与非法文件拒绝、媒体范围请求和会话隔离。最终断言 `PREPARE_ONLY`、`FILLED_AWAITING_REVIEW`、未点击提交且无发布链接。

截图在 [`screenshots/`](screenshots/)：`home`、`run`、`report`、`content`、`publish` 的 `-desktop.png` / `-mobile.png`，另有 `cloud-headed.png`。云环境逐项结论见 [CLOUD_VERIFICATION](docs/CLOUD_VERIFICATION.md)，机器结果见 [JSON](docs/cloud-verification.json)。

## 限制与继续开发

- 报告按已成功保存的回答计算，未完成请求不算未提及；名称匹配采用 NFKC、英文词边界，位置是字符偏移而非推荐排名。普通 API `web_search=false`，不是实时搜索或全网可见度，未返回的引用不会虚构。
- Mock 标记同时保留在 UI 和 DB；使用 Mock 证据生成内容也标记输入未真实验证。下一步由用户提供授权后逐项验收真实 Provider 与已登录平台；不自动产生费用或公开发布。
- 本地单进程 MVP，没有生产账号系统、租户认证、队列或多实例共享凭据。会话和 Profile 隔离通过本地验证，不代表可直接开放公网多租户服务。
- 官网只是用户输入上下文，暂不自动抓取；没有别名识别、情感分析、事实核验和真实优化效果证明。
- 平台 DOM 会变化，封面、分类、声明及公众号动态编辑器仍需授权实测；WordPress 媒体上传未实现。

核心代码：`src/lib/gateway.ts`、`metrics.ts`、`content.ts`，`src/app/api/`，`src/components/`，`scripts/publisher/`。数据库结构在 `scripts/schema.sql`。开发修改 Next.js 前先读 `node_modules/next/dist/docs/`。

本地 Git 历史在标准 `.git` 中，直接 `git log` / `git commit` 即可（未配置远端，勿 push）。

未 push；最终提交号见 `git log -1 --oneline`。
