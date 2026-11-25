import { z } from 'zod';
import { OrientationSchema } from './screens.js';

export const PlaylistLoopModeSchema = z.enum(['sequential', 'sov_weighted']);
export type PlaylistLoopMode = z.infer<typeof PlaylistLoopModeSchema>;

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.floor(a));
  let y = Math.abs(Math.floor(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

/**
 * Smooth weighted round-robin SOV expansion so e.g. 60/40 weights interleave cleanly
 * across all players without clumping. Capped at maxSlots (default 60).
 */
export function expandSovPlaylistItems<T extends { weight?: number }>(
  items: T[],
  loopMode: PlaylistLoopMode,
  maxSlots = 60,
): T[] {
  if (loopMode !== 'sov_weighted' || items.length <= 1) {
    return items;
  }

  const rawWeights = items.map((item) =>
    Number.isFinite(item.weight) && (item.weight ?? 0) > 0 ? Math.floor(item.weight!) : 100,
  );
  const divisor = rawWeights.reduce((acc, w) => gcd(acc, w), rawWeights[0]);
  const weights = rawWeights.map((w) => Math.max(1, Math.floor(w / divisor)));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const slotCount = Math.min(maxSlots, Math.max(items.length, totalWeight));

  const current = weights.map(() => 0);
  const expanded: T[] = [];

  for (let step = 0; step < slotCount; step += 1) {
    let bestIdx = 0;
    for (let i = 0; i < items.length; i += 1) {
      current[i] += weights[i];
      if (current[i] > current[bestIdx]) {
        bestIdx = i;
      }
    }
    current[bestIdx] -= totalWeight;
    expanded.push(items[bestIdx]);
  }

  return expanded;
}

// --- Multi-Orientation Media Variants ---
export const MediaAssetVariantSchema = z.object({
  id: z.string().uuid(),
  assetId: z.string().uuid(),
  orgId: z.string().uuid(),
  orientation: OrientationSchema,
  objectKey: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  previewUrl: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type MediaAssetVariant = z.infer<typeof MediaAssetVariantSchema>;

export const CreateMediaVariantRequestSchema = z.object({
  orientation: OrientationSchema,
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(3).max(120),
  sizeBytes: z.number().int().positive(),
});
export type CreateMediaVariantRequest = z.infer<typeof CreateMediaVariantRequestSchema>;

export const CompleteMediaVariantRequestSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type CompleteMediaVariantRequest = z.infer<typeof CompleteMediaVariantRequestSchema>;

// --- Server-Polled JSON Data Feeds ---
export const DataFeedSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  sourceUrl: z.string(),
  pollIntervalSec: z.number().int().positive(),
  headers: z.record(z.string()).default({}),
  lastPayload: z.unknown().nullable(),
  lastFetchedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
});
export type DataFeed = z.infer<typeof DataFeedSchema>;

export const CreateDataFeedSchema = z.object({
  name: z.string().min(1).max(100),
  sourceUrl: z.string().url(),
  pollIntervalSec: z.number().int().min(30).max(86400).default(300),
  headers: z.record(z.string()).default({}),
});
export type CreateDataFeed = z.infer<typeof CreateDataFeedSchema>;

export const UpdateDataFeedSchema = CreateDataFeedSchema.partial();
export type UpdateDataFeed = z.infer<typeof UpdateDataFeedSchema>;

// --- External Event Triggers ---
export const TriggerTargetTypeSchema = z.enum(['screen', 'group']);
export const ScreenTriggerSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  triggerKey: z.string(),
  targetType: TriggerTargetTypeSchema,
  targetId: z.string().uuid(),
  playlistId: z.string().uuid(),
  durationSec: z.number().int().positive(),
  priority: z.number().int().min(1).max(1000),
  enabled: z.boolean(),
  lastFiredAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ScreenTrigger = z.infer<typeof ScreenTriggerSchema>;

export const CreateScreenTriggerSchema = z.object({
  name: z.string().min(1).max(120),
  triggerKey: z.string().min(3).max(80).regex(/^[a-z0-9-_]+$/).optional(),
  targetType: TriggerTargetTypeSchema,
  targetId: z.string().uuid(),
  playlistId: z.string().uuid(),
  durationSec: z.number().int().min(15).max(86400).default(300),
  priority: z.number().int().min(1).max(1000).default(950),
});
export type CreateScreenTrigger = z.infer<typeof CreateScreenTriggerSchema>;

export const CreateScreenTriggerResponseSchema = z.object({
  trigger: ScreenTriggerSchema,
  triggerSecret: z.string(),
});
export type CreateScreenTriggerResponse = z.infer<typeof CreateScreenTriggerResponseSchema>;

export const FireTriggerResponseSchema = z.object({
  ok: z.boolean(),
  scheduleId: z.string().uuid(),
  expiresAt: z.string(),
  pushed: z.number().int().nonnegative(),
});
export type FireTriggerResponse = z.infer<typeof FireTriggerResponseSchema>;

// --- Signed USB Recovery Packs ---
export const UsbRecoveryAssetSchema = z.object({
  assetId: z.string().uuid(),
  sha256: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  url: z.string(),
});
export type UsbRecoveryAsset = z.infer<typeof UsbRecoveryAssetSchema>;

export const UsbRecoveryPackSchema = z.object({
  packVersion: z.literal(1),
  screenId: z.string().uuid(),
  screenName: z.string(),
  generatedAt: z.string(),
  kid: z.string(),
  signatureB64: z.string(),
  publicKeyB64: z.string(),
  manifestJson: z.string(),
  assets: z.array(UsbRecoveryAssetSchema),
});
export type UsbRecoveryPack = z.infer<typeof UsbRecoveryPackSchema>;

// --- Enterprise TOTP 2FA ---
export const TotpStatusResponseSchema = z.object({
  enabled: z.boolean(),
});
export type TotpStatusResponse = z.infer<typeof TotpStatusResponseSchema>;

export const TotpSetupResponseSchema = z.object({
  secret: z.string(),
  otpauthUri: z.string(),
});
export type TotpSetupResponse = z.infer<typeof TotpSetupResponseSchema>;

export const TotpCodeRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});
export type TotpCodeRequest = z.infer<typeof TotpCodeRequestSchema>;

