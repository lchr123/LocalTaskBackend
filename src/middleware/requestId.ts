import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Middleware that generates a unique request ID (UUID v4) for each incoming request.
 * - Sets the X-Request-Id response header
 * - Attaches the requestId to the request object for use in logging and downstream middleware
 * - If the client provides an X-Request-Id header, it is respected and reused
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const existingId = req.headers['x-request-id'] as string | undefined;
  const requestId = existingId || uuidv4();

  // Set response header
  res.setHeader('X-Request-Id', requestId);

  // Attach to request for downstream use (logging, error tracking)
  (req as Request & { requestId?: string }).requestId = requestId;

  next();
}
