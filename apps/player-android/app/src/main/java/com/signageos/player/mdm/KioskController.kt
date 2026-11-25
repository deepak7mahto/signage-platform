package com.signageos.player.mdm

import android.app.Activity
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioManager
import android.media.MediaCodecList
import android.os.Build
import com.signageos.player.data.DevicePrefs
import java.io.File
import java.security.MessageDigest

object KioskController {
    private var badPinAttempts = 0
    private var pinLockoutUntilMs = 0L

    fun isDeviceOwner(context: Context): Boolean {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        return dpm.isDeviceOwnerApp(context.packageName)
    }

    fun enableLockTaskIfDeviceOwner(activity: Activity) {
        val dpm = activity.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        if (dpm.isDeviceOwnerApp(activity.packageName)) {
            val admin = SignageDeviceAdminReceiver.componentName(activity)
            dpm.setLockTaskPackages(admin, arrayOf(activity.packageName))
            runCatching { activity.startLockTask() }
        }
    }

    fun rebootIfDeviceOwner(context: Context): Boolean {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        if (!dpm.isDeviceOwnerApp(context.packageName)) return false
        return runCatching {
            dpm.reboot(SignageDeviceAdminReceiver.componentName(context))
            true
        }.getOrDefault(false)
    }

    fun setSystemVolume(context: Context, levelPercent: Int) {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val maxVol = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val clamped = levelPercent.coerceIn(0, 100)
        val targetVol = Math.round((clamped / 100f) * maxVol).coerceIn(0, maxVol)
        am.setStreamVolume(AudioManager.STREAM_MUSIC, targetVol, 0)
    }

    fun hasDualVideoDecoder(): Boolean {
        return runCatching {
            val codecs = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
            val avcDecoders = codecs.count { info ->
                !info.isEncoder && info.supportedTypes.any { it.equals("video/avc", ignoreCase = true) }
            }
            avcDecoders >= 2
        }.getOrDefault(false)
    }

    fun detectCapabilities(context: Context): List<String> {
        val caps = mutableListOf("screenshot", "volume", "reboot", "cec_power")
        if (isDeviceOwner(context)) caps.add("apk_ota")
        if (hasDualVideoDecoder()) caps.add("dual_video")
        return caps
    }

    fun decodeDownscaledBitmap(file: File, reqWidth: Int = 1920, reqHeight: Int = 1080): Bitmap? {
        if (!file.exists()) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        var inSampleSize = 1
        if (bounds.outHeight > reqHeight || bounds.outWidth > reqWidth) {
            val halfH = bounds.outHeight / 2
            val halfW = bounds.outWidth / 2
            while ((halfH / inSampleSize) >= reqHeight && (halfW / inSampleSize) >= reqWidth) {
                inSampleSize *= 2
            }
        }
        val opts = BitmapFactory.Options().apply { this.inSampleSize = inSampleSize }
        return BitmapFactory.decodeFile(file.absolutePath, opts)
    }

    fun verifyPinWithLockout(prefs: DevicePrefs, pinInput: String, nowMs: Long = System.currentTimeMillis()): Boolean {
        val expectedHash = prefs.unpairPinSha256
        if (expectedHash.isNullOrBlank()) return true
        if (nowMs < pinLockoutUntilMs) return false
        val actualHash = MessageDigest.getInstance("SHA-256")
            .digest(pinInput.trim().toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        if (actualHash.equals(expectedHash, ignoreCase = true)) {
            badPinAttempts = 0
            pinLockoutUntilMs = 0L
            return true
        }
        badPinAttempts += 1
        if (badPinAttempts >= 5) {
            pinLockoutUntilMs = nowMs + 5 * 60_000L
            badPinAttempts = 0
        }
        return false
    }

    fun installApkSilently(context: Context, apkFile: File): Boolean {
        if (!apkFile.exists()) return false
        return runCatching {
            val installer = context.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            val sessionId = installer.createSession(params)
            installer.openSession(sessionId).use { session ->
                session.openWrite("base.apk", 0, apkFile.length()).use { out ->
                    apkFile.inputStream().use { input -> input.copyTo(out) }
                    session.fsync(out)
                }
                val intent = Intent(context, PackageInstallReceiver::class.java)
                val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
                } else {
                    PendingIntent.FLAG_UPDATE_CURRENT
                }
                val callback = PendingIntent.getBroadcast(context, sessionId, intent, flags)
                session.commit(callback.intentSender)
            }
            true
        }.getOrDefault(false)
    }
}
