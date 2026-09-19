@echo off
cd /d "%~dp0.."
title AI优选零食 · 管理后台 :5173
echo 正在启动管理后台…（关掉这个窗口即停止）
pnpm dev:admin
