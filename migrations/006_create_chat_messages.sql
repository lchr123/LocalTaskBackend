-- Migration: 006_create_chat_messages
-- Description: Create chat_messages table for storing individual messages within chat sessions
-- Up Migration
CREATE TABLE chat_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID NOT NULL REFERENCES chat_sessions(id),
  sender_id   UUID NOT NULL REFERENCES users(id),
  content     TEXT NOT NULL,
  type        VARCHAR(10) NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image')),
  image_url   VARCHAR(500),
  timestamp   TIMESTAMPTZ DEFAULT NOW()
);

-- Composite index for efficient message retrieval by session ordered by time (newest first)
CREATE INDEX idx_chat_messages_session_time
  ON chat_messages(session_id, timestamp DESC);


-- Down Migration

DROP INDEX IF EXISTS idx_chat_messages_session_time;

DROP TABLE IF EXISTS chat_messages;