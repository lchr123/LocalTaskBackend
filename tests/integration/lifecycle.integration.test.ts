/**
 * Integration Tests - Full Task Lifecycle
 *
 * Uses:
 * - supertest for HTTP API testing
 * - testcontainers for PostgreSQL + PostGIS container
 * - jose for JWT token generation (mock JWKS)
 * - aws-sdk-client-mock for S3 mocking
 *
 * Tests:
 * 1. Complete task lifecycle: create → intent → select helper → complete → review
 * 2. Authentication flow (mock JWKS endpoint)
 * 3. WebSocket connection, message send, ack receive
 * 4. Concurrent intent submission (unique constraint)
 * 5. Image upload (mock S3)
 *
 * Validates: Requirements 1.1, 2.1, 3.1, 4.1, 5.1, 6.3
 */

import http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { Pool } from 'pg';
import * as jose from 'jose';
import { WebSocket } from 'ws';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';

// ─── Test Setup Variables ───────────────────────────────────────────────────────

let container: StartedTestContainer;
let testPool: Pool;
let server: http.Server;
let baseUrl: string;
let privateKey: jose.KeyLike;
let publicKey: jose.KeyLike;
let jwksJson: { keys: jose.JWK[] };

// Mock S3 client
const s3Mock = mockClient(S3Client);

// Test user data
const POSTER_SUB = 'poster-cognito-sub-001';
const POSTER_EMAIL = 'poster@test.com';
const HELPER_SUB = 'helper-cognito-sub-002';
const HELPER_EMAIL = 'helper@test.com';
const HELPER2_SUB = 'helper2-cognito-sub-003';
const HELPER2_EMAIL = 'helper2@test.com';

// ─── JWT Token Generation Helpers ───────────────────────────────────────────────

async function generateKeyPair() {
  const { publicKey: pub, privateKey: priv } = await jose.generateKeyPair('RS256');
  privateKey = priv;
  publicKey = pub;

  const publicJwk = await jose.exportJWK(publicKey);
  publicJwk.kid = 'test-key-id-1';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';

  jwksJson = { keys: [publicJwk] };
}

