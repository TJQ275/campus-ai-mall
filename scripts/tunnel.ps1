<#
.SYNOPSIS
  把本机后端暴露到公网，手机在任何网络（流量 / 别家 WiFi）都能访问。

.DESCRIPTION
  用 SSH 反向隧道，**不用注册、不用实名、不用买域名**，跑起来就给一个 https 地址。

  为什么不用 Cloudflare 快速隧道？
  本机实测运营商封了 7844 端口（UDP + TCP 都封），那是 cloudflared 的专用端口。
  表现很迷惑：隧道显示"建立成功"、也能拿到 trycloudflare.com 网址，但一访问就是 HTTP 530。
  详见 docs/09-公网访问.md。

  localhost.run 走标准 SSH 22 端口，本机实测完全可用。

.PARAMETER Apply
  把拿到的公网地址写进 apps/miniapp/config.js（prod 槽位 + FORCE_ENV='prod'）。

.PARAMETER Stop
  停掉正在运行的隧道。

.PARAMETER Status
  看当前隧道状态。

.PARAMETER Port
  后端端口，默认 3100。

.EXAMPLE
  pwsh -File scripts/tunnel.ps1 -Apply     # 起隧道 + 自动配好小程序
  pwsh -File scripts/tunnel.ps1 -Status    # 看看还在不在
  pwsh -File scripts/tunnel.ps1 -Stop      # 关掉
#>
param(
  [switch]$Apply,
  [switch]$Stop,
  [switch]$Status,
  [switch]$Yes,
  [int]$Port = 3100
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$toolsDir = Join-Path $root 'tools'
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
$stateFile = Join-Path $toolsDir 'tunnel-state.json'
$logFile = Join-Path $toolsDir 'tunnel.log'

function Get-State {
  if (Test-Path $stateFile) {
    try { return Get-Content $stateFile -Raw | ConvertFrom-Json } catch { return $null }
  }
  return $null
}

# ---------- -Stop ----------
if ($Stop) {
  $st = Get-State
  if (-not $st) { Write-Host '没有正在运行的隧道。' -ForegroundColor Yellow; exit 0 }
  $killed = 0
  Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*localhost.run*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $killed++ }
  if ($killed) { Write-Host "已关闭隧道（$killed 个 ssh 进程）" -ForegroundColor Green }
  else { Write-Host '隧道进程已经不在了。' -ForegroundColor Yellow }
  Remove-Item $stateFile -Force -ErrorAction SilentlyContinue
  exit 0
}

# ---------- -Status ----------
if ($Status) {
  $st = Get-State
  if (-not $st) { Write-Host '当前没有隧道。' -ForegroundColor Yellow; exit 0 }
  $alive = Get-Process -Id $st.pid -ErrorAction SilentlyContinue
  if (-not $alive) { Write-Host '隧道已失效（进程不在了），重新跑一次不带参数的命令即可。' -ForegroundColor Yellow; exit 0 }
  Write-Host "隧道运行中 (PID $($st.pid))" -ForegroundColor Green
  Write-Host "  地址: $($st.url)" -ForegroundColor Cyan
  try {
    $h = Invoke-RestMethod "$($st.url)/api/health" -TimeoutSec 10
    Write-Host "  自检: 数据库 $($h.data.db.driver)，$($h.data.db.tables) 张表" -ForegroundColor Green
  } catch { Write-Host "  自检失败: $($_.Exception.Message.Split([char]10)[0])" -ForegroundColor Red }
  exit 0
}

# ---------- 0. 后端在跑吗 ----------
try {
  $health = Invoke-RestMethod "http://localhost:$Port/api/health" -TimeoutSec 5
  Write-Host "[1/4] 后端正常：数据库 $($health.data.db.driver)，$($health.data.db.tables) 张表" -ForegroundColor Green
} catch {
  Write-Host "[1/4] 后端没有响应（http://localhost:$Port）" -ForegroundColor Red
  Write-Host '      先启动它：pnpm dev:server' -ForegroundColor Yellow
  exit 1
}

# ---------- 1. 安全提醒 ----------
Write-Host ''
Write-Host '  ⚠  隧道一开，全世界都能访问你的管理后台。' -ForegroundColor Yellow
Write-Host '     默认账号 admin / admin123 写在所有文档里 —— 公开等于送人。' -ForegroundColor Yellow
Write-Host '     改密码：pnpm --filter @campus/server admin:password 你的新密码' -ForegroundColor Cyan
Write-Host ''
$ans = if ($Yes) { 'y' } else { Read-Host '已经改过密码，或只是临时给人看一眼？(y/N)' }
if ($ans -notmatch '^[Yy]') { Write-Host '已取消。' -ForegroundColor Yellow; exit 0 }

