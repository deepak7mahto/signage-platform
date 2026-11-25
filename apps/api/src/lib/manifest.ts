import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import {
  expandSovPlaylistItems,
  isBinaryMediaType,
  type DeviceManifest,
  type ManifestItem,
  type ManifestPlaylist,
  type ManifestSchedule,
  type PlaylistLoopMode,
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
import { sha256Hex, signManifest } from './crypto.js';
import { loadOrgFeedsMap, loadOrientationVariantMap } from './manifest-extensions.js';
import { createPresignedGetUrl } from './s3.js';

export type ScreenRow = typeof screens.$inferSelect;

export interface SignedManifestEnvelope {
  manifest: DeviceManifest;
  bodyJson: string;
  etag: string;
  kid: string;
  signatureB64: string;
  publicKeyB64: string;
  serverTime: string;
}

const manifestCache = new Map<string, Omit<SignedManifestEnvelope, 'serverTime'>>();

function pruneManifestCache(): void {
  if (manifestCache.size <= 1000) return;
  const firstKey = manifestCache.keys().next().value;
  if (firstKey) manifestCache.delete(firstKey);
}

export async function buildDeviceManifest(screen: ScreenRow): Promise<DeviceManifest> {
  const envelope = await buildSignedManifest(screen, 1);
  return envelope.manifest;
}

export async function buildSignedManifest(
  screen: ScreenRow,
  schemaVersion: 1 | 2 = 1,
): Promise<SignedManifestEnvelope> {
  const nowIso = new Date().toISOString();
  const urlBucket = Math.floor(Date.now() / 600_000);

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
    .orderBy(desc(schedules.priority), desc(schedules.updatedAt), asc(schedules.id));

  const neededPlaylistIds = new Set<string>();
  if (screen.activePlaylistId) neededPlaylistIds.add(screen.activePlaylistId);
  for (const s of scheduleRows) {
    neededPlaylistIds.add(s.playlistId);
  }

  const playlistRows =
    neededPlaylistIds.size > 0
      ? await db.select().from(playlists).where(inArray(playlists.id, [...neededPlaylistIds]))
      : [];

  let versionSum = 0;
  for (const pl of playlistRows) versionSum += pl.version;

  const feedsMap = await loadOrgFeedsMap(screen.orgId);

  const scheduleFingerprint = scheduleRows
    .map((s) => `${s.id}:${s.updatedAt.toISOString()}:${s.priority}:${s.playlistId}`)
    .join('|');
  const screenFingerprint = [
    screen.activePlaylistId ?? 'none',
    screen.timezone,
    screen.orientation,
    JSON.stringify(screen.layoutConfig ?? null),
    screen.programmaticFillUrl ?? '',
    JSON.stringify(feedsMap),
  ].join('|');

  const revisionDigest = sha256Hex(
    `${schemaVersion}:${versionSum}:${scheduleFingerprint}:${screenFingerprint}`,
  ).slice(0, 24);
  const cacheKey = `${screen.id}:${revisionDigest}:${urlBucket}`;

  const cached = manifestCache.get(cacheKey);
  if (cached) {
    return {
      ...cached,
      serverTime: nowIso,
    };
  }

  const playlistsMap: Record<string, ManifestPlaylist> = {};
  if (neededPlaylistIds.size > 0) {
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

    const variantMap = await loadOrientationVariantMap(
      allItemRows.map((r) => r.asset.id),
      screen.orientation,
    );

    const itemsByPlaylist = new Map<string, ManifestItem[]>();
    for (const { item, asset } of allItemRows) {
      if (asset.status !== 'ready' || asset.approvalStatus !== 'approved' || !asset.sha256) {
        continue;
      }
      const isBinary = isBinaryMediaType(asset.type);
      const variant = isBinary ? variantMap.get(asset.id) : undefined;
      const effKey = variant?.objectKey ?? asset.objectKey;
      const effSha = variant?.sha256 ?? asset.sha256;
      const effSize = variant ? Number(variant.sizeBytes) : Number(asset.sizeBytes);
      const effMime = variant?.mimeType ?? asset.mimeType;

      const list = itemsByPlaylist.get(item.playlistId) ?? [];
      list.push({
        itemId: item.id,
        assetId: asset.id,
        title: asset.title,
        type: asset.type,
        mimeType: effMime,
        sha256: effSha,
        sizeBytes: effSize,
        durationMs: asset.type === 'video' && asset.durationMs ? asset.durationMs : item.durationMs,
        sortOrder: item.sortOrder,
        weight: item.weight,
        width: variant?.width ?? asset.width ?? null,
        height: variant?.height ?? asset.height ?? null,
        appConfig: asset.appConfig ?? null,
        url: isBinary
          ? await getUrl(effKey)
          : typeof asset.appConfig?.url === 'string'
            ? asset.appConfig.url
            : '',
      });
      itemsByPlaylist.set(item.playlistId, list);
    }

    for (const pl of playlistRows) {
      const loopMode = (pl.loopMode as PlaylistLoopMode) ?? 'sequential';
      const rawItems = itemsByPlaylist.get(pl.id) ?? [];
      playlistsMap[pl.id] = {
        id: pl.id,
        name: pl.name,
        version: pl.version,
        loopMode,
        items: expandSovPlaylistItems(rawItems, loopMode),
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
    updatedAt: s.updatedAt.toISOString(),
  }));

  const stableBody = {
    screenId: screen.id,
    screenName: screen.name,
    timezone: screen.timezone,
    orientation: (screen.orientation as 'landscape' | 'portrait') ?? 'landscape',
    playlistId: fallbackPlaylist?.id ?? null,
    playlistName: fallbackPlaylist?.name ?? null,
    manifestVersion: versionSum + manifestSchedules.length,
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
    ...(Object.keys(feedsMap).length > 0 ? { feeds: feedsMap } : {}),
  };

  const manifest: DeviceManifest = {
    ...stableBody,
    generatedAt: nowIso,
    serverTime: nowIso,
  };

  const bodyObj = schemaVersion === 2 ? stableBody : manifest;
  const bodyJson = JSON.stringify(bodyObj);
  const etag = `"${sha256Hex(JSON.stringify(stableBody)).slice(0, 32)}"`;
  const { kid, signatureB64, publicKeyB64 } = signManifest(bodyJson);

  const cachedEntry = {
    manifest,
    bodyJson,
    etag,
    kid,
    signatureB64,
    publicKeyB64,
  };
  manifestCache.set(cacheKey, cachedEntry);
  pruneManifestCache();

  return {
    ...cachedEntry,
    serverTime: nowIso,
  };
}
