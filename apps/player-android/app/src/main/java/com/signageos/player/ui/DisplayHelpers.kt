package com.signageos.player.ui

import android.app.Activity
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import androidx.media3.ui.PlayerView
import com.signageos.player.data.DeviceManifest
import com.signageos.player.data.DevicePrefs
import com.signageos.player.data.HeartbeatRequest
import com.signageos.player.data.ManifestItem
import com.signageos.player.data.PopEventInput
import com.signageos.player.data.PopQueueStore
import com.signageos.player.data.ResolvedPlaylist
import com.signageos.player.mdm.KioskController
import com.signageos.player.network.SignageApiClient
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.WebSocket
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.util.UUID
import kotlin.coroutines.coroutineContext
import kotlin.coroutines.resume

object DisplayHelpers {
    suspend fun captureCurrentFrameBitmap(activity: Activity, playerView: PlayerView): Bitmap? {
        val targetView: View = if (playerView.visibility == View.VISIBLE) {
            playerView.videoSurfaceView ?: playerView
        } else {
            activity.window.decorView.rootView
        }
        if (targetView.width <= 0 || targetView.height <= 0) return null

        val bmp = Bitmap.createBitmap(targetView.width, targetView.height, Bitmap.Config.ARGB_8888)
        return suspendCancellableCoroutine { cont ->
            val handler = Handler(Looper.getMainLooper())
            if (targetView is SurfaceView) {
                PixelCopy.request(targetView, bmp, { result ->
                    cont.resume(if (result == PixelCopy.SUCCESS) bmp else null)
                }, handler)
            } else {
                PixelCopy.request(activity.window, bmp, { result ->
                    cont.resume(if (result == PixelCopy.SUCCESS) bmp else null)
                }, handler)
            }
        }
    }

    fun recordPopEvent(
        popStore: PopQueueStore,
        playlistId: String?,
        assetId: String,
        startedMs: Long,
        endedMs: Long,
        status: String,
    ) {
        popStore.enqueue(
            PopEventInput(
                id = UUID.randomUUID().toString(),
                playlistId = playlistId,
                mediaAssetId = assetId,
                startedAt = Instant.ofEpochMilli(startedMs).toString(),
                endedAt = Instant.ofEpochMilli(endedMs).toString(),
                durationMs = (endedMs - startedMs).coerceAtLeast(500L),
                status = status,
            ),
        )
    }

    suspend fun uploadScreenshotAndAck(
        activity: Activity,
        playerView: PlayerView,
        api: SignageApiClient,
        webSocket: WebSocket?,
        serverBaseUrl: String,
        token: String,
        commandId: String,
        uploadUrl: String,
    ) {
        val bitmap = captureCurrentFrameBitmap(activity, playerView)
        if (bitmap == null) {
            api.sendAck(webSocket, commandId, "take_screenshot", false, "No active surface")
            return
        }
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 82, out)
        val ok = api.uploadScreenshotAndComplete(serverBaseUrl, token, commandId, uploadUrl, out.toByteArray())
        api.sendAck(webSocket, commandId, "take_screenshot", ok, "${bitmap.width}x${bitmap.height} JPEG")
    }

    fun buildHeartbeat(
        activity: Activity,
        manifest: DeviceManifest?,
        currentAssetId: String?,
    ): HeartbeatRequest {
        val hw = buildJsonObject {
            put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
            put("sdkInt", Build.VERSION.SDK_INT)
            put("deviceOwner", KioskController.isDeviceOwner(activity))
        }
        return HeartbeatRequest(
            appVersion = "android-0.5.0",
            manifestVersion = manifest?.manifestVersion ?: 0,
            currentAssetId = currentAssetId,
            hwInfo = hw,
        )
    }

    suspend fun runPairingLoop(
        prefs: DevicePrefs,
        api: SignageApiClient,
        onCode: (code: String, status: String) -> Unit,
        onStatus: (status: String) -> Unit,
        onPaired: () -> Unit,
    ) {
        while (coroutineContext.isActive && !prefs.isPaired()) {
            onStatus("Requesting pairing code from ${prefs.serverBaseUrl}...")
            val req = api.pairRequest(prefs.serverBaseUrl)
            if (req == null) {
                onCode("------", "Server unreachable. Retrying...")
                delay(4000)
                continue
            }

            onCode(req.code, "Waiting for pairing confirmation in CMS...")

            while (coroutineContext.isActive && !prefs.isPaired()) {
                delay(2500)
                val poll = api.pairPoll(prefs.serverBaseUrl, req.code, req.claimSecret) ?: continue
                if (poll.status == "claimed" && poll.deviceToken != null && poll.screenId != null) {
                    prefs.deviceToken = poll.deviceToken
                    prefs.screenId = poll.screenId
                    prefs.screenName = poll.screenName
                    onPaired()
                    return
                } else if (poll.status == "expired") {
                    break
                }
            }
        }
    }

    fun formatHudDetails(
        activity: Activity,
        wsConnected: Boolean,
        resolved: ResolvedPlaylist?,
        playableItems: List<ManifestItem>,
        activeIndex: Int,
        cachedCount: Int,
        popQueued: Int,
    ): String {
        val current = playableItems.getOrNull(activeIndex % playableItems.size.coerceAtLeast(1))
        return buildString {
            appendLine("WS: ${if (wsConnected) "Connected" else "Offline"} | DO: ${KioskController.isDeviceOwner(activity)}")
            appendLine("Schedule: ${resolved?.scheduleName ?: "Fallback Loop"}")
            appendLine("Playlist: ${resolved?.playlistName ?: "None"}")
            appendLine(
                "Now: ${if (current != null) "${(activeIndex % playableItems.size) + 1}/${playableItems.size} ${current.title}" else "Idle"}",
            )
            appendLine("Cache: $cachedCount | PoP Queued: $popQueued")
        }.trim()
    }

    fun hideSystemUi(activity: Activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            activity.window.setDecorFitsSystemWindows(false)
            activity.window.insetsController?.let { controller ->
                controller.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                controller.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            activity.window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                )
        }
    }
}
