import { query } from '../config/database';
import { Task, TaskStatus, CreateTaskPayload } from '../types/task';

export interface FindNearbyParams {
  lat: number;
  lng: number;
  radius: number;
  type?: string;
  minReward?: number;
  maxReward?: number;
  pageSize: number;
  offset: number;
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
  deadline: string;
  status: string;
  intent_count: number;
  selected_helper_id: string | null;
  created_at: string;
  distance: string;
}

function mapRowToTask(row: TaskRow): Task {
  return {
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
    reward: parseFloat(row.reward),
    deadline: row.deadline,
    status: row.status as Task['status'],
    intentCount: row.intent_count,
    selectedHelperId: row.selected_helper_id ?? undefined,
    createdAt: row.created_at,
    distance: row.distance != null ? parseFloat(parseFloat(row.distance).toFixed(2)) : undefined,
  };
}


/**
 * Find nearby open tasks using PostGIS spatial queries.
 * Supports filtering by type and reward range, ordered by distance.
 */
export async function findNearby(params: FindNearbyParams): Promise<Task[]> {
  const { lat, lng, radius, type, minReward, maxReward, pageSize, offset } = params;

  const sql = `
    SELECT t.id, t.poster_id, u.nickname, u.average_rating,
           t.type, t.description, t.location_address,
           ST_X(t.location::geometry) AS lng,
           ST_Y(t.location::geometry) AS lat,
           t.reward, t.deadline, t.status, t.intent_count,
           t.selected_helper_id, t.created_at,
           ST_Distance(t.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)) / 1000 AS distance
    FROM tasks t
    JOIN users u ON t.poster_id = u.id
    WHERE t.status = 'open'
      AND ST_DWithin(t.location, ST_SetSRID(ST_MakePoint($1, $2), 4326), $3 * 1000)
      AND ($4::varchar IS NULL OR t.type = $4)
      AND ($5::numeric IS NULL OR t.reward >= $5)
      AND ($6::numeric IS NULL OR t.reward <= $6)
    ORDER BY distance ASC
    LIMIT $7 OFFSET $8
  `;

  const values = [
    lng,          // $1
    lat,          // $2
    radius,       // $3
    type ?? null, // $4
    minReward ?? null, // $5
    maxReward ?? null, // $6
    pageSize,     // $7
    offset,       // $8
  ];

  const result = await query<TaskRow>(sql, values);
  return result.rows.map(mapRowToTask);
}

/**
 * Count nearby open tasks matching the same filters as findNearby.
 * Used to calculate totalCount for pagination.
 */
export async function countNearby(params: Omit<FindNearbyParams, 'pageSize' | 'offset'>): Promise<number> {
  const { lat, lng, radius, type, minReward, maxReward } = params;

  const sql = `
    SELECT COUNT(*) AS count
    FROM tasks t
    WHERE t.status = 'open'
      AND ST_DWithin(t.location, ST_SetSRID(ST_MakePoint($1, $2), 4326), $3 * 1000)
      AND ($4::varchar IS NULL OR t.type = $4)
      AND ($5::numeric IS NULL OR t.reward >= $5)
      AND ($6::numeric IS NULL OR t.reward <= $6)
  `;

  const values = [
    lng,          // $1
    lat,          // $2
    radius,       // $3
    type ?? null, // $4
    minReward ?? null, // $5
    maxReward ?? null, // $6
  ];

  const result = await query<{ count: string }>(sql, values);
  return parseInt(result.rows[0].count, 10);
}

/**
 * Find a single task by ID, joining users to get poster nickname and rating.
 */
export async function findById(taskId: string): Promise<Task | null> {
  const sql = `
    SELECT t.id, t.poster_id, u.nickname, u.average_rating,
           t.type, t.description, t.location_address,
           ST_X(t.location::geometry) AS lng,
           ST_Y(t.location::geometry) AS lat,
           t.reward, t.deadline, t.status, t.intent_count,
           t.selected_helper_id, t.created_at
    FROM tasks t
    JOIN users u ON t.poster_id = u.id
    WHERE t.id = $1
  `;

  const result = await query<Omit<TaskRow, 'distance'>>(sql, [taskId]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
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
    reward: parseFloat(row.reward),
    deadline: row.deadline,
    status: row.status as Task['status'],
    intentCount: row.intent_count,
    selectedHelperId: row.selected_helper_id ?? undefined,
    createdAt: row.created_at,
  };
}

/**
 * Create a new task, storing coordinates as PostGIS geography point.
 */
