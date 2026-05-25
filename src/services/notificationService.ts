/**
 * Notification Service - Placeholder implementation.
 *
 * MVP stage: logs notifications via structured logger.
 * Future: integrate with APNs (iOS) and FCM (Android) for push notifications
 * using device tokens from deviceTokenRepository.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

import { logger } from '../utils/logger';
import * as deviceTokenRepository from '../repositories/deviceTokenRepository';

/**
 * Notify the task poster that a new intent has been submitted.
 * Title: "新的帮手意向"
 */
export async function notifyNewIntent(
  posterId: string,
  helperNickname: string
): Promise<void> {
  logger.info('Notification: new intent', {
    type: 'new_intent',
    recipientId: posterId,
    title: '新的帮手意向',
    body: `${helperNickname} 对您的任务表达了意向`,
  });
}

/**
 * Notify the selected helper that they have been chosen.
 * Title: "您已被选中"
 */
export async function notifyHelperSelected(
  helperId: string,
  taskDescription: string
): Promise<void> {
  const preview = taskDescription.length > 50
    ? taskDescription.substring(0, 50) + '...'
    : taskDescription;

  logger.info('Notification: helper selected', {
    type: 'helper_selected',
    recipientId: helperId,
    title: '您已被选中',
    body: preview,
  });
}

/**
 * Notify rejected helpers that they were not selected.
 * Title: "意向未被选中"
 */
export async function notifyHelperRejected(
  helperIds: string[],
  taskDescription: string
): Promise<void> {
  const preview = taskDescription.length > 50
    ? taskDescription.substring(0, 50) + '...'
    : taskDescription;

  for (const helperId of helperIds) {
    logger.info('Notification: helper rejected', {
      type: 'helper_rejected',
      recipientId: helperId,
      title: '意向未被选中',
      body: preview,
    });
  }
}

/**
 * Notify a user about a new chat message (only when offline).
 * Title: sender's nickname
 */
export async function notifyNewMessage(
  recipientId: string,
  senderNickname: string,
  preview: string
): Promise<void> {
  const messagePreview = preview.length > 50
    ? preview.substring(0, 50) + '...'
    : preview;

  logger.info('Notification: new message', {
    type: 'new_message',
    recipientId,
    title: senderNickname,
    body: messagePreview,
  });
}

/**
 * Notify both poster and helper that the task is completed.
 * Title: "任务已完成"
 */
export async function notifyTaskCompleted(
  posterId: string,
  helperId: string,
  taskDescription: string
): Promise<void> {
  const preview = taskDescription.length > 50
    ? taskDescription.substring(0, 50) + '...'
    : taskDescription;

  logger.info('Notification: task completed', {
    type: 'task_completed',
    recipientIds: [posterId, helperId],
    title: '任务已完成',
    body: `${preview} - 请进行评价`,
  });
}

// ─── Device Token Management (delegates to repository) ───────────────────────

/**
 * Register or update a device push token for a user.
 * Called on user login or token refresh.
 */
export async function registerDeviceToken(
  userId: string,
  platform: deviceTokenRepository.Platform,
  token: string
): Promise<deviceTokenRepository.DeviceToken> {
  logger.info('Device token registered', { userId, platform });
  return deviceTokenRepository.upsert(userId, platform, token);
}

/**
 * Remove all device tokens for a user.
 * Called on user logout to stop push notifications.
 */
export async function unregisterDeviceTokens(userId: string): Promise<void> {
  logger.info('Device tokens cleared', { userId });
  return deviceTokenRepository.deleteByUserId(userId);
}

/**
 * Remove a device token for a specific platform.
 * Called when logging out from a single device.
 */
export async function unregisterDeviceToken(
  userId: string,
  platform: deviceTokenRepository.Platform
): Promise<void> {
  logger.info('Device token cleared', { userId, platform });
  return deviceTokenRepository.deleteByUserAndPlatform(userId, platform);
}
