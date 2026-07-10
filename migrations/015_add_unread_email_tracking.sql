-- Migration: 015_add_unread_email_tracking
-- Description:
--   Tracks the last time each user was sent an "unread messages" reminder
--   email, so the daily scan can guarantee at most one such email per user
--   per 24h (see notificationEmailService.runUnreadReminders).
--   Reuses users.email_opt_in as the notification preference (same flag
--   already used by the weekly digest).

-- Up Migration

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_unread_email_at TIMESTAMPTZ;

-- Speeds up the candidate scan (WHERE poster_unread > 0 / helper_unread > 0)
CREATE INDEX IF NOT EXISTS idx_chat_sessions_poster_unread
  ON chat_sessions(poster_id) WHERE poster_unread > 0;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_helper_unread
  ON chat_sessions(helper_id) WHERE helper_unread > 0;


-- Down Migration

DROP INDEX IF EXISTS idx_chat_sessions_helper_unread;
DROP INDEX IF EXISTS idx_chat_sessions_poster_unread;
ALTER TABLE users DROP COLUMN IF EXISTS last_unread_email_at;
