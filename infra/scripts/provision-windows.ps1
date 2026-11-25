#Requires -RunAsAdministrator
param(
  [string]$PlayerExePath = "C:\Program Files\SignageOS\signage-player-windows.exe",
  [string]$WatchdogExePath = "C:\Program Files\SignageOS\signage-watchdog-service.exe",
  [string]$ServerUrl = "",
  [string]$ProvisionToken = ""
)

$ErrorActionPreference = "Stop"
$DataDir = "C:\ProgramData\SignageOS"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
New-Item -ItemType Directory -Force -Path "$DataDir\blobs" | Out-Null

if ($ServerUrl -and $ProvisionToken) {
  $Config = @{
    serverUrl = $ServerUrl.TrimEnd('/')
    provisionToken = $ProvisionToken.Trim()
  } | ConvertTo-Json
  Set-Content -Path "$DataDir\signage-provision.json" -Value $Config -Encoding UTF8
}

if (Test-Path $WatchdogExePath) {
  sc.exe stop SignageWatchdogService 2>$null | Out-Null
  sc.exe delete SignageWatchdogService 2>$null | Out-Null
  sc.exe create SignageWatchdogService binPath= "`"$WatchdogExePath`"" start= auto obj= LocalSystem
  sc.exe failure SignageWatchdogService reset= 3600 actions= restart/5000/restart/5000/restart/10000
  sc.exe start SignageWatchdogService
}

if (Test-Path $PlayerExePath) {
  $RunKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
  Set-ItemProperty -Path $RunKey -Name "SignageOSPlayer" -Value "`"$PlayerExePath`""
}

Write-Host "SignageOS Windows box provisioning completed."
