import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { PairClaimRequestSchema, ProvisionScreenRequestSchema } from '@signage/shared';
import { db } from '../db/index.js';
import { auditLogs, pairingCodes, playlists, screens } from '../db/schema.js';
import { generateOpaqueToken, sha256Hex } from '../lib/crypto.js';
import { requireRole } from '../middleware/rbac.js';
import { requireAuth } from './auth.js';
import { toScreenDto } from './screen-dto.js';

export function registerScreenProvisioningRoutes(app: FastifyInstance): void {
  app.post(
    '/api/v1/screens/pair',
    { preHandler: [requireAuth, requireRole('owner', 'admin', 'ops')] },
    async (req, reply) => {
    const parsed = PairClaimRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid pairing request', issues: parsed.error.issues });
    }

    const user = req.authUser!;
    const { code, name, location, timezone, activePlaylistId } = parsed.data;

    const [pairing] = await db
      .select()
      .from(pairingCodes)
      .where(eq(pairingCodes.code, code))
      .limit(1);

    if (!pairing) {
      return reply.code(404).send({ error: 'Pairing code not found' });
    }
    if (pairing.claimedScreenId) {
      return reply.code(409).send({ error: 'Pairing code already claimed' });
    }
    if (pairing.expiresAt.getTime() < Date.now()) {
      return reply.code(410).send({ error: 'Pairing code expired' });
    }

    if (activePlaylistId) {
      const [pl] = await db
        .select({ id: playlists.id })
        .from(playlists)
        .where(and(eq(playlists.id, activePlaylistId), eq(playlists.orgId, user.orgId)))
        .limit(1);
      if (!pl) {
        return reply.code(400).send({ error: 'Assigned playlist not found' });
      }
    }

    const deviceTokenPlain = `dev_${generateOpaqueToken(32)}`;
    const tokenHash = sha256Hex(deviceTokenPlain);
    const screenId = crypto.randomUUID();

    const [created] = await db
      .insert(screens)
      .values({
        id: screenId,
        orgId: user.orgId,
        name,
        location: location ?? null,
        timezone,
        status: 'offline',
        tokenHash,
        activePlaylistId: activePlaylistId ?? null,
      })
      .returning();

    await db
      .update(pairingCodes)
      .set({ claimedScreenId: screenId, deviceTokenPlain })
      .where(eq(pairingCodes.code, code));

    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      orgId: user.orgId,
      actorUserId: user.id,
      action: 'screen.paired',
      targetType: 'screen',
      targetId: screenId,
      metadata: { name, code },
    });

    return reply.code(201).send({ screen: toScreenDto(created, null) });
  });

  app.post(
    '/api/v1/screens/provision',
    { preHandler: [requireAuth, requireRole('owner', 'admin', 'ops')] },
    async (req, reply) => {
    const parsed = ProvisionScreenRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid provision request', issues: parsed.error.issues });
    }

    const user = req.authUser!;
    const { name, location, timezone, activePlaylistId, orientation, city, venueType } = parsed.data;

    let playlistName: string | null = null;
    if (activePlaylistId) {
      const [pl] = await db
        .select({ id: playlists.id, name: playlists.name })
        .from(playlists)
        .where(and(eq(playlists.id, activePlaylistId), eq(playlists.orgId, user.orgId)))
        .limit(1);
      if (!pl) {
        return reply.code(400).send({ error: 'Assigned playlist not found' });
      }
      playlistName = pl.name;
    }

    const deviceTokenPlain = `dev_${generateOpaqueToken(32)}`;
    const tokenHash = sha256Hex(deviceTokenPlain);
    const screenId = crypto.randomUUID();
    const provisionToken = `PROV-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const [created] = await db
      .insert(screens)
      .values({
        id: screenId,
        orgId: user.orgId,
        name,
        location: location ?? null,
        timezone,
        status: 'unpaired',
        tokenHash,
        activePlaylistId: activePlaylistId ?? null,
        orientation,
        city: city ?? null,
        venueType: venueType ?? null,
      })
      .returning();

    await db.insert(pairingCodes).values({
      code: provisionToken,
      claimSecretHash: 'provision',
      claimedScreenId: screenId,
      deviceTokenPlain,
      expiresAt,
    });

    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      orgId: user.orgId,
      actorUserId: user.id,
      action: 'screen.provisioned',
      targetType: 'screen',
      targetId: screenId,
      metadata: { name, provisionToken },
    });

    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 24) || `screen-${screenId.slice(0, 8)}`;

    return reply.code(201).send({
      screen: toScreenDto(created, playlistName),
      provisionToken,
      provisionUrl: `/sim/?slot=${slug}-${screenId.slice(0, 4)}&provision=${encodeURIComponent(provisionToken)}`,
      expiresAt: expiresAt.toISOString(),
    });
  });
}