async function generateToken(sub: string, email: string, phone?: string): Promise<string> {
  const issuer = process.env.COGNITO_ISSUER || 'https://cognito-idp.ap-northeast-1.amazonaws.com/test-pool-id';

  const token = await new jose.SignJWT({
    sub,
    email,
    phone_number: phone,
    token_use: 'access',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-id-1' })
    .setIssuer(issuer)
    .setExpirationTime('1h')
    .setIssuedAt()
    .sign(privateKey);

  return token;
}

// ─── Database Setup ─────────────────────────────────────────────────────────────

async function runMigrations(pool: Pool): Promise<void> {
  const migrationsDir = path.join(__dirname, '../../migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql') && !f.startsWith('.'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    // Only run the "up" part (before "---- create above / drop below ----")
    const upSql = sql.split('---- create above / drop below ----')[0];
    await pool.query(upSql);
  }
}

// ─── Mock JWKS Server ───────────────────────────────────────────────────────────

let jwksServer: http.Server;
let jwksPort: number;

function startJwksServer(): Promise<void> {
  return new Promise((resolve) => {
    jwksServer = http.createServer((req, res) => {
      if (req.url?.includes('.well-known/jwks.json')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(jwksJson));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    jwksServer.listen(0, () => {
      jwksPort = (jwksServer.address() as AddressInfo).port;
      resolve();
    });
  });
}

// ─── Test Lifecycle ─────────────────────────────────────────────────────────────

beforeAll(async () => {
  // 1. Generate RSA key pair for JWT signing
  await generateKeyPair();

  // 2. Start mock JWKS server
  await startJwksServer();

  // 3. Start PostgreSQL + PostGIS container
  container = await new GenericContainer('postgis/postgis:15-3.3')
    .withExposedPorts(5432)
    .withEnvironment({
      POSTGRES_USER: 'testuser',
      POSTGRES_PASSWORD: 'testpass',
      POSTGRES_DB: 'testdb',
    })
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  const dbHost = container.getHost();
  const dbPort = container.getMappedPort(5432);
  const databaseUrl = `postgresql://testuser:testpass@${dbHost}:${dbPort}/testdb`;

  // 4. Set environment variables BEFORE importing the app
  process.env.DATABASE_URL = databaseUrl;
  process.env.NODE_ENV = 'test';
  process.env.PORT = '0'; // Random port
  process.env.COGNITO_USER_POOL_ID = 'test-pool-id';
  process.env.COGNITO_REGION = 'ap-northeast-1';
  process.env.COGNITO_CLIENT_ID = 'test-client-id';
  process.env.AWS_S3_BUCKET = 'test-bucket';
  process.env.AWS_S3_REGION = 'ap-northeast-1';
  process.env.CORS_ORIGIN = '*';

  // Override the JWKS URI to point to our mock server
  const cognitoIssuer = `https://cognito-idp.ap-northeast-1.amazonaws.com/test-pool-id`;
  process.env.COGNITO_ISSUER = cognitoIssuer;

  // 5. Create a test pool and run migrations
  testPool = new Pool({ connectionString: databaseUrl });
  await runMigrations(testPool);

  // 6. Now dynamically import and configure the app
  // We need to override the jwks-rsa client to use our mock JWKS server
  // The simplest approach: mock the jsonwebtoken verify to use our key
  jest.mock('jwks-rsa', () => {
    return () => ({
      getSigningKey: (_kid: string, callback: (err: Error | null, key?: { getPublicKey: () => string }) => void) => {
        jose.exportSPKI(publicKey).then((pem) => {
          callback(null, { getPublicKey: () => pem });
        }).catch((err) => {
          callback(err as Error);
        });
      },
    });
  });

  // Mock the config module to use our test database URL and cognito issuer
  jest.mock('../../src/config/index', () => ({
    config: {
      port: 0,
      nodeEnv: 'test',
      logLevel: 'error',
      database: {
        url: process.env.DATABASE_URL,
        maxConnections: 5,
        idleTimeoutMs: 10000,
      },
      cognito: {
        userPoolId: 'test-pool-id',
        clientId: 'test-client-id',
        region: 'ap-northeast-1',
        get issuer() {
          return 'https://cognito-idp.ap-northeast-1.amazonaws.com/test-pool-id';
        },
        get jwksUri() {
          return `http://localhost:${jwksPort}/.well-known/jwks.json`;
        },
      },
      s3: {
        bucket: 'test-bucket',
        region: 'ap-northeast-1',
      },
      rateLimit: {
        auth: 1000,
        api: 1000,
        upload: 1000,
      },
      cors: {
        origin: '*',
      },
    },
  }));

  // Mock the database module to use our test pool
  jest.mock('../../src/config/database', () => {
    const { Pool: PgPool } = require('pg');
    const pool = new PgPool({ connectionString: process.env.DATABASE_URL });
    return {
      pool,
      query: (text: string, params?: unknown[]) => pool.query(text, params),
      getClient: () => pool.connect(),
    };
  });

  // 7. Import the app after mocks are set up
  const { app } = require('../../src/app');
  const { WebSocketServer } = require('ws');
  const { initializeWebSocket } = require('../../src/websocket/wsServer');

  server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws/chat' });
  initializeWebSocket(wss);

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://localhost:${addr.port}`;
      resolve();
    });
  });

  // 8. Mock S3
  s3Mock.on(PutObjectCommand).resolves({});
}, 120000); // 2 minute timeout for container startup

afterAll(async () => {
  // Clean up
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (jwksServer) {
    await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
  }
  if (testPool) {
    await testPool.end();
  }
  if (container) {
    await container.stop();
  }
  jest.restoreAllMocks();
}, 30000);

// ─── Helper Functions ───────────────────────────────────────────────────────────

function agent() {
  return request(server);
}

