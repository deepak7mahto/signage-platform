import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import {
  parseVastXml,
  type UsbRecoveryAsset,
  type UsbRecoveryPack,
} from '@signage/shared/contracts';
import { isBinaryMediaType, isPrivateOrBlockedHost } from '@signage/shared/creatives';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { screens } from '../db/schema.js';
import { sha256Hex } from '../lib/crypto.js';
import { buildSignedManifest } from '../lib/manifest.js';
import { requireRole } from '../middleware/rbac.js';
import { getEffectiveOrgId, resolveTenantScope } from '../middleware/tenant-scope.js';
import { requireAuth } from './auth.js';

export async function extensionRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>(
    '/api/v1/screens/:id/usb-pack',
    { preHandler: [requireAuth, resolveTenantScope, requireRole('owner', 'admin', 'ops')] },
    async (req, reply) => {
      const orgId = getEffectiveOrgId(req);
      const [screen] = await db
        .select()
        .from(screens)
        .where(and(eq(screens.id, req.params.id), eq(screens.orgId, orgId), isNull(screens.revokedAt)))
        .limit(1);

      if (!screen) return reply.code(404).send({ error: 'Screen not found' });

      const envelope = await buildSignedManifest(screen, 2);
      const allItems = [
        ...envelope.manifest.items,
        ...Object.values(envelope.manifest.playlists ?? {}).flatMap((pl) => pl.items),
      ];

      const seenSha = new Set<string>();
      const assets: UsbRecoveryAsset[] = [];
      for (const item of allItems) {
        if (!isBinaryMediaType(item.type) || !item.sha256 || seenSha.has(item.sha256)) {
          continue;
        }
        seenSha.add(item.sha256);
        assets.push({
          assetId: item.assetId,
          sha256: item.sha256,
          filename: item.sha256,
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes,
          url: item.url,
        });
      }

      const pack: UsbRecoveryPack = {
        packVersion: 1,
        screenId: screen.id,
        screenName: screen.name,
        generatedAt: new Date().toISOString(),
        kid: envelope.kid,
        signatureB64: envelope.signatureB64,
        publicKeyB64: envelope.publicKeyB64,
        manifestJson: envelope.bodyJson,
        assets,
      };
      return pack;
    },
  );

  app.post(
    '/api/v1/programmatic/vast/preview',
    { preHandler: [requireAuth, resolveTenantScope] },
    async (req, reply) => {
      const body = (req.body ?? {}) as { url?: unknown; xml?: unknown };
      if (typeof body.xml === 'string' && body.xml.trim().length > 0) {
        return parseVastXml(body.xml);
      }
      if (typeof body.url === 'string' && body.url.trim().length > 0) {
        const allowHttpInDev = config.NODE_ENV !== 'production';
        if (isPrivateOrBlockedHost(body.url.trim(), { allowHttpInDev })) {
          return reply.code(400).send({ error: 'VAST URL targets a private or disallowed host' });
        }
        try {
          const res = await fetch(body.url.trim(), { signal: AbortSignal.timeout(5000) });
          if (!res.ok) {
            return {
              ok: false,
              creative: null,
              fallback: 'house_playlist',
              reason: `SSP returned HTTP ${res.status}`,
            };
          }
          return parseVastXml(await res.text());
        } catch (err) {
          return {
            ok: false,
            creative: null,
            fallback: 'house_playlist',
            reason: err instanceof Error ? err.message : 'VAST request failed',
          };
        }
      }
      return reply.code(400).send({ error: 'Provide either url or xml to parse VAST 4.x' });
    },
  );

  app.get('/api/v1/device/programmatic-fill', async (req, reply) => {
    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
    if (!token) return reply.code(401).send({ error: 'Invalid device token' });

    const [screen] = await db
      .select()
      .from(screens)
      .where(eq(screens.tokenHash, sha256Hex(token)))
      .limit(1);
    if (!screen) return reply.code(401).send({ error: 'Invalid device token' });
    if (screen.revokedAt !== null || screen.status === 'locked') {
      return reply.code(410).send({
        errorCode: 'DEVICE_REVOKED',
        message: 'Device credentials have been revoked',
      });
    }

    if (!screen.programmaticFillUrl) {
      return {
        ok: false,
        creative: null,
        fallback: 'house_playlist',
        reason: 'No programmatic VAST fill URL configured on screen',
      };
    }

    const allowHttpInDev = config.NODE_ENV !== 'production';
    if (isPrivateOrBlockedHost(screen.programmaticFillUrl, { allowHttpInDev })) {
      return {
        ok: false,
        creative: null,
        fallback: 'house_playlist',
        reason: 'Configured programmatic VAST URL blocked by SSRF guard',
      };
    }

    try {
      const res = await fetch(screen.programmaticFillUrl, { signal: AbortSignal.timeout(3500) });
      if (!res.ok) {
        return {
          ok: false,
          creative: null,
          fallback: 'house_playlist',
          reason: `SSP returned HTTP ${res.status}`,
        };
      }
      return parseVastXml(await res.text());
    } catch {
      return {
        ok: false,
        creative: null,
        fallback: 'house_playlist',
        reason: 'Programmatic SSP unreachable; using offline house playlist',
      };
    }
  });
}
