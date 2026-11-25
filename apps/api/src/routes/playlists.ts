import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  CreatePlaylistSchema,
  UpdatePlaylistSchema,
  isBinaryMediaType,
  type Playlist,
  type PlaylistItem,
} from '@signage/shared';
import { db } from '../db/index.js';
import { auditLogs, mediaAssets, playlistItems, playlists } from '../db/schema.js';
import { createPresignedGetUrl } from '../lib/s3.js';
import { pushToScreensUsingPlaylist } from '../ws/gateway.js';
import { requireRole } from '../middleware/rbac.js';
import { getEffectiveOrgId, resolveTenantScope } from '../middleware/tenant-scope.js';
import { requireAuth } from './auth.js';

async function loadPlaylistWithItems(playlistRow: typeof playlists.$inferSelect): Promise<Playlist> {
  const rows = await db
    .select({
      item: playlistItems,
      asset: mediaAssets,
    })
    .from(playlistItems)
    .innerJoin(mediaAssets, eq(playlistItems.mediaAssetId, mediaAssets.id))
    .where(eq(playlistItems.playlistId, playlistRow.id))
    .orderBy(asc(playlistItems.sortOrder));

  const items: PlaylistItem[] = await Promise.all(
    rows.map(async ({ item, asset }) => {
      const isBinary = isBinaryMediaType(asset.type);
      const previewUrl = isBinary
        ? asset.status === 'ready'
          ? await createPresignedGetUrl(asset.objectKey, 3600)
          : null
        : typeof asset.appConfig?.url === 'string'
          ? asset.appConfig.url
          : null;
      return {
        id: item.id,
        mediaAssetId: item.mediaAssetId,
        sortOrder: item.sortOrder,
        durationMs: item.durationMs,
        asset: {
          id: asset.id,
          orgId: asset.orgId,
          title: asset.title,
          type: asset.type,
          mimeType: asset.mimeType,
          status: asset.status as 'uploading' | 'processing' | 'ready' | 'failed',
          approvalStatus: (asset.approvalStatus as 'pending' | 'approved' | 'rejected') ?? 'approved',
          objectKey: asset.objectKey,
          sizeBytes: Number(asset.sizeBytes),
          sha256: asset.sha256,
          durationMs: asset.durationMs,
          appConfig: asset.appConfig ?? null,
          previewUrl,
          createdAt: asset.createdAt.toISOString(),
        },
      };
    }),
  );

  return {
    id: playlistRow.id,
    orgId: playlistRow.orgId,
    name: playlistRow.name,
    description: playlistRow.description,
    version: playlistRow.version,
    items,
    createdAt: playlistRow.createdAt.toISOString(),
    updatedAt: playlistRow.updatedAt.toISOString(),
  };
}

export async function playlistRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/playlists', { preHandler: [requireAuth, resolveTenantScope] }, async (req) => {
    const orgId = getEffectiveOrgId(req);
    const rows = await db
      .select()
      .from(playlists)
      .where(eq(playlists.orgId, orgId))
      .orderBy(desc(playlists.updatedAt));

    const items = await Promise.all(rows.map((row) => loadPlaylistWithItems(row)));
    return { items };
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/playlists/:id',
    { preHandler: [requireAuth, resolveTenantScope] },
    async (req, reply) => {
      const orgId = getEffectiveOrgId(req);
      const [row] = await db
        .select()
        .from(playlists)
        .where(and(eq(playlists.id, req.params.id), eq(playlists.orgId, orgId)))
        .limit(1);

      if (!row) {
        return reply.code(404).send({ error: 'Playlist not found' });
      }

      return { playlist: await loadPlaylistWithItems(row) };
    },
  );

  app.post(
    '/api/v1/playlists',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'editor')] },
    async (req, reply) => {
    const parsed = CreatePlaylistSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid playlist payload', issues: parsed.error.issues });
    }

    const user = req.authUser!;
    const orgId = getEffectiveOrgId(req);
    const playlistId = crypto.randomUUID();

    if (parsed.data.items.length > 0) {
      const assetIds = [...new Set(parsed.data.items.map((i) => i.mediaAssetId))];
      const ownedAssets = await db
        .select({ id: mediaAssets.id })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.orgId, orgId), inArray(mediaAssets.id, assetIds)));
      if (ownedAssets.length !== assetIds.length) {
        return reply.code(400).send({ error: 'One or more media assets do not belong to org' });
      }
    }

    const [created] = await db
      .insert(playlists)
      .values({
        id: playlistId,
        orgId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        version: 1,
      })
      .returning();

    if (parsed.data.items.length > 0) {
      await db.insert(playlistItems).values(
        parsed.data.items.map((item, idx) => ({
          id: crypto.randomUUID(),
          playlistId,
          mediaAssetId: item.mediaAssetId,
          sortOrder: idx,
          durationMs: item.durationMs,
        })),
      );
    }

    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      orgId,
      actorUserId: user.id,
      action: 'playlist.created',
      targetType: 'playlist',
      targetId: playlistId,
      metadata: { name: created.name },
    });

    return reply.code(201).send({ playlist: await loadPlaylistWithItems(created) });
  });

  app.put<{ Params: { id: string } }>(
    '/api/v1/playlists/:id',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'editor')] },
    async (req, reply) => {
      const parsed = UpdatePlaylistSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid playlist payload', issues: parsed.error.issues });
      }

      const user = req.authUser!;
      const orgId = getEffectiveOrgId(req);
      const [existing] = await db
        .select()
        .from(playlists)
        .where(and(eq(playlists.id, req.params.id), eq(playlists.orgId, orgId)))
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: 'Playlist not found' });
      }

      if (parsed.data.items && parsed.data.items.length > 0) {
        const assetIds = [...new Set(parsed.data.items.map((i) => i.mediaAssetId))];
        const ownedAssets = await db
          .select({ id: mediaAssets.id })
          .from(mediaAssets)
          .where(and(eq(mediaAssets.orgId, orgId), inArray(mediaAssets.id, assetIds)));
        if (ownedAssets.length !== assetIds.length) {
          return reply.code(400).send({ error: 'One or more media assets do not belong to org' });
        }
      }

      const [updated] = await db
        .update(playlists)
        .set({
          name: parsed.data.name ?? existing.name,
          description:
            parsed.data.description === undefined ? existing.description : parsed.data.description,
          version: sql`${playlists.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(playlists.id, existing.id))
        .returning();

      if (parsed.data.items !== undefined) {
        await db.delete(playlistItems).where(eq(playlistItems.playlistId, existing.id));
        if (parsed.data.items.length > 0) {
          await db.insert(playlistItems).values(
            parsed.data.items.map((item, idx) => ({
              id: crypto.randomUUID(),
              playlistId: existing.id,
              mediaAssetId: item.mediaAssetId,
              sortOrder: idx,
              durationMs: item.durationMs,
            })),
          );
        }
      }

      await db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        orgId,
        actorUserId: user.id,
        action: 'playlist.updated',
        targetType: 'playlist',
        targetId: existing.id,
        metadata: { version: updated.version },
      });

      await pushToScreensUsingPlaylist(existing.id, `playlist_v${updated.version}`);

      return { playlist: await loadPlaylistWithItems(updated) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/playlists/:id',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'editor')] },
    async (req, reply) => {
      const orgId = getEffectiveOrgId(req);
      const [existing] = await db
        .select()
        .from(playlists)
        .where(and(eq(playlists.id, req.params.id), eq(playlists.orgId, orgId)))
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: 'Playlist not found' });
      }

      await db.delete(playlists).where(eq(playlists.id, existing.id));
      return { ok: true };
    },
  );
}
