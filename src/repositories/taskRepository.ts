import { query } from '../config/database';
import { Task, TaskStatus, CreateTaskPayload, UpdateTaskPayload } from '../types/task';

export interface FindNearbyParams {
  lat: number;
  lng: number;
  radius: number;
  type?: string;
  minReward?: number;
  maxReward?: number;
  sort?: string;
  pageSize: number;
  offset: number;
  /** Optional tag ids; a task matches if it has ANY of these tags. */
  tagIds?: string[];
}

interface TaskRow {
  id: string;
  poster_id: string;
  nickname: string;
  average_rating: string;
  type: string;
  description: string;
  location_address: string;
  lng: number;
  lat: number;
  reward: string;
  reward_unit: string | null;
  deadline: string;
  status: string;
  intent_count: number;
  selected_helper_id: string | null;
  created_at: string;
  images: string[] | null;
  headcount: number;
  start_time: string | null;
  contact_method: string | null;
  duration_hours: string | null;
  duration_unit: string | null;
  poster_memo?: string | null;
  distance?: string;
}

/**
 * Column list (with t. prefix) for the new task fields, shared across SELECTs.
 * poster_memo is intentionally excluded — it is poster-only and added explicitly
 * where appropriate.
 */
const TASK_EXTRA_SELECT = `
  t.reward_unit, t.images, t.headcount, t.start_time,
  t.contact_method, t.duration_hours, t.duration_unit
`;

/** Same extra columns for RETURNING clauses (no table prefix). */
const TASK_EXTRA_RETURNING = `
  reward_unit, images, headcount, start_time,
  contact_method, duration_hours, duration_unit
`;

/**
 * Map a DB row to a Task. Includes poster_memo only when the row carries it
 * (i.e. it was explicitly selected for a poster-only context).
 */
function mapRowToTask(row: TaskRow): Task {
  const task: Task = {
    id: row.id,
    posterId: row.poster_id,
    posterNickname: row.nickname,
    posterRating: parseFloat(row.average_rating),
    type: row.type as Task['type'],
    description: row.description,
    location: {
      address: row.location_address,
      latitude: row.lat,
      longitude: row.lng,
    },
    reward: typeof row.reward === 'number' ? row.reward : parseInt(row.reward, 10),
    rewardUnit: (row.reward_unit as Task['rewardUnit']) ?? null,
    deadline: row.deadline,
    status: row.status as Task['status'],
    intentCount: row.intent_count,
    selectedHelperId: row.selected_helper_id ?? undefined,
    createdAt: row.created_at,
    images: row.images ?? [],
    headcount: row.headcount ?? 1,
    startTime: row.start_time ?? null,
    contactMethod: row.contact_method ?? null,
    durationHours: row.duration_hours != null ? parseFloat(row.duration_hours) : null,
    durationUnit: (row.duration_unit as Task['durationUnit']) ?? null,
    distance: row.distance != null ? parseFloat(parseFloat(row.distance).toFixed(2)) : undefined,
  };

  if (row.poster_memo !== undefined) {
    task.posterMemo = row.poster_memo ?? null;
  }

  return task;
}

/**
 * Find nearby open tasks using PostGIS spatial queries.
 * Supports filtering by type and reward range, ordered by distance.
 */
