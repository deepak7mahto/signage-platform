package com.signageos.player.mdm

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

@Serializable
data class WatchdogPersistedState(
    val rebootTimestampsMs: List<Long> = emptyList(),
    val safeMode: Boolean = false,
    val quarantinedAssetIds: Set<String> = emptySet(),
    val crashCounts: Map<String, Int> = emptyMap(),
    val lastManifestVersion: Int = 0,
)

class WatchdogPolicy(
    private val stateFile: File,
    private val crashQuarantineThreshold: Int = 2,
    private val maxRebootsPerHour: Int = 3,
    private val rebootWindowMs: Long = 3_600_000L,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private var state: WatchdogPersistedState = loadState()

    val isSafeMode: Boolean
        get() = state.safeMode

    val quarantinedIds: Set<String>
        get() = state.quarantinedAssetIds

    fun isQuarantined(assetId: String): Boolean = state.quarantinedAssetIds.contains(assetId)

    fun onManifestVersion(version: Int): Boolean {
        if (version > state.lastManifestVersion && state.lastManifestVersion > 0) {
            state = state.copy(
                quarantinedAssetIds = emptySet(),
                crashCounts = emptyMap(),
                lastManifestVersion = version,
            )
            saveState()
            return true
        }
        if (version != state.lastManifestVersion) {
            state = state.copy(lastManifestVersion = version)
            saveState()
        }
        return false
    }

    fun recordCrash(assetId: String): Boolean {
        val nextCount = (state.crashCounts[assetId] ?: 0) + 1
        val nextCounts = state.crashCounts.toMutableMap().apply { put(assetId, nextCount) }
        val nextQuarantined = state.quarantinedAssetIds.toMutableSet()
        val quarantinedNow = nextCount >= crashQuarantineThreshold
        if (quarantinedNow) {
            nextQuarantined.add(assetId)
        }
        state = state.copy(
            crashCounts = nextCounts,
            quarantinedAssetIds = nextQuarantined,
        )
        saveState()
        return quarantinedNow
    }

    fun clearQuarantine(assetId: String? = null) {
        state = if (assetId != null) {
            state.copy(
                quarantinedAssetIds = state.quarantinedAssetIds - assetId,
                crashCounts = state.crashCounts - assetId,
            )
        } else {
            state.copy(
                quarantinedAssetIds = emptySet(),
                crashCounts = emptyMap(),
            )
        }
        saveState()
    }

    fun requestEscalatedReboot(nowMs: Long = System.currentTimeMillis()): Boolean {
        val cutoff = nowMs - rebootWindowMs
        val recent = state.rebootTimestampsMs.filter { it >= cutoff }
        if (recent.size >= maxRebootsPerHour) {
            state = state.copy(rebootTimestampsMs = recent, safeMode = true)
            saveState()
            return false
        }
        state = state.copy(rebootTimestampsMs = recent + nowMs)
        saveState()
        return true
    }

    fun exitSafeMode() {
        state = state.copy(
            safeMode = false,
            quarantinedAssetIds = emptySet(),
            crashCounts = emptyMap(),
        )
        saveState()
    }

    private fun loadState(): WatchdogPersistedState {
        if (!stateFile.exists()) return WatchdogPersistedState()
        return runCatching {
            json.decodeFromString<WatchdogPersistedState>(stateFile.readText())
        }.getOrDefault(WatchdogPersistedState())
    }

    private fun saveState() {
        stateFile.parentFile?.mkdirs()
        val tmp = File(stateFile.parentFile, "${stateFile.name}.tmp")
        tmp.writeText(json.encodeToString(state))
        tmp.renameTo(stateFile)
    }
}
