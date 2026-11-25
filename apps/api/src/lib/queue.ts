import crypto from 'node:crypto';
import PgBoss from 'pg-boss';
import { isPrivateOrBlockedHost } from '@signage/shared/creatives';
import { config } from '../config.js';
import { ensureFuturePopPartitions } from '../db/bootstrap.js';
import { pgClient } from '../db/index.js';

export const MEDIA_PROCESS_QUEUE = 'media.process';
const POP_PARTITION_QUEUE = 'pop.partitions.maintain';
const FLEET_ALERT_SWEEP_QUEUE = 'fleet.alerts.sweep';
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

export async function startQueue(): Promise<void> {
  startedAtMs = Date.now();
  boss = new PgBoss(config.DATABASE_URL);
  await boss.start();
  await boss.createQueue(MEDIA_PROCESS_QUEUE);
  await boss.createQueue(POP_PARTITION_QUEUE);
  await boss.createQueue(FLEET_ALERT_SWEEP_QUEUE);

  await boss.schedule(POP_PARTITION_QUEUE, '0 2 * * *', {});
  await boss.schedule(FLEET_ALERT_SWEEP_QUEUE, '*/3 * * * *', {});

  await boss.work(POP_PARTITION_QUEUE, async () => {
    await ensureFuturePopPartitions(6);
  });
  await boss.work(FLEET_ALERT_SWEEP_QUEUE, async () => {
    await runFleetAlertSweep();
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
