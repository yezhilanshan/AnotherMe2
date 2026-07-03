$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$apkPath = Join-Path $projectRoot "android/app/build/outputs/apk/debug/app-debug.apk"

function Invoke-Adb {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  if ($env:ANDROID_SERIAL) {
    & adb -s $env:ANDROID_SERIAL @Args
  } else {
    & adb @Args
  }
  if ($LASTEXITCODE -ne 0) {
    throw "adb $($Args -join ' ') failed with exit code $LASTEXITCODE"
  }
}

$devicesOutput = & adb devices
if ($LASTEXITCODE -ne 0) {
  throw "adb devices failed. Please install Android platform-tools and ensure adb is in PATH."
}

$connectedDevices = @(
  $devicesOutput |
    Select-String -Pattern "^\S+\s+device$" |
    ForEach-Object { ($_ -split "\s+")[0] }
)

if (-not $env:ANDROID_SERIAL -and $connectedDevices.Count -eq 0) {
  throw "No authorized Android device found. Enable USB debugging and approve the RSA prompt on the phone."
}

if (-not $env:ANDROID_SERIAL -and $connectedDevices.Count -gt 1) {
  throw "Multiple Android devices found. Set ANDROID_SERIAL to the target device serial, then retry."
}

# USB install mode: the app connects to the phone-side localhost, and adb reverse
# forwards it to the computer. This avoids fragile Wi-Fi/LAN IP detection.
$env:EXPO_PUBLIC_GATEWAY_URL = "http://127.0.0.1:8083"
$env:EXPO_PUBLIC_WEB_URL = "http://127.0.0.1:3000"
$env:EXPO_PUBLIC_DEV_SERVER_HOST = "127.0.0.1"

Write-Host "USB mode Gateway URL = $env:EXPO_PUBLIC_GATEWAY_URL" -ForegroundColor Cyan
Write-Host "USB mode Web URL     = $env:EXPO_PUBLIC_WEB_URL" -ForegroundColor Cyan

& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-android-debug.ps1")
if ($LASTEXITCODE -ne 0) {
  throw "Android debug APK build failed with exit code $LASTEXITCODE"
}

Invoke-Adb reverse tcp:8083 tcp:8083
Invoke-Adb reverse tcp:3000 tcp:3000
Invoke-Adb install -r $apkPath

Write-Host "Installed APK via USB reverse." -ForegroundColor Green
Write-Host "Gateway is available to the app at http://127.0.0.1:8083" -ForegroundColor Green
