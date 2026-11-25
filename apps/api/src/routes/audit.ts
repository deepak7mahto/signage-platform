import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import type { AuditLog } from '@signage/shared';
import { db } from '../db/index.js';
import { auditLogs, users } from '../db/schema.js';
import { getEffectiveOrgId, resolveTenantScope } from '../middleware/tenant-scope.js';
import { requireAuth } from './auth.js';

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/audit-logs', { preHandler: [requireAuth, resolveTenantScope] }, async (req) => {
    const orgId = getEffectiveOrgId(req);
    const q =
      typeof req.query === 'object' && req.query !== null && 'q' in req.query
        ? String((req.query as Record<string, unknown>).q).trim().toLowerCase()
        : '';

    const rows = await db
      .select({
        log: auditLogs,
        actorEmail: users.email,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorUserId, users.id))
      .where(eq(auditLogs.orgId, orgId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(200);

    const items: AuditLog[] = rows
      .filter(({ log, actorEmail }) => {
        if (!q) return true;
        return (
          log.action.toLowerCase().includes(q) ||
          log.targetType.toLowerCase().includes(q) ||
          (actorEmail ?? '').toLowerCase().includes(q) ||
          JSON.stringify(log.metadata ?? {}).toLowerCase().includes(q)
        );
      })
      .map(({ log, actorEmail }) => ({
        id: log.id,
        orgId: log.orgId,
        actorUserId: log.actorUserId,
        actorEmail: actorEmail ?? 'system',
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        metadata: log.metadata,
        createdAt: log.createdAt.toISOString(),
      }));

    return { items };
  });
}
