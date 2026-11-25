import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import {
  SendScreenCommandSchema,
  UpdateScreenSchema,
  type Screen,
  type ScreenCommand,
  type ScreenScreenshot,
  type ServerToDeviceMessage,
} from '@signage/shared';
import { db } from '../db/index.js';
import {
  auditLogs,
  playlists,
  screenCommands,
  screenScreenshots,
  screens,
} from '../db/schema.js';
import { createPresignedGetUrl, createPresignedPutUrl } from '../lib/s3.js';
import { pushToScreen } from '../ws/gateway.js';
import { requireAuth } from './auth.js';
import { toScreenDto } from './screen-dto.js';
import { registerScreenPreviewRoutes } from './screen-preview.js';
import { registerScreenProvisioningRoutes } from './screen-provisioning.js';

export async function screenRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/screens', { preHandler: requireAuth }, async (req) => {
    const orgId = req.authUser!.orgId;
    const rows = await db
      .select({ screen: screens, playlistName: playlists.name })
      .from(screens)
      .leftJoin(playlists, eq(screens.activePlaylistId, playlists.id))
      .where(eq(screens.orgId, orgId))
      .orderBy(desc(screens.createdAt));

    const items: Screen[] = rows.map(({ screen, playlistName }) => toScreenDto(screen, playlistName));
    return { items };
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/screens/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const user = req.authUser!;
      const [row] = await db
        .select({ screen: screens, playlistName: playlists.name })
        .from(screens)
        .leftJoin(playlists, eq(screens.activePlaylistId, playlists.id))
        .where(and(eq(screens.id, req.params.id), eq(screens.orgId, user.orgId)))
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

      const commands: ScreenCommand[] = cmdRows.map((c) => ({
        id: c.id,
        screenId: c.screenId,
        command: c.command as ScreenCommand['command'],
        payload: c.payload,
        status: c.status as ScreenCommand['status'],
        detail: c.detail,
        createdAt: c.createdAt.toISOString(),
        ackedAt: c.ackedAt ? c.ackedAt.toISOString() : null,
      }));

      return {
        screen: toScreenDto(row.screen, row.playlistName),
        latestScreenshot,
        commands,
      };
    },
  );

  registerScreenPreviewRoutes(app);

  app.post<{ Params: { id: string } }>(
    '/api/v1/screens/:id/commands',
    { preHandler: requireAuth },
    async (req, reply) => {
      const parsed = SendScreenCommandSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid command payload', issues: parsed.error.issues });
      }

      const user = req.authUser!;
      const [existing] = await db
        .select()
        .from(screens)
        .where(and(eq(screens.id, req.params.id), eq(screens.orgId, user.orgId)))
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: 'Screen not found' });
      }

      const commandId = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      let dbPayload: Record<string, unknown> | null = parsed.data.payload ?? null;
      let wsMsg: ServerToDeviceMessage;

      switch (parsed.data.command) {
        case 'take_screenshot': {
          const objectKey = `${user.orgId}/screenshots/${existing.id}/${commandId}.jpg`;
          const uploadUrl = await createPresignedPutUrl(objectKey, 'image/jpeg', 300);
          dbPayload = { objectKey };
          wsMsg = { type: 'take_screenshot', commandId, uploadUrl, objectKey, serverTime: nowIso };
          break;
        }
        case 'set_volume': {
          const raw = Number(parsed.data.payload?.level ?? 50);
          const level = Math.max(0, Math.min(100, Number.isFinite(raw) ? Math.round(raw) : 50));
          dbPayload = { level };
          wsMsg = { type: 'set_volume', commandId, level, serverTime: nowIso };
          break;
        }
        case 'cec_power': {
          const state = parsed.data.payload?.state === 'standby' ? 'standby' : 'on';
          dbPayload = { state };
          wsMsg = { type: 'cec_power', commandId, state, serverTime: nowIso };
          break;
        }
        case 'reboot':
          wsMsg = { type: 'reboot', commandId, serverTime: nowIso };
          break;
        default:
          wsMsg = { type: 'sync_now', commandId, reason: 'manual_command', serverTime: nowIso };
          break;
      }

      const [created] = await db
        .insert(screenCommands)
        .values({
          id: commandId,
          orgId: user.orgId,
          screenId: existing.id,
          command: parsed.data.command,
          payload: dbPayload,
          status: 'queued',
        })
        .returning();

      const pushed = pushToScreen(existing.id, wsMsg);
      await db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        orgId: user.orgId,
        actorUserId: user.id,
        action: `screen.command.${parsed.data.command}`,
        targetType: 'screen',
        targetId: existing.id,
        metadata: { commandId, pushed, payload: dbPayload },
      });

      return reply.code(201).send({
        command: {
          id: created.id,
          screenId: created.screenId,
          command: created.command as ScreenCommand['command'],
          payload: created.payload,
          status: created.status as ScreenCommand['status'],
          detail: created.detail,
          createdAt: created.createdAt.toISOString(),
          ackedAt: null,
        } satisfies ScreenCommand,
        pushed,
      });
    },
  );

  registerScreenProvisioningRoutes(app);

  app.patch<{ Params: { id: string } }>(
    '/api/v1/screens/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const parsed = UpdateScreenSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid screen update', issues: parsed.error.issues });
      }

      const user = req.authUser!;
      const [existing] = await db
        .select()
        .from(screens)
        .where(and(eq(screens.id, req.params.id), eq(screens.orgId, user.orgId)))
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: 'Screen not found' });
      }

      if (parsed.data.activePlaylistId) {
        const [pl] = await db
          .select({ id: playlists.id })
          .from(playlists)
          .where(and(eq(playlists.id, parsed.data.activePlaylistId), eq(playlists.orgId, user.orgId)))
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
        orgId: user.orgId,
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
    { preHandler: requireAuth },
    async (req, reply) => {
      const user = req.authUser!;
      const [existing] = await db
        .select()
        .from(screens)
        .where(and(eq(screens.id, req.params.id), eq(screens.orgId, user.orgId)))
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
    { preHandler: requireAuth },
    async (req, reply) => {
      const user = req.authUser!;
      const [existing] = await db
        .select()
        .from(screens)
        .where(and(eq(screens.id, req.params.id), eq(screens.orgId, user.orgId)))
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: 'Screen not found' });
      }

      pushToScreen(existing.id, {
        type: 'revoke',
        reason: 'screen_deleted',
        serverTime: new Date().toISOString(),
      });

      await db.delete(screens).where(eq(screens.id, existing.id));
      return { ok: true };
    },
  );
}
