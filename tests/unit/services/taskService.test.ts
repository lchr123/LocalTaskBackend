import { listTasks, getTask, createTask, updateTaskStatus } from '../../../src/services/taskService';
import * as taskRepository from '../../../src/repositories/taskRepository';
import * as taskTagRepository from '../../../src/repositories/taskTagRepository';
import { NotFoundError, ConflictError, ValidationError } from '../../../src/utils/errors';
import { Task, TaskStatus } from '../../../src/types/task';

jest.mock('../../../src/repositories/taskRepository');
jest.mock('../../../src/repositories/taskTagRepository');
jest.mock('../../../src/services/uploadService', () => ({
  getPresignedUrl: jest.fn((url: string) => Promise.resolve(url)),
}));

const mockedRepo = taskRepository as jest.Mocked<typeof taskRepository>;
const mockedTagRepo = taskTagRepository as jest.Mocked<typeof taskTagRepository>;

const mockTask: Task = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  posterId: 'user-001',
  posterNickname: 'テストユーザー',
  posterRating: 4.5,
  kind: 'task',
  type: 'delivery',
  description: 'テスト用のタスクです。配達をお願いします。',
  location: {
    address: '東京都渋谷区',
    latitude: 35.6580,
    longitude: 139.7016,
  },
  reward: 1500,
  deadline: '2099-12-31T23:59:59.000Z',
  status: 'open',
  intentCount: 3,
  createdAt: '2024-01-01T00:00:00.000Z',
  images: [],
  headcount: 1,
  distance: 1.25,
};

