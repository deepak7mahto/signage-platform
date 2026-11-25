export interface KeysetCursor {
  sortValue: string;
  id: string;
}

export interface ParsedListQuery {
  limit: number;
  cursor: KeysetCursor | null;
  q: string | null;
  status: string | null;
  siteId: string | null;
}

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | undefined): KeysetCursor | null {
  if (!raw || raw.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      sortValue?: unknown;
      id?: unknown;
    };
    if (typeof parsed.sortValue === 'string' && typeof parsed.id === 'string') {
      return { sortValue: parsed.sortValue, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

export function parseListQuery(rawQuery: unknown): ParsedListQuery {
  const qObj =
    typeof rawQuery === 'object' && rawQuery !== null
      ? (rawQuery as Record<string, unknown>)
      : {};

  const rawLimit = Number(qObj.limit ?? 25);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(100, Math.round(rawLimit)))
    : 25;

  const q = typeof qObj.q === 'string' && qObj.q.trim().length > 0 ? qObj.q.trim() : null;
  const status =
    typeof qObj.status === 'string' && qObj.status.trim().length > 0
      ? qObj.status.trim()
      : null;
  const siteId =
    typeof qObj.siteId === 'string' && qObj.siteId.trim().length > 0
      ? qObj.siteId.trim()
      : null;
  const cursor =
    typeof qObj.cursor === 'string' ? decodeCursor(qObj.cursor) : null;

  return { limit, cursor, q, status, siteId };
}
