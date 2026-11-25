package com.signageos.player.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class PopQueueStore(context: Context) : SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {
    private val json = Json { ignoreUnknownKeys = true }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS pop_queue (
                id TEXT PRIMARY KEY,
                payload_json TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
            """.trimIndent(),
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    fun enqueue(event: PopEventInput) {
        val now = System.currentTimeMillis()
        val values = ContentValues().apply {
            put("id", event.id)
            put("payload_json", json.encodeToString(event))
            put("created_at", now)
        }
        writableDatabase.insertWithOnConflict("pop_queue", null, values, SQLiteDatabase.CONFLICT_REPLACE)
        prune(now)
    }

    /** Enforces max offline retention window (30 days) and row cap (50k) FIFO. */
    fun prune(
        nowMs: Long = System.currentTimeMillis(),
        maxRetentionMs: Long = MAX_RETENTION_MS,
        maxRows: Int = MAX_QUEUE_ROWS,
    ) {
        val db = writableDatabase
        val cutoff = nowMs - maxRetentionMs
        db.delete("pop_queue", "created_at < ?", arrayOf(cutoff.toString()))
        val current = count()
        if (current > maxRows) {
            val overflow = current - maxRows
            db.execSQL(
                "DELETE FROM pop_queue WHERE id IN (SELECT id FROM pop_queue ORDER BY created_at ASC LIMIT ?)",
                arrayOf(overflow),
            )
        }
    }

    fun peekBatch(limit: Int = 100): List<PopEventInput> {
        val out = mutableListOf<PopEventInput>()
        readableDatabase.rawQuery(
            "SELECT payload_json FROM pop_queue ORDER BY created_at ASC LIMIT ?",
            arrayOf(limit.toString()),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                val raw = cursor.getString(0)
                runCatching { json.decodeFromString<PopEventInput>(raw) }.getOrNull()?.let(out::add)
            }
        }
        return out
    }

    fun deleteByIds(ids: List<String>) {
        if (ids.isEmpty()) return
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (id in ids) {
                db.delete("pop_queue", "id = ?", arrayOf(id))
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun count(): Int {
        readableDatabase.rawQuery("SELECT COUNT(*) FROM pop_queue", null).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getInt(0) else 0
        }
    }

    fun clear() {
        writableDatabase.delete("pop_queue", null, null)
    }

    companion object {
        private const val DB_NAME = "signage_pop.db"
        private const val DB_VERSION = 1
        private const val MAX_RETENTION_MS = 30L * 24 * 60 * 60 * 1000
        private const val MAX_QUEUE_ROWS = 50_000
    }
}
