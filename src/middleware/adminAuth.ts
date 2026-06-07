/**
 * Admin Authentication Middleware
 *
 * Simple JWT-based admin auth using environment credentials.
 * Admin login returns a JWT, subsequent requests validate it.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const ADMIN_JWT_SECRET = 'locally_helper_admin_2026';

export interface AdminRequest extends Request {
  admin?: { username: string };
}

/**
 * Middleware to verify admin JWT token.
 * Token should be in Authorization header as "Bearer <token>".
 */
export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized', message: '未提供管理员凭证' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, ADMIN_JWT_SECRET) as { username: string; role: string };

    if (payload.role !== 'admin') {
      res.status(403).json({ error: 'forbidden', message: '无管理员权限' });
      return;
    }

    (req as AdminRequest).admin = { username: payload.username };
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized', message: '管理员凭证无效或已过期' });
  }
}
