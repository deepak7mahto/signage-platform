import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, ilike, isNull, lt, or } from 'drizzle-orm';
import {
  SendScreenCommandSchema,
  UpdateScreenSchema,
  type Screen,
  type ScreenScreenshot,
} from '@signage/shared/contracts';
import { db } from '../db/index.js';
import {
  auditLogs,
  playlists,
  screenCommands,
  screenScreenshots,
  screens,
} from '../db/schema.js';
import { enqueueScreenCommand, toScreenCommandDto } from '../lib/commands.js';
import { encodeCursor, parseListQuery } from '../lib/pagination.js';
import { createPresignedGetUrl } from '../lib/s3.js';
import { requireRole } from '../middleware/rbac.js';
import { getEffectiveOrgId, resolveTenantScope } from '../middleware/tenant-scope.js';
import { disconnectScreenSocket, pushToScreen } from '../ws/gateway.js';
import { requireAuth } from './auth.js';
import { registerScreenBulkRoutes } from './screen-bulk.js';
import { toScreenDto } from './screen-dto.js';
import { registerScreenPreviewRoutes } from './screen-preview.js';
import { registerScreenProvisioningRoutes } from './screen-provisioning.js';

export async function screenRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/screens', { preHandler: [requireAuth, resolveTenantScope] }, async (req) => {
    const orgId = getEffectiveOrgId(req);
    const { limit, cursor, q, status, siteId } = parseListQuery(req.query);

    const conditions = [eq(screens.orgId, orgId), isNull(screens.revokedAt)];
    if (siteId) conditions.push(eq(screens.siteId, siteId));
    if (q) {
      const pattern = `%${q}%`;
      conditions.push(
        or(ilike(screens.name, pattern), ilike(screens.location, pattern), ilike(screens.city, pattern))!,
      );
    }
    if (cursor) {
      const curDate = new Date(cursor.sortValue);
      if (Number.isFinite(curDate.getTime())) {
        conditions.push(
          or(
            lt(screens.createdAt, curDate),
            and(eq(screens.createdAt, curDate), lt(screens.id, cursor.id)),
          )!,
        );
      }
    }

    const rows = await db
      .select({ screen: screens, playlistName: playlists.name })
      .from(screens)
      .leftJoin(playlists, eq(screens.activePlaylistId, playlists.id))
      .where(and(...conditions))
      .orderBy(desc(screens.createdAt), desc(screens.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    let items: Screen[] = slice.map(({ screen, playlistName }) => toScreenDto(screen, playlistName));
    if (status) {
      items = items.filter((s) => s.status === status);
    }

    const lastRow = slice[slice.length - 1];
    const nextCursor =
      hasMore && lastRow
        ? encodeCursor({ sortValue: lastRow.screen.createdAt.toISOString(), id: lastRow.screen.id })
        : null;

    return { items, nextCursor, hasMore };
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/screens/:id',
    { preHandler: [requireAuth, resolveTenantScope] },
    async (req, reply) => {
      const orgId = getEffectiveOrgId(req);
      const [row] = await db
        .select({ screen: screens, playlistName: playlists.name })
        .from(screens)
        .leftJoin(playlists, eq(screens.activePlaylistId, playlists.id))
        .where(
          and(eq(screens.id, req.params.id), eq(screens.orgId, orgId), isNull(screens.revokedAt)),
        )
        .limit(1);

      if (!row) {
        return reply.code(404).send({ error: 'Screen not found' });
      }

      const [latestShot] = await db
        .select()
        .from(screenScreenshots)
        .where(eq(screenScreenshots.screenId, row.screen.id))
        .orderBy(desc(screenScreenshots.capturedAt))
        .limit(1);

      const latestScreenshot: ScreenScreenshot | null = latestShot
        ? {
            id: latestShot.id,
            screenId: latestShot.screenId,
            url: await createPresignedGetUrl(latestShot.objectKey, 3600),
            capturedAt: latestShot.capturedAt.toISOString(),
          }
        : null;

      const cmdRows = await db
        .select()
        .from(screenCommands)
        .where(eq(screenCommands.screenId, row.screen.id))
        .orderBy(desc(screenCommands.createdAt))
        .limit(20);

      return {
        screen: toScreenDto(row.screen, row.playlistName),
        latestScreenshot,
        commands: cmdRows.map(toScreenCommandDto),
      };
    },
  );

  registerScreenPreviewRoutes(app);
  registerScreenBulkRoutes(app);

  app.post<{ Params: { id: string } }>(
    '/api/v1/screens/:id/commands',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'ops')] },
    async (req, reply) => {
      const parsed = SendScreenCommandSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid command payload', issues: parsed.error.issues });
      }

      const user = req.authUser!;
      const orgId = getEffectiveOrgId(req);
      const [existing] = await db
        .select()
        .from(screens)
        .where(
          and(eq(screens.id, req.params.id), eq(screens.orgId, orgId), isNull(screens.revokedAt)),
        )
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: 'Screen not found' });
      }

      const { command, pushed } = await enqueueScreenCommand(
        existing,
        parsed.data.command,
        parsed.data.payload,
      );

      await db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        orgId,
        actorUserId: user.id,
        action: `screen.command.${parsed.data.command}`,
        targetType: 'screen',
        targetId: existing.id,
        metadata: { commandId: command.id, pushed, payload: command.payload },
      });

      return reply.code(201).send({ command, pushed });
    },
  );

  registerScreenProvisioningRoutes(app);

  app.patch<{ Params: { id: string } }>(
    '/api/v1/screens/:id',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'ops')] },
    async (req, reply) => {
      const parsed = UpdateScreenSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid screen update', issues: parsed.error.issues });
      }

      const user = req.authUser!;
      const orgId = getEffectiveOrgId(req);
      const [existing] = await db
        .select()
        .from(screens)
        .where(
          and(eq(screens.id, req.params.id), eq(screens.orgId, orgId), isNull(screens.revokedAt)),
        )
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: 'Screen not found' });
      }

      if (parsed.data.activePlaylistId) {
        const [pl] = await db
          .select({ id: playlists.id })
          .from(playlists)
          .where(and(eq(playlists.id, parsed.data.activePlaylistId), eq(playlists.orgId, orgId)))
          .limit(1);
        if (!pl) {
          return reply.code(400).send({ error: 'Playlist not found' });
        }
      }

      const [updated] = await db
        .update(screens)
        .set({
          name: parsed.data.name ?? existing.name,
          location: parsed.data.location === undefined ? existing.location : parsed.data.location,
          timezone: parsed.data.timezone ?? existing.timezone,
          activePlaylistId:
            parsed.data.activePlaylistId === undefined
              ? existing.activePlaylistId
              : parsed.data.activePlaylistId,
          city: parsed.data.city === undefined ? existing.city : parsed.data.city,
          venueType: parsed.data.venueType === undefined ? existing.venueType : parsed.data.venueType,
          orientation: parsed.data.orientation ?? existing.orientation,
          slotDurationSec: parsed.data.slotDurationSec ?? existing.slotDurationSec,
          layoutConfig:
            parsed.data.layout === undefined ? existing.layoutConfig : parsed.data.layout,
          programmaticFillUrl:
            parsed.data.programmaticFillUrl === undefined
              ? existing.programmaticFillUrl
              : parsed.data.programmaticFillUrl,
        })
        .where(eq(screens.id, existing.id))
        .returning();

      await db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        orgId,
        actorUserId: user.id,
        action: 'screen.updated',
        targetType: 'screen',
        targetId: existing.id,
        metadata: {
          name: updated.name,
          city: updated.city,
          venueType: updated.venueType,
          layout: updated.layoutConfig?.template ?? 'fullscreen',
        },
      });

      if (
        parsed.data.activePlaylistId !== undefined ||
        parsed.data.layout !== undefined ||
        parsed.data.programmaticFillUrl !== undefined
      ) {
        pushToScreen(existing.id, {
          type: 'sync_now',
          reason: 'screen_updated',
          serverTime: new Date().toISOString(),
        });
      }

      return { screen: toScreenDto(updated, null) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/screens/:id/sync',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'ops')] },
    async (req, reply) => {
      const orgId = getEffectiveOrgId(req);
      const [existing] = await db
        .select()
        .from(screens)
        .where(
          and(eq(screens.id, req.params.id), eq(screens.orgId, orgId), isNull(screens.revokedAt)),
        )
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: 'Screen not found' });
      }

      const pushed = pushToScreen(existing.id, {
        type: 'sync_now',
        reason: 'manual_sync',
        serverTime: new Date().toISOString(),
      });

      return { ok: true, pushed };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/screens/:id',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin')] },
    async (req, reply) => {
      const user = req.authUser!;
      const orgId = getEffectiveOrgId(req);
      const [existing] = await db
        .select()
        .from(screens)
        .where(
          and(eq(screens.id, req.params.id), eq(screens.orgId, orgId), isNull(screens.revokedAt)),
        )
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: 'Screen not found' });
      }

      pushToScreen(existing.id, {
        type: 'revoke',
        reason: 'screen_deleted',
        serverTime: new Date().toISOString(),
      });
      disconnectScreenSocket(existing.id, 'Screen revoked');

      await db
        .update(screens)
        .set({
          revokedAt: new Date(),
          status: 'locked',
        })
        .where(eq(screens.id, existing.id));

      await db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        orgId,
        actorUserId: user.id,
        action: 'screen.revoked',
        targetType: 'screen',
        targetId: existing.id,
        metadata: { name: existing.name },
      });

      return { ok: true };
    },
  );
}
