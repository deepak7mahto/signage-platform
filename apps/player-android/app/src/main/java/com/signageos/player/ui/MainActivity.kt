package com.signageos.player.ui

import android.app.AlertDialog
import android.os.Bundle
import android.text.InputType
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.media3.ui.PlayerView
import com.signageos.player.R
import com.signageos.player.data.AssetCacheManager
import com.signageos.player.data.DevicePrefs
import com.signageos.player.data.PopQueueStore
import com.signageos.player.data.ScheduleEvaluator
import com.signageos.player.mdm.KioskController
import com.signageos.player.mdm.WatchdogPolicy
import com.signageos.player.network.SignageApiClient
import com.signageos.player.playback.PlaybackController
import com.signageos.player.sync.SyncOrchestrator
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.io.File

class MainActivity : AppCompatActivity() {
    private lateinit var prefs: DevicePrefs
    private lateinit var api: SignageApiClient
    private lateinit var cache: AssetCacheManager
    private lateinit var popStore: PopQueueStore
    private lateinit var watchdog: WatchdogPolicy
    private lateinit var playback: PlaybackController
    private lateinit var sync: SyncOrchestrator

    private lateinit var playerView: PlayerView
    private lateinit var imageView: ImageView
    private lateinit var webCreativeContainer: FrameLayout
    private lateinit var standbyOverlay: LinearLayout
    private lateinit var safeModeOverlay: LinearLayout
    private lateinit var pairingContainer: LinearLayout
    private lateinit var pairingCodeText: TextView
    private lateinit var pairingStatusText: TextView
    private lateinit var serverUrlInput: EditText
    private lateinit var connectServerBtn: Button
    private lateinit var hudOverlay: LinearLayout
    private lateinit var hudTitleText: TextView
    private lateinit var hudDetailsText: TextView
    private lateinit var unpairBtn: Button

    private var pairingJob: Job? = null
    private var wsConnected = false
    private var cachedCount = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        DisplayHelpers.hideSystemUi(this)

        prefs = DevicePrefs(this)
        api = SignageApiClient()
        cache = AssetCacheManager(this, api.http)
        popStore = PopQueueStore(this)
        watchdog = WatchdogPolicy(File(filesDir, "signage_cache/watchdog_state.json"))

        bindViews()
        playback = PlaybackController(
            activity = this,
            scope = lifecycleScope,
            prefs = prefs,
            cache = cache,
            popStore = popStore,
            watchdog = watchdog,
            playerView = playerView,
            imageView = imageView,
            webContainer = webCreativeContainer,
            standbyOverlay = standbyOverlay,
            safeModeOverlay = safeModeOverlay,
            onStateChanged = { updateHudText() },
            onPopEnqueued = { sync.flushPopAsync() },
        )
        sync = SyncOrchestrator(
            activity = this,
            scope = lifecycleScope,
            prefs = prefs,
            api = api,
            cache = cache,
            popStore = popStore,
            watchdog = watchdog,
            playback = playback,
            playerView = playerView,
            onRevoked = { handleUnpair() },
            onStatusUpdated = { connected, count ->
                wsConnected = connected
                cachedCount = count
                updateHudText()
            },
        )

        KioskController.enableLockTaskIfDeviceOwner(this)
        if (prefs.isPaired()) {
            enterPairedMode()
        } else {
            enterUnpairedMode()
        }
    }

    private fun bindViews() {
        playerView = findViewById(R.id.playerView)
        imageView = findViewById(R.id.imageView)
        webCreativeContainer = findViewById(R.id.webCreativeContainer)
        standbyOverlay = findViewById(R.id.standbyOverlay)
        safeModeOverlay = findViewById(R.id.safeModeOverlay)
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
        unpairBtn.setOnClickListener { promptPinOrUnpair() }
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
        sync.stop()
        playback.release()
        popStore.close()
    }

    private fun enterUnpairedMode() {
        pairingContainer.visibility = View.VISIBLE
        playerView.visibility = View.GONE
        imageView.visibility = View.GONE
        webCreativeContainer.visibility = View.GONE
        standbyOverlay.visibility = View.GONE
        safeModeOverlay.visibility = View.GONE
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
            playback.updateManifest(cached, resetCursor = true)
        }
        sync.start()
    }

    private fun promptPinOrUnpair() {
        if (prefs.unpairPinSha256.isNullOrBlank()) {
            handleUnpair()
            return
        }
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            hint = "Admin PIN"
        }
        AlertDialog.Builder(this)
            .setTitle("Confirm Unpair")
            .setMessage("Enter admin PIN to unpair display:")
            .setView(input)
            .setPositiveButton("Unpair") { _, _ ->
                if (KioskController.verifyPinWithLockout(prefs, input.text.toString())) {
                    handleUnpair()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun handleUnpair() {
        runOnUiThread {
            sync.stop()
            playback.stopAll()
            prefs.clearPairing()
            cache.clearAll()
            popStore.clear()
            enterUnpairedMode()
        }
    }

    private fun updateHudText() {
        if (hudOverlay.visibility != View.VISIBLE) return
        val m = playback.manifest
        val resolved = m?.let { ScheduleEvaluator.resolve(it, System.currentTimeMillis() + prefs.clockOffsetMs) }
        hudTitleText.text = m?.screenName ?: prefs.screenName ?: "SignageOS Player"
        hudDetailsText.text = DisplayHelpers.formatHudDetails(
            activity = this,
            wsConnected = wsConnected,
            resolved = resolved,
            playableItems = playback.playableItems,
            activeIndex = playback.activeIndex,
            cachedCount = cachedCount,
            popQueued = popStore.count(),
        )
    }
}
