import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { mediaAssets, organizations, playlists } from './schema.js';

export const mediaAssetVariants = pgTable('media_asset_variants', {
  id: uuid('id').primaryKey(),
  assetId: uuid('asset_id')
    .notNull()
    .references(() => mediaAssets.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  orientation: text('orientation').notNull(),
  objectKey: text('object_key').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
  sha256: text('sha256'),
  width: integer('width'),
  height: integer('height'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const dataFeeds = pgTable('data_feeds', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sourceUrl: text('source_url').notNull(),
  pollIntervalSec: integer('poll_interval_sec').notNull().default(300),
  headers: jsonb('headers').$type<Record<string, string>>().notNull().default({}),
  lastPayload: jsonb('last_payload').$type<unknown | null>(),
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const screenTriggers = pgTable('screen_triggers', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  triggerKey: text('trigger_key').notNull().unique(),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  playlistId: uuid('playlist_id')
    .notNull()
    .references(() => playlists.id, { onDelete: 'cascade' }),
  durationSec: integer('duration_sec').notNull().default(300),
  priority: integer('priority').notNull().default(950),
  secretHash: text('secret_hash').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
