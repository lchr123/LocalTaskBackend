import WebSocket from 'ws';
import { logger } from '../utils/logger';

/**
 * Connection Manager - maintains userId → WebSocket connection mapping.
 * Supports register, unregister, getConnection, and isOnline operations.
 *
 * Validates: Requirements 4.1, 4.6
 */

const connections = new Map<string, WebSocket>();

/**
 * Register a WebSocket connection for a user.
 * If the user already has a connection, close the old one first.
 */
export function register(userId: string, ws: WebSocket): void {
  const existing = connections.get(userId);
  if (existing && existing !== ws && existing.readyState === WebSocket.OPEN) {
    existing.close(1001, 'New connection established');
  }
  connections.set(userId, ws);
  logger.info('WebSocket connection registered', { userId });
}

/**
 * Unregister a WebSocket connection for a user.
 * Only removes if the stored connection matches the provided one.
 */
export function unregister(userId: string, ws: WebSocket): void {
  const existing = connections.get(userId);
  if (existing === ws) {
    connections.delete(userId);
    logger.info('WebSocket connection unregistered', { userId });
  }
}

/**
 * Get the WebSocket connection for a user.
 * Returns undefined if the user is not connected.
 */
export function getConnection(userId: string): WebSocket | undefined {
  const ws = connections.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    return ws;
  }
  // Clean up stale connections
  if (ws) {
    connections.delete(userId);
  }
  return undefined;
}

/**
 * Check if a user is currently online (has an active WebSocket connection).
 */
export function isOnline(userId: string): boolean {
  return getConnection(userId) !== undefined;
}

/**
 * Get the total number of active connections (for monitoring).
 */
export function getConnectionCount(): number {
  return connections.size;
}
