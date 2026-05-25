import corsLib from 'cors';
import { RequestHandler } from 'express';
import { config } from '../config';

/**
 * CORS configuration middleware.
 * - Allows requests from the configured frontend domain (CORS_ORIGIN env var)
 * - Restricts allowed HTTP methods to GET, POST, PATCH, DELETE, OPTIONS
 * - Allows common headers including Authorization and Content-Type
 * - Exposes X-Request-Id header to the client
 */
export const corsMiddleware: RequestHandler = corsLib({
  origin: config.cors.origin,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id', 'Retry-After'],
  credentials: true,
  maxAge: 86400, // 24 hours preflight cache
});
