-- Migration: 008_create_reports
-- Description: Create reports table for user/task abuse reporting
-- Up Migration
CREATE TABLE reports (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id UUID NOT NULL REFERENCES users(id),
  target_type VARCHAR(10) NOT NULL CHECK (target_type IN ('user', 'task')),
  target_id   UUID NOT NULL,
  type        VARCHAR(30) NOT NULL
              CHECK (type IN ('fake_task', 'harassment', 'fraud', 'inappropriate_content', 'other')),
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 1000),
  image_urls  TEXT[] DEFAULT '{}',
  status      VARCHAR(20) NOT NULL DEFAULT 'submitted'
              CHECK (status IN ('submitted', 'reviewing', 'resolved')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying reports by target (type + id combination)
CREATE INDEX idx_reports_target ON reports(target_type, target_id);

-- Index for filtering reports by status
CREATE INDEX idx_reports_status ON reports(status);

-- Down Migration

DROP INDEX IF EXISTS idx_reports_status;
DROP INDEX IF EXISTS idx_reports_target;

DROP TABLE IF EXISTS reports;