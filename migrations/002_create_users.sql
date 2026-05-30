-- Migration: Create users table
-- Up Migration

CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cognito_sub           VARCHAR(128) UNIQUE NOT NULL,
  email                 VARCHAR(255),
  phone                 VARCHAR(20),
  nickname              VARCHAR(50),
  avatar_url            VARCHAR(500),
  average_rating        DECIMAL(2,1) DEFAULT 0.0,
  completed_task_count  INTEGER DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_cognito_sub ON users(cognito_sub);

-- Down Migration
---- create above / drop below ----

DROP INDEX IF EXISTS idx_users_cognito_sub;
DROP TABLE IF EXISTS users;
