import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  CreateScreenGroupSchema,
  UpdateScreenGroupSchema,
  type ScreenGroup,
} from '@signage/shared';
import { db } from '../db/index.js';
import { auditLogs, schedules, screenGroupMembers, screenGroups, screens } from '../db/schema.js';
import { pushToScreens } from '../ws/gateway.js';
import { requireRole } from '../middleware/rbac.js';
import { requireAuth } from './auth.js';

async function loadGroupDto(groupRow: typeof screenGroups.$inferSelect): Promise<ScreenGroup> {
  const members = await db
    .select({ screenId: screenGroupMembers.screenId })
    .from(screenGroupMembers)
    .where(eq(screenGroupMembers.groupId, groupRow.id));

  return {
    id: groupRow.id,
    orgId: groupRow.orgId,
    name: groupRow.name,
    description: groupRow.description,
    screenIds: members.map((m) => m.screenId),
    createdAt: groupRow.createdAt.toISOString(),
  };
}

export async function groupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/groups', { preHandler: requireAuth }, async (req) => {
    const orgId = req.authUser!.orgId;
    const rows = await db
      .select()
      .from(screenGroups)
      .where(eq(screenGroups.orgId, orgId))
      .orderBy(desc(screenGroups.createdAt));

    const items = await Promise.all(rows.map((r) => loadGroupDto(r)));
    return { items };
  });

  app.post(
    '/api/v1/groups',
    { preHandler: [requireAuth, requireRole('owner', 'admin', 'editor')] },
    async (req, reply) => {
    const parsed = CreateScreenGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid group payload', issues: parsed.error.issues });
    }

    const user = req.authUser!;
    const uniqueScreenIds = [...new Set(parsed.data.screenIds)];

    if (uniqueScreenIds.length > 0) {
      const owned = await db
        .select({ id: screens.id })
        .from(screens)
        .where(and(eq(screens.orgId, user.orgId), inArray(screens.id, uniqueScreenIds)));
      if (owned.length !== uniqueScreenIds.length) {
        return reply.code(400).send({ error: 'One or more screens do not belong to org' });
      }
    }

    const groupId = crypto.randomUUID();
    const [created] = await db
      .insert(screenGroups)
      .values({
        id: groupId,
        orgId: user.orgId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
      })
      .returning();

    if (uniqueScreenIds.length > 0) {
      await db.insert(screenGroupMembers).values(
        uniqueScreenIds.map((screenId) => ({
          groupId,
          screenId,
        })),
      );
      pushToScreens(uniqueScreenIds, 'group_updated');
    }

    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      orgId: user.orgId,
      actorUserId: user.id,
      action: 'group.created',
      targetType: 'screen_group',
      targetId: groupId,
      metadata: { name: created.name, screenCount: uniqueScreenIds.length },
    });

    return reply.code(201).send({ group: await loadGroupDto(created) });
  });

  app.put<{ Params: { id: string } }>(
    '/api/v1/groups/:id',
    { preHandler: [requireAuth, requireRole('owner', 'admin', 'editor')] },
    async (req, reply) => {
      const parsed = UpdateScreenGroupSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid group update', issues: parsed.error.issues });
      }

      const user = req.authUser!;
      const [existing] = await db
        .select()
        .from(screenGroups)
        .where(and(eq(screenGroups.id, req.params.id), eq(screenGroups.orgId, user.orgId)))
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: 'Screen group not found' });
      }

      const prevMembers = await db
        .select({ screenId: screenGroupMembers.screenId })
        .from(screenGroupMembers)
        .where(eq(screenGroupMembers.groupId, existing.id));
      const affectedScreens = new Set<string>(prevMembers.map((m) => m.screenId));

      if (parsed.data.screenIds !== undefined) {
        const uniqueScreenIds = [...new Set(parsed.data.screenIds)];
        if (uniqueScreenIds.length > 0) {
          const owned = await db
            .select({ id: screens.id })
            .from(screens)
            .where(and(eq(screens.orgId, user.orgId), inArray(screens.id, uniqueScreenIds)));
          if (owned.length !== uniqueScreenIds.length) {
            return reply.code(400).send({ error: 'One or more screens do not belong to org' });
          }
        }

        await db.delete(screenGroupMembers).where(eq(screenGroupMembers.groupId, existing.id));
        if (uniqueScreenIds.length > 0) {
          await db.insert(screenGroupMembers).values(
            uniqueScreenIds.map((screenId) => ({
              groupId: existing.id,
              screenId,
            })),
          );
          for (const id of uniqueScreenIds) affectedScreens.add(id);
        }
      }

      const [updated] = await db
        .update(screenGroups)
        .set({
          name: parsed.data.name ?? existing.name,
          description:
            parsed.data.description === undefined ? existing.description : parsed.data.description,
        })
        .where(eq(screenGroups.id, existing.id))
        .returning();

      pushToScreens([...affectedScreens], 'group_updated');
      return { group: await loadGroupDto(updated) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/groups/:id',
    { preHandler: [requireAuth, requireRole('owner', 'admin', 'editor')] },
    async (req, reply) => {
      const user = req.authUser!;
      const [existing] = await db
        .select()
        .from(screenGroups)
        .where(and(eq(screenGroups.id, req.params.id), eq(screenGroups.orgId, user.orgId)))
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: 'Screen group not found' });
      }

      const prevMembers = await db
        .select({ screenId: screenGroupMembers.screenId })
        .from(screenGroupMembers)
        .where(eq(screenGroupMembers.groupId, existing.id));

      await db
        .delete(schedules)
        .where(
          and(
            eq(schedules.orgId, user.orgId),
            eq(schedules.targetType, 'group'),
            eq(schedules.targetId, existing.id),
          ),
        );

      await db.delete(screenGroups).where(eq(screenGroups.id, existing.id));

      pushToScreens(
        prevMembers.map((m) => m.screenId),
        'group_deleted',
      );
      return { ok: true };
    },
  );
}
