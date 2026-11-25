import { useEffect, type RefObject } from 'react';
import type { ManifestItem, SyncMode } from '@signage/shared';

interface UseClockSyncOptions {
  syncMode: SyncMode;
  playableItems: ManifestItem[];
  safeIndex: number;
  standby: boolean;
  clockOffsetMs: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  onSelectIndex: (index: number) => void;
}

export function useClockSync({
  syncMode,
  playableItems,
  safeIndex,
  standby,
  clockOffsetMs,
  videoRef,
  onSelectIndex,
}: UseClockSyncOptions): void {
  useEffect(() => {
    if (syncMode !== 'clock_sync' || playableItems.length === 0 || standby) return;

    const totalLoopMs = playableItems.reduce(
      (sum, item) => sum + Math.max(1000, item.durationMs),
      0,
    );
    if (totalLoopMs <= 0) return;

    const applyClockSync = () => {
      const serverNow = Date.now() + clockOffsetMs;
      let cursor = ((serverNow % totalLoopMs) + totalLoopMs) % totalLoopMs;
      let targetIdx = 0;
      let offsetInItemMs = 0;

      for (let i = 0; i < playableItems.length; i += 1) {
        const dur = Math.max(1000, playableItems[i].durationMs);
        if (cursor < dur) {
          targetIdx = i;
          offsetInItemMs = cursor;
          break;
        }
        cursor -= dur;
      }

      if (safeIndex !== targetIdx) {
        onSelectIndex(targetIdx);
        return;
      }

      const video = videoRef.current;
      if (video && video.readyState >= 1) {
        const targetSec = offsetInItemMs / 1000;
        if (Math.abs(video.currentTime - targetSec) > 0.6 && targetSec < (video.duration || Infinity)) {
          video.currentTime = targetSec;
        }
      }
    };

    applyClockSync();
    const timer = window.setInterval(applyClockSync, 500);
    return () => clearInterval(timer);
  }, [clockOffsetMs, onSelectIndex, playableItems, safeIndex, standby, syncMode, videoRef]);
}
