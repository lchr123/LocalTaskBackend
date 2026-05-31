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

// --- Global Error Handler (must be registered AFTER routes) ---
app.use(errorHandler);

export { app };
