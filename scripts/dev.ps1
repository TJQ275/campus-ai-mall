<#
  本地一键启动：后端 + 管理后台，各自开一个独立窗口。

  用法（在项目根目录）：
    pwsh -File scripts/dev.ps1
    pwsh -File scripts/dev.ps1 -Only server     # 只起后端

  为什么要单独开窗口：这样进程属于你自己的终端，不依赖任何外部工具会话，
  关掉窗口才会停。
#>
param(
  [ValidateSet('all', 'server', 'admin')][string]$Only = 'all'
)

$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'package.json'))) { throw "找不到项目根目录: $root" }

function Start-DevWindow {
  param([string]$Title, [string]$Command)
  Start-Process pwsh -ArgumentList @('-NoExit', '-Command', "`$host.UI.RawUI.WindowTitle = '$Title'; cd '$root'; $Command")
  Write-Host "  已启动: $Title" -ForegroundColor Green
}

Write-Host '启动开发服务…' -ForegroundColor Cyan
if ($Only -eq 'all' -or $Only -eq 'server') { Start-DevWindow -Title 'AI优选零食 · 后端 :3100' -Command 'pnpm dev:server' }
if ($Only -eq 'all' -or $Only -eq 'admin') { Start-DevWindow -Title 'AI优选零食 · 管理后台 :5173' -Command 'pnpm dev:admin' }

Write-Host ''
Write-Host '后端接口文档: http://localhost:3100/api/docs' -ForegroundColor Yellow
Write-Host '管理后台:     http://localhost:5173   (admin / admin123)' -ForegroundColor Yellow
Write-Host '小程序:       用微信开发者工具打开 apps/miniapp' -ForegroundColor Yellow
