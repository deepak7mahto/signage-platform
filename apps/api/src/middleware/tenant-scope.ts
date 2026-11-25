import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import type { OrgType } from '@signage/shared/contracts';
import { db } from '../db/index.js';
import { agencyClientGrants, organizations } from '../db/schema.js';

export interface TenantScope {
  effectiveOrgId: string;
  actorOrgId: string;
  isDelegated: boolean;
  orgType: OrgType;
}

declare module 'fastify' {
  interface FastifyRequest {
    tenantScope?: TenantScope;
  }
}

export function getEffectiveOrgId(req: FastifyRequest): string {
  return req.tenantScope?.effectiveOrgId ?? req.authUser!.orgId;
}

export async function resolveTenantScope(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = req.authUser;
  if (!user) {
    await reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  const rawTarget = req.headers['x-target-org-id'];
  const targetOrgId =
    typeof rawTarget === 'string' && rawTarget.trim().length > 0 ? rawTarget.trim() : null;

  if (!targetOrgId || targetOrgId === user.orgId) {
    const [ownOrg] = await db
      .select({ orgType: organizations.orgType })
      .from(organizations)
      .where(eq(organizations.id, user.orgId))
      .limit(1);
    req.tenantScope = {
      effectiveOrgId: user.orgId,
      actorOrgId: user.orgId,
      isDelegated: false,
      orgType: (ownOrg?.orgType as OrgType) ?? 'standalone',
    };
    return;
  }

  const [grant] = await db
    .select()
    .from(agencyClientGrants)
    .where(
      and(
        eq(agencyClientGrants.agencyOrgId, user.orgId),
        eq(agencyClientGrants.clientOrgId, targetOrgId),
        eq(agencyClientGrants.status, 'active'),
      ),
    )
    .limit(1);

  if (!grant) {
    await reply.code(403).send({
      error: 'Forbidden: no active agency grant for target organization',
    });
    return;
  }

  const [targetOrg] = await db
    .select({ orgType: organizations.orgType })
    .from(organizations)
    .where(eq(organizations.id, targetOrgId))
    .limit(1);

  if (!targetOrg) {
    await reply.code(404).send({ error: 'Target organization not found' });
    return;
  }

  req.tenantScope = {
    effectiveOrgId: targetOrgId,
    actorOrgId: user.orgId,
    isDelegated: true,
    orgType: (targetOrg.orgType as OrgType) ?? 'client',
  };
}
