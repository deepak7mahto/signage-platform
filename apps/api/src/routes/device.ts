import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, lt } from 'drizzle-orm';
import {
  ClaimProvisionRequestSchema,
  HeartbeatRequestSchema,
  PairPollRequestSchema,
  PopBatchRequestSchema,
} from '@signage/shared/contracts';
import { db } from '../db/index.js';
import {
  pairingCodes,
  screenCommands,
  screenScreenshots,
  screens,
} from '../db/schema.js';
import { claimPendingCommands } from '../lib/commands.js';
import {
  generateOpaqueToken,
  generateSixDigitCode,
  sha256Hex,
} from '../lib/crypto.js';
import { buildSignedManifest } from '../lib/manifest.js';
import { ingestPopEvents } from '../lib/pop.js';
import { recordPresenceHeartbeat } from '../lib/presence-bus.js';
import {
  issueWsTicket,
  registerDeviceWsRoute,
  type DeviceAuthResult,
} from './device-ws.js';

declare module 'fastify' {
  interface FastifyRequest {
    deviceScreen?: typeof screens.$inferSelect;
  }
}

async function authenticateDeviceToken(token: string | undefined): Promise<DeviceAuthResult> {
  if (!token) return { ok: false, reason: 'unauthorized' };
  const hash = sha256Hex(token);
  const [screen] = await db
    .select()
    .from(screens)
    .where(eq(screens.tokenHash, hash))
    .limit(1);
  if (!screen) return { ok: false, reason: 'unauthorized' };
  if (screen.revokedAt !== null || screen.status === 'locked') {
    return { ok: false, reason: 'revoked' };
  }
  return { ok: true, screen };
}

async function requireDeviceAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = req.headers.authorization;
  const token =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  const auth = await authenticateDeviceToken(token);
  if (!auth.ok) {
    if (auth.reason === 'revoked') {
      await reply.code(410).send({
        errorCode: 'DEVICE_REVOKED',
        message: 'Device credentials have been revoked',
      });
      return;
    }
    await reply.code(401).send({ error: 'Invalid device token' });
    return;
  }
  req.deviceScreen = auth.screen;
}

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/device/pair/request',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (_req, reply) => {
      await db.delete(pairingCodes).where(lt(pairingCodes.expiresAt, new Date()));

      let code = generateSixDigitCode();
      for (let attempt = 0; attempt < 5; attempt += 1) {
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
    },
  );

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

    if (!screen || screen.revokedAt !== null) {
      return reply.code(404).send({ error: 'Provisioned screen not found' });
    }

    return {
      screenId: screen.id,
      screenName: screen.name,
      deviceToken: claimed.deviceTokenPlain,
    };
  });

  app.post('/api/v1/device/ws-ticket', { preHandler: requireDeviceAuth }, async (req, reply) => {
    const screen = req.deviceScreen!;
    return reply.code(201).send(issueWsTicket(screen.id));
  });

  app.post('/api/v1/device/commands/claim', { preHandler: requireDeviceAuth }, async (req) => {
    const screen = req.deviceScreen!;
    const { commands } = await claimPendingCommands(screen.id);
    return {
      commands,
      serverTime: new Date().toISOString(),
    };
  });

  app.get('/api/v1/device/manifest', { preHandler: requireDeviceAuth }, async (req, reply) => {
    const screen = req.deviceScreen!;
    const schemaHeader = req.headers['x-manifest-schema'];
    const schemaVersion = schemaHeader === '2' ? 2 : 1;
    const envelope = await buildSignedManifest(screen, schemaVersion);

    reply.header('ETag', envelope.etag);
    reply.header('X-Server-Time', envelope.serverTime);
    reply.header('X-Manifest-Key-Id', envelope.kid);
    reply.header('X-Manifest-Signature', envelope.signatureB64);
    reply.header('X-Manifest-Public-Key', envelope.publicKeyB64);

    if (req.headers['if-none-match'] === envelope.etag) {
      return reply.code(304).send();
    }

    reply.type('application/json; charset=utf-8');
    return envelope.bodyJson;
  });

  app.post('/api/v1/device/heartbeat', { preHandler: requireDeviceAuth }, async (req, reply) => {
    const parsed = HeartbeatRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid heartbeat payload', issues: parsed.error.issues });
    }

    const screen = req.deviceScreen!;
    const now = new Date();
    const shouldImmediateDbSync =
      screen.status !== 'online' ||
      (parsed.data.playbackState !== undefined && parsed.data.playbackState !== screen.playbackState);

    recordPresenceHeartbeat({
      screenId: screen.id,
      appVersion: parsed.data.appVersion ?? screen.appVersion,
      hwInfo: parsed.data.hwInfo ?? screen.hwInfo,
      playbackState: parsed.data.playbackState,
      manifestVersion: parsed.data.manifestVersion,
      lastFrameAdvanceAt: parsed.data.lastFrameAdvanceAt,
      capabilities: parsed.data.capabilities,
      lastSeenAt: now,
    });

    if (shouldImmediateDbSync) {
      await db
        .update(screens)
        .set({
          status: 'online',
          appVersion: parsed.data.appVersion ?? screen.appVersion,
          hwInfo: parsed.data.hwInfo ?? screen.hwInfo,
          playbackState: parsed.data.playbackState ?? screen.playbackState,
          manifestVersion: parsed.data.manifestVersion ?? screen.manifestVersion,
          lastFrameAdvanceAt: parsed.data.lastFrameAdvanceAt
            ? new Date(parsed.data.lastFrameAdvanceAt)
            : screen.lastFrameAdvanceAt,
          capabilities: parsed.data.capabilities ?? screen.capabilities,
          lastSeenAt: now,
        })
        .where(eq(screens.id, screen.id));
    }

    return {
      ok: true,
      serverTime: now.toISOString(),
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
          status: 'executed',
          detail: 'Screenshot uploaded',
          ackedAt: new Date(),
        })
        .where(eq(screenCommands.id, cmd.id));

      return { ok: true, screenshotId };
    },
  );

  registerDeviceWsRoute(app, authenticateDeviceToken);
}
