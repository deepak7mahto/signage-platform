package com.signageos.player.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class PairRequestResponse(
    val code: String,
    val claimSecret: String,
    val expiresAt: String,
)

@Serializable
data class PairPollRequest(
    val code: String,
    val claimSecret: String,
)

@Serializable
data class PairPollResponse(
    val status: String,
    val screenId: String? = null,
    val screenName: String? = null,
    val deviceToken: String? = null,
)

@Serializable
data class ManifestItem(
    val itemId: String,
    val assetId: String,
    val title: String,
    val type: String,
    val mimeType: String,
    val sha256: String,
    val sizeBytes: Long,
    val durationMs: Long,
    val sortOrder: Int,
    val url: String,
)

@Serializable
data class ManifestSchedule(
    val id: String,
    val name: String,
    val playlistId: String,
    val priority: Int,
    val daysOfWeek: List<Int> = emptyList(),
    val startTime: String = "00:00",
    val endTime: String = "23:59",
    val validFrom: String? = null,
    val validUntil: String? = null,
)

@Serializable
data class ManifestPlaylist(
    val id: String,
    val name: String,
    val version: Int,
    val items: List<ManifestItem> = emptyList(),
)

@Serializable
data class DeviceManifest(
    val screenId: String,
    val screenName: String,
    val timezone: String = "UTC",
    val playlistId: String? = null,
    val playlistName: String? = null,
    val manifestVersion: Int = 0,
    val generatedAt: String = "",
    val serverTime: String = "",
    val items: List<ManifestItem> = emptyList(),
    val schedules: List<ManifestSchedule> = emptyList(),
    val playlists: Map<String, ManifestPlaylist> = emptyMap(),
)

@Serializable
data class PopEventInput(
    val id: String,
    val playlistId: String? = null,
    val mediaAssetId: String,
    val startedAt: String,
    val endedAt: String,
    val durationMs: Long,
    val status: String = "completed",
)

@Serializable
data class PopBatchRequest(
    val events: List<PopEventInput>,
)

@Serializable
data class HeartbeatRequest(
    val appVersion: String,
    val manifestVersion: Int,
    val currentAssetId: String? = null,
    val hwInfo: JsonObject? = null,
)

@Serializable
data class AckMessage(
    val type: String = "ack",
    val commandId: String? = null,
    val command: String,
    val status: String,
    val detail: String? = null,
)

@Serializable
data class PongMessage(
    val type: String = "pong",
    val clientTime: String,
)
