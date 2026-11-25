import type { PlaybackState, Screen } from '@signage/shared/contracts';
import { screens } from '../db/schema.js';
import { getCachedPresence } from '../lib/presence-bus.js';
import { isDeviceConnected } from '../ws/gateway.js';

export function computeScreenStatus(row: typeof screens.$inferSelect): Screen['status'] {
  if (row.revokedAt !== null || row.status === 'locked') return 'locked';
  if (isDeviceConnected(row.id)) return 'online';
  const cached = getCachedPresence(row.id);
  const lastSeenMs = Math.max(
    row.lastSeenAt ? row.lastSeenAt.getTime() : 0,
    cached ? cached.lastSeenAt.getTime() : 0,
  );
  if (lastSeenMs > 0 && Date.now() - lastSeenMs < 90_000) {
    return 'online';
  }
  return 'offline';
}

export function toScreenDto(
  screen: typeof screens.$inferSelect,
  playlistName?: string | null,
): Screen {
  const cached = getCachedPresence(screen.id);
  const effectiveLastSeen =
    cached && (!screen.lastSeenAt || cached.lastSeenAt > screen.lastSeenAt)
      ? cached.lastSeenAt
      : screen.lastSeenAt;

  return {
    id: screen.id,
    orgId: screen.orgId,
    name: screen.name,
    location: screen.location,
    timezone: screen.timezone,
    status: computeScreenStatus(screen),
    appVersion: cached?.appVersion ?? screen.appVersion,
    activePlaylistId: screen.activePlaylistId,
    activePlaylistName: playlistName ?? null,
    city: screen.city ?? null,
    venueType: (screen.venueType as Screen['venueType']) ?? null,
    orientation: (screen.orientation as Screen['orientation']) ?? 'landscape',
    slotDurationSec: screen.slotDurationSec ?? 15,
    layout: {
      template: screen.layoutConfig?.template ?? 'fullscreen',
      fitMode: screen.layoutConfig?.fitMode ?? 'contain',
      rotationDeg: screen.layoutConfig?.rotationDeg ?? 0,
      transition: screen.layoutConfig?.transition ?? 'fade',
      syncMode: screen.layoutConfig?.syncMode ?? 'independent',
      tickerText: screen.layoutConfig?.tickerText ?? null,
      sidebarTitle: screen.layoutConfig?.sidebarTitle ?? null,
      sidebarLines: screen.layoutConfig?.sidebarLines ?? [],
    },
    programmaticFillUrl: screen.programmaticFillUrl ?? null,
    hwInfo: cached?.hwInfo ?? screen.hwInfo,
    lastSeenAt: effectiveLastSeen ? effectiveLastSeen.toISOString() : null,
    createdAt: screen.createdAt.toISOString(),
    siteId: screen.siteId ?? null,
    profileId: screen.profileId ?? null,
    manifestVersion: cached?.manifestVersion ?? screen.manifestVersion ?? 0,
    playbackState: ((cached?.playbackState ?? screen.playbackState) as PlaybackState) ?? 'unknown',
    lastFrameAdvanceAt:
      cached?.lastFrameAdvanceAt ??
      (screen.lastFrameAdvanceAt ? screen.lastFrameAdvanceAt.toISOString() : null),
    capabilities: cached?.capabilities ?? screen.capabilities ?? [],
    revokedAt: screen.revokedAt ? screen.revokedAt.toISOString() : null,
  };
}
