import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { createTaskSchema, taskQuerySchema } from '../validators/taskValidator';
import * as taskService from '../services/taskService';
import { AuthenticatedRequest } from '../types/common';

const router = Router();

/**
 * GET /tasks
 * List nearby open tasks with filtering and pagination.
 * Query params are validated using taskQuerySchema.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = taskQuerySchema.safeParse(req.query);

    if (!result.success) {
      const fields: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const path = issue.path.join('.');
        const key = path || '_root';
        if (!fields[key]) {
          fields[key] = issue.message;
        }
      }
      const firstMessage = Object.values(fields)[0] || '查询参数验证失败';

      res.status(422).json({
        error: 'validation_error',
        message: firstMessage,
        fields,
      });
      return;
    }

    const response = await taskService.listTasks(result.data);
    res.status(200).json(response);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /tasks/mine
 * List tasks posted by the current authenticated user.
 * Returns all tasks regardless of status, ordered by creation time (newest first).
 */
router.get('/mine', authMiddleware as any, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;

    const result = await taskService.listMyTasks(userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /tasks/mine/has-pending-intents
 * Check if the current user has any pending intents on their posted tasks.
 * Returns { hasPending: boolean }
 */
router.get('/mine/has-pending-intents', authMiddleware as any, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;

    const { query: dbQuery } = await import('../config/database');
    const result = await dbQuery(
      `SELECT COUNT(DISTINCT i.id)::int AS count FROM intents i
       JOIN tasks t ON i.task_id = t.id
       WHERE t.poster_id = $1 AND i.status = 'pending'`,
      [userId]
    );

    const count = result.rows[0]?.count || 0;
    res.status(200).json({ hasPending: count > 0, pendingCount: count });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /tasks/accepted
 * List tasks accepted by the current user (where user is the selected helper).
 * Returns all tasks regardless of status, ordered by creation time (newest first).
 */
router.get('/accepted', authMiddleware as any, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user!.userId;

    const result = await taskService.listAcceptedTasks(userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /tasks/:id
 * Get a single task by ID.
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const task = await taskService.getTask(req.params.id as string);
    res.status(200).json(task);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /tasks
 * Create a new task. Requires authentication.
 * Request body is validated using createTaskSchema via the validate middleware.
 */
router.post(
  '/',
  authMiddleware as any,
  validate(createTaskSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const task = await taskService.createTask(authReq.user!.userId, req.body);
      res.status(201).json(task);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /tasks/:id
 * Update task details (description, reward, location).
 * Only the task poster can edit, and only when status is 'open'.
 */
router.patch(
  '/:id',
  authMiddleware as any,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const taskId = req.params.id as string;
      const {
        description, reward, location, deadline,
        rewardUnit, images, headcount, startTime,
        contactMethod, durationHours, durationUnit,
      } = req.body;

      const payload: Record<string, unknown> = {};
      if (description !== undefined) payload.description = description;
      if (reward !== undefined) payload.reward = reward;
      if (location !== undefined) payload.location = location;
      if (deadline !== undefined) payload.deadline = deadline;
      if (rewardUnit !== undefined) payload.rewardUnit = rewardUnit;
      if (images !== undefined) payload.images = images;
      if (headcount !== undefined) payload.headcount = headcount;
      if (startTime !== undefined) payload.startTime = startTime;
      if (contactMethod !== undefined) payload.contactMethod = contactMethod;
      if (durationHours !== undefined) payload.durationHours = durationHours;
      if (durationUnit !== undefined) payload.durationUnit = durationUnit;

      if (Object.keys(payload).length === 0) {
        res.status(422).json({ error: 'validation_error', message: '请提供需要修改的字段' });
        return;
      }

      const updatedTask = await taskService.updateTask(taskId, authReq.user!.userId, payload);
      res.status(200).json(updatedTask);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /tasks/:id/memo
 * Update the poster's private memo on their own task.
 * Poster-only; allowed in any task status. Body: { posterMemo: string | null }.
 */
router.patch(
  '/:id/memo',
  authMiddleware as any,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const taskId = req.params.id as string;
      const { posterMemo } = req.body;

      if (posterMemo !== null && typeof posterMemo !== 'string') {
        res.status(422).json({ error: 'validation_error', message: 'posterMemo 必须是字符串或 null' });
        return;
      }
      if (typeof posterMemo === 'string' && posterMemo.length > 1000) {
        res.status(422).json({ error: 'validation_error', message: '备注不能超过1000字符' });
        return;
      }

      const updatedTask = await taskService.updateMemo(taskId, authReq.user!.userId, posterMemo ?? null);
      res.status(200).json(updatedTask);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /tasks/:id/status
 * Update task status. Only the task poster can change status.
 * Allowed transitions: in_progress ↔ completed, in_progress → cancelled
 */
router.patch(
  '/:id/status',
  authMiddleware as any,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;
      const taskId = req.params.id as string;
      const { status } = req.body;

      if (!status) {
        res.status(422).json({ error: 'validation_error', message: 'status 字段为必填' });
        return;
      }

      const task = await taskService.getTask(taskId);
      if (task.posterId !== authReq.user!.userId) {
        res.status(403).json({ error: 'forbidden', message: '无权执行此操作' });
        return;
      }

      const updatedTask = await taskService.updateTaskStatus(taskId, status, authReq.user!.userId);
      res.status(200).json(updatedTask);
    } catch (err) {
      next(err);
    }
  }
);

export { router as taskController };
