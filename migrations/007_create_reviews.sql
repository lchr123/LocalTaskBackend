-- Migration: 007_create_reviews
-- Description: Create reviews table for task completion ratings between participants

CREATE TABLE reviews (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id     UUID NOT NULL REFERENCES tasks(id),
  reviewer_id UUID NOT NULL REFERENCES users(id),
  reviewee_id UUID NOT NULL REFERENCES users(id),
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     VARCHAR(500),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint: one review per task per reviewer (prevents duplicate reviews)
CREATE UNIQUE INDEX idx_reviews_unique ON reviews(task_id, reviewer_id);

-- Index for querying reviews received by a user
CREATE INDEX idx_reviews_reviewee ON reviews(reviewee_id);

-- Composite index for querying reviews by reviewee ordered by creation time (newest first)
CREATE INDEX idx_reviews_created_at ON reviews(reviewee_id, created_at DESC);
