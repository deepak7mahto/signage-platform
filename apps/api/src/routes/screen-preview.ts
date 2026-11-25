import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { HeartbeatRequestSchema, PopBatchRequestSchema } from '@signage/shared/contracts';
import { db } from '../db/index.js';
import { screens } from '../db/schema.js';
import { buildDeviceManifest } from '../lib/manifest.js';
import { requireAuth } from './auth.js';

export function registerScreenPreviewRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>(
    '/api/v1/screens/:id/preview-manifest',
    { preHandler: requireAuth },
    async (req, reply) => {
      const user = req.authUser!;
      const [screen] = await db
        .select()
        .from(screens)
        .where(and(eq(screens.id, req.params.id), eq(screens.orgId, user.orgId), isNull(screens.revokedAt)))
        .limit(1);

      if (!screen) return reply.code(404).send({ error: 'Screen not found' });
      return buildDeviceManifest(screen);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/screens/:id/preview-pop',
    { preHandler: requireAuth },
    async (req, reply) => {
      const parsed = PopBatchRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid PoP batch', issues: parsed.error.issues });
      }
      const user = req.authUser!;
      const [existing] = await db
        .select({ id: screens.id })
        .from(screens)
        .where(and(eq(screens.id, req.params.id), eq(screens.orgId, user.orgId), isNull(screens.revokedAt)))
        .limit(1);
      if (!existing) return reply.code(404).send({ error: 'Screen not found' });

      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/screens/:id/preview-heartbeat',
    { preHandler: requireAuth },
    async (req, reply) => {
      const parsed = HeartbeatRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid heartbeat payload', issues: parsed.error.issues });
      }
      const user = req.authUser!;
      const [existing] = await db
        .select({ id: screens.id })
        .from(screens)
        .where(and(eq(screens.id, req.params.id), eq(screens.orgId, user.orgId), isNull(screens.revokedAt)))
        .limit(1);
      if (!existing) return reply.code(404).send({ error: 'Screen not found' });

      return reply.code(204).send();
    },
  );
}
