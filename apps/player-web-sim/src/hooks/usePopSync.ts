import { useCallback, useEffect, useRef, useState } from 'react';
import {
  countQueuedPopEvents,
  deleteQueuedPopEvents,
  enqueuePopEvent,
  getQueuedPopEvents,
} from '../lib/cache';
import { createUuid, type DeviceCredentials } from '../types';

export function usePopSync(
  creds: DeviceCredentials | null,
  slot: string,
  isOnline: boolean,
  previewScreenId: string | null,
) {
  const queueSlot = previewScreenId ? `preview-${previewScreenId}` : slot;
  const [popQueuedCount, setPopQueuedCount] = useState(0);
  const flushingRef = useRef(false);
  const popBackoffUntilRef = useRef(0);
  const popBackoffDelayRef = useRef(15_000);

  const flushPopQueue = useCallback(
    async (ignoreBackoff = false) => {
      if ((!creds && !previewScreenId) || flushingRef.current || !navigator.onLine) return;
      if (!ignoreBackoff && Date.now() < popBackoffUntilRef.current) return;

      flushingRef.current = true;
      try {
        setPopQueuedCount(await countQueuedPopEvents(queueSlot));
        for (let batch = 0; batch < 10; batch += 1) {
          const queued = await getQueuedPopEvents(100, queueSlot);
          if (queued.length === 0) break;

          const controller = new AbortController();
          const timeoutId = window.setTimeout(() => controller.abort(), 8000);
          try {
            const url = previewScreenId
              ? `/api/v1/screens/${previewScreenId}/preview-pop`
              : '/api/v1/device/pop/batch';
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (!previewScreenId && creds) {
              headers.Authorization = `Bearer ${creds.deviceToken}`;
            }

            const res = await fetch(url, {
              method: 'POST',
              headers,
              credentials: previewScreenId ? 'include' : 'same-origin',
              body: JSON.stringify({ events: queued }),
              signal: controller.signal,
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            await deleteQueuedPopEvents(queued.map((e) => e.id));
            setPopQueuedCount(await countQueuedPopEvents(queueSlot));
            popBackoffDelayRef.current = 15_000;
            popBackoffUntilRef.current = 0;
            if (queued.length < 100) break;
          } finally {
            clearTimeout(timeoutId);
          }
        }
      } catch {
        popBackoffUntilRef.current = Date.now() + popBackoffDelayRef.current;
        popBackoffDelayRef.current = Math.min(popBackoffDelayRef.current * 2, 120_000);
      } finally {
        flushingRef.current = false;
      }
    },
    [creds, previewScreenId, queueSlot],
  );

  useEffect(() => {
    if (!creds && !previewScreenId) return;
    if (isOnline) {
      popBackoffDelayRef.current = 15_000;
      popBackoffUntilRef.current = 0;
      flushPopQueue(true);
    }
    const timer = window.setInterval(() => flushPopQueue(false), 15_000);
    return () => clearInterval(timer);
  }, [creds, flushPopQueue, isOnline, previewScreenId]);

  const recordPlay = useCallback(
    (
      playlistId: string | null,
      assetId: string,
      startedMs: number,
      endedMs: number,
      status: 'completed' | 'interrupted',
    ) => {
      if (!creds && !previewScreenId) return;
      enqueuePopEvent(
        {
          id: createUuid(),
          playlistId,
          mediaAssetId: assetId,
          startedAt: new Date(startedMs).toISOString(),
          endedAt: new Date(endedMs).toISOString(),
          durationMs: Math.max(500, Math.round(endedMs - startedMs)),
          status,
        },
        queueSlot,
      )
        .then(() => countQueuedPopEvents(queueSlot))
        .then((cnt) => {
          setPopQueuedCount(cnt);
          flushPopQueue();
        })
        .catch(() => {});
    },
    [creds, flushPopQueue, previewScreenId, queueSlot],
  );

  return { popQueuedCount, setPopQueuedCount, recordPlay };
}
