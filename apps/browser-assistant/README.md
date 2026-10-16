# GeoLens 本地浏览器辅助发布助手 (Selenium V2A)

独立运行于创作者本机的受控浏览器自动化助手，为 GeoLens 多平台内容分发提供安全、免凭据泄露的浏览器辅助发布能力。

---

## 一、核心特性与安全边界

1. **凭据不出域**：
   - 平台账号、密码、Cookie、Token 或浏览器完整 Profile **绝对不上传**至 GeoLens 云端或服务端。
   - 所有自动化均在本地受控 Chrome 会话中执行。

2. **独立受控 Profile**：
   - 存储路径：`.runtime/browser-assistant/profiles/<channel>_<accountId>/`。
   - 绝不接管或修改创作者日常个人 Chrome 默认 Profile。
   - 支持会话期登录态复用，平台 Cookie 或 Session 有效期内无需每次重复扫码登录。
   - 支持一键清理本地 Profile 与断开重连。

3. **双向比对与人工确认闸门**：
   - 表单填写完毕后，自动从浏览器 DOM 逆向读取标题与正文字数并比对。
   - 停留在最终发布确认区并高亮发布按钮，**绝对不越权擅自点击提交发布**。
   - 只有取得真实的公开发布链接或平台内容 ID 后，方可核准创建 `PublishedAsset` 资产。

4. **安全鉴权与来源白名单**：
   - 本地服务监听：`127.0.0.1:8765`。
   - 仅限白名单源（`http://localhost:3000`, `http://127.0.0.1:3000` 等）发起请求。
   - 请求必须携带本地生成的配对令牌（`X-Assistant-Token` / `Bearer`）。
   - 运行日志自动对密码、Token、Cookie 等敏感字段脱敏。

---

## 二、平台适配器支持情况

| 平台渠道 | 适配状态 | 模式支持 | 创作后台地址 | 自动化内容 |
| :--- | :--- | :--- | :--- | :--- |
| **知乎 (ZHIHU)** | **首发完整适配** | 浏览器自动化 | `https://zhuanlan.zhihu.com/write` | 登录态识别、标题填入、Draft.js 富文本段落写入、配图上传、话题标签、DOM 双向比对、停顿确认 |
| **本地仿真 (SIMULATION)** | **完整适配 (E2E 测试)** | 浏览器自动化 | 本地受控仿真创作页 | 100% 离线、确定性端到端 9 步流程测试与截图存证 |
| **小红书 (XIAOHONGSHU)** | 预留接口 | 人工发布回退 | `https://creator.xiaohongshu.com/` | 打开创作页、提供一键复制标题/正文/话题、素材下载与核对清单 |
| **哔哩哔哩 (BILIBILI)** | 预留接口 | 人工发布回退 | `https://member.bilibili.com/` | 打开创作页、提供专栏与视频投稿简介发布包 |
| **微信公众号 / 视频号 / 抖音 / 微博** | 预留接口 | 人工发布回退 | 对应官方创作平台 | 打开创作页、提供分镜脚本与图文发布包 |

---

## 三、快速启动与使用说明

### 1. 安装依赖
已预装 Python 3.12+ / 3.13+，所需核心包为：
```bash
pip install -r apps/browser-assistant/requirements.txt
```
依赖项清单：
- `selenium>=4.20.0` (内置 Selenium Manager，自动管理 ChromeDriver)
- `fastapi>=0.110.0`
- `uvicorn>=0.28.0`
- `pydantic>=2.0.0`

### 2. 启动助手服务
在仓库根目录直接运行批处理脚本：
```cmd
START_ASSISTANT.cmd
```
或通过 npm/pnpm 启动：
```bash
pnpm assistant
```
或直接运行 Python 启动脚本：
```bash
python apps/browser-assistant/start_assistant.py
```
启动后终端将输出监听地址及自动生成的配对令牌：
```text
=================================================================
   GeoLens 本地浏览器自动化辅助发布助手 (Selenium V2A)
=================================================================
 服务监听地址: http://127.0.0.1:8765
 允许请求来源: http://localhost:3000, http://127.0.0.1:3000, ...
 本地配对令牌: <高强度随机配对令牌>
 运行缓存目录: D:\dev\geo-platform\.runtime\browser-assistant
=================================================================
```

### 3. 在 GeoLens Web 端操作
1. 打开 GeoLens 分发工作台：`http://localhost:3000/app/content/distribution`。
2. 顶部切换至 **【浏览器辅助发布 (Selenium V2A)】** 标签页。
3. 工作台将自动探测本地 `127.0.0.1:8765` 助手连接状态并读取配对令牌。
4. 选择左侧待分发草稿与目标平台（如知乎）。
5. 点击 **【启动浏览器】** 或 **【开始自动填写与比对校验】**。
6. 受控 Chrome 窗口弹出，用户首次扫码或验证登录平台账号。
7. 助手自动执行：打开编辑页 → 写入标题 → 写入正文 → 填入话题 → DOM 校验比对。
8. 助手在高亮发布按钮前停步并等待；创作者在浏览器中核实无误后点击发布。
9. 在面板点击 **【已在平台发布，回填落地链接】**，输入公开链接或文章 ID，核准创建 `PublishedAsset` 资产。

---

## 四、自动化测试套件

运行全套单元测试与真实 Chrome Headless 端到端测试：
```bash
python -u apps/browser-assistant/run_tests.py
```
测试内容涵盖：
1. **安全与鉴权测试**：令牌生成与持久化、Origin 来源白名单校验、Bearer/Header 认证拦截、日志敏感凭证脱敏。
2. **Profile 隔离测试**：多账号/多平台 User Data Dir 隔离、驱动状态跟踪。
3. **知乎适配器测试**：选择器有效性、Draft.js DOM 校验逻辑比对。
4. **真实 Selenium Chrome 端到端测试**：启动真实 Chrome (Headless)，在仿真平台自动化走完 9 步全流程，生成真实屏幕快照截图（保存在 `.runtime/browser-assistant/screenshots/`），模拟用户点击发布并核验证据提取。
5. **任务管理状态机测试**：暂停、恢复、手动接管与终态落地确认。
