import {
  DeviceManifestSchema,
  DeviceRevokedErrorSchema,
  type DeviceManifest,
} from '@signage/shared/contracts';

export function isDeviceRevokedResponse(status: number, body: unknown): boolean {
  if (status !== 410) return false;
  const parsed = DeviceRevokedErrorSchema.safeParse(body);
  return parsed.success;
}

export function computeFullJitterBackoffMs(
  attempt: number,
  baseMs = 1500,
  maxMs = 60_000,
  rand: () => number = Math.random,
): number {
  const safeAttempt = Math.max(0, Math.min(attempt, 20));
  const cap = Math.min(maxMs, baseMs * Math.pow(2, safeAttempt));
  const factor = Math.max(0, Math.min(1, rand()));
  return Math.max(250, Math.round(cap * factor));
}

export type ManifestFetchResult =
  | { status: 'not_modified'; etag: string | null; clockOffsetMs: number | null }
  | {
      status: 'updated';
      manifest: DeviceManifest;
      etag: string | null;
      kid: string | null;
      signatureB64: string | null;
      publicKeyB64: string | null;
      clockOffsetMs: number;
    }
  | { status: 'revoked'; message: string }
  | { status: 'unauthorized' }
  | { status: 'error'; httpStatus: number; message: string };

export interface FetchManifestOptions {
  baseUrl?: string;
  deviceToken: string;
  etag?: string | null;
  fetchImpl?: typeof fetch;
  nowMs?: number;
}

function parseServerClockOffset(serverTimeHeader: string | null, manifestTime: string | undefined, nowMs: number): number | null {
  const raw = serverTimeHeader || manifestTime;
  if (!raw) return null;
  const parsedMs = Date.parse(raw);
  return Number.isFinite(parsedMs) ? parsedMs - nowMs : null;
}

export async function fetchSignedManifest(
  opts: FetchManifestOptions,
): Promise<ManifestFetchResult> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const prefix = opts.baseUrl ?? '';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.deviceToken}`,
  };
  if (opts.etag) {
    headers['If-None-Match'] = opts.etag;
  }

  const res = await fetchFn(`${prefix}/api/v1/device/manifest`, { headers });
  const nowMs = opts.nowMs ?? Date.now();
  const nextEtag = res.headers.get('etag');
  const serverTimeHdr = res.headers.get('x-server-time');

  if (res.status === 304) {
    return {
      status: 'not_modified',
      etag: nextEtag ?? opts.etag ?? null,
      clockOffsetMs: parseServerClockOffset(serverTimeHdr, undefined, nowMs),
    };
  }

  if (res.status === 401) {
    return { status: 'unauthorized' };
  }

  if (res.status === 410) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (isDeviceRevokedResponse(410, body)) {
      const msg = (body as { message: string }).message;
      return { status: 'revoked', message: msg };
    }
    return { status: 'error', httpStatus: 410, message: 'Gone' };
  }

  if (!res.ok) {
    return { status: 'error', httpStatus: res.status, message: `HTTP ${res.status}` };
  }

  const rawJson = (await res.json()) as Record<string, unknown>;
  const serverTime =
    serverTimeHdr ??
    (typeof rawJson.serverTime === 'string' ? rawJson.serverTime : new Date(nowMs).toISOString());
  const normalized: Record<string, unknown> = {
    ...rawJson,
    serverTime,
    generatedAt: typeof rawJson.generatedAt === 'string' ? rawJson.generatedAt : serverTime,
  };

  const parsed = DeviceManifestSchema.parse(normalized);
  const clockOffsetMs = parseServerClockOffset(serverTimeHdr, parsed.serverTime, nowMs) ?? 0;

  return {
    status: 'updated',
    manifest: parsed,
    etag: nextEtag,
    kid: res.headers.get('x-manifest-key-id'),
    signatureB64: res.headers.get('x-manifest-signature'),
    publicKeyB64: res.headers.get('x-manifest-public-key'),
    clockOffsetMs,
  };
}
