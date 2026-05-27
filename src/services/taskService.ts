import { Task, TaskStatus, CreateTaskPayload } from '../types/task';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors';
import * as taskRepository from '../repositories/taskRepository';

/**
 * Valid state transitions for the task state machine.
 * Key: current status, Value: set of allowed next statuses.
 */
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  open: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: ['in_progress'],  // Allow poster to revert to in_progress
  cancelled: [],
};

export interface ListTasksParams {
  lat: number;
  lng: number;
  radius: number;
  type?: string;
  minReward?: number;
  maxReward?: number;
  page: number;
  pageSize: number;
}

export interface ListTasksResponse {
  tasks: Task[];
  page: number;
  totalPages: number;
  totalCount: number;
}

/**
 * List tasks posted by a specific user, ordered by creation time (newest first).
 */
export async function listMyTasks(userId: string): Promise<{ tasks: Task[] }> {
  const { query: dbQuery } = await import('../config/database');
  const result = await dbQuery<Task>(
    `SELECT id, poster_id AS "posterId", type, description,
            location_address AS "locationAddress",
            ST_Y(location::geometry) AS "latitude",
            ST_X(location::geometry) AS "longitude",
            reward, deadline, status, intent_count AS "intentCount",
            selected_helper_id AS "selectedHelperId",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM tasks
     WHERE poster_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return { tasks: result.rows };
}

/**
 * List nearby open tasks with filtering and pagination.
 */
export async function listTasks(params: ListTasksParams): Promise<ListTasksResponse> {
  const { lat, lng, radius, type, minReward, maxReward, page, pageSize } = params;
  const offset = (page - 1) * pageSize;

  const [tasks, totalCount] = await Promise.all([
    taskRepository.findNearby({ lat, lng, radius, type, minReward, maxReward, pageSize, offset }),
    taskRepository.countNearby({ lat, lng, radius, type, minReward, maxReward }),
  ]);

  const totalPages = Math.ceil(totalCount / pageSize);

  return {
    tasks,
    page,
    totalPages,
    totalCount,
  };
}

/**
 * Get a single task by ID.
 * Throws NotFoundError if the task does not exist.
 */
export async function getTask(taskId: string): Promise<Task> {
  const task = await taskRepository.findById(taskId);

  if (!task) {
    throw new NotFoundError('任务不存在');
  }

  return task;
}

/**
 * Create a new task.
 * Validates that the deadline is in the future before creating.
 */
export async function createTask(userId: string, payload: CreateTaskPayload): Promise<Task> {
  const deadlineDate = new Date(payload.deadline);
  if (deadlineDate <= new Date()) {
    throw new ValidationError({ deadline: '截止时间必须晚于当前时间' });
  }

  return taskRepository.create(userId, payload);
}

/**
 * Update a task's status with state machine validation.
 * Throws NotFoundError if the task does not exist.
 * Throws ConflictError if the state transition is invalid.
 */
export async function updateTaskStatus(
  taskId: string,
  newStatus: TaskStatus,
  userId: string
): Promise<Task> {
  const task = await taskRepository.findById(taskId);

  if (!task) {
    throw new NotFoundError('任務不存在');
  }

  const allowedTransitions = VALID_TRANSITIONS[task.status];
  if (!allowedTransitions.includes(newStatus)) {
    throw new ConflictError('invalid_state_transition', '当前状态不允许此操作');
  }

  const updatedTask = await taskRepository.updateStatus(taskId, newStatus);

  if (!updatedTask) {
    throw new NotFoundError('任務不存在');
  }

  return updatedTask;
}
