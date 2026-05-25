import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { Request, RequestHandler } from 'express';

/**
 * Rate limiter middleware for authentication endpoints.
 * Limit: 10 requests per minute per IP address.
 * Returns 429 with Retry-After header when exceeded.
 */
export const authRateLimiter: RequestHandler = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.rateLimit.auth, // 10 requests per minute per IP
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
  handler: (_req, res) => {
    const retryAfter = Math.ceil(60); // seconds until window resets
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({
      error: 'rate_limited',
      message: '请求过于频繁，请稍后重试',
    });
  },
});

/**
 * Rate limiter middleware for general API endpoints.
 * Limit: 60 requests per minute per authenticated user.
 * Falls back to IP-based limiting for unauthenticated requests.
 * Returns 429 with Retry-After header when exceeded.
 */
export const apiRateLimiter: RequestHandler = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.rateLimit.api, // 60 requests per minute per user
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    const user = (req as Request & { user?: { sub?: string } }).user;
    return user?.sub || req.ip || req.socket.remoteAddress || 'unknown';
  },
  handler: (_req, res) => {
    const retryAfter = Math.ceil(60);
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({
      error: 'rate_limited',
      message: '请求过于频繁，请稍后重试',
    });
  },
});

/**
 * Rate limiter middleware for upload endpoints.
 * Limit: 5 requests per minute per authenticated user.
 * Returns 429 with Retry-After header when exceeded.
 */
export const uploadRateLimiter: RequestHandler = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.rateLimit.upload, // 5 requests per minute per user
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    const user = (req as Request & { user?: { sub?: string } }).user;
    return user?.sub || req.ip || req.socket.remoteAddress || 'unknown';
  },
  handler: (_req, res) => {
    const retryAfter = Math.ceil(60);
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({
      error: 'rate_limited',
      message: '请求过于频繁，请稍后重试',
    });
  },
});
