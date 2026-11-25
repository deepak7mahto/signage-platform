package com.signageos.player.data

import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

data class ResolvedPlaylist(
    val playlistId: String?,
    val playlistName: String?,
    val scheduleName: String?,
    val items: List<ManifestItem>,
)

object ScheduleEvaluator {
    private val dateFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")
    private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm")

    fun resolve(manifest: DeviceManifest, nowMs: Long = System.currentTimeMillis()): ResolvedPlaylist {
        if (manifest.schedules.isNotEmpty() && manifest.playlists.isNotEmpty()) {
            val zone = try {
                ZoneId.of(manifest.timezone.ifBlank { "UTC" })
            } catch (_: Throwable) {
                ZoneId.of("UTC")
            }

            val zdt: ZonedDateTime = Instant.ofEpochMilli(nowMs).atZone(zone)
            val dateStr = zdt.format(dateFormatter)
            val timeStr = zdt.format(timeFormatter)
            // DayOfWeek.value is 1 (Mon)..7 (Sun) -> convert to 0 (Sun)..6 (Sat)
            val dayIndex = zdt.dayOfWeek.value % 7

            val match = manifest.schedules
                .filter { s ->
                    val pl = manifest.playlists[s.playlistId] ?: return@filter false
                    if (pl.items.isEmpty()) return@filter false
                    if (s.validFrom != null && dateStr < s.validFrom) return@filter false
                    if (s.validUntil != null && dateStr > s.validUntil) return@filter false
                    if (s.daysOfWeek.isNotEmpty() && !s.daysOfWeek.contains(dayIndex)) return@filter false

                    if (s.startTime <= s.endTime) {
                        timeStr >= s.startTime && timeStr <= s.endTime
                    } else {
                        timeStr >= s.startTime || timeStr <= s.endTime
                    }
                }
                .sortedWith(
                    compareByDescending<ManifestSchedule> { it.priority }
                        .thenByDescending { it.updatedAt ?: "" }
                        .thenBy { it.id },
                )
                .firstOrNull()

            if (match != null) {
                val pl = manifest.playlists.getValue(match.playlistId)
                return ResolvedPlaylist(
                    playlistId = pl.id,
                    playlistName = pl.name,
                    scheduleName = match.name,
                    items = pl.items,
                )
            }
        }

        return ResolvedPlaylist(
            playlistId = manifest.playlistId,
            playlistName = manifest.playlistName,
            scheduleName = null,
            items = manifest.items,
        )
    }
}