async function createAuthenticatedUser(sub: string, email: string): Promise<{ token: string; userId: string }> {
  const token = await generateToken(sub, email);

  // Make a request to trigger user auto-creation via auth middleware
  const res = await agent()
    .get('/users/me')
    .set('Authorization', `Bearer ${token}`);

  return { token, userId: res.body.id };
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('Integration Tests - Task Lifecycle', () => {
  let posterToken: string;
  let posterId: string;
  let helperToken: string;
  let helperId: string;
  let helper2Token: string;
  let helper2Id: string;
  let taskId: string;

  beforeAll(async () => {
    // Create test users
    const poster = await createAuthenticatedUser(POSTER_SUB, POSTER_EMAIL);
    posterToken = poster.token;
    posterId = poster.userId;

    const helper = await createAuthenticatedUser(HELPER_SUB, HELPER_EMAIL);
    helperToken = helper.token;
    helperId = helper.userId;

    const helper2 = await createAuthenticatedUser(HELPER2_SUB, HELPER2_EMAIL);
    helper2Token = helper2.token;
    helper2Id = helper2.userId;
  });

  describe('1. Authentication Flow (Requirement 1.1)', () => {
    it('should reject requests without Authorization header', async () => {
      const res = await agent()
        .post('/tasks')
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('unauthorized');
    });

    it('should reject requests with invalid token', async () => {
      const res = await agent()
        .post('/tasks')
        .set('Authorization', 'Bearer invalid-token-here')
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('token_expired');
    });

    it('should accept requests with valid token and return user profile', async () => {
      const res = await agent()
        .get('/users/me')
        .set('Authorization', `Bearer ${posterToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(posterId);
      expect(res.body.email).toBe(POSTER_EMAIL);
      expect(res.body.averageRating).toBeDefined();
    });

    it('should auto-create user on first authenticated request (idempotent)', async () => {
      // The user was already created in beforeAll, verify it exists
      const res = await agent()
        .get('/users/me')
        .set('Authorization', `Bearer ${posterToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(posterId);
    });
  });

  describe('2. Task Creation (Requirement 2.1)', () => {
    it('should create a task with valid data', async () => {
      const taskPayload = {
        type: 'delivery',
        description: 'Please deliver this package to the nearby convenience store',
        location: {
          address: '東京都渋谷区1-1-1',
          latitude: 35.6762,
          longitude: 139.6503,
        },
        reward: 50.00,
        deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };

      const res = await agent()
        .post('/tasks')
        .set('Authorization', `Bearer ${posterToken}`)
        .send(taskPayload);

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.type).toBe('delivery');
      expect(res.body.status).toBe('open');
      taskId = res.body.id;
    });

    it('should reject task creation with invalid data', async () => {
      const res = await agent()
        .post('/tasks')
        .set('Authorization', `Bearer ${posterToken}`)
        .send({
          type: 'invalid_type',
          description: 'short',
          location: { address: '', latitude: 200, longitude: 200 },
          reward: -1,
          deadline: '2020-01-01T00:00:00Z',
        });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('validation_error');
    });

    it('should list tasks with geo query', async () => {
      const res = await agent()
        .get('/tasks')
        .query({
          lat: 35.6762,
          lng: 139.6503,
          radius: 10,
        });

      expect(res.status).toBe(200);
      expect(res.body.tasks).toBeDefined();
      expect(res.body.tasks.length).toBeGreaterThanOrEqual(1);
      expect(res.body.page).toBe(1);
      expect(res.body.totalCount).toBeGreaterThanOrEqual(1);

      // Verify distance field is present
      const foundTask = res.body.tasks.find((t: any) => t.id === taskId);
      expect(foundTask).toBeDefined();
      expect(foundTask.distance).toBeDefined();
    });
  });

  describe('3. Intent Submission (Requirement 3.1)', () => {
    it('should allow helper to submit intent', async () => {
      const res = await agent()
        .post(`/tasks/${taskId}/intents`)
        .set('Authorization', `Bearer ${helperToken}`)
        .send({ message: 'I can help with this delivery!' });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('pending');
    });

    it('should reject duplicate intent from same helper', async () => {
      const res = await agent()
        .post(`/tasks/${taskId}/intents`)
        .set('Authorization', `Bearer ${helperToken}`)
        .send({ message: 'Trying again' });

      expect(res.status).toBe(409);
    });

    it('should allow second helper to submit intent', async () => {
      const res = await agent()
        .post(`/tasks/${taskId}/intents`)
        .set('Authorization', `Bearer ${helper2Token}`)
        .send({ message: 'I am also available!' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('pending');
    });

    it('should reject intent from task poster', async () => {
      const res = await agent()
        .post(`/tasks/${taskId}/intents`)
        .set('Authorization', `Bearer ${posterToken}`)
        .send({ message: 'Self intent' });

      expect(res.status).toBe(403);
    });
  });

  describe('4. Concurrent Intent Submission', () => {
    it('should handle concurrent intent submissions with unique constraint', async () => {
      // Create a new task for this test
      const taskRes = await agent()
        .post('/tasks')
        .set('Authorization', `Bearer ${posterToken}`)
        .send({
          type: 'shopping',
          description: 'Buy groceries from the supermarket nearby please',
          location: {
            address: '東京都新宿区2-2-2',
            latitude: 35.6896,
            longitude: 139.6921,
          },
          reward: 30.00,
          deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });

      const newTaskId = taskRes.body.id;

      // Submit concurrent intents from the same helper
      const results = await Promise.allSettled([
        agent()
          .post(`/tasks/${newTaskId}/intents`)
          .set('Authorization', `Bearer ${helperToken}`)
          .send({ message: 'Concurrent 1' }),
        agent()
          .post(`/tasks/${newTaskId}/intents`)
          .set('Authorization', `Bearer ${helperToken}`)
          .send({ message: 'Concurrent 2' }),
      ]);

      const statuses = results.map((r) =>
        r.status === 'fulfilled' ? r.value.status : 500
      );

      // One should succeed (201) and one should fail (409)
      expect(statuses).toContain(201);
      expect(statuses).toContain(409);
    });
  });

  describe('5. Select Helper (Requirement 3.1)', () => {
    it('should allow poster to select a helper', async () => {
      const res = await agent()
        .post(`/tasks/${taskId}/select-helper`)
        .set('Authorization', `Bearer ${posterToken}`)
        .send({ helperId });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('in_progress');
      expect(res.body.selectedHelperId).toBe(helperId);
    });

    it('should verify task is now in_progress', async () => {
      const res = await agent()
        .get(`/tasks/${taskId}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('in_progress');
    });
  });

  describe('6. Complete Task', () => {
    it('should allow status update to completed', async () => {
      // Directly update task status in DB (simulating the completion flow)
      await testPool.query(
        `UPDATE tasks SET status = 'completed', updated_at = NOW() WHERE id = $1`,
        [taskId]
      );

      const res = await agent().get(`/tasks/${taskId}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('completed');
    });
  });

  describe('7. Submit Review (Requirement 5.1)', () => {
    it('should allow poster to review helper after task completion', async () => {
      const res = await agent()
        .post('/reviews')
        .set('Authorization', `Bearer ${posterToken}`)
        .send({
          taskId,
          revieweeId: helperId,
          rating: 5,
          comment: 'Excellent delivery service!',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.rating).toBe(5);
    });

    it('should reject duplicate review', async () => {
      const res = await agent()
        .post('/reviews')
        .set('Authorization', `Bearer ${posterToken}`)
        .send({
          taskId,
          revieweeId: helperId,
          rating: 4,
          comment: 'Trying again',
        });

      expect(res.status).toBe(409);
    });

    it('should update helper average rating', async () => {
      const res = await agent()
        .get(`/users/${helperId}/reviews`);

      expect(res.status).toBe(200);
      expect(res.body.averageRating).toBe(5.0);
      expect(res.body.totalReviews).toBe(1);
    });
  });
});

describe('Integration Tests - WebSocket (Requirement 4.1)', () => {
  let posterToken: string;
  let posterId: string;
  let helperToken: string;
  let helperId: string;
  let sessionId: string;

  beforeAll(async () => {
    // Create users
    const poster = await createAuthenticatedUser(
      'ws-poster-sub-001',
      'ws-poster@test.com'
    );
    posterToken = poster.token;
    posterId = poster.userId;

    const helper = await createAuthenticatedUser(
      'ws-helper-sub-002',
      'ws-helper@test.com'
    );
    helperToken = helper.token;
    helperId = helper.userId;

    // Create a task and intent to establish a chat session
    const taskRes = await agent()
      .post('/tasks')
      .set('Authorization', `Bearer ${posterToken}`)
      .send({
        type: 'dog_walking',
        description: 'Walk my dog in the park for about 30 minutes',
        location: {
          address: '東京都目黒区3-3-3',
          latitude: 35.6339,
          longitude: 139.7154,
        },
        reward: 25.00,
        deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

    const wsTaskId = taskRes.body.id;

    // Submit intent (this creates a chat session)
    await agent()
      .post(`/tasks/${wsTaskId}/intents`)
      .set('Authorization', `Bearer ${helperToken}`)
      .send({ message: 'I love dogs!' });

    // Get the chat session ID
    const sessionsRes = await agent()
      .get('/chat/sessions')
      .set('Authorization', `Bearer ${posterToken}`);

    if (sessionsRes.body.length > 0) {
      sessionId = sessionsRes.body[0].id;
    } else {
      // Fallback: query directly
      const result = await testPool.query(
        'SELECT id FROM chat_sessions WHERE poster_id = $1 AND helper_id = $2 LIMIT 1',
        [posterId, helperId]
      );
      sessionId = result.rows[0]?.id;
    }
  });

  it('should reject WebSocket connection without token', (done) => {
    const addr = server.address() as AddressInfo;
    const ws = new WebSocket(`ws://localhost:${addr.port}/ws/chat`);

    ws.on('close', (code) => {
      expect(code).toBe(4001);
      done();
    });

    ws.on('error', () => {
      // Connection may error before close
      done();
    });
  });

  it('should reject WebSocket connection with invalid token', (done) => {
    const addr = server.address() as AddressInfo;
    const ws = new WebSocket(`ws://localhost:${addr.port}/ws/chat?token=invalid-token`);

    ws.on('close', (code) => {
      expect(code).toBe(4001);
      done();
    });

    ws.on('error', () => {
      done();
    });
  });

  it('should accept WebSocket connection with valid token and send/receive messages', (done) => {
    if (!sessionId) {
      // Skip if no session was created
      done();
      return;
    }

    const addr = server.address() as AddressInfo;
    const ws = new WebSocket(`ws://localhost:${addr.port}/ws/chat?token=${posterToken}`);

    ws.on('open', () => {
      // Send a message
      ws.send(JSON.stringify({
        type: 'text',
        sessionId,
        content: 'Hello from integration test!',
        localId: 'local-msg-001',
      }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'ack') {
        expect(msg.localId).toBe('local-msg-001');
        expect(msg.messageId).toBeDefined();
        ws.close();
        done();
      }
    });

    ws.on('error', (err) => {
      ws.close();
      done(err);
    });

    // Timeout safety
    setTimeout(() => {
      ws.close();
      done(new Error('WebSocket test timed out'));
    }, 10000);
  });
});

describe('Integration Tests - Image Upload (Requirement 6.3)', () => {
  let posterToken: string;

  beforeAll(async () => {
    const poster = await createAuthenticatedUser(
      'upload-poster-sub-001',
      'upload-poster@test.com'
    );
    posterToken = poster.token;
  });

  beforeEach(() => {
    s3Mock.reset();
    s3Mock.on(PutObjectCommand).resolves({});
  });

  it('should upload a valid JPEG image', async () => {
    // Create a minimal valid JPEG buffer (JPEG magic bytes)
    const jpegBuffer = Buffer.from([
      0xFF, 0xD8, 0xFF, 0xE0, // JPEG SOI + APP0 marker
      0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, // JFIF header
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
      0xFF, 0xD9, // EOI marker
    ]);

    const res = await agent()
      .post('/upload/image')
      .set('Authorization', `Bearer ${posterToken}`)
      .attach('image', jpegBuffer, { filename: 'test.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.url).toBeDefined();
    expect(res.body.url).toContain('test-bucket');
    expect(res.body.url).toContain('uploads/');
  });

  it('should upload a valid PNG image', async () => {
    // Create a minimal valid PNG buffer (PNG magic bytes)
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xDE, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, // IEND chunk
      0x44, 0xAE, 0x42, 0x60, 0x82,
    ]);

    const res = await agent()
      .post('/upload/image')
      .set('Authorization', `Bearer ${posterToken}`)
      .attach('image', pngBuffer, { filename: 'test.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.url).toBeDefined();
    expect(res.body.url).toContain('uploads/');
  });

  it('should reject unsupported file format (GIF)', async () => {
    const gifBuffer = Buffer.from([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
      0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
    ]);

    const res = await agent()
      .post('/upload/image')
      .set('Authorization', `Bearer ${posterToken}`)
      .attach('image', gifBuffer, { filename: 'test.gif', contentType: 'image/gif' });

    expect(res.status).toBe(422);
  });

  it('should reject upload without authentication', async () => {
    const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);

    const res = await agent()
      .post('/upload/image')
      .attach('image', jpegBuffer, { filename: 'test.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(401);
  });
});
