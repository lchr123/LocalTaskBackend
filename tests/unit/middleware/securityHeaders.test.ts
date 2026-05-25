import { Request, Response, NextFunction } from 'express';
import { securityHeadersMiddleware } from '../../../src/middleware/securityHeaders';

function createMockReqRes() {
  const req = {} as Request;
  const res = {
    setHeader: jest.fn(),
  } as unknown as Response;
  const next = jest.fn() as NextFunction;
  return { req, res, next };
}

describe('securityHeadersMiddleware', () => {
  it('should set X-Content-Type-Options to nosniff', () => {
    const { req, res, next } = createMockReqRes();

    securityHeadersMiddleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
  });

  it('should set X-Frame-Options to DENY', () => {
    const { req, res, next } = createMockReqRes();

    securityHeadersMiddleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
  });

  it('should set Strict-Transport-Security with max-age=31536000', () => {
    const { req, res, next } = createMockReqRes();

    securityHeadersMiddleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Strict-Transport-Security',
      expect.stringContaining('max-age=31536000')
    );
  });

  it('should call next()', () => {
    const { req, res, next } = createMockReqRes();

    securityHeadersMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
