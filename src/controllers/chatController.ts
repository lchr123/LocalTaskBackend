import { Router, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { AuthenticatedRequest } from '../types/common';
import { parsePagination } from '../utils/pagination';
import * as chatService from '../services/chatService';

const router = Router();

/**
 * GET /chat/sessions
 * List all chat sessions for the authenticated user.
 * Returns sessions with participant info, last message, and unread count.
 *
 * Validates: Requirements 4.7
 */
router.get(
  '/sessions',
  authMiddleware as any,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const result = await chatService.listSessions(userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /chat/has-unread
 * Check if the current user has any unread messages.
 * Returns { hasUnread: boolean }
 */
router.get(
  '/has-unread',
  authMiddleware as any,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const { query: dbQuery } = await import('../config/database');
      const result = await dbQuery(
        `SELECT 1 FROM chat_sessions
         WHERE (poster_id = $1 AND poster_unread > 0)
            OR (helper_id = $1 AND helper_unread > 0)
         LIMIT 1`,
        [userId]
      );
      res.status(200).json({ hasUnread: result.rows.length > 0 });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /chat/sessions/:id/messages
 * List messages for a chat session with pagination.
 * Validates that the user is a participant. Also marks messages as read.
 *
 * Validates: Requirements 4.8, 4.10
 */
router.get(
  '/sessions/:id/messages',
  authMiddleware as any,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = req.params.id as string;
      const userId = req.user!.userId;
      const { page, pageSize } = parsePagination(req.query as { page?: string; pageSize?: string });

      const result = await chatService.listMessages(sessionId, userId, page, pageSize);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /chat/sessions/:id/messages
 * Send a message via REST API (degraded path when WebSocket is unavailable).
 * Requires authentication. Validates and persists the message.
 *
 * Validates: Requirements 4.9
 */
router.post(
  '/sessions/:id/messages',
  authMiddleware as any,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = req.params.id as string;
      const senderId = req.user!.userId;
      const { content, type, imageUrl } = req.body;

      const message = await chatService.sendMessage(
        sessionId,
        senderId,
        content || '',
        type || 'text',
        imageUrl
      );

      res.status(201).json(message);
    } catch (err) {
      next(err);
    }
  }
);

export { router as chatController };
