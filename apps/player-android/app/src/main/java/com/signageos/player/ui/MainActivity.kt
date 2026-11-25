package com.signageos.player.ui

import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.signageos.player.R
import com.signageos.player.data.AssetCacheManager
import com.signageos.player.data.DeviceManifest
import com.signageos.player.data.DevicePrefs
import com.signageos.player.data.ManifestItem
import com.signageos.player.data.PopQueueStore
import com.signageos.player.data.ScheduleEvaluator
import com.signageos.player.mdm.KioskController
import com.signageos.player.network.ManifestFetchResult
import com.signageos.player.network.SignageApiClient
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.WebSocket

class MainActivity : AppCompatActivity() {
    private lateinit var prefs: DevicePrefs
    private lateinit var api: SignageApiClient
    private lateinit var cache: AssetCacheManager
    private lateinit var popStore: PopQueueStore

    private lateinit var playerView: PlayerView
    private lateinit var imageView: ImageView
    private lateinit var standbyOverlay: LinearLayout
    private lateinit var pairingContainer: LinearLayout
    private lateinit var pairingCodeText: TextView
    private lateinit var pairingStatusText: TextView
    private lateinit var serverUrlInput: EditText
    private lateinit var connectServerBtn: Button
    private lateinit var hudOverlay: LinearLayout
    private lateinit var hudTitleText: TextView
    private lateinit var hudDetailsText: TextView
    private lateinit var unpairBtn: Button

    private var exoPlayer: ExoPlayer? = null
    private var webSocket: WebSocket? = null
    private var wsConnected = false
    private var standby = false

    private var manifest: DeviceManifest? = null
    private var activePlaylistKey: String? = null
    private var playableItems: List<ManifestItem> = emptyList()
    private var activeIndex = 0
    private var currentItemStartedMs = System.currentTimeMillis()
    private var cachedCount = 0

    private var pairingJob: Job? = null
    private var syncLoopJob: Job? = null
    private var imageTimerJob: Job? = null
    private var scheduleTickJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        DisplayHelpers.hideSystemUi(this)

        prefs = DevicePrefs(this)
        api = SignageApiClient()
        cache = AssetCacheManager(this, api.http)
        popStore = PopQueueStore(this)

        playerView = findViewById(R.id.playerView)
        imageView = findViewById(R.id.imageView)
        standbyOverlay = findViewById(R.id.standbyOverlay)
        pairingContainer = findViewById(R.id.pairingContainer)
        pairingCodeText = findViewById(R.id.pairingCodeText)
        pairingStatusText = findViewById(R.id.pairingStatusText)
        serverUrlInput = findViewById(R.id.serverUrlInput)
        connectServerBtn = findViewById(R.id.connectServerBtn)
        hudOverlay = findViewById(R.id.hudOverlay)
        hudTitleText = findViewById(R.id.hudTitleText)
        hudDetailsText = findViewById(R.id.hudDetailsText)
        unpairBtn = findViewById(R.id.unpairBtn)

        serverUrlInput.setText(prefs.serverBaseUrl)
        connectServerBtn.setOnClickListener {
            val url = serverUrlInput.text.toString().trim()
            if (url.isNotEmpty()) {
                prefs.serverBaseUrl = url
                startPairingLoop()
            }
        }
        unpairBtn.setOnClickListener { handleUnpair() }

        initPlayer()
        KioskController.enableLockTaskIfDeviceOwner(this)

