package com.signageos.player.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest

class AssetCacheManager(
    context: Context,
    private val http: OkHttpClient,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val rootDir = File(context.filesDir, "signage_cache").apply { mkdirs() }
    private val cacheDir = File(rootDir, "media").apply { mkdirs() }
    private val tmpDir = File(rootDir, "tmp").apply { mkdirs() }
    private val manifestFile = File(rootDir, "manifest.json")
    private val manifestTmpFile = File(rootDir, "manifest.json.tmp")

    fun saveManifest(manifest: DeviceManifest) {
        manifestTmpFile.writeText(json.encodeToString(manifest))
        manifestTmpFile.renameTo(manifestFile)
    }

    fun loadManifest(): DeviceManifest? {
        if (!manifestFile.exists()) return null
        return runCatching { json.decodeFromString<DeviceManifest>(manifestFile.readText()) }.getOrNull()
    }

    fun getCachedFile(assetId: String): File? {
        val file = File(cacheDir, assetId)
        return if (file.exists() && file.length() > 0L) file else null
    }

    suspend fun syncAssets(manifest: DeviceManifest): Int = withContext(Dispatchers.IO) {
        val uniqueItems = linkedMapOf<String, ManifestItem>()
        manifest.items.forEach { uniqueItems[it.assetId] = it }
        manifest.playlists.values.forEach { pl ->
            pl.items.forEach { uniqueItems[it.assetId] = it }
        }

        for (item in uniqueItems.values) {
            val target = File(cacheDir, item.assetId)
            if (target.exists() && sha256Of(target) == item.sha256) {
                continue
            }

            val part = File(tmpDir, "${item.assetId}.part")
            val downloaded = downloadWithResume(item.url, part)
            if (!downloaded) continue

            if (sha256Of(part) == item.sha256) {
                if (target.exists()) target.delete()
                part.renameTo(target)
            } else {
                part.delete()
            }
        }

        // Garbage collect unreferenced assets to protect eMMC longevity
        val keepIds = uniqueItems.keys
        cacheDir.listFiles()?.forEach { file ->
            if (!keepIds.contains(file.name)) {
                file.delete()
            }
        }

        cacheDir.listFiles()?.count { it.isFile } ?: 0
    }

    fun clearAll() {
        cacheDir.listFiles()?.forEach { it.delete() }
        tmpDir.listFiles()?.forEach { it.delete() }
        manifestFile.delete()
    }

    private fun downloadWithResume(url: String, partFile: File): Boolean {
        return try {
            val existingLen = if (partFile.exists()) partFile.length() else 0L
            val reqBuilder = Request.Builder().url(url)
            if (existingLen > 0L) {
                reqBuilder.header("Range", "bytes=$existingLen-")
            }

            http.newCall(reqBuilder.build()).execute().use { resp ->
                if (resp.code == 416) {
                    // Already fully downloaded
                    return true
                }
                if (!resp.isSuccessful) {
                    return false
                }
                val isPartial = resp.code == 206 && existingLen > 0L
                val body = resp.body ?: return false
                body.byteStream().use { input ->
                    FileOutputStream(partFile, isPartial).use { output ->
                        input.copyTo(output, bufferSize = 64 * 1024)
                    }
                }
                true
            }
        } catch (_: Throwable) {
            false
        }
    }

    private fun sha256Of(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        val buf = ByteArray(64 * 1024)
        file.inputStream().use { input ->
            while (true) {
                val read = input.read(buf)
                if (read <= 0) break
                md.update(buf, 0, read)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}
