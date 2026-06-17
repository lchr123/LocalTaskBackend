import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import * as userService from '../services/userService';
import { AuthenticatedRequest } from '../types/common';

const router = Router();

/**
 * GET /users/helper-tags
 * Returns all available helper tags.
 */
router.get(
  '/helper-tags',
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { query: dbQuery } = await import('../config/database');
      const result = await dbQuery('SELECT id, name, label_zh, category FROM helper_tags ORDER BY category, name');
      res.status(200).json({ tags: result.rows });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /users/me
 * Returns the current authenticated user's profile.
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
 * PATCH /users/me
 * Update the current authenticated user's profile.
 */
router.patch(
  '/me',
  authMiddleware as any,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const { nickname, avatarUrl, birthday, address, bio, gender } = req.body;

      const user = await userService.updateProfile(authReq.user!.userId, {
        nickname,
        avatarUrl,
        birthday,
        gender,
        address,
        bio,
      });

      res.status(200).json(user);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /users/:id
 * Returns a user's public profile by ID.
 * MUST be registered AFTER all /users/xxx specific routes to avoid matching.
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
 * GET /users/:id/tags
 * Returns a user's helper tags (public).
 */
router.get(
  '/:id/tags',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { query: dbQuery } = await import('../config/database');
      const result = await dbQuery(
        `SELECT ht.id, ht.name, ht.label_zh, ht.category
         FROM user_helper_tags uht
         JOIN helper_tags ht ON uht.tag_id = ht.id
         WHERE uht.user_id = $1`,
        [req.params.id]
      );
      res.status(200).json({ tags: result.rows });
    } catch (err) {
      next(err);
    }
  }
);

export { router as userController };
