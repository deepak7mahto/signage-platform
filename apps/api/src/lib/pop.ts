import type { PopEventInput } from '@signage/shared/contracts';
import { pgClient } from '../db/index.js';

export async function ingestPopEvents(
  orgId: string,
  screenId: string,
  events: PopEventInput[],
): Promise<number> {
  if (events.length === 0) return 0;

  const ids = events.map((ev) => ev.id);
  const orgIds = events.map(() => orgId);
  const screenIds = events.map(() => screenId);
  const playlistIds = events.map((ev) => ev.playlistId ?? '');
  const mediaAssetIds = events.map((ev) => ev.mediaAssetId);
  const startedAts = events.map((ev) => ev.startedAt);
  const endedAts = events.map((ev) => ev.endedAt);
  const durationMss = events.map((ev) => Math.round(ev.durationMs));
  const statuses = events.map((ev) => ev.status);

  const res = await pgClient`
    INSERT INTO proof_of_play (
      id, org_id, screen_id, playlist_id, media_asset_id,
      started_at, ended_at, duration_ms, status
    )
    SELECT
      u.id,
      u.org_id,
      u.screen_id,
      NULLIF(u.playlist_id, '')::uuid,
      u.media_asset_id,
      u.started_at,
      u.ended_at,
      u.duration_ms,
      u.status
    FROM UNNEST(
      ${pgClient.array(ids)}::uuid[],
      ${pgClient.array(orgIds)}::uuid[],
      ${pgClient.array(screenIds)}::uuid[],
      ${pgClient.array(playlistIds)}::text[],
      ${pgClient.array(mediaAssetIds)}::uuid[],
      ${pgClient.array(startedAts)}::timestamptz[],
      ${pgClient.array(endedAts)}::timestamptz[],
      ${pgClient.array(durationMss)}::integer[],
      ${pgClient.array(statuses)}::text[]
    ) AS u(
      id, org_id, screen_id, playlist_id, media_asset_id,
      started_at, ended_at, duration_ms, status
    )
    ON CONFLICT (id, started_at) DO NOTHING
  `;

  return res.count;
}
