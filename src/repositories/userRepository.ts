import { query } from '../config/database';
import { User } from '../types/user';

interface UserRow {
  id: string;
  cognito_sub: string;
  email: string;
  phone: string | null;
  nickname: string | null;
  avatar_url: string | null;
  average_rating: string;
  completed_task_count: number;
  birthday: string | null;
  address: string | null;
  bio: string | null;
  gender: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToUser(row: UserRow): User {
  return {
    id: row.id,
    cognitoSub: row.cognito_sub,
    email: row.email,
    phone: row.phone ?? undefined,
    nickname: row.nickname ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    averageRating: parseFloat(row.average_rating),
    completedTaskCount: row.completed_task_count,
    birthday: row.birthday || null,
    address: row.address || null,
    bio: row.bio || null,
    gender: row.gender || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Find a user by their Cognito sub (external identity).
 */
export async function findByCognitoSub(sub: string): Promise<User | null> {
  const sql = `
    SELECT u.id, u.cognito_sub, u.email, u.phone, u.nickname, u.avatar_url,
           u.average_rating, u.birthday, u.address, u.bio, u.gender, u.created_at, u.updated_at,
           (SELECT COUNT(*) FROM tasks t WHERE t.selected_helper_id = u.id AND t.status = 'completed')::int AS completed_task_count
    FROM users u
    WHERE u.cognito_sub = $1
  `;

  const result = await query<UserRow>(sql, [sub]);

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToUser(result.rows[0]);
}

/**
 * Find a user by their internal UUID.
 * completed_task_count is calculated from tasks table (not stored).
 */
export async function findById(userId: string): Promise<User | null> {
  const sql = `
    SELECT u.id, u.cognito_sub, u.email, u.phone, u.nickname, u.avatar_url,
           u.average_rating, u.birthday, u.address, u.bio, u.gender, u.created_at, u.updated_at,
           (SELECT COUNT(*) FROM tasks t WHERE t.selected_helper_id = u.id AND t.status = 'completed')::int AS completed_task_count
    FROM users u
    WHERE u.id = $1
  `;

  const result = await query<UserRow>(sql, [userId]);

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToUser(result.rows[0]);
}

/**
 * Create a new user record.
 * Uses ON CONFLICT to handle race conditions (idempotent).
 * Assigns a random avatar using DiceBear API with the user's ID as seed.
 */
export async function create(
  cognitoSub: string,
  email: string,
  phone?: string
): Promise<User> {
  const sql = `
    INSERT INTO users (cognito_sub, email, phone, average_rating, completed_task_count)
    VALUES ($1, $2, $3, 0.0, 0)
    ON CONFLICT (cognito_sub) DO UPDATE SET cognito_sub = EXCLUDED.cognito_sub
    RETURNING id, cognito_sub, email, phone, nickname, avatar_url,
              average_rating, completed_task_count, created_at, updated_at
  `;

  const result = await query<UserRow>(sql, [cognitoSub, email, phone || null]);
  const user = result.rows[0];

  // If avatar_url is null (new user), assign a random DiceBear avatar
  if (!user.avatar_url) {
    const avatarUrl = `https://api.dicebear.com/7.x/thumbs/svg?seed=${user.id}`;
    const updateSql = `
      UPDATE users SET avatar_url = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, cognito_sub, email, phone, nickname, avatar_url,
                average_rating, completed_task_count, created_at, updated_at
    `;
    const updated = await query<UserRow>(updateSql, [avatarUrl, user.id]);
    return mapRowToUser(updated.rows[0]);
  }

  return mapRowToUser(user);
}

/**
 * Update user profile fields.
 * Only updates fields that are provided (non-undefined).
 */
export async function updateProfile(
  userId: string,
  updates: { nickname?: string; avatarUrl?: string; birthday?: string; gender?: string; address?: string; bio?: string }
): Promise<User | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.nickname !== undefined) {
    setClauses.push(`nickname = $${paramIndex}`);
    values.push(updates.nickname);
    paramIndex++;
  }

  if (updates.avatarUrl !== undefined) {
    setClauses.push(`avatar_url = $${paramIndex}`);
    values.push(updates.avatarUrl);
    paramIndex++;
  }

  if (updates.birthday !== undefined) {
    setClauses.push(`birthday = $${paramIndex}`);
    values.push(updates.birthday || null);
    paramIndex++;
  }

  if (updates.address !== undefined) {
    setClauses.push(`address = $${paramIndex}`);
    values.push(updates.address);
    paramIndex++;
  }

  if (updates.bio !== undefined) {
    setClauses.push(`bio = $${paramIndex}`);
    values.push(updates.bio);
    paramIndex++;
  }

  if (updates.gender !== undefined) {
    setClauses.push(`gender = $${paramIndex}`);
    values.push(updates.gender);
    paramIndex++;
  }

  if (setClauses.length === 0) {
    // Nothing to update, just return the current user
    return findById(userId);
  }

  setClauses.push(`updated_at = NOW()`);

  const sql = `
    UPDATE users
    SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING id, cognito_sub, email, phone, nickname, avatar_url,
              average_rating, completed_task_count, birthday, address, bio, gender, created_at, updated_at
  `;

  values.push(userId);

  const result = await query<UserRow>(sql, values);

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToUser(result.rows[0]);
}

/**
 * Update a user's average rating.
 * Called after a new review is submitted.
 */
export async function updateRating(
  userId: string,
  newRating: number
): Promise<User | null> {
  const sql = `
    UPDATE users
    SET average_rating = $2, updated_at = NOW()
    WHERE id = $1
    RETURNING id, cognito_sub, email, phone, nickname, avatar_url,
              average_rating, completed_task_count, created_at, updated_at
  `;

  const result = await query<UserRow>(sql, [userId, newRating]);

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToUser(result.rows[0]);
}
