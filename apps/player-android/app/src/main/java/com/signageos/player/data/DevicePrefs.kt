package com.signageos.player.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class DevicePrefs(context: Context) {
    private val prefs: SharedPreferences = createPrefs(context)

    var serverBaseUrl: String
        get() = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
        set(value) = prefs.edit().putString(KEY_SERVER_URL, value.trimEnd('/')).apply()

    var deviceToken: String?
        get() = prefs.getString(KEY_DEVICE_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_DEVICE_TOKEN, value).apply()

    var screenId: String?
        get() = prefs.getString(KEY_SCREEN_ID, null)
        set(value) = prefs.edit().putString(KEY_SCREEN_ID, value).apply()

    var screenName: String?
        get() = prefs.getString(KEY_SCREEN_NAME, null)
        set(value) = prefs.edit().putString(KEY_SCREEN_NAME, value).apply()

    var clockOffsetMs: Long
        get() = prefs.getLong(KEY_CLOCK_OFFSET, 0L)
        set(value) = prefs.edit().putLong(KEY_CLOCK_OFFSET, value).apply()

    fun isPaired(): Boolean = !deviceToken.isNullOrBlank() && !screenId.isNullOrBlank()

    fun clearPairing() {
        prefs.edit()
            .remove(KEY_DEVICE_TOKEN)
            .remove(KEY_SCREEN_ID)
            .remove(KEY_SCREEN_NAME)
            .apply()
    }

    companion object {
        private const val FILE_NAME = "signage_device_secure_prefs"
        private const val KEY_SERVER_URL = "server_base_url"
        private const val KEY_DEVICE_TOKEN = "device_token"
        private const val KEY_SCREEN_ID = "screen_id"
        private const val KEY_SCREEN_NAME = "screen_name"
        private const val KEY_CLOCK_OFFSET = "clock_offset_ms"
        const val DEFAULT_SERVER_URL = "http://10.0.2.2:8080"

        private fun createPrefs(context: Context): SharedPreferences {
            return try {
                val masterKey = MasterKey.Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build()
                EncryptedSharedPreferences.create(
                    context,
                    FILE_NAME,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
                )
            } catch (_: Throwable) {
                context.getSharedPreferences("${FILE_NAME}_fallback", Context.MODE_PRIVATE)
            }
        }
    }
}
