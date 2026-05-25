import { query } from '../config/database';
import { Intent, IntentStatus } from '../types/intent';

/**
 * Database row shape returned from intent queries with user JOIN.
 */
interface IntentRow {
  id: string;
  task_id: string;
  helper_id: string;
  nickname: string;
  average_rating: string;
  completed_task_count: number;
  message: string | null;
  status: string;
  created_at: string;
}

/**
 * Minimal intent row without user JOIN (for existence checks).
 */
interface IntentBasicRow {
  id: string;
  task_id: string;
  helper_id: string;
  message: string | null;
  status: string;
  created_at: string;
}

/**
 * Maps a database row (with user JOIN) to the Intent interface.
 */
function mapRowToIntent(row: IntentRow): Intent {
  return {
    id: row.id,
    taskId: row.task_id,
    helperId: row.helper_id,
    helperNickname: row.nickname ?? '',
    helperRating: parseFloat(row.average_rating) || 0,
    helperCompletedCount: row.completed_task_count ?? 0,
    message: row.message ?? undefined,
    status: row.status as IntentStatus,
    createdAt: row.created_at,
  };
}

/**
 * Create a new intent for a task.
 * Relies on the unique partial index (task_id, helper_id) WHERE status = 'pending'
 * to prevent duplicate pending intents.
 *
 * @throws PostgreSQL error code 23505 on unique constraint violation (duplicate pending intent)
 *
 * Validates: Requirements 3.1, 3.2, 9.3
 */
export async function create(
  taskId: string,
  helperId: string,
  message?: string
): Promise<Intent> {
  const sql = `
    INSERT INTO intents (task_id, helper_id, message)
    VALUES ($1, $2, $3)
    RETURNING id, task_id, helper_id, message, status, created_at
  `;

  const result = await query<IntentBasicRow>(sql, [taskId, helperId, message ?? null]);
  const row = result.rows[0];

  // Fetch helper user info for the response
  const userResult = await query<{
    nickname: string;
    average_rating: string;
    completed_task_count: number;
  }>(
    'SELECT nickname, average_rating, completed_task_count FROM users WHERE id = $1',
    [helperId]
  );
  const user = userResult.rows[0];

  return {
    id: row.id,
    taskId: row.task_id,
    helperId: row.helper_id,
    helperNickname: user?.nickname ?? '',
    helperRating: user ? parseFloat(user.average_rating) : 0,
    helperCompletedCount: user?.completed_task_count ?? 0,
    message: row.message ?? undefined,
    status: row.status as IntentStatus,
    createdAt: row.created_at,
  };
}

/**
 * Find all intents for a given task, joining users table to get helper info.
 * Returns intents ordered by created_at DESC (newest first).
 *
 * Validates: Requirements 3.6
 */
export async function findByTaskId(taskId: string): Promise<Intent[]> {
  const sql = `
    SELECT i.id, i.task_id, i.helper_id,
           u.nickname, u.average_rating, u.completed_task_count,
           i.message, i.status, i.created_at
    FROM intents i
    JOIN users u ON i.helper_id = u.id
    WHERE i.task_id = $1
    ORDER BY i.created_at DESC
  `;

  const result = await query<IntentRow>(sql, [taskId]);
  return result.rows.map(mapRowToIntent);
}

/**
 * Check if a pending intent exists for a specific task and helper combination.
 * Returns the intent if found, null otherwise.
 *
 * Validates: Requirements 3.3, 9.3
 */
export async function findPendingByTaskAndHelper(
  taskId: string,
  helperId: string
): Promise<Intent | null> {
  const sql = `
    SELECT i.id, i.task_id, i.helper_id,
           u.nickname, u.average_rating, u.completed_task_count,
           i.message, i.status, i.created_at
    FROM intents i
    JOIN users u ON i.helper_id = u.id
    WHERE i.task_id = $1 AND i.helper_id = $2 AND i.status = 'pending'
  `;

  const result = await query<IntentRow>(sql, [taskId, helperId]);

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToIntent(result.rows[0]);
}

/**
 * Update the status of a specific intent.
 *
 * Validates: Requirements 3.5, 3.7
 */
export async function updateStatus(
  intentId: string,
  status: IntentStatus
): Promise<void> {
  const sql = `
    UPDATE intents
    SET status = $2, updated_at = NOW()
    WHERE id = $1
  `;

  await query(sql, [intentId, status]);
}

/**
 * Reject all pending intents for a task, excluding a specific helper.
 * Used when a helper is selected — all other pending intents become rejected.
 *
 * Returns the helper IDs of rejected intents (for notification purposes).
 *
 * Validates: Requirements 3.7
 */
export async function rejectAllPending(
  taskId: string,
  excludeHelperId: string
): Promise<string[]> {
  const sql = `
    UPDATE intents
    SET status = 'rejected', updated_at = NOW()
    WHERE task_id = $1 AND status = 'pending' AND helper_id != $2
    RETURNING helper_id
  `;

  const result = await query<{ helper_id: string }>(sql, [taskId, excludeHelperId]);
  return result.rows.map((row) => row.helper_id);
}

/**
 * Withdraw an intent: verify it belongs to the user and is in pending status,
 * then update to withdrawn.
 *
 * Returns true if the intent was successfully withdrawn, false if not found
 * or not owned by the user or not in pending status.
 *
 * Validates: Requirements 3.5
 */
export async function withdrawIntent(
  intentId: string,
  userId: string
): Promise<boolean> {
  const sql = `
    UPDATE intents
    SET status = 'withdrawn', updated_at = NOW()
    WHERE id = $1 AND helper_id = $2 AND status = 'pending'
  `;

  const result = await query(sql, [intentId, userId]);
  return (result.rowCount ?? 0) > 0;
}
