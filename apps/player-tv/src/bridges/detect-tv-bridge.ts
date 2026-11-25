import type { PlatformBridge } from '@signage/player-core';
import { isTizenRuntime, TizenPlatformBridge } from './tizen-bridge.js';
import { isWebOsRuntime, WebOsPlatformBridge } from './webos-bridge.js';

export type TvPlatformBridge = PlatformBridge & { platform: 'tizen' | 'webos' };

export function detectTvBridge(): TvPlatformBridge {
  const forced =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('platform')?.toLowerCase()
      : null;

  if (forced === 'webos' || (!forced && isWebOsRuntime())) {
    return new WebOsPlatformBridge();
  }
  if (forced === 'tizen' || isTizenRuntime()) {
    return new TizenPlatformBridge();
  }
  return new TizenPlatformBridge();
}
