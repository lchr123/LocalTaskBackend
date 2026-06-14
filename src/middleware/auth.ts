import { Response, NextFunction } from 'express';
import jwt, { JwtHeader, SigningKeyCallback } from 'jsonwebtoken';
import { jwksRsaClient } from '../config/cognito';
import { config } from '../config';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../types/common';
import { logger } from '../utils/logger';

interface CognitoJwtPayload {
  sub: string;
  email?: string;
  phone_number?: string;
  iss: string;
  exp: number;
  token_use?: string;
  [key: string]: unknown;
}

/**
 * Retrieves the signing key from Cognito JWKS endpoint.
 * jwks-rsa handles caching internally (configured in cognito.ts).
 */
function getSigningKey(header: JwtHeader, callback: SigningKeyCallback): void {
  jwksRsaClient.getSigningKey(header.kid, (err, key) => {
    if (err) {
      logger.error(String(err))
      callback(err);
      return;
    }
    const signingKey = key?.getPublicKey();
    callback(null, signingKey);
  });
}

/**
 * Extracts the Bearer token from the Authorization header.
 * Returns null if the header is missing or malformed.
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  logger.info('authHeader: '+String(authHeader))
  if (!authHeader) {
    return null;
  }
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }
  const token = parts[1];
  logger.info(token)
  if (!token || token.trim().length === 0) {
    return null;
  }
  return token;
}

/**
 * Verifies the JWT token using Cognito public keys.
 * Validates signature (RS256), expiration (exp), and issuer (iss).
 */
function verifyToken(token: string): Promise<CognitoJwtPayload> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getSigningKey,
      {
        algorithms: ['RS256'],
        issuer: config.cognito.issuer,
      },
      (err, decoded) => {
        if (err) {
          logger.error(String(err))
          reject(err);
        } else {
          resolve(decoded as CognitoJwtPayload);
        }
      }
    );
  });
}

/**
 * Finds or creates a user record in the database based on cognito_sub.
 * Returns the internal user ID (UUID).
 */
async function findOrCreateUser(
  cognitoSub: string,
  email?: string | null,
  phone?: string | null
): Promise<string> {
  if (!cognitoSub) {
    throw new Error('Missing Cognito sub');
  }

  const normalizedEmail =
    email && email.trim().length > 0 ? email.trim().toLowerCase() : null;

  const normalizedPhone =
    phone && phone.trim().length > 0 ? phone.trim() : null;

  const randomStr = Math.random().toString(36).slice(2, 10);
  const nickname = `用户_${randomStr}`;

  const result = await query<{ id: string }>(
    `
    INSERT INTO users (
      cognito_sub,
      email,
      phone,
      nickname,
      average_rating,
      completed_task_count
    )
    VALUES ($1, $2, $3, $4, 0.0, 0)
    ON CONFLICT (cognito_sub)
    DO UPDATE SET
      email = COALESCE(EXCLUDED.email, users.email),
      phone = COALESCE(EXCLUDED.phone, users.phone)
    RETURNING id
    `,
    [cognitoSub, normalizedEmail, normalizedPhone, nickname]
  );

  const userId = result.rows[0].id;

  // Assign random DiceBear avatar if user doesn't have one yet
  await query(
    `UPDATE users SET avatar_url = $1, updated_at = NOW()
     WHERE id = $2 AND avatar_url IS NULL`,
    [`https://api.dicebear.com/7.x/thumbs/svg?seed=${userId}`, userId]
  );

  return userId;
}

/**
 * JWT Authentication Middleware.
 *
 * - Extracts Bearer token from Authorization header
 * - Verifies JWT signature (RS256), expiration, and issuer using Cognito JWKS
 * - On success: injects req.user = { sub, email, phone, userId } into request context
 * - Queries users table: auto-creates user record if cognito_sub doesn't exist
 * - Token missing/malformed: returns 401 {"error": "unauthorized", ...}
 * - Invalid signature/expired: returns 401 {"error": "token_expired", ...}
 *
 * When MOCK_AUTH=true (dev mode), bypasses JWT and uses a fixed dev user.
 */
export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      res.status(401).json({
        error: 'unauthorized',
        message: '认证令牌缺失或格式无效',
      });
      return;
    }

    let payload: CognitoJwtPayload;
    try {
      payload = await verifyToken(token);
    } catch (err) {
      res.status(401).json({
        error: 'token_expired',
        message: '认证令牌已过期，请重新登录',
      });
      return;
    }

    // Extract user info from JWT claims
    const sub = payload.sub;
    const email =
      typeof payload.email === 'string' && payload.email.trim().length > 0
        ? payload.email
        : null;

    const phone =
      typeof payload.phone_number === 'string' && payload.phone_number.trim().length > 0
        ? payload.phone_number
        : null;

    // Find or create user in database
    const userId = await findOrCreateUser(sub, email, phone);

    // Check if user is banned
    const banResult = await query<{ reason: string; expires_at: string | null }>(
      `SELECT reason, expires_at FROM user_bans
       WHERE user_id = $1 AND is_active = true
         AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [userId]
    );

    if (banResult.rows.length > 0) {
      const ban = banResult.rows[0];
      const message = ban.expires_at
        ? `账号已被暂停至 ${new Date(ban.expires_at).toLocaleDateString()}，原因：${ban.reason}`
        : `账号已被永久封禁，原因：${ban.reason}`;
      res.status(403).json({ error: 'account_banned', message });
      return;
    }

    // Inject user info into request context
    req.user = {
      sub,
      email,
      phone,
      userId,
    };

    next();
  } catch (error) {
    // Unexpected errors (e.g., database failure) - pass to error handler
    next(error);
  }
}
