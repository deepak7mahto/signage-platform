import type { Screen } from '@signage/shared';
import { screens } from '../db/schema.js';
import { isDeviceConnected } from '../ws/gateway.js';

export function computeScreenStatus(row: typeof screens.$inferSelect): Screen['status'] {
  if (row.status === 'locked') return 'locked';
  if (isDeviceConnected(row.id)) return 'online';
  if (row.lastSeenAt && Date.now() - row.lastSeenAt.getTime() < 90_000) {
    return 'online';
  }
  return 'offline';
}

export function toScreenDto(
  screen: typeof screens.$inferSelect,
  playlistName?: string | null,
): Screen {
  return {
    id: screen.id,
    orgId: screen.orgId,
    name: screen.name,
    location: screen.location,
    timezone: screen.timezone,
    status: computeScreenStatus(screen),
    appVersion: screen.appVersion,
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
    hwInfo: screen.hwInfo,
    lastSeenAt: screen.lastSeenAt ? screen.lastSeenAt.toISOString() : null,
    createdAt: screen.createdAt.toISOString(),
  };
}
