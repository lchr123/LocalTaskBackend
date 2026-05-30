-- Migration: 009_create_device_tokens
-- Description: Create device_tokens table for push notification token storage
-- Up Migration
CREATE TABLE device_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id),
  token       VARCHAR(500) NOT NULL,
  platform    VARCHAR(10) NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint: one token per user per platform (upsert on re-registration)
CREATE UNIQUE INDEX idx_device_tokens_user_platform
  ON device_tokens(user_id, platform);

-- Down Migration

DROP INDEX IF EXISTS idx_device_tokens_user_platform;

DROP TABLE IF EXISTS device_tokens;