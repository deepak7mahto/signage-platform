import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import {
  CreateDataFeedSchema,
  UpdateDataFeedSchema,
  type DataFeed,
} from '@signage/shared/contracts';
import { isPrivateOrBlockedHost } from '@signage/shared/creatives';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { dataFeeds } from '../db/schema.js';
import { requireRole } from '../middleware/rbac.js';
import { getEffectiveOrgId, resolveTenantScope } from '../middleware/tenant-scope.js';
import { requireAuth } from './auth.js';

function toFeedDto(row: typeof dataFeeds.$inferSelect): DataFeed {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    sourceUrl: row.sourceUrl,
    pollIntervalSec: row.pollIntervalSec,
    headers: row.headers ?? {},
    lastPayload: row.lastPayload ?? null,
    lastFetchedAt: row.lastFetchedAt ? row.lastFetchedAt.toISOString() : null,
    lastError: row.lastError ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function refreshFeedRow(
  feedRow: typeof dataFeeds.$inferSelect,
): Promise<typeof dataFeeds.$inferSelect> {
  const allowHttpInDev = config.NODE_ENV !== 'production';
  if (isPrivateOrBlockedHost(feedRow.sourceUrl, { allowHttpInDev })) {
    const [updated] = await db
      .update(dataFeeds)
      .set({ lastError: 'Blocked private or disallowed feed URL', lastFetchedAt: new Date() })
      .where(eq(dataFeeds.id, feedRow.id))
      .returning();
    return updated ?? feedRow;
  }

  try {
    const res = await fetch(feedRow.sourceUrl, {
      headers: { Accept: 'application/json', ...(feedRow.headers ?? {}) },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const [updated] = await db
        .update(dataFeeds)
        .set({ lastError: `HTTP ${res.status}`, lastFetchedAt: new Date() })
        .where(eq(dataFeeds.id, feedRow.id))
        .returning();
      return updated ?? feedRow;
    }
    const payload = (await res.json()) as unknown;
    const [updated] = await db
      .update(dataFeeds)
      .set({ lastPayload: payload, lastError: null, lastFetchedAt: new Date() })
      .where(eq(dataFeeds.id, feedRow.id))
      .returning();
    return updated ?? feedRow;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Feed fetch failed';
    const [updated] = await db
      .update(dataFeeds)
      .set({ lastError: msg, lastFetchedAt: new Date() })
      .where(eq(dataFeeds.id, feedRow.id))
      .returning();
    return updated ?? feedRow;
  }
}

export async function feedRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/feeds', { preHandler: [requireAuth, resolveTenantScope] }, async (req) => {
    const orgId = getEffectiveOrgId(req);
    const rows = await db
      .select()
      .from(dataFeeds)
      .where(eq(dataFeeds.orgId, orgId))
      .orderBy(desc(dataFeeds.createdAt));
    return { items: rows.map(toFeedDto) };
  });

  app.post(
    '/api/v1/feeds',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'ops', 'editor')] },
    async (req, reply) => {
      const parsed = CreateDataFeedSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid feed payload', issues: parsed.error.issues });
      }
      const allowHttpInDev = config.NODE_ENV !== 'production';
      if (isPrivateOrBlockedHost(parsed.data.sourceUrl, { allowHttpInDev })) {
        return reply.code(400).send({ error: 'Feed sourceUrl targets a private or disallowed host' });
      }
      const orgId = getEffectiveOrgId(req);
      const [created] = await db
        .insert(dataFeeds)
        .values({
          id: crypto.randomUUID(),
          orgId,
          name: parsed.data.name,
          sourceUrl: parsed.data.sourceUrl,
          pollIntervalSec: parsed.data.pollIntervalSec,
          headers: parsed.data.headers,
        })
        .returning();
      return reply.code(201).send({ feed: toFeedDto(created) });
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/feeds/:id',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'ops', 'editor')] },
    async (req, reply) => {
      const parsed = UpdateDataFeedSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid feed update', issues: parsed.error.issues });
      }
      if (parsed.data.sourceUrl) {
        const allowHttpInDev = config.NODE_ENV !== 'production';
        if (isPrivateOrBlockedHost(parsed.data.sourceUrl, { allowHttpInDev })) {
          return reply.code(400).send({ error: 'Feed sourceUrl targets a private or disallowed host' });
        }
      }
      const orgId = getEffectiveOrgId(req);
      const [existing] = await db
        .select()
        .from(dataFeeds)
        .where(and(eq(dataFeeds.id, req.params.id), eq(dataFeeds.orgId, orgId)))
        .limit(1);
      if (!existing) return reply.code(404).send({ error: 'Feed not found' });

      const [updated] = await db
        .update(dataFeeds)
        .set({
          name: parsed.data.name ?? existing.name,
          sourceUrl: parsed.data.sourceUrl ?? existing.sourceUrl,
          pollIntervalSec: parsed.data.pollIntervalSec ?? existing.pollIntervalSec,
          headers: parsed.data.headers ?? existing.headers,
        })
        .where(eq(dataFeeds.id, existing.id))
        .returning();
      return { feed: toFeedDto(updated) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/feeds/:id/refresh',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'ops', 'editor')] },
    async (req, reply) => {
      const orgId = getEffectiveOrgId(req);
      const [existing] = await db
        .select()
        .from(dataFeeds)
        .where(and(eq(dataFeeds.id, req.params.id), eq(dataFeeds.orgId, orgId)))
        .limit(1);
      if (!existing) return reply.code(404).send({ error: 'Feed not found' });
      const updated = await refreshFeedRow(existing);
      return { feed: toFeedDto(updated) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/feeds/:id',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'ops')] },
    async (req, reply) => {
      const orgId = getEffectiveOrgId(req);
      const [deleted] = await db
        .delete(dataFeeds)
        .where(and(eq(dataFeeds.id, req.params.id), eq(dataFeeds.orgId, orgId)))
        .returning({ id: dataFeeds.id });
      if (!deleted) return reply.code(404).send({ error: 'Feed not found' });
      return { ok: true };
    },
  );
}
