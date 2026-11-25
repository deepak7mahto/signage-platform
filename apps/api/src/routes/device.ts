import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, lt } from 'drizzle-orm';
import {
  ClaimProvisionRequestSchema,
  DeviceToServerMessageSchema,
  HeartbeatRequestSchema,
  PairPollRequestSchema,
  PopBatchRequestSchema,
} from '@signage/shared';
import { db } from '../db/index.js';
import {
  pairingCodes,
  screenCommands,
  screenScreenshots,
  screens,
} from '../db/schema.js';
import {
  generateOpaqueToken,
  generateSixDigitCode,
  sha256Hex,
  signManifest,
} from '../lib/crypto.js';
import { buildDeviceManifest } from '../lib/manifest.js';
import { ingestPopEvents } from '../lib/pop.js';
import { registerDeviceSocket, unregisterDeviceSocket } from '../ws/gateway.js';

declare module 'fastify' {
  interface FastifyRequest {
    deviceScreen?: typeof screens.$inferSelect;
  }
}

async function authenticateDeviceToken(token: string | undefined) {
  if (!token) return null;
  const hash = sha256Hex(token);
  const [screen] = await db
    .select()
    .from(screens)
    .where(eq(screens.tokenHash, hash))
    .limit(1);
  if (!screen || screen.status === 'locked') return null;
  return screen;
}

