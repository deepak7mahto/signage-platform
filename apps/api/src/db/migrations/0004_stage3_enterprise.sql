-- Stage 3 & Enterprise Phase 6: TOTP 2FA, Asset Versioning, Multi-Orientation Variants, SOV, Feeds & Triggers

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS parent_asset_id UUID REFERENCES media_assets(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS media_asset_variants (
  id UUID PRIMARY KEY,
  asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  orientation TEXT NOT NULL,
  object_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  sha256 TEXT,
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_variants_asset_orient ON media_asset_variants(asset_id, orientation);

ALTER TABLE playlists ADD COLUMN IF NOT EXISTS loop_mode TEXT NOT NULL DEFAULT 'sequential';
ALTER TABLE playlist_items ADD COLUMN IF NOT EXISTS weight INTEGER NOT NULL DEFAULT 100;

CREATE TABLE IF NOT EXISTS data_feeds (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  poll_interval_sec INTEGER NOT NULL DEFAULT 300,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_payload JSONB,
  last_fetched_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_feeds_org ON data_feeds(org_id);

CREATE TABLE IF NOT EXISTS screen_triggers (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_key TEXT NOT NULL UNIQUE,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  duration_sec INTEGER NOT NULL DEFAULT 300,
  priority INTEGER NOT NULL DEFAULT 950,
  secret_hash TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_fired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_screen_triggers_org ON screen_triggers(org_id);
