#requires -version 5.1
<#
  GeoLens Dev Control Center — One-Click Local Developer Experience (DX1)
  职责：
    start      一键启动本地 GeoLens（Docker 检查 -> compose -> API -> Worker -> Web -> 打开 /dev/status）
    stop       只停止由本工具启动的 Web/API/Worker（保留 PostgreSQL / Redis，不动 Docker Desktop）
    stop-all   在 stop 基础上执行 docker compose stop（仍不动 Docker Desktop）
    status     实时状态一览（含健康、PID、日志摘要、DeepSeek 配置布尔）并写入 .runtime/status.json
    restart    等价 stop + start

  安全纪律（吸取此前误杀 Docker 事故教训）：
    - 永不 taskkill 所有 node.exe；永不扫描 Redis/PG TCP PID 乱杀；永不杀 Docker 相关进程。
    - 只操作 .runtime 内 PID 文件中记录、且命令行带本工具启动标记（dx-geolens-* / next dev）的 node 进程。
    - 停 PID 前再次核对进程名与命令行，不一致则安全忽略并告警。
    - 不修改系统 PATH；仅在当前进程 PATH 前临时追加 D:\tools\node24。
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('start', 'stop', 'stop-all', 'status', 'restart', 'help')]
  [string]$Command = 'help',
  [switch]$NoPrompt,
  [switch]$OpenBrowser
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- 常量
$RootDir      = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$RuntimeDir   = Join-Path $RootDir '.runtime'
$LogsDir      = Join-Path $RuntimeDir 'logs'
$NativeTmpDir = Join-Path $RuntimeDir 'tmp'   # 每次 native 调用的独立 stdout/stderr 临时文件
$StatusJson   = Join-Path $RuntimeDir 'status.json'
$MetaJson     = Join-Path $RuntimeDir 'meta.json'
$EnvFile      = Join-Path $RootDir '.env'
$ProjectJson  = Join-Path $RootDir 'project-status.json'

$NodeExe      = 'D:\tools\node24\node.exe'
$ExpectedNode = 'v24.20.0'
$FixedPath    = 'D:\tools\node24'

$ApiPort      = 3001   # 可被 .env 的 API_PORT 覆盖
$WebPort      = 3000
$NextBin      = Join-Path $RootDir 'node_modules\next\dist\bin\next'

$WebUrl       = "http://127.0.0.1:$WebPort"
$ApiBase      = "http://127.0.0.1:$ApiPort"
$CtrlUrl      = "http://localhost:$WebPort/dev/status"

$AppDefs = @{
  api    = @{ pid = Join-Path $RuntimeDir 'api.pid';    log = Join-Path $LogsDir 'api.log';    err = Join-Path $LogsDir 'api.err.log';    marker = 'dx-geolens-api';     build = 'api' }
  worker = @{ pid = Join-Path $RuntimeDir 'worker.pid'; log = Join-Path $LogsDir 'worker.log'; err = Join-Path $LogsDir 'worker.err.log'; marker = 'dx-geolens-worker';  build = 'worker' }
  web    = @{ pid = Join-Path $RuntimeDir 'web.pid';    log = Join-Path $LogsDir 'web.log';    err = Join-Path $LogsDir 'web.err.log';    marker = 'next\dist\bin\next' }
}

# ---------------------------------------------------------------- 工具函数
function Write-Info($msg)  { Write-Host $msg }
function Write-Ok($msg)    { Write-Host $msg -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host $msg -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host $msg -ForegroundColor Red }
function Now-Str { return (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') }
function Log-File($msg) {
  try { Add-Content -LiteralPath (Join-Path $LogsDir 'control.log') -Value ("{0}  {1}" -f (Now-Str), $msg) -Encoding UTF8 } catch {}
}

function Invoke-OpenControlCenter() {
  if ($env:GEO_DX_OPEN_URL -eq '0') { return }
  try { Start-Process $CtrlUrl } catch { Write-Warn "无法自动打开浏览器，请手动访问 $CtrlUrl" }
}

function Test-Alive([int]$Pid) {
  if ($Pid -le 0) { return $false }
  return (Get-Process -Id $Pid -ErrorAction SilentlyContinue) -ne $null
}

function Read-PidFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return 0 }
  try { $v = (Get-Content -LiteralPath $Path -Raw -ErrorAction Stop).Trim(); return [int]$v } catch { return 0 }
}

function Write-PidFile([string]$Path, [int]$Pid) {
  Set-Content -LiteralPath $Path -Value ([string]$Pid) -Encoding ASCII -NoNewline
}

function Remove-IfExists([string]$Path) {
  # 尽力删除：失败静默忽略（重定向文件会被 PS 1>/2> 覆盖写；pid/dist 删不掉
  # 不影响主流程，避免个别环境把删除错误升级成启动中断）。
  if (-not (Test-Path -LiteralPath $Path)) { return }
  try { Remove-Item -LiteralPath $Path -Force -ErrorAction Stop } catch {}
}

function Get-DotEnvValue([string]$Path, [string]$Key) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    $eq = $t.IndexOf('=')
    if ($eq -le 0) { continue }
    if ($t.Substring(0, $eq).Trim() -eq $Key) {
      $v = $t.Substring($eq + 1).Trim()
      if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
        if ($v.Length -ge 2) { $v = $v.Substring(1, $v.Length - 2) }
      }
      return $v
    }
  }
  return $null
}

function Get-ProcessCmdline([int]$Pid) {
  try {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = $Pid" -ErrorAction Stop
    if ($p) { return [string]$p.CommandLine }
  } catch {}
  return ''
}

function Read-TextFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return '' }
  try { return [IO.File]::ReadAllText($Path, [Text.UTF8Encoding]::new($false)) } catch { return '' }
}

function Resolve-ExePath([string]$Name) {
  if ([IO.Path]::IsPathRooted($Name)) {
    if (Test-Path -LiteralPath $Name) { return $Name }
    return $Name
  }
  $c = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c -and $c.Source) { return $c.Source }
  return $Name
}

