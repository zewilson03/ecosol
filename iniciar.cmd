@echo off
cd /d "%~dp0"

set "NODE_EXE=node"
where node >nul 2>&1
if errorlevel 1 (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  ) else (
    echo Node.js nao foi encontrado.
    echo Instale o Node.js 24 ou superior e abra um novo terminal no VS Code.
    pause
    exit /b 1
  )
)

if not exist "node_modules\vite\bin\vite.js" (
  echo Dependencias ausentes. Execute pnpm install no terminal do VS Code.
  pause
  exit /b 1
)

echo Iniciando a Ecosol em http://localhost:3000
"%NODE_EXE%" backend\servidor\iniciar.mjs
if errorlevel 1 (
  echo O servidor foi encerrado com erro. Veja a mensagem acima.
  pause
  exit /b 1
)
