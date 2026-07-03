$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $projectRoot
$asciiGradleHome = Join-Path $repoRoot ".gradle-ascii-home"
$defaultGradleHome = Join-Path $env:USERPROFILE ".gradle"
$tmpDir = Join-Path $repoRoot ".tmp"
$fallbackJavaHome = "D:/soft/Java/jdk-21"

function Get-LanIPv4Address {
  $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notlike "127.*" -and
      $_.IPAddress -notlike "169.254.*" -and
      $_.PrefixOrigin -ne "WellKnown"
    } |
    Sort-Object -Property InterfaceMetric, InterfaceIndex

  foreach ($address in $addresses) {
    if ($address.IPAddress -match "^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)") {
      return $address.IPAddress
    }
  }

  return $null
}

# Ensure GRADLE_USER_HOME points to an ASCII-safe path (no Chinese chars).
# Using a real directory instead of a Junction, because AGP resolves Junctions
# and writes the real (Chinese) path into prefab_command.bat, breaking CMake.
#
# Only copy the Gradle wrapper (distribution bootstrap) to avoid re-downloading.
# Do NOT copy caches/ — they may contain AGP-generated files with Chinese paths
# (e.g. transforms/.../prefab_command.bat). Let Gradle regenerate everything else.
if (-not (Test-Path -LiteralPath $asciiGradleHome)) {
  New-Item -ItemType Directory -Path $asciiGradleHome | Out-Null
  if (Test-Path -LiteralPath $defaultGradleHome) {
    $wrapperSrc = Join-Path $defaultGradleHome "wrapper"
    if (Test-Path -LiteralPath $wrapperSrc) {
      Write-Host "Copying Gradle wrapper to ASCII-safe home (avoids re-download)..."
      Copy-Item -LiteralPath $wrapperSrc -Destination (Join-Path $asciiGradleHome "wrapper") -Recurse -Force
    }
  }
} elseif ((Get-Item -LiteralPath $asciiGradleHome).Attributes -band [IO.FileAttributes]::ReparsePoint) {
  # Existing path is a Junction — replace with a real directory
  Write-Host "Replacing Junction with real directory: $asciiGradleHome"
  $junctionTarget = (Get-Item -LiteralPath $asciiGradleHome).Target
  Remove-Item -LiteralPath $asciiGradleHome -Force  # Remove Junction (does NOT delete target)
  New-Item -ItemType Directory -Path $asciiGradleHome | Out-Null
  # Copy only the wrapper from the Junction target
  if ($junctionTarget -and (Test-Path -LiteralPath $junctionTarget)) {
    $wrapperSrc = Join-Path $junctionTarget "wrapper"
    if (Test-Path -LiteralPath $wrapperSrc) {
      Write-Host "Copying Gradle wrapper from original home..."
      Copy-Item -LiteralPath $wrapperSrc -Destination (Join-Path $asciiGradleHome "wrapper") -Recurse -Force
    }
  }
}

New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

$env:GRADLE_USER_HOME = (Resolve-Path -LiteralPath $asciiGradleHome).Path.Replace("\", "/")
$env:TEMP = (Resolve-Path -LiteralPath $tmpDir).Path.Replace("\", "/")
$env:TMP = $env:TEMP
if (-not $env:JAVA_HOME -and (Test-Path -LiteralPath $fallbackJavaHome)) {
  $env:JAVA_HOME = $fallbackJavaHome
}

if (-not $env:EXPO_PUBLIC_GATEWAY_URL) {
  $gatewayHost = Get-LanIPv4Address
  if ($gatewayHost) {
    $gatewayPort = if ($env:EXPO_PUBLIC_GATEWAY_PORT) { $env:EXPO_PUBLIC_GATEWAY_PORT } else { "8083" }
    $env:EXPO_PUBLIC_GATEWAY_URL = "http://${gatewayHost}:${gatewayPort}"
    $env:EXPO_PUBLIC_DEV_SERVER_HOST = $gatewayHost
  } else {
    Write-Warning "Could not detect LAN IPv4 address. Set EXPO_PUBLIC_GATEWAY_URL before building."
  }
}

Write-Host "GRADLE_USER_HOME = $env:GRADLE_USER_HOME" -ForegroundColor Cyan
Write-Host "TEMP             = $env:TEMP" -ForegroundColor Cyan
Write-Host "GATEWAY_URL      = $env:EXPO_PUBLIC_GATEWAY_URL" -ForegroundColor Cyan

Push-Location (Join-Path $projectRoot "android")
try {
  # Clean stale native build caches that may contain Chinese-path prefab commands
  $cxxCacheDirs = @(
    "app/build/intermediates/cxx",
    "app/.cxx"
  )
  foreach ($relativePath in $cxxCacheDirs) {
    $path = Join-Path (Get-Location) $relativePath
    if (Test-Path -LiteralPath $path) {
      Write-Host "Cleaning stale CMake cache: $relativePath"
      Remove-Item -LiteralPath $path -Recurse -Force
    }
  }

  # Clean stale JS bundle / sourcemap assets
  $debugBundlePaths = @(
    "app/build/generated/assets/react/debug",
    "app/build/generated/sourcemaps/react/debug",
    "app/build/intermediates/assets/debug",
    "app/build/intermediates/sourcemaps/react/debug"
  )
  foreach ($relativePath in $debugBundlePaths) {
    $path = Join-Path (Get-Location) $relativePath
    if (Test-Path -LiteralPath $path) {
      Remove-Item -LiteralPath $path -Recurse -Force
    }
  }

  .\gradlew.bat app:assembleDebug -x lint -x test --build-cache "-PreactNativeArchitectures=arm64-v8a" "-Panotherme.embedBundleInDebug=true"
} finally {
  Pop-Location
}
