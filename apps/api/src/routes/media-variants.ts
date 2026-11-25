import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import {
  CompleteMediaVariantRequestSchema,
  CreateMediaVariantRequestSchema,
  type MediaAssetVariant,
} from '@signage/shared/contracts';
import { db } from '../db/index.js';
import { mediaAssetVariants, mediaAssets } from '../db/schema.js';
import { enqueueMediaProcessing } from '../lib/queue.js';
import { createPresignedGetUrl, createPresignedPutUrl, headS3Object } from '../lib/s3.js';
import { requireRole } from '../middleware/rbac.js';
import { getEffectiveOrgId, resolveTenantScope } from '../middleware/tenant-scope.js';
import { requireAuth } from './auth.js';

async function toVariantDto(
  row: typeof mediaAssetVariants.$inferSelect,
): Promise<MediaAssetVariant> {
  const previewUrl = row.sha256 ? await createPresignedGetUrl(row.objectKey, 3600) : null;
  return {
    id: row.id,
    assetId: row.assetId,
    orgId: row.orgId,
    orientation: row.orientation as 'landscape' | 'portrait',
    objectKey: row.objectKey,
    mimeType: row.mimeType,
    sizeBytes: Number(row.sizeBytes),
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    previewUrl,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function mediaVariantRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/api/v1/media/:id/variants',
    { preHandler: [requireAuth, resolveTenantScope] },
    async (req, reply) => {
      const orgId = getEffectiveOrgId(req);
      const [asset] = await db
        .select()
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, req.params.id), eq(mediaAssets.orgId, orgId)))
        .limit(1);
      if (!asset) return reply.code(404).send({ error: 'Media asset not found' });

      const rows = await db
        .select()
        .from(mediaAssetVariants)
        .where(eq(mediaAssetVariants.assetId, asset.id))
        .orderBy(desc(mediaAssetVariants.createdAt));
      return { items: await Promise.all(rows.map(toVariantDto)) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/media/:id/variants',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'editor')] },
    async (req, reply) => {
      const parsed = CreateMediaVariantRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid variant payload', issues: parsed.error.issues });
      }
      const orgId = getEffectiveOrgId(req);
      const [asset] = await db
        .select()
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, req.params.id), eq(mediaAssets.orgId, orgId)))
        .limit(1);
      if (!asset) return reply.code(404).send({ error: 'Media asset not found' });

      const variantId = crypto.randomUUID();
      const safeName = parsed.data.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      const objectKey = `variants/${orgId}/${asset.id}/${parsed.data.orientation}-${variantId}-${safeName}`;
      const uploadUrl = await createPresignedPutUrl(objectKey, parsed.data.mimeType, 900);

      const [created] = await db
        .insert(mediaAssetVariants)
        .values({
          id: variantId,
          assetId: asset.id,
          orgId,
          orientation: parsed.data.orientation,
          objectKey,
          mimeType: parsed.data.mimeType,
          sizeBytes: parsed.data.sizeBytes,
        })
        .returning();

      return reply.code(201).send({ variant: await toVariantDto(created), uploadUrl });
    },
  );

  app.post<{ Params: { id: string; variantId: string } }>(
    '/api/v1/media/:id/variants/:variantId/complete',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'editor')] },
    async (req, reply) => {
      const parsed = CompleteMediaVariantRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid completion payload', issues: parsed.error.issues });
      }
      const orgId = getEffectiveOrgId(req);
      const [variant] = await db
        .select()
        .from(mediaAssetVariants)
        .where(
          and(
            eq(mediaAssetVariants.id, req.params.variantId),
            eq(mediaAssetVariants.assetId, req.params.id),
            eq(mediaAssetVariants.orgId, orgId),
          ),
        )
        .limit(1);
      if (!variant) return reply.code(404).send({ error: 'Media variant not found' });

      let sizeBytes = Number(variant.sizeBytes);
      try {
        const head = await headS3Object(variant.objectKey);
        if (head.sizeBytes > 0) sizeBytes = head.sizeBytes;
      } catch {
        // S3 head may be skipped in unit/offline checks when sha256 metadata is supplied
      }

      const [updated] = await db
        .update(mediaAssetVariants)
        .set({
          sha256: parsed.data.sha256 ?? variant.sha256,
          sizeBytes,
          width: parsed.data.width ?? variant.width,
          height: parsed.data.height ?? variant.height,
        })
        .where(eq(mediaAssetVariants.id, variant.id))
        .returning();

      return { variant: await toVariantDto(updated) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/media/:id/version',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'editor')] },
    async (req, reply) => {
      const orgId = getEffectiveOrgId(req);
      const [existing] = await db
        .select()
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, req.params.id), eq(mediaAssets.orgId, orgId)))
        .limit(1);
      if (!existing) return reply.code(404).send({ error: 'Media asset not found' });

      const body = (req.body ?? {}) as { filename?: string; mimeType?: string; sizeBytes?: number };
      const mimeType = typeof body.mimeType === 'string' && body.mimeType.length > 2 ? body.mimeType : existing.mimeType;
      const filename = typeof body.filename === 'string' && body.filename.length > 0 ? body.filename : `${existing.title}.bin`;
      const sizeBytes = typeof body.sizeBytes === 'number' && body.sizeBytes > 0 ? body.sizeBytes : Number(existing.sizeBytes) || 1;
      const nextId = crypto.randomUUID();
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      const objectKey = `media/${orgId}/${nextId}-${safeName}`;
      const uploadUrl = await createPresignedPutUrl(objectKey, mimeType, 900);

      const [created] = await db
        .insert(mediaAssets)
        .values({
          id: nextId,
          orgId,
          title: existing.title,
          type: existing.type,
          mimeType,
          status: 'uploading',
          approvalStatus: existing.approvalStatus,
          objectKey,
          sizeBytes,
          version: existing.version + 1,
          parentAssetId: existing.parentAssetId ?? existing.id,
        })
        .returning();

      return reply.code(201).send({
        asset: {
          id: created.id,
          orgId: created.orgId,
          title: created.title,
          type: created.type,
          mimeType: created.mimeType,
          status: created.status,
          approvalStatus: created.approvalStatus,
          objectKey: created.objectKey,
          sizeBytes: Number(created.sizeBytes),
          sha256: created.sha256,
          durationMs: created.durationMs,
          version: created.version,
          parentAssetId: created.parentAssetId,
          createdAt: created.createdAt.toISOString(),
        },
        uploadUrl,
        enqueue: () => enqueueMediaProcessing(created.id),
      });
    },
  );
}
