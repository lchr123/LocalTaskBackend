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
import { config } from '../config';
import { listObjectsByPrefix, deleteObjects, extractKeyFromUrl } from './uploadService';

const SCAN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const IMAGE_CLEANUP_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const IMAGE_GRACE_MS = 24 * 60 * 60 * 1000; // protect uploads newer than 24h

let intervalId: ReturnType<typeof setInterval> | null = null;
let imageCleanupIntervalId: ReturnType<typeof setInterval> | null = null;

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
 * Clean up orphaned task images in S3 (objects under `tasks/` that are not
 * referenced by any task.images and are older than the grace period).
 *
 * Default is DRY RUN (logs only). Set TASK_IMAGE_CLEANUP_DELETE=true to delete.
 * Only the `tasks/` prefix is ever scanned/deleted — avatars/ and chats/ are untouched.
 */
async function cleanupOrphanTaskImages(): Promise<void> {
  try {
    if (!config.s3.bucket) {
      logger.warn('Task image cleanup skipped: S3 bucket not configured');
      return;
    }

    const deleteEnabled = process.env.TASK_IMAGE_CLEANUP_DELETE === 'true';

    // 1. Build the set of referenced object keys from DB
    const rows = await query<{ url: string }>(
      `SELECT unnest(images) AS url FROM tasks WHERE array_length(images, 1) > 0`,
      []
    );
    const referenced = new Set<string>();
    for (const r of rows.rows) {
      const key = extractKeyFromUrl(r.url);
      if (key) referenced.add(key);
    }

    // 2. List all objects under tasks/
    const objects = await listObjectsByPrefix('tasks/');

    // 3. Orphans: tasks/ prefix, not referenced, older than grace period
    const cutoff = Date.now() - IMAGE_GRACE_MS;
    const orphans = objects.filter(
      (o) =>
        o.key.startsWith('tasks/') &&
        !referenced.has(o.key) &&
        o.lastModified.getTime() < cutoff
    );

    if (orphans.length === 0) {
      logger.info('Task image cleanup: no orphans found', {
        scanned: objects.length,
        referenced: referenced.size,
      });
      return;
    }

    if (!deleteEnabled) {
      logger.info('Task image cleanup DRY RUN (set TASK_IMAGE_CLEANUP_DELETE=true to delete)', {
        scanned: objects.length,
        referenced: referenced.size,
        orphanCount: orphans.length,
        sampleKeys: orphans.slice(0, 20).map((o) => o.key),
      });
      return;
    }

    const deleted = await deleteObjects(orphans.map((o) => o.key));
    logger.info('Task image cleanup: deleted orphaned objects', {
      orphanCount: orphans.length,
      deleted,
    });
  } catch (err) {
    logger.error('Task image cleanup failed', {
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
  // Orphan image cleanup every 12 hours (not run on startup)
  imageCleanupIntervalId = setInterval(cleanupOrphanTaskImages, IMAGE_CLEANUP_INTERVAL_MS);
}

/**
 * Stop the task scheduler.
 */
export function stopTaskScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (imageCleanupIntervalId) {
    clearInterval(imageCleanupIntervalId);
    imageCleanupIntervalId = null;
  }
  logger.info('Task scheduler stopped');
}