export async function findNearby(params: FindNearbyParams): Promise<Task[]> {
  const { lat, lng, radius, type, minReward, maxReward, sort, pageSize, offset, tagIds } = params;

  let orderBy = 'distance ASC';
  switch (sort) {
    case 'reward': orderBy = 't.reward DESC'; break;
    case 'newest': orderBy = 't.created_at DESC'; break;
    case 'deadline': orderBy = 't.deadline ASC'; break;
    default: orderBy = 'distance ASC';
  }

  const sql = `
    SELECT t.id, t.poster_id, u.nickname, u.average_rating,
           t.type, t.description, t.location_address,
           ST_X(t.location::geometry) AS lng,
           ST_Y(t.location::geometry) AS lat,
           t.reward, t.deadline, t.status, t.intent_count,
           t.selected_helper_id, t.created_at,
           ${TASK_EXTRA_SELECT},
           ST_Distance(t.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)) / 1000 AS distance
    FROM tasks t
    JOIN users u ON t.poster_id = u.id
    WHERE t.status = 'open'
      AND ST_DWithin(t.location, ST_SetSRID(ST_MakePoint($1, $2), 4326), $3 * 1000)
      AND ($4::text[] IS NULL OR t.type = ANY($4::text[]))
      AND ($5::numeric IS NULL OR t.reward >= $5)
      AND ($6::numeric IS NULL OR t.reward <= $6)
      AND ($9::uuid[] IS NULL OR EXISTS (
        SELECT 1 FROM task_task_tags jt WHERE jt.task_id = t.id AND jt.tag_id = ANY($9::uuid[])
      ))
    ORDER BY ${orderBy}
    LIMIT $7 OFFSET $8
  `;

  const values = [
    lng,
    lat,
    radius,
    type ? type.split(',') : null,
    minReward ?? null,
    maxReward ?? null,
    pageSize,
    offset,
    tagIds && tagIds.length > 0 ? tagIds : null,
  ];

  const result = await query<TaskRow>(sql, values);
  return result.rows.map(mapRowToTask);
}

/**
 * Count nearby open tasks matching the same filters as findNearby.
 */
export async function countNearby(params: Omit<FindNearbyParams, 'pageSize' | 'offset'>): Promise<number> {
  const { lat, lng, radius, type, minReward, maxReward, tagIds } = params;

  const sql = `
    SELECT COUNT(*) AS count
    FROM tasks t
    WHERE t.status = 'open'
      AND ST_DWithin(t.location, ST_SetSRID(ST_MakePoint($1, $2), 4326), $3 * 1000)
      AND ($4::text[] IS NULL OR t.type = ANY($4::text[]))
      AND ($5::numeric IS NULL OR t.reward >= $5)
      AND ($6::numeric IS NULL OR t.reward <= $6)
      AND ($7::uuid[] IS NULL OR EXISTS (
        SELECT 1 FROM task_task_tags jt WHERE jt.task_id = t.id AND jt.tag_id = ANY($7::uuid[])
      ))
  `;

  const values = [
    lng,
    lat,
    radius,
    type ? type.split(',') : null,
    minReward ?? null,
    maxReward ?? null,
    tagIds && tagIds.length > 0 ? tagIds : null,
  ];

  const result = await query<{ count: string }>(sql, values);
  return parseInt(result.rows[0].count, 10);
}

/**
 * Find a single task by ID. Public endpoint — does NOT include poster_memo.
 */
export async function findById(taskId: string): Promise<Task | null> {
  const sql = `
    SELECT t.id, t.poster_id, u.nickname, u.average_rating,
           t.type, t.description, t.location_address,
           ST_X(t.location::geometry) AS lng,
           ST_Y(t.location::geometry) AS lat,
           t.reward, t.deadline, t.status, t.intent_count,
           t.selected_helper_id, t.created_at,
           ${TASK_EXTRA_SELECT}
    FROM tasks t
    JOIN users u ON t.poster_id = u.id
    WHERE t.id = $1
  `;

  const result = await query<TaskRow>(sql, [taskId]);
  if (result.rows.length === 0) {
    return null;
  }
  return mapRowToTask(result.rows[0]);
}

/**
 * Create a new task, storing coordinates as PostGIS geography point.
 * Returns the task including poster_memo (creator is the poster).
 */
