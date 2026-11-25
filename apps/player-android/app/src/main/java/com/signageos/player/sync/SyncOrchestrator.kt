package com.signageos.player.sync

import androidx.appcompat.app.AppCompatActivity
import androidx.media3.ui.PlayerView
import com.signageos.player.data.AssetCacheManager
import com.signageos.player.data.DevicePrefs
import com.signageos.player.data.HeartbeatRequest
import com.signageos.player.data.PopQueueStore
import com.signageos.player.data.ScreenCommandDto
import com.signageos.player.mdm.KioskController
import com.signageos.player.mdm.WatchdogPolicy
import com.signageos.player.network.ManifestFetchResult
import com.signageos.player.network.SignageApiClient
import com.signageos.player.playback.PlaybackController
import com.signageos.player.ui.DisplayHelpers
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.WebSocket
import kotlin.math.min
import kotlin.random.Random

class SyncOrchestrator(
    private val activity: AppCompatActivity,
    private val scope: CoroutineScope,
    private val prefs: DevicePrefs,
    private val api: SignageApiClient,
    private val cache: AssetCacheManager,
    private val popStore: PopQueueStore,
    private val watchdog: WatchdogPolicy,
    private val playback: PlaybackController,
    private val playerView: PlayerView,
    private val onRevoked: () -> Unit,
    private val onStatusUpdated: (wsConnected: Boolean, cachedCount: Int) -> Unit,
) {
    private var webSocket: WebSocket? = null
    private var wsConnected = false
    private var cachedCount = 0
    private var syncJob: Job? = null
    private var hbJob: Job? = null
    private var scheduleJob: Job? = null

    fun start() {
        connectWebSocket()

        syncJob?.cancel()
        syncJob = scope.launch {
            var attempt = 0
            while (isActive && prefs.isPaired()) {
                val ok = syncManifestOnce()
                claimAndExecutePendingCommands()
                attempt = if (ok) 0 else min(attempt + 1, 6)
                val waitMs = if (ok) 60_000L else jitterBackoffMs(attempt)
                delay(waitMs)
                if (!wsConnected && prefs.isPaired()) connectWebSocket()
            }
        }

        hbJob?.cancel()
        hbJob = scope.launch {
            while (isActive && prefs.isPaired()) {
                sendHeartbeat()
                flushPopQueue()
                delay(30_000)
            }
        }

        scheduleJob?.cancel()
        scheduleJob = scope.launch {
            while (isActive) {
                delay(15_000)
                activity.runOnUiThread { playback.evaluateSchedule(resetCursor = false) }
            }
        }
    }

    fun stop() {
        syncJob?.cancel()
        hbJob?.cancel()
        scheduleJob?.cancel()
        webSocket?.close(1000, "Stopped")
        webSocket = null
        wsConnected = false
        onStatusUpdated(false, cachedCount)
    }

    fun flushPopAsync() {
        scope.launch { flushPopQueue() }
    }

    private fun jitterBackoffMs(attempt: Int): Long {
        val cap = min(60_000L, 1500L shl attempt)
        return (cap * Random.nextDouble(0.3, 1.0)).toLong().coerceAtLeast(1000L)
    }

    private suspend fun syncManifestOnce(): Boolean {
        val token = prefs.deviceToken ?: return false
        return when (val res = api.fetchManifest(prefs.serverBaseUrl, token, prefs.etag)) {
            is ManifestFetchResult.Revoked -> {
                onRevoked()
                false
            }
            is ManifestFetchResult.Unauthorized -> false
            is ManifestFetchResult.NetworkError -> false
            is ManifestFetchResult.NotModified -> {
                res.etag?.let { prefs.etag = it }
                res.clockOffsetMs?.let { prefs.clockOffsetMs = it }
                true
            }
            is ManifestFetchResult.Success -> {
                prefs.etag = res.etag
                prefs.clockOffsetMs = res.clockOffsetMs
                cache.saveManifest(res.manifest)
                cachedCount = cache.syncAssets(res.manifest)
                activity.runOnUiThread {
                    playback.updateManifest(res.manifest, resetCursor = false)
                    onStatusUpdated(wsConnected, cachedCount)
                }
                true
            }
        }
    }

    private suspend fun claimAndExecutePendingCommands() {
        val token = prefs.deviceToken ?: return
        val cmds = api.claimPendingCommands(prefs.serverBaseUrl, token)
        for (cmd in cmds) {
            executeClaimedCommand(cmd)
        }
    }

    private fun executeClaimedCommand(cmd: ScreenCommandDto) {
        if (prefs.hasExecutedCommand(cmd.id)) return
        when (cmd.command) {
            "sync_now" -> {
                prefs.recordExecutedCommand(cmd.id)
                scope.launch { syncManifestOnce() }
                api.sendAck(webSocket, cmd.id, "sync_now", true, "Synced")
            }
            "set_volume" -> {
                val lvl = cmd.payload?.get("level")?.jsonPrimitive?.intOrNull ?: 50
                prefs.recordExecutedCommand(cmd.id)
                applyVolume(cmd.id, lvl)
            }
            "cec_power" -> {
                val st = cmd.payload?.get("state")?.jsonPrimitive?.content ?: "on"
                prefs.recordExecutedCommand(cmd.id)
                applyCecPower(cmd.id, st)
            }
            "take_screenshot" -> {
                val uploadUrl = cmd.payload?.get("uploadUrl")?.jsonPrimitive?.content ?: return
                prefs.recordExecutedCommand(cmd.id)
                runScreenshot(cmd.id, uploadUrl)
            }
            "clear_quarantine" -> {
                val assetId = cmd.payload?.get("assetId")?.jsonPrimitive?.content
                prefs.recordExecutedCommand(cmd.id)
                activity.runOnUiThread { playback.clearQuarantine(assetId) }
                api.sendAck(webSocket, cmd.id, "clear_quarantine", true, "Cleared")
            }
            "exit_safe_mode" -> {
                prefs.recordExecutedCommand(cmd.id)
                activity.runOnUiThread { playback.exitSafeMode() }
                api.sendAck(webSocket, cmd.id, "exit_safe_mode", true, "Exited safe mode")
            }
            "reboot" -> runReboot(cmd.id)
        }
    }

    private fun connectWebSocket() {
        val token = prefs.deviceToken ?: return
        webSocket?.close(1000, "Reconnect")
        webSocket = api.connectWebSocket(
            baseUrl = prefs.serverBaseUrl,
            deviceToken = token,
            onConnected = { connected ->
                wsConnected = connected
                activity.runOnUiThread { onStatusUpdated(wsConnected, cachedCount) }
            },
            onSyncNow = { cmdId ->
                if (cmdId != null && prefs.hasExecutedCommand(cmdId)) return@connectWebSocket
                cmdId?.let { prefs.recordExecutedCommand(it) }
                scope.launch {
                    syncManifestOnce()
                    api.sendAck(webSocket, cmdId, "sync_now", true, "Manifest synced")
                }
            },
            onRevoke = onRevoked,
            onTakeScreenshot = { cmdId, uploadUrl ->
                if (prefs.hasExecutedCommand(cmdId)) return@connectWebSocket
                prefs.recordExecutedCommand(cmdId)
                runScreenshot(cmdId, uploadUrl)
            },
            onCecPower = { cmdId, state ->
                if (prefs.hasExecutedCommand(cmdId)) return@connectWebSocket
                prefs.recordExecutedCommand(cmdId)
                applyCecPower(cmdId, state)
            },
            onSetVolume = { cmdId, level ->
                if (prefs.hasExecutedCommand(cmdId)) return@connectWebSocket
                prefs.recordExecutedCommand(cmdId)
                applyVolume(cmdId, level)
            },
            onReboot = { cmdId ->
                if (prefs.hasExecutedCommand(cmdId)) return@connectWebSocket
                runReboot(cmdId)
            },
            onClearQuarantine = { cmdId, assetId ->
                if (prefs.hasExecutedCommand(cmdId)) return@connectWebSocket
                prefs.recordExecutedCommand(cmdId)
                activity.runOnUiThread { playback.clearQuarantine(assetId) }
                api.sendAck(webSocket, cmdId, "clear_quarantine", true, "Quarantine cleared")
            },
            onExitSafeMode = { cmdId ->
                if (prefs.hasExecutedCommand(cmdId)) return@connectWebSocket
                prefs.recordExecutedCommand(cmdId)
                activity.runOnUiThread { playback.exitSafeMode() }
                api.sendAck(webSocket, cmdId, "exit_safe_mode", true, "Safe mode exited")
            },
        )
    }

    private fun runScreenshot(cmdId: String, uploadUrl: String) {
        val token = prefs.deviceToken ?: return
        scope.launch {
            DisplayHelpers.uploadScreenshotAndAck(
                activity = activity,
                playerView = playerView,
                api = api,
                webSocket = webSocket,
                serverBaseUrl = prefs.serverBaseUrl,
                token = token,
                commandId = cmdId,
                uploadUrl = uploadUrl,
            )
        }
    }

    private fun applyCecPower(cmdId: String, state: String) {
        activity.runOnUiThread {
            playback.setStandby(state == "standby")
            api.sendAck(webSocket, cmdId, "cec_power", true, "TV $state")
        }
    }

    private fun applyVolume(cmdId: String, level: Int) {
        activity.runOnUiThread {
            KioskController.setSystemVolume(activity, level)
            playback.exoPlayer.volume = (level.coerceIn(0, 100) / 100f)
            api.sendAck(webSocket, cmdId, "set_volume", true, "Volume $level%")
        }
    }

    private fun runReboot(cmdId: String) {
        // Persist executed ID BEFORE invoking reboot to prevent reboot loop
        prefs.recordExecutedCommand(cmdId)
        api.sendAck(webSocket, cmdId, "reboot", true, "Rebooting")
        if (!KioskController.rebootIfDeviceOwner(activity)) {
            scope.launch { syncManifestOnce() }
        }
    }

    private suspend fun sendHeartbeat() {
        val token = prefs.deviceToken ?: return
        val hw = buildJsonObject {
            put("model", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
            put("sdkInt", android.os.Build.VERSION.SDK_INT)
            put("deviceOwner", KioskController.isDeviceOwner(activity))
        }
        val code = api.sendHeartbeat(
            prefs.serverBaseUrl,
            token,
            HeartbeatRequest(
                appVersion = "android-0.6.0",
                manifestVersion = playback.manifest?.manifestVersion ?: 0,
                currentAssetId = playback.getCurrentAssetId(),
                hwInfo = hw,
                playbackState = playback.getPlaybackStateName(),
                lastFrameAdvanceAt = playback.lastFrameAdvanceIso,
                capabilities = KioskController.detectCapabilities(activity),
            ),
        )
        if (code == 410) onRevoked()
    }

    private suspend fun flushPopQueue() {
        val token = prefs.deviceToken ?: return
        val batch = popStore.peekBatch(100)
        if (batch.isEmpty()) return
        if (api.uploadPopBatch(prefs.serverBaseUrl, token, batch)) {
            popStore.deleteByIds(batch.map { it.id })
            activity.runOnUiThread { onStatusUpdated(wsConnected, cachedCount) }
        }
    }
}
