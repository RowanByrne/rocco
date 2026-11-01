@echo off
rem Starts Rocco (README.md) and opens it in the browser. One Rocco serves every project in the RoDev folder; leave
rem this window open while you use it. A project's tools\rocco.bat runs this with -Project and its folder name.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0rocco.ps1" serve -Open %*
rem 3: Rocco updated itself and carries on in a new window.
if %errorlevel%==3 exit
pause
