/**
 * Admin Controller
 *
 * Provides admin-only endpoints:
 * - POST /admin/login — authenticate admin
 * - GET /admin/users — list all users
 * - GET /admin/tasks — list all tasks
 * - PATCH /admin/tasks/:id/status — force update task status
 * - GET /admin/reports — list all reports
 * - PATCH /admin/reports/:id — handle a report (resolve/dismiss)
 */

import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { adminAuthMiddleware } from '../middleware/adminAuth';
import { query } from '../config/database';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';

const router = Router();

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_JWT_SECRET = 'locally_helper_admin_2026';

// ─── Login ───────────────────────────────────────────────────────────────────

/**
 * POST /admin/login
 * Authenticate with username/password, return JWT.
 */
router.post('/login', (req: Request, res: Response): void => {
  const { username, password } = req.body;

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: 'unauthorized', message: '用户名或密码错误' });
    return;
  }

  const token = jwt.sign(
    { username, role: 'admin' },
    ADMIN_JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.status(200).json({ token, expiresIn: '24h' });
});

// ─── Protected Routes (require admin JWT) ────────────────────────────────────

router.use(adminAuthMiddleware as any);

/**
 * GET /admin/users
 * List all users with basic info.
 */
router.get('/users', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const search = req.query.search as string | undefined;
    const offset = (page - 1) * pageSize;

    const listParams: any[] = [pageSize, offset];
    const countParams: any[] = [];
    let whereStr = '';
    let countWhereStr = '';

    if (search) {
      whereStr = `WHERE u.cognito_sub::text ILIKE $3`;
      countWhereStr = `WHERE u.cognito_sub::text ILIKE $1`;
      listParams.push(`%${search}%`);
      countParams.push(`%${search}%`);
    }

    const [usersResult, countResult] = await Promise.all([
      query(
        `SELECT id, cognito_sub, email, phone, nickname, avatar_url, average_rating, 
                (SELECT COUNT(*) FROM tasks t WHERE t.selected_helper_id = u.id AND t.status = 'completed')::int AS completed_task_count,
                created_at, updated_at
         FROM users u ${whereStr} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        listParams
      ),
      query(`SELECT COUNT(*) AS count FROM users u ${countWhereStr}`, countParams),
    ]);

    res.status(200).json({
      users: usersResult.rows,
      page,
      totalCount: parseInt(countResult.rows[0].count),
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / pageSize),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/tasks
 * List all tasks with filtering by status.
 */
router.get('/tasks', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const status = req.query.status as string | undefined;
    const search = req.query.search as string | undefined;
    const offset = (page - 1) * pageSize;

    // Build WHERE conditions dynamically
    const whereClauses: string[] = [];
    const listParams: any[] = [pageSize, offset];
    const countParams: any[] = [];
    let listParamIndex = 3;
    let countParamIndex = 1;

    if (status) {
      whereClauses.push(`t.status = $${listParamIndex}`);
      listParams.push(status);
      countParams.push(status);
      listParamIndex++;
      countParamIndex++;
    }

    if (search) {
      whereClauses.push(`t.id::text ILIKE $${listParamIndex}`);
      listParams.push(`%${search}%`);
      countParams.push(`%${search}%`);
      listParamIndex++;
      countParamIndex++;
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    // Rebuild WHERE for count query with $1, $2... numbering
    const countWhereClauses: string[] = [];
    let ci = 1;
    if (status) { countWhereClauses.push(`t.status = $${ci}`); ci++; }
    if (search) { countWhereClauses.push(`t.id::text ILIKE $${ci}`); ci++; }
    const countWhereStr = countWhereClauses.length > 0 ? `WHERE ${countWhereClauses.join(' AND ')}` : '';

    const [tasksResult, countResult] = await Promise.all([
      query(
        `SELECT t.id, t.poster_id, u.nickname AS poster_nickname, u.email AS poster_email,
                t.type, t.description, t.location_address, t.reward, t.deadline,
                t.status, t.intent_count, t.selected_helper_id,
                t.created_at, t.updated_at
         FROM tasks t
         JOIN users u ON t.poster_id = u.id
         ${whereStr}
         ORDER BY t.created_at DESC LIMIT $1 OFFSET $2`,
        listParams
      ),
      query(
        `SELECT COUNT(*) AS count FROM tasks t ${countWhereStr}`,
        countParams
      ),
    ]);

    res.status(200).json({
      tasks: tasksResult.rows,
      page,
      totalCount: parseInt(countResult.rows[0].count),
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / pageSize),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/tasks/:id/status
 * Force update task status (admin override, no state machine check).
 */
router.patch('/tasks/:id/status', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['open', 'in_progress', 'completed', 'cancelled'];
    if (!status || !validStatuses.includes(status)) {
      res.status(422).json({ error: 'validation_error', message: '无效的状态值' });
      return;
    }

    const result = await query(
      `UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status`,
      [status, id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'not_found', message: '任务不存在' });
      return;
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/reports
 * List all reports with pagination.
 */
router.get('/reports', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const status = req.query.status as string | undefined;
    const offset = (page - 1) * pageSize;

    const conditions = status ? `WHERE r.status = $${3}` : '';
    const countConditions = status ? 'WHERE r.status = $1' : '';
    const params: any[] = [pageSize, offset];
    if (status) params.push(status);

    const [reportsResult, countResult] = await Promise.all([
      query(
        `SELECT r.*, u.nickname AS reporter_nickname, u.email AS reporter_email
         FROM reports r
         JOIN users u ON r.reporter_id = u.id
         ${conditions}
         ORDER BY r.created_at DESC LIMIT $1 OFFSET $2`,
        params
      ),
      query(
        `SELECT COUNT(*) AS count FROM reports r ${countConditions}`,
        status ? [status] : []
      ),
    ]);

    res.status(200).json({
      reports: reportsResult.rows,
      page,
      totalCount: parseInt(countResult.rows[0].count),
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / pageSize),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /admin/reports/:id
 * Update report status (resolve or dismiss).
 */
router.patch('/reports/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, adminNote } = req.body;

    const validStatuses = ['submitted', 'reviewing', 'resolved'];
    if (!status || !validStatuses.includes(status)) {
      res.status(422).json({ error: 'validation_error', message: '无效的状态值' });
      return;
    }

    const setClauses = ['status = $1'];
    const values: any[] = [status, id];

    if (adminNote) {
      setClauses.push(`admin_note = $${values.length + 1}`);
      values.push(adminNote);
    }

    const result = await query(
      `UPDATE reports SET ${setClauses.join(', ')} WHERE id = $${values.indexOf(id) + 1} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'not_found', message: '举报记录不存在' });
      return;
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/chats
 * List all chat sessions with participant info.
 */
router.get('/chats', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const search = req.query.search as string | undefined;
    const offset = (page - 1) * pageSize;

    const listParams: any[] = [pageSize, offset];
    const countParams: any[] = [];
    let whereStr = '';
    let countWhereStr = '';

    if (search) {
      whereStr = `WHERE poster_u.cognito_sub::text ILIKE $3`;
      countWhereStr = `WHERE poster_u.cognito_sub::text ILIKE $1`;
      listParams.push(`%${search}%`);
      countParams.push(`%${search}%`);
    }

    const [chatsResult, countResult] = await Promise.all([
      query(
        `SELECT cs.id, cs.task_id,
                poster_u.cognito_sub AS poster_cognito_sub,
                helper_u.cognito_sub AS helper_cognito_sub,
                cs.created_at
         FROM chat_sessions cs
         JOIN users poster_u ON cs.poster_id = poster_u.id
         JOIN users helper_u ON cs.helper_id = helper_u.id
         ${whereStr}
         ORDER BY cs.last_message_time DESC
         LIMIT $1 OFFSET $2`,
        listParams
      ),
      query(
        `SELECT COUNT(*) AS count FROM chat_sessions cs
         JOIN users poster_u ON cs.poster_id = poster_u.id
         ${countWhereStr}`,
        countParams
      ),
    ]);

    res.status(200).json({
      chats: chatsResult.rows,
      page,
      totalCount: parseInt(countResult.rows[0].count),
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / pageSize),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/reviews
 * List all reviews with participant cognito subs.
 */
router.get('/reviews', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const offset = (page - 1) * pageSize;

    const [reviewsResult, countResult] = await Promise.all([
      query(
        `SELECT r.id, r.task_id, r.rating, r.comment, r.created_at,
                reviewer_u.cognito_sub AS reviewer_cognito_sub,
                reviewee_u.cognito_sub AS reviewee_cognito_sub
         FROM reviews r
         JOIN users reviewer_u ON r.reviewer_id = reviewer_u.id
         JOIN users reviewee_u ON r.reviewee_id = reviewee_u.id
         ORDER BY r.created_at DESC
         LIMIT $1 OFFSET $2`,
        [pageSize, offset]
      ),
      query('SELECT COUNT(*) AS count FROM reviews'),
    ]);

    res.status(200).json({
      reviews: reviewsResult.rows,
      page,
      totalCount: parseInt(countResult.rows[0].count),
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / pageSize),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/chats/:id/messages
 * List all messages in a chat session, ordered by time ascending.
 */
router.get('/chats/:id/messages', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT m.id, m.sender_id, u.nickname AS sender_nickname, u.cognito_sub AS sender_cognito_sub,
              m.content, m.type, m.image_url, m.timestamp
       FROM chat_messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.session_id = $1
       ORDER BY m.timestamp ASC`,
      [id]
    );

    // Presign image URLs
    const s3Client = new S3Client({ region: config.s3.region });
    const messages = await Promise.all(
      result.rows.map(async (m: any) => {
        if (m.type === 'image' && m.image_url) {
          try {
            // Extract S3 key from the URL
            const url = new URL(m.image_url);
            const key = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
            const command = new GetObjectCommand({ Bucket: config.s3.bucket, Key: key });
            m.image_url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
          } catch {
            // Keep original URL if presigning fails
          }
        }
        return m;
      })
    );

    res.status(200).json({ messages });
  } catch (err) {
    next(err);
  }
});

export { router as adminController };
