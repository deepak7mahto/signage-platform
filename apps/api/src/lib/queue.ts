import crypto from 'node:crypto';
import PgBoss from 'pg-boss';
import { isPrivateOrBlockedHost } from '@signage/shared/creatives';
import { config } from '../config.js';
import { ensureFuturePopPartitions } from '../db/bootstrap.js';
import { db, pgClient } from '../db/index.js';
import { dataFeeds } from '../db/schema.js';
import { refreshFeedRow } from '../routes/feeds.js';

export const MEDIA_PROCESS_QUEUE = 'media.process';
const POP_PARTITION_QUEUE = 'pop.partitions.maintain';
const POP_ROLLUP_QUEUE = 'pop.rollups.aggregate';
const POP_RETENTION_QUEUE = 'pop.partitions.retention';
const FLEET_ALERT_SWEEP_QUEUE = 'fleet.alerts.sweep';
const FEEDS_POLL_QUEUE = 'feeds.poll.sweep';
const BOOT_GRACE_MS = 5 * 60_000;

let boss: PgBoss | null = null;
let startedAtMs = Date.now();

async function sendSignedWebhook(
  url: string,
  secret: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const allowHttpInDev = config.NODE_ENV !== 'production';
  if (isPrivateOrBlockedHost(url, { allowHttpInDev })) {
    return;
  }

  const body = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const backoffMs = [500, 1500, 4500];

  for (let attempt = 0; attempt < backoffMs.length; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signage-Signature': `sha256=${sig}`,
        },
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return;
    } catch {
      // Retry below
    }
    if (attempt < backoffMs.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt]));
    }
  }
}

async function runFleetAlertSweep(): Promise<void> {
  if (Date.now() - startedAtMs < BOOT_GRACE_MS) {
    return;
  }

  await pgClient`
    UPDATE screens
    SET playback_state = 'stalled'
    WHERE revoked_at IS NULL
      AND status = 'online'
      AND playback_state = 'playing'
      AND last_frame_advance_at IS NOT NULL
      AND last_frame_advance_at < NOW() - INTERVAL '180 seconds'
  `;

  const siteRows = await pgClient<
    Array<{
      site_id: string;
      org_id: string;
      site_name: string;
      alert_policy: {
        webhookUrl?: string;
        webhookSecret?: string;
        offlinePercentThreshold?: number;
      } | null;
      total_count: number;
      offline_count: number;
    }>
  >`
    SELECT
      st.id AS site_id,
      st.org_id,
      st.name AS site_name,
      st.alert_policy,
      COUNT(sc.id)::int AS total_count,
      COUNT(sc.id) FILTER (
        WHERE sc.status = 'offline'
          OR (sc.last_seen_at IS NOT NULL AND sc.last_seen_at < NOW() - INTERVAL '3 minutes')
      )::int AS offline_count
    FROM sites st
    INNER JOIN screens sc ON sc.site_id = st.id AND sc.revoked_at IS NULL
    GROUP BY st.id
    HAVING COUNT(sc.id) >= 3
  `;

  for (const row of siteRows) {
    const threshold = row.alert_policy?.offlinePercentThreshold ?? 0.5;
    const ratio = row.total_count > 0 ? row.offline_count / row.total_count : 0;
    if (ratio < threshold) continue;

    const webhookUrl = row.alert_policy?.webhookUrl;
    if (!webhookUrl) continue;
    const secret = row.alert_policy?.webhookSecret || config.BLOB_HMAC_SECRET;

    await sendSignedWebhook(webhookUrl, secret, {
      event: 'site.outage',
      orgId: row.org_id,
      siteId: row.site_id,
      siteName: row.site_name,
      totalScreens: row.total_count,
      offlineScreens: row.offline_count,
      offlineRatio: Number(ratio.toFixed(2)),
      detectedAt: new Date().toISOString(),
    });
  }
}

