import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { createReviewSchema } from '../validators/reviewValidator';
import * as reviewService from '../services/reviewService';
import { AuthenticatedRequest } from '../types/common';

const router = Router();

/**
 * POST /reviews
 * Submit a review for a completed task. Requires authentication.
 * Request body is validated using createReviewSchema via the validate middleware.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */
router.post(
  '/',
  authMiddleware as any,
  validate(createReviewSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const review = await reviewService.submitReview(authReq.user!.userId, req.body);
      res.status(201).json(review);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /users/:id/reviews
 * Get review summary for a user. No authentication required.
 *
 * Returns: { averageRating, totalReviews, reviews }
 *
 * Validates: Requirements 5.7
 */
export async function getUserReviews(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.params.id as string;
    const summary = await reviewService.getUserReviews(userId);
    res.status(200).json(summary);
  } catch (err) {
    next(err);
  }
}

export { router as reviewController };
