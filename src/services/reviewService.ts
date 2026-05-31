/**
 * Review Service - Business logic for review submission and rating aggregation.
 *
 * Handles:
 * - Submitting reviews (with comprehensive validation)
 * - Retrieving user review summaries
 *
 * Business rules:
 * - Task must be in 'completed' status
 * - Reviewer must be a participant (poster or helper) of the task
 * - Task completion must be within 14 days (336 hours)
 * - No duplicate reviews (one review per user per task)
 * - On success: recalculate averageRating and update users table (transactional)
 * - Reviews are immutable (no PUT/DELETE)
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */

import { Review, ReviewSummary } from '../types/review';
import { AppError, ConflictError, NotFoundError } from '../utils/errors';
import { query, getClient } from '../config/database';
import * as reviewRepository from '../repositories/reviewRepository';
import { logger } from '../utils/logger';

/** Maximum days after task completion that a review can be submitted */
const REVIEW_WINDOW_DAYS = 14;
const REVIEW_WINDOW_MS = REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000; // 336 hours in ms

interface SubmitReviewPayload {
  taskId: string;
  revieweeId: string;
  rating: number;
  comment?: string;
}

interface TaskForReview {
  id: string;
  poster_id: string;
  selected_helper_id: string | null;
  status: string;
  updated_at: string;
}

/**
 * Submit a review for a completed task.
 *
 * Validation steps:
 * 1. Task must exist
 * 2. Task must be in 'completed' status
 * 3. Reviewer must be a participant (poster or helper)
 * 4. Task completion must be within 14 days
 * 5. No duplicate review for this task+reviewer
 *
 * On success (within a transaction):
 * - Insert review record
 * - Recalculate reviewee's averageRating
 * - Update users table with new averageRating
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 */
export async function submitReview(
  reviewerId: string,
  payload: SubmitReviewPayload
): Promise<Review> {
  const { taskId, revieweeId, rating, comment } = payload;

  // 1. Fetch task details
  const taskResult = await query<TaskForReview>(
    `SELECT id, poster_id, selected_helper_id, status, updated_at
     FROM tasks WHERE id = $1`,
    [taskId]
  );

  if (taskResult.rows.length === 0) {
    throw new NotFoundError('任务不存在');
  }

  const task = taskResult.rows[0];

  // 2. Task must be completed
  if (task.status !== 'completed') {
    throw new AppError(409, 'invalid_state_transition', '只能对已完成的任务进行评价');
  }

  // 3. Reviewer must be a participant (poster or helper)
  const isParticipant =
    task.poster_id === reviewerId || task.selected_helper_id === reviewerId;

  if (!isParticipant) {
    throw new AppError(403, 'forbidden', '只有任务参与者才能提交评价');
  }

  // 4. Check review window (14 days from task completion)
  const completedAt = new Date(task.updated_at).getTime();
  const now = Date.now();
  if (now - completedAt > REVIEW_WINDOW_MS) {
    throw new AppError(410, 'review_expired', '评价窗口已关闭，任务完成超过14天');
  }

  // 5. Check for duplicate review
  const alreadyReviewed = await reviewRepository.existsByTaskAndReviewer(taskId, reviewerId);
  if (alreadyReviewed) {
    throw new ConflictError('duplicate_review', '您已对该任务提交过评价');
  }

  // Execute within a transaction: create review + recalculate rating + update user
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Insert review
    let review: Review;
    try {
      review = await reviewRepository.create(reviewerId, payload, client);
    } catch (err: unknown) {
      // Handle unique constraint violation (race condition fallback)
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        throw new ConflictError('duplicate_review', '您已对该任务提交过评价');
      }
      throw err;
    }

    // Recalculate average rating for the reviewee
    const newAvgRating = await reviewRepository.calculateAverageRating(revieweeId, client);

    // Update user's average_rating
    await client.query(
      'UPDATE users SET average_rating = $1, updated_at = NOW() WHERE id = $2',
      [newAvgRating, revieweeId]
    );

    await client.query('COMMIT');

    logger.info('Review submitted successfully', {
      reviewId: review.id,
      taskId,
      reviewerId,
      revieweeId,
      rating,
      newAvgRating,
    });

    return review;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get review summary for a user (reviews received).
 */
export async function getUserReviews(userId: string): Promise<ReviewSummary> {
  const reviews = await reviewRepository.findByReviewee(userId);

  let averageRating = 0;
  if (reviews.length > 0) {
    const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
    averageRating = parseFloat((sum / reviews.length).toFixed(1));
  }

  return {
    averageRating,
    totalReviews: reviews.length,
    reviews,
  };
}

/**
 * Get reviews given by a user.
 */
export async function getUserReviewsGiven(userId: string): Promise<{ totalReviews: number; reviews: Review[] }> {
  const reviews = await reviewRepository.findByReviewer(userId);
  return {
    totalReviews: reviews.length,
    reviews,
  };
}
