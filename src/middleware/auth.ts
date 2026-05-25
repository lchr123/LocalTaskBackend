import { Response, NextFunction } from 'express';
import jwt, { JwtHeader, SigningKeyCallback } from 'jsonwebtoken';
import { jwksRsaClient } from '../config/cognito';
import { config } from '../config';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../types/common';
import { UnauthorizedError } from '../utils/errors';

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
  if (!authHeader) {
    return null;
  }
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }
  const token = parts[1];
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
  email: string,
  phone?: string
): Promise<string> {
  // Try to find existing user
  const findResult = await query<{ id: string }>(
    'SELECT id FROM users WHERE cognito_sub = $1',
    [cognitoSub]
  );

  if (findResult.rows.length > 0) {
    return findResult.rows[0].id;
  }

  // Create new user record (use ON CONFLICT for race condition safety)
  const createResult = await query<{ id: string }>(
    `INSERT INTO users (cognito_sub, email, phone, average_rating, completed_task_count)
     VALUES ($1, $2, $3, 0.0, 0)
     ON CONFLICT (cognito_sub) DO UPDATE SET cognito_sub = EXCLUDED.cognito_sub
     RETURNING id`,
    [cognitoSub, email, phone || null]
  );

  return createResult.rows[0].id;
}

/**
 * Mock auth middleware for local development.
 * When MOCK_AUTH=true, skips JWT verification and uses a fixed dev user.
 */
async function mockAuthMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const mockSub = 'dev-user-001';
    const mockEmail = 'dev@localtask.local';

    const userId = await findOrCreateUser(mockSub, mockEmail);

    req.user = {
      sub: mockSub,
      email: mockEmail,
      phone: undefined,
      userId,
    };

    next();
  } catch (error) {
    next(error);
  }
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
  // Dev mode: skip JWT verification
  if (process.env.MOCK_AUTH === 'true') {
    return mockAuthMiddleware(req, res, next);
  }

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
    const email = payload.email || '';
    const phone = payload.phone_number;

    // Find or create user in database
    const userId = await findOrCreateUser(sub, email, phone);

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
