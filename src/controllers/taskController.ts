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

export { router as taskController };
