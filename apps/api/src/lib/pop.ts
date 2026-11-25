import type { PopEventInput } from '@signage/shared';
import { pgClient } from '../db/index.js';

export async function ingestPopEvents(
  orgId: string,
  screenId: string,
  events: PopEventInput[],
): Promise<number> {
  if (events.length === 0) return 0;

  let inserted = 0;
  for (const ev of events) {
    const res = await pgClient`
      INSERT INTO proof_of_play (
        id, org_id, screen_id, playlist_id, media_asset_id,
        started_at, ended_at, duration_ms, status
      ) VALUES (
        ${ev.id}::uuid,
        ${orgId}::uuid,
        ${screenId}::uuid,
        ${ev.playlistId ?? null}::uuid,
        ${ev.mediaAssetId}::uuid,
        ${ev.startedAt}::timestamptz,
        ${ev.endedAt}::timestamptz,
        ${ev.durationMs},
        ${ev.status}
      )
      ON CONFLICT (id, started_at) DO NOTHING
    `;
    inserted += res.count;
  }

  return inserted;
}
