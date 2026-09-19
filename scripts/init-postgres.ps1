<#
  在已安装的 PostgreSQL 上准备业务账号与数据库（幂等，可重复执行）。

  用法：
    pwsh -File scripts/init-postgres.ps1 -PostgresPassword '<超级用户密码>'
  可选参数：-AppUser / -AppPassword / -Database / -PgBin / -HostName / -Port

  做四件事：
    1. 建业务角色 campus（已存在则跳过）
    2. 建数据库 campus_mall 并指定 owner
    3. 在库里 CREATE EXTENSION vector（需要超级用户，这也是本脚本要密码的原因）
    4. 用业务账号实际连一次，确认权限没问题，并打印可直接粘贴的 DATABASE_URL
#>
param(
  [Parameter(Mandatory = $true)][string]$PostgresPassword,
  [string]$AppUser = 'campus',
  [string]$AppPassword = 'campus',
  [string]$Database = 'campus_mall',
  [string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin',
  [string]$HostName = '127.0.0.1',
  [int]$Port = 5432
)

$ErrorActionPreference = 'Stop'
$psql = Join-Path $PgBin 'psql.exe'
if (-not (Test-Path $psql)) { throw "找不到 psql: $psql" }

function Invoke-Psql {
  param([string]$User, [string]$Password, [string]$Db, [string]$Sql)
  $env:PGPASSWORD = $Password
  $psqlArgs = @('-U', $User, '-h', $HostName, '-p', $Port, '-v', 'ON_ERROR_STOP=1', '-tAc', $Sql)
  if ($Db) { $psqlArgs = @('-U', $User, '-h', $HostName, '-p', $Port, '-d', $Db, '-v', 'ON_ERROR_STOP=1', '-tAc', $Sql) }
  $out = & $psql @psqlArgs 2>&1
  if ($LASTEXITCODE -ne 0) { throw "psql 执行失败: $out" }
  return ($out | Out-String).Trim()
}

Write-Host '[1/4] 检查并创建业务角色' -ForegroundColor Cyan
$roleExists = Invoke-Psql -User 'postgres' -Password $PostgresPassword -Sql "select 1 from pg_roles where rolname = '$AppUser'"
if ($roleExists -eq '1') {
  Write-Host "      角色 $AppUser 已存在，跳过"
} else {
  Invoke-Psql -User 'postgres' -Password $PostgresPassword -Sql "CREATE ROLE $AppUser LOGIN PASSWORD '$AppPassword'" | Out-Null
  Write-Host "      已创建角色 $AppUser"
}

Write-Host '[2/4] 检查并创建数据库' -ForegroundColor Cyan
$dbExists = Invoke-Psql -User 'postgres' -Password $PostgresPassword -Sql "select 1 from pg_database where datname = '$Database'"
if ($dbExists -eq '1') {
  Write-Host "      数据库 $Database 已存在，跳过"
} else {
  Invoke-Psql -User 'postgres' -Password $PostgresPassword -Sql "CREATE DATABASE $Database OWNER $AppUser" | Out-Null
  Write-Host "      已创建数据库 $Database（owner=$AppUser）"
}

Write-Host '[3/4] 安装 vector 扩展' -ForegroundColor Cyan
Invoke-Psql -User 'postgres' -Password $PostgresPassword -Db $Database -Sql 'CREATE EXTENSION IF NOT EXISTS vector' | Out-Null
$version = (Invoke-Psql -User 'postgres' -Password $PostgresPassword -Db $Database -Sql "select extversion from pg_extension where extname = 'vector'") -split "`n" | Select-Object -Last 1
Write-Host "      pgvector 版本: $version"

Write-Host '[4/4] 用业务账号验证权限' -ForegroundColor Cyan
$check = Invoke-Psql -User $AppUser -Password $AppPassword -Db $Database -Sql "select current_user || ' @ ' || current_database() || ' | vector ' || (select extversion from pg_extension where extname='vector')"
Write-Host "      $check"
Write-Host "      建表测试: " -NoNewline
Invoke-Psql -User $AppUser -Password $AppPassword -Db $Database -Sql 'create table if not exists _perm_check(id int, v vector(3)); drop table _perm_check' | Out-Null
Write-Host '通过' -ForegroundColor Green

$env:PGPASSWORD = ''
Write-Host ''
Write-Host '完成。把下面两行写进 .env：' -ForegroundColor Green
Write-Host "  DB_DRIVER=postgres"
Write-Host "  DATABASE_URL=postgres://$AppUser`:$AppPassword@$HostName`:$Port/$Database"