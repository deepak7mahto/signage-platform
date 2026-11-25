package com.signageos.player.data

import android.content.Context
import android.util.Base64
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import com.google.crypto.tink.Aead
import com.google.crypto.tink.aead.AeadConfig
import com.google.crypto.tink.aead.AesGcmKeyManager
import com.google.crypto.tink.integration.android.AndroidKeysetManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.nio.charset.StandardCharsets

class DevicePrefs(context: Context) {
    private val appContext = context.applicationContext
    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val json = Json { ignoreUnknownKeys = true }
    private val aead: Aead? = initTinkAead(appContext)
    private val dataStore: DataStore<Preferences> = PreferenceDataStoreFactory.create(
        scope = ioScope,
        produceFile = { File(appContext.filesDir, "datastore/signage_device.preferences_pb") },
    )
    private val cache = LinkedHashMap<String, String>()

    init {
        runBlocking {
            val prefs = dataStore.data.first()
            prefs.asMap().forEach { (k, v) ->
                if (v is String) {
                    val decoded = decryptValue(v)
                    if (decoded != null) cache[k.name] = decoded
                }
            }
        }
    }

    var serverBaseUrl: String
        get() = cache[KEY_SERVER_URL] ?: DEFAULT_SERVER_URL
        set(value) = putString(KEY_SERVER_URL, value.trimEnd('/'))

    var deviceToken: String?
        get() = cache[KEY_DEVICE_TOKEN]
        set(value) = putNullable(KEY_DEVICE_TOKEN, value)

    var screenId: String?
        get() = cache[KEY_SCREEN_ID]
        set(value) = putNullable(KEY_SCREEN_ID, value)

    var screenName: String?
        get() = cache[KEY_SCREEN_NAME]
        set(value) = putNullable(KEY_SCREEN_NAME, value)

    var etag: String?
        get() = cache[KEY_MANIFEST_ETAG]
        set(value) = putNullable(KEY_MANIFEST_ETAG, value)

    var unpairPinSha256: String?
        get() = cache[KEY_UNPAIR_PIN_HASH]
        set(value) = putNullable(KEY_UNPAIR_PIN_HASH, value)

    var clockOffsetMs: Long
        get() = cache[KEY_CLOCK_OFFSET]?.toLongOrNull() ?: 0L
        set(value) = putString(KEY_CLOCK_OFFSET, value.toString())

    var executedCommandIds: List<String>
        get() {
            val raw = cache[KEY_EXECUTED_CMD_IDS] ?: return emptyList()
            return runCatching { json.decodeFromString<List<String>>(raw) }.getOrDefault(emptyList())
        }
        set(value) {
            val trimmed = if (value.size > 500) value.takeLast(500) else value
            putString(KEY_EXECUTED_CMD_IDS, json.encodeToString(trimmed))
        }

    fun recordExecutedCommand(commandId: String) {
        val current = executedCommandIds
        if (current.contains(commandId)) return
        executedCommandIds = current + commandId
    }

    fun hasExecutedCommand(commandId: String): Boolean = executedCommandIds.contains(commandId)

    fun isPaired(): Boolean = !deviceToken.isNullOrBlank() && !screenId.isNullOrBlank()

    fun clearPairing() {
        listOf(KEY_DEVICE_TOKEN, KEY_SCREEN_ID, KEY_SCREEN_NAME, KEY_MANIFEST_ETAG).forEach { key ->
            cache.remove(key)
        }
        runBlocking {
            dataStore.edit { prefs ->
                listOf(KEY_DEVICE_TOKEN, KEY_SCREEN_ID, KEY_SCREEN_NAME, KEY_MANIFEST_ETAG).forEach {
                    prefs.remove(stringPreferencesKey(it))
                }
            }
        }
    }

    private fun putNullable(key: String, value: String?) {
        if (value == null) {
            cache.remove(key)
            ioScope.launch {
                dataStore.edit { it.remove(stringPreferencesKey(key)) }
            }
        } else {
            putString(key, value)
        }
    }

    private fun putString(key: String, value: String) {
        cache[key] = value
        val stored = encryptValue(value)
        ioScope.launch {
            dataStore.edit { prefs ->
                prefs[stringPreferencesKey(key)] = stored
            }
        }
    }

    private fun encryptValue(plain: String): String {
        val engine = aead ?: return "plain:$plain"
        return runCatching {
            val cipher = engine.encrypt(plain.toByteArray(StandardCharsets.UTF_8), ASSOCIATED_DATA)
            "tink:" + Base64.encodeToString(cipher, Base64.NO_WRAP)
        }.getOrElse { "plain:$plain" }
    }

    private fun decryptValue(raw: String): String? {
        if (raw.startsWith("plain:")) return raw.removePrefix("plain:")
        if (!raw.startsWith("tink:")) return raw
        val engine = aead ?: return null
        return runCatching {
            val cipher = Base64.decode(raw.removePrefix("tink:"), Base64.NO_WRAP)
            String(engine.decrypt(cipher, ASSOCIATED_DATA), StandardCharsets.UTF_8)
        }.getOrNull()
    }

    companion object {
        private const val KEY_SERVER_URL = "server_base_url"
        private const val KEY_DEVICE_TOKEN = "device_token"
        private const val KEY_SCREEN_ID = "screen_id"
        private const val KEY_SCREEN_NAME = "screen_name"
        private const val KEY_CLOCK_OFFSET = "clock_offset_ms"
        private const val KEY_MANIFEST_ETAG = "manifest_etag"
        private const val KEY_EXECUTED_CMD_IDS = "executed_command_ids"
        private const val KEY_UNPAIR_PIN_HASH = "unpair_pin_sha256"
        private val ASSOCIATED_DATA = "signageos-prefs-v1".toByteArray(StandardCharsets.UTF_8)
        const val DEFAULT_SERVER_URL = "http://10.0.2.2:8080"

        private fun initTinkAead(context: Context): Aead? = runCatching {
            AeadConfig.register()
            val keysetHandle = AndroidKeysetManager.Builder()
                .withSharedPref(context, "signage_tink_keyset", "signage_tink_prefs")
                .withKeyTemplate(AesGcmKeyManager.aes256GcmTemplate())
                .withMasterKeyUri("android-keystore://signage_tink_master")
                .build()
                .keysetHandle
            keysetHandle.getPrimitive(Aead::class.java)
        }.getOrNull()
    }
}
