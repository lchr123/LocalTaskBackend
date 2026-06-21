import { Task, TaskStatus, CreateTaskPayload, UpdateTaskPayload } from '../types/task';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors';
import * as taskRepository from '../repositories/taskRepository';
import { getPresignedUrl } from './uploadService';

/**
 * Presign all task image URLs for secure temporary access (like chat images).
 */
async function presignImages(images: string[] | undefined): Promise<string[]> {
  if (!images || images.length === 0) return [];
  return Promise.all(images.map((url) => getPresignedUrl(url)));
}

async function enrichTask(task: Task): Promise<Task> {
  return { ...task, images: await presignImages(task.images) };
}

async function enrichTasks(tasks: Task[]): Promise<Task[]> {
  return Promise.all(tasks.map(enrichTask));
}

/**
 * Normalize an image URL for storage: strip any presigned query string so the
 * DB always holds the clean, stable S3 URL (presigned URLs expire and would
 * otherwise be re-stored when a task is edited).
 */
function cleanImageUrl(url: string): string {
  return url.split('?')[0];
}

/**
 * Valid state transitions for the task state machine.
 * Key: current status, Value: set of allowed next statuses.
 */
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  open: ['in_progress', 'cancelled'],
  in_progress: ['open', 'completed', 'cancelled'],  // open = cancel selection, return to hall
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
  sort?: string;
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
    `SELECT t.id, t.poster_id AS "posterId", t.type, t.description,
            t.location_address AS "locationAddress",
            ST_Y(t.location::geometry) AS "latitude",
            ST_X(t.location::geometry) AS "longitude",
            t.reward, t.reward_unit AS "rewardUnit",
            t.deadline, t.status, t.intent_count AS "intentCount",
            t.selected_helper_id AS "selectedHelperId",
            t.created_at AS "createdAt", t.updated_at AS "updatedAt",
            t.images AS "images", t.headcount AS "headcount",
            t.start_time AS "startTime", t.contact_method AS "contactMethod",
            t.duration_hours::float AS "durationHours", t.duration_unit AS "durationUnit",
            t.poster_memo AS "posterMemo",
            CASE WHEN r.id IS NOT NULL THEN true ELSE false END AS "hasReview"
     FROM tasks t
     LEFT JOIN reviews r ON r.task_id = t.id AND r.reviewer_id = $1
     WHERE t.poster_id = $1
     ORDER BY t.created_at DESC`,
    [userId]
  );
  const tasks = await enrichTasks(result.rows);
  return { tasks };
}

/**
 * List tasks accepted by a specific user (where user is the selected helper).
 * Ordered by creation time (newest first).
 */
export async function listAcceptedTasks(userId: string): Promise<{ tasks: Task[] }> {
  const tasks = await taskRepository.findAcceptedByUser(userId);
  return { tasks: await enrichTasks(tasks) };
}

/**
 * List nearby open tasks with filtering and pagination.
 */
export async function listTasks(params: ListTasksParams): Promise<ListTasksResponse> {
  const { lat, lng, radius, type, minReward, maxReward, sort, page, pageSize } = params;
  const offset = (page - 1) * pageSize;

  const [tasks, totalCount] = await Promise.all([
    taskRepository.findNearby({ lat, lng, radius, type, minReward, maxReward, sort, pageSize, offset }),
    taskRepository.countNearby({ lat, lng, radius, type, minReward, maxReward }),
  ]);

  const totalPages = Math.ceil(totalCount / pageSize);

  return {
    tasks: await enrichTasks(tasks),
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

  return enrichTask(task);
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

  if (payload.images) {
    payload = { ...payload, images: payload.images.map(cleanImageUrl) };
  }

  const task = await taskRepository.create(userId, payload);
  return enrichTask(task);
}

/**
 * Update task details (description, reward, location, deadline, and the new
 * optional fields). Only the task poster can edit, and only when status is 'open'.
 * Note: poster_memo is handled separately by updateMemo (editable in any status).
 */
export async function updateTask(
  taskId: string,
  userId: string,
  payload: UpdateTaskPayload
): Promise<Task> {
  const task = await taskRepository.findById(taskId);

  if (!task) {
    throw new NotFoundError('任务不存在');
  }

  if (task.posterId !== userId) {
    throw new ConflictError('forbidden', '无权编辑此任务');
  }

  if (task.status !== 'open') {
    throw new ConflictError('invalid_state', '只有待接单状态的任务可以编辑');
  }

  if (payload.deadline) {
    const deadlineDate = new Date(payload.deadline);
    if (deadlineDate <= new Date()) {
      throw new ValidationError({ deadline: '截止时间必须晚于当前时间' });
    }
  }

  if (payload.images) {
    payload = { ...payload, images: payload.images.map(cleanImageUrl) };
  }

  const updatedTask = await taskRepository.updateDetails(taskId, payload);
  if (!updatedTask) {
    throw new NotFoundError('任务不存在或状态已变更');
  }

  return enrichTask(updatedTask);
}

/**
 * Update the poster's private memo on their own task.
 * Allowed in any status. Only the poster may do this.
 */
export async function updateMemo(
  taskId: string,
  userId: string,
  memo: string | null
): Promise<Task> {
  const task = await taskRepository.findById(taskId);
  if (!task) {
    throw new NotFoundError('任务不存在');
  }
  if (task.posterId !== userId) {
    throw new ConflictError('forbidden', '无权修改此任务的备注');
  }

  const updatedTask = await taskRepository.updateMemo(taskId, memo);
  if (!updatedTask) {
    throw new NotFoundError('任务不存在');
  }

  return enrichTask(updatedTask);
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

  // When reverting to open, clear the selected helper (cancel selection)
  if (newStatus === 'open') {
    const updatedTask = await taskRepository.updateStatusAndClearHelper(taskId, newStatus);
    if (!updatedTask) {
      throw new NotFoundError('任務不存在');
    }
    return updatedTask;
  }

  const updatedTask = await taskRepository.updateStatus(taskId, newStatus);

  if (!updatedTask) {
    throw new NotFoundError('任務不存在');
  }

  return updatedTask;
}
