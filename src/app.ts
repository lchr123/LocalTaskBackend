import express from 'express';
import compression from 'compression';
import { requestIdMiddleware } from './middleware/requestId';
import { corsMiddleware } from './middleware/cors';
import { securityHeadersMiddleware } from './middleware/securityHeaders';
import { apiRateLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import { healthController } from './controllers/healthController';
import { taskController } from './controllers/taskController';
import { intentController, selectHelperRouter } from './controllers/intentController';
import { chatController } from './controllers/chatController';
import { reviewController, getUserReviews, getUserReviewsGiven } from './controllers/reviewController';
import { reportController } from './controllers/reportController';
import { uploadController } from './controllers/uploadController';
import { userController } from './controllers/userController';
import { adminController } from './controllers/adminController';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';

const app = express();
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Local Task Backend API',
      version: '0.1.0',
      description: 'Backend API service for the local task platform',
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Local development server',
      },
    ],
  },
  apis: ['./src/controllers/**/*.ts', './src/routes/**/*.ts', './src/app.ts'],
});

// --- Middleware Pipeline ---
// Order: requestId → cors → securityHeaders → compression → bodyParser → rateLimiter

// 1. Request ID generation (must be first for tracing)
app.use(requestIdMiddleware);

// 2. CORS handling
app.use(corsMiddleware);

// 3. Security headers
app.use(securityHeadersMiddleware);

// 4. Response compression
app.use(compression());

// 5. Body parsing (JSON max 1MB, URL-encoded)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 6. Rate limiting (general API)
app.use(apiRateLimiter);

// --- Route Registration ---

// Swagger API Docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get('/openapi.json', (_req, res) => {
  res.json(swaggerSpec);
});

// Health check (no auth required)
app.use('/health', healthController);

// Task routes
app.use('/tasks', taskController);

// Intent routes (nested under /tasks/:id/intents)
app.use('/tasks/:id/intents', intentController);

// Select helper route (POST /tasks/:id/select-helper)
app.use('/tasks/:id/select-helper', selectHelperRouter);

// Chat routes
app.use('/chat', chatController);

// Review routes
app.use('/reviews', reviewController);

// User reviews route (GET /users/:id/reviews)
app.get('/users/:id/reviews', getUserReviews);

// User reviews given route (GET /users/:id/reviews-given)
app.get('/users/:id/reviews-given', getUserReviewsGiven);

// Report routes
app.use('/reports', reportController);

// Upload routes
app.use('/upload', uploadController);

// User routes
app.use('/users', userController);

// My Tags routes (standalone to avoid /users/:id conflict)
import { authMiddleware } from './middleware/auth';
import { query as dbQuery } from './config/database';
import { AuthenticatedRequest } from './types/common';

app.get('/my-tags', authMiddleware as any, async (req: any, res: any, next: any) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.userId;
    const result = await dbQuery(
      `SELECT ht.id, ht.name, ht.label_zh, ht.category
       FROM user_helper_tags uht
       JOIN helper_tags ht ON uht.tag_id = ht.id
       WHERE uht.user_id = $1`,
      [userId]
    );
    res.status(200).json({ tags: result.rows });
  } catch (err) { next(err); }
});

app.put('/my-tags', authMiddleware as any, async (req: any, res: any, next: any) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.userId;
    const { tagIds } = req.body;

    if (!Array.isArray(tagIds)) {
      res.status(422).json({ error: 'validation_error', message: 'tagIds must be an array' });
      return;
    }

    await dbQuery('DELETE FROM user_helper_tags WHERE user_id = $1', [userId]);

    if (tagIds.length > 0) {
      const values = tagIds.map((_: string, i: number) => `($1, $${i + 2})`).join(', ');
      await dbQuery(
        `INSERT INTO user_helper_tags (user_id, tag_id) VALUES ${values} ON CONFLICT DO NOTHING`,
        [userId, ...tagIds]
      );
    }

    const result = await dbQuery(
      `SELECT ht.id, ht.name, ht.label_zh, ht.category
       FROM user_helper_tags uht
       JOIN helper_tags ht ON uht.tag_id = ht.id
       WHERE uht.user_id = $1`,
      [userId]
    );
    res.status(200).json({ tags: result.rows });
  } catch (err) { next(err); }
});

// Admin routes
app.use('/admin', adminController);

// --- Global Error Handler (must be registered AFTER routes) ---
app.use(errorHandler);

export { app };
