import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { dataFeeds, mediaAssetVariants } from '../db/schema.js';

export type VariantRow = typeof mediaAssetVariants.$inferSelect;

export async function loadOrientationVariantMap(
  assetIds: string[],
  orientation: string,
): Promise<Map<string, VariantRow>> {
  const map = new Map<string, VariantRow>();
  if (assetIds.length === 0) return map;

  const rows = await db
    .select()
    .from(mediaAssetVariants)
    .where(
      and(
        inArray(mediaAssetVariants.assetId, assetIds),
        eq(mediaAssetVariants.orientation, orientation),
      ),
    );

  for (const row of rows) {
    if (!map.has(row.assetId)) {
      map.set(row.assetId, row);
    }
  }
  return map;
}

export async function loadOrgFeedsMap(orgId: string): Promise<Record<string, unknown>> {
  const rows = await db.select().from(dataFeeds).where(eq(dataFeeds.orgId, orgId));
  const feeds: Record<string, unknown> = {};
  for (const row of rows) {
    if (row.lastPayload !== null && row.lastPayload !== undefined) {
      feeds[row.name] = {
        data: row.lastPayload,
        fetchedAt: row.lastFetchedAt ? row.lastFetchedAt.toISOString() : null,
      };
    }
  }
  return feeds;
}
