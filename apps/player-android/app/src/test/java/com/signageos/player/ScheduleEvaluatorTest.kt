package com.signageos.player

import com.signageos.player.data.ClockSyncEvaluator
import com.signageos.player.data.DeviceManifest
import com.signageos.player.data.ScheduleEvaluator
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.time.Instant

@Serializable
private data class ScheduleVectorExpected(
    val playlistId: String?,
    val scheduleName: String?,
    val itemCount: Int,
)

@Serializable
private data class ScheduleVectorCase(
    val name: String,
    val nowIso: String,
    val manifest: DeviceManifest,
    val expected: ScheduleVectorExpected,
)

@Serializable
private data class ScheduleVectorFile(
    val version: Int,
    val cases: List<ScheduleVectorCase>,
)

@Serializable
private data class ClockSyncVectorInput(
    val durationsMs: List<Long>,
    val nowMs: Long,
    val clockOffsetMs: Long = 0L,
    val epochMs: Long = 0L,
    val currentIndex: Int? = null,
    val currentPositionMs: Long? = null,
)

@Serializable
private data class ClockSyncVectorExpected(
    val itemIndex: Int,
    val positionMs: Long,
    val loopPositionMs: Long,
    val totalDurationMs: Long,
    val needsSeek: Boolean,
)

@Serializable
private data class ClockSyncVectorCase(
    val name: String,
    val input: ClockSyncVectorInput,
    val expected: ClockSyncVectorExpected? = null,
)

@Serializable
private data class ClockSyncVectorFile(
    val version: Int,
    val seekThresholdMs: Long,
    val cases: List<ClockSyncVectorCase>,
)

class ScheduleEvaluatorTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun resolveVectorsDir(): File {
        var dir: File? = File(System.getProperty("user.dir") ?: ".").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "conformance/vectors")
            if (candidate.exists()) return candidate
            dir = dir.parentFile
        }
        error("Could not locate conformance/vectors directory")
    }

    @Test
    fun `passes all schedule-resolution conformance vectors`() {
        val file = File(resolveVectorsDir(), "schedule-resolution.json")
        val vector = json.decodeFromString<ScheduleVectorFile>(file.readText())
        assertEquals(true, vector.cases.isNotEmpty())

        for (tc in vector.cases) {
            val nowMs = Instant.parse(tc.nowIso).toEpochMilli()
            val resolved = ScheduleEvaluator.resolve(tc.manifest, nowMs)
            assertEquals("playlistId mismatch for ${tc.name}", tc.expected.playlistId, resolved.playlistId)
            assertEquals("scheduleName mismatch for ${tc.name}", tc.expected.scheduleName, resolved.scheduleName)
            assertEquals("itemCount mismatch for ${tc.name}", tc.expected.itemCount, resolved.items.size)
        }
    }

    @Test
    fun `passes all clock-sync conformance vectors`() {
        val file = File(resolveVectorsDir(), "clock-sync.json")
        val vector = json.decodeFromString<ClockSyncVectorFile>(file.readText())
        assertEquals(true, vector.cases.isNotEmpty())

        for (tc in vector.cases) {
            val actual = ClockSyncEvaluator.resolveCursor(
                durationsMs = tc.input.durationsMs,
                nowMs = tc.input.nowMs,
                clockOffsetMs = tc.input.clockOffsetMs,
                epochMs = tc.input.epochMs,
                currentIndex = tc.input.currentIndex,
                currentPositionMs = tc.input.currentPositionMs,
                seekThresholdMs = vector.seekThresholdMs,
            )
            if (tc.expected == null) {
                assertEquals("Expected null for ${tc.name}", null, actual)
            } else {
                assertEquals("itemIndex mismatch for ${tc.name}", tc.expected.itemIndex, actual?.itemIndex)
                assertEquals("positionMs mismatch for ${tc.name}", tc.expected.positionMs, actual?.positionMs)
                assertEquals("loopPositionMs mismatch for ${tc.name}", tc.expected.loopPositionMs, actual?.loopPositionMs)
                assertEquals("totalDurationMs mismatch for ${tc.name}", tc.expected.totalDurationMs, actual?.totalDurationMs)
                assertEquals("needsSeek mismatch for ${tc.name}", tc.expected.needsSeek, actual?.needsSeek)
            }
        }
    }
}
