import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import {
  CreateClientOrgSchema,
  UpdateOrgSchema,
  type AgencyClientGrant,
  type Organization,
  type OrgType,
} from '@signage/shared/contracts';
import { db } from '../db/index.js';
import { agencyClientGrants, auditLogs, organizations } from '../db/schema.js';
import { requireRole } from '../middleware/rbac.js';
import { requireAuth } from './auth.js';

function toOrgDto(row: typeof organizations.$inferSelect): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug ?? row.id.slice(0, 8),
    orgType: (row.orgType as OrgType) ?? 'standalone',
    quotas: row.quotas ?? {},
    createdAt: row.createdAt.toISOString(),
  };
}

export async function orgRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/orgs/me', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.authUser!;
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, user.orgId))
      .limit(1);

    if (!org) return reply.code(404).send({ error: 'Organization not found' });

    const grantRows = await db
      .select({
        grant: agencyClientGrants,
        clientName: organizations.name,
        clientSlug: organizations.slug,
      })
      .from(agencyClientGrants)
      .innerJoin(organizations, eq(agencyClientGrants.clientOrgId, organizations.id))
      .where(eq(agencyClientGrants.agencyOrgId, org.id))
      .orderBy(desc(agencyClientGrants.createdAt));

    const grants: AgencyClientGrant[] = grantRows.map((g) => ({
      id: g.grant.id,
      agencyOrgId: g.grant.agencyOrgId,
      clientOrgId: g.grant.clientOrgId,
      clientName: g.clientName,
      clientSlug: g.clientSlug ?? undefined,
      status: g.grant.status as 'active' | 'revoked',
      permissions: g.grant.permissions ?? [],
      createdAt: g.grant.createdAt.toISOString(),
    }));

    return {
      organization: toOrgDto(org),
      grants,
    };
  });

  app.patch(
    '/api/v1/orgs/me',
    { preHandler: [requireAuth, requireRole('owner', 'admin')] },
    async (req, reply) => {
      const parsed = UpdateOrgSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid organization update', issues: parsed.error.issues });
      }
      const user = req.authUser!;
      const [existing] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, user.orgId))
        .limit(1);
      if (!existing) return reply.code(404).send({ error: 'Organization not found' });

      const [updated] = await db
        .update(organizations)
        .set({
          name: parsed.data.name ?? existing.name,
          orgType: parsed.data.orgType ?? existing.orgType,
        })
        .where(eq(organizations.id, existing.id))
        .returning();

      return { organization: toOrgDto(updated) };
    },
  );

  app.post(
    '/api/v1/orgs/clients',
    { preHandler: [requireAuth, requireRole('owner', 'admin')] },
    async (req, reply) => {
      const parsed = CreateClientOrgSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid client org payload', issues: parsed.error.issues });
      }
      const user = req.authUser!;
      const [agency] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, user.orgId))
        .limit(1);

      if (!agency || agency.orgType !== 'agency') {
        return reply.code(403).send({ error: 'Only agency organizations can create client workspaces' });
      }

      const clientId = crypto.randomUUID();
      const baseSlug =
        parsed.data.slug ??
        `${parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${clientId.slice(0, 6)}`;

      const [clientOrg] = await db
        .insert(organizations)
        .values({
          id: clientId,
          name: parsed.data.name,
          slug: baseSlug,
          orgType: 'client',
        })
        .returning();

      const grantId = crypto.randomUUID();
      const [grantRow] = await db
        .insert(agencyClientGrants)
        .values({
          id: grantId,
          agencyOrgId: agency.id,
          clientOrgId: clientId,
          status: 'active',
          permissions: parsed.data.permissions,
        })
        .returning();

      await db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        orgId: agency.id,
        actorUserId: user.id,
        action: 'org.client_created',
        targetType: 'organization',
        targetId: clientId,
        metadata: { name: clientOrg.name, slug: clientOrg.slug },
      });

      const grant: AgencyClientGrant = {
        id: grantRow.id,
        agencyOrgId: grantRow.agencyOrgId,
        clientOrgId: grantRow.clientOrgId,
        clientName: clientOrg.name,
        clientSlug: clientOrg.slug ?? undefined,
        status: 'active',
        permissions: grantRow.permissions ?? [],
        createdAt: grantRow.createdAt.toISOString(),
      };

      return reply.code(201).send({ organization: toOrgDto(clientOrg), grant });
    },
  );

  app.get('/api/v1/orgs/grants', { preHandler: requireAuth }, async (req) => {
    const user = req.authUser!;
    const rows = await db
      .select({
        grant: agencyClientGrants,
        clientName: organizations.name,
        clientSlug: organizations.slug,
      })
      .from(agencyClientGrants)
      .innerJoin(organizations, eq(agencyClientGrants.clientOrgId, organizations.id))
      .where(eq(agencyClientGrants.agencyOrgId, user.orgId))
      .orderBy(desc(agencyClientGrants.createdAt));

    const items: AgencyClientGrant[] = rows.map((r) => ({
      id: r.grant.id,
      agencyOrgId: r.grant.agencyOrgId,
      clientOrgId: r.grant.clientOrgId,
      clientName: r.clientName,
      clientSlug: r.clientSlug ?? undefined,
      status: r.grant.status as 'active' | 'revoked',
      permissions: r.grant.permissions ?? [],
      createdAt: r.grant.createdAt.toISOString(),
    }));
    return { items };
  });

  app.patch<{ Params: { id: string } }>(
    '/api/v1/orgs/grants/:id',
    { preHandler: [requireAuth, requireRole('owner', 'admin')] },
    async (req, reply) => {
      const user = req.authUser!;
      const body = (req.body ?? {}) as { status?: unknown };
      const status = body.status === 'active' || body.status === 'revoked' ? body.status : null;
      if (!status) {
        return reply.code(400).send({ error: 'status must be active or revoked' });
      }

      const [updated] = await db
        .update(agencyClientGrants)
        .set({ status })
        .where(
          and(eq(agencyClientGrants.id, req.params.id), eq(agencyClientGrants.agencyOrgId, user.orgId)),
        )
        .returning();

      if (!updated) return reply.code(404).send({ error: 'Grant not found' });
      return {
        grant: {
          id: updated.id,
          agencyOrgId: updated.agencyOrgId,
          clientOrgId: updated.clientOrgId,
          status: updated.status as 'active' | 'revoked',
          permissions: updated.permissions ?? [],
          createdAt: updated.createdAt.toISOString(),
        } satisfies AgencyClientGrant,
      };
    },
  );
}
