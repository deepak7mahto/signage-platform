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
import com.signageos.player.data.ClaimProvisionRequest
import com.signageos.player.data.ClaimProvisionResponse
import com.signageos.player.data.CommandClaimResponse
import com.signageos.player.data.DeviceManifest
import com.signageos.player.data.HeartbeatRequest
import com.signageos.player.data.PairPollRequest
import com.signageos.player.data.PairPollResponse
import com.signageos.player.data.PairRequestResponse
import com.signageos.player.data.PongMessage
import com.signageos.player.data.PopBatchRequest
import com.signageos.player.data.PopEventInput
import com.signageos.player.data.ScreenCommandDto

sealed class ManifestFetchResult {
    data class Success(
        val manifest: DeviceManifest,
        val etag: String?,
        val clockOffsetMs: Long,
    ) : ManifestFetchResult()

    data class NotModified(
        val etag: String?,
        val clockOffsetMs: Long?,
    ) : ManifestFetchResult()

    data class Revoked(val message: String) : ManifestFetchResult()
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

    suspend fun claimProvision(baseUrl: String, provisionToken: String): ClaimProvisionResponse? =
        withContext(Dispatchers.IO) {
            runCatching {
                val payload = json.encodeToString(ClaimProvisionRequest(provisionToken = provisionToken.trim()))
                val req = Request.Builder()
                    .url("${baseUrl.trimEnd('/')}/api/v1/device/provision/claim")
                    .post(payload.toRequestBody(jsonMediaType))
                    .build()
                http.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) return@use null
                    val body = resp.body?.string() ?: return@use null
                    json.decodeFromString<ClaimProvisionResponse>(body)
                }
            }.getOrNull()
        }

    suspend fun fetchManifest(
        baseUrl: String,
        deviceToken: String,
        etag: String? = null,
    ): ManifestFetchResult = withContext(Dispatchers.IO) {
        try {
            val reqBuilder = Request.Builder()
                .url("${baseUrl.trimEnd('/')}/api/v1/device/manifest")
                .header("Authorization", "Bearer $deviceToken")
                .get()
            if (!etag.isNullOrBlank()) {
                reqBuilder.header("If-None-Match", etag)
            }

            http.newCall(reqBuilder.build()).execute().use { resp ->
                val respEtag = resp.header("ETag") ?: etag
                val serverTimeHeader = resp.header("X-Server-Time")
                val headerOffset = serverTimeHeader?.let {
                    runCatching { Instant.parse(it).toEpochMilli() - System.currentTimeMillis() }.getOrNull()
                }

                if (resp.code == 304) {
                    return@use ManifestFetchResult.NotModified(respEtag, headerOffset)
                }
                if (resp.code == 401) {
                    return@use ManifestFetchResult.Unauthorized
                }
                if (resp.code == 410) {
                    val body = resp.body?.string().orEmpty()
                    val code = runCatching {
                        json.parseToJsonElement(body).jsonObject["errorCode"]?.jsonPrimitive?.content
                    }.getOrNull()
                    if (code == "DEVICE_REVOKED") {
                        val msg = runCatching {
                            json.parseToJsonElement(body).jsonObject["message"]?.jsonPrimitive?.content
                        }.getOrNull() ?: "Device revoked"
                        return@use ManifestFetchResult.Revoked(msg)
                    }
                    return@use ManifestFetchResult.NetworkError
                }
                if (!resp.isSuccessful) return@use ManifestFetchResult.NetworkError

                val body = resp.body?.string() ?: return@use ManifestFetchResult.NetworkError
                val manifest = json.decodeFromString<DeviceManifest>(body)
                val offset = headerOffset ?: runCatching {
                    Instant.parse(manifest.serverTime).toEpochMilli() - System.currentTimeMillis()
                }.getOrDefault(0L)
                ManifestFetchResult.Success(manifest, respEtag, offset)
            }
        } catch (_: Throwable) {
            ManifestFetchResult.NetworkError
        }
    }

    suspend fun claimPendingCommands(baseUrl: String, deviceToken: String): List<ScreenCommandDto> =
        withContext(Dispatchers.IO) {
            runCatching {
                val req = Request.Builder()
                    .url("${baseUrl.trimEnd('/')}/api/v1/device/commands/claim")
                    .header("Authorization", "Bearer $deviceToken")
                    .post("{}".toRequestBody(jsonMediaType))
                    .build()
                http.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) return@use emptyList()
                    val body = resp.body?.string() ?: return@use emptyList()
                    json.decodeFromString<CommandClaimResponse>(body).commands
                }
            }.getOrDefault(emptyList())
        }

    suspend fun sendHeartbeat(baseUrl: String, deviceToken: String, payload: HeartbeatRequest): Int =
        withContext(Dispatchers.IO) {
            runCatching {
                val req = Request.Builder()
                    .url("${baseUrl.trimEnd('/')}/api/v1/device/heartbeat")
                    .header("Authorization", "Bearer $deviceToken")
                    .post(json.encodeToString(payload).toRequestBody(jsonMediaType))
                    .build()
                http.newCall(req).execute().use { it.code }
            }.getOrDefault(-1)
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
        onClearQuarantine: (commandId: String, assetId: String?) -> Unit,
        onExitSafeMode: (commandId: String) -> Unit,
    ): WebSocket {
        val wsBase = baseUrl.trimEnd('/')
            .replaceFirst("https://", "wss://")
            .replaceFirst("http://", "ws://")
        val req = Request.Builder()
            .url("$wsBase/ws/device")
            .header("Authorization", "Bearer $deviceToken")
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
                            "clear_quarantine" -> {
                                val assetId = obj["assetId"]?.jsonPrimitive?.content
                                if (commandId != null) onClearQuarantine(commandId, assetId)
                            }
                            "exit_safe_mode" -> {
                                if (commandId != null) onExitSafeMode(commandId)
                            }
                        }
                    }
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    onConnected(false)
                    if (code == 4003) onRevoke()
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    onConnected(false)
                    if (response?.code == 410) onRevoke()
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
