import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { DeviceToServerMessageSchema } from '@signage/shared/contracts';
import { db } from '../db/index.js';
import { screenCommands, screens } from '../db/schema.js';
import { claimPendingCommands } from '../lib/commands.js';
import { ingestPopEvents } from '../lib/pop.js';
import { recordPresenceHeartbeat } from '../lib/presence-bus.js';
import { registerDeviceSocket, unregisterDeviceSocket } from '../ws/gateway.js';

export type DeviceAuthResult =
  | { ok: true; screen: typeof screens.$inferSelect }
  | { ok: false; reason: 'revoked' | 'unauthorized' };

const wsTickets = new Map<string, { screenId: string; expiresAtMs: number }>();

export function issueWsTicket(screenId: string): { ticket: string; expiresAt: string } {
  const nowMs = Date.now();
  for (const [k, v] of wsTickets.entries()) {
    if (v.expiresAtMs < nowMs) wsTickets.delete(k);
  }
  const ticket = `wst_${crypto.randomBytes(18).toString('base64url')}`;
  const expiresAtMs = nowMs + 30_000;
  wsTickets.set(ticket, { screenId, expiresAtMs });
  return { ticket, expiresAt: new Date(expiresAtMs).toISOString() };
}

function consumeWsTicket(ticket: string): string | null {
  const entry = wsTickets.get(ticket);
  wsTickets.delete(ticket);
  if (!entry || entry.expiresAtMs < Date.now()) return null;
  return entry.screenId;
}

export function registerDeviceWsRoute(
  app: FastifyInstance,
  authenticateDeviceToken: (token: string | undefined) => Promise<DeviceAuthResult>,
): void {
  app.get('/ws/device', { websocket: true }, async (socket, req) => {
    const query =
      typeof req.query === 'object' && req.query !== null
        ? (req.query as Record<string, unknown>)
        : {};
    const ticketParam = typeof query.ticket === 'string' ? query.ticket : undefined;
    const queryToken = typeof query.token === 'string' ? query.token : undefined;
    const authHeader = req.headers.authorization;
    const bearerToken =
      authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

    let screen: typeof screens.$inferSelect | null = null;
    if (ticketParam) {
      const screenId = consumeWsTicket(ticketParam);
      if (screenId) {
        const [found] = await db
          .select()
          .from(screens)
          .where(eq(screens.id, screenId))
          .limit(1);
        if (found) {
          if (found.revokedAt !== null || found.status === 'locked') {
            socket.close(4003, 'DEVICE_REVOKED');
            return;
          }
          screen = found;
        }
      }
    } else {
      const authResult = await authenticateDeviceToken(bearerToken || queryToken);
      if (!authResult.ok) {
        socket.close(
          authResult.reason === 'revoked' ? 4003 : 4001,
          authResult.reason === 'revoked' ? 'DEVICE_REVOKED' : 'Unauthorized',
        );
        return;
      }
      screen = authResult.screen;
    }

    if (!screen) {
      socket.close(4001, 'Unauthorized');
      return;
    }

    const screenId = screen.id;
    const genId = registerDeviceSocket(screenId, socket);
    const now = new Date();
    recordPresenceHeartbeat({
      screenId,
      lastSeenAt: now,
    });
    await db
      .update(screens)
      .set({ status: 'online', lastSeenAt: now })
      .where(eq(screens.id, screenId));

    socket.send(
      JSON.stringify({
        type: 'ping',
        serverTime: now.toISOString(),
      }),
    );

    const { wsMessages } = await claimPendingCommands(screenId);
    for (const msg of wsMessages) {
      socket.send(JSON.stringify(msg));
    }

    socket.on('message', async (raw) => {
      try {
        const parsed = DeviceToServerMessageSchema.safeParse(JSON.parse(raw.toString()));
        if (!parsed.success) return;

        if (parsed.data.type === 'heartbeat') {
          recordPresenceHeartbeat({
            screenId,
            appVersion: parsed.data.payload.appVersion ?? null,
            hwInfo: parsed.data.payload.hwInfo ?? null,
            playbackState: parsed.data.payload.playbackState,
            manifestVersion: parsed.data.payload.manifestVersion,
            lastFrameAdvanceAt: parsed.data.payload.lastFrameAdvanceAt,
            capabilities: parsed.data.payload.capabilities,
            lastSeenAt: new Date(),
          });
        } else if (parsed.data.type === 'pong') {
          recordPresenceHeartbeat({
            screenId,
            lastSeenAt: new Date(),
          });
        } else if (parsed.data.type === 'pop_batch') {
          await ingestPopEvents(screen.orgId, screenId, parsed.data.events);
        } else if (parsed.data.type === 'ack' && parsed.data.commandId) {
          await db
            .update(screenCommands)
            .set({
              status: parsed.data.status === 'ok' ? 'executed' : 'failed',
              detail: parsed.data.detail ?? null,
              ackedAt: new Date(),
            })
            .where(
              and(
                eq(screenCommands.id, parsed.data.commandId),
                eq(screenCommands.screenId, screenId),
              ),
            );
        }
      } catch {
        // Ignore malformed device frames
      }
    });

    socket.on('close', async () => {
      const removed = unregisterDeviceSocket(screenId, genId);
      if (!removed) return;
      try {
        await db
          .update(screens)
          .set({ status: 'offline' })
          .where(eq(screens.id, screenId));
      } catch {
        // Ignore shutdown errors
      }
    });
  });
}
