CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash TEXT NOT NULL,
  revoked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user
  ON user_sessions(user_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_hash
  ON user_sessions(refresh_hash);

CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  lan_cache_url TEXT,
  alert_policy JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sites_org
  ON sites(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS device_config_profiles (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_profiles_org
  ON device_config_profiles(org_id, created_at DESC);

ALTER TABLE screens ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id) ON DELETE SET NULL;
ALTER TABLE screens ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES device_config_profiles(id) ON DELETE SET NULL;
ALTER TABLE screens ADD COLUMN IF NOT EXISTS manifest_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE screens ADD COLUMN IF NOT EXISTS playback_state TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE screens ADD COLUMN IF NOT EXISTS last_frame_advance_at TIMESTAMPTZ;
ALTER TABLE screens ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE screens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_screens_site ON screens(site_id);
CREATE INDEX IF NOT EXISTS idx_screens_revoked ON screens(org_id, revoked_at);

ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS failure_reason TEXT;

ALTER TABLE screen_commands ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE screen_commands ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE screen_commands ADD COLUMN IF NOT EXISTS coalesce_key TEXT;
ALTER TABLE screen_commands ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_screen_commands_claim
  ON screen_commands(screen_id, status, expires_at);
