-- Migration: 003_create_tasks
-- Description: Create tasks table with PostGIS geography Point, CHECK constraints, and spatial indexes
-- Requirements: 9.2, 9.5, 9.6, 9.7
-- Up Migration
CREATE TABLE tasks (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  poster_id         UUID NOT NULL REFERENCES users(id),
  type              VARCHAR(20) NOT NULL
                    CHECK (type IN ('delivery', 'shopping', 'dog_walking', 'queuing', 'pickup')),
  description       TEXT NOT NULL CHECK (char_length(description) BETWEEN 10 AND 500),
  location_address  VARCHAR(200) NOT NULL,
  location          geography(Point, 4326) NOT NULL,
  reward            DECIMAL(7,2) NOT NULL CHECK (reward BETWEEN 0.01 AND 99999.99),
  deadline          TIMESTAMPTZ NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  intent_count      INTEGER DEFAULT 0,
  selected_helper_id UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- GIST spatial index for geography queries (ST_DWithin)
CREATE INDEX idx_tasks_location ON tasks USING GIST(location);

-- B-tree indexes for common query patterns
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_poster_id ON tasks(poster_id);
CREATE INDEX idx_tasks_created_at ON tasks(created_at DESC);

-- Partial index for open tasks (most common query filter)
CREATE INDEX idx_tasks_status_location ON tasks(status) WHERE status = 'open';


-- Down Migration

DROP INDEX IF EXISTS idx_tasks_status_location;
DROP INDEX IF EXISTS idx_tasks_created_at;
DROP INDEX IF EXISTS idx_tasks_poster_id;
DROP INDEX IF EXISTS idx_tasks_status;
DROP INDEX IF EXISTS idx_tasks_location;

DROP TABLE IF EXISTS tasks;