import { useCallback, useEffect, useRef, useState } from 'react';
import { isBinaryMediaType, type DeviceManifest, type ManifestItem } from '@signage/shared';
import {
  computeSha256Hex,
  gcCachedAssets,
  getCachedAsset,
  loadCachedManifest,
  putCachedAsset,
  saveCachedManifest,
} from '../lib/cache';
import type { DeviceCredentials } from '../types';

export function useManifestSync(
  creds: DeviceCredentials | null,
  slot: string,
  previewScreenId: string | null,
  onRevoked: () => Promise<void>,
) {
  const [manifest, setManifest] = useState<DeviceManifest | null>(null);
  const [playableUrls, setPlayableUrls] = useState<Record<string, string>>({});
  const [syncing, setSyncing] = useState(false);
  const [cachedCount, setCachedCount] = useState(0);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const objectUrlsRef = useRef<Record<string, string>>({});
  const manifestVersionRef = useRef(0);
  manifestVersionRef.current = manifest?.manifestVersion ?? 0;

  const revokeAllObjectUrls = useCallback(() => {
    for (const url of Object.values(objectUrlsRef.current)) URL.revokeObjectURL(url);
    objectUrlsRef.current = {};
    setPlayableUrls({});
    setManifest(null);
  }, []);

  const hydrateAndSyncAssets = useCallback(async (nextManifest: DeviceManifest) => {
    const uniqueItems = new Map<string, ManifestItem>();
    for (const item of nextManifest.items) uniqueItems.set(item.assetId, item);
    for (const pl of Object.values(nextManifest.playlists ?? {})) {
      for (const item of pl.items) uniqueItems.set(item.assetId, item);
    }

    const keepIds = new Set(uniqueItems.keys());
    const urls: Record<string, string> = {};

    for (const item of uniqueItems.values()) {
      if (!isBinaryMediaType(item.type)) {
        urls[item.assetId] = item.url || `app://${item.type}/${item.assetId}`;
        setPlayableUrls({ ...urls });
        continue;
      }

      const cached = await getCachedAsset(item.assetId);
      if (cached && cached.sha256 === item.sha256) {
        if (!objectUrlsRef.current[item.assetId]) {
          objectUrlsRef.current[item.assetId] = URL.createObjectURL(cached.blob);
        }
        urls[item.assetId] = objectUrlsRef.current[item.assetId];
        setPlayableUrls({ ...urls });
        continue;
      }

      try {
        const res = await fetch(item.url);
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        const actualHash = computeSha256Hex(buf);
        if (actualHash !== item.sha256) continue;
        const blob = new Blob([buf], { type: item.mimeType });
        await putCachedAsset({
          assetId: item.assetId,
          sha256: actualHash,
          mimeType: item.mimeType,
          blob,
          cachedAt: Date.now(),
        });
        if (objectUrlsRef.current[item.assetId]) URL.revokeObjectURL(objectUrlsRef.current[item.assetId]);
        objectUrlsRef.current[item.assetId] = URL.createObjectURL(blob);
        urls[item.assetId] = objectUrlsRef.current[item.assetId];
        setPlayableUrls({ ...urls });
      } catch {
        if (cached) {
          if (!objectUrlsRef.current[item.assetId]) {
            objectUrlsRef.current[item.assetId] = URL.createObjectURL(cached.blob);
          }
          urls[item.assetId] = objectUrlsRef.current[item.assetId];
          setPlayableUrls({ ...urls });
        }
      }
    }

    for (const [assetId, url] of Object.entries(objectUrlsRef.current)) {
      if (!keepIds.has(assetId)) {
        URL.revokeObjectURL(url);
        delete objectUrlsRef.current[assetId];
      }
    }

    setCachedCount(await gcCachedAssets(keepIds));
    setPlayableUrls(urls);
  }, []);

  const syncManifest = useCallback(async () => {
    if (!creds) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/v1/device/manifest', {
        headers: { Authorization: `Bearer ${creds.deviceToken}` },
      });
      if (res.status === 401) {
        await onRevoked();
        return;
      }
      if (res.ok) {
        const nextManifest = (await res.json()) as DeviceManifest;
        setClockOffsetMs(Date.parse(nextManifest.serverTime) - Date.now());
        await saveCachedManifest(nextManifest, slot);
        setManifest(nextManifest);
        await hydrateAndSyncAssets(nextManifest);
      }
    } catch {
      const cached = await loadCachedManifest(slot);
      if (cached) {
        setManifest(cached);
        await hydrateAndSyncAssets(cached);
      }
    } finally {
      setSyncing(false);
    }
  }, [creds, hydrateAndSyncAssets, onRevoked, slot]);

  const syncPreviewManifest = useCallback(async () => {
    if (!previewScreenId) return;
    setSyncing(true);
    setPreviewError(null);
    try {
      const res = await fetch(`/api/v1/screens/${previewScreenId}/preview-manifest`, {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error(
          res.status === 401 ? 'Sign in to CMS first to preview screens' : `Preview unavailable (${res.status})`,
        );
      }
      const nextManifest = (await res.json()) as DeviceManifest;
      setClockOffsetMs(Date.parse(nextManifest.serverTime) - Date.now());
      setManifest(nextManifest);
      await hydrateAndSyncAssets(nextManifest);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'Preview load failed');
    } finally {
      setSyncing(false);
    }
  }, [hydrateAndSyncAssets, previewScreenId]);

  useEffect(() => {
    if (!previewScreenId) return;
    const sendPreviewHeartbeat = () => {
      fetch(`/api/v1/screens/${previewScreenId}/preview-heartbeat`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appVersion: 'web-sim-preview',
          manifestVersion: manifestVersionRef.current,
          hwInfo: {
            userAgent: navigator.userAgent,
            screen: `${window.innerWidth}x${window.innerHeight}`,
          },
        }),
      }).catch(() => {});
    };
    sendPreviewHeartbeat();
    const hbTimer = window.setInterval(sendPreviewHeartbeat, 30_000);
    return () => clearInterval(hbTimer);
  }, [previewScreenId]);

  useEffect(() => {
    if (previewScreenId) {
      syncPreviewManifest();
      const interval = window.setInterval(syncPreviewManifest, 15_000);
      return () => clearInterval(interval);
    }
    if (!creds) return;
    loadCachedManifest(slot).then((cached) => {
      if (cached) {
        setManifest(cached);
        hydrateAndSyncAssets(cached);
      }
      syncManifest();
    });
    const interval = window.setInterval(syncManifest, 60_000);
    return () => clearInterval(interval);
  }, [creds, hydrateAndSyncAssets, previewScreenId, slot, syncManifest, syncPreviewManifest]);

  return {
    manifest,
    playableUrls,
    syncing,
    cachedCount,
    clockOffsetMs,
    previewError,
    syncManifest,
    syncPreviewManifest,
    revokeAllObjectUrls,
  };
}
