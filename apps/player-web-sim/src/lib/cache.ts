import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { DeviceManifest, PopEventInput } from '@signage/shared';

const DB_NAME = 'signage_player_cache_v1';
const DB_VERSION = 2;
const ASSETS_STORE = 'assets';
const META_STORE = 'meta';
const POP_STORE = 'pop_queue';

export const POP_MAX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const POP_MAX_EVENTS_PER_SLOT = 50_000;

export interface CachedAsset {
  assetId: string;
  sha256: string;
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
      if (!db.objectStoreNames.contains(ASSETS_STORE)) {
        db.createObjectStore(ASSETS_STORE, { keyPath: 'assetId' });
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

export async function getCachedAsset(assetId: string): Promise<CachedAsset | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, 'readonly');
    const req = tx.objectStore(ASSETS_STORE).get(assetId);
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

export async function gcCachedAssets(keepAssetIds: Set<string>): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, ASSETS_STORE], 'readwrite');
    const metaStore = tx.objectStore(META_STORE);
    const assetStore = tx.objectStore(ASSETS_STORE);
    const metaReq = metaStore.getAll();
    let count = 0;

    metaReq.onsuccess = () => {
      const unionKeep = new Set(keepAssetIds);
      const rows = (metaReq.result as StoredMetaRow[]) ?? [];
      for (const row of rows) {
        if (row.key !== 'manifest' && !row.key.startsWith('manifest:')) continue;
        const manifest = row.value;
        for (const item of manifest?.items ?? []) {
          unionKeep.add(item.assetId);
        }
        for (const pl of Object.values(manifest?.playlists ?? {})) {
          for (const item of pl.items ?? []) {
            unionKeep.add(item.assetId);
          }
        }
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
    const req = store.getAll();
    let evicted = 0;

    req.onsuccess = () => {
      const rows = ((req.result as StoredPopEvent[]) ?? []).filter(
        (row) => (row.slot ?? 'default') === slot,
      );

      const survivors: Array<{ id: string; endedMs: number }> = [];
      for (const row of rows) {
        const endedMs = Date.parse(row.endedAt);
        if (Number.isFinite(endedMs) && endedMs < cutoffMs) {
          store.delete(row.id);
          evicted += 1;
        } else {
          survivors.push({ id: row.id, endedMs: Number.isFinite(endedMs) ? endedMs : 0 });
        }
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
    const req = tx.objectStore(POP_STORE).getAll();
    req.onsuccess = () => {
      const rows = (req.result as StoredPopEvent[]) ?? [];
      const filtered = rows
        .filter((row) => (row.slot ?? 'default') === slot)
        .sort((a, b) => Date.parse(a.endedAt) - Date.parse(b.endedAt))
        .slice(0, limit)
        .map(({ slot: _slot, ...event }) => event);
      resolve(filtered);
    };
    req.onerror = () => reject(req.error);
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
    const req = tx.objectStore(POP_STORE).getAll();
    req.onsuccess = () => {
      const rows = (req.result as StoredPopEvent[]) ?? [];
      resolve(rows.filter((row) => (row.slot ?? 'default') === slot).length);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearAllCache(slot = 'default'): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, POP_STORE], 'readwrite');
    tx.objectStore(META_STORE).delete(manifestKey(slot));
    const popStore = tx.objectStore(POP_STORE);
    const popReq = popStore.getAll();
    popReq.onsuccess = () => {
      const rows = (popReq.result as StoredPopEvent[]) ?? [];
      for (const row of rows) {
        if ((row.slot ?? 'default') === slot) {
          popStore.delete(row.id);
        }
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
