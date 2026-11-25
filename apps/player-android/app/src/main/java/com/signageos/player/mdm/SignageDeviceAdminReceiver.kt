package com.signageos.player.mdm

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context

class SignageDeviceAdminReceiver : DeviceAdminReceiver() {
    companion object {
        fun componentName(context: Context): ComponentName =
            ComponentName(context.applicationContext, SignageDeviceAdminReceiver::class.java)
    }
}
