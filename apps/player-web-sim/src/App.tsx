import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlaybackWatchdog, resolveActiveManifestPlaylist } from '@signage/player-core';
import { DiagnosticsHud, PairingView, PlayerStage } from '@signage/player-web-shell';
import type { ManifestItem, PlaybackState } from '@signage/shared/contracts';
import { useClockSync } from './hooks/useClockSync';
import { useDeviceSocket } from './hooks/useDeviceSocket';
import { useManifestSync } from './hooks/useManifestSync';
import { usePairingFlow } from './hooks/usePairingFlow';
import { usePopSync } from './hooks/usePopSync';
import { clearAllCache } from './lib/cache';
import { getSlotStorageKey, parsePlayerParams } from './types';

export function App() {
  const { slot, compact, initialHud, previewScreenId, provisionTokenParam } = useMemo(
    parsePlayerParams,
    [],
  );
  const storageKey = useMemo(() => getSlotStorageKey(slot), [slot]);

  const { creds, setCreds, pairData, pairError, claimingProvision, claimProvisionToken } =
    usePairingFlow(slot, storageKey, previewScreenId, provisionTokenParam);

  const [activeIndex, setActiveIndex] = useState(0);
  const [scheduleTick, setScheduleTick] = useState(0);
  const [quarantineTick, setQuarantineTick] = useState(0);
  const [safeMode, setSafeMode] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [standby, setStandby] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [showHud, setShowHud] = useState(initialHud);
  const [hudPillVisible, setHudPillVisible] = useState(false);
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const itemStartedAtRef = useRef<number>(Date.now());
  const lastFrameAdvanceAtRef = useRef<string>(new Date().toISOString());
  const revokeUrlsRef = useRef<() => void>(() => {});
  const watchdogRef = useRef<PlaybackWatchdog | null>(null);
  if (!watchdogRef.current) {
    watchdogRef.current = new PlaybackWatchdog();
  }

  const { popQueuedCount, setPopQueuedCount, recordPlay } = usePopSync(
    creds,
    slot,
    isOnline,
    previewScreenId,
  );

  const unpair = useCallback(async () => {
    localStorage.removeItem(storageKey);
    revokeUrlsRef.current();
    setCreds(null);
    setPopQueuedCount(0);
    await clearAllCache(slot);
  }, [setCreds, setPopQueuedCount, slot, storageKey]);

  const {
    manifest,
    playableUrls,
    syncing,
    cachedCount,
    clockOffsetMs,
    previewError,
    syncManifest,
    syncPreviewManifest,
    revokeAllObjectUrls,
  } = useManifestSync(creds, slot, previewScreenId, unpair);
  revokeUrlsRef.current = revokeAllObjectUrls;

  useEffect(() => {
    if (!manifest) return;
    if (watchdogRef.current?.onManifestVersion(manifest.manifestVersion)) {
      setQuarantineTick((t) => t + 1);
    }
  }, [manifest]);

  const clearQuarantine = useCallback((assetId?: string) => {
    watchdogRef.current?.clearQuarantine(assetId);
    setQuarantineTick((t) => t + 1);
  }, []);

  const exitSafeMode = useCallback(() => {
    watchdogRef.current?.exitSafeMode();
    watchdogRef.current?.clearQuarantine();
    setSafeMode(false);
    setQuarantineTick((t) => t + 1);
  }, []);

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    const onUp = () => setIsOnline(true);
    const onDown = () => setIsOnline(false);
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const k = e.key.toLowerCase();
      if (k === 'i') setShowHud((v) => !v);
      else if (k === 'm') setIsMuted((v) => !v);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('online', onUp);
    window.addEventListener('offline', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('online', onUp);
      window.removeEventListener('offline', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (!creds && !previewScreenId) return;
    let hideTimer: number | undefined;
    const reveal = () => {
      setHudPillVisible(true);
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setHudPillVisible(false), 4000);
    };
    window.addEventListener('mousemove', reveal);
    window.addEventListener('touchstart', reveal);
    return () => {
      window.removeEventListener('mousemove', reveal);
      window.removeEventListener('touchstart', reveal);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [creds, previewScreenId]);

  useEffect(() => {
    const timer = window.setInterval(() => setScheduleTick((t) => t + 1), 15_000);
    return () => clearInterval(timer);
  }, []);

  const activeResolved = useMemo(() => {
    if (!manifest) return { playlistId: null, playlistName: null, scheduleName: null, items: [] as ManifestItem[] };
    return resolveActiveManifestPlaylist(manifest, Date.now() + clockOffsetMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, clockOffsetMs, scheduleTick]);

  useEffect(() => setActiveIndex(0), [activeResolved.playlistId, activeResolved.scheduleName]);

  const playableItems = useMemo(() => {
    const wd = watchdogRef.current;
    return activeResolved.items.filter(
      (item) => Boolean(playableUrls[item.assetId]) && !(wd?.isQuarantined(item.assetId) ?? false),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeResolved.items, playableUrls, quarantineTick]);

  const safeIndex = playableItems.length > 0 ? activeIndex % playableItems.length : 0;
  const currentItem = playableItems[safeIndex] ?? null;

  const playbackState: PlaybackState =
    watchdogRef.current?.getPlaybackState(Boolean(currentItem) && !standby, stalled) ?? 'idle';

  const { wsConnected, setWsConnected } = useDeviceSocket({
    creds,
    slot,
    previewScreenId,
    manifestVersion: manifest?.manifestVersion ?? 0,
    playbackState,
    lastFrameAdvanceAt: lastFrameAdvanceAtRef.current,
    standby,
    videoRef,
    imgRef,
    onSyncManifest: syncManifest,
    onUnpair: unpair,
    onSetStandby: setStandby,
    onSetMuted: setIsMuted,
    onClearQuarantine: clearQuarantine,
    onExitSafeMode: exitSafeMode,
  });

  useEffect(() => {
    if (!isOnline) setWsConnected(false);
  }, [isOnline, setWsConnected]);

  useEffect(() => {
    itemStartedAtRef.current = Date.now() + clockOffsetMs;
    lastFrameAdvanceAtRef.current = new Date().toISOString();
    watchdogRef.current?.resetProgress();
    setStalled(false);
  }, [currentItem?.itemId, activeIndex, clockOffsetMs]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = isMuted;
  }, [isMuted, activeIndex]);

  const recordAndAdvance = useCallback(
    (status: 'completed' | 'interrupted' = 'completed', crashedAssetId?: string) => {
      if (currentItem && !standby) {
        const endedMs = Date.now() + clockOffsetMs;
        recordPlay(activeResolved.playlistId, currentItem.assetId, Math.min(itemStartedAtRef.current, endedMs), endedMs, status);
      }
      if (crashedAssetId && watchdogRef.current?.recordCrash(crashedAssetId)) {
        setQuarantineTick((t) => t + 1);
      }
      itemStartedAtRef.current = Date.now() + clockOffsetMs;
      lastFrameAdvanceAtRef.current = new Date().toISOString();
      setActiveIndex((idx) => (playableItems.length > 0 ? (idx + 1) % playableItems.length : 0));
    },
    [activeResolved.playlistId, clockOffsetMs, currentItem, playableItems.length, recordPlay, standby],
  );

  const layout = manifest?.layout ?? {
    template: 'fullscreen' as const,
    fitMode: 'contain' as const,
    rotationDeg: 0 as const,
    transition: 'fade' as const,
    syncMode: 'independent' as const,
    sidebarLines: [],
  };
  const fitMode = layout.fitMode ?? 'contain';
  const rotationDeg = layout.rotationDeg ?? 0;
  const transition = layout.transition ?? 'fade';
  const syncMode = layout.syncMode ?? 'independent';

  useClockSync({ syncMode, playableItems, safeIndex, standby, clockOffsetMs, videoRef, onSelectIndex: setActiveIndex });

  useEffect(() => {
    if (!currentItem || standby || safeMode || syncMode === 'clock_sync' || currentItem.type === 'video') return;
    const timer = window.setTimeout(() => recordAndAdvance('completed'), currentItem.durationMs);
    return () => clearTimeout(timer);
  }, [currentItem, recordAndAdvance, safeMode, standby, syncMode]);

  useEffect(() => {
    if (!currentItem || standby || safeMode || currentItem.type !== 'video') return;
    const watchdog = window.setInterval(() => {
      const video = videoRef.current;
      const wd = watchdogRef.current;
      if (!video || !wd || video.ended) return;
      if (wd.checkVideoProgress(video.currentTime)) {
        setStalled(true);
        recordAndAdvance('interrupted', currentItem.assetId);
      } else {
        setStalled(false);
        lastFrameAdvanceAtRef.current = new Date().toISOString();
      }
    }, 2_000);
    return () => clearInterval(watchdog);
  }, [currentItem, recordAndAdvance, safeMode, standby]);

  const isSwapped = rotationDeg === 90 || rotationDeg === 270;
  const logicalW = isSwapped ? viewport.h : viewport.w;
  const logicalH = isSwapped ? viewport.w : viewport.h;
  const isPortrait = manifest?.orientation === 'portrait' || logicalH > logicalW;

  const buildParentStatus = useCallback(() => {
    if (!creds && !previewScreenId) {
      return { type: 'signage:status' as const, slot, state: 'pairing' as const, code: pairData?.code ?? null };
    }
    return {
      type: 'signage:status' as const,
      slot,
      state: 'paired' as const,
      screenId: previewScreenId ?? creds?.screenId ?? '',
      screenName: manifest?.screenName ?? creds?.screenName ?? null,
      playlistName: activeResolved.playlistName ?? null,
      scheduleName: activeResolved.scheduleName ?? null,
      layoutTemplate: layout.template,
      orientation: isPortrait ? ('portrait' as const) : ('landscape' as const),
      fitMode,
      rotationDeg,
      viewport: `${logicalW}x${logicalH}`,
      wsConnected,
    };
  }, [
    activeResolved.playlistName,
    activeResolved.scheduleName,
    creds,
    fitMode,
    isPortrait,
    layout.template,
    logicalH,
    logicalW,
    manifest?.screenName,
    pairData?.code,
    previewScreenId,
    rotationDeg,
    slot,
    wsConnected,
  ]);

  useEffect(() => {
    if (window.parent === window) return;
    window.parent.postMessage(buildParentStatus(), window.location.origin);
  }, [buildParentStatus]);

  useEffect(() => {
    if (window.parent === window) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const msg = event.data as { type?: string; show?: boolean } | null;
      if (msg?.type === 'signage:request_status') window.parent.postMessage(buildParentStatus(), window.location.origin);
      else if (msg?.type === 'signage:set_hud' && typeof msg.show === 'boolean') setShowHud(msg.show);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [buildParentStatus]);

  if (!creds && !previewScreenId) {
    return (
      <PairingView
        slot={slot}
        compact={compact}
        claimingProvision={claimingProvision}
        pairData={pairData}
        pairError={pairError}
        onClaimProvision={claimProvisionToken}
      />
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      <PlayerStage
        standby={standby}
        safeMode={safeMode}
        compact={compact}
        isOnline={isOnline}
        isPortrait={isPortrait}
        fitMode={fitMode}
        rotationDeg={rotationDeg}
        transition={transition}
        layout={layout}
        screenName={manifest?.screenName ?? creds?.screenName ?? 'Paired Display'}
        syncing={syncing}
        previewError={previewError}
        currentItem={currentItem}
        currentBlobUrl={currentItem ? playableUrls[currentItem.assetId] ?? null : null}
        safeIndex={safeIndex}
        activeIndex={activeIndex}
        isMuted={isMuted}
        videoRef={videoRef}
        imgRef={imgRef}
        onRecordAndAdvance={recordAndAdvance}
      />
      <DiagnosticsHud
        compact={compact}
        showHud={showHud}
        showPill={showHud || hudPillVisible}
        isMuted={isMuted}
        previewScreenId={previewScreenId}
        screenName={manifest?.screenName ?? creds?.screenName ?? 'Virtual Screen'}
        screenId={previewScreenId ?? creds?.screenId ?? ''}
        isOnline={isOnline}
        wsConnected={wsConnected}
        syncing={syncing}
        playableCount={playableItems.length}
        safeIndex={safeIndex}
        currentItem={currentItem}
        scheduleName={activeResolved.scheduleName}
        playlistName={activeResolved.playlistName}
        template={layout.template}
        transition={transition}
        syncMode={syncMode}
        logicalW={logicalW}
        logicalH={logicalH}
        isPortrait={isPortrait}
        fitMode={fitMode}
        rotationDeg={rotationDeg}
        manifestVersion={manifest?.manifestVersion ?? 0}
        cachedCount={cachedCount}
        popQueuedCount={popQueuedCount}
        clockOffsetMs={clockOffsetMs}
        quarantinedCount={watchdogRef.current?.getQuarantinedIds().length ?? 0}
        onToggleMute={() => setIsMuted((v) => !v)}
        onToggleHud={() => setShowHud((v) => !v)}
        onSync={previewScreenId ? syncPreviewManifest : syncManifest}
        onUnpair={unpair}
      />
    </div>
  );
}
