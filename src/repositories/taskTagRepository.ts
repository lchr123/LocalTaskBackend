import { query } from '../config/database';
import { TaskTag } from '../types/task';

/** List the full task tag dictionary, ordered by category then label. */
export async function listAll(): Promise<TaskTag[]> {
  const result = await query<TaskTag>(
    `SELECT id, name, label_zh, category FROM task_tags ORDER BY category NULLS LAST, label_zh`,
    []
  );
  return result.rows;
}

/** Fetch tags for a set of task ids, grouped into a Map<taskId, TaskTag[]>. */
export async function getForTasks(taskIds: string[]): Promise<Map<string, TaskTag[]>> {
  const map = new Map<string, TaskTag[]>();
  if (taskIds.length === 0) return map;

  const result = await query<{ task_id: string; id: string; name: string; label_zh: string; category: string | null }>(
    `SELECT jt.task_id, t.id, t.name, t.label_zh, t.category
     FROM task_task_tags jt
     JOIN task_tags t ON jt.tag_id = t.id
     WHERE jt.task_id = ANY($1::uuid[])
     ORDER BY t.category NULLS LAST, t.label_zh`,
    [taskIds]
  );

  for (const row of result.rows) {
    const list = map.get(row.task_id) ?? [];
    list.push({ id: row.id, name: row.name, label_zh: row.label_zh, category: row.category });
    map.set(row.task_id, list);
  }
  return map;
}

/** Replace the full tag set for a task. Ignores ids not present in task_tags. */
export async function setForTask(taskId: string, tagIds: string[]): Promise<void> {
  await query(`DELETE FROM task_task_tags WHERE task_id = $1`, [taskId]);
  if (tagIds.length === 0) return;
  // Insert only valid tag ids (filter against dictionary to avoid FK errors)
  await query(
    `INSERT INTO task_task_tags (task_id, tag_id)
     SELECT $1, t.id FROM task_tags t WHERE t.id = ANY($2::uuid[])
     ON CONFLICT DO NOTHING`,
    [taskId, tagIds]
  );
}
