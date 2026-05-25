import { Router, Request, Response } from 'express';
import { pool } from '../config/database';

const router = Router();

/**
 * GET /health
 * Health check endpoint — no authentication required.
 * Checks database connectivity and returns service status.
 */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  // Read version from package.json at runtime
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { version } = require('../../package.json') as { version: string };

  try {
    await pool.query('SELECT 1');
    res.status(200).json({
      status: 'healthy',
      database: 'connected',
      version,
    });
  } catch {
    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
    });
  }
});

export { router as healthController };
