import { Request, Response, NextFunction } from 'express';
import { errorHandler } from '../../../src/middleware/errorHandler';
import { AppError, ValidationError, NotFoundError, ConflictError } from '../../../src/utils/errors';

function createMockReqRes() {
  const req = {
    originalUrl: '/test/path',
    path: '/test/path',
    method: 'GET',
    requestId: 'test-request-id',
  } as unknown as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  const next = jest.fn() as NextFunction;
  return { req, res, next };
}

describe('errorHandler middleware', () => {
  beforeEach(() => {
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should handle AppError with correct status code and structured response', () => {
    const { req, res, next } = createMockReqRes();
    const error = new AppError(400, 'bad_request', 'Something went wrong');

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'bad_request',
      message: 'Something went wrong',
    });
  });

  it('should handle ValidationError with 422 and fields', () => {
    const { req, res, next } = createMockReqRes();
    const error = new ValidationError({ name: 'Name is required', age: 'Must be a number' });

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(422);
    const response = (res.json as jest.Mock).mock.calls[0][0];
    expect(response.error).toBe('validation_error');
    expect(response.fields).toEqual({ name: 'Name is required', age: 'Must be a number' });
  });

  it('should handle NotFoundError with 404', () => {
    const { req, res, next } = createMockReqRes();
    const error = new NotFoundError('Task not found');

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'not_found',
      message: 'Task not found',
    });
  });

  it('should handle ConflictError with 409', () => {
    const { req, res, next } = createMockReqRes();
    const error = new ConflictError('duplicate_intent', 'Already submitted');

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'duplicate_intent',
      message: 'Already submitted',
    });
  });

  it('should handle unknown errors with 500 and generic message', () => {
    const { req, res, next } = createMockReqRes();
    const error = new Error('Database connection failed');

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    const response = (res.json as jest.Mock).mock.calls[0][0];
    expect(response.error).toBe('internal_error');
    expect(response.message).toBeDefined();
    // Should NOT expose internal error details
    expect(response.message).not.toContain('Database connection failed');
  });

  it('should not expose stack trace in response for unknown errors', () => {
    const { req, res, next } = createMockReqRes();
    const error = new Error('Secret internal error');
    error.stack = 'Error: Secret internal error\n    at Object.<anonymous> (/app/src/service.ts:42:11)';

    errorHandler(error, req, res, next);

    const response = (res.json as jest.Mock).mock.calls[0][0];
    expect(JSON.stringify(response)).not.toContain('stack');
    expect(JSON.stringify(response)).not.toContain('/app/src/service.ts');
  });
});
