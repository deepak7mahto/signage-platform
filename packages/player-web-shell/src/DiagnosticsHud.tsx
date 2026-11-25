import { Eye, Info, RefreshCw, Unplug, Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react';
import type {
  FitMode,
  LayoutTemplateType,
  ManifestItem,
  RotationDeg,
  SyncMode,
  TransitionType,
} from '@signage/shared/contracts';

export interface DiagnosticsHudProps {
  compact: boolean;
  showHud: boolean;
  showPill: boolean;
  isMuted: boolean;
  previewScreenId: string | null;
  screenName: string;
  screenId: string;
  isOnline: boolean;
  wsConnected: boolean;
  syncing: boolean;
  playableCount: number;
  safeIndex: number;
  currentItem: ManifestItem | null;
  scheduleName: string | null;
  playlistName: string | null;
  template: LayoutTemplateType;
  transition: TransitionType;
  syncMode: SyncMode;
  logicalW: number;
  logicalH: number;
  isPortrait: boolean;
  fitMode: FitMode;
  rotationDeg: RotationDeg;
  manifestVersion: number;
  cachedCount: number;
  popQueuedCount: number;
  clockOffsetMs: number;
  quarantinedCount?: number;
  onToggleMute: () => void;
  onToggleHud: () => void;
  onSync: () => void;
  onUnpair: () => void;
}

export function DiagnosticsHud({
  compact,
  showHud,
  showPill,
  isMuted,
  previewScreenId,
  screenName,
  screenId,
  isOnline,
  wsConnected,
  syncing,
  playableCount,
  safeIndex,
  currentItem,
  scheduleName,
  playlistName,
  template,
  transition,
  syncMode,
  logicalW,
  logicalH,
  isPortrait,
  fitMode,
  rotationDeg,
  manifestVersion,
  cachedCount,
  popQueuedCount,
  clockOffsetMs,
  quarantinedCount = 0,
  onToggleMute,
  onToggleHud,
  onSync,
  onUnpair,
}: DiagnosticsHudProps) {
  return (
    <>
      <div className="absolute right-4 bottom-4 z-30 flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleMute}
          data-sound-toggle="1"
          className={`flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card/85 px-3 py-1.5 text-xs text-foreground backdrop-blur transition-opacity duration-300 hover:bg-accent ${
            showPill || Boolean(previewScreenId) ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          title="Mute / Unmute audio (shortcut: m)"
        >
          {isMuted ? (
            <>
              <VolumeX className="h-3.5 w-3.5 text-amber-300" />
              <span>Unmute</span>
            </>
          ) : (
            <>
              <Volume2 className="h-3.5 w-3.5 text-emerald-300" />
              <span>Sound On</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onToggleHud}
          className={`flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card/85 px-3 py-1.5 text-xs text-foreground backdrop-blur transition-opacity duration-300 hover:bg-accent ${
            showPill ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          title="Toggle diagnostics HUD (shortcut: i)"
        >
          <Info className="h-3.5 w-3.5" />
          <span>HUD</span>
        </button>
      </div>

      {showHud && (
        <div
          className={`absolute right-4 bottom-14 z-30 rounded-lg border border-border bg-card/95 text-card-foreground shadow-2xl backdrop-blur ${
            compact ? 'w-64 p-2.5 text-[10px]' : 'w-80 p-4 text-xs'
          }`}
        >
          <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
            <span className="font-semibold">{screenName}</span>
            {previewScreenId ? (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-300"
                data-preview-badge="1"
              >
                <Eye className="h-3 w-3" />
                Preview (Live Logs)
              </span>
            ) : (
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  isOnline && wsConnected
                    ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                    : 'border-amber-500/30 bg-amber-500/15 text-amber-300'
                }`}
              >
                {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {!isOnline ? 'Offline Cache' : wsConnected ? 'WSS Live' : 'HTTP Only'}
              </span>
            )}
          </div>

          <dl className="space-y-1.5 text-[11px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Now Playing</dt>
              <dd className="truncate font-medium">
                {playableCount > 0 && currentItem ? `${safeIndex + 1} / ${playableCount} • ${currentItem.title}` : 'Idle'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Schedule</dt>
              <dd className="truncate font-medium">{scheduleName ?? 'Fallback Loop'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Playlist</dt>
              <dd className="truncate">{playlistName ?? 'None'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Layout & Motion</dt>
              <dd className="font-mono">
                {template} • {transition} • {syncMode}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Display Canvas</dt>
              <dd className="font-mono">
                {logicalW}×{logicalH} ({isPortrait ? 'portrait' : 'landscape'}) • {fitMode} • {rotationDeg}°
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Screen ID</dt>
              <dd className="font-mono">{screenId.slice(0, 8)}...</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Manifest Version</dt>
              <dd>v{manifestVersion}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Cached Assets (IDB)</dt>
              <dd>{cachedCount}{quarantinedCount > 0 ? ` (${quarantinedCount} quarantined)` : ''}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">PoP Queued</dt>
              <dd>{popQueuedCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Clock Offset</dt>
              <dd>{Math.round(clockOffsetMs)} ms</dd>
            </div>
          </dl>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={onToggleMute}
              className="flex cursor-pointer items-center justify-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 font-medium text-foreground hover:bg-accent"
              title="Mute / Unmute (m)"
            >
              {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={onSync}
              className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary/90"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {previewScreenId ? 'Refresh Preview' : 'Sync Now'}
            </button>
            {!previewScreenId && (
              <button
                type="button"
                onClick={onUnpair}
                className="flex cursor-pointer items-center justify-center gap-1 rounded-md border border-destructive/40 bg-destructive/15 px-3 py-1.5 font-medium text-red-300 hover:bg-destructive/25"
              >
                <Unplug className="h-3.5 w-3.5" />
                Unpair
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
