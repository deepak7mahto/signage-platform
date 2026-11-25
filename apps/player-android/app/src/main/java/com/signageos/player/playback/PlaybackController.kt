package com.signageos.player.playback

import android.net.Uri
import android.os.SystemClock
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.signageos.player.data.AssetCacheManager
import com.signageos.player.data.DeviceManifest
import com.signageos.player.data.DevicePrefs
import com.signageos.player.data.ManifestItem
import com.signageos.player.data.PopQueueStore
import com.signageos.player.data.ResolvedPlaylist
import com.signageos.player.data.ScheduleEvaluator
import com.signageos.player.mdm.KioskController
import com.signageos.player.mdm.WatchdogPolicy
import com.signageos.player.ui.DisplayHelpers
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant

class PlaybackController(
    private val activity: AppCompatActivity,
    private val scope: CoroutineScope,
    private val prefs: DevicePrefs,
    private val cache: AssetCacheManager,
    private val popStore: PopQueueStore,
    private val watchdog: WatchdogPolicy,
    private val playerView: PlayerView,
    private val imageView: ImageView,
    private val webContainer: FrameLayout,
    private val standbyOverlay: LinearLayout,
    private val safeModeOverlay: LinearLayout,
    private val onStateChanged: () -> Unit,
    private val onPopEnqueued: () -> Unit,
) {
    val exoPlayer: ExoPlayer = ExoPlayer.Builder(activity).build()
    private val webCreative = WebCreativeView(activity, webContainer) { crashedAssetId ->
        activity.runOnUiThread {
            watchdog.recordCrash(crashedAssetId)
            recordPopAndAdvance("interrupted")
        }
    }

    var manifest: DeviceManifest? = null
        private set
    var standby: Boolean = false
        private set
    var playableItems: List<ManifestItem> = emptyList()
        private set
    var activeIndex: Int = 0
        private set
    var lastFrameAdvanceIso: String = Instant.now().toString()
        private set

    private var activePlaylistKey: String? = null
    private var currentItemStartedMs = System.currentTimeMillis()
    private var imageTimerJob: Job? = null
    private var imageLoadJob: Job? = null
    private var stallMonitorJob: Job? = null
    private var consecutiveFailures = 0

    init {
        playerView.player = exoPlayer
        exoPlayer.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_ENDED) {
                    consecutiveFailures = 0
                    manifest?.let { cache.promoteToLkg(it) }
                    recordPopAndAdvance("completed")
                } else if (playbackState == Player.STATE_READY) {
                    consecutiveFailures = 0
                    lastFrameAdvanceIso = Instant.now().toString()
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                handleCurrentAssetFailure()
            }
        })
        startStallWatchdog()
    }

    fun getPlaybackStateName(): String {
        if (watchdog.isSafeMode) return "safe_mode"
        if (standby || playableItems.isEmpty()) return "idle"
        return "playing"
    }

    fun getCurrentAssetId(): String? {
        if (playableItems.isEmpty()) return null
        return playableItems[activeIndex % playableItems.size].assetId
    }

    fun updateManifest(nextManifest: DeviceManifest, resetCursor: Boolean) {
        if (watchdog.onManifestVersion(nextManifest.manifestVersion)) {
            consecutiveFailures = 0
        }
        manifest = nextManifest
        evaluateSchedule(resetCursor)
    }

    fun evaluateSchedule(resetCursor: Boolean) {
        val m = manifest ?: return
        val resolved = resolveCurrentSchedule(m)
        val newKey = "${resolved?.playlistId}:${resolved?.scheduleName}:${watchdog.quarantinedIds.size}"
        val items = (resolved?.items ?: emptyList()).filter { item ->
            !watchdog.isQuarantined(item.assetId) &&
                (!cache.isBinaryType(item.type) || cache.getCachedFileForItem(item) != null)
        }

        if (resetCursor || newKey != activePlaylistKey || items.size != playableItems.size) {
            activePlaylistKey = newKey
            playableItems = items
            activeIndex = 0
            playCurrentItem()
        }
        onStateChanged()
    }

    fun setStandby(nextStandby: Boolean) {
        standby = nextStandby
        standbyOverlay.visibility = if (standby) View.VISIBLE else View.GONE
        if (standby) {
            exoPlayer.pause()
            imageTimerJob?.cancel()
            webCreative.teardown()
        } else {
            playCurrentItem()
        }
        onStateChanged()
    }

    fun clearQuarantine(assetId: String?) {
        watchdog.clearQuarantine(assetId)
        consecutiveFailures = 0
        evaluateSchedule(resetCursor = false)
    }

    fun exitSafeMode() {
        watchdog.exitSafeMode()
        consecutiveFailures = 0
        safeModeOverlay.visibility = View.GONE
        evaluateSchedule(resetCursor = true)
    }

    fun stopAll() {
        imageTimerJob?.cancel()
        imageLoadJob?.cancel()
        exoPlayer.stop()
        webCreative.teardown()
        manifest = null
        playableItems = emptyList()
    }

    fun release() {
        stallMonitorJob?.cancel()
        imageTimerJob?.cancel()
        imageLoadJob?.cancel()
        webCreative.teardown()
        exoPlayer.release()
    }

    private fun resolveCurrentSchedule(m: DeviceManifest): ResolvedPlaylist? =
        ScheduleEvaluator.resolve(m, System.currentTimeMillis() + prefs.clockOffsetMs)

    private fun playCurrentItem() {
        safeModeOverlay.visibility = if (watchdog.isSafeMode) View.VISIBLE else View.GONE
        if (standby || watchdog.isSafeMode || playableItems.isEmpty()) return

        imageTimerJob?.cancel()
        imageLoadJob?.cancel()

        val item = playableItems[activeIndex % playableItems.size]
        currentItemStartedMs = System.currentTimeMillis() + prefs.clockOffsetMs
        lastFrameAdvanceIso = Instant.now().toString()

        if (!cache.isBinaryType(item.type)) {
            exoPlayer.stop()
            playerView.visibility = View.GONE
            imageView.visibility = View.GONE
            webContainer.visibility = View.VISIBLE
            webCreative.render(item)
            imageTimerJob = scope.launch {
                delay(item.durationMs.coerceAtLeast(1000L))
                recordPopAndAdvance("completed")
            }
        } else if (item.type == "image") {
            val file = cache.getCachedFileForItem(item) ?: return
            exoPlayer.stop()
            webCreative.teardown()
            webContainer.visibility = View.GONE
            playerView.visibility = View.GONE
            imageView.visibility = View.VISIBLE

            imageLoadJob = scope.launch {
                val bmp = withContext(Dispatchers.IO) {
                    KioskController.decodeDownscaledBitmap(file, 1920, 1080)
                }
                if (bmp != null) {
                    imageView.setImageBitmap(bmp)
                    consecutiveFailures = 0
                } else {
                    handleCurrentAssetFailure()
                    return@launch
                }
            }

            imageTimerJob = scope.launch {
                delay(item.durationMs.coerceAtLeast(1000L))
                recordPopAndAdvance("completed")
            }
        } else {
            val file = cache.getCachedFileForItem(item) ?: return
            webCreative.teardown()
            webContainer.visibility = View.GONE
            imageView.visibility = View.GONE
            playerView.visibility = View.VISIBLE
            exoPlayer.setMediaItem(MediaItem.fromUri(Uri.fromFile(file)))
            exoPlayer.prepare()
            exoPlayer.playWhenReady = true
        }
        onStateChanged()
    }

    private fun handleCurrentAssetFailure() {
        val current = playableItems.getOrNull(activeIndex % playableItems.size.coerceAtLeast(1))
        if (current != null) {
            watchdog.recordCrash(current.assetId)
        }
        consecutiveFailures += 1
        if (consecutiveFailures >= 4) {
            manifest = cache.rollbackToLkg() ?: manifest
            if (consecutiveFailures >= 6) {
                val allowedReboot = watchdog.requestEscalatedReboot()
                if (allowedReboot) {
                    KioskController.rebootIfDeviceOwner(activity)
                }
                if (watchdog.isSafeMode) {
                    exoPlayer.stop()
                    webCreative.teardown()
                    safeModeOverlay.visibility = View.VISIBLE
                    onStateChanged()
                    return
                }
            }
        }
        recordPopAndAdvance("interrupted")
    }

    private fun recordPopAndAdvance(status: String) {
        if (playableItems.isEmpty()) return
        val resolved = manifest?.let { resolveCurrentSchedule(it) }
        val item = playableItems[activeIndex % playableItems.size]
        val endedMs = System.currentTimeMillis() + prefs.clockOffsetMs
        val startedMs = minOf(currentItemStartedMs, endedMs)
        DisplayHelpers.recordPopEvent(popStore, resolved?.playlistId, item.assetId, startedMs, endedMs, status)
        onPopEnqueued()
        activeIndex = (activeIndex + 1) % playableItems.size
        evaluateSchedule(resetCursor = false)
        playCurrentItem()
    }

    private fun startStallWatchdog() {
        stallMonitorJob?.cancel()
        stallMonitorJob = scope.launch {
            var lastPos = -1L
            var frozenStartMs = 0L
            while (isActive) {
                delay(2000)
                if (!standby && !watchdog.isSafeMode && playerView.visibility == View.VISIBLE && exoPlayer.isPlaying) {
                    val pos = exoPlayer.currentPosition
                    if (pos == lastPos) {
                        if (frozenStartMs == 0L) frozenStartMs = SystemClock.elapsedRealtime()
                        if (SystemClock.elapsedRealtime() - frozenStartMs >= 6000L) {
                            frozenStartMs = 0L
                            handleCurrentAssetFailure()
                        }
                    } else {
                        lastPos = pos
                        frozenStartMs = 0L
                        lastFrameAdvanceIso = Instant.now().toString()
                    }
                } else {
                    lastPos = -1L
                    frozenStartMs = 0L
                }
            }
        }
    }
}
