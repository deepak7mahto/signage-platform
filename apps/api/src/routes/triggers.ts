import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import {
  CreateScreenTriggerSchema,
  type FireTriggerResponse,
  type ScreenTrigger,
} from '@signage/shared/contracts';
import { db } from '../db/index.js';
import { auditLogs, playlists, schedules, screenTriggers, screens } from '../db/schema.js';
import { generateOpaqueToken, sha256Hex } from '../lib/crypto.js';
import { requireRole } from '../middleware/rbac.js';
import { getEffectiveOrgId, resolveTenantScope } from '../middleware/tenant-scope.js';
import { pushToGroup, pushToScreens } from '../ws/gateway.js';
import { requireAuth } from './auth.js';

function toTriggerDto(row: typeof screenTriggers.$inferSelect): ScreenTrigger {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    triggerKey: row.triggerKey,
    targetType: row.targetType as 'screen' | 'group',
    targetId: row.targetId,
    playlistId: row.playlistId,
    durationSec: row.durationSec,
    priority: row.priority,
    enabled: row.enabled,
    lastFiredAt: row.lastFiredAt ? row.lastFiredAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function zonedDateTimeStrings(ms: number, timezone: string): { date: string; hhmm: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms));
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const hour = map.hour === '24' ? '00' : (map.hour ?? '00');
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    hhmm: `${hour}:${map.minute ?? '00'}`,
  };
}

export async function triggerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/triggers', { preHandler: [requireAuth, resolveTenantScope] }, async (req) => {
    const orgId = getEffectiveOrgId(req);
    const rows = await db
      .select()
      .from(screenTriggers)
      .where(eq(screenTriggers.orgId, orgId))
      .orderBy(desc(screenTriggers.createdAt));
    return { items: rows.map(toTriggerDto) };
  });

  app.post(
    '/api/v1/triggers',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'ops')] },
    async (req, reply) => {
      const parsed = CreateScreenTriggerSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid trigger payload', issues: parsed.error.issues });
      }
      const orgId = getEffectiveOrgId(req);
      const user = req.authUser!;

      const [pl] = await db
        .select({ id: playlists.id })
        .from(playlists)
        .where(and(eq(playlists.id, parsed.data.playlistId), eq(playlists.orgId, orgId)))
        .limit(1);
      if (!pl) return reply.code(400).send({ error: 'Target playlist not found in organization' });

      const triggerId = crypto.randomUUID();
      const slugBase = parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32);
      const triggerKey = parsed.data.triggerKey ?? `${slugBase}-${triggerId.slice(0, 6)}`;
      const triggerSecret = `trg_${generateOpaqueToken(24)}`;

      const [created] = await db
        .insert(screenTriggers)
        .values({
          id: triggerId,
          orgId,
          name: parsed.data.name,
          triggerKey,
          targetType: parsed.data.targetType,
          targetId: parsed.data.targetId,
          playlistId: parsed.data.playlistId,
          durationSec: parsed.data.durationSec,
          priority: parsed.data.priority,
          secretHash: sha256Hex(triggerSecret),
          enabled: true,
        })
        .returning();

      await db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        orgId,
        actorUserId: user.id,
        action: 'trigger.created',
        targetType: 'screen_trigger',
        targetId: triggerId,
        metadata: { triggerKey },
      });

      return reply.code(201).send({ trigger: toTriggerDto(created), triggerSecret });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/triggers/:id',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'ops')] },
    async (req, reply) => {
      const orgId = getEffectiveOrgId(req);
      const [deleted] = await db
        .delete(screenTriggers)
        .where(and(eq(screenTriggers.id, req.params.id), eq(screenTriggers.orgId, orgId)))
        .returning({ id: screenTriggers.id });
      if (!deleted) return reply.code(404).send({ error: 'Trigger not found' });
      return { ok: true };
    },
  );

  app.post<{ Params: { key: string } }>('/api/v1/triggers/:key/fire', async (req, reply) => {
    const headerSecret =
      typeof req.headers['x-trigger-secret'] === 'string'
        ? req.headers['x-trigger-secret'].trim()
        : '';
    const bodySecret =
      typeof req.body === 'object' && req.body !== null && 'secret' in req.body
        ? String((req.body as { secret?: unknown }).secret ?? '').trim()
        : '';
    const rawSecret = headerSecret || bodySecret;
    if (!rawSecret) {
      return reply.code(401).send({ error: 'Missing X-Trigger-Secret' });
    }

    const [trigger] = await db
      .select()
      .from(screenTriggers)
      .where(and(eq(screenTriggers.triggerKey, req.params.key), eq(screenTriggers.enabled, true)))
      .limit(1);

    if (!trigger) {
      return reply.code(404).send({ error: 'Active trigger not found' });
    }

    const incomingBuf = Buffer.from(sha256Hex(rawSecret), 'utf8');
    const storedBuf = Buffer.from(trigger.secretHash, 'utf8');
    if (incomingBuf.length !== storedBuf.length || !crypto.timingSafeEqual(incomingBuf, storedBuf)) {
      return reply.code(401).send({ error: 'Invalid trigger secret' });
    }

    let timezone = 'UTC';
    if (trigger.targetType === 'screen') {
      const [sc] = await db
        .select({ timezone: screens.timezone })
        .from(screens)
        .where(eq(screens.id, trigger.targetId))
        .limit(1);
      if (sc?.timezone) timezone = sc.timezone;
    }

    const nowMs = Date.now();
    const expiresMs = nowMs + trigger.durationSec * 1000;
    const startZoned = zonedDateTimeStrings(nowMs, timezone);
    const endZoned = zonedDateTimeStrings(expiresMs, timezone);

    const scheduleId = crypto.randomUUID();
    await db.insert(schedules).values({
      id: scheduleId,
      orgId: trigger.orgId,
      name: `[Trigger] ${trigger.name}`,
      playlistId: trigger.playlistId,
      targetType: trigger.targetType,
      targetId: trigger.targetId,
      priority: trigger.priority,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      startTime: startZoned.hhmm,
      endTime: endZoned.hhmm,
      validFrom: startZoned.date,
      validUntil: endZoned.date,
      enabled: true,
    });

    await db
      .update(screenTriggers)
      .set({ lastFiredAt: new Date(nowMs) })
      .where(eq(screenTriggers.id, trigger.id));

    const pushed =
      trigger.targetType === 'screen'
        ? pushToScreens([trigger.targetId], `trigger_${trigger.triggerKey}`)
        : await pushToGroup(trigger.targetId, `trigger_${trigger.triggerKey}`);

    const response: FireTriggerResponse = {
      ok: true,
      scheduleId,
      expiresAt: new Date(expiresMs).toISOString(),
      pushed,
    };
    return response;
  });
}
