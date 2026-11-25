import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import {
  isBinaryMediaType,
  type DeviceManifest,
  type ManifestItem,
  type ManifestPlaylist,
  type ManifestSchedule,
} from '@signage/shared';
import { db } from '../db/index.js';
import {
  mediaAssets,
  playlistItems,
  playlists,
  schedules,
  screenGroupMembers,
  screens,
} from '../db/schema.js';
import { createPresignedGetUrl } from './s3.js';

export type ScreenRow = typeof screens.$inferSelect;

export async function buildDeviceManifest(screen: ScreenRow): Promise<DeviceManifest> {
  const nowIso = new Date().toISOString();

  const membershipRows = await db
    .select({ groupId: screenGroupMembers.groupId })
    .from(screenGroupMembers)
    .where(eq(screenGroupMembers.screenId, screen.id));
  const groupIds = membershipRows.map((m) => m.groupId);

  const targetCondition =
    groupIds.length > 0
      ? or(
          and(eq(schedules.targetType, 'screen'), eq(schedules.targetId, screen.id)),
          and(eq(schedules.targetType, 'group'), inArray(schedules.targetId, groupIds)),
        )
      : and(eq(schedules.targetType, 'screen'), eq(schedules.targetId, screen.id));

  const scheduleRows = await db
    .select()
    .from(schedules)
    .where(and(eq(schedules.orgId, screen.orgId), eq(schedules.enabled, true), targetCondition))
    .orderBy(desc(schedules.priority));

  const neededPlaylistIds = new Set<string>();
  if (screen.activePlaylistId) neededPlaylistIds.add(screen.activePlaylistId);
  for (const s of scheduleRows) {
    neededPlaylistIds.add(s.playlistId);
  }

  const playlistsMap: Record<string, ManifestPlaylist> = {};
  let versionSum = 0;

  if (neededPlaylistIds.size > 0) {
    const playlistRows = await db
      .select()
      .from(playlists)
      .where(inArray(playlists.id, [...neededPlaylistIds]));

    const allItemRows = await db
      .select({
        item: playlistItems,
        asset: mediaAssets,
      })
      .from(playlistItems)
      .innerJoin(mediaAssets, eq(playlistItems.mediaAssetId, mediaAssets.id))
      .where(inArray(playlistItems.playlistId, [...neededPlaylistIds]))
      .orderBy(asc(playlistItems.sortOrder));

    const signedUrlCache = new Map<string, string>();
    const getUrl = async (key: string) => {
      const hit = signedUrlCache.get(key);
      if (hit) return hit;
      const signed = await createPresignedGetUrl(key, 3600);
      signedUrlCache.set(key, signed);
      return signed;
    };

    const itemsByPlaylist = new Map<string, ManifestItem[]>();
    for (const { item, asset } of allItemRows) {
      if (asset.status !== 'ready' || asset.approvalStatus !== 'approved' || !asset.sha256) {
        continue;
      }
      const isBinary = isBinaryMediaType(asset.type);
      const list = itemsByPlaylist.get(item.playlistId) ?? [];
      list.push({
        itemId: item.id,
        assetId: asset.id,
        title: asset.title,
        type: asset.type,
        mimeType: asset.mimeType,
        sha256: asset.sha256,
        sizeBytes: Number(asset.sizeBytes),
        durationMs: asset.type === 'video' && asset.durationMs ? asset.durationMs : item.durationMs,
        sortOrder: item.sortOrder,
        width: asset.width ?? null,
        height: asset.height ?? null,
        appConfig: asset.appConfig ?? null,
        url: isBinary
          ? await getUrl(asset.objectKey)
          : typeof asset.appConfig?.url === 'string'
            ? asset.appConfig.url
            : '',
      });
      itemsByPlaylist.set(item.playlistId, list);
    }

    for (const pl of playlistRows) {
      versionSum += pl.version;
      playlistsMap[pl.id] = {
        id: pl.id,
        name: pl.name,
        version: pl.version,
        items: itemsByPlaylist.get(pl.id) ?? [],
      };
    }
  }

  const fallbackPlaylist = screen.activePlaylistId
    ? playlistsMap[screen.activePlaylistId]
    : undefined;

  const manifestSchedules: ManifestSchedule[] = scheduleRows.map((s) => ({
    id: s.id,
    name: s.name,
    playlistId: s.playlistId,
    priority: s.priority,
    daysOfWeek: s.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6],
    startTime: s.startTime,
    endTime: s.endTime,
    validFrom: s.validFrom,
    validUntil: s.validUntil,
  }));

  return {
    screenId: screen.id,
    screenName: screen.name,
    timezone: screen.timezone,
    orientation: (screen.orientation as 'landscape' | 'portrait') ?? 'landscape',
    playlistId: fallbackPlaylist?.id ?? null,
    playlistName: fallbackPlaylist?.name ?? null,
    manifestVersion: versionSum + manifestSchedules.length,
    generatedAt: nowIso,
    serverTime: nowIso,
    items: fallbackPlaylist?.items ?? [],
    schedules: manifestSchedules,
    playlists: playlistsMap,
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
  };
}
