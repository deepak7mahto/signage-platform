import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlaybackWatchdog, resolveActiveManifestPlaylist } from '@signage/player-core';
import { DiagnosticsHud, PairingView, PlayerStage } from '@signage/player-web-shell';
import type { ManifestItem } from '@signage/shared/contracts';
import { WindowsPlatformBridge } from './bridge/windows-bridge';
import { useWindowsPlayerSync } from './hooks/useWindowsPlayerSync';

export function App() {
  const bridge = useMemo(() => new WindowsPlatformBridge(), []);
  const watchdogRef = useRef<PlaybackWatchdog | null>(null);
  if (!watchdogRef.current) watchdogRef.current = new PlaybackWatchdog();

  const [activeIndex, setActiveIndex] = useState(0);
  const [quarantineTick, setQuarantineTick] = useState(0);
  const [standby, setStandby] = useState(false);
  const [safeMode, setSafeMode] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [showHud, setShowHud] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const bumpQuarantine = useCallback(() => setQuarantineTick((t) => t + 1), []);

  const {
    creds,
    pairData,
    pairError,
    claimingProvision,
    manifest,
    playableUrls,
    syncing,
    clockOffsetMs,
    wsConnected,
    claimProvision,
    syncManifest,
    unpair,
  } = useWindowsPlayerSync({
    bridge,
    watchdog: watchdogRef.current,
    standby,
    safeMode,
    stalled,
    onSetStandby: setStandby,
    onSetSafeMode: setSafeMode,
    onSetMuted: setIsMuted,
    onBumpQuarantine: bumpQuarantine,
  });

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    const onUp = () => setIsOnline(true);
    const onDown = () => setIsOnline(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'i') setShowHud((v) => !v);
      else if (e.key.toLowerCase() === 'm') setIsMuted((v) => !v);
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

  const activeResolved = useMemo(() => {
    if (!manifest) return { playlistId: null, playlistName: null, scheduleName: null, items: [] as ManifestItem[] };
    return resolveActiveManifestPlaylist(manifest, Date.now() + clockOffsetMs);
  }, [manifest, clockOffsetMs]);

  const playableItems = useMemo(
    () => activeResolved.items.filter((i) => !(watchdogRef.current?.isQuarantined(i.assetId) ?? false)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeResolved.items, quarantineTick],
  );
  const safeIndex = playableItems.length > 0 ? activeIndex % playableItems.length : 0;
  const currentItem = playableItems[safeIndex] ?? null;

  const recordAndAdvance = useCallback(
    (_status: 'completed' | 'interrupted', crashedAssetId?: string) => {
      if (crashedAssetId && watchdogRef.current?.recordCrash(crashedAssetId)) {
        setQuarantineTick((t) => t + 1);
      }
      setStalled(false);
      setActiveIndex((idx) => (playableItems.length > 0 ? (idx + 1) % playableItems.length : 0));
    },
    [playableItems.length],
  );

  if (!creds) {
    return (
      <PairingView
        slot="windows"
        compact={false}
        claimingProvision={claimingProvision}
        pairData={pairData}
        pairError={pairError}
        onClaimProvision={(tok) => void claimProvision(tok)}
      />
    );
  }

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

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      <PlayerStage
        standby={standby}
        safeMode={safeMode}
        compact={false}
        isOnline={isOnline}
        isPortrait={viewport.h > viewport.w}
        fitMode={fitMode}
        rotationDeg={rotationDeg}
        transition={layout.transition ?? 'fade'}
        layout={layout}
        screenName={manifest?.screenName ?? creds.screenName}
        syncing={syncing}
        previewError={null}
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
        compact={false}
        showHud={showHud}
        showPill={showHud}
        isMuted={isMuted}
        previewScreenId={null}
        screenName={manifest?.screenName ?? creds.screenName}
        screenId={creds.screenId}
        isOnline={isOnline}
        wsConnected={wsConnected}
        syncing={syncing}
        playableCount={playableItems.length}
        safeIndex={safeIndex}
        currentItem={currentItem}
        scheduleName={activeResolved.scheduleName}
        playlistName={activeResolved.playlistName}
        template={layout.template}
        transition={layout.transition ?? 'fade'}
        syncMode={layout.syncMode ?? 'independent'}
        logicalW={viewport.w}
        logicalH={viewport.h}
        isPortrait={viewport.h > viewport.w}
        fitMode={fitMode}
        rotationDeg={rotationDeg}
        manifestVersion={manifest?.manifestVersion ?? 0}
        cachedCount={Object.keys(playableUrls).length}
        popQueuedCount={0}
        clockOffsetMs={clockOffsetMs}
        quarantinedCount={watchdogRef.current?.getQuarantinedIds().length ?? 0}
        onToggleMute={() => setIsMuted((v) => !v)}
        onToggleHud={() => setShowHud((v) => !v)}
        onSync={() => void syncManifest()}
        onUnpair={() => void unpair()}
      />
    </div>
  );
}
