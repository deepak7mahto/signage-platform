import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import {
  resolveActiveManifestPlaylist,
  type BulkProvisionResponse,
  type BulkProvisionRowResult,
  type ScheduleSimulationResponse,
  type ScheduleSimulationTraceItem,
} from '@signage/shared/contracts';
import { db } from '../db/index.js';
import { auditLogs, pairingCodes, screens } from '../db/schema.js';
import { generateOpaqueToken, sha256Hex } from '../lib/crypto.js';
import { buildDeviceManifest } from '../lib/manifest.js';
import { requireRole } from '../middleware/rbac.js';
import { getEffectiveOrgId, resolveTenantScope } from '../middleware/tenant-scope.js';
import { requireAuth } from './auth.js';

interface BulkRowInput {
  name?: string;
  location?: string;
  timezone?: string;
  orientation?: string;
  city?: string;
  siteId?: string;
}

function parseCsvRows(csvText: string): BulkRowInput[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const hasHeader = header.includes('name');
  const startIdx = hasHeader ? 1 : 0;
  const cols = hasHeader ? header : ['name', 'location', 'timezone', 'orientation', 'city', 'siteid'];

  const rows: BulkRowInput[] = [];
  for (let i = startIdx; i < lines.length; i += 1) {
    const parts = lines[i].split(',').map((c) => c.trim());
    const obj: BulkRowInput = {};
    cols.forEach((col, idx) => {
      const val = parts[idx];
      if (!val) return;
      if (col === 'name') obj.name = val;
      else if (col === 'location') obj.location = val;
      else if (col === 'timezone') obj.timezone = val;
      else if (col === 'orientation') obj.orientation = val;
      else if (col === 'city') obj.city = val;
      else if (col === 'siteid' || col === 'site_id') obj.siteId = val;
    });
    rows.push(obj);
  }
  return rows;
}

function evaluateScheduleWhy(
  manifest: Awaited<ReturnType<typeof buildDeviceManifest>>,
  atMs: number,
): ScheduleSimulationTraceItem[] {
  const date = new Date(atMs);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: manifest.timezone || 'UTC',
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
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dateStr = `${map.year}-${map.month}-${map.day}`;
  const timeStr = `${map.hour === '24' ? '00' : map.hour}:${map.minute}`;
  const dayIdx = dayMap[map.weekday ?? ''] ?? date.getUTCDay();

  return (manifest.schedules ?? []).map((s) => {
    const pl = manifest.playlists?.[s.playlistId];
    let reason = 'Matched active time window and non-empty playlist';
    let matched = true;

    if (!pl || pl.items.length === 0) {
      matched = false;
      reason = 'Skipped: target playlist has 0 playable/approved items';
    } else if (s.validFrom && dateStr < s.validFrom) {
      matched = false;
      reason = `Skipped: before validFrom (${s.validFrom})`;
    } else if (s.validUntil && dateStr > s.validUntil) {
      matched = false;
      reason = `Skipped: past validUntil (${s.validUntil})`;
    } else if (s.daysOfWeek.length > 0 && !s.daysOfWeek.includes(dayIdx)) {
      matched = false;
      reason = `Skipped: weekday ${dayIdx} not in allowed daysOfWeek`;
    } else {
      const inTime =
        s.startTime <= s.endTime
          ? timeStr >= s.startTime && timeStr <= s.endTime
          : timeStr >= s.startTime || timeStr <= s.endTime;
      if (!inTime) {
        matched = false;
        reason = `Skipped: ${timeStr} outside ${s.startTime}-${s.endTime}`;
      }
    }

    return {
      scheduleId: s.id,
      scheduleName: s.name,
      playlistId: s.playlistId,
      priority: s.priority,
      matched,
      reason,
    };
  });
}