# ---------- 2. 先关掉旧隧道 ----------
$old = Get-State
if ($old -and (Get-Process -Id $old.pid -ErrorAction SilentlyContinue)) {
  Write-Host "[2/4] 关掉上一个隧道（PID $($old.pid)）" -ForegroundColor DarkGray
  Stop-Process -Id $old.pid -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

# ---------- 3. 起 SSH 反向隧道 ----------
$ssh = (Get-Command ssh -ErrorAction SilentlyContinue).Source
if (-not $ssh) {
  Write-Host '[3/4] 找不到 ssh 命令。' -ForegroundColor Red
  Write-Host '      Windows 设置 → 应用 → 可选功能 → 添加「OpenSSH 客户端」' -ForegroundColor Yellow
  exit 1
}

if (Test-Path $logFile) { Remove-Item $logFile -Force }
$errFile = "$logFile.err"

Write-Host '[3/4] 正在建立隧道（localhost.run，走 SSH 22 端口）…' -ForegroundColor Cyan

# -T 必须加：不给 TTY 才会打印地址横幅，否则连上了也看不到网址
$sshArgs = @(
  '-T',
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=/dev/null',
  '-o', 'BatchMode=yes',
  '-o', 'ServerAliveInterval=30',
  '-R', "80:localhost:$Port",
  'nokey@localhost.run'
)
# 用 Start-Process 启动 ssh。
# 注意别改成 cmd /c "ssh ... > log"：那样 ssh 的 stdout 是块缓冲的文件句柄，
# 地址横幅会卡在缓冲区里不刷出来，脚本就永远等不到 URL（这个坑踩过一次）。
$proc = Start-Process -FilePath $ssh -ArgumentList $sshArgs -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput $logFile -RedirectStandardError $errFile

$publicUrl = $null
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $logFile) {
    $hit = Select-String -Path $logFile -Pattern 'https://[a-z0-9]+\.lhr\.life' -ErrorAction SilentlyContinue |
           Select-Object -First 1
    if ($hit) { $publicUrl = $hit.Matches[0].Value; break }
  }
  if ($proc.HasExited) { break }
}

if (-not $publicUrl) {
  Write-Host '[3/4] 没能拿到公网地址。' -ForegroundColor Red
  foreach ($f in @($logFile, $errFile)) {
    if (Test-Path $f) { Write-Host "      --- $([IO.Path]::GetFileName($f)) ---" -ForegroundColor DarkGray; Get-Content $f -Tail 15 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray } }
  }
  if (-not $proc.HasExited) { Write-Host "      ssh 仍在运行 (PID $($proc.Id))，先留着；要关就 pwsh -File scripts/tunnel.ps1 -Stop" -ForegroundColor DarkGray }
  exit 1
}

# ---------- 4. 自检：公网地址真的能打到后端吗 ----------
Write-Host '[4/4] 自检中…' -ForegroundColor Cyan
$verified = $false
foreach ($i in 1..5) {
  Start-Sleep -Seconds 3
  try {
    $h = Invoke-RestMethod "$publicUrl/api/health" -TimeoutSec 20
    if ([int]$h.data.db.tables -gt 0) { $verified = $true; break }
  } catch { }
}

@{ pid = $proc.Id; url = $publicUrl; startedAt = (Get-Date).ToString('s') } | ConvertTo-Json | Set-Content $stateFile

if ($verified) { Write-Host '      自检通过：公网地址确实连到了你的后端' -ForegroundColor Green }
else { Write-Host '      自检没通过，可能要多等几秒。地址先给你，稍后自己刷新试试。' -ForegroundColor Yellow }

Write-Host ''
Write-Host '  ┌──────────────────────────────────────────────────────────────┐' -ForegroundColor Green
Write-Host '    管理后台 —— 手机浏览器直接打开，**不需要连你家 WiFi**：' -ForegroundColor White
Write-Host "      $publicUrl/" -ForegroundColor Cyan
Write-Host ''
Write-Host '    小程序接口地址：' -ForegroundColor White
Write-Host "      $publicUrl/api" -ForegroundColor Cyan
Write-Host '  └──────────────────────────────────────────────────────────────┘' -ForegroundColor Green

if ($Apply) {
  $cfgPath = Join-Path $root 'apps\miniapp\config.js'
  $cfg = Get-Content $cfgPath -Raw
  # 注意：替换串必须用单引号。双引号里 PowerShell 会先把 $1 当变量插值成空串，
  # 结果只剩 URL、丢掉 "prod: '" 前缀（这个坑踩过一次）。
  $cfg = $cfg -replace "(?m)^(\s*prod:\s*')[^']*(')", ('$1' + $publicUrl + '/api$2')
  $cfg = $cfg -replace "(?m)^(const FORCE_ENV = ')[^']*(')", '$1prod$2'
  Set-Content $cfgPath -Value $cfg -NoNewline
  Write-Host ''
  Write-Host '  已写入 apps/miniapp/config.js：' -ForegroundColor Green
  Write-Host "    prod      = $publicUrl/api" -ForegroundColor Green
  Write-Host "    FORCE_ENV = 'prod'（模拟器和真机都走公网）" -ForegroundColor Green
  Write-Host ''
  Write-Host '  微信开发者工具里还要做一件事：' -ForegroundColor Yellow
  Write-Host '    详情 → 本地设置 → 勾选「不校验合法域名」' -ForegroundColor Yellow
  Write-Host '    （lhr.life 没备案，加不进「服务器域名」白名单）' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  用完想还原成局域网：把 FORCE_ENV 改回空字符串即可' -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '  常用命令：' -ForegroundColor DarkGray
Write-Host '    pwsh -File scripts/tunnel.ps1 -Status   看状态 + 自检' -ForegroundColor DarkGray
Write-Host '    pwsh -File scripts/tunnel.ps1 -Stop     关掉隧道' -ForegroundColor DarkGray
Write-Host "  日志：$logFile" -ForegroundColor DarkGray
Write-Host ''
Write-Host '  ⚠  这是临时地址：隧道一关就失效，重开会换一个新的。' -ForegroundColor Yellow
Write-Host '     要固定网址、要发布给别人用，见 deploy/README.md。' -ForegroundColor Yellow