import {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
} from '../../../src/utils/errors';

describe('AppError', () => {
  it('should create an error with statusCode, error code, and message', () => {
    const err = new AppError(500, 'internal_error', 'Something went wrong');
    expect(err.statusCode).toBe(500);
    expect(err.error).toBe('internal_error');
    expect(err.message).toBe('Something went wrong');
    expect(err.fields).toBeUndefined();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  it('should include fields when provided', () => {
    const fields = { email: 'Invalid email format' };
    const err = new AppError(422, 'validation_error', 'Validation failed', fields);
    expect(err.fields).toEqual(fields);
  });

  it('toJSON should return structured error response', () => {
    const err = new AppError(404, 'not_found', 'Resource not found');
    expect(err.toJSON()).toEqual({
      error: 'not_found',
      message: 'Resource not found',
    });
  });

  it('toJSON should include fields when present', () => {
    const fields = { name: 'Required' };
    const err = new AppError(422, 'validation_error', 'Validation failed', fields);
    expect(err.toJSON()).toEqual({
      error: 'validation_error',
      message: 'Validation failed',
      fields: { name: 'Required' },
    });
  });
});

describe('ValidationError', () => {
  it('should have statusCode 422 and error code validation_error', () => {
    const fields = { description: '10文字以上必要です' };
    const err = new ValidationError(fields);
    expect(err.statusCode).toBe(422);
    expect(err.error).toBe('validation_error');
    expect(err.fields).toEqual(fields);
    expect(err).toBeInstanceOf(AppError);
  });

  it('should use first field value as message', () => {
    const fields = { reward: '0.01以上必要です', type: '無効な値' };
    const err = new ValidationError(fields);
    expect(err.message).toBe('0.01以上必要です');
  });
});

describe('NotFoundError', () => {
  it('should have statusCode 404 and error code not_found', () => {
    const err = new NotFoundError('任務不存在');
    expect(err.statusCode).toBe(404);
    expect(err.error).toBe('not_found');
    expect(err.message).toBe('任務不存在');
    expect(err).toBeInstanceOf(AppError);
  });
});

describe('ConflictError', () => {
  it('should have statusCode 409 with custom error code', () => {
    const err = new ConflictError('duplicate_intent', '您已对该任务提交过意向');
    expect(err.statusCode).toBe(409);
    expect(err.error).toBe('duplicate_intent');
    expect(err.message).toBe('您已对该任务提交过意向');
    expect(err).toBeInstanceOf(AppError);
  });
});

describe('UnauthorizedError', () => {
  it('should have statusCode 401 with custom error code', () => {
    const err = new UnauthorizedError('token_expired', '认证令牌已过期，请重新登录');
    expect(err.statusCode).toBe(401);
    expect(err.error).toBe('token_expired');
    expect(err.message).toBe('认证令牌已过期，请重新登录');
    expect(err).toBeInstanceOf(AppError);
  });
});

describe('ForbiddenError', () => {
  it('should have statusCode 403 and error code forbidden', () => {
    const err = new ForbiddenError('无权访问该资源');
    expect(err.statusCode).toBe(403);
    expect(err.error).toBe('forbidden');
    expect(err.message).toBe('无权访问该资源');
    expect(err).toBeInstanceOf(AppError);
  });
});
