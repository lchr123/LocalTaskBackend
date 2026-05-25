import {
  notifyNewIntent,
  notifyHelperSelected,
  notifyHelperRejected,
  notifyNewMessage,
  notifyTaskCompleted,
  registerDeviceToken,
  unregisterDeviceTokens,
  unregisterDeviceToken,
} from '../../../src/services/notificationService';
import * as deviceTokenRepository from '../../../src/repositories/deviceTokenRepository';
import { logger } from '../../../src/utils/logger';

jest.mock('../../../src/repositories/deviceTokenRepository');
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockedRepo = deviceTokenRepository as jest.Mocked<typeof deviceTokenRepository>;
const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('notificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('notifyNewIntent', () => {
    it('should log notification with poster ID and helper nickname', async () => {
      await notifyNewIntent('poster-001', '田中太郎');

      expect(mockedLogger.info).toHaveBeenCalledWith(
        'Notification: new intent',
        expect.objectContaining({
          type: 'new_intent',
          recipientId: 'poster-001',
          title: '新的帮手意向',
          body: expect.stringContaining('田中太郎'),
        })
      );
    });
  });

  describe('notifyHelperSelected', () => {
    it('should log notification with helper ID and task description', async () => {
      await notifyHelperSelected('helper-001', '配達をお願いします');

      expect(mockedLogger.info).toHaveBeenCalledWith(
        'Notification: helper selected',
        expect.objectContaining({
          type: 'helper_selected',
          recipientId: 'helper-001',
          title: '您已被选中',
          body: '配達をお願いします',
        })
      );
    });

    it('should truncate long task descriptions to 50 chars', async () => {
      const longDescription = 'A'.repeat(100);
      await notifyHelperSelected('helper-001', longDescription);

      expect(mockedLogger.info).toHaveBeenCalledWith(
        'Notification: helper selected',
        expect.objectContaining({
          body: 'A'.repeat(50) + '...',
        })
      );
    });
  });

  describe('notifyHelperRejected', () => {
    it('should log notification for each rejected helper', async () => {
      const helperIds = ['helper-001', 'helper-002', 'helper-003'];
      await notifyHelperRejected(helperIds, '買い物代行');

      expect(mockedLogger.info).toHaveBeenCalledTimes(3);
      for (const helperId of helperIds) {
        expect(mockedLogger.info).toHaveBeenCalledWith(
          'Notification: helper rejected',
          expect.objectContaining({
            type: 'helper_rejected',
            recipientId: helperId,
            title: '意向未被选中',
          })
        );
      }
    });

    it('should handle empty helper IDs array', async () => {
      await notifyHelperRejected([], '買い物代行');
      expect(mockedLogger.info).not.toHaveBeenCalled();
    });
  });

  describe('notifyNewMessage', () => {
    it('should log notification with sender nickname and message preview', async () => {
      await notifyNewMessage('recipient-001', '佐藤花子', 'こんにちは！');

      expect(mockedLogger.info).toHaveBeenCalledWith(
        'Notification: new message',
        expect.objectContaining({
          type: 'new_message',
          recipientId: 'recipient-001',
          title: '佐藤花子',
          body: 'こんにちは！',
        })
      );
    });

    it('should truncate long message previews to 50 chars', async () => {
      const longMessage = 'メ'.repeat(100);
      await notifyNewMessage('recipient-001', '佐藤花子', longMessage);

      expect(mockedLogger.info).toHaveBeenCalledWith(
        'Notification: new message',
        expect.objectContaining({
          body: 'メ'.repeat(50) + '...',
        })
      );
    });
  });

  describe('notifyTaskCompleted', () => {
    it('should log notification for both poster and helper', async () => {
      await notifyTaskCompleted('poster-001', 'helper-001', '配達タスク');

      expect(mockedLogger.info).toHaveBeenCalledWith(
        'Notification: task completed',
        expect.objectContaining({
          type: 'task_completed',
          recipientIds: ['poster-001', 'helper-001'],
          title: '任务已完成',
          body: expect.stringContaining('配達タスク'),
        })
      );
    });
  });

  describe('registerDeviceToken', () => {
    it('should delegate to repository upsert and log', async () => {
      const mockToken = {
        id: 'token-001',
        userId: 'user-001',
        token: 'device-token-abc',
        platform: 'ios' as const,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      mockedRepo.upsert.mockResolvedValue(mockToken);

      const result = await registerDeviceToken('user-001', 'ios', 'device-token-abc');

      expect(result).toEqual(mockToken);
      expect(mockedRepo.upsert).toHaveBeenCalledWith('user-001', 'ios', 'device-token-abc');
      expect(mockedLogger.info).toHaveBeenCalledWith(
        'Device token registered',
        expect.objectContaining({ userId: 'user-001', platform: 'ios' })
      );
    });
  });

  describe('unregisterDeviceTokens', () => {
    it('should delegate to repository deleteByUserId and log', async () => {
      mockedRepo.deleteByUserId.mockResolvedValue(undefined);

      await unregisterDeviceTokens('user-001');

      expect(mockedRepo.deleteByUserId).toHaveBeenCalledWith('user-001');
      expect(mockedLogger.info).toHaveBeenCalledWith(
        'Device tokens cleared',
        expect.objectContaining({ userId: 'user-001' })
      );
    });
  });

  describe('unregisterDeviceToken', () => {
    it('should delegate to repository deleteByUserAndPlatform and log', async () => {
      mockedRepo.deleteByUserAndPlatform.mockResolvedValue(undefined);

      await unregisterDeviceToken('user-001', 'android');

      expect(mockedRepo.deleteByUserAndPlatform).toHaveBeenCalledWith('user-001', 'android');
      expect(mockedLogger.info).toHaveBeenCalledWith(
        'Device token cleared',
        expect.objectContaining({ userId: 'user-001', platform: 'android' })
      );
    });
  });
});