// --- Programmatic pDOOH VAST 4.x ---
export const VastCreativeSchema = z.object({
  adId: z.string(),
  mediaUrl: z.string().url(),
  mimeType: z.string(),
  durationMs: z.number().int().positive(),
  impressionUrls: z.array(z.string()),
});
export type VastCreative = z.infer<typeof VastCreativeSchema>;

export const VastParseResultSchema = z.object({
  ok: z.boolean(),
  creative: VastCreativeSchema.nullable(),
  fallback: z.enum(['house_playlist']).optional(),
  reason: z.string().optional(),
});
export type VastParseResult = z.infer<typeof VastParseResultSchema>;

function unwrapXmlText(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .trim();
}

function parseVastDurationMs(raw: string | undefined): number {
  if (!raw) return 15_000;
  const parts = raw.trim().split(':').map((n) => Number(n));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return 15_000;
  const ms = Math.round((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000);
  return ms > 0 ? ms : 15_000;
}

export function parseVastXml(xml: string): VastParseResult {
  const trimmed = xml.trim();
  if (!trimmed || !/<VAST[\s>]/i.test(trimmed)) {
    return {
      ok: false,
      creative: null,
      fallback: 'house_playlist',
      reason: 'Invalid or non-VAST XML payload',
    };
  }

  const adMatch = /<Ad\b([^>]*)>/i.exec(trimmed);
  if (!adMatch) {
    return {
      ok: false,
      creative: null,
      fallback: 'house_playlist',
      reason: 'Empty VAST response (no <Ad> fill returned)',
    };
  }
  const adIdMatch = /\bid=["']([^"']+)["']/i.exec(adMatch[1] ?? '');

  const durationMatch = /<Duration>([\s\S]*?)<\/Duration>/i.exec(trimmed);
  const durationMs = parseVastDurationMs(durationMatch ? unwrapXmlText(durationMatch[1]) : undefined);

  const impressionUrls: string[] = [];
  const impRegex = /<Impression(?:\s[^>]*)?>([\s\S]*?)<\/Impression>/gi;
  let impMatch: RegExpExecArray | null;
  while ((impMatch = impRegex.exec(trimmed)) !== null) {
    const u = unwrapXmlText(impMatch[1]);
    if (u) impressionUrls.push(u);
  }

  const mediaCandidates: Array<{ url: string; mimeType: string }> = [];
  const mfRegex = /<MediaFile\b([^>]*)>([\s\S]*?)<\/MediaFile>/gi;
  let mfMatch: RegExpExecArray | null;
  while ((mfMatch = mfRegex.exec(trimmed)) !== null) {
    const attrs = mfMatch[1];
    const typeMatch = /\btype=["']([^"']+)["']/i.exec(attrs);
    const mimeType = (typeMatch?.[1] ?? 'video/mp4').toLowerCase();
    const url = unwrapXmlText(mfMatch[2]);
    if (/^https?:\/\//i.test(url)) {
      mediaCandidates.push({ url, mimeType });
    }
  }

  const preferred =
    mediaCandidates.find((c) => c.mimeType === 'video/mp4') ??
    mediaCandidates.find((c) => c.mimeType.startsWith('video/')) ??
    mediaCandidates[0];

  if (!preferred) {
    return {
      ok: false,
      creative: null,
      fallback: 'house_playlist',
      reason: 'No playable HTTP(S) <MediaFile> found in VAST XML',
    };
  }

  return {
    ok: true,
    creative: {
      adId: adIdMatch?.[1] || 'vast-ad',
      mediaUrl: preferred.url,
      mimeType: preferred.mimeType,
      durationMs,
      impressionUrls,
    },
  };
}
