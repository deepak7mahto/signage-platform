import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PopReport } from '@signage/shared';
import { pgClient } from '../db/index.js';
import { requireAuth } from './auth.js';

const ReportQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  screenId: z.string().uuid().optional(),
  assetId: z.string().uuid().optional(),
  format: z.enum(['json', 'csv']).optional(),
});

function csvCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function queryPopReport(
  orgId: string,
  filters: z.infer<typeof ReportQuerySchema>,
): Promise<PopReport> {
  const fromIso = filters.from
    ? new Date(filters.from).toISOString()
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const toIso = filters.to
    ? new Date(`${filters.to}T23:59:59.999Z`).toISOString()
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const screenFilter = filters.screenId ?? null;
  const assetFilter = filters.assetId ?? null;

  const [totals] = await pgClient<
    Array<{
      total_plays: string;
      completed_plays: string;
      total_duration_ms: string;
      active_screens: string;
    }>
  >`
    SELECT
      COUNT(*)::text AS total_plays,
      COUNT(*) FILTER (WHERE status = 'completed')::text AS completed_plays,
      COALESCE(SUM(duration_ms), 0)::text AS total_duration_ms,
      COUNT(DISTINCT screen_id)::text AS active_screens
    FROM proof_of_play
    WHERE org_id = ${orgId}::uuid
      AND started_at >= ${fromIso}::timestamptz
      AND started_at <= ${toIso}::timestamptz
      AND (${screenFilter}::uuid IS NULL OR screen_id = ${screenFilter}::uuid)
      AND (${assetFilter}::uuid IS NULL OR media_asset_id = ${assetFilter}::uuid)
  `;

  const byAssetRows = await pgClient<
    Array<{
      media_asset_id: string;
      title: string;
      type: 'video' | 'image';
      plays: string;
      completed_plays: string;
      total_duration_ms: string;
    }>
  >`
    SELECT
      p.media_asset_id,
      COALESCE(m.title, 'Deleted Asset') AS title,
      COALESCE(m.type, 'video') AS type,
      COUNT(*)::text AS plays,
      COUNT(*) FILTER (WHERE p.status = 'completed')::text AS completed_plays,
      COALESCE(SUM(p.duration_ms), 0)::text AS total_duration_ms
    FROM proof_of_play p
    LEFT JOIN media_assets m ON m.id = p.media_asset_id
    WHERE p.org_id = ${orgId}::uuid
      AND p.started_at >= ${fromIso}::timestamptz
      AND p.started_at <= ${toIso}::timestamptz
      AND (${screenFilter}::uuid IS NULL OR p.screen_id = ${screenFilter}::uuid)
      AND (${assetFilter}::uuid IS NULL OR p.media_asset_id = ${assetFilter}::uuid)
    GROUP BY p.media_asset_id, m.title, m.type
    ORDER BY COUNT(*) DESC
    LIMIT 50
  `;

  const byScreenRows = await pgClient<
    Array<{
      screen_id: string;
      screen_name: string;
      plays: string;
      total_duration_ms: string;
    }>
  >`
    SELECT
      p.screen_id,
      COALESCE(s.name, 'Removed Screen') AS screen_name,
      COUNT(*)::text AS plays,
      COALESCE(SUM(p.duration_ms), 0)::text AS total_duration_ms
    FROM proof_of_play p
    LEFT JOIN screens s ON s.id = p.screen_id
    WHERE p.org_id = ${orgId}::uuid
      AND p.started_at >= ${fromIso}::timestamptz
      AND p.started_at <= ${toIso}::timestamptz
      AND (${screenFilter}::uuid IS NULL OR p.screen_id = ${screenFilter}::uuid)
      AND (${assetFilter}::uuid IS NULL OR p.media_asset_id = ${assetFilter}::uuid)
    GROUP BY p.screen_id, s.name
    ORDER BY COUNT(*) DESC
    LIMIT 50
  `;

  const recentRows = await pgClient<
    Array<{
      id: string;
      screen_id: string;
      screen_name: string;
      media_asset_id: string;
      asset_title: string;
      playlist_id: string | null;
      playlist_name: string | null;
      started_at: Date;
      ended_at: Date;
      duration_ms: number;
      status: 'completed' | 'interrupted';
    }>
  >`
    SELECT
      p.id,
      p.screen_id,
      COALESCE(s.name, 'Removed Screen') AS screen_name,
      p.media_asset_id,
      COALESCE(m.title, 'Deleted Asset') AS asset_title,
      p.playlist_id,
      pl.name AS playlist_name,
      p.started_at,
      p.ended_at,
      p.duration_ms,
      p.status
    FROM proof_of_play p
    LEFT JOIN screens s ON s.id = p.screen_id
    LEFT JOIN media_assets m ON m.id = p.media_asset_id
    LEFT JOIN playlists pl ON pl.id = p.playlist_id
    WHERE p.org_id = ${orgId}::uuid
      AND p.started_at >= ${fromIso}::timestamptz
      AND p.started_at <= ${toIso}::timestamptz
      AND (${screenFilter}::uuid IS NULL OR p.screen_id = ${screenFilter}::uuid)
      AND (${assetFilter}::uuid IS NULL OR p.media_asset_id = ${assetFilter}::uuid)
    ORDER BY p.started_at DESC
    LIMIT 200
  `;

  return {
    totalPlays: Number(totals?.total_plays ?? 0),
    completedPlays: Number(totals?.completed_plays ?? 0),
    totalDurationMs: Number(totals?.total_duration_ms ?? 0),
    activeScreens: Number(totals?.active_screens ?? 0),
    byAsset: byAssetRows.map((r) => ({
      mediaAssetId: r.media_asset_id,
      title: r.title,
      type: r.type,
      plays: Number(r.plays),
      completedPlays: Number(r.completed_plays),
      totalDurationMs: Number(r.total_duration_ms),
    })),
    byScreen: byScreenRows.map((r) => ({
      screenId: r.screen_id,
      screenName: r.screen_name,
      plays: Number(r.plays),
      totalDurationMs: Number(r.total_duration_ms),
    })),
    recent: recentRows.map((r) => ({
      id: r.id,
      screenId: r.screen_id,
      screenName: r.screen_name,
      mediaAssetId: r.media_asset_id,
      assetTitle: r.asset_title,
      playlistId: r.playlist_id,
      playlistName: r.playlist_name,
      startedAt: new Date(r.started_at).toISOString(),
      endedAt: new Date(r.ended_at).toISOString(),
      durationMs: Number(r.duration_ms),
      status: r.status,
    })),
  };
}

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/reports/pop', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = ReportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query filters', issues: parsed.error.issues });
    }
    return queryPopReport(req.authUser!.orgId, parsed.data);
  });

  app.get('/api/v1/reports/pop/export', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = ReportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query filters', issues: parsed.error.issues });
    }

    const report = await queryPopReport(req.authUser!.orgId, parsed.data);
    const lines = [
      ['Impression ID', 'Screen', 'Asset', 'Playlist', 'Started At', 'Ended At', 'Duration (s)', 'Status'].join(','),
      ...report.recent.map((row) =>
        [
          csvCell(row.id),
          csvCell(row.screenName),
          csvCell(row.assetTitle),
          csvCell(row.playlistName ?? 'Fallback'),
          csvCell(row.startedAt),
          csvCell(row.endedAt),
          csvCell((row.durationMs / 1000).toFixed(1)),
          csvCell(row.status),
        ].join(','),
      ),
    ];

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="proof-of-play.csv"');
    return lines.join('\n');
  });
}