describe('taskService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // No tags attached by default; individual tests can override.
    mockedTagRepo.getForTasks.mockResolvedValue(new Map());
  });

  describe('listTasks', () => {
    it('should return tasks with pagination metadata', async () => {
      mockedRepo.findNearby.mockResolvedValue([mockTask]);
      mockedRepo.countNearby.mockResolvedValue(25);

      const result = await listTasks({
        kind: 'task',
        lat: 35.68,
        lng: 139.76,
        radius: 10,
        page: 1,
        pageSize: 20,
      });

      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]).toEqual({ ...mockTask, tags: [] });
      expect(result.page).toBe(1);
      expect(result.totalCount).toBe(25);
      expect(result.totalPages).toBe(2); // ceil(25/20) = 2
    });

    it('should calculate totalPages correctly', async () => {
      mockedRepo.findNearby.mockResolvedValue([]);
      mockedRepo.countNearby.mockResolvedValue(50);

      const result = await listTasks({
        kind: 'task',
        lat: 35.68,
        lng: 139.76,
        radius: 10,
        page: 3,
        pageSize: 10,
      });

      expect(result.totalPages).toBe(5); // ceil(50/10) = 5
      expect(result.page).toBe(3);
    });

    it('should return totalPages=0 when no tasks found', async () => {
      mockedRepo.findNearby.mockResolvedValue([]);
      mockedRepo.countNearby.mockResolvedValue(0);

      const result = await listTasks({
        kind: 'task',
        lat: 35.68,
        lng: 139.76,
        radius: 10,
        page: 1,
        pageSize: 20,
      });

      expect(result.tasks).toHaveLength(0);
      expect(result.totalPages).toBe(0);
      expect(result.totalCount).toBe(0);
    });

    it('should pass filter params to repository', async () => {
      mockedRepo.findNearby.mockResolvedValue([]);
      mockedRepo.countNearby.mockResolvedValue(0);

      await listTasks({
        kind: 'task',
        lat: 35.68,
        lng: 139.76,
        radius: 5,
        type: 'shopping',
        minReward: 500,
        maxReward: 3000,
        page: 2,
        pageSize: 10,
      });

      expect(mockedRepo.findNearby).toHaveBeenCalledWith({
        kind: 'task',
        lat: 35.68,
        lng: 139.76,
        radius: 5,
        type: 'shopping',
        minReward: 500,
        maxReward: 3000,
        tagIds: undefined,
        sort: undefined,
        pageSize: 10,
        offset: 10, // (page-1) * pageSize = (2-1)*10
      });

      expect(mockedRepo.countNearby).toHaveBeenCalledWith({
        kind: 'task',
        lat: 35.68,
        lng: 139.76,
        radius: 5,
        type: 'shopping',
        minReward: 500,
        maxReward: 3000,
        tagIds: undefined,
      });
    });
  });

  describe('getTask', () => {
    it('should return the task when found', async () => {
      mockedRepo.findById.mockResolvedValue(mockTask);

      const result = await getTask('123e4567-e89b-12d3-a456-426614174000');

      expect(result).toEqual({ ...mockTask, tags: [] });
      expect(mockedRepo.findById).toHaveBeenCalledWith('123e4567-e89b-12d3-a456-426614174000');
    });

    it('should throw NotFoundError when task does not exist', async () => {
      mockedRepo.findById.mockResolvedValue(null);

      await expect(getTask('nonexistent-id')).rejects.toThrow(NotFoundError);
    });
  });

  describe('createTask', () => {
    const validPayload = {
      type: 'delivery' as const,
      description: 'テスト用のタスクです。配達をお願いします。',
      location: {
        address: '東京都渋谷区',
        latitude: 35.6580,
        longitude: 139.7016,
      },
      reward: 1500,
      deadline: '2099-12-31T23:59:59.000Z',
    };

    it('should create a task when deadline is in the future', async () => {
      mockedRepo.create.mockResolvedValue(mockTask);

      const result = await createTask('user-001', validPayload);

      expect(result).toEqual({ ...mockTask, tags: [] });
      expect(mockedRepo.create).toHaveBeenCalledWith('user-001', validPayload);
    });

    it('should throw ValidationError when deadline is in the past', async () => {
      const pastPayload = {
        ...validPayload,
        deadline: '2020-01-01T00:00:00.000Z',
      };

      await expect(createTask('user-001', pastPayload)).rejects.toThrow(ValidationError);
      expect(mockedRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('updateTaskStatus', () => {
    it('should allow open → in_progress transition', async () => {
      const openTask = { ...mockTask, status: 'open' as TaskStatus };
      const updatedTask = { ...mockTask, status: 'in_progress' as TaskStatus };
      mockedRepo.findById.mockResolvedValue(openTask);
      mockedRepo.updateStatus.mockResolvedValue(updatedTask);

      const result = await updateTaskStatus(mockTask.id, 'in_progress', 'user-001');

      expect(result.status).toBe('in_progress');
    });

    it('should allow open → cancelled transition', async () => {
      const openTask = { ...mockTask, status: 'open' as TaskStatus };
      const updatedTask = { ...mockTask, status: 'cancelled' as TaskStatus };
      mockedRepo.findById.mockResolvedValue(openTask);
      mockedRepo.updateStatus.mockResolvedValue(updatedTask);

      const result = await updateTaskStatus(mockTask.id, 'cancelled', 'user-001');

      expect(result.status).toBe('cancelled');
    });

    it('should allow in_progress → completed transition', async () => {
      const inProgressTask = { ...mockTask, status: 'in_progress' as TaskStatus };
      const updatedTask = { ...mockTask, status: 'completed' as TaskStatus };
      mockedRepo.findById.mockResolvedValue(inProgressTask);
      mockedRepo.updateStatus.mockResolvedValue(updatedTask);

      const result = await updateTaskStatus(mockTask.id, 'completed', 'user-001');

      expect(result.status).toBe('completed');
    });

    it('should allow in_progress → cancelled transition', async () => {
      const inProgressTask = { ...mockTask, status: 'in_progress' as TaskStatus };
      const updatedTask = { ...mockTask, status: 'cancelled' as TaskStatus };
      mockedRepo.findById.mockResolvedValue(inProgressTask);
      mockedRepo.updateStatus.mockResolvedValue(updatedTask);

      const result = await updateTaskStatus(mockTask.id, 'cancelled', 'user-001');

      expect(result.status).toBe('cancelled');
    });

    it('should throw ConflictError for open → completed (invalid)', async () => {
      const openTask = { ...mockTask, status: 'open' as TaskStatus };
      mockedRepo.findById.mockResolvedValue(openTask);

      await expect(
        updateTaskStatus(mockTask.id, 'completed', 'user-001')
      ).rejects.toThrow(ConflictError);
      expect(mockedRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('should throw ConflictError for completed → open (invalid)', async () => {
      const completedTask = { ...mockTask, status: 'completed' as TaskStatus };
      mockedRepo.findById.mockResolvedValue(completedTask);

      await expect(
        updateTaskStatus(mockTask.id, 'open', 'user-001')
      ).rejects.toThrow(ConflictError);
    });

    it('should throw ConflictError for cancelled → open (invalid)', async () => {
      const cancelledTask = { ...mockTask, status: 'cancelled' as TaskStatus };
      mockedRepo.findById.mockResolvedValue(cancelledTask);

      await expect(
        updateTaskStatus(mockTask.id, 'open', 'user-001')
      ).rejects.toThrow(ConflictError);
    });

    it('should throw NotFoundError when task does not exist', async () => {
      mockedRepo.findById.mockResolvedValue(null);

      await expect(
        updateTaskStatus('nonexistent-id', 'in_progress', 'user-001')
      ).rejects.toThrow(NotFoundError);
      expect(mockedRepo.updateStatus).not.toHaveBeenCalled();
    });
  });
});
