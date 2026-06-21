-- Migration: 012_add_task_fields
-- Description:
--   1. Change reward to an INTEGER in range 0 .. 100,000,000 (一亿)
--   2. reward_unit: optional billing unit (once/hour/day/month)
--   3. images: array of S3 object keys for task photos
--   4. poster_memo: a private note only the poster can see/edit on their own tasks
--   5. headcount: number of helpers to recruit
--   6. start_time: planned start time (distinct from deadline)
--   7. contact_method: preferred contact channel
--   8. duration_hours + duration_unit: estimated time, e.g. "2.5 小时/次", "6 小时/日"
-- Note: Does not modify existing migration files; all changes are additive/altering here.

-- Up Migration

-- 1. reward: DECIMAL(7,2) -> INTEGER, new range 0 .. 100,000,000
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_reward_check;
ALTER TABLE tasks ALTER COLUMN reward TYPE INTEGER USING ROUND(reward)::integer;
ALTER TABLE tasks ALTER COLUMN reward SET DEFAULT 0;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_reward_check CHECK (reward BETWEEN 0 AND 100000000);

-- 2. reward_unit: optional (NULL allowed)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reward_unit VARCHAR(10)
  CHECK (reward_unit IS NULL OR reward_unit IN ('once', 'hour', 'day', 'month'));

-- 3. Task images: array of S3 object keys (presigned on read, like chat images)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS images TEXT[] NOT NULL DEFAULT '{}';

-- 4. Poster-only private memo (visibility/edit enforced in the application layer)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS poster_memo TEXT
  CHECK (poster_memo IS NULL OR char_length(poster_memo) <= 1000);

-- 5. Headcount: how many helpers are needed (default 1)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS headcount INTEGER NOT NULL DEFAULT 1
  CHECK (headcount BETWEEN 1 AND 999);

-- 6. Planned start time (optional; distinct from deadline)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ;

-- 7. Preferred contact method (optional, free text — e.g. "LINE: xxx", "小红书: xxx")
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS contact_method VARCHAR(100)
  CHECK (contact_method IS NULL OR char_length(contact_method) <= 100);

-- 8. Estimated duration in hours + its per-unit (optional)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS duration_hours DECIMAL(4,1)
  CHECK (duration_hours IS NULL OR (duration_hours > 0 AND duration_hours <= 999.9));
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS duration_unit VARCHAR(10)
  CHECK (duration_unit IS NULL OR duration_unit IN ('once', 'day', 'week', 'month'));


-- Down Migration

ALTER TABLE tasks DROP COLUMN IF EXISTS duration_unit;
ALTER TABLE tasks DROP COLUMN IF EXISTS duration_hours;
ALTER TABLE tasks DROP COLUMN IF EXISTS contact_method;
ALTER TABLE tasks DROP COLUMN IF EXISTS start_time;
ALTER TABLE tasks DROP COLUMN IF EXISTS headcount;
ALTER TABLE tasks DROP COLUMN IF EXISTS poster_memo;
ALTER TABLE tasks DROP COLUMN IF EXISTS images;
ALTER TABLE tasks DROP COLUMN IF EXISTS reward_unit;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_reward_check;
ALTER TABLE tasks ALTER COLUMN reward DROP DEFAULT;
ALTER TABLE tasks ALTER COLUMN reward TYPE DECIMAL(7,2) USING reward::decimal(7,2);
ALTER TABLE tasks
  ADD CONSTRAINT tasks_reward_check CHECK (reward BETWEEN 0.01 AND 99999.99);
