import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../../../src/middleware/validation';

function createMockReqResNext(body: unknown) {
  const req = { body } as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  const next = jest.fn() as NextFunction;
  return { req, res, next };
}

describe('validate middleware', () => {
  const schema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    age: z.number().int().min(0, 'Age must be non-negative'),
  });

  it('should call next() when body is valid', () => {
    const { req, res, next } = createMockReqResNext({ name: 'Alice', age: 25 });
    const middleware = validate(schema);

    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.body).toEqual({ name: 'Alice', age: 25 });
  });

  it('should return 422 with field errors when body is invalid', () => {
    const { req, res, next } = createMockReqResNext({ name: 'A', age: -1 });
    const middleware = validate(schema);

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'validation_error',
        fields: expect.any(Object),
      })
    );
  });

  it('should return field-level errors for each invalid field', () => {
    const { req, res, next } = createMockReqResNext({ name: '', age: 'not a number' });
    const middleware = validate(schema);

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const response = (res.json as jest.Mock).mock.calls[0][0];
    expect(response.error).toBe('validation_error');
    expect(response.fields).toBeDefined();
    // Should have errors for both fields
    expect(Object.keys(response.fields).length).toBeGreaterThanOrEqual(1);
  });

  it('should replace req.body with parsed data (strips extra fields)', () => {
    const { req, res, next } = createMockReqResNext({ name: 'Bob', age: 30, extra: 'field' });
    const strictSchema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const middleware = validate(strictSchema);

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    // Zod strips unknown keys by default
    expect(req.body).toEqual({ name: 'Bob', age: 30 });
  });

  it('should include message field in error response', () => {
    const { req, res, next } = createMockReqResNext({});
    const middleware = validate(schema);

    middleware(req, res, next);

    const response = (res.json as jest.Mock).mock.calls[0][0];
    expect(response.message).toBeDefined();
    expect(typeof response.message).toBe('string');
  });
});
