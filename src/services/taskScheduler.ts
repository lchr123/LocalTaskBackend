/**
 * Task Scheduler
 *
 * Runs periodic jobs to manage task lifecycle:
 * - Auto-cancel expired tasks (deadline passed, still open or in_progress)
 *
 * Runs every 15 minutes.
 */

import { query } from '../config/database';
import { logger } from '../utils/logger';

const SCAN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Cancel all tasks whose deadline has passed and are still open or in_progress.
 */
async function cancelExpiredTasks(): Promise<void> {
  try {
    const result = await query<{ id: string; status: string }>(
      `UPDATE tasks
       SET status = 'cancelled', updated_at = NOW()
       WHERE deadline < NOW()
         AND status IN ('open', 'in_progress')
       RETURNING id, status`,
      []
    );

    if (result.rows.length > 0) {
      logger.info('Auto-cancelled expired tasks', {
        count: result.rows.length,
        taskIds: result.rows.map((r) => r.id),
      });
    }
  } catch (err) {
    logger.error('Failed to auto-cancel expired tasks', {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}

/**
 * Start the task scheduler. Runs immediately once, then every 15 minutes.
 */
export function startTaskScheduler(): void {
  logger.info('Task scheduler started (interval: 15 min)');

  // Run immediately on startup
  void cancelExpiredTasks();

  // Then every 15 minutes
  intervalId = setInterval(cancelExpiredTasks, SCAN_INTERVAL_MS);
}

/**
 * Stop the task scheduler.
 */
export function stopTaskScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Task scheduler stopped');
  }
}