        if (prefs.isPaired()) {
            enterPairedMode()
        } else {
            enterUnpairedMode()
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_INFO || keyCode == KeyEvent.KEYCODE_I) {
            hudOverlay.visibility = if (hudOverlay.visibility == View.VISIBLE) View.GONE else View.VISIBLE
            updateHudText()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() {
        super.onDestroy()
        pairingJob?.cancel()
        syncLoopJob?.cancel()
        imageTimerJob?.cancel()
        scheduleTickJob?.cancel()
        webSocket?.close(1000, "Activity destroyed")
        exoPlayer?.release()
        popStore.close()
    }

    private fun initPlayer() {
        exoPlayer = ExoPlayer.Builder(this).build().apply {
            addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(playbackState: Int) {
                    if (playbackState == Player.STATE_ENDED) {
                        recordPopAndAdvance("completed")
                    }
                }

                override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                    recordPopAndAdvance("interrupted")
                }
            })
        }
        playerView.player = exoPlayer
    }

    private fun enterUnpairedMode() {
        pairingContainer.visibility = View.VISIBLE
        playerView.visibility = View.GONE
        imageView.visibility = View.GONE
        standbyOverlay.visibility = View.GONE
        hudOverlay.visibility = View.GONE
        startPairingLoop()
    }

    private fun startPairingLoop() {
        pairingJob?.cancel()
        pairingJob = lifecycleScope.launch {
            DisplayHelpers.runPairingLoop(
                prefs = prefs,
                api = api,
                onCode = { code, status ->
                    pairingCodeText.text = code
                    pairingStatusText.text = status
                },
                onStatus = { status -> pairingStatusText.text = status },
                onPaired = { enterPairedMode() },
            )
        }
    }

    private fun enterPairedMode() {
        pairingJob?.cancel()
        pairingContainer.visibility = View.GONE

        cache.loadManifest()?.let { cached ->
            manifest = cached
            evaluateScheduleAndStartPlayback(resetCursor = true)
        }

        connectWebSocket()
        startSyncAndHeartbeatLoops()
    }

    private fun handleUnpair() {
        runOnUiThread {
            syncLoopJob?.cancel()
            scheduleTickJob?.cancel()
            imageTimerJob?.cancel()
            webSocket?.close(1000, "Unpaired")
            webSocket = null
            wsConnected = false
            exoPlayer?.stop()
            prefs.clearPairing()
            cache.clearAll()
            popStore.clear()
            manifest = null
            playableItems = emptyList()
            enterUnpairedMode()
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
                runOnUiThread { updateHudText() }
            },
            onSyncNow = { cmdId ->
                lifecycleScope.launch {
                    syncManifestFromServer()
                    api.sendAck(webSocket, cmdId, "sync_now", true, "Manifest synced")
                }
            },
            onRevoke = { handleUnpair() },
            onTakeScreenshot = { cmdId, uploadUrl ->
                val token = prefs.deviceToken ?: return@connectWebSocket
                lifecycleScope.launch {
                    DisplayHelpers.uploadScreenshotAndAck(
                        activity = this@MainActivity,
                        playerView = playerView,
                        api = api,
                        webSocket = webSocket,
                        serverBaseUrl = prefs.serverBaseUrl,
                        token = token,
                        commandId = cmdId,
                        uploadUrl = uploadUrl,
                    )
                }
            },
            onCecPower = { cmdId, state ->
                runOnUiThread {
                    standby = (state == "standby")
                    standbyOverlay.visibility = if (standby) View.VISIBLE else View.GONE
                    if (standby) {
                        exoPlayer?.pause()
                        imageTimerJob?.cancel()
                    } else {
                        playCurrentItem()
                    }
                    api.sendAck(webSocket, cmdId, "cec_power", true, "TV $state")
                }
            },
            onSetVolume = { cmdId, level ->
                runOnUiThread {
                    exoPlayer?.volume = (level.coerceIn(0, 100) / 100f)
                    api.sendAck(webSocket, cmdId, "set_volume", true, "Volume $level%")
                }
            },
            onReboot = { cmdId ->
                api.sendAck(webSocket, cmdId, "reboot", true, "Reboot requested")
                if (!KioskController.rebootIfDeviceOwner(this)) {
                    lifecycleScope.launch { syncManifestFromServer() }
                }
            },
        )
    }

    private fun startSyncAndHeartbeatLoops() {
        syncLoopJob?.cancel()
        syncLoopJob = lifecycleScope.launch {
            syncManifestFromServer()
            while (isActive) {
                sendHeartbeat()
                flushPopQueue()
                delay(30_000)
                if (!wsConnected) {
                    connectWebSocket()
                }
                syncManifestFromServer()
            }
        }

        scheduleTickJob?.cancel()
        scheduleTickJob = lifecycleScope.launch {
            while (isActive) {
                delay(15_000)
                evaluateScheduleAndStartPlayback(resetCursor = false)
            }
        }
    }

    private suspend fun syncManifestFromServer() {
        val token = prefs.deviceToken ?: return
        when (val result = api.fetchManifest(prefs.serverBaseUrl, token)) {
            is ManifestFetchResult.Unauthorized -> handleUnpair()
            is ManifestFetchResult.NetworkError -> Unit
            is ManifestFetchResult.Success -> {
                prefs.clockOffsetMs = result.clockOffsetMs
                cache.saveManifest(result.manifest)
                cachedCount = cache.syncAssets(result.manifest)
                manifest = result.manifest
                runOnUiThread { evaluateScheduleAndStartPlayback(resetCursor = false) }
            }
        }
    }

    private fun evaluateScheduleAndStartPlayback(resetCursor: Boolean) {
        val m = manifest ?: return
        val resolved = ScheduleEvaluator.resolve(m, System.currentTimeMillis() + prefs.clockOffsetMs)
        val newKey = "${resolved.playlistId}:${resolved.scheduleName}"
        val items = resolved.items.filter { cache.getCachedFile(it.assetId) != null }

        if (resetCursor || newKey != activePlaylistKey || items.size != playableItems.size) {
            activePlaylistKey = newKey
            playableItems = items
            activeIndex = 0
            playCurrentItem()
        }
        updateHudText()
    }

    private fun playCurrentItem() {
        if (standby || playableItems.isEmpty()) return
        imageTimerJob?.cancel()

        val item = playableItems[activeIndex % playableItems.size]
        val file = cache.getCachedFile(item.assetId) ?: return
        currentItemStartedMs = System.currentTimeMillis() + prefs.clockOffsetMs

        if (item.type == "image") {
            exoPlayer?.stop()
            playerView.visibility = View.GONE
            imageView.visibility = View.VISIBLE
            imageView.setImageBitmap(BitmapFactory.decodeFile(file.absolutePath))

            imageTimerJob = lifecycleScope.launch {
                delay(item.durationMs.coerceAtLeast(1000L))
                recordPopAndAdvance("completed")
            }
        } else {
            imageView.visibility = View.GONE
            playerView.visibility = View.VISIBLE
            exoPlayer?.apply {
                setMediaItem(MediaItem.fromUri(Uri.fromFile(file)))
                prepare()
                playWhenReady = true
            }
        }
        updateHudText()
    }

    private fun recordPopAndAdvance(status: String) {
        if (playableItems.isEmpty()) return
        val resolved = manifest?.let {
            ScheduleEvaluator.resolve(it, System.currentTimeMillis() + prefs.clockOffsetMs)
        }
        val item = playableItems[activeIndex % playableItems.size]
        val endedMs = System.currentTimeMillis() + prefs.clockOffsetMs
        val startedMs = minOf(currentItemStartedMs, endedMs)
        DisplayHelpers.recordPopEvent(popStore, resolved?.playlistId, item.assetId, startedMs, endedMs, status)

        lifecycleScope.launch { flushPopQueue() }
        activeIndex = (activeIndex + 1) % playableItems.size
        playCurrentItem()
    }

    private suspend fun sendHeartbeat() {
        val token = prefs.deviceToken ?: return
        val currentAsset = playableItems.getOrNull(activeIndex % playableItems.size.coerceAtLeast(1))?.assetId
        api.sendHeartbeat(prefs.serverBaseUrl, token, DisplayHelpers.buildHeartbeat(this, manifest, currentAsset))
    }

    private suspend fun flushPopQueue() {
        val token = prefs.deviceToken ?: return
        val batch = popStore.peekBatch(100)
        if (batch.isEmpty()) return
        if (api.uploadPopBatch(prefs.serverBaseUrl, token, batch)) {
            popStore.deleteByIds(batch.map { it.id })
            runOnUiThread { updateHudText() }
        }
    }

    private fun updateHudText() {
        if (hudOverlay.visibility != View.VISIBLE) return
        val m = manifest
        val resolved = m?.let { ScheduleEvaluator.resolve(it, System.currentTimeMillis() + prefs.clockOffsetMs) }
        hudTitleText.text = m?.screenName ?: prefs.screenName ?: "SignageOS Player"
        hudDetailsText.text = DisplayHelpers.formatHudDetails(
            activity = this,
            wsConnected = wsConnected,
            resolved = resolved,
            playableItems = playableItems,
            activeIndex = activeIndex,
            cachedCount = cachedCount,
            popQueued = popStore.count(),
        )
    }
}
