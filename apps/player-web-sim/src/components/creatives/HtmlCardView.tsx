import { Sparkles } from 'lucide-react';
import type { ManifestItem } from '@signage/shared';

const ACCENT_MAP: Record<string, { bg: string; badge: string; border: string }> = {
  amber: {
    bg: 'from-amber-950 via-zinc-950 to-black',
    badge: 'bg-amber-500/20 text-amber-200 border-amber-500/40',
    border: 'border-amber-500/30',
  },
  emerald: {
    bg: 'from-emerald-950 via-zinc-950 to-black',
    badge: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40',
    border: 'border-emerald-500/30',
  },
  sky: {
    bg: 'from-sky-950 via-zinc-950 to-black',
    badge: 'bg-sky-500/20 text-sky-200 border-sky-500/40',
    border: 'border-sky-500/30',
  },
  rose: {
    bg: 'from-rose-950 via-zinc-950 to-black',
    badge: 'bg-rose-500/20 text-rose-200 border-rose-500/40',
    border: 'border-rose-500/30',
  },
};

interface HtmlCardViewProps {
  item: ManifestItem;
  compact: boolean;
}

export function HtmlCardView({ item, compact }: HtmlCardViewProps) {
  const cfg = item.appConfig ?? {};
  const headline =
    typeof cfg.headline === 'string' && cfg.headline.trim() ? cfg.headline.trim() : item.title;
  const body = typeof cfg.body === 'string' ? cfg.body.trim() : '';
  const ctaText = typeof cfg.ctaText === 'string' ? cfg.ctaText.trim() : '';
  const accentKey = typeof cfg.accentColor === 'string' ? cfg.accentColor : 'amber';
  const theme = ACCENT_MAP[accentKey] ?? ACCENT_MAP.amber;

  return (
    <div
      data-creative-type="html"
      className={`flex h-full w-full flex-col justify-between bg-gradient-to-br ${theme.bg} text-white ${
        compact ? 'p-5' : 'p-14'
      }`}
    >
      <div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium uppercase ${
            theme.badge
          } ${compact ? 'text-[10px]' : 'text-xs'}`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Announcement
        </span>
      </div>

      <div className="my-auto space-y-4">
        <h1 className={`font-extrabold tracking-tight ${compact ? 'text-xl leading-snug' : 'text-6xl leading-tight'}`}>
          {headline}
        </h1>
        {body && (
          <p className={`max-w-3xl text-zinc-200 ${compact ? 'text-xs' : 'text-2xl leading-relaxed'}`}>
            {body}
          </p>
        )}
      </div>

      {ctaText ? (
        <div
          className={`inline-flex w-fit items-center rounded-lg border bg-black/50 font-semibold ${theme.border} ${
            compact ? 'px-3 py-1.5 text-xs' : 'px-6 py-3 text-lg'
          }`}
        >
          {ctaText}
        </div>
      ) : (
        <div className="text-xs text-zinc-400">Offline-Ready Creative • SignageOS</div>
      )}
    </div>
  );
}
