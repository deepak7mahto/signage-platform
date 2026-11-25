import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, ilike, lt, or } from 'drizzle-orm';
import {
  CompleteUploadRequestSchema,
  UpdateMediaApprovalSchema,
  UploadUrlRequestSchema,
  isBinaryMediaType,
  type MediaAsset,
} from '@signage/shared';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { auditLogs, mediaAssets, playlistItems } from '../db/schema.js';
import { encodeCursor, parseListQuery } from '../lib/pagination.js';
import { enqueueMediaProcessing } from '../lib/queue.js';
import {
  createPresignedGetUrl,
  createPresignedPutUrl,
  deleteS3Object,
  headS3Object,
} from '../lib/s3.js';
import { requireRole } from '../middleware/rbac.js';
import { getEffectiveOrgId, resolveTenantScope } from '../middleware/tenant-scope.js';
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
  app.get('/api/v1/media', { preHandler: [requireAuth, resolveTenantScope] }, async (req) => {
    const orgId = getEffectiveOrgId(req);
    const { limit, cursor, q, status } = parseListQuery(req.query);

    const conditions = [eq(mediaAssets.orgId, orgId)];
    if (status) conditions.push(eq(mediaAssets.status, status));
    if (q) conditions.push(ilike(mediaAssets.title, `%${q}%`));
    if (cursor) {
      const curDate = new Date(cursor.sortValue);
      if (Number.isFinite(curDate.getTime())) {
        conditions.push(
          or(
            lt(mediaAssets.createdAt, curDate),
            and(eq(mediaAssets.createdAt, curDate), lt(mediaAssets.id, cursor.id)),
          )!,
        );
      }
    }

    const rows = await db
      .select()
      .from(mediaAssets)
      .where(and(...conditions))
      .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const items = await Promise.all(
      slice.map(async (row) => {
        const { previewUrl, thumbnailUrl } = await resolveAssetUrls(row);
        return toMediaAssetDto(row, previewUrl, thumbnailUrl);
      }),
    );

    const lastRow = slice[slice.length - 1];
    const nextCursor =
      hasMore && lastRow
        ? encodeCursor({ sortValue: lastRow.createdAt.toISOString(), id: lastRow.id })
        : null;

    return { items, nextCursor, hasMore };
  });

  app.get<{ Params: { sha256: string }; Querystring: { exp?: string; sig?: string } }>(
    '/api/v1/media/blobs/:sha256/verify',
    async (req, reply) => {
      const exp = Number(req.query?.exp ?? '0');
      const sig = req.query?.sig ?? '';
      if (!Number.isFinite(exp) || exp * 1000 < Date.now() || !sig) {
        return reply.code(403).send({ error: 'Expired or missing blob signature' });
      }
      const expected = crypto
        .createHmac('sha256', config.BLOB_HMAC_SECRET)
        .update(`${req.params.sha256}:${exp}`)
        .digest('hex');
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return reply.code(403).send({ error: 'Invalid blob signature' });
      }
      return { ok: true };
    },
  );

  app.post(
    '/api/v1/media/upload-url',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'editor')] },
    async (req, reply) => {
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

      const orgId = getEffectiveOrgId(req);
      const assetId = crypto.randomUUID();
      const safeName = sanitizeFilename(filename);
      const objectKey = `${orgId}/${assetId}/${safeName}`;

      const [created] = await db
        .insert(mediaAssets)
        .values({
          id: assetId,
          orgId,
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
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/media/:id/complete',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'editor')] },
    async (req, reply) => {
      const parsed = CompleteUploadRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid payload', issues: parsed.error.issues });
      }

      const user = req.authUser!;
      const orgId = getEffectiveOrgId(req);
      const [existing] = await db
        .select()
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, req.params.id), eq(mediaAssets.orgId, orgId)))
        .limit(1);

      if (!existing) {
        return reply.code(404).send({ error: 'Media asset not found' });
      }

      try {
        const head = await headS3Object(existing.objectKey);
        const sizeBytes = head.sizeBytes > 0 ? head.sizeBytes : existing.sizeBytes;
        const [updated] = await db
          .update(mediaAssets)
          .set({
            status: 'processing',
            sizeBytes,
            durationMs: parsed.data.durationMs ?? existing.durationMs,
          })
          .where(eq(mediaAssets.id, existing.id))
          .returning();

        await enqueueMediaProcessing(existing.id);

        await db.insert(auditLogs).values({
          id: crypto.randomUUID(),
          orgId,
          actorUserId: user.id,
          action: 'media.uploaded',
          targetType: 'media_asset',
          targetId: existing.id,
          metadata: { title: existing.title, sizeBytes },
        });

        return { asset: toMediaAssetDto(updated, null, null) };
      } catch (err) {
        await db
          .update(mediaAssets)
          .set({ status: 'failed', failureReason: 'Uploaded object not found in storage' })
          .where(eq(mediaAssets.id, existing.id));
        req.log.error(err, 'Failed to verify uploaded object');
        return reply.code(400).send({ error: 'Uploaded object could not be verified in storage' });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/media/:id',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'editor')] },
    async (req, reply) => {
      const user = req.authUser!;
      const orgId = getEffectiveOrgId(req);
      const [existing] = await db
        .select()
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, req.params.id), eq(mediaAssets.orgId, orgId)))
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
        orgId,
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
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin')] },
    async (req, reply) => {
      const user = req.authUser!;
      const orgId = getEffectiveOrgId(req);
      const parsed = UpdateMediaApprovalSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid approval payload', issues: parsed.error.issues });
      }

      const [existing] = await db
        .select()
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, req.params.id), eq(mediaAssets.orgId, orgId)))
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
        orgId,
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
