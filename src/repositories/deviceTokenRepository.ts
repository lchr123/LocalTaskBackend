import { query } from '../config/database';

/**
 * Device Token Repository
 *
 * Handles CRUD operations for push notification device tokens.
 * Supports iOS (APNs) and Android (FCM) platforms.
 *
 * Validates: Requirements 7.6
 */

export type Platform = 'ios' | 'android';

export interface DeviceToken {
  id: string;
  userId: string;
  token: string;
  platform: Platform;
  createdAt: string;
  updatedAt: string;
}

interface DeviceTokenRow {
  id: string;
  user_id: string;
  token: string;
  platform: string;
  created_at: string;
  updated_at: string;
}

function mapRowToDeviceToken(row: DeviceTokenRow): DeviceToken {
  return {
    id: row.id,
    userId: row.user_id,
    token: row.token,
    platform: row.platform as Platform,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Store or update a device token for a user.
 * Uses UPSERT (ON CONFLICT) to handle re-registration on the same platform.
 * Called when a user logs in or refreshes their push token.
 */
export async function upsert(
  userId: string,
  platform: Platform,
  token: string
): Promise<DeviceToken> {
  const sql = `
    INSERT INTO device_tokens (user_id, platform, token, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (user_id, platform)
    DO UPDATE SET token = $3, updated_at = NOW()
    RETURNING id, user_id, token, platform, created_at, updated_at
  `;

  const result = await query<DeviceTokenRow>(sql, [userId, platform, token]);
  return mapRowToDeviceToken(result.rows[0]);
}

/**
 * Find all device tokens for a given user.
 * Used when sending push notifications to a specific user.
 */
export async function findByUserId(userId: string): Promise<DeviceToken[]> {
  const sql = `
    SELECT id, user_id, token, platform, created_at, updated_at
    FROM device_tokens
    WHERE user_id = $1
  `;

  const result = await query<DeviceTokenRow>(sql, [userId]);
  return result.rows.map(mapRowToDeviceToken);
}

/**
 * Find a device token by user ID and platform.
 */
export async function findByUserAndPlatform(
  userId: string,
  platform: Platform
): Promise<DeviceToken | null> {
  const sql = `
    SELECT id, user_id, token, platform, created_at, updated_at
    FROM device_tokens
    WHERE user_id = $1 AND platform = $2
  `;

  const result = await query<DeviceTokenRow>(sql, [userId, platform]);
  return result.rows.length > 0 ? mapRowToDeviceToken(result.rows[0]) : null;
}

/**
 * Delete all device tokens for a user.
 * Called when a user logs out to stop receiving push notifications.
 */
export async function deleteByUserId(userId: string): Promise<void> {
  const sql = `DELETE FROM device_tokens WHERE user_id = $1`;
  await query(sql, [userId]);
}

/**
 * Delete a specific device token by user ID and platform.
 * Called when a user logs out from a specific device.
 */
export async function deleteByUserAndPlatform(
  userId: string,
  platform: Platform
): Promise<void> {
  const sql = `DELETE FROM device_tokens WHERE user_id = $1 AND platform = $2`;
  await query(sql, [userId, platform]);
}

/**
 * Delete a device token by its token value.
 * Useful for cleaning up invalid/expired tokens reported by APNs/FCM.
 */
export async function deleteByToken(token: string): Promise<void> {
  const sql = `DELETE FROM device_tokens WHERE token = $1`;
  await query(sql, [token]);
}
