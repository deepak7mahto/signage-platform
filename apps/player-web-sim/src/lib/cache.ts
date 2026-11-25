import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { DeviceManifest, PopEventInput } from '@signage/shared/contracts';

const DB_NAME = 'signage_player_cache_v1';
const DB_VERSION = 3;
const ASSETS_STORE = 'assets';
const META_STORE = 'meta';
const POP_STORE = 'pop_queue';

export const POP_MAX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const POP_MAX_EVENTS_PER_SLOT = 50_000;

export interface CachedAsset {
  sha256: string;
  assetId?: string;
  mimeType: string;
  blob: Blob;
  cachedAt: number;
}

interface StoredPopEvent extends PopEventInput {
  slot?: string;
}

interface StoredMetaRow {
  key: string;
  value: DeviceManifest;
}

function manifestKey(slot = 'default'): string {
  return slot === 'default' ? 'manifest' : `manifest:${slot}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(ASSETS_STORE)) {
        const existingTx = req.transaction;
        const existingStore = existingTx?.objectStore(ASSETS_STORE);
        if (existingStore && existingStore.keyPath !== 'sha256') {
          db.deleteObjectStore(ASSETS_STORE);
          db.createObjectStore(ASSETS_STORE, { keyPath: 'sha256' });
        }
      } else {
        db.createObjectStore(ASSETS_STORE, { keyPath: 'sha256' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(POP_STORE)) {
        db.createObjectStore(POP_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function computeSha256Hex(buffer: ArrayBuffer): string {
  return bytesToHex(sha256(new Uint8Array(buffer)));
}

export async function getCachedAsset(sha256Hex: string): Promise<CachedAsset | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, 'readonly');
    const req = tx.objectStore(ASSETS_STORE).get(sha256Hex);
    req.onsuccess = () => resolve((req.result as CachedAsset | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function putCachedAsset(asset: CachedAsset): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, 'readwrite');
    tx.objectStore(ASSETS_STORE).put(asset);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function gcCachedAssets(keepSha256s: Set<string>): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, ASSETS_STORE], 'readwrite');
    const metaStore = tx.objectStore(META_STORE);
    const assetStore = tx.objectStore(ASSETS_STORE);
    const unionKeep = new Set(keepSha256s);
    let count = 0;

    const metaCursorReq = metaStore.openCursor();
    metaCursorReq.onsuccess = () => {
      const cursor = metaCursorReq.result;
      if (cursor) {
        const row = cursor.value as StoredMetaRow;
        if (row.key === 'manifest' || row.key.startsWith('manifest:')) {
          const manifest = row.value;
          for (const item of manifest?.items ?? []) {
            if (item.sha256) unionKeep.add(item.sha256);
          }
          for (const pl of Object.values(manifest?.playlists ?? {})) {
            for (const item of pl.items ?? []) {
              if (item.sha256) unionKeep.add(item.sha256);
            }
          }
        }
        cursor.continue();
        return;
      }

      const keysReq = assetStore.getAllKeys();
      keysReq.onsuccess = () => {
        const keys = keysReq.result as string[];
        for (const key of keys) {
          if (!unionKeep.has(key)) {
            assetStore.delete(key);
          } else {
            count += 1;
          }
        }
      };
    };

    tx.oncomplete = () => resolve(count);
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveCachedManifest(manifest: DeviceManifest, slot = 'default'): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put({ key: manifestKey(slot), value: manifest });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadCachedManifest(slot = 'default'): Promise<DeviceManifest | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readonly');
    const req = tx.objectStore(META_STORE).get(manifestKey(slot));
    req.onsuccess = () => {
      const row = req.result as StoredMetaRow | undefined;
      resolve(row?.value ?? null);
    };
    req.onerror = () => reject(req.error);
  });
}

let popWritesSincePrune = 0;

export async function prunePopQueue(slot = 'default'): Promise<number> {
  const db = await openDb();
  const cutoffMs = Date.now() - POP_MAX_RETENTION_MS;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(POP_STORE, 'readwrite');
    const store = tx.objectStore(POP_STORE);
    const survivors: Array<{ id: string; endedMs: number }> = [];
    let evicted = 0;

    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        const row = cursor.value as StoredPopEvent;
        if ((row.slot ?? 'default') === slot) {
          const endedMs = Date.parse(row.endedAt);
          if (Number.isFinite(endedMs) && endedMs < cutoffMs) {
            cursor.delete();
            evicted += 1;
          } else {
            survivors.push({ id: row.id, endedMs: Number.isFinite(endedMs) ? endedMs : 0 });
          }
        }
        cursor.continue();
        return;
      }

      if (survivors.length > POP_MAX_EVENTS_PER_SLOT) {
        survivors.sort((a, b) => a.endedMs - b.endedMs);
        const overflow = survivors.length - POP_MAX_EVENTS_PER_SLOT;
        for (let i = 0; i < overflow; i += 1) {
          store.delete(survivors[i].id);
          evicted += 1;
        }
      }
    };

    tx.oncomplete = () => resolve(evicted);
    tx.onerror = () => reject(tx.error);
  });
}

export async function enqueuePopEvent(event: PopEventInput, slot = 'default'): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(POP_STORE, 'readwrite');
    tx.objectStore(POP_STORE).put({ ...event, slot });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  popWritesSincePrune += 1;
  if (popWritesSincePrune >= 25) {
    popWritesSincePrune = 0;
    await prunePopQueue(slot).catch(() => 0);
  }
}

export async function getQueuedPopEvents(limit = 100, slot = 'default'): Promise<PopEventInput[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(POP_STORE, 'readonly');
    const collected: Array<{ event: PopEventInput; endedMs: number }> = [];
    const maxScan = Math.max(limit * 4, 500);
    let scanned = 0;

    const cursorReq = tx.objectStore(POP_STORE).openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor || scanned >= maxScan) {
        collected.sort((a, b) => a.endedMs - b.endedMs);
        resolve(collected.slice(0, limit).map((c) => c.event));
        return;
      }
      scanned += 1;
      const row = cursor.value as StoredPopEvent;
      if ((row.slot ?? 'default') === slot) {
        const { slot: _slot, ...event } = row;
        collected.push({ event, endedMs: Date.parse(event.endedAt) || 0 });
      }
      cursor.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

export async function deleteQueuedPopEvents(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(POP_STORE, 'readwrite');
    const store = tx.objectStore(POP_STORE);
    for (const id of ids) {
      store.delete(id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function countQueuedPopEvents(slot = 'default'): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(POP_STORE, 'readonly');
    let count = 0;
    const cursorReq = tx.objectStore(POP_STORE).openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) {
        resolve(count);
        return;
      }
      const row = cursor.value as StoredPopEvent;
      if ((row.slot ?? 'default') === slot) count += 1;
      cursor.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

export async function clearAllCache(slot = 'default'): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, POP_STORE], 'readwrite');
    tx.objectStore(META_STORE).delete(manifestKey(slot));
    const cursorReq = tx.objectStore(POP_STORE).openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      const row = cursor.value as StoredPopEvent;
      if ((row.slot ?? 'default') === slot) {
        cursor.delete();
      }
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
