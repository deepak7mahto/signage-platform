package com.signageos.player.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.time.Instant
import java.util.concurrent.TimeUnit

import com.signageos.player.data.AckMessage
import com.signageos.player.data.DeviceManifest
import com.signageos.player.data.HeartbeatRequest
import com.signageos.player.data.PairPollRequest
import com.signageos.player.data.PairPollResponse
import com.signageos.player.data.PairRequestResponse
import com.signageos.player.data.PongMessage
import com.signageos.player.data.PopBatchRequest
import com.signageos.player.data.PopEventInput

sealed class ManifestFetchResult {
    data class Success(val manifest: DeviceManifest, val clockOffsetMs: Long) : ManifestFetchResult()
    data object Unauthorized : ManifestFetchResult()
    data object NetworkError : ManifestFetchResult()
}

class SignageApiClient {
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .pingInterval(30, TimeUnit.SECONDS)
        .build()

    private val json = Json { ignoreUnknownKeys = true }
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    suspend fun pairRequest(baseUrl: String): PairRequestResponse? = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder()
                .url("${baseUrl.trimEnd('/')}/api/v1/device/pair/request")
                .post("{}".toRequestBody(jsonMediaType))
                .build()
            http.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@use null
                val body = resp.body?.string() ?: return@use null
                json.decodeFromString<PairRequestResponse>(body)
            }
        }.getOrNull()
    }

    suspend fun pairPoll(baseUrl: String, code: String, claimSecret: String): PairPollResponse? =
        withContext(Dispatchers.IO) {
            runCatching {
                val payload = json.encodeToString(PairPollRequest(code = code, claimSecret = claimSecret))
                val req = Request.Builder()
                    .url("${baseUrl.trimEnd('/')}/api/v1/device/pair/poll")
                    .post(payload.toRequestBody(jsonMediaType))
                    .build()
                http.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) return@use null
                    val body = resp.body?.string() ?: return@use null
                    json.decodeFromString<PairPollResponse>(body)
                }
            }.getOrNull()
        }

    suspend fun fetchManifest(baseUrl: String, deviceToken: String): ManifestFetchResult =
        withContext(Dispatchers.IO) {
            try {
                val req = Request.Builder()
                    .url("${baseUrl.trimEnd('/')}/api/v1/device/manifest")
                    .header("Authorization", "Bearer $deviceToken")
                    .get()
                    .build()
                http.newCall(req).execute().use { resp ->
                    if (resp.code == 401) return@use ManifestFetchResult.Unauthorized
                    if (!resp.isSuccessful) return@use ManifestFetchResult.NetworkError
                    val body = resp.body?.string() ?: return@use ManifestFetchResult.NetworkError
                    val manifest = json.decodeFromString<DeviceManifest>(body)
                    val offset = runCatching {
                        Instant.parse(manifest.serverTime).toEpochMilli() - System.currentTimeMillis()
                    }.getOrDefault(0L)
                    ManifestFetchResult.Success(manifest, offset)
                }
            } catch (_: Throwable) {
                ManifestFetchResult.NetworkError
            }
        }

    suspend fun sendHeartbeat(baseUrl: String, deviceToken: String, payload: HeartbeatRequest) =
        withContext(Dispatchers.IO) {
            runCatching {
                val req = Request.Builder()
                    .url("${baseUrl.trimEnd('/')}/api/v1/device/heartbeat")
                    .header("Authorization", "Bearer $deviceToken")
                    .post(json.encodeToString(payload).toRequestBody(jsonMediaType))
                    .build()
                http.newCall(req).execute().close()
            }
        }

    suspend fun uploadPopBatch(
        baseUrl: String,
        deviceToken: String,
        events: List<PopEventInput>,
    ): Boolean = withContext(Dispatchers.IO) {
        if (events.isEmpty()) return@withContext true
        runCatching {
            val req = Request.Builder()
                .url("${baseUrl.trimEnd('/')}/api/v1/device/pop/batch")
                .header("Authorization", "Bearer $deviceToken")
                .post(json.encodeToString(PopBatchRequest(events)).toRequestBody(jsonMediaType))
                .build()
            http.newCall(req).execute().use { it.isSuccessful }
        }.getOrDefault(false)
    }

    suspend fun uploadScreenshotAndComplete(
        baseUrl: String,
        deviceToken: String,
        commandId: String,
        uploadUrl: String,
        jpegBytes: ByteArray,
    ): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            val putReq = Request.Builder()
                .url(uploadUrl)
                .put(jpegBytes.toRequestBody("image/jpeg".toMediaType()))
                .build()
            val putOk = http.newCall(putReq).execute().use { it.isSuccessful }
            if (!putOk) return@runCatching false

            val completeReq = Request.Builder()
                .url("${baseUrl.trimEnd('/')}/api/v1/device/screenshots/$commandId/complete")
                .header("Authorization", "Bearer $deviceToken")
                .post("{}".toRequestBody(jsonMediaType))
                .build()
            http.newCall(completeReq).execute().use { it.isSuccessful }
        }.getOrDefault(false)
    }

    fun connectWebSocket(
        baseUrl: String,
        deviceToken: String,
        onConnected: (Boolean) -> Unit,
        onSyncNow: (commandId: String?) -> Unit,
        onRevoke: () -> Unit,
        onTakeScreenshot: (commandId: String, uploadUrl: String) -> Unit,
        onCecPower: (commandId: String, state: String) -> Unit,
        onSetVolume: (commandId: String, level: Int) -> Unit,
        onReboot: (commandId: String) -> Unit,
    ): WebSocket {
        val wsBase = baseUrl.trimEnd('/')
            .replaceFirst("https://", "wss://")
            .replaceFirst("http://", "ws://")
        val req = Request.Builder()
            .url("$wsBase/ws/device?token=$deviceToken")
            .build()

        return http.newWebSocket(
            req,
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    onConnected(true)
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    runCatching {
                        val obj: JsonObject = json.parseToJsonElement(text).jsonObject
                        val type = obj["type"]?.jsonPrimitive?.content ?: return
                        val commandId = obj["commandId"]?.jsonPrimitive?.content

                        when (type) {
                            "sync_now" -> onSyncNow(commandId)
                            "ping" -> webSocket.send(
                                json.encodeToString(PongMessage(clientTime = Instant.now().toString())),
                            )
                            "revoke" -> onRevoke()
                            "take_screenshot" -> {
                                val uploadUrl = obj["uploadUrl"]?.jsonPrimitive?.content
                                if (commandId != null && uploadUrl != null) {
                                    onTakeScreenshot(commandId, uploadUrl)
                                }
                            }
                            "cec_power" -> {
                                val state = obj["state"]?.jsonPrimitive?.content ?: "on"
                                if (commandId != null) onCecPower(commandId, state)
                            }
                            "set_volume" -> {
                                val level = obj["level"]?.jsonPrimitive?.intOrNull ?: 50
                                if (commandId != null) onSetVolume(commandId, level)
                            }
                            "reboot" -> {
                                if (commandId != null) onReboot(commandId)
                            }
                        }
                    }
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    onConnected(false)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    onConnected(false)
                }
            },
        )
    }

    fun sendAck(ws: WebSocket?, commandId: String?, command: String, ok: Boolean, detail: String? = null) {
        if (ws == null) return
        val msg = AckMessage(
            commandId = commandId,
            command = command,
            status = if (ok) "ok" else "error",
            detail = detail,
        )
        ws.send(json.encodeToString(msg))
    }
}
