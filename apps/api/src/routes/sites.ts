import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import {
  CreateConfigProfileSchema,
  CreateSiteSchema,
  UpdateSiteSchema,
  type DeviceConfigProfile,
  type Site,
} from '@signage/shared/contracts';
import { db } from '../db/index.js';
import { deviceConfigProfiles, sites } from '../db/schema.js';
import { requireRole } from '../middleware/rbac.js';
import { getEffectiveOrgId, resolveTenantScope } from '../middleware/tenant-scope.js';
import { requireAuth } from './auth.js';

function toSiteDto(row: typeof sites.$inferSelect): Site {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    timezone: row.timezone,
    lanCacheUrl: row.lanCacheUrl ?? null,
    alertPolicy: row.alertPolicy ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toProfileDto(row: typeof deviceConfigProfiles.$inferSelect): DeviceConfigProfile {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    config: row.config ?? {},
    createdAt: row.createdAt.toISOString(),
  };
}

export async function siteRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/sites', { preHandler: [requireAuth, resolveTenantScope] }, async (req) => {
    const orgId = getEffectiveOrgId(req);
    const rows = await db
      .select()
      .from(sites)
      .where(eq(sites.orgId, orgId))
      .orderBy(desc(sites.createdAt));
    return { items: rows.map(toSiteDto) };
  });

  app.post(
    '/api/v1/sites',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'ops')] },
    async (req, reply) => {
      const parsed = CreateSiteSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid site payload', issues: parsed.error.issues });
      }
      const orgId = getEffectiveOrgId(req);
      const [created] = await db
        .insert(sites)
        .values({
          id: crypto.randomUUID(),
          orgId,
          name: parsed.data.name,
          timezone: parsed.data.timezone,
          lanCacheUrl: parsed.data.lanCacheUrl ?? null,
          alertPolicy: parsed.data.alertPolicy ?? null,
        })
        .returning();
      return reply.code(201).send({ site: toSiteDto(created) });
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/sites/:id',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'ops')] },
    async (req, reply) => {
      const parsed = UpdateSiteSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid site update', issues: parsed.error.issues });
      }
      const orgId = getEffectiveOrgId(req);
      const [existing] = await db
        .select()
        .from(sites)
        .where(and(eq(sites.id, req.params.id), eq(sites.orgId, orgId)))
        .limit(1);
      if (!existing) return reply.code(404).send({ error: 'Site not found' });

      const [updated] = await db
        .update(sites)
        .set({
          name: parsed.data.name ?? existing.name,
          timezone: parsed.data.timezone ?? existing.timezone,
          lanCacheUrl:
            parsed.data.lanCacheUrl === undefined ? existing.lanCacheUrl : parsed.data.lanCacheUrl,
          alertPolicy:
            parsed.data.alertPolicy === undefined ? existing.alertPolicy : parsed.data.alertPolicy,
        })
        .where(eq(sites.id, existing.id))
        .returning();
      return { site: toSiteDto(updated) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/sites/:id',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin')] },
    async (req, reply) => {
      const orgId = getEffectiveOrgId(req);
      const [deleted] = await db
        .delete(sites)
        .where(and(eq(sites.id, req.params.id), eq(sites.orgId, orgId)))
        .returning({ id: sites.id });
      if (!deleted) return reply.code(404).send({ error: 'Site not found' });
      return { ok: true };
    },
  );

  app.get('/api/v1/config-profiles', { preHandler: [requireAuth, resolveTenantScope] }, async (req) => {
    const orgId = getEffectiveOrgId(req);
    const rows = await db
      .select()
      .from(deviceConfigProfiles)
      .where(eq(deviceConfigProfiles.orgId, orgId))
      .orderBy(desc(deviceConfigProfiles.createdAt));
    return { items: rows.map(toProfileDto) };
  });

  app.post(
    '/api/v1/config-profiles',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'ops')] },
    async (req, reply) => {
      const parsed = CreateConfigProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid profile payload', issues: parsed.error.issues });
      }
      const orgId = getEffectiveOrgId(req);
      const [created] = await db
        .insert(deviceConfigProfiles)
        .values({
          id: crypto.randomUUID(),
          orgId,
          name: parsed.data.name,
          config: parsed.data.config,
        })
        .returning();
      return reply.code(201).send({ profile: toProfileDto(created) });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/config-profiles/:id',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin')] },
    async (req, reply) => {
      const orgId = getEffectiveOrgId(req);
      const [deleted] = await db
        .delete(deviceConfigProfiles)
        .where(and(eq(deviceConfigProfiles.id, req.params.id), eq(deviceConfigProfiles.orgId, orgId)))
        .returning({ id: deviceConfigProfiles.id });
      if (!deleted) return reply.code(404).send({ error: 'Config profile not found' });
      return { ok: true };
    },
  );
}
