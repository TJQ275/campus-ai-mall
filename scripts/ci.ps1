<#
.SYNOPSIS
  本地 CI 门禁：一次跑完静态检查、测试、AI 评测，任何一项不过就整体失败。

.DESCRIPTION
  为什么要有这个脚本：
  项目里能跑的东西越来越多（typecheck / lint / 152 项测试 / 57 条 AI 评测），
  全靠人记着一条条跑，早晚会漏。把它收敛成一条命令，
  本地提交前跑一次、CI 上跑一次，标准就统一了。

  关于 AI 评测这一步：
    - 有 API Key 时跑真实模型，并用 --fail-on-regression 和基线对比，
      指标退步就卡住 —— 这是「改 prompt 不能凭感觉」的落地方式。
    - 没配 Key 时走 MockProvider，指标会很低，**这时候只跑不卡**，
      因为规则引擎本来接不住这些问法，卡它没有意义。

.PARAMETER SkipEval
  跳过 AI 评测（只跑静态检查与测试）。评测要花模型钱和时间。

.PARAMETER Scene
  只评测某个场景，便于快速验证。取值 shopping / support / merchant。
#>
param(
  [switch]$SkipEval,
  [string]$Scene = ''
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$failed = New-Object System.Collections.Generic.List[string]

function Step([string]$name, [scriptblock]$action) {
  Write-Host ''
  Write-Host ('─' * 60) -ForegroundColor DarkGray
  Write-Host "▶ $name" -ForegroundColor Cyan
  Write-Host ('─' * 60) -ForegroundColor DarkGray
  & $action
  if ($LASTEXITCODE -ne 0) {
    $failed.Add($name)
    Write-Host "✗ $name 失败（exit $LASTEXITCODE）" -ForegroundColor Red
  } else {
    Write-Host "✓ $name 通过" -ForegroundColor Green
  }
}

Step '类型检查' { pnpm typecheck }
Step '代码规范' { pnpm lint }
Step '单元测试' { pnpm --filter @campus/server test:unit }
Step '全链路验收' { pnpm test:acceptance }
Step '并发与资金加固' { pnpm test:hardening }
Step '小程序端' { pnpm test:miniapp }

if (-not $SkipEval) {
  # 有真实 Key 才用退步门禁卡；Mock 模式下评测分数天然很低，卡它没有意义
  $hasKey = $false
  try {
    $envFile = Join-Path $root '.env'
    if (Test-Path $envFile) {
      $hasKey = [bool](Get-Content $envFile | Where-Object { $_ -match '^\s*LLM_API_KEY\s*=\s*\S' })
    }
  } catch { }

  $evalArgs = @('--', '--verbose')
  if ($Scene) { $evalArgs += "--scene=$Scene" }
  if ($hasKey) {
    $evalArgs += '--fail-on-regression'
    Write-Host ''
    Write-Host '  检测到 LLM_API_KEY：评测将启用「指标退步即失败」门禁' -ForegroundColor Yellow
  } else {
    Write-Host ''
    Write-Host '  未检测到 LLM_API_KEY：评测走本地规则引擎，只跑不卡（分数低是正常的）' -ForegroundColor Yellow
  }

  Step 'AI 评测' { pnpm ai:eval @evalArgs }
}

Write-Host ''
Write-Host ('═' * 60) -ForegroundColor DarkGray
if ($failed.Count) {
  Write-Host "CI 未通过，失败项：" -ForegroundColor Red
  foreach ($f in $failed) { Write-Host "  ✗ $f" -ForegroundColor Red }
  exit 1
}
Write-Host 'CI 全部通过 ✅' -ForegroundColor Green
