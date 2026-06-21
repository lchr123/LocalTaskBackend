import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { submitIntentSchema, selectHelperSchema } from '../validators/intentValidator';
import * as intentService from '../services/intentService';
import { AuthenticatedRequest } from '../types/common';

const router = Router({ mergeParams: true });

/**
 * POST /tasks/:id/intents
 * Submit an intent for a task. Requires authentication.
 * Request body validated with submitIntentSchema (optional message field).
 *
 * Validates: Requirements 3.1
 */
router.post(
  '/',
  authMiddleware as any,
  validate(submitIntentSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const taskId = req.params.id as string;
      const helperId = req.user!.userId;
      const { message } = req.body;

      const intent = await intentService.submitIntent(taskId, helperId, message);
      res.status(201).json(intent);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /tasks/:id/intents/:intentId
 * Withdraw an intent. Requires authentication.
 * Only the intent owner can withdraw their own intent.
 *
 * Validates: Requirements 3.5
 */
router.delete(
  '/:intentId',
  authMiddleware as any,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const taskId = req.params.id as string;
      const intentId = req.params.intentId as string;
      const userId = req.user!.userId;

      await intentService.withdrawIntent(taskId, intentId, userId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /tasks/:id/intents/mine
 * Check if the current user has a pending intent for this task.
 * Returns the intent if exists, or 404 if not.
 */
router.get(
  '/mine',
  authMiddleware as any,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const taskId = req.params.id as string;
      const helperId = req.user!.userId;

      const { query: dbQuery } = await import('../config/database');
      const result = await dbQuery<{ id: string; message: string | null; status: string; created_at: string }>(
        `SELECT id, message, status, created_at FROM intents
         WHERE task_id = $1 AND helper_id = $2 AND status = 'pending'
         LIMIT 1`,
        [taskId, helperId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ hasIntent: false });
        return;
      }

      res.status(200).json({
        hasIntent: true,
        intent: result.rows[0],
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /tasks/:id/intents
 * List all intents for a task. Requires authentication.
 * Only the task poster can view the intent list.
 *
 * Validates: Requirements 3.6
 */
router.get(
  '/',
  authMiddleware as any,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const taskId = req.params.id as string;
      const requesterId = req.user!.userId;

      const result = await intentService.listIntents(taskId, requesterId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

export { router as intentController };

/**
 * Separate router for select-helper endpoint, mounted at /tasks/:id/select-helper.
 */
const selectHelperRouter = Router({ mergeParams: true });

/**
 * POST /tasks/:id/select-helper
 * Select a helper for a task. Requires authentication.
 * Only the task poster can select a helper. Body must contain helperId.
 *
 * Validates: Requirements 3.7
 */
selectHelperRouter.post(
  '/',
  authMiddleware as any,
  validate(selectHelperSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const taskId = req.params.id as string;
      const posterId = req.user!.userId;
      const { helperId } = req.body;

      const updatedTask = await intentService.selectHelper(taskId, helperId, posterId);
      res.status(200).json(updatedTask);
    } catch (err) {
      next(err);
    }
  }
);

export { selectHelperRouter };

/**
 * Separate router for the start-chat-with-applicant endpoint,
 * mounted at /tasks/:id/chat.
 */
const chatWithApplicantRouter = Router({ mergeParams: true });

/**
 * POST /tasks/:id/chat
 * Poster starts (or reuses) a chat session with an applicant while the task
 * is still open — without selecting them. Body must contain helperId.
 * Only the task poster can call this, and only for users with a pending intent.
 */
chatWithApplicantRouter.post(
  '/',
  authMiddleware as any,
  validate(selectHelperSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const taskId = req.params.id as string;
      const posterId = req.user!.userId;
      const { helperId } = req.body;

      const result = await intentService.startChatWithApplicant(taskId, helperId, posterId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

export { chatWithApplicantRouter };
