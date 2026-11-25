import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import {
  CreateAppAssetSchema,
  UpdateMediaAssetSchema,
  isBinaryMediaType,
  validateCreativeConfig,
  type CreativeConfig,
  type MediaAsset,
} from '@signage/shared';
import { db } from '../db/index.js';
import { auditLogs, mediaAssets, playlistItems } from '../db/schema.js';
import { sha256Hex } from '../lib/crypto.js';
import { createPresignedGetUrl } from '../lib/s3.js';
import { pushToScreensUsingPlaylist } from '../ws/gateway.js';
import { requireAuth } from './auth.js';

export function registerMediaAppRoutes(
  app: FastifyInstance,
  toMediaAssetDto: (
    row: typeof mediaAssets.$inferSelect,
    previewUrl?: string | null,
    thumbnailUrl?: string | null,
  ) => MediaAsset,
): void {
  app.post('/api/v1/media/app', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = CreateAppAssetSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid app/addon config', issues: parsed.error.issues });
    }

    const user = req.authUser!;
    const { title, type, durationMs, appConfig } = parsed.data;
    const checked = validateCreativeConfig(type, appConfig);
    if (!checked.ok) {
      return reply.code(400).send({ error: checked.error });
    }

    const id = crypto.randomUUID();
    const [created] = await db
      .insert(mediaAssets)
      .values({
        id,
        orgId: user.orgId,
        title,
        type,
        mimeType: 'application/x-signage-app',
        status: 'ready',
        approvalStatus: 'approved',
        objectKey: `app/${type}/${id}`,
        sha256: sha256Hex(JSON.stringify(checked.normalized)),
        sizeBytes: 0,
        durationMs,
        appConfig: checked.normalized,
      })
      .returning();

    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      orgId: user.orgId,
      actorUserId: user.id,
      action: 'media.app_created',
      targetType: 'media_asset',
      targetId: id,
      metadata: { title, type, appConfig: checked.normalized },
    });

    const previewUrl =
      typeof checked.normalized.url === 'string' ? checked.normalized.url : null;
    return reply.code(201).send({ asset: toMediaAssetDto(created, previewUrl, null) });
  });

  app.patch<{ Params: { id: string } }>(
    '/api/v1/media/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const parsed = UpdateMediaAssetSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid media update', issues: parsed.error.issues });
      }

      const user = req.authUser!;
      const [existing] = await db
        .select()
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, req.params.id), eq(mediaAssets.orgId, user.orgId)))
        .limit(1);
      if (!existing) return reply.code(404).send({ error: 'Media asset not found' });

      const isBinary = isBinaryMediaType(existing.type);
      let nextConfig: CreativeConfig | null = existing.appConfig ?? null;

      if (!isBinary && parsed.data.appConfig !== undefined) {
        if (parsed.data.appConfig === null) {
          nextConfig = null;
        } else {
          const checked = validateCreativeConfig(existing.type, parsed.data.appConfig);
          if (!checked.ok) {
            return reply.code(400).send({ error: checked.error });
          }
          nextConfig = checked.normalized;
        }
      }

      const [updated] = await db
        .update(mediaAssets)
        .set({
          title: parsed.data.title ?? existing.title,
          durationMs: parsed.data.durationMs ?? existing.durationMs,
          appConfig: nextConfig,
          sha256:
            !isBinary && nextConfig
              ? sha256Hex(JSON.stringify(nextConfig))
              : existing.sha256,
        })
        .where(eq(mediaAssets.id, existing.id))
        .returning();

      await db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        orgId: user.orgId,
        actorUserId: user.id,
        action: 'media.updated',
        targetType: 'media_asset',
        targetId: existing.id,
        metadata: { title: updated.title, durationMs: updated.durationMs },
      });

      const usedInPlaylists = await db
        .select({ playlistId: playlistItems.playlistId })
        .from(playlistItems)
        .where(eq(playlistItems.mediaAssetId, existing.id));
      for (const row of usedInPlaylists) {
        await pushToScreensUsingPlaylist(row.playlistId, 'media_updated');
      }

      const previewUrl = isBinary
        ? updated.status === 'ready'
          ? await createPresignedGetUrl(updated.objectKey, 3600)
          : null
        : typeof updated.appConfig?.url === 'string'
          ? updated.appConfig.url
          : null;
      const thumbnailUrl =
        isBinary && updated.thumbnailKey ? await createPresignedGetUrl(updated.thumbnailKey, 3600) : null;

      return { asset: toMediaAssetDto(updated, previewUrl, thumbnailUrl) };
    },
  );
}
