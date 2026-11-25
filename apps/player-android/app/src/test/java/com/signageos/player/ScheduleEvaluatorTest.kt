package com.signageos.player

import com.signageos.player.data.DeviceManifest
import com.signageos.player.data.ManifestItem
import com.signageos.player.data.ManifestPlaylist
import com.signageos.player.data.ManifestSchedule
import com.signageos.player.data.ScheduleEvaluator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

class ScheduleEvaluatorTest {
    private fun item(id: String, title: String) = ManifestItem(
        itemId = "item-$id",
        assetId = "asset-$id",
        title = title,
        type = "video",
        mimeType = "video/mp4",
        sha256 = "abc",
        sizeBytes = 1000L,
        durationMs = 10000L,
        sortOrder = 0,
        url = "http://localhost:8080/media/$id.mp4",
    )

    @Test
    fun `selects highest priority matching schedule in timezone`() {
        val manifest = DeviceManifest(
            screenId = "scr-1",
            screenName = "Lobby TV",
            timezone = "Asia/Kolkata",
            playlistId = "pl-fallback",
            playlistName = "Fallback",
            items = listOf(item("1", "Fallback Ad")),
            playlists = mapOf(
                "pl-campaign" to ManifestPlaylist("pl-campaign", "Campaign", 1, listOf(item("2", "Campaign Ad"))),
                "pl-override" to ManifestPlaylist("pl-override", "Override", 1, listOf(item("3", "Override Ad"))),
            ),
            schedules = listOf(
                ManifestSchedule("s1", "Campaign", "pl-campaign", priority = 50, startTime = "09:00", endTime = "18:00"),
                ManifestSchedule("s2", "Emergency", "pl-override", priority = 100, startTime = "09:00", endTime = "18:00"),
            ),
        )

        // 2026-11-25 06:00 UTC == 11:30 Asia/Kolkata (Wednesday = 3)
        val nowMs = Instant.parse("2026-11-25T06:00:00Z").toEpochMilli()
        val resolved = ScheduleEvaluator.resolve(manifest, nowMs)

        assertEquals("pl-override", resolved.playlistId)
        assertEquals("Emergency", resolved.scheduleName)
        assertEquals("Override Ad", resolved.items.first().title)
    }

    @Test
    fun `supports overnight daypart wrap and falls back outside flight dates`() {
        val manifest = DeviceManifest(
            screenId = "scr-1",
            screenName = "Lobby TV",
            timezone = "UTC",
            playlistId = "pl-fallback",
            playlistName = "Fallback",
            items = listOf(item("1", "Fallback Ad")),
            playlists = mapOf(
                "pl-night" to ManifestPlaylist("pl-night", "Night Loop", 1, listOf(item("2", "Night Ad"))),
            ),
            schedules = listOf(
                ManifestSchedule(
                    id = "s-night",
                    name = "Night Wrap",
                    playlistId = "pl-night",
                    priority = 50,
                    startTime = "22:00",
                    endTime = "06:00",
                    validFrom = "2026-11-24",
                    validUntil = "2026-11-26",
                ),
            ),
        )

        // 23:30 UTC on 2026-11-25 -> matches overnight wrap
        val activeMs = Instant.parse("2026-11-25T23:30:00Z").toEpochMilli()
        val activeResolved = ScheduleEvaluator.resolve(manifest, activeMs)
        assertEquals("pl-night", activeResolved.playlistId)
        assertEquals("Night Wrap", activeResolved.scheduleName)

        // 2026-12-01 -> outside validUntil, falls back
        val expiredMs = Instant.parse("2026-12-01T23:30:00Z").toEpochMilli()
        val fallbackResolved = ScheduleEvaluator.resolve(manifest, expiredMs)
        assertEquals("pl-fallback", fallbackResolved.playlistId)
        assertNull(fallbackResolved.scheduleName)
    }
}
