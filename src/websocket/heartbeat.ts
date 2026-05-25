import WebSocket from 'ws';
import { logger } from '../utils/logger';

const PING_INTERVAL = 30000; // 30 seconds
const PONG_TIMEOUT = 10000;  // 10 seconds

/**
 * Heartbeat manager for WebSocket connections.
 * Sends ping every 30s, closes connection if no pong within 10s.
 *
 * Validates: Requirements 4.6
 */

interface HeartbeatState {
  pingInterval: NodeJS.Timeout;
  pongTimeout: NodeJS.Timeout | null;
  isAlive: boolean;
}

const heartbeats = new Map<WebSocket, HeartbeatState>();

/**
 * Start heartbeat monitoring for a WebSocket connection.
 */
export function startHeartbeat(ws: WebSocket, userId: string): void {
  const state: HeartbeatState = {
    pingInterval: setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        stopHeartbeat(ws);
        return;
      }

      // Send ping
      ws.ping();

      // Start pong timeout
      state.pongTimeout = setTimeout(() => {
        logger.info('WebSocket pong timeout, closing connection', { userId });
        ws.close(1001, 'Pong timeout');
        stopHeartbeat(ws);
      }, PONG_TIMEOUT);
    }, PING_INTERVAL),
    pongTimeout: null,
    isAlive: true,
  };

  heartbeats.set(ws, state);

  // Listen for pong responses
  ws.on('pong', () => {
    const s = heartbeats.get(ws);
    if (s && s.pongTimeout) {
      clearTimeout(s.pongTimeout);
      s.pongTimeout = null;
    }
  });
}

/**
 * Stop heartbeat monitoring for a WebSocket connection.
 */
export function stopHeartbeat(ws: WebSocket): void {
  const state = heartbeats.get(ws);
  if (state) {
    clearInterval(state.pingInterval);
    if (state.pongTimeout) {
      clearTimeout(state.pongTimeout);
    }
    heartbeats.delete(ws);
  }
}
