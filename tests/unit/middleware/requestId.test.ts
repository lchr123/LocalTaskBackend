import { Request, Response, NextFunction } from 'express';
import { requestIdMiddleware } from '../../../src/middleware/requestId';

function createMockReqRes(headers: Record<string, string> = {}) {
  const req = {
    headers,
  } as unknown as Request;
  const res = {
    setHeader: jest.fn(),
  } as unknown as Response;
  const next = jest.fn() as NextFunction;
  return { req, res, next };
}

describe('requestIdMiddleware', () => {
  it('should generate a UUID and set X-Request-Id response header', () => {
    const { req, res, next } = createMockReqRes();

    requestIdMiddleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', expect.any(String));
    const requestId = (res.setHeader as jest.Mock).mock.calls[0][1];
    // UUID v4 format
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(next).toHaveBeenCalled();
  });

  it('should attach requestId to the request object', () => {
    const { req, res, next } = createMockReqRes();

    requestIdMiddleware(req, res, next);

    expect((req as Request & { requestId?: string }).requestId).toBeDefined();
    expect(typeof (req as Request & { requestId?: string }).requestId).toBe('string');
  });

  it('should reuse existing X-Request-Id from client header', () => {
    const existingId = 'client-provided-id-12345';
    const { req, res, next } = createMockReqRes({ 'x-request-id': existingId });

    requestIdMiddleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', existingId);
    expect((req as Request & { requestId?: string }).requestId).toBe(existingId);
    expect(next).toHaveBeenCalled();
  });

  it('should always call next()', () => {
    const { req, res, next } = createMockReqRes();

    requestIdMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
