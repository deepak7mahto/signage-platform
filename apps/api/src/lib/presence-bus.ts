import crypto from 'node:crypto';
import { Redis } from 'ioredis';
import { sql } from 'drizzle-orm';
import { config } from '../config.js';
import { pgClient } from '../db/index.js';

export interface PresenceHeartbeatUpdate {
  screenId: string;
  appVersion?: string | null;
  hwInfo?: Record<string, unknown> | null;
  playbackState?: string;
  manifestVersion?: number;
  lastFrameAdvanceAt?: string;
  capabilities?: string[];
  lastSeenAt: Date;
}

interface PresenceState extends PresenceHeartbeatUpdate {
  dirty: boolean;
}

type SyncListener = (screenIds: string[], reason: string) => void;

const INSTANCE_ID = crypto.randomUUID();
const SYNC_CHANNEL = 'signage_sync';
const FLUSH_INTERVAL_MS = 60_000;
const PRESENCE_TTL_SEC = 90;

const presenceMap = new Map<string, PresenceState>();
let flushTimer: ReturnType<typeof setInterval> | null = null;
let redisPub: Redis | null = null;
let redisSub: Redis | null = null;
let pgListenConn: { unlisten: () => Promise<void> } | null = null;
let onSyncCallback: SyncListener | null = null;

export function setSyncSignalListener(listener: SyncListener): void {
  onSyncCallback = listener;
}

export function getCachedPresence(screenId: string): PresenceState | undefined {
  return presenceMap.get(screenId);
}

export function recordPresenceHeartbeat(update: PresenceHeartbeatUpdate): void {
  const prev = presenceMap.get(update.screenId);
  presenceMap.set(update.screenId, {
    screenId: update.screenId,
    appVersion: update.appVersion ?? prev?.appVersion ?? null,
    hwInfo: update.hwInfo ?? prev?.hwInfo ?? null,
    playbackState: update.playbackState ?? prev?.playbackState,
    manifestVersion: update.manifestVersion ?? prev?.manifestVersion,
    lastFrameAdvanceAt: update.lastFrameAdvanceAt ?? prev?.lastFrameAdvanceAt,
    capabilities: update.capabilities ?? prev?.capabilities,
    lastSeenAt: update.lastSeenAt,
    dirty: true,
  });

  if (redisPub) {
    void redisPub
      .set(`presence:screen:${update.screenId}`, update.lastSeenAt.toISOString(), 'EX', PRESENCE_TTL_SEC)
      .catch(() => {});
  }
}

export async function flushDirtyPresenceToPostgres(): Promise<number> {
  const dirtyEntries: PresenceState[] = [];
  for (const entry of presenceMap.values()) {
    if (entry.dirty) {
      entry.dirty = false;
      dirtyEntries.push(entry);
    }
  }
  if (dirtyEntries.length === 0) return 0;

  let flushed = 0;
  for (const entry of dirtyEntries) {
    try {
      await pgClient`
        UPDATE screens
        SET
          status = CASE WHEN status = 'locked' THEN 'locked' ELSE 'online' END,
          app_version = COALESCE(${entry.appVersion ?? null}, app_version),
          hw_info = COALESCE(${entry.hwInfo ? pgClient.json(entry.hwInfo as never) : null}, hw_info),
          playback_state = COALESCE(${entry.playbackState ?? null}, playback_state),
          manifest_version = COALESCE(${entry.manifestVersion ?? null}, manifest_version),
          last_frame_advance_at = COALESCE(${entry.lastFrameAdvanceAt ?? null}::timestamptz, last_frame_advance_at),
          capabilities = COALESCE(${entry.capabilities ? pgClient.json(entry.capabilities as never) : null}, capabilities),
          last_seen_at = ${entry.lastSeenAt.toISOString()}::timestamptz
        WHERE id = ${entry.screenId}::uuid AND revoked_at IS NULL
      `;
      flushed += 1;
    } catch {
      entry.dirty = true;
    }
  }
  return flushed;
}

export async function publishSyncSignal(screenIds: string[], reason: string): Promise<void> {
  const payload = JSON.stringify({ instanceId: INSTANCE_ID, screenIds, reason });
  if (redisPub) {
    await redisPub.publish(SYNC_CHANNEL, payload).catch(() => {});
    return;
  }
  try {
    await pgClient`SELECT pg_notify(${SYNC_CHANNEL}, ${payload})`;
  } catch {
    // Ignore notification failure; direct local push already handled
  }
}

function handleIncomingSignal(rawPayload: string): void {
  try {
    const msg = JSON.parse(rawPayload) as {
      instanceId?: string;
      screenIds?: string[];
      reason?: string;
    };
    if (msg.instanceId === INSTANCE_ID) return;
    if (Array.isArray(msg.screenIds) && typeof msg.reason === 'string' && onSyncCallback) {
      onSyncCallback(msg.screenIds, msg.reason);
    }
  } catch {
    // Ignore malformed pub/sub message
  }
}

export async function initPresenceBus(): Promise<void> {
  if (config.REDIS_URL) {
    redisPub = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
    redisSub = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 });
    await redisSub.subscribe(SYNC_CHANNEL);
    redisSub.on('message', (_channel, message) => handleIncomingSignal(message));
  } else {
    pgListenConn = await pgClient.listen(SYNC_CHANNEL, (payload) => {
      handleIncomingSignal(payload);
    });
  }

  flushTimer = setInterval(() => {
    void flushDirtyPresenceToPostgres();
  }, FLUSH_INTERVAL_MS);
  if (typeof flushTimer.unref === 'function') {
    flushTimer.unref();
  }
  void sql`SELECT 1`;
}

export async function stopPresenceBus(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushDirtyPresenceToPostgres().catch(() => {});
  if (pgListenConn) {
    await pgListenConn.unlisten().catch(() => {});
    pgListenConn = null;
  }
  if (redisSub) {
    await redisSub.quit().catch(() => {});
    redisSub = null;
  }
  if (redisPub) {
    await redisPub.quit().catch(() => {});
    redisPub = null;
  }
}
