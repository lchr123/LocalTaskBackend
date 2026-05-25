import { IncomingMessage } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import jwt, { JwtHeader, SigningKeyCallback } from 'jsonwebtoken';
import { URL } from 'url';
import { jwksRsaClient } from '../config/cognito';
import { config } from '../config';
import { query } from '../config/database';
import { logger } from '../utils/logger';
import * as connectionManager from './connectionManager';
import { startHeartbeat, stopHeartbeat } from './heartbeat';
import { handleMessage } from './messageHandler';

interface CognitoJwtPayload {
  sub: string;
  email?: string;
  phone_number?: string;
  iss: string;
  exp: number;
  [key: string]: unknown;
}

/**
 * Retrieves the signing key from Cognito JWKS endpoint.
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
 * Verify JWT token (same logic as REST auth middleware).
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
 * Resolve cognito_sub to internal user ID.
 */
async function resolveUserId(cognitoSub: string): Promise<string | null> {
  const result = await query<{ id: string }>(
    'SELECT id FROM users WHERE cognito_sub = $1',
    [cognitoSub]
  );
  return result.rows.length > 0 ? result.rows[0].id : null;
}

/**
 * Extract token from WebSocket connection URL query parameters.
 */
function extractTokenFromUrl(req: IncomingMessage): string | null {
  try {
    const baseUrl = `http://${req.headers.host || 'localhost'}`;
    const url = new URL(req.url || '', baseUrl);
    return url.searchParams.get('token');
  } catch {
    return null;
  }
}

/**
 * Initialize WebSocket connection handling on an existing WebSocketServer.
 * Handles JWT authentication, connection management, heartbeat, and message routing.
 *
 * Validates: Requirements 4.1, 4.2, 4.6
 */
export function initializeWebSocket(wss: WebSocketServer): void {
  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    // 1. Extract token from query parameters
    const token = extractTokenFromUrl(req);

    if (!token) {
      logger.info('WebSocket connection rejected: no token');
      ws.close(4001, '认证失败');
      return;
    }

    // 2. Verify JWT token
    let payload: CognitoJwtPayload;
    try {
      payload = await verifyToken(token);
    } catch (err) {
      logger.info('WebSocket connection rejected: invalid token');
      ws.close(4001, '认证失败');
      return;
    }

    // 3. Resolve internal user ID
    const userId = await resolveUserId(payload.sub);
    if (!userId) {
      logger.info('WebSocket connection rejected: user not found', {
        cognitoSub: payload.sub,
      });
      ws.close(4001, '认证失败');
      return;
    }

    // 4. Register connection
    connectionManager.register(userId, ws);

    // 5. Start heartbeat
    startHeartbeat(ws, userId);

    logger.info('WebSocket connection authenticated', {
      userId,
      remoteAddress: req.socket.remoteAddress,
    });

    // 6. Handle incoming messages
    ws.on('message', async (data: WebSocket.RawData) => {
      try {
        const messageStr = data.toString();
        await handleMessage(ws, userId, messageStr);
      } catch (err) {
        logger.error('WebSocket message handling error', {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // 7. Handle connection close
    ws.on('close', (code, reason) => {
      connectionManager.unregister(userId, ws);
      stopHeartbeat(ws);
      logger.info('WebSocket connection closed', {
        userId,
        code,
        reason: reason.toString(),
      });
    });

    // 8. Handle errors
    ws.on('error', (error) => {
      logger.error('WebSocket error', {
        userId,
        error: error.message,
      });
      connectionManager.unregister(userId, ws);
      stopHeartbeat(ws);
    });
  });
}
