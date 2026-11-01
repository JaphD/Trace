@echo off
node "%~dp0scripts\launch-trace.cjs" --stop
if errorlevel 1 pause
