import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

/**
 * Global error handling middleware.
 *
 * - AppError instances: returns structured JSON response with the appropriate status code.
 * - Unknown errors: returns 500 with a generic message. Detailed error info is logged
 *   server-side but never exposed to the client.
 *
 * Response format: { "error": "error_code", "message": "human readable description", "fields"?: {...} }
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = (req as Request & { requestId?: string }).requestId;

  if (err instanceof AppError) {
    // Known application error — return structured response
    logger.warn('Application error', {
      requestId,
      error: err.error,
      message: err.message,
      statusCode: err.statusCode,
      path: req.originalUrl || req.path,
      method: req.method,
    });

    res.status(err.statusCode).json(err.toJSON());
    return;
  }

  // Unknown/unexpected error — log full details, return generic 500
  logger.error('Unexpected internal error', {
    requestId,
    error: err.message,
    stack: err.stack,
    path: req.originalUrl || req.path,
    method: req.method,
  });

  res.status(500).json({
    error: 'internal_error',
    message: 'サーバー内部エラーが発生しました。しばらくしてから再度お試しください',
  });
}