export async function create(userId: string, payload: CreateTaskPayload): Promise<Task> {
  const sql = `
    INSERT INTO tasks (poster_id, type, description, location_address, location, reward, deadline)
    VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8)
    RETURNING id, poster_id, type, description, location_address,
              ST_X(location::geometry) AS lng,
              ST_Y(location::geometry) AS lat,
              reward, deadline, status, intent_count,
              selected_helper_id, created_at
  `;

  const values = [
    userId,                    // $1
    payload.type,              // $2
    payload.description,       // $3
    payload.location.address,  // $4
    payload.location.longitude, // $5
    payload.location.latitude,  // $6
    payload.reward,            // $7
    payload.deadline,          // $8
  ];

  const result = await query<Omit<TaskRow, 'distance' | 'nickname' | 'average_rating'>>(sql, values);
  const row = result.rows[0];

  // Fetch poster info separately since RETURNING can't JOIN
  const userResult = await query<{ nickname: string; average_rating: string }>(
    'SELECT nickname, average_rating FROM users WHERE id = $1',
    [userId]
  );
  const user = userResult.rows[0];

  return {
    id: row.id,
    posterId: row.poster_id,
    posterNickname: user?.nickname ?? '',
    posterRating: user ? parseFloat(user.average_rating) : 0,
    type: row.type as Task['type'],
    description: row.description,
    location: {
      address: row.location_address,
      latitude: row.lat,
      longitude: row.lng,
    },
    reward: parseFloat(row.reward),
    deadline: row.deadline,
    status: row.status as Task['status'],
    intentCount: row.intent_count,
    selectedHelperId: row.selected_helper_id ?? undefined,
    createdAt: row.created_at,
  };
}

/**
 * Update task status and clear the selected helper (revert to open).
 * Also resets all selected and rejected intents back to pending.
 */
export async function updateStatusAndClearHelper(
  taskId: string,
  status: TaskStatus
): Promise<Task | null> {
  // Reset all selected and rejected intents back to pending
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
              selected_helper_id, created_at
  `;

  const result = await query<Omit<TaskRow, 'distance' | 'nickname' | 'average_rating'>>(sql, [taskId, status]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  const userResult = await query<{ nickname: string; average_rating: string }>(
    'SELECT nickname, average_rating FROM users WHERE id = $1',
    [row.poster_id]
  );
  const user = userResult.rows[0];

  return {
    id: row.id,
    posterId: row.poster_id,
    posterNickname: user?.nickname ?? '',
    posterRating: user ? parseFloat(user.average_rating) : 0,
    type: row.type as Task['type'],
    description: row.description,
    location: {
      address: row.location_address,
      latitude: row.lat,
      longitude: row.lng,
    },
    reward: parseFloat(row.reward),
    deadline: row.deadline,
    status: row.status as Task['status'],
    intentCount: row.intent_count,
    selectedHelperId: row.selected_helper_id ?? undefined,
    createdAt: row.created_at,
  };
}

/**
 * Find tasks accepted by a user (where user is the selected helper).
 * Ordered by creation time (newest first).
 */
export async function findAcceptedByUser(userId: string): Promise<Task[]> {
  const sql = `
    SELECT t.id, t.poster_id, u.nickname, u.average_rating,
           t.type, t.description, t.location_address,
           ST_X(t.location::geometry) AS lng,
           ST_Y(t.location::geometry) AS lat,
           t.reward, t.deadline, t.status, t.intent_count,
           t.selected_helper_id, t.created_at
    FROM tasks t
    JOIN users u ON t.poster_id = u.id
    WHERE t.selected_helper_id = $1
    ORDER BY t.created_at DESC
  `;

  const result = await query<Omit<TaskRow, 'distance'>>(sql, [userId]);
  return result.rows.map((row) => ({
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
    reward: parseFloat(row.reward),
    deadline: row.deadline,
    status: row.status as Task['status'],
    intentCount: row.intent_count,
    selectedHelperId: row.selected_helper_id ?? undefined,
    createdAt: row.created_at,
  }));
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
                selected_helper_id, created_at
    `
    : `
      UPDATE tasks
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, poster_id, type, description, location_address,
                ST_X(location::geometry) AS lng,
                ST_Y(location::geometry) AS lat,
                reward, deadline, status, intent_count,
                selected_helper_id, created_at
    `;

  const values = selectedHelperId
    ? [taskId, status, selectedHelperId]
    : [taskId, status];

  const result = await query<Omit<TaskRow, 'distance' | 'nickname' | 'average_rating'>>(sql, values);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  // Fetch poster info
  const userResult = await query<{ nickname: string; average_rating: string }>(
    'SELECT nickname, average_rating FROM users WHERE id = $1',
    [row.poster_id]
  );
  const user = userResult.rows[0];

  return {
    id: row.id,
    posterId: row.poster_id,
    posterNickname: user?.nickname ?? '',
    posterRating: user ? parseFloat(user.average_rating) : 0,
    type: row.type as Task['type'],
    description: row.description,
    location: {
      address: row.location_address,
      latitude: row.lat,
      longitude: row.lng,
    },
    reward: parseFloat(row.reward),
    deadline: row.deadline,
    status: row.status as Task['status'],
    intentCount: row.intent_count,
    selectedHelperId: row.selected_helper_id ?? undefined,
    createdAt: row.created_at,
  };
}
