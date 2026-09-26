@echo off
rem Lets PlayzAnime save to Desktop/Documents/Videos when Windows "Controlled folder access" is on.
rem Double-click it, or drag PlayzAnime.exe onto it for a portable copy.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0allow-folder-access.ps1" %*
