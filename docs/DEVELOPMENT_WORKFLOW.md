# GeoLens 开发工作流（Agent 规则）

> 本文是 Agent 在本仓库工作时**必须遵守**的过程规则（DX1 起生效）。
> 与之配套的本地启动工具见 [DX1_CONTROL_CENTER.md](./DX1_CONTROL_CENTER.md)。

## 1. Milestone 完成判定（强制）

【Milestone 未更新 Project Status，则不能宣布 DONE】

每完成一个 Milestone（或进入可演示的中途状态），Agent 必须先更新根目录
`project-status.json`，至少更新：

- `currentMilestone`
- 对应 `milestone[].status`（DONE / IN_PROGRESS / NOT_STARTED / BLOCKED）
- `milestone.completedAt`（commit 时间，格式 ISO 8601）
- `milestone.commit`（必须先 `git log` 实际核实，禁止照抄提示词）
- `milestone.summary`
- `milestone.verification`（`method / command / lastRunAt / result`，**机器可验证来源**）
- `milestone.demoRoute`（可观察的演示入口）

只有 `project-status.json` 与代码/文档/commit 一致后，才允许输出“XX 完成”。

## 2. 状态中心纪律（拒绝 Agent 自我宣称）

- 能实时检查的（进程、端口、/health、/health/db、docker inspect、redis PING）→ Control Center 实时检查。
- 不能实时检查的（历史测试结果、验收结论）→ 只展示 `Last verified: 时间 + command + result`。
- 禁止因为“Agent 说完成了”就让页面显示 PASS。
- `project-status.json` 的 `verification.lastRunAt` 是审核证据，不允许伪造成未来时间。

## 3. 每个 Milestone 的阶段审核三检查

- **IMPLEMENTATION**：代码是否完成（checkpoints 逐项）。
- **TESTING**：测试是否通过（有 `command` + `result` + `lastRunAt`）。
- **DEMO**：是否有可观察结果（`demoRoute` + 真实验证样本）。

不允许伪造百分比；无法机器验证进度时使用 checklist（`checkpoints[]`，
状态 ∈ DONE / IN_PROGRESS / NOT_STARTED），比假百分比更诚实。

## 4. 提交纪律

- DX1 完成后，Agent 每次里程碑提交都必须在提交信息中注明 milestone（如 `feat(m6): ...`）。
- 本地 commit；push 需用户明确批准。
- 基线以 `git log` 为准。当前 M5 基线 `1137d23`。

## 5. 本地运行（开发者快速路径）

```
双击 START_GEOLENS.cmd        # 一键启动 + 自动打开 http://localhost:3000/dev/status
双击 STATUS_GEOLENS.cmd       # 状态一览
双击 STOP_GEOLENS.cmd         # 停 Web/API/Worker（保留 PG/Redis/Docker）
powershell -File scripts/dev-control.ps1 stop-all   # 再停 docker compose
```

- 固定 Runtime：Node `D:\tools\node24\node.exe`（v24.20.0）、pnpm 11.1.0（hoisted）。
- 启动器**只管理 `.runtime/*.pid` 记录、带 `dx-geolens-*`/`next dev` 标记的进程**；
  禁止扫描 Redis/PG TCP PID 乱杀、禁止 `taskkill` 所有 node.exe、禁止杀 Docker 进程。
- 详细日志：`.runtime/logs/`（api.log / worker.log / web.log / *.err.log / control.log）。

## 6. 安全红线（本仓库累积教训）

1. 清理任何进程前：PowerShell `Get-CimInstance Win32_Process` 导出 CommandLine 交叉核对归属；
   禁止误杀 Docker Desktop / com.docker.backend / docker-agent / 端口转发进程。
2. Secret 纪律：API Key / JWT_SECRET / DB URL 只进 `.env`（已 gitignore）；
   不进 DB、Evidence、UI、日志、Git。UI 只允许布尔（configured yes/no）。
3. 真实付费 API 调用必须走暂停点 + 用户批准；默认 `ENABLE_REAL_PROVIDERS=false`。
4. 不修改本文件外的产品核心逻辑来讨好演示；Demonstration 结论必须标注
   “Small sample / baseline only”。
