import corsLib from 'cors';
import { RequestHandler } from 'express';
import { config } from '../config';

/**
 * CORS configuration middleware.
 * - In development: allows all localhost origins
 * - In production: restricts to configured CORS_ORIGIN
 */
export const corsMiddleware: RequestHandler = corsLib({
  origin: config.nodeEnv === 'development'
    ? (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);
        // Allow all localhost origins in dev
        if (origin.startsWith('http://localhost')) return callback(null, true);
        callback(null, true);
      }
    : config.cors.origin,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id', 'Retry-After'],
  credentials: true,
  maxAge: 86400, // 24 hours preflight cache
});
