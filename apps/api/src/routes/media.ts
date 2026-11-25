import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import {
  CompleteUploadRequestSchema,
  UpdateMediaApprovalSchema,
  UploadUrlRequestSchema,
  isBinaryMediaType,
  type MediaAsset,
} from '@signage/shared';
import { db } from '../db/index.js';
import { auditLogs, mediaAssets, playlistItems } from '../db/schema.js';
import { enqueueMediaProcessing } from '../lib/queue.js';
import {
  computeObjectDigest,
  createPresignedGetUrl,
  createPresignedPutUrl,
  deleteS3Object,
} from '../lib/s3.js';
import { pushToScreensUsingPlaylist } from '../ws/gateway.js';
import { requireAuth } from './auth.js';
import { registerMediaAppRoutes } from './media-apps.js';

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

function toMediaAssetDto(
  row: typeof mediaAssets.$inferSelect,
  previewUrl?: string | null,
  thumbnailUrl?: string | null,
): MediaAsset {
  return {
    id: row.id,
    orgId: row.orgId,
    title: row.title,
    type: row.type,
    mimeType: row.mimeType,
    status: row.status as MediaAsset['status'],
    approvalStatus: (row.approvalStatus as MediaAsset['approvalStatus']) ?? 'approved',
    objectKey: row.objectKey,
    sizeBytes: Number(row.sizeBytes),
    sha256: row.sha256,
    durationMs: row.durationMs,
    width: row.width,
    height: row.height,
    codec: row.codec,
    appConfig: row.appConfig ?? null,
    thumbnailUrl: thumbnailUrl ?? null,
    previewUrl: previewUrl ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function resolveAssetUrls(row: typeof mediaAssets.$inferSelect): Promise<{
  previewUrl: string | null;
  thumbnailUrl: string | null;
}> {
  if (!isBinaryMediaType(row.type)) {
    return {
      previewUrl: typeof row.appConfig?.url === 'string' ? row.appConfig.url : null,
      thumbnailUrl: null,
    };
  }
  const previewUrl =
    row.status === 'ready' ? await createPresignedGetUrl(row.objectKey, 3600) : null;
  const thumbnailUrl = row.thumbnailKey ? await createPresignedGetUrl(row.thumbnailKey, 3600) : null;
  return { previewUrl, thumbnailUrl };
}

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/media', { preHandler: requireAuth }, async (req) => {
    const orgId = req.authUser!.orgId;
    const rows = await db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.orgId, orgId))
      .orderBy(desc(mediaAssets.createdAt));

    const items = await Promise.all(
      rows.map(async (row) => {
        const { previewUrl, thumbnailUrl } = await resolveAssetUrls(row);
        return toMediaAssetDto(row, previewUrl, thumbnailUrl);
      }),
    );

    return { items };
  });

  app.post('/api/v1/media/upload-url', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = UploadUrlRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid upload request', issues: parsed.error.issues });
    }

    const { title, filename, mimeType, sizeBytes } = parsed.data;
    const isVideo = mimeType.startsWith('video/');
    const isImage = mimeType.startsWith('image/');

    if (!isVideo && !isImage) {
      return reply.code(400).send({ error: 'Only video/* and image/* MIME types are supported' });
    }

    const user = req.authUser!;
    const assetId = crypto.randomUUID();
    const safeName = sanitizeFilename(filename);
    const objectKey = `${user.orgId}/${assetId}/${safeName}`;

    const [created] = await db
      .insert(mediaAssets)
      .values({
        id: assetId,
        orgId: user.orgId,
        title,
        type: isVideo ? 'video' : 'image',
        mimeType,
        status: 'uploading',
        objectKey,
        sizeBytes,
      })
      .returning();

    const uploadUrl = await createPresignedPutUrl(objectKey, mimeType, 900);

    return {
      asset: toMediaAssetDto(created, null),
      uploadUrl,
    };
  });

  app.post<{ Params: { id: string } }>(
    '/api/v1/media/:id/complete',
    { preHandler: requireAuth },
    async (req, reply) => {
      const parsed = CompleteUploadRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid payload', issues: parsed.error.issues });
      }

      const user = req.authUser!;
      const [existing] = await db
        .select()
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, req.params.id), eq(mediaAssets.orgId, user.orgId)))
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: 'Media asset not found' });
      }

      try {
        const digest = await computeObjectDigest(existing.objectKey);
        const [updated] = await db
          .update(mediaAssets)
          .set({
            status: 'processing',
            sha256: digest.sha256,
            sizeBytes: digest.sizeBytes,
            durationMs: parsed.data.durationMs ?? existing.durationMs,
          })
          .where(eq(mediaAssets.id, existing.id))
          .returning();

        await enqueueMediaProcessing(existing.id);

        await db.insert(auditLogs).values({
          id: crypto.randomUUID(),
          orgId: user.orgId,
          actorUserId: user.id,
          action: 'media.uploaded',
          targetType: 'media_asset',
          targetId: existing.id,
          metadata: { title: existing.title, sha256: digest.sha256, sizeBytes: digest.sizeBytes },
        });

        return { asset: toMediaAssetDto(updated, null, null) };
      } catch (err) {
        await db
          .update(mediaAssets)
          .set({ status: 'failed' })
          .where(eq(mediaAssets.id, existing.id));
        req.log.error(err, 'Failed to verify uploaded object');
        return reply.code(400).send({ error: 'Uploaded object could not be verified in storage' });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/media/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const user = req.authUser!;
      const [existing] = await db
        .select()
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, req.params.id), eq(mediaAssets.orgId, user.orgId)))
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: 'Media asset not found' });
      }

      if (isBinaryMediaType(existing.type)) {
        try {
          await deleteS3Object(existing.objectKey);
          if (existing.thumbnailKey) {
            await deleteS3Object(existing.thumbnailKey);
          }
        } catch (err) {
          req.log.warn(err, 'Could not delete S3 object; continuing DB cleanup');
        }
      }

      await db.delete(mediaAssets).where(eq(mediaAssets.id, existing.id));

      await db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        orgId: user.orgId,
        actorUserId: user.id,
        action: 'media.deleted',
        targetType: 'media_asset',
        targetId: existing.id,
        metadata: { title: existing.title },
      });

      return { ok: true };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/media/:id/approval',
    { preHandler: requireAuth },
    async (req, reply) => {
      const user = req.authUser!;
      if (user.role !== 'owner' && user.role !== 'admin') {
        return reply.code(403).send({ error: 'Only owners or admins can approve/reject media' });
      }

      const parsed = UpdateMediaApprovalSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid approval payload', issues: parsed.error.issues });
      }

      const [existing] = await db
        .select()
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, req.params.id), eq(mediaAssets.orgId, user.orgId)))
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: 'Media asset not found' });
      }

      const [updated] = await db
        .update(mediaAssets)
        .set({ approvalStatus: parsed.data.approvalStatus })
        .where(eq(mediaAssets.id, existing.id))
        .returning();

      await db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        orgId: user.orgId,
        actorUserId: user.id,
        action: `media.approval.${parsed.data.approvalStatus}`,
        targetType: 'media_asset',
        targetId: existing.id,
        metadata: { title: existing.title, approvalStatus: parsed.data.approvalStatus },
      });

      const usedInPlaylists = await db
        .select({ playlistId: playlistItems.playlistId })
        .from(playlistItems)
        .where(eq(playlistItems.mediaAssetId, existing.id));

      for (const row of usedInPlaylists) {
        await pushToScreensUsingPlaylist(row.playlistId, 'media_approval_updated');
      }

      const { previewUrl, thumbnailUrl } = await resolveAssetUrls(updated);
      return { asset: toMediaAssetDto(updated, previewUrl, thumbnailUrl) };
    },
  );

  registerMediaAppRoutes(app, toMediaAssetDto);
}
