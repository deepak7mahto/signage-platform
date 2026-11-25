import { Layers } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ManifestItem } from '@signage/shared';
import { HtmlCardView } from './HtmlCardView';
import { IframeAddonView } from './IframeAddonView';
import { WeatherWidget } from './WeatherWidget';

export interface CreativeRenderProps {
  item: ManifestItem;
  isOnline: boolean;
  isMuted: boolean;
  compact: boolean;
}

export const CREATIVE_RENDERERS: Record<string, (props: CreativeRenderProps) => ReactNode> = {
  webpage: ({ item, isOnline, isMuted }) => (
    <IframeAddonView item={item} isOnline={isOnline} isMuted={isMuted} />
  ),
  youtube: ({ item, isOnline, isMuted }) => (
    <IframeAddonView item={item} isOnline={isOnline} isMuted={isMuted} />
  ),
  weather: ({ item, isOnline, compact }) => (
    <WeatherWidget item={item} isOnline={isOnline} compact={compact} />
  ),
  html: ({ item, compact }) => <HtmlCardView item={item} compact={compact} />,
};

export function renderCreativeAddon(props: CreativeRenderProps): ReactNode {
  const renderer = CREATIVE_RENDERERS[props.item.type];
  if (renderer) return renderer(props);

  return (
    <div
      data-creative-type={props.item.type}
      className="flex h-full w-full flex-col items-center justify-center bg-zinc-950 p-6 text-center text-white"
    >
      <Layers className="mb-3 h-8 w-8 text-zinc-400" />
      <div className="text-base font-semibold">{props.item.title}</div>
      <div className="mt-1 text-xs text-zinc-400">
        Custom creative type: <span className="font-mono">{props.item.type}</span>
      </div>
    </div>
  );
}
