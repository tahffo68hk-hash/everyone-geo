# DX1 — One-Click Dev Control Center

> 目标：让非开发的项目负责人“双击一个文件”即可查看/演示 GeoLens，
> 不再需要记忆 pnpm 命令、端口、PID、Redis 或“当前做到 M 几”。
> 本 DX 工具不改 GEO 产品核心逻辑、不接新 Provider、不进入 M6。

## 1. 交付物

| 文件 | 作用 |
|---|---|
| `START_GEOLENS.cmd`（根目录） | 双击 → `scripts/dev-control.ps1 start`：Node/Docker 检查 → compose up → API → Worker → Web → 自动打开 `/dev/status` |
| `STOP_GEOLENS.cmd` | 双击 → `stop`：只停 Web/API/Worker；PostgreSQL/Redis 保留、Docker Desktop 不动 |
| `STATUS_GEOLENS.cmd` | 双击 → `status`：实时一览 → 按任意键打开 Control Center |
| `scripts/dev-control.ps1` | 主控（start / stop / stop-all / status / restart / help） |
| `project-status.json`（根目录） | 机器可读项目状态（Milestone / commit / verification / checkpoints） |
| `apps/web/src/app/dev/status/page.tsx` | Control Center 页面（仅 development 渲染） |
| `.runtime/` | PID 文件 + `logs/` 详细日志 + `status.json` 快照（gitignore） |

## 2. Runtime 策略

- 固定 Node：`D:\tools\node24\node.exe`（校验 v24.20.0，不符即中止）。
- pnpm 11.1.0 的 CLI（`pnpm.mjs`）按固定候选路径解析，**不依赖系统 PATH**；
  PowerShell 只把 `D:\tools\node24` 临时前置到当前进程 `$env:Path`，**不修改系统 PATH**。
- API / Worker 每次冷启动前先 `--filter @geolens/{api,worker} build`（先清 dist 再编译，
  从根上避免 stale build）；Web 用 `next dev`（按需编译，无 build 缓存污染）。
- 启动参数带工具标记：API/Worker 追加 `dx-geolens-api` / `dx-geolens-worker` argv，
  Web 靠 `next\dist\bin\next` 命令行片段识别 —— 停止前逐 PID 核对“进程名=node.exe
  且命令行含标记”，不匹配则安全忽略，防止 PID 复用误杀。

## 3. PID / 日志管理

```
.runtime/
  api.pid / worker.pid / web.pid      # 纯数字 PID
  meta.json                            # { app: { pid, marker, startedAt, note } }
  status.json                          # 状态快照（供 UI + STATUS 使用）
  logs/
    api.log api.err.log               # Start-Process OS 级文件重定向，父进程退出不 EPIPE
    worker.log worker.err.log
    web.log web.err.log
    build-api.log build-worker.log docker-compose.log control.log
```

- `STOP` 只停 `.runtime/*.pid` 记录的进程树（children 先行，防 Next dev 子进程残留）；
  对失效 PID 安全忽略。绝不扫描 Redis/PG 端口 PID，绝不 `taskkill` 所有 node.exe，
  绝不杀 Docker。
- 重复双击 `START_GEOLENS.cmd`：PID 存活且健康 → 显示 “已运行” 并直接打开页面，
  不创建第二套进程（Worker 另加“foreign worker”检测：任何非本工具、
  命令行含 `dist/main.js` 的同队列实例 → 拒绝启动并提示先手动停止，杜绝双消费）。

## 4. Docker 安全

- 启动前 `docker version` 探测 Server；Docker Desktop 未启动 → 显示中文提示并等用户
  打开后按任意键重试（可循环），**不 taskkill、不删数据**。
- `docker compose up -d` 后等待 `geo-postgres` / `geo-redis` healthy，`redis-cli ping=PONG`。
- `stop` 默认保留 PostgreSQL/Redis；`stop-all` 才执行 `docker compose stop`（容器与数据卷保留）；
  两种都不停 Docker Desktop。

## 5. Control Center 页面（http://localhost:3000/dev/status）

仅开发环境可用：`NODE_ENV === 'production'` 时 `notFound()`（404）。包含：

- **SYSTEM STATUS**：Web/API/Worker/PostgreSQL/Redis/DB Health/DeepSeek/Real Providers。
  API、DB、Docker 健康均为**页面实时探活**；Worker 为“实时 PID + 日志 READY 标记”；
  有快照来源时标注 `Last verified`。DeepSeek/Real Providers 只返回布尔，绝不返回 Key。
- **PROJECT PROGRESS**：M0→M6 timeline，每项可展开：完成内容、Checkpoints、
  Implementation/Testing/Demo 三检查、Verification（command/lastRunAt/result）、Tests、Demo 链接。
- **Quick Actions**：仅 Open Dashboard / Monitor / Evidence、View Latest Milestone、Refresh。
  无 Restart Docker / Kill Process / Delete DB / Run Migration / Real API Test 等危险按钮。
- **日志摘要**：只显示 `.runtime/logs` 最后一行非敏感错误（正则脱敏 Key/Authorization）。
- 当前阶段卡片 + “Next: M6 …（不自动开始）”。

## 6. project-status.json 数据模型

- `currentMilestone` / `overallStatus` / `git{branch,head}` / `updatedAt` / `updatedBy`
- `realRunEvidence`：真实调用证据（totalRealRuns / sample / “Small sample / baseline only”标注）
- `milestones[]`：`id / name / status / completedAt / commit / summary / dataType / demoRoute /
  gates{implementation,testing,demo} / checkpoints[] / verification / tests[]`
- `status` ∈ DONE / IN_PROGRESS / NOT_STARTED / BLOCKED；`dataType` ∈ mock / real / mixed / n/a

进度条与百分比**由页面按 status 计算**，不硬编码。

## 7. 验收路径（冷启动）

1. 无 API / Worker / Web，Docker 已运行 → 双击 `START_GEOLENS.cmd`
2. 自动达到：Postgres healthy → Redis healthy(PONG) → API healthy → Worker READY → Web 200
   → 浏览器打开 `/dev/status`
3. 再次双击 START → 不产生第二个 Worker（显示已运行并直接打开页面）
4. `STOP_GEOLENS.cmd` → 只停 Web/API/Worker，Docker 与 PG/Redis 不受影响
5. 再次 START → 可恢复
6. 回归：`pnpm -r build`、geo-core / llm / queue / worker / API e2e、M3/M4 acceptance

> Agent 规则见 [DEVELOPMENT_WORKFLOW.md](./DEVELOPMENT_WORKFLOW.md)：Milestone 未更新
> `project-status.json` 不得宣布 DONE。