# ================================================================
# 统一 native 进程调用（Windows PowerShell 5.1 安全版，v3）
#
# 真机三连坑（前两次已修，第三次根因见下）：
#   1) PS 5.1 中 native stderr 经 2>&1/*>&1 合并 → 逐行包装成 ErrorRecord，
#      在 $ErrorActionPreference='Stop' 下 ExitCode=0 也会被判为终止错误。
#   2) Start-Process(UseShellExecute=$false) 重建子进程环境为大小写不敏感
#      字典，环境里同时存在 http_proxy/HTTP_PROXY 时抛 "已添加项"。
#   3) 即便用 2> 文件重定向，部分 PS 5.1 宿主/场景下 native stderr 仍会被
#      提升为终止错误（NativeCommandError，消息=stderr 原文，例如
#      "Container geo-postgres Running"），导致 [3/8] PostgreSQL FAILED。
#
# v3 安全层（层层设防，使 native stderr 永远不可能终止启动流程）：
#   a. 每次调用生成唯一 stdout/stderr 文件（native-<guid>.*），调用结束读取
#      后即删 —— 绝不复用固定路径，杜绝上一次调用残留被本次读取（stale）；
#   b. 调用前把函数内 $ErrorActionPreference 临时降级为 'Continue'，
#      即使宿主把 stderr 提升成 ErrorRecord 也只非终止、不中断；
#   c. 调用包 try/catch：仍被提升为终止错误时捕获并吞掉，附到 stderr 摘要；
#   d. 成败只依据进程 ExitCode —— 调用结束后【立即】捕获 $LASTEXITCODE
#      （在读取文件、恢复目录之前）；stderr 非空绝不代表失败；
#   e. 进程未真正启动（exe 缺失/不可执行）时返回 127 + 明确 stderr。
# ================================================================
function Invoke-NativeProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [string]$WorkingDirectory = '',
    [string]$StdoutFile = '',   # 显式指定则落固定日志（compose up / build 等长命令）
    [string]$StderrFile = '',   # 不指定则自动分配唯一临时文件并回收
    [int]$MaxText = 200000      # 返回文本上限（防止把巨量日志读进内存）
  )
  # —— 每次调用独立 stdout/stderr 生命周期 ——
  $autoOut = [string]::IsNullOrEmpty($StdoutFile)
  $autoErr = [string]::IsNullOrEmpty($StderrFile)
  if ($autoOut) { $StdoutFile = Join-Path $NativeTmpDir ('native-{0}.out.log' -f ([guid]::NewGuid().ToString('N'))) }
  if ($autoErr) { $StderrFile = Join-Path $NativeTmpDir ('native-{0}.err.log' -f ([guid]::NewGuid().ToString('N'))) }
  New-Item -ItemType Directory -Force -Path $NativeTmpDir | Out-Null

  $exe = Resolve-ExePath $FilePath
  # 找不到可执行文件：直接返回 127（不抛错，让调用方按 ExitCode 处理）
  if (-not [IO.Path]::IsPathRooted($exe) -and -not (Get-Command $exe -ErrorAction SilentlyContinue)) {
    if ($autoOut) { Remove-IfExists $StdoutFile }
    if ($autoErr) { Remove-IfExists $StderrFile }
    return @{ ExitCode = 127; Stdout = ''; Stderr = "命令不存在：$exe" }
  }
  # 含空格/引号的参数手动补引号，避免被拆成多个参数
  $quoted = @($ArgumentList | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + $_.Replace('"', '\"') + '"' } else { $_ }
  })

  $prev = Get-Location
  if ($WorkingDirectory) {
    if (-not (Test-Path -LiteralPath $WorkingDirectory)) { throw "工作目录不存在：$WorkingDirectory" }
    Set-Location -LiteralPath $WorkingDirectory
  }
  # 只做 1> / 2> 文件重定向，绝不使用 2>&1 / *>&1；函数内临时 EAP=Continue
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $started = $false
  $invokeError = $null
  try {
    $null = & $exe @quoted 1> $StdoutFile 2> $StderrFile
    $started = $true
  } catch {
    $invokeError = $_.Exception.Message   # 残余提升吞掉，不向上抛
  } finally {
    $ErrorActionPreference = $prevEap
    if ($WorkingDirectory) { Set-Location -LiteralPath $prev.Path }
  }
  # —— 进程 ExitCode：成败唯一依据；调用结束后立即捕获 ——
  $code = -1
  try { $code = [int]$global:LASTEXITCODE } catch { $code = -1 }
  if (-not $started -and $code -lt 0) {
    $code = 127
    if (-not $invokeError) { $invokeError = "无法启动命令：$exe" }
  }

  $stdout = Read-TextFile $StdoutFile
  $stderr = Read-TextFile $StderrFile
  if ($invokeError -and $stderr -notmatch [regex]::Escape($invokeError)) {
    $stderr = ($invokeError + "`n" + $stderr).Trim()
  }
  if ($stdout.Length -gt $MaxText) { $stdout = $stdout.Substring(0, $MaxText) }
  if ($stderr.Length -gt $MaxText) { $stderr = $stderr.Substring(0, $MaxText) }
  # 临时文件用完即删（内容已读入内存），显式指定的日志文件保留
  if ($autoOut) { Remove-IfExists $StdoutFile }
  if ($autoErr) { Remove-IfExists $StderrFile }
  return @{ ExitCode = $code; Stdout = $stdout; Stderr = $stderr }
}

function Invoke-CommandCapture([string]$FilePath, [string[]]$ArgList) {
  # 兼容壳：供 docker version / inspect / exec 等短探测命令使用；
  # 只消费 ExitCode 与 Stdout（stderr 正常输出一律不视为失败）。
  $r = Invoke-NativeProcess -FilePath $FilePath -ArgumentList $ArgList
  return @{ ExitCode = $r.ExitCode; Stdout = $r.Stdout }
}

function Test-HttpOk([string]$Url, [int]$TimeoutSec = 5) {
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  } catch { return $false }
}