async function runPopHourlyRollups(): Promise<void> {
  await pgClient`
    INSERT INTO pop_hourly_rollups (
      org_id, screen_id, media_asset_id, hour_bucket,
      plays, completed_plays, total_duration_ms
    )
    SELECT
      org_id,
      screen_id,
      media_asset_id,
      date_trunc('hour', started_at) AS hour_bucket,
      COUNT(*)::int AS plays,
      COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_plays,
      COALESCE(SUM(duration_ms), 0)::bigint AS total_duration_ms
    FROM proof_of_play
    WHERE started_at >= NOW() - INTERVAL '2 hours'
    GROUP BY org_id, screen_id, media_asset_id, date_trunc('hour', started_at)
    ON CONFLICT (org_id, screen_id, media_asset_id, hour_bucket)
    DO UPDATE SET
      plays = EXCLUDED.plays,
      completed_plays = EXCLUDED.completed_plays,
      total_duration_ms = EXCLUDED.total_duration_ms
  `;
}

async function dropExpiredPopPartitions(): Promise<void> {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const cutoffKey = `${cutoff.getUTCFullYear()}_${String(cutoff.getUTCMonth() + 1).padStart(2, '0')}`;
  const rows = await pgClient<Array<{ tablename: string }>>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename ~ '^proof_of_play_[0-9]{4}_[0-9]{2}$'
  `;
  for (const row of rows) {
    const suffix = row.tablename.slice('proof_of_play_'.length);
    if (suffix < cutoffKey && /^proof_of_play_[0-9]{4}_[0-9]{2}$/.test(row.tablename)) {
      await pgClient.unsafe(`DROP TABLE IF EXISTS ${row.tablename}`);
    }
  }
}

async function runFeedsPollSweep(): Promise<void> {
  const feeds = await db.select().from(dataFeeds);
  const now = Date.now();
  for (const feed of feeds) {
    const due =
      !feed.lastFetchedAt || now - feed.lastFetchedAt.getTime() >= feed.pollIntervalSec * 1000;
    if (due) {
      await refreshFeedRow(feed);
    }
  }
}

export async function startQueue(): Promise<void> {
  startedAtMs = Date.now();
  boss = new PgBoss(config.DATABASE_URL);
  await boss.start();
  await boss.createQueue(MEDIA_PROCESS_QUEUE);
  await boss.createQueue(POP_PARTITION_QUEUE);
  await boss.createQueue(POP_ROLLUP_QUEUE);
  await boss.createQueue(POP_RETENTION_QUEUE);
  await boss.createQueue(FLEET_ALERT_SWEEP_QUEUE);
  await boss.createQueue(FEEDS_POLL_QUEUE);

  await boss.schedule(POP_PARTITION_QUEUE, '0 2 * * *', {});
  await boss.schedule(POP_ROLLUP_QUEUE, '*/15 * * * *', {});
  await boss.schedule(POP_RETENTION_QUEUE, '30 3 * * *', {});
  await boss.schedule(FLEET_ALERT_SWEEP_QUEUE, '*/3 * * * *', {});
  await boss.schedule(FEEDS_POLL_QUEUE, '*/2 * * * *', {});

  await boss.work(POP_PARTITION_QUEUE, async () => {
    await ensureFuturePopPartitions(6);
  });
  await boss.work(POP_ROLLUP_QUEUE, async () => {
    await runPopHourlyRollups();
  });
  await boss.work(POP_RETENTION_QUEUE, async () => {
    await dropExpiredPopPartitions();
  });
  await boss.work(FLEET_ALERT_SWEEP_QUEUE, async () => {
    await runFleetAlertSweep();
  });
  await boss.work(FEEDS_POLL_QUEUE, async () => {
    await runFeedsPollSweep();
  });
}

export async function enqueueMediaProcessing(assetId: string): Promise<void> {
  if (!boss) {
    throw new Error('Queue not started');
  }
  await boss.send(MEDIA_PROCESS_QUEUE, { assetId });
}

export async function stopQueue(): Promise<void> {
  if (boss) {
    await boss.stop();
    boss = null;
  }
}
