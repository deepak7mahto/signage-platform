import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { TotpCodeRequestSchema } from '@signage/shared/contracts';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { buildOtpAuthUri, generateTotpSecret, verifyTotpCode } from '../lib/totp.js';
import { requireAuth } from './auth.js';

export async function auth2faRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/auth/2fa/status', { preHandler: requireAuth }, async (req, reply) => {
    const [user] = await db
      .select({ totpEnabled: users.totpEnabled })
      .from(users)
      .where(eq(users.id, req.authUser!.id))
      .limit(1);
    if (!user) return reply.code(404).send({ error: 'User not found' });
    return { enabled: user.totpEnabled };
  });

  app.post('/api/v1/auth/2fa/setup', { preHandler: requireAuth }, async (req, reply) => {
    const [user] = await db.select().from(users).where(eq(users.id, req.authUser!.id)).limit(1);
    if (!user) return reply.code(404).send({ error: 'User not found' });

    const secret = generateTotpSecret();
    await db
      .update(users)
      .set({ totpSecret: secret, totpEnabled: false })
      .where(eq(users.id, user.id));

    return {
      secret,
      otpauthUri: buildOtpAuthUri(user.email, secret),
    };
  });

  app.post('/api/v1/auth/2fa/enable', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = TotpCodeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Enter a valid 6-digit TOTP code' });
    }
    const [user] = await db.select().from(users).where(eq(users.id, req.authUser!.id)).limit(1);
    if (!user || !user.totpSecret) {
      return reply.code(400).send({ error: 'Call 2FA setup first before enabling' });
    }
    if (!verifyTotpCode(user.totpSecret, parsed.data.code)) {
      return reply.code(401).send({ error: 'Invalid 6-digit TOTP verification code' });
    }
    await db.update(users).set({ totpEnabled: true }).where(eq(users.id, user.id));
    return { enabled: true };
  });

  app.post('/api/v1/auth/2fa/disable', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = TotpCodeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Enter a valid 6-digit TOTP code' });
    }
    const [user] = await db.select().from(users).where(eq(users.id, req.authUser!.id)).limit(1);
    if (!user) return reply.code(404).send({ error: 'User not found' });
    if (user.totpEnabled && user.totpSecret && !verifyTotpCode(user.totpSecret, parsed.data.code)) {
      return reply.code(401).send({ error: 'Invalid 6-digit TOTP verification code' });
    }
    await db
      .update(users)
      .set({ totpEnabled: false, totpSecret: null })
      .where(eq(users.id, user.id));
    return { enabled: false };
  });
}
