import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { CreativeConfig } from '@signage/shared';

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('admin'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const mediaAssets = pgTable('media_assets', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  type: text('type').notNull(),
  mimeType: text('mime_type').notNull(),
  status: text('status').notNull().default('uploading'), // 'uploading' | 'processing' | 'ready' | 'failed'
  approvalStatus: text('approval_status').notNull().default('approved'), // 'pending' | 'approved' | 'rejected'
  objectKey: text('object_key').notNull(),
  thumbnailKey: text('thumbnail_key'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
  sha256: text('sha256'),
  durationMs: integer('duration_ms'),
  width: integer('width'),
  height: integer('height'),
  codec: text('codec'),
  appConfig: jsonb('app_config').$type<CreativeConfig | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const playlists = pgTable('playlists', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const playlistItems = pgTable('playlist_items', {
  id: uuid('id').primaryKey(),
  playlistId: uuid('playlist_id')
    .notNull()
    .references(() => playlists.id, { onDelete: 'cascade' }),
  mediaAssetId: uuid('media_asset_id')
    .notNull()
    .references(() => mediaAssets.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull(),
  durationMs: integer('duration_ms').notNull().default(10000),
});

export const screens = pgTable('screens', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  location: text('location'),
  timezone: text('timezone').notNull().default('UTC'),
  status: text('status').notNull().default('offline'),
  tokenHash: text('token_hash').notNull().unique(),
  appVersion: text('app_version'),
  activePlaylistId: uuid('active_playlist_id').references(() => playlists.id, {
    onDelete: 'set null',
  }),
  city: text('city'),
  venueType: text('venue_type'),
  orientation: text('orientation').notNull().default('landscape'),
  slotDurationSec: integer('slot_duration_sec').notNull().default(15),
  layoutConfig: jsonb('layout_config').$type<{
    template: 'fullscreen' | 'bottom_ticker' | 'split_sidebar';
    fitMode?: 'contain' | 'cover' | 'blur_fill';
    rotationDeg?: 0 | 90 | 180 | 270;
    transition?: 'none' | 'fade' | 'slide_left' | 'zoom';
    syncMode?: 'independent' | 'clock_sync';
    tickerText?: string | null;
    sidebarTitle?: string | null;
    sidebarLines: string[];
  } | null>(),
  programmaticFillUrl: text('programmatic_fill_url'),
  hwInfo: jsonb('hw_info').$type<Record<string, unknown> | null>(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const pairingCodes = pgTable('pairing_codes', {
  code: text('code').primaryKey(),
  claimSecretHash: text('claim_secret_hash').notNull(),
  claimedScreenId: uuid('claimed_screen_id').references(() => screens.id, {
    onDelete: 'set null',
  }),
  deviceTokenPlain: text('device_token_plain'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  actorUserId: uuid('actor_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const screenGroups = pgTable('screen_groups', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const screenGroupMembers = pgTable(
  'screen_group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => screenGroups.id, { onDelete: 'cascade' }),
    screenId: uuid('screen_id')
      .notNull()
      .references(() => screens.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.screenId] })],
);

export const schedules = pgTable('schedules', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  playlistId: uuid('playlist_id')
    .notNull()
    .references(() => playlists.id, { onDelete: 'cascade' }),
  targetType: text('target_type').notNull(), // 'screen' | 'group'
  targetId: uuid('target_id').notNull(),
  priority: integer('priority').notNull().default(50),
  daysOfWeek: jsonb('days_of_week').$type<number[]>().notNull().default([0, 1, 2, 3, 4, 5, 6]),
  startTime: text('start_time').notNull().default('00:00'),
  endTime: text('end_time').notNull().default('23:59'),
  validFrom: text('valid_from'),
  validUntil: text('valid_until'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const screenScreenshots = pgTable('screen_screenshots', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  screenId: uuid('screen_id')
    .notNull()
    .references(() => screens.id, { onDelete: 'cascade' }),
  objectKey: text('object_key').notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
});

export const screenCommands = pgTable('screen_commands', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  screenId: uuid('screen_id')
    .notNull()
    .references(() => screens.id, { onDelete: 'cascade' }),
  command: text('command').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown> | null>(),
  status: text('status').notNull().default('queued'),
  detail: text('detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  ackedAt: timestamp('acked_at', { withTimezone: true }),
});
