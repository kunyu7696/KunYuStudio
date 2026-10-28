@echo off
chcp 65001 >nul
cd /d %~dp0
echo ============================================
echo   KunYu Studio - 启动开发模式
echo ============================================
if not exist node_modules (
  echo [首次运行] 正在安装依赖，请稍候...
  call npm.cmd ci
  if errorlevel 1 (
    echo 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)
call npm.cmd run dev
pause
