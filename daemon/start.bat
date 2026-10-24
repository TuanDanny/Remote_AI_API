@echo off
title RemoteAI Local Daemon
echo Starting RemoteAI Daemon on Windows...
cd /d "%~dp0"
if not exist node_modules (
    echo Installing dependencies...
    call npm install
)
call npm run dev
pause
