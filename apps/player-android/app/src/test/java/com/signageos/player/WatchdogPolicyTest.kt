package com.signageos.player

import com.signageos.player.mdm.WatchdogPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class WatchdogPolicyTest {
    @Test
    fun `quarantines asset after two crashes and clears on manifest increment`() {
        val tmp = Files.createTempDirectory("wd-test").toFile()
        val stateFile = File(tmp, "watchdog_state.json")
        val wd = WatchdogPolicy(stateFile)

        assertFalse(wd.recordCrash("asset-a"))
        assertFalse(wd.isQuarantined("asset-a"))
        assertTrue(wd.recordCrash("asset-a"))
        assertTrue(wd.isQuarantined("asset-a"))

        // Persisted across restart
        val reloaded = WatchdogPolicy(stateFile)
        assertTrue(reloaded.isQuarantined("asset-a"))

        // Manifest version bump clears quarantine
        reloaded.onManifestVersion(1)
        assertTrue(reloaded.onManifestVersion(2))
        assertFalse(reloaded.isQuarantined("asset-a"))
        tmp.deleteRecursively()
    }

    @Test
    fun `caps OS reboots at 3 per hour and enters safe mode on 4th`() {
        val tmp = Files.createTempDirectory("wd-reboot").toFile()
        val stateFile = File(tmp, "watchdog_state.json")
        val wd = WatchdogPolicy(stateFile)

        val baseMs = 1_700_000_000_000L
        assertTrue(wd.requestEscalatedReboot(baseMs + 1_000))
        assertTrue(wd.requestEscalatedReboot(baseMs + 2_000))
        assertTrue(wd.requestEscalatedReboot(baseMs + 3_000))
        assertFalse(wd.isSafeMode)

        // 4th reboot within 60 minutes trips locked Safe-Mode Slate
        assertFalse(wd.requestEscalatedReboot(baseMs + 4_000))
        assertTrue(wd.isSafeMode)

        // Exiting safe mode restores playback
        wd.exitSafeMode()
        assertFalse(wd.isSafeMode)
        assertEquals(emptySet<String>(), wd.quarantinedIds)
        tmp.deleteRecursively()
    }
}