function Redact-Text([string]$Text) {
  if ([string]::IsNullOrEmpty($Text)) { return $Text }
  $t = $Text
  foreach ($k in @('DEEPSEEK_API_KEY', 'JWT_SECRET', 'POSTGRES_PASSWORD', 'DATABASE_URL', 'TEST_DATABASE_URL', 'REDIS_URL', 'API_KEY')) {
    $t = [regex]::Replace($t, "(?i)($k)\s*[:=]\s*[^\s,`"'}]+", ('$1=[REDACTED]'))
  }
  $t = [regex]::Replace($t, '(?i)(Authorization\s*[:=]\s*)(Bearer\s+)?[A-Za-z0-9._\-]+', '$1[REDACTED]')
  $t = [regex]::Replace($t, '(?i)Bearer\s+[A-Za-z0-9._\-]{8,}', 'Bearer [REDACTED]')
  return $t
}

function Get-LastLogLine([string]$LogPath, [int]$MaxLen = 180) {
  if (-not (Test-Path -LiteralPath $LogPath)) { return $null }
  try {
    $lines = Get-Content -LiteralPath $LogPath -Tail 6 -ErrorAction Stop
    $pick = $lines | Where-Object { $_ -match '(?i)error|fail|exception' } | Select-Object -Last 1
    if (-not $pick) { $pick = $lines | Select-Object -Last 1 }
    if (-not $pick) { return $null }
    $clean = Redact-Text ([string]$pick).Trim()
    if ($clean.Length -gt $MaxLen) { $clean = $clean.Substring(0, $MaxLen) + '…' }
    return $clean
  } catch { return $null }
}

function Get-ChildPids([int]$RootPid) {
  $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Select-Object ProcessId, ParentProcessId)
  $child = [System.Collections.Generic.List[int]]::new()
  $queue = [System.Collections.Generic.Queue[int]]::new()
  $seen = [System.Collections.Generic.HashSet[int]]::new()
  $queue.Enqueue($RootPid)
  while ($queue.Count -gt 0) {
    $p = $queue.Dequeue()
    if (-not $seen.Add($p)) { continue }
    foreach ($row in $all) {
      if ([int]$row.ParentProcessId -eq $p) {
        $cid = [int]$row.ProcessId
        $child.Add($cid)
        $queue.Enqueue($cid)
      }
    }
  }
  return $child
}

# 只允许停止「进程名=node、命令行含标记」的进程（防误杀）
function Get-ListeningPid([int]$Port) {
  try {
    $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { return [int]$c.OwningProcess }
  } catch {}
  return 0
}

# 找出“其它非本工具、但同库同队列”的 worker 实例，防双消费。
function Find-ForeignWorkers([int]$ApiListenerPid, [int]$RecordedApiPid, [int]$RecordedWorkerPid) {
  $all = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue)
  $result = @()
  foreach ($p in $all) {
    $cmd = [string]$p.CommandLine
    if ($cmd -notmatch 'dist[\\/]main\.js') { continue }
    $id = [int]$p.ProcessId
    if ($id -eq $RecordedApiPid -or $id -eq $RecordedWorkerPid -or $id -eq $ApiListenerPid) { continue }
    # 排除 pnpm/tsx watch 类型脚手架进程本身的宿主（极少见），保留真实 node 直启
    $result += $id
  }
  return $result
}

function Test-GeoLensProcess([int]$Pid, [string]$Marker) {
  try {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = $Pid" -ErrorAction Stop
    if (-not $p) { return $false }
    if ($p.Name -ne 'node.exe') { return $false }
    $cmd = [string]$p.CommandLine
    return ($cmd -like "*$Marker*")
  } catch { return $false }
}

