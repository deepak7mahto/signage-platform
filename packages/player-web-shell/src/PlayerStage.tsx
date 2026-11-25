import { AlertTriangle, Monitor, Moon } from 'lucide-react';
import type { RefObject } from 'react';
import { isBinaryMediaType } from '@signage/shared/creatives';
import type {
  FitMode,
  ManifestItem,
  RotationDeg,
  ScreenLayoutConfig,
  TransitionType,
} from '@signage/shared/contracts';
import { renderCreativeAddon } from './creatives/registry.js';

export interface PlayerStageProps {
  standby: boolean;
  safeMode?: boolean;
  compact: boolean;
  isOnline: boolean;
  isPortrait: boolean;
  fitMode: FitMode;
  rotationDeg: RotationDeg;
  transition: TransitionType;
  layout: ScreenLayoutConfig;
  screenName: string;
  syncing: boolean;
  previewError: string | null;
  currentItem: ManifestItem | null;
  currentBlobUrl: string | null;
  safeIndex: number;
  activeIndex: number;
  isMuted: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  imgRef: RefObject<HTMLImageElement | null>;
  onRecordAndAdvance: (status: 'completed' | 'interrupted', crashedAssetId?: string) => void;
}

export function PlayerStage({
  standby,
  safeMode = false,
  compact,
  isOnline,
  isPortrait,
  fitMode,
  rotationDeg,
  transition,
  layout,
  screenName,
  syncing,
  previewError,
  currentItem,
  currentBlobUrl,
  safeIndex,
  activeIndex,
  isMuted,
  videoRef,
  imgRef,
  onRecordAndAdvance,
}: PlayerStageProps) {
  const fitClass = fitMode === 'cover' ? 'object-cover' : 'object-contain';
  const transitionClass =
    transition === 'fade'
      ? 'signage-anim-fade'
      : transition === 'slide_left'
        ? 'signage-anim-slide-left'
        : transition === 'zoom'
          ? 'signage-anim-zoom'
          : '';

  const renderPrimaryMedia = () => {
    if (!currentItem || !currentBlobUrl) return null;
    if (currentItem.type === 'image') {
      return (
        <img
          ref={imgRef}
          key={currentItem.itemId}
          src={currentBlobUrl}
          alt={currentItem.title}
          onError={() => onRecordAndAdvance('interrupted', currentItem.assetId)}
          className={`relative z-10 h-full w-full ${fitClass}`}
        />
      );
    }
    return (
      <video
        ref={videoRef}
        key={`${currentItem.itemId}-${activeIndex}`}
        src={currentBlobUrl}
        autoPlay
        muted={isMuted}
        playsInline
        onEnded={() => onRecordAndAdvance('completed')}
        onError={() => onRecordAndAdvance('interrupted', currentItem.assetId)}
        className={`relative z-10 h-full w-full ${fitClass}`}
      />
    );
  };

  const mediaStage = standby ? (
    <div className="flex h-full w-full flex-col items-center justify-center bg-black text-muted-foreground">
      <Moon className="mb-3 h-10 w-10" />
      <div className="text-sm font-medium text-foreground">TV Standby (HDMI-CEC)</div>
      <div className="mt-1 text-xs">Display asleep via remote power command</div>
    </div>
  ) : safeMode ? (
    <div className="flex h-full w-full flex-col items-center justify-center bg-zinc-950 p-6 text-center text-muted-foreground">
      <AlertTriangle className="mb-3 h-10 w-10 text-amber-400" />
      <div className="text-base font-semibold text-foreground">{screenName} — Safe Mode</div>
      <div className="mt-1 text-xs">
        Watchdog locked playback after repeated failures. Waiting for manifest update or remote recovery.
      </div>
    </div>
  ) : currentItem && !isBinaryMediaType(currentItem.type) ? (
    <div
      key={`anim-${currentItem.itemId}-${safeIndex}`}
      className={`h-full w-full ${transitionClass}`}
      data-transition={transition}
    >
      {renderCreativeAddon({ item: currentItem, isOnline, isMuted, compact })}
    </div>
  ) : currentItem && currentBlobUrl ? (
    <div
      key={`anim-${currentItem.itemId}-${safeIndex}`}
      className={`h-full w-full ${transitionClass}`}
      data-transition={transition}
    >
      {fitMode === 'blur_fill' ? (
        <div className="relative h-full w-full overflow-hidden bg-black">
          {currentItem.type === 'image' ? (
            <img
              src={currentBlobUrl}
              alt=""
              aria-hidden="true"
              data-blur-backdrop="1"
              className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-55 blur-2xl"
            />
          ) : (
            <video
              key={`blur-${currentItem.itemId}-${activeIndex}`}
              src={currentBlobUrl}
              autoPlay
              loop
              muted
              playsInline
              aria-hidden="true"
              data-blur-backdrop="1"
              className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-55 blur-2xl"
            />
          )}
          {renderPrimaryMedia()}
        </div>
      ) : (
        renderPrimaryMedia()
      )}
    </div>
  ) : (
    <div className="flex h-full w-full flex-col items-center justify-center text-muted-foreground">
      <Monitor className="mb-3 h-10 w-10" />
      <div className="text-lg font-medium text-foreground">{screenName}</div>
      <div className={`mt-1 text-xs ${previewError ? 'text-red-300' : ''}`}>
        {previewError
          ? previewError
          : syncing
            ? 'Syncing playlist assets...'
            : 'Waiting for playlist assignment from CMS'}
      </div>
    </div>
  );

  const stageContent =
    !standby && !safeMode && layout.template === 'split_sidebar' ? (
      isPortrait ? (
        <div className="flex h-full w-full flex-col" data-layout-orientation="portrait">
          <div className="min-h-0 flex-1 bg-black">{mediaStage}</div>
          <aside className={`shrink-0 border-t border-border bg-card text-card-foreground ${compact ? 'p-2.5' : 'p-5'}`}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className={`font-semibold tracking-wider text-muted-foreground uppercase ${compact ? 'text-[9px]' : 'text-[11px]'}`}>
                  Live Information
                </div>
                <h2 className={`truncate font-bold tracking-tight ${compact ? 'text-xs' : 'text-lg'}`}>
                  {layout.sidebarTitle || 'Announcements'}
                </h2>
              </div>
              <div className={`shrink-0 font-mono text-muted-foreground ${compact ? 'text-[9px]' : 'text-xs'}`}>
                {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <div className={`grid grid-cols-2 ${compact ? 'gap-1' : 'gap-2'}`}>
              {(layout.sidebarLines ?? []).map((line, i) => (
                <div
                  key={i}
                  className={`truncate rounded-md border border-border bg-background font-medium ${compact ? 'px-1.5 py-1 text-[10px] leading-tight' : 'px-3 py-2 text-xs'}`}
                >
                  {line}
                </div>
              ))}
            </div>
          </aside>
        </div>
      ) : (
        <div className="flex h-full w-full" data-layout-orientation="landscape">
          <div className="min-w-0 flex-1 bg-black">{mediaStage}</div>
          <aside className={`flex shrink-0 flex-col justify-between border-l border-border bg-card text-card-foreground ${compact ? 'w-[34%] min-w-36 p-3' : 'w-80 p-6'}`}>
            <div className={compact ? 'space-y-2' : 'space-y-4'}>
              <div className={`font-semibold tracking-wider text-muted-foreground uppercase ${compact ? 'text-[10px]' : 'text-xs'}`}>
                Live Information
              </div>
              <h2 className={`font-bold tracking-tight ${compact ? 'text-sm' : 'text-xl'}`}>
                {layout.sidebarTitle || 'Announcements'}
              </h2>
              <div className={compact ? 'space-y-1.5' : 'space-y-2.5'}>
                {(layout.sidebarLines ?? []).map((line, i) => (
                  <div
                    key={i}
                    className={`rounded-md border border-border bg-background font-medium ${compact ? 'px-2 py-1.5 text-[11px] leading-tight' : 'px-3.5 py-2.5 text-sm'}`}
                  >
                    {line}
                  </div>
                ))}
              </div>
            </div>
            <div className={`border-t border-border text-muted-foreground ${compact ? 'pt-2 text-[10px]' : 'pt-3 text-xs'}`}>
              {screenName} • {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </aside>
        </div>
      )
    ) : !standby && !safeMode && layout.template === 'bottom_ticker' ? (
      <div className="flex h-full w-full flex-col" data-layout-orientation={isPortrait ? 'portrait' : 'landscape'}>
        <div className="min-h-0 flex-1 bg-black">{mediaStage}</div>
        <footer className={`flex shrink-0 items-center justify-between gap-4 border-t border-border bg-card text-card-foreground ${compact ? 'px-3 py-1.5' : 'px-6 py-3'}`}>
          <div className={`truncate font-medium ${compact ? 'text-xs' : 'text-sm'}`}>
            {layout.tickerText || 'Welcome — Powered by SignageOS'}
          </div>
          <div className={`shrink-0 font-mono text-muted-foreground ${compact ? 'text-[10px]' : 'text-xs'}`}>
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </footer>
      </div>
    ) : (
      <div className="h-full w-full" data-layout-orientation={isPortrait ? 'portrait' : 'landscape'}>
        {mediaStage}
      </div>
    );

  const isSwapped = rotationDeg === 90 || rotationDeg === 270;
  const rotationStyle = isSwapped
    ? {
        position: 'absolute' as const,
        top: '50%',
        left: '50%',
        width: '100vh',
        height: '100vw',
        transform: `translate(-50%, -50%) rotate(${rotationDeg}deg)`,
      }
    : rotationDeg === 180
      ? { transform: 'rotate(180deg)' }
      : undefined;

  return (
    <div className="h-full w-full" style={rotationStyle} data-rotation-deg={rotationDeg}>
      {stageContent}
    </div>
  );
}
