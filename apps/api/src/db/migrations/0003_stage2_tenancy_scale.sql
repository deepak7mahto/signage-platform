ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS org_type TEXT NOT NULL DEFAULT 'standalone';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS quotas JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE organizations
SET slug = COALESCE(
  NULLIF(slug, ''),
  REGEXP_REPLACE(LOWER(name), '[^a-z0-9]+', '-', 'g') || '-' || SUBSTRING(id::text, 1, 6)
)
WHERE slug IS NULL OR slug = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);

CREATE TABLE IF NOT EXISTS org_memberships (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, org_id)
);

INSERT INTO org_memberships (user_id, org_id, role)
SELECT id, org_id, role FROM users
ON CONFLICT (user_id, org_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS agency_client_grants (
  id UUID PRIMARY KEY,
  agency_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  permissions JSONB NOT NULL DEFAULT '["manage_screens","manage_schedules","manage_media"]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agency_org_id, client_org_id)
);

CREATE INDEX IF NOT EXISTS idx_agency_grants_agency
  ON agency_client_grants(agency_org_id, status);

ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS valid_from TEXT;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS valid_until TEXT;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS shared_with_clients BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS pop_hourly_rollups (
  org_id UUID NOT NULL,
  screen_id UUID NOT NULL,
  media_asset_id UUID NOT NULL,
  hour_bucket TIMESTAMPTZ NOT NULL,
  plays INTEGER NOT NULL DEFAULT 0,
  completed_plays INTEGER NOT NULL DEFAULT 0,
  total_duration_ms BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, screen_id, media_asset_id, hour_bucket)
);

CREATE INDEX IF NOT EXISTS idx_pop_rollups_org_hour
  ON pop_hourly_rollups(org_id, hour_bucket DESC);
