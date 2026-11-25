package com.signageos.player.data

import kotlin.math.abs

data class ClockSyncCursor(
    val itemIndex: Int,
    val positionMs: Long,
    val loopPositionMs: Long,
    val totalDurationMs: Long,
    val needsSeek: Boolean,
)

object ClockSyncEvaluator {
    fun resolveCursor(
        durationsMs: List<Long>,
        nowMs: Long,
        clockOffsetMs: Long = 0L,
        epochMs: Long = 0L,
        currentIndex: Int? = null,
        currentPositionMs: Long? = null,
        seekThresholdMs: Long = 600L,
    ): ClockSyncCursor? {
        val valid = durationsMs.filter { it > 0L }
        if (valid.isEmpty()) return null

        val totalDurationMs = valid.sum()
        val adjustedNowMs = nowMs + clockOffsetMs
        val elapsedFromEpoch = adjustedNowMs - epochMs
        val mod = elapsedFromEpoch % totalDurationMs
        val loopPositionMs = if (mod < 0L) mod + totalDurationMs else mod

        var acc = 0L
        var itemIndex = 0
        var positionMs = 0L
        for (i in valid.indices) {
            val dur = valid[i]
            if (loopPositionMs < acc + dur) {
                itemIndex = i
                positionMs = loopPositionMs - acc
                break
            }
            acc += dur
        }

        val needsSeek = if (currentIndex != null && currentPositionMs != null) {
            currentIndex != itemIndex || abs(currentPositionMs - positionMs) > seekThresholdMs
        } else {
            true
        }

        return ClockSyncCursor(
            itemIndex = itemIndex,
            positionMs = positionMs,
            loopPositionMs = loopPositionMs,
            totalDurationMs = totalDurationMs,
            needsSeek = needsSeek,
        )
    }
}