export function registerScreenBulkRoutes(app: FastifyInstance): void {
  app.post(
    '/api/v1/screens/provision/bulk',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'ops')] },
    async (req, reply) => {
      const body = (req.body ?? {}) as { csv?: string; rows?: BulkRowInput[] };
      const rows = Array.isArray(body.rows)
        ? body.rows
        : typeof body.csv === 'string'
          ? parseCsvRows(body.csv)
          : [];

      if (rows.length === 0 || rows.length > 1000) {
        return reply.code(400).send({ error: 'Provide between 1 and 1,000 rows to provision' });
      }

      const orgId = getEffectiveOrgId(req);
      const user = req.authUser!;
      const results: BulkProvisionRowResult[] = [];
      let succeeded = 0;
      let failed = 0;
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i];
        const name = (r.name ?? '').trim();
        if (!name) {
          failed += 1;
          results.push({ rowNumber: i + 1, name: '', ok: false, error: 'Missing screen name' });
          continue;
        }
        try {
          const deviceTokenPlain = `dev_${generateOpaqueToken(32)}`;
          const tokenHash = sha256Hex(deviceTokenPlain);
          const screenId = crypto.randomUUID();
          const provisionToken = `PROV-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

          await db.insert(screens).values({
            id: screenId,
            orgId,
            siteId: r.siteId ?? null,
            name,
            location: r.location ?? null,
            timezone: r.timezone || 'UTC',
            orientation: r.orientation === 'portrait' ? 'portrait' : 'landscape',
            city: r.city ?? null,
            status: 'unpaired',
            tokenHash,
          });

          await db.insert(pairingCodes).values({
            code: provisionToken,
            claimSecretHash: 'provision',
            claimedScreenId: screenId,
            deviceTokenPlain,
            expiresAt,
          });

          succeeded += 1;
          results.push({
            rowNumber: i + 1,
            name,
            ok: true,
            screenId,
            provisionToken,
          });
        } catch (err) {
          failed += 1;
          results.push({
            rowNumber: i + 1,
            name,
            ok: false,
            error: err instanceof Error ? err.message : 'Insert failed',
          });
        }
      }

      await db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        orgId,
        actorUserId: user.id,
        action: 'screen.bulk_provisioned',
        targetType: 'screen',
        targetId: null,
        metadata: { total: rows.length, succeeded, failed },
      });

      const response: BulkProvisionResponse = {
        total: rows.length,
        succeeded,
        failed,
        results,
      };
      return reply.code(201).send(response);
    },
  );

  app.post<{ Params: { id: string }; Querystring: { at?: string } }>(
    '/api/v1/screens/:id/simulate',
    { preHandler: [requireAuth, resolveTenantScope] },
    async (req, reply) => {
      const orgId = getEffectiveOrgId(req);
      const [screen] = await db
        .select()
        .from(screens)
        .where(and(eq(screens.id, req.params.id), eq(screens.orgId, orgId), isNull(screens.revokedAt)))
        .limit(1);

      if (!screen) return reply.code(404).send({ error: 'Screen not found' });

      const bodyAt =
        typeof req.body === 'object' && req.body !== null && 'at' in req.body
          ? String((req.body as { at?: unknown }).at ?? '')
          : '';
      const rawAt = (req.query?.at ?? bodyAt).trim();
      const atMs = rawAt ? Date.parse(rawAt) : Date.now();
      if (!Number.isFinite(atMs)) {
        return reply.code(400).send({ error: 'Invalid ISO timestamp in at parameter' });
      }

      const manifest = await buildDeviceManifest(screen);
      const resolved = resolveActiveManifestPlaylist(manifest, atMs);
      const trace = evaluateScheduleWhy(manifest, atMs);

      const response: ScheduleSimulationResponse = {
        screenId: screen.id,
        at: new Date(atMs).toISOString(),
        timezone: manifest.timezone,
        winningPlaylistId: resolved.playlistId,
        winningPlaylistName: resolved.playlistName,
        winningScheduleName: resolved.scheduleName,
        itemCount: resolved.items.length,
        trace,
      };
      return response;
    },
  );
}
