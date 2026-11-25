import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import {
  CreateScheduleSchema,
  UpdateScheduleSchema,
  type Schedule,
} from '@signage/shared';
import { db } from '../db/index.js';
import { auditLogs, playlists, schedules, screenGroups, screens } from '../db/schema.js';
import { pushToGroup, pushToScreen } from '../ws/gateway.js';
import { requireAuth } from './auth.js';

async function validateTarget(
  orgId: string,
  targetType: 'screen' | 'group',
  targetId: string,
): Promise<string | null> {
  if (targetType === 'screen') {
    const [row] = await db
      .select({ name: screens.name })
      .from(screens)
      .where(and(eq(screens.id, targetId), eq(screens.orgId, orgId)))
      .limit(1);
    return row?.name ?? null;
  }
  const [row] = await db
    .select({ name: screenGroups.name })
    .from(screenGroups)
    .where(and(eq(screenGroups.id, targetId), eq(screenGroups.orgId, orgId)))
    .limit(1);
  return row?.name ?? null;
}

async function notifyTarget(
  targetType: string,
  targetId: string,
  reason: string,
): Promise<void> {
  if (targetType === 'screen') {
    pushToScreen(targetId, {
      type: 'sync_now',
      reason,
      serverTime: new Date().toISOString(),
    });
  } else if (targetType === 'group') {
    await pushToGroup(targetId, reason);
  }
}

async function toScheduleDto(row: typeof schedules.$inferSelect): Promise<Schedule> {
  const [pl] = await db
    .select({ name: playlists.name })
    .from(playlists)
    .where(eq(playlists.id, row.playlistId))
    .limit(1);

  const targetName = await validateTarget(
    row.orgId,
    row.targetType as 'screen' | 'group',
    row.targetId,
  );

  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    playlistId: row.playlistId,
    playlistName: pl?.name ?? null,
    targetType: row.targetType as 'screen' | 'group',
    targetId: row.targetId,
    targetName,
    priority: row.priority,
    daysOfWeek: row.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6],
    startTime: row.startTime,
    endTime: row.endTime,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function scheduleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/schedules', { preHandler: requireAuth }, async (req) => {
    const orgId = req.authUser!.orgId;
    const rows = await db
      .select()
      .from(schedules)
      .where(eq(schedules.orgId, orgId))
      .orderBy(desc(schedules.priority), desc(schedules.createdAt));

    const items = await Promise.all(rows.map((r) => toScheduleDto(r)));
    return { items };
  });

  app.post('/api/v1/schedules', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = CreateScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid schedule payload', issues: parsed.error.issues });
    }

    const user = req.authUser!;
    const data = parsed.data;

    const [pl] = await db
      .select({ id: playlists.id })
      .from(playlists)
      .where(and(eq(playlists.id, data.playlistId), eq(playlists.orgId, user.orgId)))
      .limit(1);
    if (!pl) {
      return reply.code(400).send({ error: 'Playlist not found' });
    }

    const targetName = await validateTarget(user.orgId, data.targetType, data.targetId);
    if (!targetName) {
      return reply.code(400).send({ error: 'Target screen or group not found' });
    }

    const scheduleId = crypto.randomUUID();
    const [created] = await db
      .insert(schedules)
      .values({
        id: scheduleId,
        orgId: user.orgId,
        name: data.name,
        playlistId: data.playlistId,
        targetType: data.targetType,
        targetId: data.targetId,
        priority: data.priority,
        daysOfWeek: data.daysOfWeek,
        startTime: data.startTime,
        endTime: data.endTime,
        validFrom: data.validFrom ?? null,
        validUntil: data.validUntil ?? null,
        enabled: data.enabled,
      })
      .returning();

    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      orgId: user.orgId,
      actorUserId: user.id,
      action: 'schedule.created',
      targetType: 'schedule',
      targetId: scheduleId,
      metadata: { name: created.name, targetType: created.targetType, targetId: created.targetId },
    });

    await notifyTarget(created.targetType, created.targetId, 'schedule_created');
    return reply.code(201).send({ schedule: await toScheduleDto(created) });
  });

  app.patch<{ Params: { id: string } }>(
    '/api/v1/schedules/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const parsed = UpdateScheduleSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid schedule update', issues: parsed.error.issues });
      }

      const user = req.authUser!;
      const [existing] = await db
        .select()
        .from(schedules)
        .where(and(eq(schedules.id, req.params.id), eq(schedules.orgId, user.orgId)))
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: 'Schedule not found' });
      }

      const nextPlaylistId = parsed.data.playlistId ?? existing.playlistId;
      const [pl] = await db
        .select({ id: playlists.id })
        .from(playlists)
        .where(and(eq(playlists.id, nextPlaylistId), eq(playlists.orgId, user.orgId)))
        .limit(1);
      if (!pl) {
        return reply.code(400).send({ error: 'Playlist not found' });
      }

      const nextTargetType = (parsed.data.targetType ?? existing.targetType) as 'screen' | 'group';
      const nextTargetId = parsed.data.targetId ?? existing.targetId;
      const targetName = await validateTarget(user.orgId, nextTargetType, nextTargetId);
      if (!targetName) {
        return reply.code(400).send({ error: 'Target screen or group not found' });
      }

      const [updated] = await db
        .update(schedules)
        .set({
          name: parsed.data.name ?? existing.name,
          playlistId: nextPlaylistId,
          targetType: nextTargetType,
          targetId: nextTargetId,
          priority: parsed.data.priority ?? existing.priority,
          daysOfWeek: parsed.data.daysOfWeek ?? existing.daysOfWeek,
          startTime: parsed.data.startTime ?? existing.startTime,
          endTime: parsed.data.endTime ?? existing.endTime,
          validFrom:
            parsed.data.validFrom === undefined ? existing.validFrom : parsed.data.validFrom,
          validUntil:
            parsed.data.validUntil === undefined ? existing.validUntil : parsed.data.validUntil,
          enabled: parsed.data.enabled ?? existing.enabled,
          updatedAt: new Date(),
        })
        .where(eq(schedules.id, existing.id))
        .returning();

      await notifyTarget(existing.targetType, existing.targetId, 'schedule_updated');
      if (nextTargetType !== existing.targetType || nextTargetId !== existing.targetId) {
        await notifyTarget(nextTargetType, nextTargetId, 'schedule_updated');
      }

      return { schedule: await toScheduleDto(updated) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/schedules/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const user = req.authUser!;
      const [existing] = await db
        .select()
        .from(schedules)
        .where(and(eq(schedules.id, req.params.id), eq(schedules.orgId, user.orgId)))
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: 'Schedule not found' });
      }

      await db.delete(schedules).where(eq(schedules.id, existing.id));
      await notifyTarget(existing.targetType, existing.targetId, 'schedule_deleted');
      return { ok: true };
    },
  );
}
