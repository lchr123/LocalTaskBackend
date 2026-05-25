import { query } from '../config/database';
import { Review } from '../types/review';
import { PoolClient } from 'pg';

interface ReviewRow {
  id: string;
  task_id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

function mapRowToReview(row: ReviewRow): Review {
  return {
    id: row.id,
    taskId: row.task_id,
    reviewerId: row.reviewer_id,
    revieweeId: row.reviewee_id,
    rating: row.rating,
    comment: row.comment ?? undefined,
    createdAt: row.created_at,
  };
}

/**
 * Create a new review record.
 * Uses the UNIQUE constraint on (task_id, reviewer_id) to prevent duplicates.
 * Accepts an optional PoolClient for transaction support.
 *
 * Validates: Requirements 5.1, 9.4
 */
export async function create(
  reviewerId: string,
  payload: { taskId: string; revieweeId: string; rating: number; comment?: string },
  client?: PoolClient
): Promise<Review> {
  const sql = `
    INSERT INTO reviews (task_id, reviewer_id, reviewee_id, rating, comment)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, task_id, reviewer_id, reviewee_id, rating, comment, created_at
  `;

  const values = [
    payload.taskId,
    reviewerId,
    payload.revieweeId,
    payload.rating,
    payload.comment ?? null,
  ];

  const executor = client || { query: (text: string, params?: unknown[]) => query<ReviewRow>(text, params) };
  const result = await executor.query(sql, values);
  const row = (result as { rows: ReviewRow[] }).rows[0];
  return mapRowToReview(row);
}

/**
 * Find all reviews received by a user, ordered by created_at DESC.
 *
 * Validates: Requirements 5.7
 */
export async function findByReviewee(userId: string): Promise<Review[]> {
  const sql = `
    SELECT id, task_id, reviewer_id, reviewee_id, rating, comment, created_at
    FROM reviews
    WHERE reviewee_id = $1
    ORDER BY created_at DESC
  `;

  const result = await query<ReviewRow>(sql, [userId]);
  return result.rows.map(mapRowToReview);
}

/**
 * Calculate the average rating for a user.
 * Returns ROUND(AVG(rating)::numeric, 1) or 0 if no reviews exist.
 * Accepts an optional PoolClient for transaction support.
 *
 * Validates: Requirements 5.5
 */
export async function calculateAverageRating(
  userId: string,
  client?: PoolClient
): Promise<number> {
  const sql = `
    SELECT COALESCE(ROUND(AVG(rating)::numeric, 1), 0) AS avg_rating
    FROM reviews
    WHERE reviewee_id = $1
  `;

  const executor = client || { query: (text: string, params?: unknown[]) => query<{ avg_rating: string }>(text, params) };
  const result = await executor.query(sql, [userId]);
  const row = (result as { rows: { avg_rating: string }[] }).rows[0];
  return parseFloat(row.avg_rating);
}

/**
 * Check if a review already exists for a given task and reviewer.
 *
 * Validates: Requirements 5.4, 9.4
 */
export async function existsByTaskAndReviewer(
  taskId: string,
  reviewerId: string
): Promise<boolean> {
  const sql = `
    SELECT 1 FROM reviews
    WHERE task_id = $1 AND reviewer_id = $2
    LIMIT 1
  `;

  const result = await query<{ '?column?': number }>(sql, [taskId, reviewerId]);
  return result.rows.length > 0;
}
