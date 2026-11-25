import { CloudSun, ExternalLink, Film, Globe, Layers, Sparkles, Youtube } from 'lucide-react';
import { getCreativeTypeDef, type MediaAsset } from '@signage/shared';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { formatBytes } from '../../lib/api';

interface MediaPreviewModalProps {
  asset: MediaAsset | null;
  onClose: () => void;
}

export function MediaPreviewModal({ asset, onClose }: MediaPreviewModalProps) {
  const typeDef = asset ? getCreativeTypeDef(asset.type) : undefined;
  const cfg = asset?.appConfig ?? {};

  const renderPreviewBody = () => {
    if (!asset) return null;

    if (asset.type === 'video' && asset.previewUrl) {
      return (
        <video
          key={asset.id}
          src={asset.previewUrl}
          poster={asset.thumbnailUrl ?? undefined}
          controls
          autoPlay
          playsInline
          className="max-h-[65vh] w-full rounded-md bg-black object-contain"
        />
      );
    }

    if (asset.type === 'image' && (asset.previewUrl || asset.thumbnailUrl)) {
      return (
        <img
          src={asset.previewUrl || asset.thumbnailUrl || ''}
          alt={asset.title}
          className="max-h-[65vh] w-full rounded-md bg-black object-contain"
        />
      );
    }

    if (asset.type === 'webpage' && typeof cfg.url === 'string') {
      return (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-md border border-border bg-white">
            <iframe
              src={cfg.url}
              title={asset.title}
              className="h-80 w-full border-0"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="truncate font-mono">{cfg.url}</span>
            <Button variant="outline" size="sm" asChild>
              <a href={cfg.url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Open Tab
              </a>
            </Button>
          </div>
        </div>
      );
    }

    if (asset.type === 'youtube' && typeof cfg.videoId === 'string') {
      return (
        <div className="aspect-video overflow-hidden rounded-md border border-border bg-black">
          <iframe
            src={`https://www.youtube.com/embed/${encodeURIComponent(cfg.videoId)}?autoplay=1&mute=1&rel=0`}
            title={asset.title}
            allow="autoplay; encrypted-media"
            className="h-full w-full border-0"
          />
        </div>
      );
    }

    if (asset.type === 'weather') {
      return (
        <div className="flex flex-col items-center justify-center rounded-md border border-border bg-gradient-to-br from-sky-950 to-slate-950 p-10 text-center text-white">
          <CloudSun className="mb-3 h-12 w-12 text-amber-300" />
          <div className="text-lg font-bold">{String(cfg.city ?? 'Mumbai')}</div>
          <div className="mt-1 text-xs text-sky-200">
            Live Open-Meteo Widget • Unit: °{String(cfg.unit ?? 'C')}
          </div>
        </div>
      );
    }

    if (asset.type === 'html') {
      return (
        <div className="rounded-md border border-border bg-gradient-to-br from-amber-950 via-zinc-950 to-black p-8 text-white">
          <Badge variant="outline" className="mb-3 border-amber-500/40 text-amber-200">
            <Sparkles className="mr-1 h-3 w-3" /> Announcement Card
          </Badge>
          <h3 className="text-2xl font-bold">{String(cfg.headline ?? asset.title)}</h3>
          {typeof cfg.body === 'string' && cfg.body && (
            <p className="mt-2 text-sm text-zinc-200">{cfg.body}</p>
          )}
          {typeof cfg.ctaText === 'string' && cfg.ctaText && (
            <div className="mt-4 inline-block rounded-md border border-amber-500/30 bg-black/50 px-3 py-1.5 text-xs font-medium">
              {cfg.ctaText}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center rounded-md border border-border bg-background p-8 text-center">
        {asset.type === 'youtube' ? (
          <Youtube className="mb-2 h-8 w-8 text-red-400" />
        ) : asset.type === 'webpage' ? (
          <Globe className="mb-2 h-8 w-8 text-sky-400" />
        ) : asset.type === 'video' ? (
          <Film className="mb-2 h-8 w-8 text-muted-foreground" />
        ) : (
          <Layers className="mb-2 h-8 w-8 text-muted-foreground" />
        )}
        <pre className="mt-2 max-w-full overflow-auto rounded bg-card p-3 text-left font-mono text-xs text-muted-foreground">
          {JSON.stringify(cfg, null, 2)}
        </pre>
      </div>
    );
  };

  return (
    <Dialog open={Boolean(asset)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="truncate">{asset?.title}</span>
            {asset && <Badge variant="secondary">{typeDef?.label ?? asset.type}</Badge>}
          </DialogTitle>
          <DialogDescription>
            {asset
              ? `${asset.durationMs ? `${Math.round(asset.durationMs / 1000)}s default slot • ` : ''}${
                  asset.sizeBytes > 0 ? formatBytes(asset.sizeBytes) : 'Interactive / Config Creative'
                }`
              : ''}
          </DialogDescription>
        </DialogHeader>

        {renderPreviewBody()}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
