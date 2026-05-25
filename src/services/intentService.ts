/**
 * Intent Service - Business logic for helper intent management.
 *
 * Handles:
 * - Submitting intents (with validation)
 * - Withdrawing intents
 * - Listing intents (poster only)
 * - Selecting a helper (transactional)
 *
 * Validates: Requirements 3.1, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9
 */

import { Intent } from '../types/intent';
import { Task } from '../types/task';
import { NotFoundError, ConflictError, ForbiddenError } from '../utils/errors';
import { query, getClient } from '../config/database';
import * as intentRepository from '../repositories/intentRepository';
import * as taskRepository from '../repositories/taskRepository';
import * as notificationService from './notificationService';
import { logger } from '../utils/logger';

/**
 * Submit an intent for a task.
 *
 * Business rules:
 * 1. Task must exist and be in 'open' status
 * 2. User cannot be the task poster (cannot submit intent on own task)
 * 3. No duplicate pending intent for the same task+helper combination
 *
 * Side effects:
 * - Increments task.intent_count
 * - Triggers chat session creation (placeholder)
 * - Sends notification to task poster
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.9
 */
export async function submitIntent(
  taskId: string,
  helperId: string,
  message?: string
): Promise<Intent> {
  // 1. Verify task exists and is open
  const task = await taskRepository.findById(taskId);
  if (!task) {
    throw new NotFoundError('任务不存在');
  }
  if (task.status !== 'open') {
    throw new ConflictError('invalid_state_transition', '当前状态不允许此操作');
  }

  // 2. Verify user is not the task poster
  if (task.posterId === helperId) {
    throw new ForbiddenError('不能对自己发布的任务提交意向');
  }

  // 3. Check for duplicate pending intent
  const existingIntent = await intentRepository.findPendingByTaskAndHelper(taskId, helperId);
  if (existingIntent) {
    throw new ConflictError('duplicate_intent', '您已对该任务提交过意向');
  }

  // Create the intent
  let intent: Intent;
  try {
    intent = await intentRepository.create(taskId, helperId, message);
  } catch (err: unknown) {
    // Handle unique constraint violation (race condition fallback)
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
      throw new ConflictError('duplicate_intent', '您已对该任务提交过意向');
    }
    throw err;
  }

  // Increment task.intent_count
  await query(
    'UPDATE tasks SET intent_count = intent_count + 1, updated_at = NOW() WHERE id = $1',
    [taskId]
  );

  // Trigger chat session creation (placeholder - will be implemented by chatService)
  try {
    await createChatSessionPlaceholder(taskId, task.posterId, helperId);
  } catch (err) {
    // Non-critical: log but don't fail the intent submission
    logger.warn('Failed to create chat session for intent', {
      taskId,
      posterId: task.posterId,
      helperId,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }

  // Send notification to task poster
  try {
    await notificationService.notifyNewIntent(task.posterId, intent.helperNickname);
  } catch (err) {
    // Non-critical: log but don't fail the intent submission
    logger.warn('Failed to send new intent notification', {
      posterId: task.posterId,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }

  return intent;
}

/**
 * Withdraw an intent.
 *
 * Business rules:
 * 1. Intent must belong to the requesting user
 * 2. Intent must be in 'pending' status
 *
 * Side effects:
 * - Decrements task.intent_count
 *
 * Validates: Requirements 3.5
 */
export async function withdrawIntent(
  taskId: string,
  intentId: string,
  userId: string
): Promise<void> {
  // Verify task exists
  const task = await taskRepository.findById(taskId);
  if (!task) {
    throw new NotFoundError('任务不存在');
  }

  // Attempt to withdraw (repository handles ownership + status check)
  const success = await intentRepository.withdrawIntent(intentId, userId);
  if (!success) {
    throw new NotFoundError('意向不存在或无法撤回');
  }

  // Decrement task.intent_count (ensure it doesn't go below 0)
  await query(
    'UPDATE tasks SET intent_count = GREATEST(intent_count - 1, 0), updated_at = NOW() WHERE id = $1',
    [taskId]
  );
}

/**
 * List all intents for a task.
 *
 * Business rules:
 * - Only the task poster can view the intent list
 *
 * Validates: Requirements 3.6
 */
export async function listIntents(
  taskId: string,
  requesterId: string
): Promise<{ intents: Intent[] }> {
  // Verify task exists
  const task = await taskRepository.findById(taskId);
  if (!task) {
    throw new NotFoundError('任务不存在');
  }

  // Verify requester is the task poster
  if (task.posterId !== requesterId) {
    throw new ForbiddenError('无权访问该资源');
  }

  const intents = await intentRepository.findByTaskId(taskId);
  return { intents };
}

/**
 * Select a helper for a task.
 *
 * Performed within a database transaction to ensure consistency:
 * 1. Update task status to 'in_progress' and set selected_helper_id
 * 2. Update the selected helper's intent to 'selected'
 * 3. Reject all other pending intents
 *
 * Business rules:
 * - Requester must be the task poster
 * - Task must be in 'open' status
 * - The specified helper must have a pending intent
 *
 * Side effects:
 * - Sends "selected" notification to chosen helper
 * - Sends "rejected" notification to other helpers
 *
 * Validates: Requirements 3.7, 3.8
 */
export async function selectHelper(
  taskId: string,
  helperId: string,
  posterId: string
): Promise<Task> {
  // Verify task exists and validate permissions
  const task = await taskRepository.findById(taskId);
  if (!task) {
    throw new NotFoundError('任务不存在');
  }

  // Verify requester is the task poster
  if (task.posterId !== posterId) {
    throw new ForbiddenError('无权执行此操作');
  }

  // Verify task is in 'open' status
  if (task.status !== 'open') {
    throw new ConflictError('invalid_state_transition', '当前状态不允许此操作');
  }

  // Verify the helper has a pending intent
  const helperIntent = await intentRepository.findPendingByTaskAndHelper(taskId, helperId);
  if (!helperIntent) {
    throw new NotFoundError('该帮手没有待处理的意向');
  }

  // Execute within a transaction
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 1. Update task status to 'in_progress' and set selected_helper_id
    await client.query(
      `UPDATE tasks SET status = 'in_progress', selected_helper_id = $2, updated_at = NOW() WHERE id = $1`,
      [taskId, helperId]
    );

    // 2. Update the selected helper's intent to 'selected'
    await client.query(
      `UPDATE intents SET status = 'selected', updated_at = NOW() WHERE task_id = $1 AND helper_id = $2 AND status = 'pending'`,
      [taskId, helperId]
    );

    // 3. Reject all other pending intents
    const rejectResult = await client.query<{ helper_id: string }>(
      `UPDATE intents SET status = 'rejected', updated_at = NOW() WHERE task_id = $1 AND status = 'pending' AND helper_id != $2 RETURNING helper_id`,
      [taskId, helperId]
    );

    await client.query('COMMIT');

    // Get the rejected helper IDs for notifications
    const rejectedHelperIds = rejectResult.rows.map((row) => row.helper_id);

    // Send notifications (non-critical, don't fail the operation)
    try {
      await notificationService.notifyHelperSelected(helperId, task.description);
      if (rejectedHelperIds.length > 0) {
        await notificationService.notifyHelperRejected(rejectedHelperIds, task.description);
      }
    } catch (err) {
      logger.warn('Failed to send helper selection notifications', {
        taskId,
        helperId,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Return the updated task
  const updatedTask = await taskRepository.findById(taskId);
  if (!updatedTask) {
    throw new NotFoundError('任务不存在');
  }

  return updatedTask;
}

/**
 * Placeholder for chat session creation.
 * Creates a chat session between the task poster and helper if one doesn't exist.
 * Will be replaced by chatService.createSessionIfNotExists when implemented.
 */
async function createChatSessionPlaceholder(
  taskId: string,
  posterId: string,
  helperId: string
): Promise<void> {
  // Use INSERT ... ON CONFLICT DO NOTHING for idempotent session creation
  await query(
    `INSERT INTO chat_sessions (task_id, poster_id, helper_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (task_id, poster_id, helper_id) DO NOTHING`,
    [taskId, posterId, helperId]
  );

  logger.info('Chat session created/exists', { taskId, posterId, helperId });
}
