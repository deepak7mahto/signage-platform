import { Globe, Loader2, WifiOff, Youtube } from 'lucide-react';
import { useEffect, useState } from 'react';
import { extractYouTubeVideoId } from '@signage/shared/creatives';
import type { ManifestItem } from '@signage/shared/contracts';

export interface IframeAddonViewProps {
  item: ManifestItem;
  isOnline: boolean;
  isMuted: boolean;
}

export function IframeAddonView({ item, isOnline, isMuted }: IframeAddonViewProps) {
  const cfg = item.appConfig ?? {};
  const isYoutube = item.type === 'youtube';
  const rawUrl = typeof cfg.url === 'string' ? cfg.url : '';
  const fallbackMessage =
    typeof cfg.fallbackMessage === 'string' && cfg.fallbackMessage.trim()
      ? cfg.fallbackMessage.trim()
      : isYoutube
        ? 'Connecting to YouTube stream...'
        : 'Loading live web content...';

  const ytId =
    typeof cfg.videoId === 'string' && cfg.videoId.trim()
      ? cfg.videoId.trim()
      : rawUrl
        ? extractYouTubeVideoId(rawUrl)
        : null;

  const iframeSrc = isYoutube
    ? ytId
      ? `https://www.youtube.com/embed/${encodeURIComponent(ytId)}?autoplay=1&mute=${
          isMuted ? 1 : 0
        }&controls=0&rel=0&playsinline=1`
      : ''
    : rawUrl;

  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    const safety = window.setTimeout(() => setLoaded(true), 8_000);
    return () => clearTimeout(safety);
  }, [item.itemId, iframeSrc]);

  if (!isOnline || !iframeSrc) {
    return (
      <div
        data-creative-type={item.type}
        data-creative-fallback="1"
        className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-zinc-900 via-black to-zinc-950 p-6 text-center text-white"
      >
        <div className="mb-3 rounded-full border border-amber-500/30 bg-amber-500/15 p-3">
          {!isOnline ? (
            <WifiOff className="h-7 w-7 text-amber-300" />
          ) : isYoutube ? (
            <Youtube className="h-7 w-7 text-red-400" />
          ) : (
            <Globe className="h-7 w-7 text-sky-400" />
          )}
        </div>
        <div className="text-base font-semibold">{item.title}</div>
        <div className="mt-1 max-w-md text-xs text-zinc-300">
          {!isOnline ? `Offline Fallback • ${fallbackMessage}` : 'Missing embed URL or video ID'}
        </div>
      </div>
    );
  }

  return (
    <div data-creative-type={item.type} className="relative h-full w-full bg-black">
      <iframe
        key={`${item.itemId}-${isMuted ? 'm' : 'u'}`}
        src={iframeSrc}
        title={item.title}
        sandbox={
          isYoutube
            ? 'allow-scripts allow-same-origin allow-presentation'
            : 'allow-scripts'
        }
        allow="autoplay; encrypted-media; fullscreen"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        className="h-full w-full border-0 bg-white"
      />
      {!loaded && (
        <div
          data-creative-loading="1"
          className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-zinc-950/95 p-6 text-center text-white"
        >
          <Loader2 className="mb-3 h-8 w-8 animate-spin text-sky-400" />
          <div className="text-sm font-semibold">{item.title}</div>
          <div className="mt-1 text-xs text-zinc-400">{fallbackMessage}</div>
        </div>
      )}
    </div>
  );
}
