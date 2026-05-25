import express from 'express';
import request from 'supertest';
import { pool } from '../../../src/config/database';

// Mock the database pool
jest.mock('../../../src/config/database', () => ({
  pool: {
    query: jest.fn(),
  },
}));

// Import after mocking
import { healthController } from '../../../src/controllers/healthController';

const app = express();
app.use('/health', healthController);

describe('GET /health', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return 200 with healthy status when database is connected', async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'healthy',
      database: 'connected',
      version: expect.any(String),
    });
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('should return 503 with unhealthy status when database is disconnected', async () => {
    (pool.query as jest.Mock).mockRejectedValueOnce(new Error('Connection refused'));

    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: 'unhealthy',
      database: 'disconnected',
    });
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('should include the correct version from package.json', async () => {
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const res = await request(app).get('/health');

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { version } = require('../../../package.json');
    expect(res.body.version).toBe(version);
  });
});
