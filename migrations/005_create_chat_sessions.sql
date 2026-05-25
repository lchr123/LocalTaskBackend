-- Migration: 005_create_chat_sessions
-- Description: Create chat_sessions table for real-time messaging between task posters and helpers

CREATE TABLE chat_sessions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id           UUID NOT NULL REFERENCES tasks(id),
  poster_id         UUID NOT NULL REFERENCES users(id),
  helper_id         UUID NOT NULL REFERENCES users(id),
  last_message      TEXT DEFAULT '',
  last_message_time TIMESTAMPTZ DEFAULT NOW(),
  poster_unread     INTEGER DEFAULT 0,
  helper_unread     INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint: one session per task+poster+helper combination (idempotent creation)
CREATE UNIQUE INDEX idx_chat_sessions_task_users
  ON chat_sessions(task_id, poster_id, helper_id);

-- Index for querying sessions by poster
CREATE INDEX idx_chat_sessions_poster ON chat_sessions(poster_id);

-- Index for querying sessions by helper
CREATE INDEX idx_chat_sessions_helper ON chat_sessions(helper_id);

-- Index for ordering sessions by last message time (most recent first)
CREATE INDEX idx_chat_sessions_last_msg_time ON chat_sessions(last_message_time DESC);
