#!/usr/bin/env bash
set -euo pipefail

APK_PATH="${1:-apps/player-android/app/build/outputs/apk/debug/app-debug.apk}"
PKG="com.signageos.player"
ADMIN_RECEIVER="$PKG/.mdm.SignageDeviceAdminReceiver"

if [ ! -f "$APK_PATH" ]; then
  echo "APK not found at $APK_PATH. Build it first with:"
  echo "  cd apps/player-android && ./gradlew assembleDebug"
  exit 1
fi

echo "==> Checking ADB device..."
adb wait-for-device
adb devices

echo "==> Installing $APK_PATH..."
adb install -r -d "$APK_PATH"

echo "==> Provisioning Android Device Owner ($ADMIN_RECEIVER)..."
if adb shell dpm set-device-owner "$ADMIN_RECEIVER"; then
  echo "Device Owner provisioned successfully."
else
  echo "Warning: Could not set Device Owner (device may already have accounts or lack android.software.device_admin)."
  echo "Fallback: player will still run via LAUNCHER / HOME category."
fi

echo "==> Launching SignageOS Player..."
adb shell am start -n "$PKG/.ui.MainActivity"
