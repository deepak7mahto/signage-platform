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
    private val blobDir = File(rootDir, "blobs").apply { mkdirs() }
    private val tmpDir = File(rootDir, "tmp").apply { mkdirs() }
    private val manifestFile = File(rootDir, "manifest.json")
    private val manifestLkgFile = File(rootDir, "manifest_lkg.json")
    private val manifestTmpFile = File(rootDir, "manifest.json.tmp")

    fun saveManifest(manifest: DeviceManifest) {
        manifestTmpFile.writeText(json.encodeToString(manifest))
        manifestTmpFile.renameTo(manifestFile)
    }

    fun loadManifest(): DeviceManifest? {
        if (!manifestFile.exists()) return null
        return runCatching { json.decodeFromString<DeviceManifest>(manifestFile.readText()) }.getOrNull()
    }

    fun promoteToLkg(manifest: DeviceManifest) {
        val tmp = File(rootDir, "manifest_lkg.tmp")
        tmp.writeText(json.encodeToString(manifest))
        tmp.renameTo(manifestLkgFile)
    }

    fun rollbackToLkg(): DeviceManifest? {
        if (!manifestLkgFile.exists()) return null
        val lkg = runCatching {
            json.decodeFromString<DeviceManifest>(manifestLkgFile.readText())
        }.getOrNull() ?: return null
        saveManifest(lkg)
        return lkg
    }

    fun isBinaryType(type: String): Boolean = type == "video" || type == "image"

    fun getCachedBlob(sha256: String): File? {
        if (sha256.isBlank()) return null
        val file = File(blobDir, sha256)
        return if (file.exists() && file.length() > 0L) file else null
    }

    fun getCachedFileForItem(item: ManifestItem): File? {
        if (!isBinaryType(item.type)) return null
        return getCachedBlob(item.sha256)
    }

    suspend fun syncAssets(manifest: DeviceManifest): Int = withContext(Dispatchers.IO) {
        val uniqueItems = collectAllItems(manifest)

        for (item in uniqueItems) {
            if (!isBinaryType(item.type) || item.sha256.isBlank()) continue
            val target = File(blobDir, item.sha256)
            // Content-addressed blob already present: skip redundant re-hashing
            if (target.exists() && target.length() > 0L) {
                continue
            }

            val part = File(tmpDir, "${item.sha256}.part")
            val downloaded = downloadWithResume(item.url, part)
            if (!downloaded) continue

            if (sha256Of(part) == item.sha256) {
                if (target.exists()) target.delete()
                part.renameTo(target)
            } else {
                part.delete()
            }
        }

        // Garbage collect keeping union of active + LKG manifest sha256 blobs
        val keepHashes = uniqueItems.filter { isBinaryType(it.type) }.map { it.sha256 }.toMutableSet()
        rollbackPreviewHashes()?.let { keepHashes.addAll(it) }
        blobDir.listFiles()?.forEach { file ->
            if (!keepHashes.contains(file.name)) {
                file.delete()
            }
        }

        blobDir.listFiles()?.count { it.isFile } ?: 0
    }

    fun clearAll() {
        blobDir.listFiles()?.forEach { it.delete() }
        tmpDir.listFiles()?.forEach { it.delete() }
        manifestFile.delete()
        manifestLkgFile.delete()
    }

    private fun rollbackPreviewHashes(): Set<String>? {
        if (!manifestLkgFile.exists()) return null
        val lkg = runCatching { json.decodeFromString<DeviceManifest>(manifestLkgFile.readText()) }.getOrNull()
            ?: return null
        return collectAllItems(lkg).map { it.sha256 }.toSet()
    }

    private fun collectAllItems(manifest: DeviceManifest): List<ManifestItem> {
        val map = linkedMapOf<String, ManifestItem>()
        manifest.items.forEach { map[it.sha256.ifBlank { it.assetId }] = it }
        manifest.playlists.values.forEach { pl ->
            pl.items.forEach { map[it.sha256.ifBlank { it.assetId }] = it }
        }
        return map.values.toList()
    }

    private fun downloadWithResume(url: String, partFile: File): Boolean {
        return try {
            val existingLen = if (partFile.exists()) partFile.length() else 0L
            val reqBuilder = Request.Builder().url(url)
            if (existingLen > 0L) {
                reqBuilder.header("Range", "bytes=$existingLen-")
            }

            http.newCall(reqBuilder.build()).execute().use { resp ->
                if (resp.code == 416) return true
                if (!resp.isSuccessful) return false
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