async function requireDeviceAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = req.headers.authorization;
  const token =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  const screen = await authenticateDeviceToken(token);
  if (!screen) {
    await reply.code(401).send({ error: 'Invalid or revoked device token' });
    return;
  }
  req.deviceScreen = screen;
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/device/pair/request', async (_req, reply) => {
    // Cleanup expired codes opportunistically
    await db.delete(pairingCodes).where(lt(pairingCodes.expiresAt, new Date()));

    let code = generateSixDigitCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await db
        .select({ code: pairingCodes.code })
        .from(pairingCodes)
        .where(eq(pairingCodes.code, code))
        .limit(1);
      if (existing.length === 0) break;
      code = generateSixDigitCode();
    }

    const claimSecret = generateOpaqueToken(24);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.insert(pairingCodes).values({
      code,
      claimSecretHash: sha256Hex(claimSecret),
      expiresAt,
    });

    return reply.code(201).send({
      code,
      claimSecret,
      expiresAt: expiresAt.toISOString(),
    });
  });

  app.post('/api/v1/device/pair/poll', async (req, reply) => {
    const parsed = PairPollRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid poll payload', issues: parsed.error.issues });
    }

    const { code, claimSecret } = parsed.data;
    const [pairing] = await db
      .select()
      .from(pairingCodes)
      .where(eq(pairingCodes.code, code))
      .limit(1);

    if (!pairing) {
      return { status: 'expired' };
    }

    if (pairing.claimSecretHash !== sha256Hex(claimSecret)) {
      return reply.code(403).send({ error: 'Invalid claim secret' });
    }

    if (!pairing.claimedScreenId) {
      if (pairing.expiresAt.getTime() < Date.now()) {
        return { status: 'expired' };
      }
      return { status: 'pending' };
    }

    if (!pairing.deviceTokenPlain) {
      return reply.code(410).send({ error: 'Device token already retrieved' });
    }

    const [screen] = await db
      .select()
      .from(screens)
      .where(eq(screens.id, pairing.claimedScreenId))
      .limit(1);

    const token = pairing.deviceTokenPlain;
    await db
      .update(pairingCodes)
      .set({ deviceTokenPlain: null })
      .where(eq(pairingCodes.code, code));

    return {
      status: 'claimed',
      screenId: pairing.claimedScreenId,
      screenName: screen?.name,
      deviceToken: token,
    };
  });

  // Single-use claim for CMS-pre-provisioned displays (zero public pairing code exposed)
  app.post('/api/v1/device/provision/claim', async (req, reply) => {
    const parsed = ClaimProvisionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid provision token', issues: parsed.error.issues });
    }

    const token = parsed.data.provisionToken.trim();
    const [claimed] = await db
      .delete(pairingCodes)
      .where(and(eq(pairingCodes.code, token), eq(pairingCodes.claimSecretHash, 'provision')))
      .returning();

    if (!claimed || !claimed.claimedScreenId || !claimed.deviceTokenPlain) {
      return reply.code(404).send({ error: 'Provision token not found or already claimed' });
    }

    if (claimed.expiresAt.getTime() < Date.now()) {
      return reply.code(410).send({ error: 'Provision token expired' });
    }

    const [screen] = await db
      .select()
      .from(screens)
      .where(eq(screens.id, claimed.claimedScreenId))
      .limit(1);

    if (!screen) {
      return reply.code(404).send({ error: 'Provisioned screen not found' });
    }

    return {
      screenId: screen.id,
      screenName: screen.name,
      deviceToken: claimed.deviceTokenPlain,
    };
  });

  app.get('/api/v1/device/manifest', { preHandler: requireDeviceAuth }, async (req, reply) => {
    const screen = req.deviceScreen!;
    const manifest = await buildDeviceManifest(screen);

    const payloadJson = JSON.stringify(manifest);
    const { signatureB64, publicKeyB64 } = signManifest(payloadJson);

    reply.header('X-Manifest-Signature', signatureB64);
    reply.header('X-Manifest-Public-Key', publicKeyB64);
    return manifest;
  });

  app.post('/api/v1/device/heartbeat', { preHandler: requireDeviceAuth }, async (req, reply) => {
    const parsed = HeartbeatRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid heartbeat payload', issues: parsed.error.issues });
    }

    const screen = req.deviceScreen!;
    await db
      .update(screens)
      .set({
        status: 'online',
        appVersion: parsed.data.appVersion ?? screen.appVersion,
        hwInfo: parsed.data.hwInfo ?? screen.hwInfo,
        lastSeenAt: new Date(),
      })
      .where(eq(screens.id, screen.id));

    return {
      ok: true,
      serverTime: new Date().toISOString(),
    };
  });

  app.post('/api/v1/device/pop/batch', { preHandler: requireDeviceAuth }, async (req, reply) => {
    const parsed = PopBatchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid PoP batch', issues: parsed.error.issues });
    }
    const screen = req.deviceScreen!;
    const inserted = await ingestPopEvents(screen.orgId, screen.id, parsed.data.events);
    return {
      ok: true,
      inserted,
      serverTime: new Date().toISOString(),
    };
  });

  app.post<{ Params: { commandId: string } }>(
    '/api/v1/device/screenshots/:commandId/complete',
    { preHandler: requireDeviceAuth },
    async (req, reply) => {
      const screen = req.deviceScreen!;
      const [cmd] = await db
        .select()
        .from(screenCommands)
        .where(
          and(
            eq(screenCommands.id, req.params.commandId),
            eq(screenCommands.screenId, screen.id),
            eq(screenCommands.command, 'take_screenshot'),
          ),
        )
        .limit(1);

      if (!cmd) {
        return reply.code(404).send({ error: 'Screenshot command not found' });
      }

      const objectKey =
        cmd.payload && typeof cmd.payload.objectKey === 'string'
          ? cmd.payload.objectKey
          : `${screen.orgId}/screenshots/${screen.id}/${cmd.id}.jpg`;

      const screenshotId = crypto.randomUUID();
      await db.insert(screenScreenshots).values({
        id: screenshotId,
        orgId: screen.orgId,
        screenId: screen.id,
        objectKey,
      });

      await db
        .update(screenCommands)
        .set({
          status: 'acked',
          detail: 'Screenshot uploaded',
          ackedAt: new Date(),
        })
        .where(eq(screenCommands.id, cmd.id));

      return { ok: true, screenshotId };
    },
  );

  app.get('/ws/device', { websocket: true }, async (socket, req) => {
    const queryToken =
      typeof req.query === 'object' && req.query !== null && 'token' in req.query
        ? String((req.query as Record<string, unknown>).token)
        : undefined;
    const authHeader = req.headers.authorization;
    const bearerToken =
      authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

    const screen = await authenticateDeviceToken(queryToken || bearerToken);
    if (!screen) {
      socket.close(4001, 'Unauthorized');
      return;
    }

    registerDeviceSocket(screen.id, socket);
    await db
      .update(screens)
      .set({ status: 'online', lastSeenAt: new Date() })
      .where(eq(screens.id, screen.id));

    socket.send(
      JSON.stringify({
        type: 'ping',
        serverTime: new Date().toISOString(),
      }),
    );

    socket.on('message', async (raw) => {
      try {
        const parsed = DeviceToServerMessageSchema.safeParse(JSON.parse(raw.toString()));
        if (!parsed.success) return;

        if (parsed.data.type === 'heartbeat') {
          await db
            .update(screens)
            .set({
              status: 'online',
              appVersion: parsed.data.payload.appVersion ?? screen.appVersion,
              hwInfo: parsed.data.payload.hwInfo ?? screen.hwInfo,
              lastSeenAt: new Date(),
            })
            .where(eq(screens.id, screen.id));
        } else if (parsed.data.type === 'pong') {
          await db
            .update(screens)
            .set({ status: 'online', lastSeenAt: new Date() })
            .where(eq(screens.id, screen.id));
        } else if (parsed.data.type === 'pop_batch') {
          await ingestPopEvents(screen.orgId, screen.id, parsed.data.events);
        } else if (parsed.data.type === 'ack' && parsed.data.commandId) {
          await db
            .update(screenCommands)
            .set({
              status: parsed.data.status === 'ok' ? 'acked' : 'failed',
              detail: parsed.data.detail ?? null,
              ackedAt: new Date(),
            })
            .where(
              and(
                eq(screenCommands.id, parsed.data.commandId),
                eq(screenCommands.screenId, screen.id),
              ),
            );
        }
      } catch {
        // Ignore malformed device frames
      }
    });

    socket.on('close', async () => {
      unregisterDeviceSocket(screen.id, socket);
      try {
        await db
          .update(screens)
          .set({ status: 'offline' })
          .where(eq(screens.id, screen.id));
      } catch {
        // Ignore shutdown errors
      }
    });
  });
}
