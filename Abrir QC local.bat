@echo off
chcp 65001 >nul
title QC Unita - dev local
cd /d "%~dp0qc-unita"

set "BR=?"
set "VER=?"
for /f "delims=" %%b in ('git branch --show-current 2^>nul') do set "BR=%%b"
for /f "delims=" %%v in ('git describe --tags --always 2^>nul') do set "VER=%%v"

echo.
echo   QC Unita - ambiente local
echo   branch: %BR%   versao: %VER%
echo.

rem Se o app ja estiver rodando, so abre o navegador.
netstat -ano | findstr /r /c:":5173 .*LISTENING" >nul
if %errorlevel%==0 (
  echo   O app ja esta aberto. Abrindo o navegador...
  start "" http://localhost:5173
  timeout /t 3 >nul
  exit /b 0
)

if not exist node_modules (
  echo   Instalando dependencias pela primeira vez...
  call npm install
  if errorlevel 1 goto erro
)

echo   Subindo o app em http://localhost:5173
echo   Para fechar, feche esta janela ou aperte Ctrl+C.
echo.
call npm run dev -- --open --strictPort
if errorlevel 1 goto erro
exit /b 0

:erro
echo.
echo   Algo deu errado ao abrir o app. Veja a mensagem acima.
pause
