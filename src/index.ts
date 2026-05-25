import dotenv from 'dotenv';

// Load environment variables before any other imports
dotenv.config();

import { startServer } from './server';
import { logger } from './utils/logger';

// Start the server
try {
  startServer();
} catch (error) {
  logger.error('Failed to start server', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}