function Stop-AppTree([string]$Name, [string]$Marker) {
  $pidPath = $AppDefs[$Name].pid
  $target  = Read-PidFile $pidPath
  if ($target -le 0) { return @{ ok = $true; note = 'PID 文件不存在，安全忽略' } }
  if (-not (Test-Alive $target)) { Remove-IfExists $pidPath; return @{ ok = $true; note = 'PID 已失效，安全忽略' } }
  if (-not (Test-GeoLensProcess $target $Marker)) {
    return @{ ok = $false; note = "PID $target 命令行与启动标记($Marker)不符，拒绝停止（防误杀）" }
  }
  $children = @(Get-ChildPids $target)
  $all = @($children | Sort-Object -Descending) + @($target)
  foreach ($p in $all) {
    if (Test-Alive $p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
  }
  Start-Sleep -Milliseconds 800
  if (Test-Alive $target) {
    return @{ ok = $false; note = "PID $target 未能停止（残留），请查看日志手动确认" }
  }
  Remove-IfExists $pidPath
  return @{ ok = $true; note = "已停止 (PID $target)" }
}

function Get-Meta() {
  if (Test-Path -LiteralPath $MetaJson) {
    try { return (Get-Content -LiteralPath $MetaJson -Raw | ConvertFrom-Json) } catch {}
  }
  return $null
}

function Save-Meta([hashtable]$AppsStarted) {
  $meta = [ordered]@{ updatedAt = (Now-Str); apps = [ordered]@{} }
  foreach ($k in @('api', 'worker', 'web')) {
    $meta.apps[$k] = $AppsStarted[$k]
  }
  Set-Content -LiteralPath $MetaJson -Value ($meta | ConvertTo-Json -Depth 4) -Encoding UTF8
}

function Get-PidMeta([string]$Name) {
  $m = Get-Meta
  if ($m -and $m.apps -and $m.apps.$Name) { return $m.apps.$Name }
  return $null
}

# ---------------------------------------------------------------- 环境解析
function Resolve-Node() {
  if (-not (Test-Path -LiteralPath $NodeExe)) {
    throw "未找到固定 Node：$NodeExe。请确认已安装 Node 24 到 D:\tools\node24（见 docs/DEVELOPMENT_WORKFLOW.md）。"
  }
  $r = Invoke-NativeProcess -FilePath $NodeExe -ArgumentList @('-v')
  if ($r.ExitCode -ne 0) {
    throw "无法执行 Node（exit=$($r.ExitCode)）：$($r.Stderr)"
  }
  $ver = $r.Stdout.Trim()
  if (-not $ver) { $ver = $r.Stderr.Trim() }
  if ($ver -ne $ExpectedNode) {
    throw "Node 版本不符：期望 $ExpectedNode，实际 $ver。请修复 D:\tools\node24 后再试。"
  }
  return $ver
}

function Resolve-PnpmMjs() {
  $candidates = @(
    'D:\aconda\node_modules\pnpm\bin\pnpm.mjs',
    'D:\aconda\node_modules\pnpm\bin\pnpm.cjs',
    (Join-Path $env:APPDATA 'npm\node_modules\pnpm\bin\pnpm.mjs'),
    (Join-Path $env:APPDATA 'npm\node_modules\pnpm\bin\pnpm.cjs'),
    'C:\Program Files\nodejs\node_modules\pnpm\bin\pnpm.mjs',
    'C:\Program Files\nodejs\node_modules\pnpm\bin\pnpm.cjs',
    (Join-Path $RootDir 'node_modules\pnpm\bin\pnpm.mjs')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique
  if ($candidates.Count -eq 0) {
    throw '未找到 pnpm CLI（pnpm.mjs/pnpm.cjs）。请安装 pnpm 11.1.0 后重试。'
  }
  # 优选 11.1.0（探测失败的候选静默跳过，不中断）
  foreach ($c in $candidates) {
    $r = Invoke-NativeProcess -FilePath $NodeExe -ArgumentList @($c, '-v')
    if ($r.ExitCode -ne 0) { continue }
    $v = $r.Stdout.Trim()
    if (-not $v) { $v = $r.Stderr.Trim() }
    if ($v -eq '11.1.0') { return @{ mjs = $c; version = $v } }
  }
  $first = $candidates[0]
  $r = Invoke-NativeProcess -FilePath $NodeExe -ArgumentList @($first, '-v')
  if ($r.ExitCode -eq 0) {
    $v = $r.Stdout.Trim()
    if (-not $v) { $v = $r.Stderr.Trim() }
  } else { $v = '?' }
  Write-Warn "警告：未找到 pnpm 11.1.0（找到 $v @ $first）。继续使用，但版本与项目固定不一致。"
  return @{ mjs = $first; version = $v }
}

# ---------------------------------------------------------------- Docker / 基础设施
function Get-DockerServerUp() {
  try {
    $r = Invoke-CommandCapture 'docker' @('version', '--format', '{{.Server.Version}}')
    return ($r.ExitCode -eq 0 -and $r.Stdout -match '\d+\.\d+')
  } catch { return $false }
}

# docker inspect 机器可解析健康探测（不解析 compose ps 人类文本 / "Container xxx Running"）。
# 模板带 {{if .State.Health}} 守卫：有 healthcheck 返回 Health.Status，
# 无 healthcheck 才回退 State.Status。返回归一化枚举：
#   healthy | starting | unhealthy | running | exited | missing | unknown
function Get-ContainerStatus([string]$Name) {
  $tmpl = '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}'
  $r = Invoke-NativeProcess -FilePath 'docker' -ArgumentList @('inspect', '-f', $tmpl, $Name)
  $norm = 'unknown'
  if ($r.ExitCode -ne 0) {
    if ([string]$r.Stderr -match 'No such|no such|not found') { $norm = 'missing' }
  } else {
    $v = (([string]$r.Stdout) -replace "`r|`n", '').Trim().ToLowerInvariant()
    if ($v -eq 'healthy')      { $norm = 'healthy' }
    elseif ($v -eq 'starting') { $norm = 'starting' }
    elseif ($v -eq 'unhealthy'){ $norm = 'unhealthy' }
    elseif ($v -eq 'running')  { $norm = 'running' }   # 仅当容器无 healthcheck 时可能出现
    elseif ($v -eq 'created')  { $norm = 'starting' }
    elseif ($v -in @('exited', 'dead', 'paused', 'restarting', 'removing')) { $norm = 'exited' }
    else                       { $norm = 'unknown' }
  }
  $err = [string]$r.Stderr
  if ($err.Length -gt 300) { $err = $err.Substring(0, 300) }
  return @{ status = $norm; exitCode = $r.ExitCode; stderr = $err }
}

# 等待容器 healthy。healthy -> PASS；starting/unknown/unhealthy -> 每 2s 重试；
# missing/exited -> 快速 FAIL；超时 -> FAIL。返回 @{ ok; status; exitCode; stderr; waitedSec }
function Wait-ContainerHealthy([string]$Name, [int]$TimeoutSec = 90) {
  $startedAt = Get-Date
  $deadline  = $startedAt.AddSeconds($TimeoutSec)
  $last = $null
  while ($true) {
    $last = Get-ContainerStatus $Name
    if ($last.status -eq 'healthy') {
      return @{ ok = $true; status = 'healthy'; exitCode = $last.exitCode; stderr = $last.stderr; waitedSec = [int]((Get-Date) - $startedAt).TotalSeconds }
    }
    if ($last.status -in @('missing', 'exited')) {
      # 容器不存在或已退出：无重试意义，快速失败
      return @{ ok = $false; status = $last.status; exitCode = $last.exitCode; stderr = $last.stderr; waitedSec = [int]((Get-Date) - $startedAt).TotalSeconds }
    }
    if ((Get-Date) -ge $deadline) { break }
    Start-Sleep -Seconds 2
  }
  $last = Get-ContainerStatus $Name
  return @{ ok = $false; status = $last.status; exitCode = $last.exitCode; stderr = $last.stderr; waitedSec = [int]((Get-Date) - $startedAt).TotalSeconds }
}

# docker exec redis-cli ping：要求 ExitCode=0 且 stdout(trim)=PONG。
# stderr 是否存在不判成败；容器未运行/不存在时 exit 非 0 自然失败。
function Get-RedisPong() {
  $r = Invoke-NativeProcess -FilePath 'docker' -ArgumentList @('exec', 'geo-redis', 'redis-cli', 'ping')
  $out = (([string]$r.Stdout) -replace "`r|`n", '').Trim()
  return @{ ok = ($r.ExitCode -eq 0 -and $out -eq 'PONG'); exitCode = $r.ExitCode; stdout = $out; stderr = ([string]$r.Stderr).Trim() }
}

function Wait-Until([scriptblock]$Cond, [int]$TimeoutSec, [string]$What) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (& $Cond) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

# ---------------------------------------------------------------- 应用启动/停止
function Start-App-Background([string]$Name) {
  $def = $AppDefs[$Name]
  $work = $null
  $file = $NodeExe
  $argList = @()
  switch ($Name) {
    'api'    { $work = Join-Path $RootDir 'apps\api';    $argList = @('dist/main.js', 'dx-geolens-api') }
    'worker' { $work = Join-Path $RootDir 'apps\worker'; $argList = @('dist/main.js', 'dx-geolens-worker') }
    'web'    { $work = Join-Path $RootDir 'apps\web';    $file = $NodeExe; $argList = @($NextBin, 'dev') }
  }
  if (-not (Test-Path -LiteralPath $work)) { throw "工作目录不存在：$work" }
  if (-not (Test-Path -LiteralPath $file)) { throw "可执行文件不存在：$file" }
  # 当前进程 PATH 前临时追加 node24（不改系统 PATH），子进程继承（docker/next/nest 仍可用）
  if ($env:Path -notlike "$FixedPath*") { $env:Path = "$FixedPath;$env:Path" }
  # OS 级文件重定向（非管道）：父进程退出后子进程仍可继续写日志，不会 EPIPE。
  Remove-IfExists (Join-Path $LogsDir ($Name + '.log'))
  Remove-IfExists (Join-Path $LogsDir ($Name + '.err.log'))
  try {
    $p = Start-Process -FilePath $file `
      -ArgumentList $argList `
      -WorkingDirectory $work `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $LogsDir ($Name + '.log')) `
      -RedirectStandardError (Join-Path $LogsDir ($Name + '.err.log')) `
      -PassThru
  } catch {
    # PS 5.1 已知缺陷：Start-Process(UseShellExecute=false) 重建环境字典时，
    # 若存在 http_proxy/HTTP_PROXY 之类大小写重复变量会抛“已添加项”。
    if ($_.Exception.Message -match '已添加项|already been added') {
      throw ("启动 $Name 失败：当前环境存在大小写重复的变量（如 http_proxy 与 HTTP_PROXY）导致 " +
        'PowerShell 5.1 Start-Process 缺陷。请在“系统属性→环境变量”删除重复项后重试。' +
        "（原始错误：$($_.Exception.Message)）")
    }
    throw "启动失败：$Name — $($_.Exception.Message)"
  }
  if (-not $p) { throw "启动失败：$Name" }
  Write-PidFile $def.pid $p.Id
  return @{ pid = $p.Id; marker = $def.marker; startedAt = (Now-Str) }
}

function Build-Package([string]$Name, [ref]$pnpm) {
  $filter = if ($Name -eq 'api') { '@geolens/api' } else { '@geolens/worker' }
  $dist = Join-Path $RootDir "apps\$Name\dist"
  Remove-IfExists $dist
  Write-Info "  编译 $filter ..."
  $outLog = Join-Path $LogsDir "build-$Name.log"
  $errLog = Join-Path $LogsDir "build-$Name.err.log"
  # pnpm 把正常进度/告警写到 stderr：成败只看 ExitCode，stderr 一律落文件不刷主窗口。
  $r = Invoke-NativeProcess -FilePath $NodeExe `
    -ArgumentList @($pnpm.Value.mjs, '--filter', $filter, 'build') `
    -StdoutFile $outLog -StderrFile $errLog
  Add-Content -LiteralPath $outLog -Value ("`n{0}  exit={1}" -f (Now-Str), $r.ExitCode) -Encoding UTF8
  if ($r.ExitCode -ne 0) {
    $tail = Get-LastLogLine $errLog 400
    if (-not $tail) { $tail = Get-LastLogLine $outLog 400 }
    throw "构建失败：$filter（exit=$($r.ExitCode)） $tail 详见 $errLog"
  }
}

function Get-AppRuntimeState([string]$Name) {
  # 返回 @{ managed=$bool; alive=$bool; healthy=$bool; pid=$int }
  $pidVal = Read-PidFile $AppDefs[$Name].pid
  $managed = ($pidVal -gt 0)
  $alive = $managed -and (Test-Alive $pidVal)
  $state = @{ managed = $managed; alive = $alive; pid = $pidVal }
  switch ($Name) {
    'api'    { $state.healthy = Test-HttpOk "$ApiBase/health" 3 }
    'worker' { $state.healthy = $false; if ($alive) { $state.healthy = (Get-LastLogLine $AppDefs.worker.log 60) -match 'READY' } }
    'web'    { $state.healthy = Test-HttpOk $WebUrl 3 }
  }
  return $state
}

# ---------------------------------------------------------------- 各命令
function Test-Command-Start() {
  $title = @"
========================================
 GeoLens 本地开发环境 (DX1 Control Center)
========================================
"@
  Write-Info $title
  Log-File '=== START ==='
  New-Item -ItemType Directory -Force -Path $RuntimeDir, $LogsDir, $NativeTmpDir | Out-Null
  $steps = 0

  # [1/8] Node 24
  $steps++
  try { $nodeVer = Resolve-Node; Write-Ok "[$steps/8] Node 24 ............. OK ($nodeVer)" }
  catch { Write-Fail "[$steps/8] Node 24 ............. FAILED"; Write-Fail "  $($_.Exception.Message)"; throw }

  # 解析 pnpm（构建用）
  $pnpm = $null
  try { $pnpm = Resolve-PnpmMjs; Write-Info "  pnpm CLI: $($pnpm.mjs) (v$($pnpm.version))" } catch { Write-Warn "  $($_.Exception.Message)（将尝试直接构建）" }

  # [2/8] Docker Engine
  $steps++
  if (-not (Get-DockerServerUp)) {
    Write-Fail "[$steps/8] Docker Engine ....... DOWN"
    while ($true) {
      Write-Warn "========================================"
      Write-Warn "Docker Desktop 尚未启动"
      Write-Warn ""
      Write-Warn "请手动打开 Docker Desktop，"
      Write-Warn "等状态变为 Running 后，再按任意键继续。"
      Write-Warn "========================================"
      if ($NoPrompt) { throw 'Docker Engine 不可用（NoPrompt 模式不等待）。' }
      [void][Console]::ReadKey($true)
      if (Get-DockerServerUp) { break }
    }
    Write-Ok "[$steps/8] Docker Engine ....... OK"
  } else {
    Write-Ok "[$steps/8] Docker Engine ....... OK"
  }

  # [3/8] PostgreSQL（compose up -d -> healthy）
  $steps++
  try {
    $composeFile = Join-Path $RootDir 'docker-compose.yml'
    Write-Info "  docker compose up -d（输出写入 docker-compose.log）..."
    $coOutLog = Join-Path $LogsDir 'docker-compose.log'
    $coErrLog = Join-Path $LogsDir 'docker-compose.err.log'
    # compose 的 progress/status 走 stderr 属正常：只按 ExitCode 判成败。
    $cr = Invoke-NativeProcess -FilePath 'docker' `
      -ArgumentList @('compose', '-f', $composeFile, 'up', '-d') `
      -StdoutFile $coOutLog -StderrFile $coErrLog
    Add-Content -LiteralPath $coOutLog -Value ("`n{0}  exit={1}" -f (Now-Str), $cr.ExitCode) -Encoding UTF8
    if ($cr.ExitCode -ne 0) {
      $errSum = Redact-Text $cr.Stderr
      if ($errSum.Length -gt 600) { $errSum = $errSum.Substring(0, 600) }
      if (-not $errSum.Trim()) { $errSum = (Get-LastLogLine $coOutLog 400) }
      throw "docker compose up 失败（exit=$($cr.ExitCode)）：$errSum"
    }
    $pgWait = Wait-ContainerHealthy 'geo-postgres' 120
    if (-not $pgWait.ok) {
      $detail = "status=$($pgWait.status)，inspect exit=$($pgWait.exitCode)"
      if ($pgWait.stderr) { $detail += "；stderr: $($pgWait.stderr)" }
      throw "PostgreSQL 未在 120s 内 healthy（$detail，等待 $($pgWait.waitedSec)s；详见 docker-compose.err.log）"
    }
    Write-Ok "[$steps/8] PostgreSQL .......... HEALTHY"
  } catch {
    Write-Fail "[$steps/8] PostgreSQL .......... FAILED"
    Write-Fail "  $($_.Exception.Message)"
    throw
  }

  # [4/8] Redis（healthy + PONG）
  $steps++
  $rdWait = Wait-ContainerHealthy 'geo-redis' 60
  if (-not $rdWait.ok) {
    $detail = "status=$($rdWait.status)，inspect exit=$($rdWait.exitCode)"
    if ($rdWait.stderr) { $detail += "；stderr: $($rdWait.stderr)" }
    Write-Fail "[$steps/8] Redis ............... FAILED（$detail）"
    throw 'Redis 容器未 healthy'
  }
  $pong = Get-RedisPong
  if (-not $pong.ok) {
    Write-Fail "[$steps/8] Redis ............... FAILED（redis-cli ping：exit=$($pong.exitCode) stdout=[$($pong.stdout)] stderr=[$($pong.stderr)]）"
    throw 'Redis PONG 失败'
  }
  Write-Ok "[$steps/8] Redis ............... HEALTHY (PONG)"

  # 幂等：已由 DX1 启动则跳过启动
  $started = @{ api = $null; worker = $null; web = $null }
  $apiState = Get-AppRuntimeState 'api'
  $workerState = Get-AppRuntimeState 'worker'
  $webState = Get-AppRuntimeState 'web'

  # [5/8] API
  $steps++
  if ($apiState.alive -and $apiState.healthy) {
    Write-Ok "[$steps/8] API ................. RUNNING (PID $($apiState.pid))"
  } elseif (Test-HttpOk "$ApiBase/health" 2) {
    Write-Warn "[$steps/8] API ................. 端口 $ApiPort 已被外部实例占用（非本工具启动），跳过启动"
    $started.api = @{ pid = 0; marker = ''; startedAt = (Now-Str); note = 'foreign' }
  } else {
    if ($apiState.alive) { Write-Warn "  API PID $($apiState.pid) 存活但 /health 未通过，先停止后重启。" }
    try {
      if ($pnpm) { Build-Package 'api' ([ref]$pnpm) }
      $p = Start-App-Background 'api'
      $started.api = @{ pid = $p.pid; marker = $p.marker; startedAt = $p.startedAt; note = 'started' }
      $okApi = Wait-Until ({ Test-HttpOk "$ApiBase/health" 3 }) 90 'api health'
      if (-not $okApi) { throw 'API /health 未在 90s 内就绪' }
      Write-Ok "[$steps/8] API ................. RUNNING (PID $($p.pid))"
    } catch {
      Write-Fail "[$steps/8] API ................. FAILED"
      Write-Fail "  最后日志：$(Get-LastLogLine $AppDefs.api.log 200)"
      Write-Fail "  错误日志：$(Get-LastLogLine $AppDefs.api.err 200)"
      throw
    }
  }

  # [6/8] Worker
  $steps++
  if ($workerState.alive) {
    Write-Ok "[$steps/8] Worker .............. READY (PID $($workerState.pid))"
  } else {
    # 防双消费：扫描非本工具、同样消费 monitor-runs 队列的 node dist/main.js 实例。
    $apiListener = Get-ListeningPid $ApiPort
    $foreign = @(Find-ForeignWorkers $apiListener $apiState.pid $workerState.pid)
    if ($foreign.Count -gt 0) {
      Write-Warn "[$steps/8] Worker .............. 检测到其它 Worker 实例 (PID: $($foreign -join ', '))"
      Write-Warn "  为避免双消费同一队列，本工具不启动第二个 Worker。"
      Write-Warn "  请先手动停止上述实例后，再次双击 START_GEOLENS.cmd。"
      $started.worker = @{ pid = 0; marker = ''; startedAt = (Now-Str); note = "foreign:$($foreign -join ',')" }
    } else {
      try {
        if ($pnpm) { Build-Package 'worker' ([ref]$pnpm) }
        $p = Start-App-Background 'worker'
        $started.worker = @{ pid = $p.pid; marker = $p.marker; startedAt = $p.startedAt; note = 'started' }
        $okW = Wait-Until ({ (Get-Content -LiteralPath $AppDefs.worker.log -Tail 5 -ErrorAction SilentlyContinue | Out-String) -match 'READY' }) 60 'worker ready'
        if (-not $okW) { Write-Warn "  Worker PID $($p.pid) 已启动但 60s 内未见 READY 标记（继续等待将超时），请查看 worker.log" }
        Write-Ok "[$steps/8] Worker .............. READY (PID $($p.pid))"
      } catch {
        Write-Fail "[$steps/8] Worker .............. FAILED"
        Write-Fail "  最后日志：$(Get-LastLogLine $AppDefs.worker.log 200)"
        throw
      }
    }
  }

  # [7/8] Web
  $steps++
  if ($webState.alive) {
    Write-Ok "[$steps/8] Web ................. RUNNING (PID $($webState.pid))"
  } elseif (Test-HttpOk $WebUrl 2) {
    Write-Warn "[$steps/8] Web ................. 端口 $WebPort 已被外部实例占用（非本工具启动），跳过启动"
    $started.web = @{ pid = 0; marker = ''; startedAt = (Now-Str); note = 'foreign' }
  } else {
    try {
      $p = Start-App-Background 'web'
      $started.web = @{ pid = $p.pid; marker = $p.marker; startedAt = $p.startedAt; note = 'started' }
      Write-Info "  等待 Next.js 首次编译（最多 240s）..."
      $okWeb = Wait-Until ({ Test-HttpOk $WebUrl 5 }) 240 'web ready'
      if (-not $okWeb) { Write-Warn "  Web PID $($p.pid) 已启动但 240s 内未返回 HTTP 200，请查看 web.log" }
      Write-Ok "[$steps/8] Web ................. RUNNING (PID $($p.pid))"
    } catch {
      Write-Fail "[$steps/8] Web ................. FAILED"
      Write-Fail "  最后日志：$(Get-LastLogLine $AppDefs.web.log 200)"
      throw
    }
  }

  Save-Meta $started

  # 刷新 .runtime/status.json（页面 SYSTEM STATUS 的 infra/错误摘要数据源）
  try { Update-StatusSnapshot | Out-Null } catch { Write-Warn "  状态快照写入失败（不影响运行）：$($_.Exception.Message)" }

  # [8/8] Control Center
  $steps++
  if ((Test-HttpOk $WebUrl 3) -and (Test-HttpOk "$ApiBase/health" 3)) {
    Write-Ok "[$steps/8] Control Center ...... READY"
  } else {
    Write-Warn "[$steps/8] Control Center ...... 服务未完全就绪（Web 或 API 不可达）"
  }

  Write-Info ""
  Write-Ok "========================================"
  Write-Ok " GeoLens 已启动。"
  Write-Ok "========================================"
  Write-Info ""
  Write-Info "浏览器："
  Write-Info "  $CtrlUrl"
  Write-Info ""
  Write-Info "日志目录：$LogsDir"
  Write-Info "（详细日志只写文件，不污染本窗口）"

  if (-not $NoPrompt) {
    Write-Info ""
    Write-Info "按任意键打开 Control Center ..."
    [void][Console]::ReadKey($true)
  }
  Invoke-OpenControlCenter
  Log-File '=== START DONE ==='
}

function Test-Command-Stop([switch]$AlsoCompose) {
  Write-Info "========================================"
  Write-Info " GeoLens 停止 (DX1)"
  Write-Info "========================================"
  Log-File '=== STOP ==='
  foreach ($name in @('web', 'api', 'worker')) {
    $r = Stop-AppTree $name $AppDefs[$name].marker
    $label = $name.ToUpper().PadRight(7)
    if ($r.ok) { Write-Ok "$label $($r.note)" } else { Write-Warn "$label $($r.note)" }
  }
  if ($AlsoCompose) {
    Write-Info "  docker compose stop（保留数据卷与容器定义）..."
    $sOutLog = Join-Path $LogsDir 'docker-compose-stop.log'
    $sErrLog = Join-Path $LogsDir 'docker-compose-stop.err.log'
    $sr = Invoke-NativeProcess -FilePath 'docker' `
      -ArgumentList @('compose', '-f', (Join-Path $RootDir 'docker-compose.yml'), 'stop') `
      -StdoutFile $sOutLog -StderrFile $sErrLog
    Add-Content -LiteralPath $sOutLog -Value ("`n{0}  exit={1}" -f (Now-Str), $sr.ExitCode) -Encoding UTF8
    if ($sr.ExitCode -ne 0) {
      Write-Warn "  docker compose stop 返回非零（exit=$($sr.ExitCode)），详见 $sOutLog / $sErrLog"
    } else {
      Write-Ok "  PostgreSQL / Redis 已停止（容器保留）。"
    }
  } else {
    Write-Ok "  PostgreSQL / Redis 保留运行（如需一并停止请用 stop-all）。"
  }
  Write-Ok "  Docker Desktop 未受影响。"
  # 清空 status 快照中过期的进程态
  Update-StatusSnapshot
  Log-File '=== STOP DONE ==='
}

function Update-StatusSnapshot() {
  $snap = @{
    updatedAt  = (Now-Str)
    generatedBy = 'dev-control.ps1'
    projectStatusFile = $ProjectJson
  }
  $snap.node = (Resolve-Node)
  $ds = Get-DockerServerUp
  $snap.dockerServer = $ds
  $snap.infrastructure = @{
    postgres = if ($ds) { (Get-ContainerStatus 'geo-postgres').status } else { 'DOWN' }
    redis    = if ($ds) { (Get-ContainerStatus 'geo-redis').status } else { 'DOWN' }
    redisPong = if ($ds) { (Get-RedisPong).ok } else { $false }
  }
  $snap.apps = @{}
  foreach ($name in @('web', 'api', 'worker')) {
    $s = Get-AppRuntimeState $name
    $snap.apps[$name] = @{ pid = $s.pid; alive = $s.alive; healthy = $s.healthy }
  }
  $snap.apiHealth  = (Test-HttpOk "$ApiBase/health" 3)
  $snap.dbHealth   = $false
  if ($snap.apiHealth) {
    try {
      $r = Invoke-WebRequest -Uri "$ApiBase/health/db" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
      $j = $r.Content | ConvertFrom-Json
      $snap.dbHealth = ($j.status -eq 'ok')
    } catch { $snap.dbHealth = $false }
  }
  $envRe  = Get-DotEnvValue $EnvFile 'ENABLE_REAL_PROVIDERS'
  $key    = Get-DotEnvValue $EnvFile 'DEEPSEEK_API_KEY'
  $snap.config = @{
    realProvidersEnabled = ($envRe -eq 'true' -or $envRe -eq '1')
    deepseekConfigured   = (-not [string]::IsNullOrWhiteSpace($key))
  }
  $snap.lastApiError    = (Get-LastLogLine $AppDefs.api.err 200)
  $snap.lastWorkerError = (Get-LastLogLine $AppDefs.worker.err 200)
  try { Set-Content -LiteralPath $StatusJson -Value ($snap | ConvertTo-Json -Depth 5) -Encoding UTF8 } catch {}
  return $snap
}

function Read-CurrentMilestone() {
  if (-not (Test-Path -LiteralPath $ProjectJson)) { return @{ currentMilestone = '?'; name = '未找到 project-status.json'; status = '?'; gitHead = $null; updatedAt = $null } }
  try {
    $j = Get-Content -LiteralPath $ProjectJson -Raw | ConvertFrom-Json
    $m = $j.milestones | Where-Object { $_.id -eq $j.currentMilestone } | Select-Object -First 1
    if (-not $m) { $m = $null }
    return @{
      currentMilestone = $j.currentMilestone
      name = if ($m) { $m.name } else { '(milestone 未找到)' }
      status = if ($m) { $m.status } else { '?' }
      gitHead = if ($j.git) { $j.git.head } else { $null }
      updatedAt = $j.updatedAt
    }
  } catch { return @{ currentMilestone = '?'; name = '解析失败'; status = '?'; gitHead = $null; updatedAt = $null } }
}

function Test-Command-Status() {
  Write-Info "========================================"
  Write-Info " GeoLens Runtime Status"
  Write-Info "========================================"
  $s = Update-StatusSnapshot

  $mk = @{ RUNNING = 'RUNNING'; DOWN = 'DOWN'; READY = 'READY' }
  $webL = if ($s.apps.web.healthy) { 'RUNNING' } elseif ($s.apps.web.alive) { 'STARTING' } else { 'DOWN' }
  $apiL = if ($s.apiHealth) { 'RUNNING' } elseif ($s.apps.api.alive) { 'STARTING' } else { 'DOWN' }
  $wkL  = if ($s.apps.worker.alive -and $s.apps.worker.healthy) { 'READY' } elseif ($s.apps.worker.alive) { 'STARTING' } else { 'DOWN' }
  $pgL  = if ($s.infrastructure.postgres -eq 'healthy') { 'HEALTHY' } else { 'DOWN' }
  $rdL  = if ($s.infrastructure.redis -eq 'healthy' -and $s.infrastructure.redisPong) { 'HEALTHY' } else { 'DOWN' }
  $apiH = if ($s.apiHealth) { 'PASS' } else { 'FAIL' }
  $dbH  = if ($s.dbHealth) { 'PASS' } else { 'FAIL' }

  $rows = @(
    @{ n = 'Web';       v = $webL },
    @{ n = 'API';       v = $apiL },
    @{ n = 'Worker';    v = $wkL },
    @{ n = 'Postgres';  v = $pgL },
    @{ n = 'Redis';     v = $rdL },
    @{ n = 'API Health'; v = $apiH },
    @{ n = 'DB Health';  v = $dbH }
  )
  foreach ($r in $rows) {
    $color = switch ($r.v) { 'RUNNING' { 'Green' } 'READY' { 'Green' } 'HEALTHY' { 'Green' } 'PASS' { 'Green' } default { if ($r.v -eq 'STARTING') { 'Yellow' } else { 'Red' } } }
    Write-Host ("  {0,-12} {1}" -f $r.n, $r.v) -ForegroundColor $color
  }

  $mc = Read-CurrentMilestone
  Write-Info ""
  Write-Info ("  Current Milestone : {0} — {1} ({2})" -f $mc.currentMilestone, $mc.name, $mc.status)
  if ($mc.gitHead) { Write-Info ("  Git HEAD          : {0}" -f $mc.gitHead) }
  if ($mc.updatedAt) { Write-Info ("  project-status    : 更新于 {0}" -f $mc.updatedAt) }
  Write-Info ""
  Write-Info ("  Real Providers    : {0}" -f ($(if ($s.config.realProvidersEnabled) { 'Enabled' } else { 'Disabled' })))
  Write-Info ("  DeepSeek          : {0}" -f ($(if ($s.config.deepseekConfigured) { 'Configured (YES)' } else { 'Not configured (NO)' })))
  if ($s.lastApiError) { Write-Info "  Last API Error    : $($s.lastApiError)" }
  if ($s.lastWorkerError) { Write-Info "  Last Worker Error : $($s.lastWorkerError)" }

  Write-Info ""
  Write-Info "快照已写入：$StatusJson"

  if (-not $NoPrompt) {
    Write-Info ""
    Write-Info "按任意键打开 Control Center（http://localhost:3000/dev/status）..."
    [void][Console]::ReadKey($true)
    Invoke-OpenControlCenter
  } elseif ($OpenBrowser) {
    Invoke-OpenControlCenter
  }
}

function Test-Command-Help() {
  Write-Info @'
GeoLens Dev Control Center (DX1)
用法：
  .\scripts\dev-control.ps1 start       一键启动（推荐双击根目录 START_GEOLENS.cmd）
  .\scripts\dev-control.ps1 stop        停止 Web/API/Worker（保留 PG/Redis/Docker）
  .\scripts\dev-control.ps1 stop-all    停止全部服务（docker compose stop，不动 Docker Desktop）
  .\scripts\dev-control.ps1 status      实时状态并刷新 .runtime/status.json
  .\scripts\dev-control.ps1 restart     stop + start
可选参数：-NoPrompt（不等待按键） -OpenBrowser（status 后直接开浏览器）
'@
}

# ---------------------------------------------------------------- 入口
try {
  New-Item -ItemType Directory -Force -Path $RuntimeDir, $LogsDir, $NativeTmpDir | Out-Null
  # 允许 .env 的 API_PORT 覆盖（默认 3001）
  $envApiPort = Get-DotEnvValue $EnvFile 'API_PORT'
  if ($envApiPort -and $envApiPort -match '^\d+$') {
    $ApiPort = [int]$envApiPort
    $ApiBase = "http://127.0.0.1:$ApiPort"
  }
  if ($Command -eq 'start') { Test-Command-Start }
  elseif ($Command -eq 'stop') { Test-Command-Stop -AlsoCompose:$false }
  elseif ($Command -eq 'stop-all') { Test-Command-Stop -AlsoCompose:$true }
  elseif ($Command -eq 'status') { Test-Command-Status }
  elseif ($Command -eq 'restart') { Test-Command-Stop -AlsoCompose:$false; Test-Command-Start }
  else { Test-Command-Help }
  exit 0
} catch {
  Write-Fail ''
  Write-Fail ('[DX1] ' + $_.Exception.Message)
  Log-File ('ERROR: ' + $_.Exception.Message)
  exit 1
}
