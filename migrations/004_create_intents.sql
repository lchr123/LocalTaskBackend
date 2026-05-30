-- Migration: 004_create_intents
-- Description: Create intents table with unique partial constraint and CASCADE foreign key
-- Requirements: 9.3, 9.9
-- Up Migration
CREATE TABLE intents (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  helper_id   UUID NOT NULL REFERENCES users(id),
  message     VARCHAR(200),
  status      VARCHAR(20) NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'selected', 'rejected', 'withdrawn')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Unique partial index: same helper can only have one pending intent per task
CREATE UNIQUE INDEX idx_intents_unique_pending
  ON intents(task_id, helper_id) WHERE status = 'pending';

-- B-tree indexes for common query patterns
CREATE INDEX idx_intents_task_id ON intents(task_id);
CREATE INDEX idx_intents_helper_id ON intents(helper_id);


-- Down Migration

DROP INDEX IF EXISTS idx_intents_helper_id;
DROP INDEX IF EXISTS idx_intents_task_id;
DROP INDEX IF EXISTS idx_intents_unique_pending;

DROP TABLE IF EXISTS intents;