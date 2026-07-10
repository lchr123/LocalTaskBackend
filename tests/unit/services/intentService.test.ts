import {
  submitIntent,
  withdrawIntent,
  listIntents,
  selectHelper,
} from '../../../src/services/intentService';
import * as intentRepository from '../../../src/repositories/intentRepository';
import * as taskRepository from '../../../src/repositories/taskRepository';
import * as notificationService from '../../../src/services/notificationService';
import * as database from '../../../src/config/database';
import { NotFoundError, ConflictError, ForbiddenError } from '../../../src/utils/errors';
import { Task } from '../../../src/types/task';
import { Intent } from '../../../src/types/intent';

jest.mock('../../../src/repositories/intentRepository');
jest.mock('../../../src/repositories/taskRepository');
jest.mock('../../../src/services/notificationService');
jest.mock('../../../src/config/database');

const mockedIntentRepo = intentRepository as jest.Mocked<typeof intentRepository>;
const mockedTaskRepo = taskRepository as jest.Mocked<typeof taskRepository>;
const mockedNotification = notificationService as jest.Mocked<typeof notificationService>;
const mockedDb = database as jest.Mocked<typeof database>;

const mockTask: Task = {
  id: 'task-001',
  posterId: 'poster-001',
  posterNickname: 'テストユーザー',
  posterRating: 4.5,
  kind: 'task',
  type: 'delivery',
  description: 'テスト用のタスクです。配達をお願いします。',
  location: {
    address: '東京都渋谷区',
    latitude: 35.658,
    longitude: 139.7016,
  },
  reward: 1500,
  deadline: '2099-12-31T23:59:59.000Z',
  status: 'open',
  intentCount: 2,
  createdAt: '2024-01-01T00:00:00.000Z',
  images: [],
  headcount: 1,
};

const mockIntent: Intent = {
  id: 'intent-001',
  taskId: 'task-001',
  helperId: 'helper-001',
  helperNickname: 'ヘルパー太郎',
  helperRating: 4.2,
  helperCompletedCount: 10,
  message: 'お手伝いします！',
  status: 'pending',
  createdAt: '2024-01-02T00:00:00.000Z',
};

// Mock PoolClient for transaction tests
const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

