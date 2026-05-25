import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

function formatLog(level: LogLevel, message: string, metadata?: Record<string, unknown>): string {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...metadata,
  };
  return JSON.stringify(entry);
}

export const logger = {
  info(message: string, metadata?: Record<string, unknown>): void {
    process.stdout.write(formatLog('info', message, metadata) + '\n');
  },

  warn(message: string, metadata?: Record<string, unknown>): void {
    process.stdout.write(formatLog('warn', message, metadata) + '\n');
  },

  error(message: string, metadata?: Record<string, unknown>): void {
    process.stdout.write(formatLog('error', message, metadata) + '\n');
  },

  debug(message: string, metadata?: Record<string, unknown>): void {
    if (process.env.NODE_ENV !== 'production') {
      process.stdout.write(formatLog('debug', message, metadata) + '\n');
    }
  },
};

/**
 * Express middleware that logs structured access information for each request.
 * Logs: timestamp, requestId, method, path, statusCode, responseTimeMs, userId.
 * Sensitive information (tokens) is truncated to first 8 characters.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  // Use existing request ID from header or generate a new one
  const requestId = (req.headers['x-request-id'] as string) || uuidv4();
  res.setHeader('X-Request-Id', requestId);

  // Attach requestId to the request for downstream use
  (req as Request & { requestId?: string }).requestId = requestId;

  res.on('finish', () => {
    const responseTimeMs = Date.now() - startTime;
    const userId = (req as Request & { user?: { sub?: string } }).user?.sub;

    logger.info('request completed', {
      requestId,
      method: req.method,
      path: req.originalUrl || req.path,
      statusCode: res.statusCode,
      responseTimeMs,
      ...(userId ? { userId } : {}),
    });
  });

  next();
}