export async function create(userId: string, payload: CreateTaskPayload): Promise<Task> {
  const sql = `
    INSERT INTO tasks (
      poster_id, type, description, location_address, location,
      reward, reward_unit, deadline, images, headcount,
      start_time, contact_method, duration_hours, duration_unit, poster_memo
    )
    VALUES (
      $1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326),
      $7, $8, $9, $10, $11,
      $12, $13, $14, $15, $16
    )
    RETURNING id, poster_id, type, description, location_address,
              ST_X(location::geometry) AS lng,
              ST_Y(location::geometry) AS lat,
              reward, deadline, status, intent_count,
              selected_helper_id, created_at, poster_memo,
              ${TASK_EXTRA_RETURNING}
  `;

  const values = [
    userId,                          // $1
    payload.type,                    // $2
    payload.description,             // $3
    payload.location.address,        // $4
    payload.location.longitude,      // $5
    payload.location.latitude,       // $6
    payload.reward,                  // $7
    payload.rewardUnit ?? null,      // $8
    payload.deadline,                // $9
    payload.images ?? [],            // $10 (pg maps JS array -> text[])
    payload.headcount ?? 1,          // $11
    payload.startTime ?? null,       // $12
    payload.contactMethod ?? null,   // $13
    payload.durationHours ?? null,   // $14
    payload.durationUnit ?? null,    // $15
    payload.posterMemo ?? null,      // $16
  ];

  const result = await query<TaskRow>(sql, values);
  const row = result.rows[0];

  const userResult = await query<{ nickname: string; average_rating: string }>(
    'SELECT nickname, average_rating FROM users WHERE id = $1',
    [userId]
  );
  const user = userResult.rows[0];
  row.nickname = user?.nickname ?? '';
  row.average_rating = user?.average_rating ?? '0';

  return mapRowToTask(row);
}

/**
 * Update task details. Only allowed when task status is 'open'.
 * Does NOT touch poster_memo (handled by updateMemo).
 */
export async function updateDetails(
  taskId: string,
  payload: UpdateTaskPayload
): Promise<Task | null> {
  const setClauses: string[] = ['updated_at = NOW()'];
  const values: any[] = [taskId];
  let paramIndex = 2;

  const pushSet = (column: string, value: unknown) => {
    setClauses.push(`${column} = $${paramIndex}`);
    values.push(value);
    paramIndex++;
  };

  if (payload.description !== undefined) pushSet('description', payload.description);
  if (payload.reward !== undefined) pushSet('reward', payload.reward);
  if (payload.deadline !== undefined) pushSet('deadline', payload.deadline);
  if (payload.rewardUnit !== undefined) pushSet('reward_unit', payload.rewardUnit);
  if (payload.images !== undefined) pushSet('images', payload.images);
  if (payload.headcount !== undefined) pushSet('headcount', payload.headcount);
  if (payload.startTime !== undefined) pushSet('start_time', payload.startTime);
  if (payload.contactMethod !== undefined) pushSet('contact_method', payload.contactMethod);
  if (payload.durationHours !== undefined) pushSet('duration_hours', payload.durationHours);
  if (payload.durationUnit !== undefined) pushSet('duration_unit', payload.durationUnit);

  if (payload.location) {
    pushSet('location_address', payload.location.address);
    setClauses.push(`location = ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)`);
    values.push(payload.location.longitude);
    paramIndex++;
    values.push(payload.location.latitude);
    paramIndex++;
  }

  const sql = `
    UPDATE tasks
    SET ${setClauses.join(', ')}
    WHERE id = $1 AND status = 'open'
    RETURNING id, poster_id, type, description, location_address,
              ST_X(location::geometry) AS lng,
              ST_Y(location::geometry) AS lat,
              reward, deadline, status, intent_count,
              selected_helper_id, created_at,
              ${TASK_EXTRA_RETURNING}
  `;

  const result = await query<TaskRow>(sql, values);
  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  const userResult = await query<{ nickname: string; average_rating: string }>(
    'SELECT nickname, average_rating FROM users WHERE id = $1',
    [row.poster_id]
  );
  const user = userResult.rows[0];
  row.nickname = user?.nickname ?? '';
  row.average_rating = user?.average_rating ?? '0';

  return mapRowToTask(row);
}

/**
 * Update the poster's private memo. Allowed in any status; poster ownership is
 * verified in the service layer. Returns the task including poster_memo.
 */
