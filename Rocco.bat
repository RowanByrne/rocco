@echo off
rem Starts Rocco (README.md) in the background, with no window, and opens it in the browser. One Rocco serves every
rem project in the RoDev folder; Settings has Quit. A project's tools\rocco.bat runs this with -Project and its folder name.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0rocco.ps1" start %*
if errorlevel 1 pause
