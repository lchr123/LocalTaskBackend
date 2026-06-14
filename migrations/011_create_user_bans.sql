-- Migration: 011_create_user_bans
-- Description: Create user_bans table for tracking account suspensions/bans
-- Up Migration

CREATE TABLE user_bans (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      VARCHAR(500) NOT NULL,
  banned_by   VARCHAR(100) NOT NULL DEFAULT 'admin',
  banned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  unbanned_at TIMESTAMPTZ
);

CREATE INDEX idx_user_bans_active ON user_bans(user_id, is_active) WHERE is_active = true;

-- Down Migration

DROP INDEX IF EXISTS idx_user_bans_active;
DROP TABLE IF EXISTS user_bans;
