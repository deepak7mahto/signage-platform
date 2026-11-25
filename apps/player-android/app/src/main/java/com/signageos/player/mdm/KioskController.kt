package com.signageos.player.mdm

import android.app.Activity
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import java.io.File

object KioskController {
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
                val intent = Intent(context, BootReceiver::class.java)
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
