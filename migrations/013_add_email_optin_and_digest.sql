-- Migration: 013_add_email_optin_and_digest
-- Description:
--   1. users.email_opt_in: opt-out marketing flag (default true = receives digest)
--   2. weekly_digest_runs: idempotency + audit log for the weekly digest email

-- Up Migration

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_opt_in BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS weekly_digest_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  week_start      DATE NOT NULL UNIQUE,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count      INTEGER NOT NULL DEFAULT 0,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  new_task_count  INTEGER NOT NULL DEFAULT 0,
  status          VARCHAR(20) NOT NULL DEFAULT 'completed',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);


-- Down Migration

DROP TABLE IF EXISTS weekly_digest_runs;
ALTER TABLE users DROP COLUMN IF EXISTS email_opt_in;
