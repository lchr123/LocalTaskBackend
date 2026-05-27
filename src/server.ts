import http from 'http';
import { WebSocketServer } from 'ws';
import { app } from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { initializeWebSocket } from './websocket/wsServer';
import { startTaskScheduler, stopTaskScheduler } from './services/taskScheduler';

// Create HTTP Server with Express app
const server = http.createServer(app);

// Create WebSocket Server bound to the same HTTP Server
const wss = new WebSocketServer({
  server,
  path: '/ws/chat',
});

// Initialize WebSocket connection handling (auth, heartbeat, message routing)
initializeWebSocket(wss);

/**
 * Start the HTTP + WebSocket server.
 * Returns the running server instance for graceful shutdown support.
 */
export function startServer(): http.Server {
  const port = config.port;

  server.listen(port, () => {
    logger.info(`Server started`, {
      port,
      env: config.nodeEnv,
      wsPath: '/ws/chat',
    });

    // Start periodic task scheduler (auto-cancel expired tasks every 15 min)
    startTaskScheduler();
  });

  // Graceful shutdown handling
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);

    // Stop task scheduler
    stopTaskScheduler();

    // Close WebSocket connections
    wss.clients.forEach((client) => {
      client.close(1001, 'Server shutting down');
    });

    // Close HTTP server
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

export { server, wss };
