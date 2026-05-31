import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import * as userService from '../services/userService';
import { AuthenticatedRequest } from '../types/common';

const router = Router();

/**
 * GET /users/me
 * Returns the current authenticated user's profile.
 *
 * Validates: Requirements 1.5
 */
router.get(
  '/me',
  authMiddleware as any,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const user = await userService.getProfile(authReq.user!.userId);
      res.status(200).json(user);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /users/:id
 * Returns a user's public profile by ID.
 */
router.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await userService.getProfile(req.params.id as string);
      res.status(200).json(user);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /users/me
 * Update the current authenticated user's nickname and/or avatarUrl.
 *
 * Validates: Requirements 1.6
 */
router.patch(
  '/me',
  authMiddleware as any,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const { nickname, avatarUrl } = req.body;

      const user = await userService.updateProfile(authReq.user!.userId, {
        nickname,
        avatarUrl,
      });

      res.status(200).json(user);
    } catch (err) {
      next(err);
    }
  }
);

export { router as userController };
