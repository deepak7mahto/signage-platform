import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { hashPassword } from '../lib/crypto.js';
import { db, pgClient } from './index.js';
import { organizations, users } from './schema.js';

export async function bootstrapDatabase(): Promise<void> {
  await pgClient.unsafe(`
    CREATE TABLE IF NOT EXISTS organizations (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS media_assets (
      id UUID PRIMARY KEY,
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'uploading',
      object_key TEXT NOT NULL,
      thumbnail_key TEXT,
      size_bytes BIGINT NOT NULL DEFAULT 0,
      sha256 TEXT,
      duration_ms INTEGER,
      width INTEGER,
      height INTEGER,
      codec TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS thumbnail_key TEXT;
    ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS width INTEGER;
    ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS height INTEGER;
    ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS codec TEXT;
    ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved';
    ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS app_config JSONB;

    ALTER TABLE screens ADD COLUMN IF NOT EXISTS city TEXT;
    ALTER TABLE screens ADD COLUMN IF NOT EXISTS venue_type TEXT;
    ALTER TABLE screens ADD COLUMN IF NOT EXISTS orientation TEXT NOT NULL DEFAULT 'landscape';
    ALTER TABLE screens ADD COLUMN IF NOT EXISTS slot_duration_sec INTEGER NOT NULL DEFAULT 15;
    ALTER TABLE screens ADD COLUMN IF NOT EXISTS layout_config JSONB;
    ALTER TABLE screens ADD COLUMN IF NOT EXISTS programmatic_fill_url TEXT;

    CREATE TABLE IF NOT EXISTS playlists (
      id UUID PRIMARY KEY,
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS playlist_items (
      id UUID PRIMARY KEY,
      playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 10000
    );

    CREATE TABLE IF NOT EXISTS screens (
      id UUID PRIMARY KEY,
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      location TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      status TEXT NOT NULL DEFAULT 'offline',
      token_hash TEXT NOT NULL UNIQUE,
      app_version TEXT,
      active_playlist_id UUID REFERENCES playlists(id) ON DELETE SET NULL,
      hw_info JSONB,
      last_seen_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS pairing_codes (
      code TEXT PRIMARY KEY,
      claim_secret_hash TEXT NOT NULL,
      claimed_screen_id UUID REFERENCES screens(id) ON DELETE SET NULL,
      device_token_plain TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY,
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS screen_groups (
      id UUID PRIMARY KEY,
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS screen_group_members (
      group_id UUID NOT NULL REFERENCES screen_groups(id) ON DELETE CASCADE,
      screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, screen_id)
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id UUID PRIMARY KEY,
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      target_id UUID NOT NULL,
      priority INTEGER NOT NULL DEFAULT 50,
      days_of_week JSONB NOT NULL DEFAULT '[0,1,2,3,4,5,6]'::jsonb,
      start_time TEXT NOT NULL DEFAULT '00:00',
      end_time TEXT NOT NULL DEFAULT '23:59',
      valid_from TEXT,
      valid_until TEXT,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_media_assets_org ON media_assets(org_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_screens_org ON screens(org_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_screens_playlist ON screens(active_playlist_id);
    CREATE INDEX IF NOT EXISTS idx_screen_groups_org ON screen_groups(org_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_schedules_org ON schedules(org_id, priority DESC);
    CREATE INDEX IF NOT EXISTS idx_schedules_target ON schedules(target_type, target_id);

    CREATE TABLE IF NOT EXISTS screen_screenshots (
      id UUID PRIMARY KEY,
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
      object_key TEXT NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_screen_screenshots_screen
      ON screen_screenshots(screen_id, captured_at DESC);

    CREATE TABLE IF NOT EXISTS screen_commands (
      id UUID PRIMARY KEY,
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
      command TEXT NOT NULL,
      payload JSONB,
      status TEXT NOT NULL DEFAULT 'queued',
      detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      acked_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_screen_commands_screen
      ON screen_commands(screen_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS proof_of_play (
      id UUID NOT NULL,
      org_id UUID NOT NULL,
      screen_id UUID NOT NULL,
      playlist_id UUID,
      media_asset_id UUID NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      ended_at TIMESTAMPTZ NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      PRIMARY KEY (id, started_at)
    ) PARTITION BY RANGE (started_at);

    CREATE TABLE IF NOT EXISTS proof_of_play_default
      PARTITION OF proof_of_play DEFAULT;

    CREATE INDEX IF NOT EXISTS idx_pop_org_started
      ON proof_of_play(org_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pop_screen_started
      ON proof_of_play(screen_id, started_at DESC);
  `);

  // Ensure monthly partitions exist for previous, current, and next 2 months
  const now = new Date();
  for (let offset = -1; offset <= 2; offset++) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1));
    const yyyy = start.getUTCFullYear();
    const mm = String(start.getUTCMonth() + 1).padStart(2, '0');
    const partName = `proof_of_play_${yyyy}_${mm}`;
    await pgClient.unsafe(`
      CREATE TABLE IF NOT EXISTS ${partName}
      PARTITION OF proof_of_play
      FOR VALUES FROM ('${start.toISOString()}') TO ('${end.toISOString()}');
    `);
  }

  const existingUsers = await db
    .select()
    .from(users)
    .where(eq(users.email, config.ADMIN_EMAIL))
    .limit(1);

  if (existingUsers.length === 0) {
    let [org] = await db.select().from(organizations).limit(1);
    if (!org) {
      const orgId = crypto.randomUUID();
      [org] = await db
        .insert(organizations)
        .values({
          id: orgId,
          name: 'Default Organization',
        })
        .returning();
    }

    await db.insert(users).values({
      id: crypto.randomUUID(),
      orgId: org.id,
      email: config.ADMIN_EMAIL,
      name: 'Admin',
      passwordHash: hashPassword(config.ADMIN_PASSWORD),
      role: 'owner',
    });
  }
}