describe('intentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedDb.getClient.mockResolvedValue(mockClient as any);
    mockedDb.query.mockResolvedValue({ rows: [], rowCount: 0 } as any);
    mockedNotification.notifyNewIntent.mockResolvedValue(undefined);
    mockedNotification.notifyHelperSelected.mockResolvedValue(undefined);
    mockedNotification.notifyHelperRejected.mockResolvedValue(undefined);
  });

  describe('submitIntent', () => {
    it('should create an intent when all validations pass', async () => {
      mockedTaskRepo.findById.mockResolvedValue(mockTask);
      mockedIntentRepo.findPendingByTaskAndHelper.mockResolvedValue(null);
      mockedIntentRepo.create.mockResolvedValue(mockIntent);

      const result = await submitIntent('task-001', 'helper-001', 'お手伝いします！');

      expect(result).toEqual(mockIntent);
      expect(mockedIntentRepo.create).toHaveBeenCalledWith('task-001', 'helper-001', 'お手伝いします！');
      expect(mockedDb.query).toHaveBeenCalledWith(
        expect.stringContaining('intent_count = intent_count + 1'),
        ['task-001']
      );
    });

    it('should throw NotFoundError when task does not exist', async () => {
      mockedTaskRepo.findById.mockResolvedValue(null);

      await expect(submitIntent('nonexistent', 'helper-001')).rejects.toThrow(NotFoundError);
      expect(mockedIntentRepo.create).not.toHaveBeenCalled();
    });

    it('should throw ConflictError when task is not open', async () => {
      const closedTask = { ...mockTask, status: 'in_progress' as const };
      mockedTaskRepo.findById.mockResolvedValue(closedTask);

      await expect(submitIntent('task-001', 'helper-001')).rejects.toThrow(ConflictError);
      expect(mockedIntentRepo.create).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenError when user is the task poster', async () => {
      mockedTaskRepo.findById.mockResolvedValue(mockTask);

      await expect(submitIntent('task-001', 'poster-001')).rejects.toThrow(ForbiddenError);
      expect(mockedIntentRepo.create).not.toHaveBeenCalled();
    });

    it('should throw ConflictError when duplicate pending intent exists', async () => {
      mockedTaskRepo.findById.mockResolvedValue(mockTask);
      mockedIntentRepo.findPendingByTaskAndHelper.mockResolvedValue(mockIntent);

      await expect(submitIntent('task-001', 'helper-001')).rejects.toThrow(ConflictError);
      expect(mockedIntentRepo.create).not.toHaveBeenCalled();
    });

    it('should handle unique constraint violation (race condition)', async () => {
      mockedTaskRepo.findById.mockResolvedValue(mockTask);
      mockedIntentRepo.findPendingByTaskAndHelper.mockResolvedValue(null);
      mockedIntentRepo.create.mockRejectedValue({ code: '23505' });

      await expect(submitIntent('task-001', 'helper-001')).rejects.toThrow(ConflictError);
    });

    it('should send notification to task poster', async () => {
      mockedTaskRepo.findById.mockResolvedValue(mockTask);
      mockedIntentRepo.findPendingByTaskAndHelper.mockResolvedValue(null);
      mockedIntentRepo.create.mockResolvedValue(mockIntent);

      await submitIntent('task-001', 'helper-001');

      expect(mockedNotification.notifyNewIntent).toHaveBeenCalledWith(
        'poster-001',
        'ヘルパー太郎'
      );
    });

    it('should not fail if notification fails', async () => {
      mockedTaskRepo.findById.mockResolvedValue(mockTask);
      mockedIntentRepo.findPendingByTaskAndHelper.mockResolvedValue(null);
      mockedIntentRepo.create.mockResolvedValue(mockIntent);
      mockedNotification.notifyNewIntent.mockRejectedValue(new Error('Push failed'));

      const result = await submitIntent('task-001', 'helper-001');
      expect(result).toEqual(mockIntent);
    });

    it('should create intent without message', async () => {
      mockedTaskRepo.findById.mockResolvedValue(mockTask);
      mockedIntentRepo.findPendingByTaskAndHelper.mockResolvedValue(null);
      mockedIntentRepo.create.mockResolvedValue({ ...mockIntent, message: undefined });

      const result = await submitIntent('task-001', 'helper-001');

      expect(result.message).toBeUndefined();
      expect(mockedIntentRepo.create).toHaveBeenCalledWith('task-001', 'helper-001', undefined);
    });
  });

  describe('withdrawIntent', () => {
    it('should withdraw an intent successfully', async () => {
      mockedTaskRepo.findById.mockResolvedValue(mockTask);
      mockedIntentRepo.withdrawIntent.mockResolvedValue(true);

      await expect(withdrawIntent('task-001', 'intent-001', 'helper-001')).resolves.toBeUndefined();

      expect(mockedIntentRepo.withdrawIntent).toHaveBeenCalledWith('intent-001', 'helper-001');
      expect(mockedDb.query).toHaveBeenCalledWith(
        expect.stringContaining('intent_count = GREATEST(intent_count - 1, 0)'),
        ['task-001']
      );
    });

    it('should throw NotFoundError when task does not exist', async () => {
      mockedTaskRepo.findById.mockResolvedValue(null);

      await expect(withdrawIntent('nonexistent', 'intent-001', 'helper-001')).rejects.toThrow(
        NotFoundError
      );
    });

    it('should throw NotFoundError when intent cannot be withdrawn', async () => {
      mockedTaskRepo.findById.mockResolvedValue(mockTask);
      mockedIntentRepo.withdrawIntent.mockResolvedValue(false);

      await expect(withdrawIntent('task-001', 'intent-001', 'helper-001')).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe('listIntents', () => {
    it('should return intents when requester is the task poster', async () => {
      mockedTaskRepo.findById.mockResolvedValue(mockTask);
      mockedIntentRepo.findByTaskId.mockResolvedValue([mockIntent]);

      const result = await listIntents('task-001', 'poster-001');

      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toEqual(mockIntent);
    });

    it('should throw NotFoundError when task does not exist', async () => {
      mockedTaskRepo.findById.mockResolvedValue(null);

      await expect(listIntents('nonexistent', 'poster-001')).rejects.toThrow(NotFoundError);
    });

    it('should throw ForbiddenError when requester is not the task poster', async () => {
      mockedTaskRepo.findById.mockResolvedValue(mockTask);

      await expect(listIntents('task-001', 'other-user')).rejects.toThrow(ForbiddenError);
    });

    it('should return empty list when no intents exist', async () => {
      mockedTaskRepo.findById.mockResolvedValue(mockTask);
      mockedIntentRepo.findByTaskId.mockResolvedValue([]);

      const result = await listIntents('task-001', 'poster-001');

      expect(result.intents).toHaveLength(0);
    });
  });

  describe('selectHelper', () => {
    it('should select a helper within a transaction', async () => {
      mockedTaskRepo.findById
        .mockResolvedValueOnce(mockTask) // First call: validation
        .mockResolvedValueOnce({ ...mockTask, status: 'in_progress', selectedHelperId: 'helper-001' }); // Second call: return updated task
      mockedIntentRepo.findPendingByTaskAndHelper.mockResolvedValue(mockIntent);
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce(undefined) // UPDATE tasks
        .mockResolvedValueOnce(undefined) // UPDATE intents (selected)
        .mockResolvedValueOnce({ rows: [{ helper_id: 'helper-002' }] }) // UPDATE intents (rejected) RETURNING
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await selectHelper('task-001', 'helper-001', 'poster-001');

      expect(result.status).toBe('in_progress');
      expect(result.selectedHelperId).toBe('helper-001');
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should throw NotFoundError when task does not exist', async () => {
      mockedTaskRepo.findById.mockResolvedValue(null);

      await expect(selectHelper('nonexistent', 'helper-001', 'poster-001')).rejects.toThrow(
        NotFoundError
      );
    });

    it('should throw ForbiddenError when requester is not the task poster', async () => {
      mockedTaskRepo.findById.mockResolvedValue(mockTask);

      await expect(selectHelper('task-001', 'helper-001', 'other-user')).rejects.toThrow(
        ForbiddenError
      );
    });

    it('should throw ConflictError when task is not open', async () => {
      const inProgressTask = { ...mockTask, status: 'in_progress' as const };
      mockedTaskRepo.findById.mockResolvedValue(inProgressTask);

      await expect(selectHelper('task-001', 'helper-001', 'poster-001')).rejects.toThrow(
        ConflictError
      );
    });

    it('should throw NotFoundError when helper has no pending intent', async () => {
      mockedTaskRepo.findById.mockResolvedValue(mockTask);
      mockedIntentRepo.findPendingByTaskAndHelper.mockResolvedValue(null);

      await expect(selectHelper('task-001', 'helper-001', 'poster-001')).rejects.toThrow(
        NotFoundError
      );
    });

    it('should rollback transaction on error', async () => {
      mockedTaskRepo.findById.mockResolvedValue(mockTask);
      mockedIntentRepo.findPendingByTaskAndHelper.mockResolvedValue(mockIntent);
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(new Error('DB error')); // UPDATE tasks fails

      await expect(selectHelper('task-001', 'helper-001', 'poster-001')).rejects.toThrow('DB error');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should send notifications to selected and rejected helpers', async () => {
      mockedTaskRepo.findById
        .mockResolvedValueOnce(mockTask)
        .mockResolvedValueOnce({ ...mockTask, status: 'in_progress', selectedHelperId: 'helper-001' });
      mockedIntentRepo.findPendingByTaskAndHelper.mockResolvedValue(mockIntent);
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce(undefined) // UPDATE tasks
        .mockResolvedValueOnce(undefined) // UPDATE intents (selected)
        .mockResolvedValueOnce({ rows: [{ helper_id: 'helper-002' }, { helper_id: 'helper-003' }] }) // rejected
        .mockResolvedValueOnce(undefined); // COMMIT

      await selectHelper('task-001', 'helper-001', 'poster-001');

      expect(mockedNotification.notifyHelperSelected).toHaveBeenCalledWith(
        'helper-001',
        mockTask.description
      );
      expect(mockedNotification.notifyHelperRejected).toHaveBeenCalledWith(
        ['helper-002', 'helper-003'],
        mockTask.description
      );
    });
  });
});
