-- Migration: 016_add_task_kind
-- Description:
--   Adds tasks.kind to distinguish the "周边任务/工作" (task) domain from the
--   new "二手市场" (marketplace) domain. Both domains share the tasks table
--   and its entire surrounding API (intents, chat, reviews, reports) — kind
--   is purely a discriminator, not a new subsystem.
--
--   type continues to be a free-text field controlled by the frontend; under
--   kind='task' it holds the employment-length enum (full_time/part_time/
--   one_time), and under kind='marketplace' the frontend is expected to use a
--   different set of values (item category). This migration does not touch
--   `type` or its existing data.
--
--   DEFAULT 'task' makes this fully backward compatible: existing rows and
--   any client that doesn't yet send `kind` continue to behave exactly as
--   before.

-- Up Migration

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'task'
  CHECK (kind IN ('task', 'marketplace'));

CREATE INDEX IF NOT EXISTS idx_tasks_kind ON tasks(kind);
CREATE INDEX IF NOT EXISTS idx_tasks_kind_status_open ON tasks(kind, status) WHERE status = 'open';


-- Down Migration

DROP INDEX IF EXISTS idx_tasks_kind_status_open;
DROP INDEX IF EXISTS idx_tasks_kind;
ALTER TABLE tasks DROP COLUMN IF EXISTS kind;
