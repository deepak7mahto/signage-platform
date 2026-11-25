import { z } from 'zod';
import { CreativeConfigSchema, MediaTypeSchema } from './creatives.js';
import { OrientationSchema, ScreenLayoutConfigSchema } from './screens.js';
import { PlaylistLoopModeSchema } from './stage3.js';

// --- Device Manifest ---
export const ManifestItemSchema = z.object({
  itemId: z.string().uuid(),
  assetId: z.string().uuid(),
  title: z.string(),
  type: MediaTypeSchema,
  mimeType: z.string(),
  sha256: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
  sortOrder: z.number().int().nonnegative(),
  weight: z.number().int().positive().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  appConfig: CreativeConfigSchema.nullable().optional(),
  url: z.string(),
});
export type ManifestItem = z.infer<typeof ManifestItemSchema>;

export const ManifestScheduleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  playlistId: z.string().uuid(),
  priority: z.number().int(),
  daysOfWeek: z.array(z.number().int()),
  startTime: z.string(),
  endTime: z.string(),
  validFrom: z.string().nullable(),
  validUntil: z.string().nullable(),
  updatedAt: z.string().optional(),
});
export type ManifestSchedule = z.infer<typeof ManifestScheduleSchema>;

export const ManifestPlaylistSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  version: z.number().int().nonnegative(),
  loopMode: PlaylistLoopModeSchema.optional(),
  items: z.array(ManifestItemSchema),
});
export type ManifestPlaylist = z.infer<typeof ManifestPlaylistSchema>;

export const DeviceManifestSchema = z.object({
  screenId: z.string().uuid(),
  screenName: z.string(),
  timezone: z.string(),
  orientation: OrientationSchema.default('landscape'),
  playlistId: z.string().uuid().nullable(),
  playlistName: z.string().nullable(),
  manifestVersion: z.number().int().nonnegative(),
  generatedAt: z.string(),
  serverTime: z.string(),
  items: z.array(ManifestItemSchema),
  schedules: z.array(ManifestScheduleSchema).default([]),
  playlists: z.record(z.string(), ManifestPlaylistSchema).default({}),
  layout: ScreenLayoutConfigSchema.optional(),
  feeds: z.record(z.string(), z.unknown()).optional(),
});
export type DeviceManifest = z.infer<typeof DeviceManifestSchema>;

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getZonedClockParts(
  nowMs: number,
  timezone: string,
): { dateStr: string; timeStr: string; dayIndex: number } {
  const date = new Date(nowMs);
  let tz = timezone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(date);
  } catch {
    tz = 'UTC';
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }

  const hour = map.hour === '24' ? '00' : (map.hour ?? '00');
  const minute = map.minute ?? '00';
  return {
    dateStr: `${map.year}-${map.month}-${map.day}`,
    timeStr: `${hour}:${minute}`,
    dayIndex: WEEKDAY_TO_INDEX[map.weekday ?? ''] ?? date.getUTCDay(),
  };
}

export function resolveActiveManifestPlaylist(
  manifest: DeviceManifest,
  nowMs = Date.now(),
): {
  playlistId: string | null;
  playlistName: string | null;
  scheduleName: string | null;
  items: ManifestItem[];
} {
  const schedules = manifest.schedules ?? [];
  const playlists = manifest.playlists ?? {};

  if (schedules.length > 0) {
    const { dateStr, timeStr, dayIndex } = getZonedClockParts(nowMs, manifest.timezone);

    const matching = schedules
      .filter((s) => {
        const pl = playlists[s.playlistId];
        if (!pl || pl.items.length === 0) return false;
        if (s.validFrom && dateStr < s.validFrom) return false;
        if (s.validUntil && dateStr > s.validUntil) return false;
        if (s.daysOfWeek.length > 0 && !s.daysOfWeek.includes(dayIndex)) return false;

        if (s.startTime <= s.endTime) {
          return timeStr >= s.startTime && timeStr <= s.endTime;
        }
        return timeStr >= s.startTime || timeStr <= s.endTime;
      })
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        const aUpdated = a.updatedAt ?? '';
        const bUpdated = b.updatedAt ?? '';
        if (bUpdated !== aUpdated) return bUpdated.localeCompare(aUpdated);
        return a.id.localeCompare(b.id);
      });

    if (matching.length > 0) {
      const top = matching[0];
      const pl = playlists[top.playlistId];
      return {
        playlistId: pl.id,
        playlistName: pl.name,
        scheduleName: top.name,
        items: pl.items,
      };
    }
  }

  return {
    playlistId: manifest.playlistId,
    playlistName: manifest.playlistName,
    scheduleName: null,
    items: manifest.items,
  };
}

export interface ClockSyncInput {
  durationsMs: number[];
  nowMs: number;
  clockOffsetMs?: number;
  epochMs?: number;
  currentIndex?: number;
  currentPositionMs?: number;
  seekThresholdMs?: number;
}

export interface ClockSyncResult {
  itemIndex: number;
  positionMs: number;
  loopPositionMs: number;
  totalDurationMs: number;
  needsSeek: boolean;
}

/**
 * Computes deterministic synced loop cursor and whether a player must hard-seek
 * (> seekThresholdMs default 600ms or item index mismatch).
 */
export function resolveClockSyncCursor(input: ClockSyncInput): ClockSyncResult | null {
  const validDurations = input.durationsMs.filter((d) => Number.isFinite(d) && d > 0);
  if (validDurations.length === 0) return null;

  const totalDurationMs = validDurations.reduce((sum, d) => sum + d, 0);
  const adjustedNowMs = input.nowMs + (input.clockOffsetMs ?? 0);
  const elapsedFromEpoch = adjustedNowMs - (input.epochMs ?? 0);
  const loopPositionMs = ((elapsedFromEpoch % totalDurationMs) + totalDurationMs) % totalDurationMs;

  let acc = 0;
  let itemIndex = 0;
  let positionMs = 0;
  for (let i = 0; i < validDurations.length; i += 1) {
    const dur = validDurations[i];
    if (loopPositionMs < acc + dur) {
      itemIndex = i;
      positionMs = loopPositionMs - acc;
      break;
    }
    acc += dur;
  }

  const threshold = input.seekThresholdMs ?? 600;
  const hasCurrent =
    input.currentIndex !== undefined && input.currentPositionMs !== undefined;
  const needsSeek = hasCurrent
    ? input.currentIndex !== itemIndex ||
      Math.abs((input.currentPositionMs ?? 0) - positionMs) > threshold
    : true;

  return {
    itemIndex,
    positionMs,
    loopPositionMs,
    totalDurationMs,
    needsSeek,
  };
}
