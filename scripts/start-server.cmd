@echo off
cd /d "%~dp0.."
title AI优选零食 · 后端 :3100
echo 正在启动后端…（关掉这个窗口即停止）
pnpm dev:server