export async function updateMemo(taskId: string, memo: string | null): Promise<Task | null> {
  const sql = `
    UPDATE tasks
    SET poster_memo = $2, updated_at = NOW()
    WHERE id = $1
    RETURNING id, poster_id, type, description, location_address,
              ST_X(location::geometry) AS lng,
              ST_Y(location::geometry) AS lat,
              reward, deadline, status, intent_count,
              selected_helper_id, created_at, poster_memo,
              ${TASK_EXTRA_RETURNING}
  `;

  const result = await query<TaskRow>(sql, [taskId, memo]);
  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  const userResult = await query<{ nickname: string; average_rating: string }>(
    'SELECT nickname, average_rating FROM users WHERE id = $1',
    [row.poster_id]
  );
  const user = userResult.rows[0];
  row.nickname = user?.nickname ?? '';
  row.average_rating = user?.average_rating ?? '0';

  return mapRowToTask(row);
}

/**
 * Update task status and clear the selected helper (revert to open).
 * Also resets all selected and rejected intents back to pending.
 */
export async function updateStatusAndClearHelper(
  taskId: string,
  status: TaskStatus
): Promise<Task | null> {
  await query(
    `UPDATE intents SET status = 'pending', updated_at = NOW()
     WHERE task_id = $1 AND status IN ('selected', 'rejected')`,
    [taskId]
  );

  const sql = `
    UPDATE tasks
    SET status = $2, selected_helper_id = NULL, updated_at = NOW()
    WHERE id = $1
    RETURNING id, poster_id, type, description, location_address,
              ST_X(location::geometry) AS lng,
              ST_Y(location::geometry) AS lat,
              reward, deadline, status, intent_count,
              selected_helper_id, created_at,
              ${TASK_EXTRA_RETURNING}
  `;

  const result = await query<TaskRow>(sql, [taskId, status]);
  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  const userResult = await query<{ nickname: string; average_rating: string }>(
    'SELECT nickname, average_rating FROM users WHERE id = $1',
    [row.poster_id]
  );
  const user = userResult.rows[0];
  row.nickname = user?.nickname ?? '';
  row.average_rating = user?.average_rating ?? '0';

  return mapRowToTask(row);
}

/**
 * Find tasks accepted by a user (where user is the selected helper).
 */
export async function findAcceptedByUser(userId: string): Promise<Task[]> {
  const sql = `
    SELECT t.id, t.poster_id, u.nickname, u.average_rating,
           t.type, t.description, t.location_address,
           ST_X(t.location::geometry) AS lng,
           ST_Y(t.location::geometry) AS lat,
           t.reward, t.deadline, t.status, t.intent_count,
           t.selected_helper_id, t.created_at,
           ${TASK_EXTRA_SELECT}
    FROM tasks t
    JOIN users u ON t.poster_id = u.id
    WHERE t.selected_helper_id = $1
    ORDER BY t.created_at DESC
  `;

  const result = await query<TaskRow>(sql, [userId]);
  return result.rows.map(mapRowToTask);
}

/**
 * Update task status and optionally set the selected helper.
 */
export async function updateStatus(
  taskId: string,
  status: TaskStatus,
  selectedHelperId?: string
): Promise<Task | null> {
  const sql = selectedHelperId
    ? `
      UPDATE tasks
      SET status = $2, selected_helper_id = $3, updated_at = NOW()
      WHERE id = $1
      RETURNING id, poster_id, type, description, location_address,
                ST_X(location::geometry) AS lng,
                ST_Y(location::geometry) AS lat,
                reward, deadline, status, intent_count,
                selected_helper_id, created_at,
                ${TASK_EXTRA_RETURNING}
    `
    : `
      UPDATE tasks
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, poster_id, type, description, location_address,
                ST_X(location::geometry) AS lng,
                ST_Y(location::geometry) AS lat,
                reward, deadline, status, intent_count,
                selected_helper_id, created_at,
                ${TASK_EXTRA_RETURNING}
    `;

  const values = selectedHelperId
    ? [taskId, status, selectedHelperId]
    : [taskId, status];

  const result = await query<TaskRow>(sql, values);
  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  const userResult = await query<{ nickname: string; average_rating: string }>(
    'SELECT nickname, average_rating FROM users WHERE id = $1',
    [row.poster_id]
  );
  const user = userResult.rows[0];
  row.nickname = user?.nickname ?? '';
  row.average_rating = user?.average_rating ?? '0';

  return mapRowToTask(row);
}
