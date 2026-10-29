@echo off
rem Starts Rocco (rocco\README.md) and opens it on this project. One Rocco serves every project in the
rem RoDev folder; leave this window open while you use it.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0rocco.ps1" serve -Open
pause
