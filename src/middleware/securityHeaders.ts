import { Request, Response, NextFunction } from 'express';

/**
 * Middleware that sets security-related HTTP response headers:
 * - X-Content-Type-Options: nosniff — prevents MIME type sniffing
 * - X-Frame-Options: DENY — prevents clickjacking by disallowing framing
 * - Strict-Transport-Security: max-age=31536000 — enforces HTTPS for 1 year
 */
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}
