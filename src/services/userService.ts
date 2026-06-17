import { User } from '../types/user';
import { NotFoundError, ValidationError } from '../utils/errors';
import * as userRepository from '../repositories/userRepository';
import { logger } from '../utils/logger';

/**
 * Get the current user's profile by their internal user ID.
 * Throws NotFoundError if the user does not exist.
 */
export async function getProfile(userId: string): Promise<User> {
  logger.info('user/me: '+String(userId))
  const user = await userRepository.findById(userId);

  if (!user) {
    throw new NotFoundError('用户不存在');
  }

  return user;
}

/**
 * Update the current user's profile.
 * Validates field lengths and updates any provided fields.
 * Throws NotFoundError if the user does not exist.
 */
export async function updateProfile(
  userId: string,
  updates: { nickname?: string; avatarUrl?: string; birthday?: string; gender?: string; address?: string; bio?: string }
): Promise<User> {
  const fields: Record<string, string> = {};

  if (updates.nickname !== undefined && updates.nickname.length > 50) {
    fields.nickname = '昵称不能超过50个字符';
  }

  if (updates.avatarUrl !== undefined && updates.avatarUrl.length > 500) {
    fields.avatarUrl = '头像URL不能超过500个字符';
  }

  if (updates.address !== undefined && updates.address.length > 200) {
    fields.address = '住址不能超过200个字符';
  }

  if (updates.bio !== undefined && updates.bio.length > 500) {
    fields.bio = '自我介绍不能超过500个字符';
  }

  if (Object.keys(fields).length > 0) {
    throw new ValidationError(fields);
  }

  const user = await userRepository.updateProfile(userId, updates);

  if (!user) {
    throw new NotFoundError('用户不存在');
  }

  return user;
}
