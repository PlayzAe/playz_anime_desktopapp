<#
  Lets PlayzAnime save into folders guarded by Windows Defender "Controlled folder access"
  (Desktop, Documents, Videos, Pictures, Music).

  PlayzAnime asks for this itself on first run. Use this script if you skipped that, moved
  the app, or run the portable build:

    powershell -ExecutionPolicy Bypass -File allow-folder-access.ps1
    powershell -ExecutionPolicy Bypass -File allow-folder-access.ps1 "D:\Apps\PlayzAnime.exe"

  It only adds programs to Defender's allow list. It never turns the protection off.
#>
param([string[]]$Programs = @())

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  # Ask Windows for admin rights once, then run this same script again.
  $relaunch = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"") + ($Programs | ForEach-Object { "`"$_`"" })
  Start-Process powershell.exe -Verb RunAs -ArgumentList $relaunch
  exit
}

$repo = Split-Path -Parent $PSScriptRoot
$candidates = @(
  "$env:LOCALAPPDATA\Programs\PlayzAnime\PlayzAnime.exe",   # installer, per-user
  "$env:ProgramFiles\PlayzAnime\PlayzAnime.exe",            # installer, all users
  "$env:APPDATA\PlayzAnime\bin\ffmpeg.exe",                 # fetched on first episode download
  (Join-Path $repo 'node_modules\electron\dist\electron.exe'),  # start.bat (development)
  (Join-Path $repo 'release\win-unpacked\PlayzAnime.exe')
) + $Programs

$found = $candidates | Where-Object { $_ -and (Test-Path $_) } | ForEach-Object { (Resolve-Path $_).Path } | Select-Object -Unique

Write-Host ''
Write-Host 'PlayzAnime folder access' -ForegroundColor Cyan
$state = (Get-MpPreference).EnableControlledFolderAccess
switch ($state) {
  0 { Write-Host 'Controlled folder access is off. Nothing is blocked, but allowing PlayzAnime now means it keeps working if you turn it on later.' }
  1 { Write-Host 'Controlled folder access is on.' }
  2 { Write-Host 'Controlled folder access is in audit mode (logs only, blocks nothing).' }
}

if (-not $found) {
  Write-Host 'No PlayzAnime programs found. Pass the path to PlayzAnime.exe, for example:' -ForegroundColor Yellow
  Write-Host '  allow-folder-access.ps1 "D:\Apps\PlayzAnime.exe"'
} else {
  foreach ($p in $found) {
    try {
      Add-MpPreference -ControlledFolderAccessAllowedApplications $p
      Write-Host "  allowed  $p" -ForegroundColor Green
    } catch {
      Write-Host "  failed   $p  ($($_.Exception.Message))" -ForegroundColor Red
    }
  }
}

Write-Host ''
Read-Host 'Done. Press Enter to close'
