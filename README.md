# GeoLens Mini

轻量中文 GEO 检测工作台。当前交付工作包 1–3（规格阶段 1–3），不是全部 MVP。

## 启动

```bash
export PATH=$HOME/.local/node24/bin:$PATH
npm ci --cache /tmp/geolens-npm-cache
npm run db:init
npm run dev
# http://localhost:3100
```

生产构建本地验证：`npm run build && npm start`（同样使用 3100）。需要 Node **24**，使用内置 `node:sqlite`；无需数据库服务。不要同时启动 dev 和 start。端口 3000/3001 不受影响。

## 已完成

- 五个页面：首页、检测、报告、内容中心、发布工作台占位；桌面与移动端布局。
- 品牌为唯一必填项，其他七个字段折叠；可编辑的类别推断（标注未核实，不抓取官网）。
- 服务端会话设置：Mock、DeepSeek、Qwen/DashScope、通用 OpenAI-compatible；Base URL、Key、Model、数值额外参数和连接测试。
- 版本化 AI 问题生成，默认 10 题，支持 8–12 题生成结果，区分 DISCOVERY/BRANDED、意图；支持编辑、删除、重新生成及保存。允许用户删到 1 题。
- 逐题执行、SQLite 持久化和进度轮询；完成后冻结问题，失败保留已成功回答，重启将中断任务标记失败。
- 原始回答、Query、Provider、响应模型、prompt_version、时间、字符位置、配置竞品、供应商返回引用、Token、延迟、费用、is_mock、web_search。
- 报告实时计算「本次检测提及率」，分开显示自然发现与品牌认知；竞品计数、证据表、规则生成的优势/缺口/优先主题与测量局限。
- SQLite 完整预留 projects、brands、query_sets、runs、responses、reports、contents、media、publish_tasks、publish_results。发布任务默认且约束为 PREPARE_ONLY。

## 安全与真实性

默认显式选中 **Mock**，UI 与证据标注 **「模拟数据/未真实验证」**。Mock 是可复现、随品牌类别变化的演示生成器，不是付费模型，不证明品牌实际可见度。

设置弹窗保存 Key 到服务端进程内存，24 小时过期；不写入 SQLite、Git、日志、localStorage，不回传 Key。浏览器内 Key 输入在保存后清空。HttpOnly / SameSite=Strict Cookie 作为本地会话标识，生产环境 Cookie 开启 Secure。服务器重启后配置恢复 Mock，原会话 Cookie 尚有效时可继续查看该会话的持久化检测。Cookie 丢失或过期后无法在 UI 找回旧会话；SQLite 仍保留数据。本版本面向单进程、本地使用，没有账户体系或多实例凭据共享。

真实 Provider 必须手动配置，并为问题生成、检测或连接测试明确确认调用和潜在费用。配置示例（Key 不放在文档中）：

