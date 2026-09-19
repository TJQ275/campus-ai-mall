<#
.SYNOPSIS
  启动重排服务（默认 3200 端口）。

.DESCRIPTION
  后端通过 RERANK_BASE_URL 找到它。服务没起时后端会自动跳过重排，
  所以不启动也不影响主流程，只是检索排序质量差一些。
#>
param([int]$Port = 3200)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

Write-Host "重排服务启动中… http://127.0.0.1:$Port" -ForegroundColor Cyan
Write-Host "健康检查: http://127.0.0.1:$Port/health" -ForegroundColor DarkGray
Write-Host "接口文档: http://127.0.0.1:$Port/docs" -ForegroundColor DarkGray
Write-Host ""

python -m uvicorn app.main:app --host 127.0.0.1 --port $Port
