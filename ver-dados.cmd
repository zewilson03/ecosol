@echo off
cd /d "%~dp0"

set "NODE_EXE=node"
where node >nul 2>&1
if errorlevel 1 (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  ) else (
    echo Node.js nao foi encontrado. Instale o Node.js 24 ou superior.
    pause
    exit /b 1
  )
)

"%NODE_EXE%" backend\scripts\exportar-dados.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