| Provider          | Base URL                                            | 默认 Model      |
| ----------------- | --------------------------------------------------- | --------------- |
| DeepSeek          | `https://api.deepseek.com`                          | `deepseek-chat` |
| Qwen              | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus`     |
| OpenAI-compatible | 用户可信 HTTPS 地址，含所需 `/v1` 前缀              | 用户填写        |

兼容层追加 `/chat/completions`。Base URL 拒绝明文 HTTP、嵌入凭据和查询参数；不跟随重定向。仅向用户配置的可信服务发送 Key。额外参数支持 temperature、top_p、max_tokens、presence_penalty、frequency_penalty、seed。每次输出上限 2,400 Token，45 秒超时，无自动重试。生成问题/测试各 1 次请求，检测 N 题为 N 次请求。Token 仅记录供应商实际返回值，真实费用未取得时保留 NULL，不冒充精确定价。

检测回答只发送用户的问题，不在 DISCOVERY 中额外塞入品牌信息。普通 API 始终 `web_search=false`。仅保存供应商实际返回的结构化 HTTP(S) citations，不推造来源；回答中任何声称的事实也未经验证。提及是名称匹配（英文词边界、NFKC、不区分大小写），位置为规范化文本中从 1 开始的 Unicode 字符位置，不是推荐排名。每个竞品在一条回答中最多计一次。无回答时提及率为未知。部分失败报告的分母是已成功保存的回答，未成功请求不算未提及。

本地报告由**实际存储的回答计算**，当前验收回答全部是 Mock。未进行任何真实付费 API 调用、外部平台媒体上传或平台发布，未推送 Git。

## 验证与截图

```bash
npm test           # Vitest：指标、提及和 AI Gateway 的注入式测试
npm run build      # Next.js 生产构建与 TypeScript 校验
npm start          # 独立终端；3100
npm run test:browser
```

浏览器脚本使用 Node Playwright，默认系统 Chrome `/opt/google/chrome/chrome`，其他机器通过 `CHROME_PATH` 指定。验收脚本阻止所有非 localhost 网络请求，覆盖 Mock 连接测试 → 仅品牌建任务 → 生成/编辑/删除/保存问题 → 确认检测 → SQLite 证据与计算校验 → 报告 → AI建议 → 内容生成/编辑/上传 → 发布占位页，并检查移动端溢出、会话隔离与控制台错误。会创建本地 Mock 测试数据，不产生费用。使用 headless Chrome，不代表平台登录或有界面人工接管已验证。

截图：[首页桌面](docs/screenshots/home-desktop.png)、[首页移动](docs/screenshots/home-mobile.png)、[检测页](docs/screenshots/run-desktop.png)、[报告桌面](docs/screenshots/report-desktop.png)、[报告移动](docs/screenshots/report-mobile.png)。

## 后续工作

- 阶段 4 已接入发布工作台与浏览器准备流程；真实平台均未登录验收，详情见下方工作包 4。
- 有用户授权和凭据后，单独进行真实付费 API 与已登录平台验收。当前没有 Key，不将注入式测试称为真实 API 验证。
- 本地 MVP 使用请求内顺序执行和轮询进度，不含任务队列；长请求部署需代理允许相应时长。中断任务不自动重试，重新建任务避免意外重复付费。
- 官网目前只作为用户提供的上下文，不自动抓取；没有来源真实性验证、别名识别、情感分析或全网衡量能力。

## 代码与参考

`src/lib/gateway.ts`：统一兼容 Provider 适配与独立 MockTransport；`src/lib/metrics.ts`：证据指标纯函数；`scripts/schema.sql`：数据库；`src/app/api/[...path]/route.ts`：本地 API；`src/components/app.tsx`：主要交互。

只读参考 `/workspace/everyone-geo-ref/packages/geo-core` 的证据指标思想及 `packages/llm` 的 DeepSeek/Qwen 请求协议，不复制原系统架构或修改参考仓库。指标保持本次样本分母、品牌提示分组与未知值语义。

## 工作包 3：内容与媒体

报告页点击「生成 AI 优化建议」会通过 Gateway 调用一次；每条建议强制校验回答证据 ID，链接到报告对应 Query 与原始回答。建议保留生成响应、Provider、模型、版本、用量及模拟输入标志。

点击「根据分析生成内容」进入 `/content/[reportId]`，支持 SEO/GEO、小红书、抖音、B站、视频号、快手、微博、公众号、知乎、今日头条/百家号共十种内容类型。每种使用独立渠道指令；标题、正文、标签、封面、配图、视频脚本、分镜均可编辑保存。生成和重新生成必须主动点击并确认潜在费用，每次一次请求、不自动重试；重新生成创建新草稿，旧稿保留。草稿保存不调用模型。所有生成都关联报告与原始回答 ID；输入含 Mock 时，即使输出来自真实 Provider，也标明输入未经真实验证。

SQLite 初始化向现有数据库增量创建 `ai_suggestions` 与 `content_generations` 表，不删除历史数据。`contents.body` 为上述七个字符串字段的 JSON；生成原文与元数据保存在 `content_generations.generation`，手动编辑不会覆盖原始生成证据。

`public/demo/cover.svg` 与 `preview.mp4` 由本地代码/ffmpeg 生成，CC0 许可见 `public/demo/LICENSE.txt`，标记「演示素材」。预览确认仅影响界面，绝不创建发布任务或自动附加媒体；后续发布工作包仍须单独实现明确选择。上传支持 PNG/JPEG/WebP/MP4，单文件25MB，按文件头识别类型，不接受SVG。文件使用随机文件名写入被Git忽略的 `uploads/`；`/api/media/[id]` 校验会话所有权、文件路径及真实路径，视频支持字节区间读取。媒体列表仅返回当前会话草稿的素材。无外部平台上传。

验收：`npm test` 15项通过；`npm run build` 通过；`npm run test:browser` 通过，覆盖十渠道生成、编辑持久化、图片/MP4上传、非法格式拒绝、MP4字节范围、跨会话读写拦截及移动端布局，控制台错误0，外部AI调用0，发布0。新增截图：[内容中心桌面](docs/screenshots/content-desktop.png)、[内容中心移动](docs/screenshots/content-mobile.png)。

当前环境的 `.git` 不完整（缺少objects/refs），且权限配置将其挂载为只读，无法恢复历史或向该目录写入提交。为保留可审查的本地提交，使用独立元数据目录 `.local-git`（不修改只读 `.git`）。查看提交：`git --git-dir=.local-git --work-tree=. log -1`；后续操作同样带这两个参数。此环境限制不影响应用运行；未执行push。


## 工作包 4：发布工作台与独立执行器

`/publish` 从当前会话的内容草稿创建一个或多个独立平台任务；支持小红书、抖音、B站、视频号、快手、微博、微信公众号、知乎、今日头条、百家号及 WordPress。矩阵表示本版本接入的类型，未声称覆盖平台全部能力。适配沿用原稿并进行标题/微博长度裁切，可逐平台编辑；不会调用 AI。媒体须重新明确选择用户上传素材，演示素材被后端拒绝。视频渠道需要用户成片，脚本不会自动转成视频。

浏览器流程：添加账号 → 选择平台、草稿和素材 → 保存任务 → 检查登录或开始自动填写。API 用 `spawn` 启动 `scripts/publisher/runner.mjs`，SQLite 的 `publisher_accounts`、`publisher_jobs` 首次使用自动创建，不改动历史检测数据。每个账号使用 `data/profiles/<platform>/<随机账号ID>`（名称映射在 SQLite），不存平台密码或导出 Cookie。Profiles 含敏感登录态，与数据库及 uploads 一样须仅在可信本机保存，不提交 Git。没有多用户生产鉴权，本产品面向可信本地使用。

执行器移植了上游选择器、上传顺序、富文本编辑与 B站登录恢复流程，来源和 MIT 许可见 `NOTICE`。会打开官方页面，检查已知登录/编辑器标记，有 DISPLAY 时等扫码5分钟；没有交互桌面且无登录态则 `NEEDS_LOGIN`。图片/视频经 `setInputFiles` 上传后等待已知完成标记，填入标题/正文/话题并回读。可选择封面；仅在能定位独立封面入口时上传，否则明确失败。各平台必要分类、原创/AI声明及部分话题识别仍需人工完成，界面和回读记录均明确提示。页面改版或不确定上传完成时失败，不冒充已填写。公众号通常需先人工进入新建文章编辑器；重试默认从官方入口开始，动态 token/编辑器导航仍待真实账号验收。

默认且唯一模式 `PREPARE_ONLY`。执行器不包含最终发布操作，不自动创建发布结果。状态为 `DRAFT / FILLING / FILLED_AWAITING_REVIEW / NEEDS_LOGIN / FAILED / PUBLISHED_VERIFIED`。最后一种只在用户明确确认并提供 URL 后产生，记录 `USER_PROVIDED_URL`，不宣称服务器已核实公开可访问性。本地测试任务禁止登记真实发布。每个平台单独更新，失败不影响其他任务。进程心跳与 PID 用于恢复中断任务；重新尝试是用户主动操作，避免后台重复上传。

有桌面时浏览器在填写后保留15分钟供云桌面人工接管。请关闭浏览器释放 profile 后再检查、重试或登记发布结果；同账号同时仅允许一个执行器。服务重启后账号 profile 与任务保留；不自动恢复提交行为。远程用户能否实际操作云桌面仍需用户确认，代码没有内置 VNC 服务。

每个任务都可下载 ZIP 人工包，包含标题、正文、话题、manifest、媒体和封面（如选用）。WordPress 使用用户本次输入的 HTTPS 站点、用户名及应用密码，仅后端调用 `/wp-json/wp/v2/posts`，明确 `status=draft`；不持久化、不日志输出密码，不自动发布，不自动上传 WordPress 媒体或设置分类。请求失败不标记已创建。WordPress 凭据缺失，外部 API 未实测。

安装和验证（Node 24）：

```bash
export PATH=$HOME/.local/node24/bin:$PATH
npm install
PLAYWRIGHT_BROWSERS_PATH=$PWD/data/browsers npx playwright install chromium
npm test
npm run build
npm run dev                     # 3100，不占用3000/3001
# 另一个终端，服务器运行时：
npm run test:publish
npm run test:browser
```

`data/browsers` 存在时执行器自动选择安装的 Chromium；否则使用 Playwright 默认安装。`/test-platform` 是本地测试页，不调用任何外部平台。`npm test` 包含 headless 上传、填写、回读、禁止提交和独立任务中断恢复；`test:publish` 覆盖 API → 独立进程 → 本地 Chromium、ZIP、会话隔离、桌面/移动截图与零页面异常。已实际运行 DISPLAY 有界面 Chromium，并用本地测试值验证 profile 关闭后恢复；不等同于真实平台登录恢复验收。

本工作包验证：本地图片上传与自动填写通过，未点击提交；截图见 `docs/screenshots/publish-desktop.png`、`publish-mobile.png`、`publish-headed-fixture.png`。真实平台全部尚未使用授权账号验证上传、登录、分类、封面或用户接管；普通平台选择器仅为上游移植，可能需要按新版页面修正。付费模型真实验证0次，公开发布0次。后续应逐平台取得授权账号，在 PREPARE_ONLY 下验收，优先小红书及五个视频平台；再完善公众号动态编辑器入口与平台专用分类/声明。
